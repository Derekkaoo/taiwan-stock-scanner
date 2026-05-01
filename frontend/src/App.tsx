import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { Toast, ReturnPeriod, TurnoverPeriod, Filters } from './types'
import { RETURN_PERIOD_LABELS, TURNOVER_PERIOD_LABELS, DEFAULT_FILTERS } from './types'
import { useStocks } from './hooks/useStocks'
import { useKline, calcThreeMonthReturn } from './hooks/useKline'
import { useFavorites } from './hooks/useFavorites'
import { useGoogleAuth } from './hooks/useGoogleAuth'
import { StockTable } from './components/StockTable'
import { GroupCard } from './components/GroupCard'
import { Footer } from './components/Footer'
import { FiltersBar } from './components/FiltersBar'
import { GoogleSignInButton } from './components/GoogleSignInButton'
import { StrategyManager } from './components/StrategyManager'
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
    filteredStocks, grouped, sort, loading, error,
    searchQuery, lastUpdated, dataDate,
    loadData, setSearchQuery, updateSort, updateStockReturn,
  } = useStocks(returnPeriod, turnoverPeriod)

  const { fetchGroup, getFromCache, loadFromJson, cacheVersion, clearCache } = useKline()

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

  // 我的最愛：登入後跨裝置同步（用 Google sub 當 user_token），未登入用裝置 UUID
  const fav = useFavorites(auth.idToken, auth.user?.sub ?? null)

  // Filter pipeline: stocks → search/sort → slider/chip → 只看最愛
  const filteredByFilters = useMemo(
    () => applyFilters(filteredStocks, filters),
    [filteredStocks, filters]
  )
  const visibleStocks = useMemo(() => {
    if (!showFavoritesOnly) return filteredByFilters
    return filteredByFilters.filter(s => fav.isFavorite(s.id))
  }, [filteredByFilters, showFavoritesOnly, fav])

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