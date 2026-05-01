/**
 * Cloudflare Pages Function: /api/favorites
 *
 * GET    /api/favorites         → 回傳該 user 的所有最愛 stock_id 陣列
 * POST   /api/favorites         → body: {"stock_id": "2330"}，加進最愛
 * DELETE /api/favorites         → body: {"stock_id": "2330"}，從最愛移除
 *
 * 認證：Authorization: Bearer <token>
 *   - 若是 Google ID Token (3-part JWT) → 後端驗簽 → user_token = `google:<sub>` （跨裝置同步）
 *   - 若是 UUID（不含 .）→ user_token = bearer 原值 （裝置綁定，舊版相容）
 */

import { verifyGoogleIdToken } from '../_lib/google-auth'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
}

function getRawToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') || ''
  const match = /^Bearer\s+(\S+)$/i.exec(auth)
  return match ? match[1] : null
}

/**
 * 把 raw bearer 轉成 D1 用的 user_token：
 *   - JWT (有 2 個 .)        → 驗簽成功用 `google:<sub>`，失敗回 null（拒絕）
 *   - 其他（純 UUID/字串）   → 原樣使用（舊裝置綁定流程）
 */
async function resolveUserToken(
  request: Request,
  env: Env,
): Promise<string | null> {
  const raw = getRawToken(request)
  if (!raw) return null
  // JWT 偵測：3 段 base64url 用 . 分隔
  if (raw.split('.').length === 3) {
    if (!env.GOOGLE_CLIENT_ID) return null
    try {
      const payload = await verifyGoogleIdToken(raw, env.GOOGLE_CLIENT_ID)
      return `google:${payload.sub}`
    } catch {
      return null
    }
  }
  // UUID flow（向下相容）
  return raw
}

function isValidStockId(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9A-Z]{2,8}$/.test(s)
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// CORS preflight
export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// GET：列出該使用者所有最愛
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = await resolveUserToken(request, env)
  if (!token) return jsonResponse({ error: 'Missing or invalid token' }, 401)

  const { results } = await env.DB
    .prepare('SELECT stock_id, added_at FROM favorites WHERE user_token = ? ORDER BY added_at DESC')
    .bind(token)
    .all<{ stock_id: string; added_at: number }>()

  return jsonResponse({
    favorites: results.map(r => r.stock_id),
    count: results.length,
  })
}

// POST：加進最愛
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = await resolveUserToken(request, env)
  if (!token) return jsonResponse({ error: 'Missing or invalid token' }, 401)

  let body: { stock_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  if (!isValidStockId(body.stock_id)) {
    return jsonResponse({ error: 'Invalid stock_id' }, 400)
  }

  await env.DB
    .prepare('INSERT OR IGNORE INTO favorites (user_token, stock_id) VALUES (?, ?)')
    .bind(token, body.stock_id)
    .run()

  return jsonResponse({ ok: true, stock_id: body.stock_id })
}

// DELETE：從最愛移除
export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const token = await resolveUserToken(request, env)
  if (!token) return jsonResponse({ error: 'Missing or invalid token' }, 401)

  let body: { stock_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  if (!isValidStockId(body.stock_id)) {
    return jsonResponse({ error: 'Invalid stock_id' }, 400)
  }

  await env.DB
    .prepare('DELETE FROM favorites WHERE user_token = ? AND stock_id = ?')
    .bind(token, body.stock_id)
    .run()

  return jsonResponse({ ok: true, stock_id: body.stock_id })
}
