import { useEffect, useState } from 'react'

/**
 * 偵測「手機/平板觸控裝置」用 layout 切換。
 *
 * 判斷條件（只看一條）：
 *   pointer: coarse（觸控裝置）→ 走 mobile / iPad layout
 *
 * 為什麼放棄 viewport 條件：
 *   - 原本「viewport ≤ 1024」會讓 iPad 橫躺（≥ 1024）跳桌機 layout
 *     → K 線擠在窄欄、4 stat card 都很迷你，user 反映體驗差
 *   - 改成「只看 pointer」後：
 *     ✅ iPhone（任何方向）→ mobile UI
 *     ✅ iPad（直立 / 橫躺）→ mobile UI（會有點空但功能完整）
 *     ✅ 真桌機（鼠標 = pointer: fine）→ 桌機 UI（無關視窗寬度）
 *   - 缺點：iPad Pro 13" 橫躺（1366px）走 mobile 會有點空。
 *     之後想做 iPad 專屬 2-column layout 再用 Tailwind `lg:` breakpoint 漸進加。
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => check())

  useEffect(() => {
    const mqPointer = window.matchMedia('(pointer: coarse)')
    const update = () => setIsMobile(mqPointer.matches)
    mqPointer.addEventListener('change', update)
    return () => {
      mqPointer.removeEventListener('change', update)
    }
  }, [])

  return isMobile
}

function check(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: coarse)').matches
}
