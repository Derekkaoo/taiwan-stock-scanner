import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { Toast, ReturnPeriod, TurnoverPeriod, Filters } from './types'
import { RETURN_PERIOD_LABELS, TURNOVER_PERIOD_LABELS, DEFAULT_FILTERS } from './types'
import { useStocks } from './hooks/useStocks'
import { useKline, calcThreeMonthReturn } from './hooks/useKline'
import { useIsMobile } from './hooks/useIsMobile'
import { StockTable } from './components/StockTable'
import { GroupCard } from './components/GroupCard'
import { Footer } from './components/Footer'
import { FiltersBar, totalActiveCount } from './components/FiltersBar'
import { MobileBottomNav, type MobileTab } from './components/MobileBottomNav'
import { MobileStockList } from './components/MobileStockList'
import { MobileStockDetail } from './components/MobileStockDetail'
import { MobileScrollTopFab } from './components/MobileScrollTopFab'

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
    filteredStocks, grouped, sort, loading, error,
    searchQuery, lastUpdated, dataDate,
    loadData, setSearchQuery, updateSort, updateStockReturn,
  } = useStocks(returnPeriod, turnoverPeriod)

  const { fetchGroup, getFromCache, getAllKlines, loadFromJson, cacheVersion, clearCache } = useKline()

  const [view,      setView]      = useState<View>('group')
  const [groupSort, setGroupSort] = useState<GroupSort>('delta')
  const [toasts,    setToasts]    = useState<Toast[]>([])
  const [filters,   setFilters]   = useState<Filters>(DEFAULT_FILTERS)

  // 手機 layout：3 tab 底部導航 + 受控 filter modal
  // 桌機完全不會 render 任何 mobile 元件（isMobile = false 時 Bottom Nav 不渲染、effectiveView = view）
  const isMobile = useIsMobile()
  const [mobileTab, setMobileTab]                 = useState<MobileTab>('stock') // 預設個股
  const [mobileFilterOpen, setMobileFilterOpen]   = useState(false)
  // 個股 tab 進 detail view 時記錄是哪一支；null = list view
  const [mobileDetailStockId, setMobileDetailStockId] = useState<string | null>(null)
  // 進 detail view 之前記列表 scroll 位置，返回時 restore（避免 user 失去脈絡）
  const listScrollY = useRef<number>(0)
  // 手機派生 view：mobileTab='group' → group view、其他 → table view（filter 是 trigger，會切到 stock tab + 開 modal）
  const effectiveView: View = isMobile ? (mobileTab === 'group' ? 'group' : 'table') : view

  const handleMobileTab = useCallback((t: MobileTab) => {
    // 換 tab 時關掉 detail view（避免 detail view 殘留在後台）
    setMobileDetailStockId(null)
    if (t === 'filter') {
      // filter tab 是 trigger：切到 stock tab（這樣 FiltersBar 已 render，modal 才能開）+ 打開 modal
      setMobileTab('stock')
      setMobileFilterOpen(true)
    } else {
      setMobileTab(t)
    }
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

  // 套用 slider/chip 篩選器（只影響個股列表 view，族群總覽不受影響）
  // cacheVersion 變動時重算（K 線 lazy-load 完成 / 重新整理）
  const filteredByFilters = useMemo(
    () => applyFilters(filteredStocks, filters, getAllKlines()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredStocks, filters, cacheVersion]
  )

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
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearchQuery(q), 200)
  }

  const groupEntries = Object.entries(grouped)
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

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--color-bg-800)' }}>

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
                width: 28,
                height: 28,
                background: loading ? 'var(--color-bg-600)' : 'var(--color-bg-600)',
                color: 'var(--color-accent-cyan)',
                border: '1px solid var(--color-border)',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.5 : 1,
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {loading ? '⏳' : '⟳'}
            </button>
          )}
        </div>
      </header>

      {/* 手機 list view 專用搜尋列（不 sticky，跟列表一起 scroll；省 sticky 高度）*/}
      {isMobile && effectiveView === 'table' && !mobileDetailStockId && (
        <div
          className="px-3 py-1.5 border-b"
          style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
        >
          <div
            className="flex items-center gap-2 rounded border px-2.5"
            style={{ background: 'var(--color-bg-600)', borderColor: 'var(--color-border)' }}
          >
            <span className="text-[12px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>🔍</span>
            <input
              type="text"
              placeholder="搜尋代號 / 名稱 / 族群…"
              defaultValue={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              className="flex-1 outline-none text-[12px] py-1.5"
              style={{
                background: 'transparent',
                color: 'var(--color-text-primary)',
                border: 0,
              }}
            />
          </div>
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

      {/* 個股列表才顯示篩選器（族群總覽不需要）；手機上 stock + filter tab 都需要 FiltersBar 在 DOM 才能開 modal */}
      {(effectiveView === 'table' || (isMobile && mobileTab === 'stock')) && filteredStocks.length > 0 && (
        <FiltersBar
          stocks={filteredStocks}
          filters={filters}
          onChange={setFilters}
          mobileOpen={mobileFilterOpen}
          setMobileOpen={setMobileFilterOpen}
          hideMobileTrigger={isMobile}
        />
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
            effectiveView === 'table' && filteredByFilters.length !== stockCount
              ? `篩出 ${filteredByFilters.length} / ${stockCount} 筆`
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
        className="flex-1 px-5 pb-8"
        style={isMobile ? { paddingBottom: 'calc(64px + env(safe-area-inset-bottom, 0))' } : undefined}
      >
        {!loading && stockCount === 0 && (
          <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--color-text-muted)' }}>
            <div className="text-4xl mb-4">📭</div>
            <div className="text-base mb-2" style={{ color: 'var(--color-text-secondary)' }}>尚無資料</div>
            <div className="text-xs">點擊「更新資料」載入最新資料</div>
          </div>
        )}

        {effectiveView === 'group' && stockCount > 0 && (
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
                maPeriods={maPeriods}
                setMaPeriods={setMaPeriods}
                timeframe={timeframe}
                setTimeframe={setTimeframe}
              />
            ))}
          </div>
        )}

        {effectiveView === 'table' && stockCount > 0 && (
          isMobile ? (
            mobileDetailStockId ? (
              <MobileStockDetail
                stocks={filteredByFilters}
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
              />
            ) : (
              <MobileStockList
                stocks={filteredByFilters}
                returnPeriod={returnPeriod}
                setReturnPeriod={setReturnPeriod}
                turnoverPeriod={turnoverPeriod}
                setTurnoverPeriod={setTurnoverPeriod}
                sort={sort}
                onSort={updateSort}
                onRowClick={openMobileDetail}
              />
            )
          ) : (
            <StockTable
              stocks={filteredByFilters}
              sort={sort}
              onSort={key => updateSort(key)}
              returnPeriod={returnPeriod}
              turnoverPeriod={turnoverPeriod}
              fetchGroup={fetchGroup}
              getFromCache={getFromCache}
              cacheVersion={cacheVersion}
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
        />
      )}

      {/* 手機 list view 的「回頂」FAB；detail view / 族群 view 不需要 */}
      {isMobile && mobileTab === 'stock' && !mobileDetailStockId && <MobileScrollTopFab />}

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