/**
 * Cloudflare Pages Function: /api/favorites
 *
 * GET    /api/favorites
 * POST   /api/favorites    body: {"stock_id": "2330"}
 * DELETE /api/favorites    body: {"stock_id": "2330"}
 *
 * Auth: Authorization: Bearer <token>
 *   - Google ID Token (3-part JWT) -> verify -> user_token = google:<sub>
 *   - UUID (no dot)                -> user_token = bearer raw (legacy device-bound)
 */

import { verifyGoogleIdToken } from '../_lib/google-auth'
import {
  ERROR_LIMIT_EXCEEDED,
  exceedsFavoritesLimit,
  getUserAccess,
} from '../_lib/access'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
}

interface UserContext {
  /** D1 user_token: google:<sub> or raw uuid */
  token: string
  /** Google email (whitelist matching), undefined for UUID user */
  email?: string
  /** Google sub (D1 user_status PK), undefined for UUID user */
  sub?: string
}

function getRawToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') || ''
  const match = /^Bearer\s+(\S+)$/i.exec(auth)
  return match ? match[1] : null
}

async function resolveUserContext(
  request: Request,
  env: Env,
): Promise<UserContext | null> {
  const raw = getRawToken(request)
  if (!raw) return null
  if (raw.split('.').length === 3) {
    if (!env.GOOGLE_CLIENT_ID) return null
    try {
      const payload = await verifyGoogleIdToken(raw, env.GOOGLE_CLIENT_ID)
      return {
        token: `google:${payload.sub}`,
        email: payload.email,
        sub: payload.sub,
      }
    } catch {
      return null
    }
  }
  return { token: raw }
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

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const ctx = await resolveUserContext(request, env)
  if (!ctx) return jsonResponse({ error: 'Missing or invalid token' }, 401)

  const { results } = await env.DB
    .prepare('SELECT stock_id, added_at FROM favorites WHERE user_token = ? ORDER BY added_at DESC')
    .bind(ctx.token)
    .all<{ stock_id: string; added_at: number }>()

  return jsonResponse({
    favorites: results.map(r => r.stock_id),
    count: results.length,
  })
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const ctx = await resolveUserContext(request, env)
  if (!ctx) return jsonResponse({ error: 'Missing or invalid token' }, 401)

  let body: { stock_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  if (!isValidStockId(body.stock_id)) {
    return jsonResponse({ error: 'Invalid stock_id' }, 400)
  }

  const access = await getUserAccess(ctx.sub ?? null, ctx.email ?? null, env.DB)
  if (access.limits.favorites !== null) {
    const exists = await env.DB
      .prepare('SELECT 1 AS found FROM favorites WHERE user_token = ? AND stock_id = ? LIMIT 1')
      .bind(ctx.token, body.stock_id)
      .first<{ found: number }>()
    if (!exists) {
      const cntRow = await env.DB
        .prepare('SELECT COUNT(*) AS cnt FROM favorites WHERE user_token = ?')
        .bind(ctx.token)
        .first<{ cnt: number }>()
      const cnt = cntRow?.cnt ?? 0
      if (exceedsFavoritesLimit(access, cnt)) {
        return jsonResponse(
          {
            error: ERROR_LIMIT_EXCEEDED,
            limit: access.limits.favorites,
            type: 'favorites',
            tier: access.tier,
          },
          403,
        )
      }
    }
  }

  await env.DB
    .prepare('INSERT OR IGNORE INTO favorites (user_token, stock_id) VALUES (?, ?)')
    .bind(ctx.token, body.stock_id)
    .run()

  return jsonResponse({ ok: true, stock_id: body.stock_id })
}

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const ctx = await resolveUserContext(request, env)
  if (!ctx) return jsonResponse({ error: 'Missing or invalid token' }, 401)

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
    .bind(ctx.token, body.stock_id)
    .run()

  return jsonResponse({ ok: true, stock_id: body.stock_id })
}
