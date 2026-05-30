/**
 * POST /api/internal/admin/refund
 *
 * Admin 工具：你在綠界後台手動退刷 + 廢止授權之後打這個，
 * 幫你把 D1 的 orders/user_status 標好對應狀態。
 *
 * Auth: Authorization: Bearer <INTERNAL_CRON_TOKEN>
 *
 * Body:
 *   {
 *     "merchant_trade_no": "TS...",
 *     "mode": "refund" | "cancel",
 *     "note": "客戶 5/30 申請退款，已退刷 88 元"
 *   }
 *
 *   mode='refund' → orders.status='refunded'
 *                   + user_status.vip_until=now（立刻降回 FREE）
 *   mode='cancel' → orders.status='cancelled'
 *                   + vip_until 不動（當期到期前仍 VIP）
 *
 * 用途差異跟 /api/payment/cancel：
 *   - /api/payment/cancel  用戶自己取消，會打綠界廢止授權 API
 *   - admin/refund         你已經在綠界後台手動處理，這只是同步 D1
 */

import { notifyAdmin } from '../../../_lib/notifyAdmin'

interface Env {
  DB: D1Database
  INTERNAL_CRON_TOKEN?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

interface OrderRow {
  merchant_trade_no: string
  user_uid: string
  user_email: string | null
  plan: string
  amount: number
  status: string
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
  // 1. 驗 token
  const expected = env.INTERNAL_CRON_TOKEN
  if (!expected) {
    return jsonResponse({ error: 'Server missing INTERNAL_CRON_TOKEN' }, 500)
  }
  const authHeader = request.headers.get('Authorization') || ''
  const m = authHeader.match(/^Bearer\s+(.+)$/i)
  const token = m ? m[1].trim() : ''
  if (!token || token !== expected) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // 2. 解析 body
  let body: { merchant_trade_no?: unknown; mode?: unknown; note?: unknown }
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
  if (body.mode !== 'refund' && body.mode !== 'cancel') {
    return jsonResponse({ error: "mode must be 'refund' or 'cancel'" }, 400)
  }
  const mtNo = body.merchant_trade_no.trim()
  const mode = body.mode as 'refund' | 'cancel'
  const note =
    typeof body.note === 'string' ? body.note.slice(0, 500) : null

  // 3. 找訂單
  const order = await env.DB
    .prepare(
      `SELECT merchant_trade_no, user_uid, user_email, plan, amount, status
       FROM orders WHERE merchant_trade_no = ? LIMIT 1`,
    )
    .bind(mtNo)
    .first<OrderRow>()
  if (!order) {
    return jsonResponse({ error: 'Order not found' }, 404)
  }

  const now = Math.floor(Date.now() / 1000)

  // 4. 標 orders
  try {
    if (mode === 'refund') {
      await env.DB
        .prepare(
          `UPDATE orders SET
             status      = 'refunded',
             refunded_at = ?,
             note        = COALESCE(?, note)
           WHERE merchant_trade_no = ?`,
        )
        .bind(now, note, mtNo)
        .run()
    } else {
      // cancel
      await env.DB
        .prepare(
          `UPDATE orders SET
             status       = 'cancelled',
             cancelled_at = COALESCE(cancelled_at, ?),
             note         = COALESCE(?, note)
           WHERE merchant_trade_no = ?`,
        )
        .bind(now, note, mtNo)
        .run()
    }
  } catch (e) {
    return jsonResponse(
      { error: `D1 update orders failed: ${e instanceof Error ? e.message : String(e)}` },
      500,
    )
  }

  // 5. refund 模式才動 user_status（vip_until → now，立刻降 FREE）
  if (mode === 'refund') {
    try {
      await env.DB
        .prepare(
          `UPDATE user_status SET
             vip_until  = ?,
             updated_at = CAST(strftime('%s','now') AS INTEGER)
           WHERE uid = ?`,
        )
        .bind(now, order.user_uid)
        .run()
    } catch (e) {
      // 不是致命，告警給 admin 手動補
      await notifyAdmin(
        env,
        `🚨 <b>退款 D1 同步部分失敗</b>\n` +
          `orders 已標 refunded，但 user_status 沒更新到\n` +
          `<code>${mtNo}</code>\n` +
          `Error: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  // 6. 通知
  const emoji = mode === 'refund' ? '💸' : '🛑'
  const label = mode === 'refund' ? '退款' : '取消（admin）'
  await notifyAdmin(
    env,
    `${emoji} <b>${label}</b>\n` +
      `📋 <code>${mtNo}</code> (${order.plan}, NT$${order.amount})\n` +
      (order.user_email ? `📧 ${order.user_email}\n` : '') +
      (note ? `📝 ${note}\n` : '') +
      `⏱ ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
  )

  return jsonResponse({
    ok: true,
    merchant_trade_no: mtNo,
    mode,
    status: mode === 'refund' ? 'refunded' : 'cancelled',
  })
}
