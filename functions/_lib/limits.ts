/**
 * @deprecated 已遷移到 _lib/access.ts（多 tier 系統）。
 *
 * 這個檔案保留是為了向後相容（避免遺漏的 import 爆掉），
 * 之後確認沒人引用後可整個刪除。
 *
 * 新 code 一律用 _lib/access.ts：
 *   import { getUserAccess, exceedsFavoritesLimit, ... } from '../_lib/access'
 */

export { LIMITS, ERROR_LIMIT_EXCEEDED } from './access'

/**
 * @deprecated 用 getUserAccess(uid, email, db) 取代。
 * 老的「白名單繞過」語意 = 開發者 hardcode 為 INTERNAL_VIP / FRIEND tier。
 */
export function isWhitelisted(_email: string | null | undefined): boolean {
  // 不再使用：完全交給 getUserAccess() 判斷
  return false
}
