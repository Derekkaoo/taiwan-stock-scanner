/**
 * POST /api/payment/ecpay-return  (綠界 ReturnURL — server-to-server)
 *
 * 綠界扣款成功（首期 + 之後每月續期）都會打進來。流程：
 *   1. 解析 form-urlencoded body
 *   2. 驗 CheckMacValue (任何 D1 寫操作前都必須過這關)
 *   3. 找 orders by MerchantTradeNo（找不到 = 偽造 / 過期單）
 *   4. Idempotent check（ecpay_trade_no 已寫過 = 重打，跳過）
 *   5. INSERT INTO payments（含 raw_payload 留底對帳用）
 *   6. UPDATE orders（status='paid' + gwsr/card4no/...）
 *   7. UPSERT user_status（tier='VIP' + 延長 vip_until）
 *   8. 首期成功 → Telegram 通知 admin
 *   9. 回 '1|OK'（綠界要求純文字）
 *
 * 失敗回應：
 *   - 驗簽失敗 → '0|CheckMacValueError'（綠界會 retry 但永遠不會過 → 最終放棄）
 *   - 訂單不存在 → '0|OrderNotFound'
 *   - RtnCode != 1（扣款失敗）→ 記 payments row 但不升 VIP，回 '1|OK' 告訴綠界別 retry
 *   - 其他內部錯誤 → '0|InternalError'（讓綠界 retry）
 */

import { notifyAdmin, anonId } from '../../_lib/notifyAdmin'
import {
  parseEcpayCallback,
  verifyEcpayCallback,
  calcNewVipUntil,
  ecpayDateToUnix,
} from '../../_lib/ecpay-callback'

interface Env {
  DB: D1Database
  ECPAY_ENV?: string
  ECPAY_HASH_KEY?: string
  ECPAY_HASH_IV?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

interface OrderRow {
  merchant_trade_no: string
  user_uid: string
  user_email: string | null
  plan: string
  amount: number
  period_type: string
  status: string
  total_success_times: number
}

interface UserStatusRow {
  uid: string
  email: string | null
  tier: string
  vip_until: number | null
  trial_until: number | null
}

function textResp(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.ECPAY_HASH_KEY || !env.ECPAY_HASH_IV) {
    console.error('[ecpay-return] missing ECPAY_HASH_KEY/ECPAY_HASH_IV')
    return textResp('0|ServerNotConfigured', 500)
  }

  const parsed = await parseEcpayCallback(request)
  if (!parsed) {
    console.warn('[ecpay-return] failed to parse callback body')
    return textResp('0|InvalidBody', 400)
  }
  const { params, raw } = parsed

  const valid = await verifyEcpayCallback(
    params,
    env.ECPAY_HASH_KEY,
    env.ECPAY_HASH_IV,
  )
  if (!valid) {
    console.warn(
      `[ecpay-return] CheckMacValue verification failed for MerchantTradeNo=${params.MerchantTradeNo}`,
    )
    return textResp('0|CheckMacValueError', 400)
  }

  const order = await env.DB
    .prepare(
      `SELECT merchant_trade_no, user_uid, user_email, plan, amount,
              period_type, status, total_success_times
       FROM orders WHERE merchant_trade_no = ? LIMIT 1`,
    )
    .bind(params.MerchantTradeNo)
    .first<OrderRow>()

  if (!order) {
    console.warn(
      `[ecpay-return] order not found: ${params.MerchantTradeNo}`,
    )
    return textResp('0|OrderNotFound', 404)
  }

  const existingPayment = await env.DB
    .prepare(
      'SELECT id FROM payments WHERE ecpay_trade_no = ? LIMIT 1',
    )
    .bind(params.TradeNo)
    .first<{ id: number }>()
  if (existingPayment) {
    console.log(
      `[ecpay-return] payment already recorded (TradeNo=${params.TradeNo}) — idempotent skip`,
    )
    return textResp('1|OK')
  }

  const rtnCode = parseInt(params.RtnCode || '0', 10)
  const amount = parseInt(params.TradeAmt || params.amount || '0', 10)
  const totalSuccessTimes = parseInt(params.TotalSuccessTimes || '0', 10)
  const isFirstPeriod = totalSuccessTimes === 1
  const paidAt = ecpayDateToUnix(params.PaymentDate || params.process_date)

