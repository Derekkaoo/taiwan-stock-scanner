// ============================================================
//  資料未更新警示
//  - 桌機：頂部黃色 banner，持續顯示直到 stocks.date 追上預期週五
//  - 手機：進站跳 modal 一次（localStorage 當日去重）
//
//  偵測邏輯：
//    最近一個週五（含今日）作為「預期 norway 公告日」
//    stocks.date < expected → 視為 stale
// ============================================================
import { useEffect, useMemo, useState } from 'react'

interface Props {
  /** stocks.json 第一筆的 date 欄位（YYYY-MM-DD，所有 stock 都同日）*/
  stocksDate: string
  /** 由 useIsMobile() 傳進來 */
  isMobile: boolean
}

/** 回傳「最近一個週五（含今日）」的 YYYY-MM-DD */
function getMostRecentFriday(today: Date): string {
  const dow = today.getDay()  // 0=Sun, 6=Sat
  // 週五=5→0, 週六=6→1, 週日=0→2, 週一=1→3, 週二=2→4, 週三=3→5, 週四=4→6
  const daysBack = (dow + 2) % 7
  const friday = new Date(today)
  friday.setDate(today.getDate() - daysBack)
  const y = friday.getFullYear()
  const m = String(friday.getMonth() + 1).padStart(2, '0')
  const d = String(friday.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const DISMISS_KEY_PREFIX = 'stale-data-dismissed:'

export function StaleDataWarning({ stocksDate, isMobile }: Props) {
  const expectedFriday = useMemo(() => getMostRecentFriday(new Date()), [])
  const isStale = !!stocksDate && stocksDate < expectedFriday

  const dismissKey = `${DISMISS_KEY_PREFIX}${expectedFriday}`
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(dismissKey) === '1'
    } catch {
      return false
    }
  })
  const [bannerClosed, setBannerClosed] = useState(false)

  // 手機 modal 開啟時 lock body scroll
  useEffect(() => {
    if (!isMobile || !isStale || dismissed) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isMobile, isStale, dismissed])

  // ESC 關 modal
  useEffect(() => {
    if (!isMobile || !isStale || dismissed) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleDismissModal()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, isStale, dismissed])

  if (!isStale) return null

  const handleDismissModal = () => {
    try {
      localStorage.setItem(dismissKey, '1')
    } catch {}
    setDismissed(true)
  }

  const message = `千張大戶最新資料來源尚未更新（預期 ${expectedFriday}），請稍後重新整理。`

  // ─── 手機：自製 modal（不依賴外部元件，避免 master / favorites-v2 分歧）───
  if (isMobile) {
    if (dismissed) return null
    return (
      <div
        onClick={handleDismissModal}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: 'rgba(0, 0, 0, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          backdropFilter: 'blur(2px)',
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 380,
            background: 'var(--color-bg-700)',
            border: '1px solid var(--color-border)',
            borderRadius: 12,
            padding: '24px 20px 20px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
            color: 'var(--color-text-primary)',
          }}
        >
          <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              textAlign: 'center',
              marginBottom: 10,
              color: 'var(--color-text-primary)',
            }}
          >
            資料尚未更新
          </div>
          <div
            style={{
              fontSize: 13,
              textAlign: 'center',
              lineHeight: 1.6,
              color: 'var(--color-text-secondary)',
              marginBottom: 20,
            }}
          >
            {message}
          </div>
          <button
            onClick={handleDismissModal}
            style={{
              width: '100%',
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid var(--color-accent-cyan)',
              background: 'var(--color-accent-cyan)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            我知道了
          </button>
        </div>
      </div>
    )
  }

  // ─── 桌機：頂部 banner ───
  if (bannerClosed) return null
  return (
    <div
      className="w-full px-4 py-2 flex items-center justify-center gap-3 text-sm"
      style={{
        background: 'rgba(251, 191, 36, 0.12)',
        borderBottom: '1px solid rgba(251, 191, 36, 0.35)',
        color: '#fbbf24',
        fontWeight: 500,
      }}
    >
      <span>⚠️</span>
      <span>{message}</span>
      <button
        onClick={() => setBannerClosed(true)}
        className="ml-3 px-2 py-0.5 rounded transition-colors"
        aria-label="關閉提醒"
        style={{
          background: 'transparent',
          border: '1px solid rgba(251, 191, 36, 0.5)',
          color: '#fbbf24',
          cursor: 'pointer',
          fontSize: 11,
        }}
      >
        關閉
      </button>
    </div>
  )
}
