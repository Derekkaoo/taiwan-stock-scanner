/**
 * GET /api/internal/cron/expire-pending-orders
 *
 * 把 7 天前還停在 'pending' 的 order 改 'expired'。
 * pending = create-order 建單但 user 沒走完刷卡流程的 dangling。
 *
 * 為什麼要清：
 *   - 不會佔 D1 容量（D1 很大），但讓 admin 看 orders 列表時更乾淨
 *   - 後續 cron / report 看「有幾筆活訂單」時不會被 dangling 干擾
 *
 * Auth: Authorization: Bearer <INTERNAL_CRON_TOKEN>
 *
 * Cron 設定：cron-job.org 每天 03:00 TW 跑一次
 *
 * Response:
 *   { "ok": true, "expired": N }
 */

interface Env {
  DB: D1Database
  INTERNAL_CRON_TOKEN?: string
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

async function handler(request: Request, env: Env) {
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

  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400

  const result = await env.DB
    .prepare(
      `UPDATE orders SET status = 'expired'
       WHERE status = 'pending' AND created_at < ?`,
    )
    .bind(sevenDaysAgo)
    .run()

  return jsonResponse({
    ok: true,
    expired: result.meta?.changes ?? 0,
    cutoff_unix: sevenDaysAgo,
  })
}

// 支援 GET / POST（cron-job.org 慣用 GET，本地 curl 都可）
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) =>
  handler(request, env)

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) =>
  handler(request, env)
