import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { Toast, ReturnPeriod, TurnoverPeriod, Filters, StockRow } from './types'
import { RETURN_PERIOD_LABELS, TURNOVER_PERIOD_LABELS, DEFAULT_FILTERS } from './types'
import { useStocks } from './hooks/useStocks'
import { useKline, calcThreeMonthReturn } from './hooks/useKline'
import { useFavorites } from './hooks/useFavorites'
import { useGoogleAuth } from './hooks/useGoogleAuth'
import { useIsMobile } from './hooks/useIsMobile'
import { StockTable } from './components/StockTable'
import { GroupCard } from './components/GroupCard'
import { Footer } from './components/Footer'
import { FiltersBar, totalActiveCount } from './components/FiltersBar'
import { GoogleSignInButton } from './components/GoogleSignInButton'
import { StrategyManager } from './components/StrategyManager'
import { SettingsPanel } from './components/SettingsPanel'
import { AlertModal } from './components/AlertModal'
import { VipPanel } from './components/VipPanel'
import { SHOW_VIP_UI } from './constants/featureFlags'
import { MobileBottomNav, type MobileTab } from './components/MobileBottomNav'
import { StaleDataWarning } from './components/StaleDataWarning'
import { MobileStockList } from './components/MobileStockList'
import { MobileStockDetail } from './components/MobileStockDetail'
import { MobileScrollTopFab } from './components/MobileScrollTopFab'

/** Inline monoline SVG icons（lucide-style，跟 MobileBottomNav 同風格）*/
function IconSearch({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinejoin="round" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/>
      <path d="m21 21-4.3-4.3"/>
    </svg>
  )
}
function IconClose({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinejoin="round" strokeLinecap="round">
      <path d="M18 6 6 18"/>
      <path d="m6 6 12 12"/>
    </svg>
  )
}
function IconRefresh({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2"
         strokeLinejoin="round" strokeLinecap="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
      <path d="M16 16h5v5"/>
    </svg>
  )
}

/** 把 useStocks 給的中文 toLocaleString 縮短：「2026/5/8 下午 7:09:50」→「5/8 19:09」*/
function shortenLastUpdated(ts: string | null): string | null {
  if (!ts) return null
  return ts
    .replace(/^\d{4}\//, '')           // 去年份
    .replace(/:\d+$/, '')              // 去秒數
    .replace(/(上午|下午)\s*(\d+):(\d+)/, (_, ampm, h, m) => {
      let hh = parseInt(h, 10)
      if (ampm === '下午' && hh < 12) hh += 12
      if (ampm === '上午' && hh === 12) hh = 0
      return `${hh}:${m.padStart(2, '0')}`
    })
}
import { applyFilters } from './utils/filters'
import { GOOGLE_CLIENT_ID } from './config'

type View = 'group' | 'table'
type GroupSort = 'delta' | 'return'

function fmt(v: number | null, d = 2) {
  return v !== null && v !== undefined ? v.toFixed(d) : '—'
}

function formatDataDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return dateStr.replace(/-/g, '/')
}

function InfoPopup({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <span
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        style={{
          cursor: 'pointer',
          fontSize: 10,
          color: 'var(--color-accent-cyan)',
          opacity: 0.7,
          marginLeft: 3,
          userSelect: 'none',
        }}
      >
        ⓘ
      </span>
      {open && (
        <span style={{
          position: 'absolute',
          bottom: '120%',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--color-bg-800)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 11,
          color: 'var(--color-text-primary)',
          whiteSpace: 'nowrap',
          zIndex: 9999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          pointerEvents: 'none',
        }}>
          {text}
          <span style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '5px solid var(--color-border)',
          }} />
        </span>
      )}
    </span>
  )
}

