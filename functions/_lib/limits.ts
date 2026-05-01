/**
 * 各功能上限 + 白名單機制
 *
 * 設計：
 *   - 一般使用者套用 LIMITS 內的數量上限
 *   - 白名單 email 直接繞過所有上限（不必等 VIP 上線）
 *   - 白名單只在後端檢查，前端永遠不該知道誰在白名單
 *
 * 之後若要做 VIP 訂閱：
 *   - 增加 isVip(email) 函式（讀 D1 vip 表 / Stripe webhook 同步）
 *   - bypass 邏輯：isVip(email) || isWhitelisted(email)
 */

export const LIMITS = {
  FAVORITES: 10,
  STRATEGIES: 5,
} as const

export const ERROR_LIMIT_EXCEEDED = 'limit_exceeded'

/**
 * 白名單 email（小寫比對，繞過所有上限）。
 * 之後可改讀環境變數 / KV / D1 表，現階段先 hardcode。
 */
const WHITELIST_EMAILS = new Set<string>([
  'stiau334@gmail.com',
])

export function isWhitelisted(email: string | null | undefined): boolean {
  if (!email) return false
  return WHITELIST_EMAILS.has(email.toLowerCase())
}