  try {
    await env.DB
      .prepare(
        `INSERT INTO payments
           (merchant_trade_no, ecpay_trade_no, amount, rtn_code, rtn_msg,
            process_date, total_success_times, is_first_period, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        order.merchant_trade_no,
        params.TradeNo,
        amount,
        rtnCode,
        params.RtnMsg || null,
        params.PaymentDate || params.process_date || null,
        totalSuccessTimes,
        isFirstPeriod ? 1 : 0,
        raw,
      )
      .run()
  } catch (e) {
    console.error('[ecpay-return] failed to insert payment:', e)
    return textResp('0|InternalError', 500)
  }

  if (rtnCode !== 1) {
    console.warn(
      `[ecpay-return] RtnCode=${rtnCode} RtnMsg=${params.RtnMsg} — recorded but not upgrading VIP`,
    )
    await notifyAdmin(
      env,
      `⚠️ <b>扣款失敗</b>\n` +
        `📋 訂單 <code>${order.merchant_trade_no}</code>\n` +
        `👤 <code>${anonId('google:' + order.user_uid)}</code>\n` +
        `💳 RtnCode=${rtnCode} ${params.RtnMsg || ''}\n` +
        `⏱ ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    )
    return textResp('1|OK')
  }

  try {
    await env.DB
      .prepare(
        `UPDATE orders SET
           status               = 'paid',
           paid_at              = COALESCE(paid_at, ?),
           ecpay_trade_no       = ?,
           gwsr                 = ?,
           auth_code            = ?,
           card4no              = ?,
           card6no              = ?,
           total_success_times  = ?
         WHERE merchant_trade_no = ?`,
      )
      .bind(
        paidAt,
        params.TradeNo,
        params.gwsr || null,
        params.auth_code || null,
        params.card4no || null,
        params.card6no || null,
        totalSuccessTimes,
        order.merchant_trade_no,
      )
      .run()
  } catch (e) {
    console.error('[ecpay-return] failed to update order:', e)
    return textResp('1|OK')
  }

  try {
    const existingStatus = await env.DB
      .prepare(
        'SELECT uid, email, tier, vip_until, trial_until FROM user_status WHERE uid = ? LIMIT 1',
      )
      .bind(order.user_uid)
      .first<UserStatusRow>()

    const newVipUntil = calcNewVipUntil(
      existingStatus?.vip_until ?? null,
      (order.period_type === 'Y' ? 'Y' : 'M') as 'M' | 'Y',
      paidAt,
    )

    if (existingStatus) {
      await env.DB
        .prepare(
          `UPDATE user_status SET
             tier       = 'VIP',
             vip_until  = ?,
             email      = COALESCE(?, email),
             updated_at = CAST(strftime('%s','now') AS INTEGER)
           WHERE uid = ?`,
        )
        .bind(newVipUntil, order.user_email, order.user_uid)
        .run()
    } else {
      await env.DB
        .prepare(
          `INSERT INTO user_status (uid, email, tier, vip_until)
           VALUES (?, ?, 'VIP', ?)`,
        )
        .bind(order.user_uid, order.user_email, newVipUntil)
        .run()
    }
  } catch (e) {
    console.error('[ecpay-return] failed to upsert user_status:', e)
    await notifyAdmin(
      env,
      `🚨 <b>VIP 升級失敗</b>（手動補）\n` +
        `訂單 <code>${order.merchant_trade_no}</code> 已收款但 user_status UPSERT 失敗：${e instanceof Error ? e.message : String(e)}`,
    )
    return textResp('1|OK')
  }

  if (isFirstPeriod) {
    const planLabel = order.plan === 'yearly' ? '年付 NT$888' : '月付 NT$88'
    await notifyAdmin(
      env,
      `🎉 <b>新訂閱</b>\n` +
        `📦 ${planLabel}\n` +
        `👤 <code>${anonId('google:' + order.user_uid)}</code>` +
        (order.user_email ? `（${order.user_email}）` : '') + `\n` +
        `📋 <code>${order.merchant_trade_no}</code>\n` +
        `💳 卡 ****${params.card4no || '????'} / 授權碼 ${params.auth_code || '?'}\n` +
        `⏱ ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
    )
  }

  console.log(
    `[ecpay-return] success — MerchantTradeNo=${order.merchant_trade_no}, ` +
      `TradeNo=${params.TradeNo}, totalSuccessTimes=${totalSuccessTimes}, isFirst=${isFirstPeriod}`,
  )
  return textResp('1|OK')
}

export const onRequestGet: PagesFunction<Env> = async () =>
  textResp('ecpay-return endpoint (POST only)', 405)