export default function App() {
  const [returnPeriod,   setReturnPeriod]   = useState<ReturnPeriod>('y1')
  const [turnoverPeriod, setTurnoverPeriod] = useState<TurnoverPeriod>('d5')

  const {
    stocks, filteredStocks, grouped, sort, loading, error,
    searchQuery, lastUpdated, dataDate,
    loadData, setSearchQuery, updateSort, updateStockReturn,
  } = useStocks(returnPeriod, turnoverPeriod)

  const { fetchGroup, getFromCache, getAllKlines, loadFromJson, cacheVersion, clearCache } = useKline()

  const [view,      setView]      = useState<View>('group')
  const [groupSort, setGroupSort] = useState<GroupSort>('delta')
  const [toasts,    setToasts]    = useState<Toast[]>([])
  const [filters,   setFilters]   = useState<Filters>(DEFAULT_FILTERS)
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false)

  // 手機 layout：3 tab 底部導航 + 受控 filter modal
  // 桌機完全不會 render 任何 mobile 元件（isMobile = false 時 Bottom Nav 不渲染、effectiveView = view）
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab]                 = useState<MobileTab>('stock') // 預設個股
  // 個股 tab 進 detail view 時記錄是哪一支；null = list view
  const [mobileDetailStockId, setMobileDetailStockId] = useState<string | null>(null)
  // 進 detail view 之前記列表 scroll 位置，返回時 restore（避免 user 失去脈絡）
  const listScrollY = useRef<number>(0)
  // 手機派生 view：mobileTab='group' → group view、其他 → table view（filter 是 trigger，會切到 stock tab + 開 modal）
  const effectiveView: View = isMobile ? (mobileTab === 'group' ? 'group' : 'table') : view

  const handleMobileTab = useCallback((t: MobileTab) => {
    // 換 tab 時關掉 detail view
    setMobileDetailStockId(null)
    // 最愛 tab → 自動開啟 showFavoritesOnly；個股/族群 tab → 關閉（filter 不動，filter 是 trigger）
    if (t === 'favorites') {
      setShowFavoritesOnly(true)
    } else if (t === 'stock' || t === 'group') {
      setShowFavoritesOnly(false)
    }
    setMobileTab(t)
  }, [])

  const openMobileDetail = useCallback((id: string) => {
    listScrollY.current = window.scrollY  // 記住列表位置
    setMobileDetailStockId(id)
    // 進 detail view 後把 detail 頂端對齊到 sticky 下方（不是 document 頂端）
    requestAnimationFrame(() => {
      const detail = document.querySelector<HTMLElement>('[data-mobile-detail]')
      if (!detail) return
      let stickyBottom = 0
      document.querySelectorAll<HTMLElement>('[class*="sticky"]').forEach(s => {
        if (getComputedStyle(s).position !== 'sticky') return
        const r = s.getBoundingClientRect()
        if (r.top < 100 && r.bottom > stickyBottom) stickyBottom = r.bottom
      })
      const rect = detail.getBoundingClientRect()
      const targetY = window.scrollY + rect.top - stickyBottom
      window.scrollTo({ top: Math.max(0, targetY), behavior: 'auto' })
    })
  }, [])

  const closeMobileDetail = useCallback(() => {
    setMobileDetailStockId(null)
    // 等列表 re-mount 後 restore 位置
    requestAnimationFrame(() => {
      window.scrollTo({ top: listScrollY.current, behavior: 'auto' })
    })
  }, [])

  const filterActiveCount = useMemo(() => totalActiveCount(filters), [filters])
  // K 線圖均線顯示偏好（持久化到 localStorage）
  const [maPeriods, setMaPeriods] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem('chartMaPeriods')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.every(x => typeof x === 'number')) {
          return parsed
        }
      }
    } catch {}
    return [20, 60]
  })
  useEffect(() => {
    try { localStorage.setItem('chartMaPeriods', JSON.stringify(maPeriods)) } catch {}
  }, [maPeriods])
  // K 線圖時間框架偏好（D=日 / W=週 / M=月，預設日，持久化到 localStorage）
  const [timeframe, setTimeframe] = useState<'D' | 'W' | 'M'>(() => {
    try {
      const stored = localStorage.getItem('chartTimeframe')
      if (stored === 'D' || stored === 'W' || stored === 'M') return stored
    } catch {}
    return 'D'
  })
  useEffect(() => {
    try { localStorage.setItem('chartTimeframe', timeframe) } catch {}
  }, [timeframe])
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // 即時的 input 值（給 X 清除按鈕判斷顯示）；setSearchQuery 仍 debounced
  const [searchInput, setSearchInput] = useState('')

  // Google 登入
  const auth = useGoogleAuth({ clientId: GOOGLE_CLIENT_ID })

  // 限制提示 modal state
  const [loginPrompt, setLoginPrompt] = useState(false)
  const [favLimitPrompt, setFavLimitPrompt] = useState(false)
  const [strategyLimitPrompt, setStrategyLimitPrompt] = useState(false)
  // VIP 訂閱頁面（conditional render，不用 router）
  const [showVip, setShowVip] = useState(false)
  // 推播設定頁面（conditional render，跟 VipPanel 同模式）
  const [showSettings, setShowSettings] = useState(false)

  // 我的最愛：登入後跨裝置同步；未登入點 ⭐ 跳「請先登入」；超過 10 筆跳 VIP
  const fav = useFavorites(auth.idToken, auth.user?.sub ?? null, {
    onLoginRequired: () => setLoginPrompt(true),
    onLimitExceeded: () => setFavLimitPrompt(true),
  })

  // K 線即時 filter（N 日漲幅 / 創 N 日新高）任一啟用 → 一次性 lazy-load 整包 klines.json
  const klineFiltersActive =
    filters.nDayReturn.days !== 0 ||
    filters.nDayHigh.days !== 0 ||
    filters.volumeNewHigh.days !== 0 ||
    filters.volumeSurge.multiplier !== 0 ||
    (filters.maAlignment?.periods?.length ?? 0) >= 2 ||
    (filters.maDirection?.periods?.length ?? 0) >= 1 ||
    (filters.maBreakout?.days !== 0 && filters.maBreakout?.period !== 0) ||
    (filters.maContinuation?.direction !== 'off' && filters.maContinuation?.period !== 0) ||
    (filters.maSustained?.days !== 0 && filters.maSustained?.period !== 0) ||
    (filters.downtrendBreak?.days !== 0) ||
    (filters.pullbackMa?.period !== 0)
  useEffect(() => {
    if (klineFiltersActive) {
      // loadFromJson 內部會跳過已 cached 的，重複呼叫等於 no-op
      loadFromJson()
    }
  }, [klineFiltersActive, loadFromJson])

  // Filter pipeline: stocks → search/sort → slider/chip → 只看最愛
  // 套用 slider/chip 篩選器（只影響個股列表 view，族群總覽不受影響）
  // cacheVersion 變動時重算（K 線 lazy-load 完成 / 重新整理）
  const filteredByFilters = useMemo(
    () => applyFilters(filteredStocks, filters, getAllKlines()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredStocks, filters, cacheVersion]
  )
  const visibleStocks = useMemo(() => {
    if (!showFavoritesOnly) return filteredByFilters
    // 我的最愛模式：只顯示「本週還在榜 + 通過 user filter」的最愛
    // - filteredByFilters 已含「本週在榜（大戶週增 ≥ 0.1%）」+ user filter（市值/YoY/MA/...）
    // - 掉出榜的（archive 跟跨裝置舊收藏）一律隱藏，避免 row 顯示 0.00 死資料
    const inWeekById = new Map(filteredByFilters.map(s => [s.id, s]))
    const favIds = fav.favoritesArray
    const result: StockRow[] = []
    for (const fid of favIds) {
      const cur = inWeekById.get(fid)
      if (cur) result.push(cur)
    }
    return result
  }, [filteredByFilters, showFavoritesOnly, fav.favoritesArray])

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  useEffect(() => {
    loadData()
    // 不再一次載入所有 K 線（lazy-load per group on expand 以省頻寬）
  }, [])

  const handleRefresh = useCallback(async () => {
    // 清掉舊 K 線 cache（跟展開狀態下的本地 state），
    // loadFromJson 會重新灌入最新版本
    clearCache()
    await loadData()
    await loadFromJson()
    toast('資料已更新', 'success')
  }, [clearCache, loadData, loadFromJson, toast])

  const handleSearch = (q: string) => {
    setSearchInput(q)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearchQuery(q), 200)
  }

  const handleClearSearch = () => {
    clearTimeout(searchTimer.current)
    setSearchInput('')
    setSearchQuery('')
  }

  // 我的最愛模式 → 重新 group：本週入榜的從 stocks，掉出榜的從 archive（ghost）
  const effectiveGrouped = useMemo(() => {
    if (!showFavoritesOnly) return grouped
    const result: Record<string, StockRow[]> = {}
    // visibleStocks 已經把所有最愛（含 ghost）算好了，直接拿來分群
    for (const s of visibleStocks) {
      const gs = (s.groups && s.groups.length > 0) ? s.groups : [s.group || '其他/未分類']
      for (const g of gs) {
        if (!result[g]) result[g] = []
        result[g].push(s)
      }
    }
    return result
  }, [grouped, showFavoritesOnly, visibleStocks])

  const groupEntries = Object.entries(effectiveGrouped)
  const stockCount = filteredStocks.length
  const groupCount = groupEntries.length
  const avgDelta = stockCount
    ? filteredStocks.reduce((s, x) => s + x.delta, 0) / stockCount
    : null
  const maxDelta = stockCount ? Math.max(...filteredStocks.map(x => x.delta)) : null

  const getStockReturn = (s: typeof filteredStocks[number]): number | null => {
    const v = s.returns && s.returns[returnPeriod]
    return v == null ? s.threeMonthReturn : v
  }

  const sortedGroupEntries = [...groupEntries].sort(([, stocksA], [, stocksB]) => {
    switch (groupSort) {
      case 'delta': {
        const avgA = stocksA.reduce((s, x) => s + x.delta, 0) / stocksA.length
        const avgB = stocksB.reduce((s, x) => s + x.delta, 0) / stocksB.length
        return avgB - avgA
      }
      case 'return': {
        const retVals = (list: typeof stocksA) => list
          .map(getStockReturn)
          .filter((x): x is number => x != null)
        const a = retVals(stocksA)
        const b = retVals(stocksB)
        const avgA = a.length ? a.reduce((s, x) => s + x, 0) / a.length : -999
        const avgB = b.length ? b.reduce((s, x) => s + x, 0) / b.length : -999
        return avgB - avgA
      }
      default:
        return 0
    }
  })

  const statCards = [
    {
      label: '符合條件股票',
      value: stockCount.toString(),
      color: 'var(--color-accent-cyan)',
      tooltip: '本週大股東持股週增幅 ≥ 0.1% 的股票數量',
    },
    {
      label: '族群數量',
      value: groupCount.toString(),
      color: 'var(--color-accent-blue)',
      tooltip: '本週有大股東增持的族群數量',
    },
    {
      label: '平均週增持',
      value: `+${fmt(avgDelta, 3)}%`,
      color: 'var(--color-up)',
      tooltip: '所有符合條件股票的大股東持股週增幅平均值（非股價漲跌）',
    },
    {
      label: '最高週增持',
      value: `+${fmt(maxDelta, 3)}%`,
      color: 'var(--color-up)',
      tooltip: '本週單一股票大股東持股週增幅最高值（非股價漲跌）',
    },
  ]

  // VIP 訂閱頁面（conditional render，整個畫面替換主畫面）
  // 試用期：VipPanel 入口完全封死（即使 showVip 被誤觸發也不會 render）
  if (SHOW_VIP_UI && showVip) {
    return <VipPanel onBack={() => setShowVip(false)} />
  }

  // 推播設定頁面
  if (showSettings) {
    return (
      <SettingsPanel
        idToken={auth.idToken}
        onBack={() => setShowSettings(false)}
        onShowVip={() => {
          setShowSettings(false)
          setShowVip(true)
        }}
      />
    )
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--color-bg-800)' }}>

      {/* 資料未更新警示：桌機顯示頂部 banner / 手機跳 modal（當日去重）*/}
      {dataDate && (
        <StaleDataWarning stocksDate={dataDate} isMobile={isMobile} />
      )}

      <header
        className="sticky top-0 z-50 flex items-center gap-2 px-3 py-2 border-b md:gap-4 md:px-5 md:py-2.5"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        <h1
          className={isMobile ? 'text-xs font-bold whitespace-nowrap' : 'text-sm font-bold whitespace-nowrap'}
          style={{ color: 'var(--color-accent-cyan)', letterSpacing: isMobile ? 0 : '0.5px' }}
        >
          千張大戶持股追蹤器
        </h1>
        <div className="ml-auto flex items-center gap-2 text-xs font-mono tabular">
          <span
            className="px-2 py-0.5 rounded border whitespace-nowrap"
            style={{
              color: 'var(--color-accent-cyan)',
              borderColor: 'var(--color-accent-cyan)' + '44',
              background: 'var(--color-accent-cyan)' + '11',
              fontSize: 11,
            }}
          >
            {lastUpdated
              ? (isMobile ? shortenLastUpdated(lastUpdated) : `最後更新 ${lastUpdated}`)
              : '載入中…'}
          </span>
          {isMobile && (
            <button
              onClick={handleRefresh}
              disabled={loading}
              aria-label="重新整理"
              className="rounded transition-colors"
              style={{
                width: 36,
                height: 36,
                background: 'var(--color-bg-600)',
                color: 'var(--color-accent-cyan)',
                border: '1px solid var(--color-border)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span className={loading ? 'animate-spin' : ''} style={{ display: 'inline-flex' }}>
                <IconRefresh size={20} />
              </span>
            </button>
          )}
          {auth.isSignedIn && (
            <button
              onClick={() => setShowSettings(true)}
              className="rounded-full border transition-colors flex items-center justify-center"
              style={{
                width: 32,
                height: 32,
                background: 'var(--color-bg-600)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}
              title="推播設定"
              onMouseEnter={e => {
                e.currentTarget.style.color = 'var(--color-accent-cyan)'
                e.currentTarget.style.borderColor = 'var(--color-accent-cyan)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.color = 'var(--color-text-secondary)'
                e.currentTarget.style.borderColor = 'var(--color-border)'
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </button>
          )}
          <GoogleSignInButton
            user={auth.user}
            isReady={auth.isReady}
            signOut={auth.signOut}
          />
        </div>
      </header>

      {/* 手機 list view 專用搜尋列（sticky 釘在 header 下方；filter tab 不需要）*/}
      {isMobile && mobileTab !== 'filter' && !mobileDetailStockId && (
        <div
          className="px-3 py-1.5 border-b"
          style={{
            background: 'var(--color-bg-700)',
            borderColor: 'var(--color-border)',
            position: 'sticky',
            top: 44,
            zIndex: 40,
          }}
        >
          <div
            className="flex items-center gap-2 rounded border px-2.5"
            style={{ background: 'var(--color-bg-600)', borderColor: 'var(--color-border)' }}
          >
            <span className="shrink-0 flex items-center" style={{ color: 'var(--color-text-muted)' }}>
              <IconSearch size={16} />
            </span>
            <input
              type="text"
              placeholder={effectiveView === 'group' ? '搜尋族群 / 代號 / 名稱…' : '搜尋代號 / 名稱 / 族群…'}
              value={searchInput}
              onChange={e => handleSearch(e.target.value)}
              className="flex-1 outline-none py-1.5"
              style={{
                background: 'transparent',
                color: 'var(--color-text-primary)',
                border: 0,
                minWidth: 0,
              }}
            />
            {searchInput && (
              <button
                onClick={handleClearSearch}
                aria-label="清除搜尋"
                className="shrink-0 flex items-center justify-center rounded-full transition-colors"
                style={{
                  width: 22,
                  height: 22,
                  background: 'var(--color-bg-500)',
                  border: 0,
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                <IconClose size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 手機族群 tab 專用 sort header（sticky 釘在搜尋列下方）*/}
      {isMobile && effectiveView === 'group' && stockCount > 0 && (
        <div
          className="flex items-center gap-2 px-3 py-2 border-b flex-wrap"
          style={{
            background: 'var(--color-bg-700)',
            borderColor: 'var(--color-border)',
            position: 'sticky',
            top: 88,
            zIndex: 30,
          }}
        >
          <span className="text-[12px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>排序</span>
          <select
            value={groupSort}
            onChange={e => setGroupSort(e.target.value as GroupSort)}
            className="text-[13px] px-2 py-1 rounded border outline-none"
            style={{
              background: 'var(--color-bg-600)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
            }}
          >
            <option value="delta">均增持 ↓</option>
            <option value="return">漲幅 ↓</option>
          </select>
          <span className="text-[12px] shrink-0 ml-1" style={{ color: 'var(--color-text-muted)' }}>漲幅</span>
          <select
            value={returnPeriod}
            onChange={e => setReturnPeriod(e.target.value as ReturnPeriod)}
            className="text-[13px] px-2 py-1 rounded border outline-none"
            style={{
              background: 'var(--color-bg-600)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              maxWidth: 80,
            }}
          >
            {(['w1','m1','m3','m6','y1'] as ReturnPeriod[]).map(p => (
              <option key={p} value={p}>{RETURN_PERIOD_LABELS[p]}</option>
            ))}
          </select>
          <span className="ml-auto text-[12px] font-mono tabular shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            {groupCount} 族群
          </span>
        </div>
      )}

      {!isMobile && (
      <div
        className="sticky top-[41px] z-40 flex flex-wrap items-center gap-2 px-5 py-2 border-b"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="text-xs px-3 py-1 rounded border font-medium transition-colors"
          style={{
            background: loading ? 'var(--color-bg-600)' : 'var(--color-accent-blue)',
            borderColor: 'var(--color-accent-blue)',
            color: '#fff',
            opacity: loading ? 0.5 : 1,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '⏳ 載入中…' : '🔄 更新資料'}
        </button>

        <div className="w-px h-5" style={{ background: 'var(--color-border)' }} />

        {(['group', 'table'] as View[]).map(v => {
          const active = (isMobile ? effectiveView : view) === v
          return (
            <button
              key={v}
              onClick={() => {
                setView(v)
                // 手機：toolbar view 按鈕也要同步底部 nav，否則點了沒反應
                if (isMobile) setMobileTab(v === 'group' ? 'group' : 'stock')
              }}
              className="text-xs px-3 py-1 rounded border transition-colors"
              style={{
                background:  active ? 'var(--color-accent-blue)' : 'var(--color-bg-600)',
                borderColor: active ? 'var(--color-accent-blue)' : 'var(--color-border)',
                color:       active ? '#fff' : 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}
            >
              {v === 'group' ? '族群總覽' : '個股列表'}
            </button>
          )
        })}

        {/* 「只看我的最愛」toggle */}
        <button
          onClick={() => setShowFavoritesOnly(v => !v)}
          disabled={fav.loading}
          className="text-xs px-3 py-1 rounded border transition-colors"
          style={{
            background:  showFavoritesOnly ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
            borderColor: showFavoritesOnly ? 'var(--color-accent-cyan)' : 'var(--color-border)',
            color:       showFavoritesOnly ? '#fff' : 'var(--color-text-secondary)',
            cursor: fav.loading ? 'not-allowed' : 'pointer',
            opacity: fav.loading ? 0.5 : 1,
          }}
          title={`目前最愛 ${fav.count} 支`}
        >
          ⭐ 我的最愛 ({fav.count})
        </button>

        <div className="w-px h-5" style={{ background: 'var(--color-border)' }} />

        {/* 族群排序下拉（只在族群總覽顯示）*/}
        {effectiveView === 'group' && (
          <>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>族群排序：</span>
            <select
              value={groupSort}
              onChange={e => setGroupSort(e.target.value as GroupSort)}
              className="text-xs px-2 py-1 rounded border outline-none cursor-pointer"
              style={{
                background: 'var(--color-bg-600)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
              }}
            >
              <option value="delta">均增持幅度 ↓</option>
              <option value="return">漲幅 ↓</option>
            </select>
          </>
        )}

        {/* 漲幅期間按鈕（兩個 view 都顯示）*/}
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>漲幅期間：</span>
        <div className="flex items-center gap-1">
          {(['w1','m1','m3','m6','y1'] as ReturnPeriod[]).map(p => {
            const active = returnPeriod === p
            return (
              <button
                key={p}
                onClick={() => setReturnPeriod(p)}
                className="text-xs px-2 py-1 rounded border transition-colors"
                style={{
                  background: active ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
                  borderColor: active ? 'var(--color-accent-cyan)' : 'var(--color-border)',
                  color: active ? '#fff' : 'var(--color-text-secondary)',
                  fontWeight: active ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {RETURN_PERIOD_LABELS[p]}
              </button>
            )
          })}
        </div>

        {/* 成交期間按鈕（只在個股列表顯示，因為只有那邊有成交值欄位）*/}
        {effectiveView === 'table' && (
          <>
            <div className="w-px h-5" style={{ background: 'var(--color-border)' }} />
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>成交值期間：</span>
            <div className="flex items-center gap-1">
              {(['d1','d5','d10','d20'] as TurnoverPeriod[]).map(p => {
                const active = turnoverPeriod === p
                return (
                  <button
                    key={p}
                    onClick={() => setTurnoverPeriod(p)}
                    className="text-xs px-2 py-1 rounded border transition-colors"
                    style={{
                      background: active ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
                      borderColor: active ? 'var(--color-accent-cyan)' : 'var(--color-border)',
                      color: active ? '#fff' : 'var(--color-text-secondary)',
                      fontWeight: active ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {TURNOVER_PERIOD_LABELS[p]}
                  </button>
                )
              })}
            </div>
          </>
        )}

        <div className="w-px h-5" style={{ background: 'var(--color-border)' }} />

        <input
          type="text"
          placeholder="🔍 搜尋代號 / 名稱 / 族群…"
          defaultValue={searchQuery}
          onChange={e => handleSearch(e.target.value)}
          className="text-xs px-3 py-1 rounded border outline-none"
          style={{
            background: 'var(--color-bg-600)', borderColor: 'var(--color-border)',
            color: 'var(--color-text-primary)', width: 200,
          }}
          onFocus={e => { e.target.style.borderColor = 'var(--color-accent-blue)' }}
          onBlur={e =>  { e.target.style.borderColor = 'var(--color-border)' }}
        />
      </div>
      )}

      {/* 桌機 toolbar 上方渲染 FiltersBar + StrategyManager（手機 filter tab 由下方 main 內 fullscreen 渲染）*/}
      {!isMobile && effectiveView === 'table' && filteredStocks.length > 0 && (
        <>
          <FiltersBar
            stocks={filteredStocks}
            filters={filters}
            onChange={setFilters}
          />
          {auth.isSignedIn && (
            <div
              className="px-5 py-2 border-b"
              style={{
                background: 'var(--color-bg-700)',
                borderColor: 'var(--color-border)',
              }}
            >
              <StrategyManager
                idToken={auth.idToken}
                filters={filters}
                setFilters={setFilters}
                onLimitExceeded={() => setStrategyLimitPrompt(true)}
              />
            </div>
          )}
        </>
      )}

      {!isMobile && (
      <div
        className="flex items-center gap-4 px-5 py-1.5 border-b text-[11px]"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        <span className="w-2 h-2 rounded-full" style={{
          background: error ? 'var(--color-accent-red)'
            : loading ? 'var(--color-accent-yellow)'
            : stockCount > 0 ? 'var(--color-accent-green)'
            : 'var(--color-text-muted)',
          animation: loading ? 'pulse 1.2s infinite' : 'none',
        }} />
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {error ? `錯誤：${error}` : loading ? '載入中…' :
            effectiveView === 'table' && visibleStocks.length !== stockCount
              ? `篩出 ${visibleStocks.length} / ${stockCount} 筆`
              : `共 ${stockCount} 筆 / ${groupCount} 族群`}
        </span>
        {!loading && !error && stockCount > 0 && (
          <>
            <span className="font-mono tabular" style={{ color: 'var(--color-text-muted)' }}>
              平均週增持 <span style={{ color: 'var(--color-up)' }}>+{fmt(avgDelta, 3)}%</span>
            </span>
            <span className="font-mono tabular" style={{ color: 'var(--color-text-muted)' }}>
              最高 <span style={{ color: 'var(--color-up)' }}>+{fmt(maxDelta, 3)}%</span>
            </span>
          </>
        )}
      </div>
      )}

      {!isMobile && stockCount > 0 && (
        <div className="flex gap-3 px-5 py-3 flex-wrap">
          {statCards.map(({ label, value, color, tooltip }) => (
            <div
              key={label}
              className="flex-1 min-w-[120px] rounded px-3 py-2 border"
              style={{ background: 'var(--color-bg-600)', borderColor: 'var(--color-border)' }}
            >
              <div className="flex items-center gap-1 text-[10px] mb-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {label}
                <InfoPopup text={tooltip} />
              </div>
              <div className="text-lg font-bold font-mono tabular" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <main
        className={isMobile && mobileTab === 'filter' ? 'flex-1' : 'flex-1 px-5 pb-8'}
        style={isMobile ? { paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0))' } : undefined}
      >
        {/* 手機 filter tab：StrategyManager（已登入時）+ 全螢幕 FiltersBar */}
        {isMobile && mobileTab === 'filter' && filteredStocks.length > 0 && (
          <>
            {auth.isSignedIn && (
              <div
                className="px-3 py-2 border-b"
                style={{
                  background: 'var(--color-bg-700)',
                  borderColor: 'var(--color-border)',
                }}
              >
                <StrategyManager
                  idToken={auth.idToken}
                  filters={filters}
                  setFilters={setFilters}
                  onLimitExceeded={() => setStrategyLimitPrompt(true)}
                />
              </div>
            )}
            <FiltersBar
              stocks={filteredStocks}
              filters={filters}
              onChange={setFilters}
              mobileFullscreen
              resultCount={filteredByFilters.length}
              onShowResults={() => setMobileTab('stock')}
            />
          </>
        )}

        {!loading && stockCount === 0 && !(isMobile && mobileTab === 'filter') && (
          <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--color-text-muted)' }}>
            <div className="text-4xl mb-4">📭</div>
            <div className="text-base mb-2" style={{ color: 'var(--color-text-secondary)' }}>尚無資料</div>
            <div className="text-xs">點擊「更新資料」載入最新資料</div>
          </div>
        )}

        {/* 手機最愛 tab 但 0 收藏 → 引導加收藏 */}
        {!loading && isMobile && mobileTab === 'favorites' && stockCount > 0 && visibleStocks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--color-text-muted)' }}>
            <div className="text-4xl mb-3" style={{ color: '#fbbf24' }}>★</div>
            <div className="text-base mb-2" style={{ color: 'var(--color-text-secondary)' }}>尚未收藏任何股票</div>
            <div className="text-xs text-center px-8" style={{ lineHeight: 1.6 }}>
              在「個股」或「族群」列表上點 ☆ 圖示加入收藏<br />
              {!fav.isSynced && '登入 Google 帳號可跨裝置同步'}
            </div>
          </div>
        )}

        {/* 最愛模式：部分收藏未進入本週榜 → 提示 banner（桌機 + 手機都顯示）
            桌機：showFavoritesOnly toggle on
            手機：mobileTab === 'favorites'
            兩種情境共用 showFavoritesOnly state（mobileTab=favorites 會自動設為 true）*/}
        {showFavoritesOnly && fav.count > 0 && visibleStocks.length < fav.count && (
          <div
            className={isMobile ? 'mx-3 mb-3 px-3 py-2 rounded text-[12px]' : 'mx-5 my-2 px-4 py-2 rounded text-[13px]'}
            style={{
              background: 'rgba(6, 182, 212, 0.10)',
              border: '1px solid rgba(6, 182, 212, 0.35)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
            }}
          >
            <span style={{ color: 'var(--color-accent-cyan)' }}>ℹ️ </span>
            你有 {fav.count} 筆收藏，本週榜上 {visibleStocks.length} 筆顯示中。
            未顯示的 {fav.count - visibleStocks.length} 筆未刪除，下週如上榜會自動回來。
          </div>
        )}

        {effectiveView === 'group' && stockCount > 0 && !(isMobile && mobileTab === 'filter') && (
          <div className="flex flex-col gap-2">
            {sortedGroupEntries.map(([name, stks]) => (
              <GroupCard
                key={name}
                groupName={name}
                stocks={stks}
                fetchGroup={async (ids, onEach) => {
                  await fetchGroup(name, ids, (id, bars) => {
                    onEach?.(id, bars)
                    const ret = calcThreeMonthReturn(bars)
                    if (ret !== null) updateStockReturn(id, ret)
                  })
                }}
                getFromCache={getFromCache}
                returnPeriod={returnPeriod}
                cacheVersion={cacheVersion}
                isFavorite={fav.isFavorite}
                toggleFavorite={fav.toggle}
                maPeriods={maPeriods}
                setMaPeriods={setMaPeriods}
                timeframe={timeframe}
                setTimeframe={setTimeframe}
              />
            ))}
          </div>
        )}

        {effectiveView === 'table' && visibleStocks.length > 0 && !(isMobile && mobileTab === 'filter') && (
          isMobile ? (
            mobileDetailStockId ? (
              <MobileStockDetail
                stocks={visibleStocks}
                currentId={mobileDetailStockId}
                returnPeriod={returnPeriod}
                turnoverPeriod={turnoverPeriod}
                fetchGroup={fetchGroup}
                getFromCache={getFromCache}
                cacheVersion={cacheVersion}
                maPeriods={maPeriods}
                setMaPeriods={setMaPeriods}
                timeframe={timeframe}
                setTimeframe={setTimeframe}
                onClose={closeMobileDetail}
                onChange={setMobileDetailStockId}
                isFavorite={fav.isFavorite}
                toggleFavorite={fav.toggle}
              />
            ) : (
              <MobileStockList
                stocks={visibleStocks}
                returnPeriod={returnPeriod}
                setReturnPeriod={setReturnPeriod}
                turnoverPeriod={turnoverPeriod}
                setTurnoverPeriod={setTurnoverPeriod}
                sort={sort}
                onSort={updateSort}
                onRowClick={openMobileDetail}
                isFavorite={fav.isFavorite}
                toggleFavorite={fav.toggle}
              />
            )
          ) : (
            <StockTable
              stocks={visibleStocks}
              sort={sort}
              onSort={key => updateSort(key)}
              returnPeriod={returnPeriod}
              turnoverPeriod={turnoverPeriod}
              fetchGroup={fetchGroup}
              getFromCache={getFromCache}
              cacheVersion={cacheVersion}
              isFavorite={fav.isFavorite}
              toggleFavorite={fav.toggle}
              maPeriods={maPeriods}
              setMaPeriods={setMaPeriods}
              timeframe={timeframe}
              setTimeframe={setTimeframe}
            />
          )
        )}
      </main>

      <Footer />

      {/* 手機底部 3 tab nav；桌機完全不渲染 */}
      {isMobile && (
        <MobileBottomNav
          tab={mobileTab}
          onTab={handleMobileTab}
          filterActiveCount={filterActiveCount}
          favoritesCount={fav.count}
        />
      )}

      {/* 手機 list view 的「回頂」FAB；個股 + 族群 tab 都要，但 detail view 內不需要 */}
      {isMobile && (mobileTab === 'stock' || mobileTab === 'group' || mobileTab === 'favorites') && !mobileDetailStockId && <MobileScrollTopFab />}

      {/* 提示 modal：未登入點 ⭐ */}
      <AlertModal
        open={loginPrompt}
        onClose={() => setLoginPrompt(false)}
        icon="login"
        title="請先登入"
        message={
          <>
            登入 Google 帳號後即可使用「我的最愛」功能，
            <br />
            還能跨裝置同步收藏與篩選策略 ✨
          </>
        }
        primary={{
          label: '立馬登入',
          onClick: () => {
            setLoginPrompt(false)
            // 等 modal 關閉動畫後再觸發登入（避免被 modal 蓋住）
            setTimeout(() => auth.signIn(), 100)
          },
        }}
        secondary={{
          label: '我再想想',
          onClick: () => setLoginPrompt(false),
        }}
      />

      {/* 提示 modal：收藏達上限（試用期：30 支；Lemon launch 後改 VIP 升級提示）*/}
      <AlertModal
        open={favLimitPrompt}
        onClose={() => setFavLimitPrompt(false)}
        icon={SHOW_VIP_UI ? 'crown' : 'info'}
        title={SHOW_VIP_UI ? '已達到收藏上限' : '✨ 試用期收藏已達上限'}
        message={
          SHOW_VIP_UI ? (
            <>
              目前免費版可收藏 10 支股票，
              <br />
              如需收藏更多，請升級至 VIP 方案。
            </>
          ) : (
            <>
              試用期最多可收藏 30 支股票，
              <br />
              如需新增請先取消其他收藏。
            </>
          )
        }
        primary={
          SHOW_VIP_UI
            ? {
                label: '了解 VIP 方案',
                onClick: () => {
                  setFavLimitPrompt(false)
                  setShowVip(true)
                },
              }
            : {
                label: '我知道了',
                onClick: () => setFavLimitPrompt(false),
              }
        }
        secondary={
          SHOW_VIP_UI
            ? { label: '稍後再說', onClick: () => setFavLimitPrompt(false) }
            : undefined
        }
      />

      {/* 提示 modal：策略達上限（試用期：15 組；Lemon launch 後改 VIP 升級提示）*/}
      <AlertModal
        open={strategyLimitPrompt}
        onClose={() => setStrategyLimitPrompt(false)}
        icon={SHOW_VIP_UI ? 'crown' : 'info'}
        title={SHOW_VIP_UI ? '已達到策略上限' : '✨ 試用期策略已達上限'}
        message={
          SHOW_VIP_UI ? (
            <>
              目前免費版可儲存 5 組篩選策略，
              <br />
              如需儲存更多，請升級至 VIP 方案。
            </>
          ) : (
            <>
              試用期最多可儲存 15 組篩選策略，
              <br />
              如需新增請先刪除其他策略。
            </>
          )
        }
        primary={
          SHOW_VIP_UI
            ? {
                label: '了解 VIP 方案',
                onClick: () => {
                  setStrategyLimitPrompt(false)
                  setShowVip(true)
                },
              }
            : {
                label: '我知道了',
                onClick: () => setStrategyLimitPrompt(false),
              }
        }
        secondary={
          SHOW_VIP_UI
            ? { label: '稍後再說', onClick: () => setStrategyLimitPrompt(false) }
            : undefined
        }
      />

      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className="rounded border px-4 py-2 text-xs shadow-lg max-w-xs"
            style={{
              background: 'var(--color-bg-600)',
              borderColor: t.type === 'error' ? 'var(--color-accent-red)'
                : t.type === 'success' ? 'var(--color-accent-green)'
                : 'var(--color-border)',
              color: t.type === 'error' ? 'var(--color-accent-red)'
                : t.type === 'success' ? 'var(--color-accent-green)'
                : 'var(--color-text-primary)',
            }}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}