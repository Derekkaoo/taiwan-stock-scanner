/**
 * Cloudflare Pages Function: /api/strategies/:id
 *
 * PUT    /api/strategies/:id   → body: {"name"?, "filters"?} → 更新策略
 * DELETE /api/strategies/:id   → 刪除策略
 *
 * 認證：Authorization: Bearer <Google ID Token>
 */

import { authenticateRequest, GoogleIdTokenPayload } from '../../_lib/google-auth'
import { logEvent } from '../../_lib/events'
import { notifyAdmin, anonId } from '../../_lib/notifyAdmin'
import { formatFilters } from '../../_lib/formatFilters'

interface Env {
  DB: D1Database
  GOOGLE_CLIENT_ID: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

function parseId(idStr: string | undefined): number | null {
  if (!idStr) return null
  const id = Number(idStr)
  if (!Number.isInteger(id) || id <= 0) return null
  return id
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

// PUT：更新策略
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await authOrError(request, env)
  if ('error' in result) return result.error
  const user = result.user

  const id = parseId(params.id as string | undefined)
  if (id === null) return jsonResponse({ error: 'Invalid id' }, 400)

  let body: { name?: unknown; filters?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  // 確認該策略存在且屬於該 user（順便撈舊 name 給 rename detection 用）
  const existing = await env.DB
    .prepare('SELECT id, name FROM strategies WHERE id = ? AND user_uid = ?')
    .bind(id, user.sub)
    .first<{ id: number; name: string }>()
  if (!existing) return jsonResponse({ error: 'Not found' }, 404)

  // 組 update 子句
  const sets: string[] = []
  const binds: unknown[] = []

  let newName: string | undefined
  let newFiltersJson: string | undefined

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return jsonResponse({ error: 'Invalid name' }, 400)
    }
    newName = body.name.trim().slice(0, 100)
    sets.push('name = ?')
    binds.push(newName)
  }

  if (body.filters !== undefined) {
    let filtersJson: string
    try {
      filtersJson = JSON.stringify(body.filters)
    } catch {
      return jsonResponse({ error: 'filters not serializable' }, 400)
    }
    if (filtersJson.length > 32 * 1024) {
      return jsonResponse({ error: 'filters too large' }, 400)
    }
    newFiltersJson = filtersJson
    sets.push('filters_json = ?')
    binds.push(filtersJson)
  }

  if (sets.length === 0) {
    return jsonResponse({ error: 'No fields to update' }, 400)
  }

  sets.push("updated_at = CAST(strftime('%s', 'now') AS INTEGER)")
  binds.push(id, user.sub)

  await env.DB
    .prepare(`UPDATE strategies SET ${sets.join(', ')} WHERE id = ? AND user_uid = ?`)
    .bind(...binds)
    .run()

  // 事件追蹤 + admin Telegram 即時推
  const userToken = `google:${user.sub}`
  const isRename = newName && newName !== existing.name && !newFiltersJson
  const eventType = isRename ? 'strategy_renamed' : 'strategy_updated'
  await logEvent(env.DB, {
    type: eventType,
    userToken,
    strategyName: newName ?? existing.name,
    filtersJson: newFiltersJson,
  })
  await notifyAdmin(
    env,
    `${isRename ? '✏️ <b>策略改名</b>' : '🔄 <b>策略更新</b>'}\n` +
      `👤 <code>${anonId(userToken)}</code>\n` +
      (isRename
        ? `📝 <s>${escapeHtml(existing.name)}</s> → ${escapeHtml(newName ?? '')}\n`
        : `📝 ${escapeHtml(newName ?? existing.name)}\n`) +
      (newFiltersJson
        ? `🔧 條件：\n${escapeHtml(formatFilters(newFiltersJson))}\n`
        : '') +
      `⏱ ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
  )

  return jsonResponse({ ok: true, id })
}

// DELETE：刪除策略
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const result = await authOrError(request, env)
  if ('error' in result) return result.error
  const user = result.user

  const id = parseId(params.id as string | undefined)
  if (id === null) return jsonResponse({ error: 'Invalid id' }, 400)

  // 先撈名稱給通知用
  const existing = await env.DB
    .prepare('SELECT name FROM strategies WHERE id = ? AND user_uid = ?')
    .bind(id, user.sub)
    .first<{ name: string }>()

  const res = await env.DB
    .prepare('DELETE FROM strategies WHERE id = ? AND user_uid = ?')
    .bind(id, user.sub)
    .run()

  if (res.meta.changes === 0) {
    return jsonResponse({ error: 'Not found' }, 404)
  }

  // 事件追蹤 + admin Telegram 即時推
  const userToken = `google:${user.sub}`
  await logEvent(env.DB, {
    type: 'strategy_deleted',
    userToken,
    strategyName: existing?.name,
  })
  await notifyAdmin(
    env,
    `🗑 <b>策略刪除</b>\n` +
      `👤 <code>${anonId(userToken)}</code>\n` +
      `📝 ${escapeHtml(existing?.name ?? `id=${id}`)}\n` +
      `⏱ ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
  )

  return jsonResponse({ ok: true, id })
}
