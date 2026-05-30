/**
 * GET /api/payment/orders
 *
 * 列出登入 user 自己的所有訂單（給 UI / 取消按鈕用）。
 *
 * Auth: Authorization: Bearer <Google ID Token>
 *
 * Response:
 *   {
 *     "orders": [
 *       {
 *         "merchant_trade_no": "TS260530224715AUDZ",
 *         "plan": "monthly",
 *         "amount": 88,
 *         "status": "paid",
 *         "created_at": 1780152525,
 *         "paid_at": 1780152525,
 *         "cancelled_at": null,
 *         "refunded_at": null,
 *         "card4no": "2222",
 *         "total_success_times": 1
 *       }
 *     ],
 *     "count": 1
 *   }
 */

import { authenticateRequest } from '../../_lib/google-auth'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
}

interface OrderRow {
  merchant_trade_no: string
  plan: string
  amount: number
  status: string
  created_at: number
  paid_at: number | null
  cancelled_at: number | null
  refunded_at: number | null
  card4no: string | null
  total_success_times: number
  period_type: string
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

  const { results } = await env.DB
    .prepare(
      `SELECT merchant_trade_no, plan, amount, status, period_type,
              created_at, paid_at, cancelled_at, refunded_at, card4no,
              total_success_times
       FROM orders WHERE user_uid = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .bind(user.sub)
    .all<OrderRow>()

  return jsonResponse({ orders: results || [], count: (results || []).length })
}
