/**
 * 事件追蹤 — 把 user 操作寫進 D1 events 表
 *
 * 隱私：
 *   - 只存 user_token（無法反推 email），不存任何 PII
 *   - 給 admin 之後 SQL aggregate query 用
 *
 * 用法：
 *   import { logEvent } from '../_lib/events'
 *   await logEvent(env.DB, {
 *     type: 'favorite_added',
 *     userToken: ctx.token,
 *     stockId: body.stock_id,
 *   })
 */

export type EventType =
  | 'favorite_added'
  | 'favorite_removed'
  | 'strategy_saved'
  | 'strategy_updated'
  | 'strategy_renamed'
  | 'strategy_deleted'

interface LogPayload {
  type: EventType
  userToken: string
  stockId?: string
  strategyName?: string
  filtersJson?: string
}

export async function logEvent(db: D1Database, p: LogPayload): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO events (event_type, user_token, stock_id, strategy_name, filters_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        p.type,
        p.userToken,
        p.stockId ?? null,
        p.strategyName ?? null,
        p.filtersJson ?? null,
      )
      .run()
  } catch (e) {
    // 失敗時不影響主流程，只 log
    console.warn(
      `[logEvent] failed type=${p.type}: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}
