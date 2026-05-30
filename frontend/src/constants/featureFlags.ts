/**
 * 功能旗標 — 集中管理 conditional UI
 *
 * 用法：
 *   import { SHOW_VIP_UI } from './constants/featureFlags'
 *   {SHOW_VIP_UI && <VipUpgradeButton />}
 *
 * 變更時：改 false ↔ true → push → Cloudflare Pages 1-2 分鐘 deploy 完
 */

/**
 * 顯示 VIP / 訂閱 相關 UI（升級按鈕、VipPanel 入口、上限提示中的 VIP 升級）。
 *
 * 2026-05-17 試用期：false（隱藏所有付費暗示）
 * 2026-05-23 暫時：true — 給綠界申請拍「產品展示間照片」用
 * 綠界審核期間若要回復隱藏，改回 false 即可
 */
export const SHOW_VIP_UI = true

/**
 * 是否啟用「真實訂閱」流程。
 *
 * - false (預設)：用戶按「立即訂閱」會跳「即將開放」AlertModal（VipPanel 看起來像展示頁）
 *                 後端 ECPay create-order / callbacks 全部仍可用，但不曝光給一般用戶
 * - true：用戶按「立即訂閱」會真實打 /api/payment/create-order → 跳綠界刷卡頁
 *
 * 你要正式上線收費那天才改 true → push（搭配下面金流上線 SOP）。
 * 改之前用 phase2-test.html 仍可內部測試（不受這個 flag 影響）。
 */
export const ENABLE_REAL_SUBSCRIBE = false

/**
 * ─────────────────────────────────────────────────────────────
 * 金流上線 SOP（祖父條款方案 Y — 既有資料保留、推播降級）
 * ─────────────────────────────────────────────────────────────
 *
 * 現況（不限期試用）：
 *   - functions/_lib/access.ts 的 FREE tier limits = null/null + canPush = true
 *   - 所有人都享無限策略 + 無限收藏 + Telegram 推播
 *
 * 等綠界 ECPay 過件 + VIP 訂閱功能上線後，照以下步驟切回收費模式：
 *
 *   ① functions/_lib/access.ts FREE tier 改回：
 *        limits: { favorites: 10, strategies: 5 },
 *        canPush: false,
 *      → 既有資料**全部保留**，但 API 會擋新增超過 10/5
 *
 *   ② scripts/push_user_strategies.py 加 tier 過濾（骨架已預埋，解註解即可）：
 *      → if access.tier == 'FREE': continue  # 不推 FREE user
 *
 *   ③ SHOW_VIP_UI 維持 true（讓人看到升級按鈕）
 *
 *   ④ 推 Telegram 通知所有已綁定的 user：
 *      「金流已上線，VIP 訂閱解鎖無限新增 + 個人化推播」
 *
 *   ⑤ 觀察 7 天 churn 和訂閱率，再決定是否加碼優惠
 *
 * 為什麼這樣設計：
 *   - 既有 user 的最愛/策略不會消失 → 不會引發強烈反彈
 *   - 「不能新增」+「沒推播」是真正的痛點 → 觸發訂閱動機
 *   - VIP 訂閱 (NT$88/月 或 NT$888/年) 解鎖：無限新增 + 個人化推播
 */
