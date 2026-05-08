// ============================================================
//  手機浮動「回頂」按鈕
//  - scroll 超過 threshold 才顯示
//  - bottom 位於 bottom nav 上方（含 safe-area inset）
// ============================================================
import { useEffect, useState } from 'react'

interface Props {
  /** 顯示閾值：scrollY > 此值才顯示，預設 300 */
  threshold?: number
}

export function MobileScrollTopFab({ threshold = 300 }: Props) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])

  if (!visible) return null

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="回到頂部"
      className="fixed z-40 transition-opacity"
      style={{
        bottom: 'calc(64px + env(safe-area-inset-bottom, 0) + 8px)',
        right: 16,
        width: 44,
        height: 44,
        borderRadius: 22,
        background: 'var(--color-accent-cyan)',
        color: '#fff',
        border: 0,
        cursor: 'pointer',
        fontSize: 18,
        fontWeight: 700,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
      }}
    >
      ↑
    </button>
  )
}
