/**
 * POST /api/payment/cancel
 *
 * User 自己取消訂閱（廢止綠界 CreditCardPeriodAction）。
 *
 * 政策：
 *   - 取消 = 停止下次自動扣款（綠界 Action=Cancel）
 *   - vip_until **不動** → user 當期到期前仍是 VIP
 *   - 想退款？另走 POST /api/internal/admin/refund（admin only）
 *
 * Auth: Authorization: Bearer <Google ID Token>
 * Body: { "merchant_trade_no": "TS..." }
 *
 * Response 200:
 *   { "ok": true, "merchant_trade_no": "...", "status": "cancelled", "ecpay_response": {...} }
 *
 * Response 4xx:
 *   { "error": "..." }
 */

import { authenticateRequest } from '../../_lib/google-auth'
import { signEcpay, getEcpayEndpoint, EcpayEnv } from '../../_lib/ecpay'
import { notifyAdmin, anonId } from '../../_lib/notifyAdmin'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
  ECPAY_ENV?: string
  ECPAY_MERCHANT_ID?: string
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
  status: string
  gwsr: string | null
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS })

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // 1. 環境檢查
  if (!env.GOOGLE_CLIENT_ID) {
    return jsonResponse({ error: 'Server missing GOOGLE_CLIENT_ID' }, 500)
  }
  if (!env.ECPAY_MERCHANT_ID || !env.ECPAY_HASH_KEY || !env.ECPAY_HASH_IV) {
    return jsonResponse({ error: 'Server missing ECPay credentials' }, 500)
  }
  const ecpayEnv: EcpayEnv = env.ECPAY_ENV === 'production' ? 'production' : 'stage'

  // 2. 驗 Google
  let user
  try {
    user = await authenticateRequest(request, env.GOOGLE_CLIENT_ID)
  } catch (e) {
    return jsonResponse(
      { error: e instanceof Error ? e.message : 'Auth failed' },
      401,
    )
  }

  // 3. 解析 body
  let body: { merchant_trade_no?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }
  if (
    typeof body.merchant_trade_no !== 'string' ||
    !body.merchant_trade_no.trim()
  ) {
    return jsonResponse({ error: 'Missing merchant_trade_no' }, 400)
  }
  const mtNo = body.merchant_trade_no.trim()

  // 4. 找訂單（一定要屬於這個 user，不然會被別人 cancel 別人的）
  const order = await env.DB
    .prepare(
      `SELECT merchant_trade_no, user_uid, user_email, plan, status, gwsr
       FROM orders WHERE merchant_trade_no = ? AND user_uid = ? LIMIT 1`,
    )
    .bind(mtNo, user.sub)
    .first<OrderRow>()

  if (!order) {
    return jsonResponse({ error: 'Order not found' }, 404)
  }
  if (order.status === 'cancelled') {
    return jsonResponse(
      { ok: true, merchant_trade_no: mtNo, status: 'cancelled', note: 'already cancelled' },
    )
  }
  if (order.status !== 'paid') {
    return jsonResponse(
      { error: `Order status is '${order.status}', cannot cancel` },
      400,
    )
  }

  // 5. 打綠界 CreditCardPeriodAction → Action=Cancel
  //    docs: https://developers.ecpay.com.tw/?p=5697 （定期定額廢止）
  //    params (signed alphabetically):
  //      Action          'Cancel'
  //      MerchantID
  //      MerchantTradeNo
  //      TimeStamp       unix epoch sec
  //      CheckMacValue   (sign 完才填)
  const cancelParams: Record<string, string> = {
    MerchantID: env.ECPAY_MERCHANT_ID,
    MerchantTradeNo: mtNo,
    Action: 'Cancel',
    TimeStamp: String(Math.floor(Date.now() / 1000)),
  }
  cancelParams.CheckMacValue = await signEcpay(
    cancelParams,
    env.ECPAY_HASH_KEY,
    env.ECPAY_HASH_IV,
  )

  const ecpayUrl = getEcpayEndpoint(ecpayEnv, 'cancelCreditPeriod')
  let ecpayResponseText = ''
  let ecpayParsed: Record<string, string> = {}
  try {
    const resp = await fetch(ecpayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(cancelParams).toString(),
    })
    ecpayResponseText = await resp.text()
    // 綠界回 form-urlencoded
    try {
      ecpayParsed = Object.fromEntries(new URLSearchParams(ecpayResponseText).entries())
    } catch {
      ecpayParsed = {}
    }
    if (!resp.ok) {
      return jsonResponse(
        {
          error: 'ECPay API returned non-2xx',
          status: resp.status,
          body: ecpayResponseText.slice(0, 500),
        },
        502,
      )
    }
  } catch (e) {
    return jsonResponse(
      { error: `ECPay request failed: ${e instanceof Error ? e.message : String(e)}` },
      502,
    )
  }

  // 綠界 RtnCode='1' 才算廢止成功（其他可能是「找不到單」「卡片狀態異常」等）
  const ecpayRtnCode = ecpayParsed.RtnCode || ecpayParsed.MerchantID ? ecpayParsed.RtnCode : null
  if (ecpayRtnCode !== '1') {
    // 失敗 → 把整包綠界 response 回給前端 + log + Telegram alert
    console.warn('[cancel] ECPay rejected:', ecpayResponseText.slice(0, 500))
    await notifyAdmin(
      env,
      `⚠️ <b>取消訂閱失敗</b>\n` +
        `📋 <code>${mtNo}</code>\n` +
        `👤 <code>${anonId('google:' + order.user_uid)}</code>\n` +
        `🟠 ECPay: ${JSON.stringify(ecpayParsed).slice(0, 200)}`,
    )
    return jsonResponse(
      {
        error: 'ECPay refused to cancel',
        ecpay_response: ecpayParsed,
        ecpay_raw: ecpayResponseText.slice(0, 500),
      },
      502,
    )
  }

  // 6. 更新 D1（vip_until 不動！— 政策：當期到期前還是 VIP）
  try {
    await env.DB
      .prepare(
        `UPDATE orders SET
           status       = 'cancelled',
           cancelled_at = CAST(strftime('%s','now') AS INTEGER)
         WHERE merchant_trade_no = ?`,
      )
      .bind(mtNo)
      .run()
  } catch (e) {
    // 綠界已成功廢止，D1 更新失敗的話告警
    console.error('[cancel] D1 update failed after ECPay cancel:', e)
    await notifyAdmin(
      env,
      `🚨 <b>取消同步失敗</b>（手動補 D1）\n` +
        `綠界已廢止 <code>${mtNo}</code> 但 orders.status 沒更新到\n` +
        `Error: ${e instanceof Error ? e.message : String(e)}`,
    )
    return jsonResponse({ error: 'D1 update failed but ECPay cancel succeeded' }, 500)
  }

  // 7. Telegram 通知（你 admin）
  await notifyAdmin(
    env,
    `🛑 <b>用戶取消訂閱</b>\n` +
      `📋 <code>${mtNo}</code> (${order.plan})\n` +
      `👤 <code>${anonId('google:' + order.user_uid)}</code>` +
      (order.user_email ? `（${order.user_email}）` : '') + `\n` +
      `⏱ ${new Date().toISOString().replace('T', ' ').slice(0, 19)}\n` +
      `📌 vip_until 不變，用戶當期仍是 VIP`,
  )

  return jsonResponse({
    ok: true,
    merchant_trade_no: mtNo,
    status: 'cancelled',
    note: 'VIP 維持到當期到期，下期不會再扣款',
    ecpay_response: ecpayParsed,
  })
}
