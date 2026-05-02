/**
 * GET    /api/telegram/binding   查當前 user 的綁定狀態
 * DELETE /api/telegram/binding   解除綁定
 *
 * Auth: Authorization: Bearer <Google ID Token>
 *
 * GET response（已綁定）：
 *   {
 *     bound: true,
 *     username: "derekkk",         // Telegram @username（可能為 null）
 *     first_name: "Derek",          // Telegram first name
 *     bound_at: 1234567890,         // unix seconds
 *     last_push_at: 1234567890,     // unix seconds，可能為 null
 *     last_push_status: "ok"|"fail" // 可能為 null
 *   }
 *
 * GET response（未綁定）：
 *   { bound: false }
 *
 * DELETE response：
 *   { deleted: true }
 */

import { authenticateRequest, GoogleIdTokenPayload } from '../../_lib/google-auth'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
}

interface BindingRow {
  user_uid: string
  user_email: string | null
  chat_id: string
  username: string | null
  first_name: string | null
  bound_at: number
  last_push_at: number | null
  last_push_status: string | null
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

async function authOrError(
  request: Request,
  env: Env,
): Promise<{ user: GoogleIdTokenPayload } | { error: Response }> {
  if (!env.GOOGLE_CLIENT_ID) {
    return { error: jsonResponse({ error: 'Server missing GOOGLE_CLIENT_ID' }, 500) }
  }
  try {
    const user = await authenticateRequest(request, env.GOOGLE_CLIENT_ID)
    return { user }
  } catch (e) {
    return { error: jsonResponse({ error: e instanceof Error ? e.message : 'Auth failed' }, 401) }
  }
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await authOrError(request, env)
  if ('error' in auth) return auth.error

  const row = await env.DB
    .prepare(
      'SELECT user_uid, user_email, chat_id, username, first_name, bound_at, last_push_at, last_push_status FROM telegram_bindings WHERE user_uid = ?',
    )
    .bind(auth.user.sub)
    .first<BindingRow>()

  if (!row) {
    return jsonResponse({ bound: false })
  }

  return jsonResponse({
    bound: true,
    username: row.username,
    first_name: row.first_name,
    bound_at: row.bound_at,
    last_push_at: row.last_push_at,
    last_push_status: row.last_push_status,
  })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await authOrError(request, env)
  if ('error' in auth) return auth.error

  await env.DB
    .prepare('DELETE FROM telegram_bindings WHERE user_uid = ?')
    .bind(auth.user.sub)
    .run()

  // 順便清掉這個 user 還沒用的 bind code
  await env.DB
    .prepare('DELETE FROM telegram_bind_codes WHERE user_uid = ?')
    .bind(auth.user.sub)
    .run()

  return jsonResponse({ deleted: true })
}
