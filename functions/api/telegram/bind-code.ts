/**
 * POST /api/telegram/bind-code
 *
 * 產生一個 6 位英數字綁定 code 給已登入使用者，10 分鐘過期。
 * Telegram bot 那邊 webhook 收到 /bind <code> 會驗證 + 寫 telegram_bindings。
 *
 * Auth: Authorization: Bearer <Google ID Token>
 *
 * Response:
 *   { code: "ABC123", expires_at: 1234567890123, bot_username: "derek_taiwanstock_bot" }
 */

import { authenticateRequest } from '../../_lib/google-auth'
import { generateBindCode } from '../../_lib/telegram'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
  TELEGRAM_BOT_USERNAME: string
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

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.GOOGLE_CLIENT_ID) {
    return jsonResponse({ error: 'Server missing GOOGLE_CLIENT_ID' }, 500)
  }
  let user
  try {
    user = await authenticateRequest(request, env.GOOGLE_CLIENT_ID)
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'Auth failed' }, 401)
  }

  // 清掉這個 user 之前還沒用過的 code（一次只能存在一組未過期 code）
  await env.DB
    .prepare('DELETE FROM telegram_bind_codes WHERE user_uid = ?')
    .bind(user.sub)
    .run()

  // 順便清掉所有已過期 code（避免表越長越大）
  const nowMs = Date.now()
  await env.DB
    .prepare('DELETE FROM telegram_bind_codes WHERE expires_at < ?')
    .bind(nowMs)
    .run()

  // 產生新 code（極小機率撞，重試一次就好）
  let code = generateBindCode()
  const expiresAt = nowMs + 10 * 60 * 1000 // 10 min

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await env.DB
        .prepare(
          'INSERT INTO telegram_bind_codes (code, user_uid, user_email, expires_at) VALUES (?, ?, ?, ?)',
        )
        .bind(code, user.sub, user.email ?? null, expiresAt)
        .run()
      break
    } catch (e) {
      // UNIQUE conflict（PRIMARY KEY 撞了）→ 換一組
      if (attempt === 2) {
        return jsonResponse({ error: 'Failed to generate unique code' }, 500)
      }
      code = generateBindCode()
    }
  }

  return jsonResponse({
    code,
    expires_at: expiresAt,
    bot_username: env.TELEGRAM_BOT_USERNAME || 'derek_taiwanstock_bot',
  })
}
