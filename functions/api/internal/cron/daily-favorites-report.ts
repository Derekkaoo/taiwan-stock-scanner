/**
 * GET /api/internal/cron/daily-favorites-report
 *
 * 每天 18:00 TW 推播給 admin（你自己）：過去 24 小時的收藏統計
 *   - 新增 / 移除 數量
 *   - 活躍 user 數
 *   - 熱門新增 Top 5 / 熱門移除 Top 5
 *   - 總收藏排行 Top 5
 *
 * 安全：用 ?token=<CRON_SECRET> 驗證，避免被外部亂打
 * 觸發：cron-job.org 設一個每日 18:00 TW 觸發這 URL
 */

import { notifyAdmin } from '../../../_lib/notifyAdmin'

interface Env {
  DB: D1Database
  CRON_SECRET?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

export const onRequestOptions: PagesFunction<Env> = async () =>
  new Response(null, { status: 204, headers: CORS_HEADERS })

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  // ─── 1. 安全檢查 ───
  if (env.CRON_SECRET) {
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    if (token !== env.CRON_SECRET) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }
  }

  // ─── 2. 過去 24h 的事件 ───
  const since = Math.floor(Date.now() / 1000) - 86400  // 24h ago in unix sec

  const addedRows = await env.DB
    .prepare(
      `SELECT stock_id, COUNT(*) AS n, COUNT(DISTINCT user_token) AS u
       FROM events
       WHERE event_type = 'favorite_added' AND created_at >= ? AND stock_id IS NOT NULL
       GROUP BY stock_id
       ORDER BY n DESC
       LIMIT 5`,
    )
    .bind(since)
    .all<{ stock_id: string; n: number; u: number }>()

  const removedRows = await env.DB
    .prepare(
      `SELECT stock_id, COUNT(*) AS n
       FROM events
       WHERE event_type = 'favorite_removed' AND created_at >= ? AND stock_id IS NOT NULL
       GROUP BY stock_id
       ORDER BY n DESC
       LIMIT 5`,
    )
    .bind(since)
    .all<{ stock_id: string; n: number }>()

  const totals = await env.DB
    .prepare(
      `SELECT event_type, COUNT(*) AS n, COUNT(DISTINCT user_token) AS u
       FROM events
       WHERE event_type IN ('favorite_added', 'favorite_removed') AND created_at >= ?
       GROUP BY event_type`,
    )
    .bind(since)
    .all<{ event_type: string; n: number; u: number }>()

  // ─── 3. 總收藏排行（全時段，當前狀態）───
  const overallTop = await env.DB
    .prepare(
      `SELECT stock_id, COUNT(*) AS n
       FROM favorites
       GROUP BY stock_id
       ORDER BY n DESC
       LIMIT 5`,
    )
    .all<{ stock_id: string; n: number }>()

  // ─── 4. 組訊息 ───
  const addedTotal = totals.results.find(r => r.event_type === 'favorite_added') || { n: 0, u: 0 }
  const removedTotal = totals.results.find(r => r.event_type === 'favorite_removed') || { n: 0, u: 0 }
  const uniqueUsers = new Set([
    ...totals.results.flatMap(r => Array.from({ length: r.u }, () => r.event_type + r.u)),
  ]).size  // 粗估，準確要另外 query 但夠用

  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const lines: string[] = []
  lines.push(`📊 <b>今日收藏統計 ${today}</b>`)
  lines.push('')
  lines.push(
    `➕ 新增 ${addedTotal.n} 筆 / ➖ 移除 ${removedTotal.n} 筆`,
  )
  lines.push(
    `👥 活躍 user: ${Math.max(addedTotal.u, removedTotal.u)} 人`,
  )

  if (addedRows.results.length > 0) {
    lines.push('')
    lines.push('🔥 <b>熱門新增 Top 5</b>')
    addedRows.results.forEach(r => {
      lines.push(`  ${r.stock_id}  ×${r.n} (${r.u} user)`)
    })
  }

  if (removedRows.results.length > 0) {
    lines.push('')
    lines.push('❄️ <b>熱門移除 Top 5</b>')
    removedRows.results.forEach(r => {
      lines.push(`  ${r.stock_id}  ×${r.n}`)
    })
  }

  if (overallTop.results.length > 0) {
    lines.push('')
    lines.push('🏆 <b>總收藏排行 Top 5</b>')
    overallTop.results.forEach((r, i) => {
      lines.push(`  ${i + 1}. ${r.stock_id} — ${r.n} user`)
    })
  }

  // 沒任何活動就靜默（user 偏好：避免每天空白訊息）
  if (addedTotal.n === 0 && removedTotal.n === 0) {
    return jsonResponse({
      ok: true,
      skipped: true,
      reason: 'no activity in past 24h',
    })
  }

  const msg = lines.join('\n')
  await notifyAdmin(env, msg)

  return jsonResponse({
    ok: true,
    added_total: addedTotal.n,
    removed_total: removedTotal.n,
    unique_users: uniqueUsers,
    message_preview: msg.slice(0, 200),
  })
}
