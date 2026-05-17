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
 * Lemon Squeezy 過件後：改 true 開放 VIP 流程
 */
export const SHOW_VIP_UI = false
