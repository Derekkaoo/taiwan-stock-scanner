/**
 * Cloudflare Pages Function: /api/strategies
 *
 * Auth: Authorization: Bearer <Google ID Token>
 *
 * GET    /api/strategies           list user strategies
 * POST   /api/strategies           body: {"name", "filters"} -> create
 * PUT    /api/strategies/:id       body: {"name"?, "filters"?} -> update (in [id].ts)
 * DELETE /api/strategies/:id       delete (in [id].ts)
 *
 * All endpoints verify ID Token and use sub claim as user_uid.
 */

import { authenticateRequest, GoogleIdTokenPayload } from '../_lib/google-auth'
import {
  ERROR_LIMIT_EXCEEDED,
  exceedsStrategiesLimit,
  getUserAccess,
} from '../_lib/access'
import { logEvent } from '../_lib/events'
import { notifyAdmin, anonId } from '../_lib/notifyAdmin'
import { formatFilters } from '../_lib/formatFilters'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
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

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

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

  const access = await getUserAccess(user.sub, user.email ?? null, env.DB)
  if (access.limits.strategies !== null) {
    const cntRow = await env.DB
      .prepare('SELECT COUNT(*) AS cnt FROM strategies WHERE user_uid = ?')
      .bind(user.sub)
      .first<{ cnt: number }>()
    const cnt = cntRow?.cnt ?? 0
    if (exceedsStrategiesLimit(access, cnt)) {
      return jsonResponse(
        {
          error: ERROR_LIMIT_EXCEEDED,
          limit: access.limits.strategies,
          type: 'strategies',
          tier: access.tier,
        },
        403,
      )
    }
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

  // 事件追蹤 + admin Telegram 即時推
  const userToken = `google:${user.sub}`
  await logEvent(env.DB, {
    type: 'strategy_saved',
    userToken,
    strategyName: name,
    filtersJson,
  })
  await notifyAdmin(
    env,
    `🎯 <b>新策略儲存</b>\n` +
      `👤 <code>${anonId(userToken)}</code>\n` +
      `📝 ${escapeHtml(name)}\n` +
      `🔧 條件：\n${escapeHtml(formatFilters(filtersJson))}\n` +
      `⏱ ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
  )

  return jsonResponse({ strategy: rowToStrategy(row) }, 201)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
