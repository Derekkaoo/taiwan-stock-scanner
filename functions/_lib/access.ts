/**
 * 使用者 tier / access 控制（取代 _lib/limits.ts）
 *
 * 設計：
 *   - 四個 tier：FREE / FRIEND / TRIAL / VIP
 *   - tier 來源：
 *       1. FRIEND_EMAILS hardcode（朋友白名單，永久不過期）
 *       2. D1 user_status 表（VIP / TRIAL）
 *       3. 都沒命中 → FREE（lazy：不會自動寫一筆 row 進 user_status）
 *   - 每個 tier 對應一組 limits + canPush
 *
 * 為什麼不寫 admin UI / 不在登入時自動寫入：
 *   - 99% user 永遠是 FREE，寫進去 D1 沒意義
 *   - 朋友白名單目前才幾個 → hardcode 改 5 行 + push 就更新（Cloudflare Pages 5 min deploy）
 *   - 等 user 多了再做 admin UI 遷移到純 D1 模式
 */

export type Tier = 'FREE' | 'FRIEND' | 'TRIAL' | 'VIP'

export interface AccessLimits {
  /** 收藏上限。null = 無上限 */
  favorites: number | null
  /** 篩選策略上限。null = 無上限 */
  strategies: number | null
}

export interface UserAccess {
  tier: Tier
  limits: AccessLimits
  canPush: boolean
  /** TRIAL 結束時間 (unix epoch sec)；非 TRIAL 時為 null */
  trialUntil: number | null
  /** VIP 訂閱到期時間 (unix epoch sec)；非 VIP 時為 null */
  vipUntil: number | null
}

export const ERROR_LIMIT_EXCEEDED = 'limit_exceeded'

/**
 * Tier 對應的 limits + push 權限（單一真相來源）
 */
const TIER_CAPABILITIES: Record<Tier, Omit<UserAccess, 'tier' | 'trialUntil' | 'vipUntil'>> = {
  FREE: {
    // 2026-05-23 不限期試用：跟 TRIAL 一樣（無限收藏 + 無限策略 + 推播）
    //
    // ─── 金流上線 SOP（祖父條款方案 Y）───
    // 等綠界 ECPay 過件 + VIP 訂閱功能上線後，這裡改回：
    //   limits: { favorites: 10, strategies: 5 },
    //   canPush: false,
    // 改完後：
    //   - 既有 user 的策略/最愛資料**全部保留**（D1 不動）
    //   - 但 API 會擋新增超過 10/5（exceedsFavoritesLimit / exceedsStrategiesLimit 自動生效）
    //   - 推播 cron 會跳過 FREE user（push_user_strategies.py 要加 tier 判斷）
    //   - 推 Telegram 通知所有已綁定的 user：「金流已上線，可升級 VIP 解鎖無限新增 + 推播」
    //   - SHOW_VIP_UI 維持 true
    limits: { favorites: null, strategies: null },
    canPush: true,
  },
  FRIEND: {
    limits: { favorites: null, strategies: null },
    canPush: false, // 朋友：解上限但不解推播
  },
  TRIAL: {
    limits: { favorites: null, strategies: null },
    canPush: true, // 試用期：完整體驗
  },
  VIP: {
    limits: { favorites: null, strategies: null },
    canPush: true,
  },
}

/**
 * 朋友白名單（小寫比對）。
 * 加朋友 = 改這個陣列 → commit → push → Pages 自動 deploy。
 */
const FRIEND_EMAILS = new Set<string>([
  // 開發者本人列為朋友（不再是白名單繞過，而是正規 FRIEND tier）
  // Note: 開發者 hardcode 在這裡會被視為 FRIEND；若要拿到 push 必須升 VIP / TRIAL
  // 'stiau334@gmail.com',  // ← 開發者已是 D1 row 或想自動拿 VIP 的話另外處理
])

/**
 * 開發者 / 內部 email：自動視為 VIP（包含 push）。
 * 用來方便自己測試完整功能（含推播），不必每次到 D1 改 row。
 */
const INTERNAL_VIP_EMAILS = new Set<string>([
  'stiau334@gmail.com',
])

interface UserStatusRow {
  uid: string
  email: string | null
  tier: Tier
  vip_until: number | null
  trial_until: number | null
}

/**
 * 解析 D1 row → effective tier（處理 VIP/TRIAL 過期）
 */
