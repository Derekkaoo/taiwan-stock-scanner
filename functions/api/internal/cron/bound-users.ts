/**
 * GET /api/internal/cron/bound-users
 *
 * 給雲端 cron（GitHub Actions / cron-job.org）撈「所有已綁 Telegram 的使用者
 * + 各自的篩選策略」用，本地 push_user_strategies.py 也可呼叫此端點。
 *
 * Auth: Authorization: Bearer <INTERNAL_CRON_TOKEN>
 *   - INTERNAL_CRON_TOKEN 是 Cloudflare Pages env secret
 *   - 跟 Google ID Token 完全分離（不需要 user 登入）
 *
 * Response:
 *   {
 *     "users": [
 *       {
 *         "user_uid":  "...",
 *         "user_email":"derek@example.com",
 *         "chat_id":   "1234567890",
 *         "strategies": [
 *           { "id": 1, "name": "多頭強勢-50%", "filters": {...} },
 *           ...
 *         ]
 *       }
 *     ],
 *     "count": N
 *   }
 *
 * 設計：
 *   - 一次 SQL JOIN 撈完，避免 N+1
 *   - 沒有任何策略的綁定使用者也會回傳（strategies: []），由 caller 決定要不要跳過
 *   - filters_json 解析失敗 → 跳過該策略（不擋整個 user）
 */

interface Env {
  DB: D1Database
  INTERNAL_CRON_TOKEN?: string
}

interface JoinRow {
  user_uid: string
  user_email: string | null
  chat_id: string
  strategy_id: number | null
  strategy_name: string | null
  filters_json: string | null
}

interface UserPayload {
  user_uid: string
  user_email: string | null
  chat_id: string
  strategies: Array<{
    id: number
    name: string
    filters: unknown
  }>
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

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // 1. 驗 INTERNAL_CRON_TOKEN
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

  // 2. JOIN 撈
  const rows = await env.DB
    .prepare(
      `SELECT b.user_uid, b.user_email, b.chat_id,
              s.id AS strategy_id, s.name AS strategy_name, s.filters_json
       FROM telegram_bindings b
       LEFT JOIN strategies s ON s.user_uid = b.user_uid
       ORDER BY b.user_uid, s.id`,
    )
    .all<JoinRow>()

  // 3. 聚合 by user_uid
  const byUser = new Map<string, UserPayload>()
  for (const r of (rows.results || [])) {
    let user = byUser.get(r.user_uid)
    if (!user) {
      user = {
        user_uid: r.user_uid,
        user_email: r.user_email,
        chat_id: String(r.chat_id),
        strategies: [],
      }
      byUser.set(r.user_uid, user)
    }
    if (r.strategy_id !== null) {
      let filters: unknown = {}
      try {
        filters = JSON.parse(r.filters_json || '{}')
      } catch {
        // skip 解析不了的策略
        continue
      }
      user.strategies.push({
        id: r.strategy_id,
        name: r.strategy_name || `策略#${r.strategy_id}`,
        filters,
      })
    }
  }

  const users = Array.from(byUser.values())
  return jsonResponse({ users, count: users.length })
}
