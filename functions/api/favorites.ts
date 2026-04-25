/**
 * Cloudflare Pages Function: /api/favorites
 *
 * GET    /api/favorites         → 回傳該 token 的所有最愛 stock_id 陣列
 * POST   /api/favorites         → body: {"stock_id": "2330"}，加進最愛
 * DELETE /api/favorites         → body: {"stock_id": "2330"}，從最愛移除
 *
 * 認證：Authorization: Bearer <token>
 *   token 是前端 localStorage 持有的 UUID，第一次訪問時前端自己生成
 *   server 不驗證 token 合不合法（任何 UUID 都能用），純粹當「身份識別」
 *   多人版時 token 即用戶 ID
 */

interface Env {
  DB: D1Database
}

function getToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') || ''
  const match = /^Bearer\s+(\S+)$/i.exec(auth)
  return match ? match[1] : null
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
  const token = getToken(request)
  if (\!token) return jsonResponse({ error: 'Missing token' }, 401)

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
  const token = getToken(request)
  if (\!token) return jsonResponse({ error: 'Missing token' }, 401)

  let body: { stock_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  if (\!isValidStockId(body.stock_id)) {
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
  const token = getToken(request)
  if (\!token) return jsonResponse({ error: 'Missing token' }, 401)

  let body: { stock_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  if (\!isValidStockId(body.stock_id)) {
    return jsonResponse({ error: 'Invalid stock_id' }, 400)
  }

  await env.DB
    .prepare('DELETE FROM favorites WHERE user_token = ? AND stock_id = ?')
    .bind(token, body.stock_id)
    .run()

  return jsonResponse({ ok: true, stock_id: body.stock_id })
}
