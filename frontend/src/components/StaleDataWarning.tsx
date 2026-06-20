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

/**
 * 台灣證交所休市日（國定假日 + 補假 + 春節）
 *
 * 來源：台灣證券交易所每年公告的「重要市場時間表」
 * 維護：每年 12 月證交所公告新年度行事曆時，補進下一年的日期。
 *
 * 漏列的後果：那天被當作交易日 → expectedDay 可能算錯 → 偶爾誤報警告（無傷大雅）
 * 多列的後果：那天被當作休市 → expectedDay 往前推 → 警告觸發更少（更寬容）
 *
 * → 寧可多列也別漏列
 */
const TW_STOCK_HOLIDAYS = new Set<string>([
  // === 2025 ===
  '2025-01-01',
  '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31',
  '2025-02-27', '2025-02-28',
  '2025-04-03', '2025-04-04',
  '2025-05-01',
  '2025-05-30',
  '2025-09-29', '2025-10-06',
  '2025-10-10', '2025-10-24',
  // === 2026 ===
  '2026-01-01',
  '2026-02-13',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
  '2026-02-27',
  '2026-04-02', '2026-04-03',
  '2026-05-01',
  '2026-06-19',
  '2026-09-25',
  '2026-10-09',
  // === 2027（粗估，待證交所公告）===
  '2027-01-01',
  '2027-02-05', '2027-02-08', '2027-02-09', '2027-02-10', '2027-02-11', '2027-02-12',
  '2027-02-26',
  '2027-04-02', '2027-04-05',
  '2027-04-30', '2027-05-03',
  '2027-06-08', '2027-06-09',
  '2027-09-13', '2027-09-14',
  '2027-10-08', '2027-10-11',
])

function fmtDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isTradingDay(d: Date): boolean {
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return false
  if (TW_STOCK_HOLIDAYS.has(fmtDate(d))) return false
  return true
}

/**
 * 回傳「最近一個交易日（含今日）」的 YYYY-MM-DD
 * 從 today 往前找，跳過週末跟證交所休市日。
 * 譬如 2026-06-20 (六) → 6/19 (五，端午休市) → 6/18 (四) ✓
 */
function getMostRecentTradingDay(today: Date): string {
  const d = new Date(today)
  for (let i = 0; i < 30; i++) {
    if (isTradingDay(d)) return fmtDate(d)
    d.setDate(d.getDate() - 1)
  }
  return fmtDate(d)
}

const DISMISS_KEY_PREFIX = 'stale-data-dismissed:'

export function StaleDataWarning({ stocksDate, isMobile }: Props) {
  const expectedDay = useMemo(() => getMostRecentTradingDay(new Date()), [])
  const isStale = !!stocksDate && stocksDate < expectedDay

  const dismissKey = `${DISMISS_KEY_PREFIX}${expectedDay}`
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

  const message = `千張大戶最新資料尚未更新（最近交易日 ${expectedDay}），請稍後重新整理。`

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
