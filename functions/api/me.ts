/**
 * GET /api/me
 *
 * 回登入 user 的 tier + VIP 狀態 + 當前訂閱訂單。
 * 給 frontend SettingsPanel / VipPanel 用，決定要顯示哪個版本的 UI。
 *
 * Auth: Authorization: Bearer <Google ID Token>
 *
 * Response:
 *   {
 *     "uid": "...",
 *     "email": "...",
 *     "name": "...",
 *     "tier": "FREE" | "FRIEND" | "TRIAL" | "VIP",
 *     "vipUntil": 1782744525 | null,
 *     "trialUntil": null,
 *     "canPush": true,
 *     "activeOrder": {
 *       "merchant_trade_no": "TS...",
 *       "plan": "monthly" | "yearly",
 *       "amount": 88,
 *       "status": "paid",
 *       "paid_at": 1780152525,
 *       "card4no": "2222"
 *     } | null   // null = 沒活躍訂閱（譬如取消過、退款過、或從沒訂過）
 *   }
 */

import { authenticateRequest } from '../_lib/google-auth'
import { getUserAccess } from '../_lib/access'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
}

interface ActiveOrderRow {
  merchant_trade_no: string
  plan: string
  amount: number
  status: string
  paid_at: number | null
  card4no: string | null
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GOOGLE_CLIENT_ID) {
    return jsonResponse({ error: 'Server missing GOOGLE_CLIENT_ID' }, 500)
  }
  let user
  try {
    user = await authenticateRequest(request, env.GOOGLE_CLIENT_ID)
  } catch (e) {
    return jsonResponse(
      { error: e instanceof Error ? e.message : 'Auth failed' },
      401,
    )
  }

  // 1. 取 tier（包含 INTERNAL_VIP / FRIEND hardcode + D1 user_status）
  const access = await getUserAccess(user.sub, user.email ?? null, env.DB)

  // 2. 撈活躍訂閱（status='paid' 且 cancelled_at IS NULL）
  //    如果有複數筆 paid（理論上不會發生，但保險），取最新一筆
  const activeOrder = await env.DB
    .prepare(
      `SELECT merchant_trade_no, plan, amount, status, paid_at, card4no
       FROM orders
       WHERE user_uid = ? AND status = 'paid'
       ORDER BY paid_at DESC LIMIT 1`,
    )
    .bind(user.sub)
    .first<ActiveOrderRow>()

  return jsonResponse({
    uid: user.sub,
    email: user.email ?? null,
    name: user.name ?? null,
    tier: access.tier,
    vipUntil: access.vipUntil,
    trialUntil: access.trialUntil,
    canPush: access.canPush,
    activeOrder: activeOrder || null,
  })
}