function rowToEffectiveTier(row: UserStatusRow | null, now: number): {
  tier: Tier | null
  vipUntil: number | null
  trialUntil: number | null
} {
  if (!row) return { tier: null, vipUntil: null, trialUntil: null }

  // VIP 還沒過期 → VIP
  if (row.tier === 'VIP' && (row.vip_until === null || row.vip_until > now)) {
    return { tier: 'VIP', vipUntil: row.vip_until, trialUntil: row.trial_until }
  }
  // TRIAL 還沒過期 → TRIAL
  if (row.tier === 'TRIAL' && row.trial_until !== null && row.trial_until > now) {
    return { tier: 'TRIAL', vipUntil: null, trialUntil: row.trial_until }
  }
  // FRIEND 永久（D1 設過 FRIEND 也認，相容未來 admin UI）
  if (row.tier === 'FRIEND') {
    return { tier: 'FRIEND', vipUntil: null, trialUntil: null }
  }
  // 其他（FREE / 已過期）→ 視為沒命中
  return { tier: null, vipUntil: null, trialUntil: null }
}

/**
 * 取得 user 的 access（tier + limits + push 權限）。
 *
 * 查找順序：
 *   1. INTERNAL_VIP_EMAILS（開發者自己）→ VIP
 *   2. D1 user_status（有 row 且未過期）→ row.tier
 *   3. FRIEND_EMAILS hardcode → FRIEND
 *   4. fallback → FREE
 *
 * @param uid   Google sub（D1 主鍵）
 * @param email Google email（白名單 / VIP hardcode 比對用），可選
 * @param db    D1 binding；傳 null 則跳過 D1 查詢（純做 hardcode 判斷，e.g. 收藏 endpoint 不想多打 D1）
 */
export async function getUserAccess(
  uid: string | null,
  email: string | null | undefined,
  db: D1Database | null,
): Promise<UserAccess> {
  const lowerEmail = email?.toLowerCase() ?? null
  const now = Math.floor(Date.now() / 1000)

  // 1. 內部 VIP（開發者）
  if (lowerEmail && INTERNAL_VIP_EMAILS.has(lowerEmail)) {
    return buildAccess('VIP', null, null)
  }

  // 2. D1 user_status
  if (uid && db) {
    try {
      const row = await db
        .prepare(
          'SELECT uid, email, tier, vip_until, trial_until FROM user_status WHERE uid = ? LIMIT 1',
        )
        .bind(uid)
        .first<UserStatusRow>()
      const { tier, vipUntil, trialUntil } = rowToEffectiveTier(row ?? null, now)
      if (tier) return buildAccess(tier, vipUntil, trialUntil)
    } catch {
      // user_status 表還沒 migrate / D1 查詢失敗 → 走後續 fallback
    }
  }

  // 3. FRIEND hardcode
  if (lowerEmail && FRIEND_EMAILS.has(lowerEmail)) {
    return buildAccess('FRIEND', null, null)
  }

  // 4. FREE
  return buildAccess('FREE', null, null)
}

function buildAccess(tier: Tier, vipUntil: number | null, trialUntil: number | null): UserAccess {
  const cap = TIER_CAPABILITIES[tier]
  return {
    tier,
    limits: { ...cap.limits },
    canPush: cap.canPush,
    vipUntil,
    trialUntil,
  }
}

/**
 * 同步版本的 quick check（不查 D1，只看 hardcode）。
 *
 * 用途：endpoint 想避免額外 D1 查詢時的 fast-path。但拿不到 D1 設定的 VIP/TRIAL，
 * 所以只在「不查 D1 也能通過上限檢查」（FRIEND/INTERNAL_VIP）時有用。
 */
export function getHardcodedTier(email: string | null | undefined): Tier | null {
  const lowerEmail = email?.toLowerCase() ?? null
  if (!lowerEmail) return null
  if (INTERNAL_VIP_EMAILS.has(lowerEmail)) return 'VIP'
  if (FRIEND_EMAILS.has(lowerEmail)) return 'FRIEND'
  return null
}

/**
 * 給定 access + 目前數量 → 是否超過上限。
 * limit 為 null 永遠回 false。
 */
export function exceedsFavoritesLimit(access: UserAccess, currentCount: number): boolean {
  if (access.limits.favorites === null) return false
  return currentCount >= access.limits.favorites
}

export function exceedsStrategiesLimit(access: UserAccess, currentCount: number): boolean {
  if (access.limits.strategies === null) return false
  return currentCount >= access.limits.strategies
}

// ───────────────────────────────────────────────────────────
// 向後相容（給還沒改的 endpoint 用，之後可移除）
// ───────────────────────────────────────────────────────────

/**
 * @deprecated 用 getUserAccess() 取代。保留是為了讓尚未改造的 endpoint 不爆。
 */
export const LIMITS = {
  FAVORITES: TIER_CAPABILITIES.FREE.limits.favorites!,
  STRATEGIES: TIER_CAPABILITIES.FREE.limits.strategies!,
} as const
