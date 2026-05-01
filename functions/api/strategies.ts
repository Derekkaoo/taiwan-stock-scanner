/**
 * Cloudflare Pages Function: /api/strategies
 *
 * 認證：Authorization: Bearer <Google ID Token>
 *
 * GET    /api/strategies            → 列出登入者所有策略
 * POST   /api/strategies            → body: {"name": "...", "filters": {...}} → 新增策略
 * PUT    /api/strategies/:id        → body: {"name"?, "filters"?} → 更新策略
 * DELETE /api/strategies/:id        → 刪除策略
 *
 * 所有 endpoint 都會驗 ID Token 並用 sub claim 當 user_uid。
 *
 * 注意：Pages Functions 的 dynamic route 是用檔名 [id].ts 處理，
 * 但這裡我們把 list/create 跟 update/delete 拆兩個檔案：
 *   - functions/api/strategies.ts        → GET / POST
 *   - functions/api/strategies/[id].ts   → PUT / DELETE
 */

import { authenticateRequest, GoogleIdTokenPayload } from '../_lib/google-auth'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
}

interface StrategyRow {
  id: number
  user_uid: string
  user_email: string | null
  name: string
  filters_json: string
  created_at: number
  updated_at: number
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function rowToStrategy(r: StrategyRow) {
  let filters: unknown = null
  try {
    filters = JSON.parse(r.filters_json)
  } catch {
    filters = null
  }
  return {
    id: r.id,
    name: r.name,
    filters,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
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
    const msg = e instanceof Error ? e.message : 'Auth failed'
    return { error: jsonResponse({ error: msg }, 401) }
  }
}

// CORS preflight
export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// GET：列出該使用者所有策略
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const result = await authOrError(request, env)
  if ('error' in result) return result.error

  const { results } = await env.DB
    .prepare(
      'SELECT id, user_uid, user_email, name, filters_json, created_at, updated_at FROM strategies WHERE user_uid = ? ORDER BY updated_at DESC',
    )
    .bind(result.user.sub)
    .all<StrategyRow>()

  return jsonResponse({
    strategies: results.map(rowToStrategy),
    count: results.length,
  })
}

// POST：新增策略
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const result = await authOrError(request, env)
  if ('error' in result) return result.error
  const user = result.user

  let body: { name?: unknown; filters?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return jsonResponse({ error: 'Invalid name' }, 400)
  }
  if (body.filters === undefined || body.filters === null) {
    return jsonResponse({ error: 'Missing filters' }, 400)
  }
  const name = body.name.trim().slice(0, 100)
  let filtersJson: string
  try {
    filtersJson = JSON.stringify(body.filters)
  } catch {
    return jsonResponse({ error: 'filters not serializable' }, 400)
  }
  if (filtersJson.length > 32 * 1024) {
    return jsonResponse({ error: 'filters too large' }, 400)
  }

  const insertRes = await env.DB
    .prepare(
      'INSERT INTO strategies (user_uid, user_email, name, filters_json) VALUES (?, ?, ?, ?)',
    )
    .bind(user.sub, user.email || null, name, filtersJson)
    .run()

  const newId = insertRes.meta.last_row_id
  const row = await env.DB
    .prepare(
      'SELECT id, user_uid, user_email, name, filters_json, created_at, updated_at FROM strategies WHERE id = ?',
    )
    .bind(newId)
    .first<StrategyRow>()

  if (!row) return jsonResponse({ error: 'Insert succeeded but row not found' }, 500)
  return jsonResponse({ strategy: rowToStrategy(row) }, 201)
}
