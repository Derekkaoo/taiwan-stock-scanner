import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { Toast, ReturnPeriod, TurnoverPeriod, Filters, StockRow } from './types'
import { RETURN_PERIOD_LABELS, TURNOVER_PERIOD_LABELS, DEFAULT_FILTERS } from './types'
import { useStocks, normalizeRow } from './hooks/useStocks'
import { useKline, calcThreeMonthReturn } from './hooks/useKline'
import { useFavorites } from './hooks/useFavorites'
import { useGoogleAuth } from './hooks/useGoogleAuth'
import { StockTable } from './components/StockTable'
import { GroupCard } from './components/GroupCard'
import { Footer } from './components/Footer'
import { FiltersBar } from './components/FiltersBar'
import { GoogleSignInButton } from './components/GoogleSignInButton'
import { StrategyManager } from './components/StrategyManager'
import { SettingsPanel } from './components/SettingsPanel'
import { AlertModal } from './components/AlertModal'
import { VipPanel } from './components/VipPanel'
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

  // 歷史累積榜（stocks_archive.json）：lazy-load，僅在進入「只看我的最愛」模式時才抓
  // 後端 norway 只能抓 ≥ 0.1% 的股票，當週掉出榜的最愛要從這裡撈舊資料（K 線 + 基本面）
  // 注意：archive 是 dict 格式 {id: {…stock, _lastSeenDate}}，不是 array
  const [archiveById, setArchiveById] = useState<Record<string, StockRow>>({})
  const [archiveLoaded, setArchiveLoaded] = useState(false)
  const loadArchive = useCallback(async () => {
    if (archiveLoaded) return
    try {
      const resp = await fetch('/data/stocks_archive.json?t=' + Date.now())
      if (!resp.ok) {
        // 沒檔案不算錯（首次部署、後端尚未跑過）
        setArchiveLoaded(true)
        return
      }
      const raw = await resp.json()
      if (raw && typeof raw === 'object') {
        // 跑 normalizeRow 確保所有欄位（turnovers / volumes / fundamentals 等）都正確 parse
        const out: Record<string, StockRow> = {}
        for (const [sid, entry] of Object.entries(raw as Record<string, unknown>)) {
          if (entry && typeof entry === 'object') {
            out[sid] = normalizeRow(entry as Record<string, unknown>)
          }
        }
        setArchiveById(out)
      }
    } catch {
      // 網路失敗不致命，靜默忽略；ghost 會 fallback 到 id-only
    } finally {
      setArchiveLoaded(true)
    }
  }, [archiveLoaded])
  useEffect(() => {
    if (showFavoritesOnly) loadArchive()
  }, [showFavoritesOnly, loadArchive])

  // K 線即時 filter（N 日漲幅 / 創 N 日新高）任一啟用 → 一次性 lazy-load 整包 klines.json
  const klineFiltersActive =
    filters.nDayReturn.days !== 0 ||
    filters.nDayHigh.days !== 0 ||
    filters.volumeNewHigh.days !== 0 ||
    filters.volumeSurge.multiplier !== 0
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
    // 我的最愛模式：本週入榜的從 stocks 抓；本週掉出榜的從 archive 抓（ghost）
    // 後端 norway 只抓 ≥ 0.1% → 不在 stocks 裡的最愛標記為 ghost，並從 archive 補資料
    const inWeekById = new Map(stocks.map(s => [s.id, s]))
    const favIds = fav.favoritesArray
    const result: StockRow[] = []
    for (const fid of favIds) {
      const cur = inWeekById.get(fid)
      if (cur) {
        result.push({ ...cur, _isGhost: false })
      } else {
        const arc = archiveById[fid]
        if (arc) {
          result.push({ ...arc, _isGhost: true })
        } else {
          // 沒在 archive 裡：可能 archive 還沒 load 完，或這是跨機器舊收藏
          // 給最低限度 row（id + name placeholder），避免使用者看不到自己收藏的東西
          result.push({
            id: fid, name: fid, group: '', groupDesc: '',
            holdingPct: 0, delta: 0, price: 0, marketCap: 0,
            date: '', threeMonthReturn: null,
            _isGhost: true,
          })
        }
      }
    }
    return result
  }, [stocks, filteredByFilters, showFavoritesOnly, fav.favoritesArray, archiveById])

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
  if (showVip) {
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

      <header
        className="sticky top-0 z-50 flex items-center gap-4 px-5 py-2.5 border-b"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        <h1 className="text-sm font-bold" style={{ color: 'var(--color-accent-cyan)', letterSpacing: '0.5px' }}>
          千張大戶持股追蹤器
        </h1>
        <div className="ml-auto flex items-center gap-3 text-xs font-mono tabular">
          <span
            className="px-2 py-0.5 rounded border"
            style={{
              color: 'var(--color-accent-cyan)',
              borderColor: 'var(--color-accent-cyan)' + '44',
              background: 'var(--color-accent-cyan)' + '11',
              fontSize: 11,
            }}
          >
            {lastUpdated ? `最後更新 ${lastUpdated}` : '載入中…'}
          </span>
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

        {(['group', 'table'] as View[]).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="text-xs px-3 py-1 rounded border transition-colors"
            style={{
              background:  view === v ? 'var(--color-accent-blue)' : 'var(--color-bg-600)',
              borderColor: view === v ? 'var(--color-accent-blue)' : 'var(--color-border)',
              color:       view === v ? '#fff' : 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            {v === 'group' ? '族群總覽' : '個股列表'}
          </button>
        ))}

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
        {view === 'group' && (
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
        {view === 'table' && (
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

      {/* 個股列表才顯示篩選器（族群總覽不需要）*/}
      {view === 'table' && filteredStocks.length > 0 && (
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
            view === 'table' && visibleStocks.length !== stockCount
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

      {stockCount > 0 && (
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

      <main className="flex-1 px-5 pb-8">
        {!loading && stockCount === 0 && (
          <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--color-text-muted)' }}>
            <div className="text-4xl mb-4">📭</div>
            <div className="text-base mb-2" style={{ color: 'var(--color-text-secondary)' }}>尚無資料</div>
            <div className="text-xs">點擊「更新資料」載入最新資料</div>
          </div>
        )}

        {view === 'group' && stockCount > 0 && (
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

        {view === 'table' && visibleStocks.length > 0 && (
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
        )}
      </main>

      <Footer />

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

      {/* 提示 modal：收藏超過 10 筆 */}
      <AlertModal
        open={favLimitPrompt}
        onClose={() => setFavLimitPrompt(false)}
        icon="crown"
        title="已達到收藏上限"
        message={
          <>
            目前免費版可收藏 10 支股票，
            <br />
            如需收藏更多，請升級至 VIP 方案。
          </>
        }
        primary={{
          label: '了解 VIP 方案',
          onClick: () => {
            setFavLimitPrompt(false)
            setShowVip(true)
          },
        }}
        secondary={{
          label: '稍後再說',
          onClick: () => setFavLimitPrompt(false),
        }}
      />

      {/* 提示 modal：策略超過 5 筆 */}
      <AlertModal
        open={strategyLimitPrompt}
        onClose={() => setStrategyLimitPrompt(false)}
        icon="crown"
        title="已達到策略上限"
        message={
          <>
            目前免費版可儲存 5 組篩選策略，
            <br />
            如需儲存更多，請升級至 VIP 方案。
          </>
        }
        primary={{
          label: '了解 VIP 方案',
          onClick: () => {
            setStrategyLimitPrompt(false)
            setShowVip(true)
          },
        }}
        secondary={{
          label: '稍後再說',
          onClick: () => setStrategyLimitPrompt(false),
        }}
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