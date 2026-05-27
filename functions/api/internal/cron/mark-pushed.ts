/**
 * POST /api/internal/cron/mark-pushed
 *
 * Body: { "user_uid": "google:xxx", "status": "ok" | "failed" }
 *
 * 把 telegram_bindings.last_push_at 更新成 now()，外加 last_push_status。
 * push_user_strategies.py 推完每位 user 後呼叫一次，下次別的 trigger 來時就會被 dedup 跳過。
 *
 * Auth: Authorization: Bearer <INTERNAL_CRON_TOKEN>（跟 bound-users 用同一個 secret）
 */

interface Env {
  DB: D1Database
  INTERNAL_CRON_TOKEN?: string
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
  let body: { user_uid?: unknown; status?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }
  if (typeof body.user_uid !== 'string' || !body.user_uid.trim()) {
    return jsonResponse({ error: 'Missing user_uid' }, 400)
  }
  const status =
    typeof body.status === 'string' && body.status.trim() ? body.status.trim().slice(0, 50) : 'ok'

  // 3. 更新 D1
  const now = Math.floor(Date.now() / 1000)
  const result = await env.DB
    .prepare(
      'UPDATE telegram_bindings SET last_push_at = ?, last_push_status = ? WHERE user_uid = ?',
    )
    .bind(now, status, body.user_uid)
    .run()

  if (result.meta.changes === 0) {
    return jsonResponse({ error: 'user_uid not found' }, 404)
  }

  return jsonResponse({ ok: true, user_uid: body.user_uid, last_push_at: now, status })
}
