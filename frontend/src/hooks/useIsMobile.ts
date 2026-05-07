import { useEffect, useState } from 'react'

/**
 * 偵測「手機/平板觸控裝置」用 layout 切換。
 *
 * 判斷條件（兩條都要符合才算 mobile）：
 *   1. viewport ≤ 1024px（含 iPad 直立 810、iPad 橫躺 1024）
 *   2. pointer: coarse（觸控；桌機鼠標是 fine）
 *
 * 為什麼這樣判：
 *   - 純 viewport 邊界（譬如 768px）會讓 iPhone 14 Pro 橫躺（844px）跳到桌機 layout，
 *     直橫切換落差很大。
 *   - 加 pointer: coarse 排除「縮窄瀏覽器視窗的桌機 user」 → 他們應該還是看桌機 layout。
 *   - 結果：iPhone/Android 直橫都走 mobile、iPad（直橫）也走 mobile、真桌機（任何寬度）走桌機。
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => check())

  useEffect(() => {
    const mqWidth   = window.matchMedia('(max-width: 1024px)')
    const mqPointer = window.matchMedia('(pointer: coarse)')
    const update = () => setIsMobile(mqWidth.matches && mqPointer.matches)
    mqWidth.addEventListener('change', update)
    mqPointer.addEventListener('change', update)
    return () => {
      mqWidth.removeEventListener('change', update)
      mqPointer.removeEventListener('change', update)
    }
  }, [])

  return isMobile
}

function check(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(max-width: 1024px)').matches &&
         window.matchMedia('(pointer: coarse)').matches
}
