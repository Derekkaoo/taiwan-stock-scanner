import { useState, useCallback, useEffect, useRef } from 'react'
import type { Toast } from './types'
import { useStocks } from './hooks/useStocks'
import { useKline, calcThreeMonthReturn } from './hooks/useKline'
import { StockTable } from './components/StockTable'
import { GroupCard } from './components/GroupCard'

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
  const {
    filteredStocks, grouped, sort, loading, error,
    searchQuery, lastUpdated, dataDate,
    loadData, setSearchQuery, updateSort, updateStockReturn,
  } = useStocks()

  const { fetchGroup, getFromCache, loadFromJson } = useKline()

  const [view,      setView]      = useState<View>('group')
  const [groupSort, setGroupSort] = useState<GroupSort>('delta')
  const [toasts,    setToasts]    = useState<Toast[]>([])
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
  }, [])

  useEffect(() => {
    loadData()
    loadFromJson()
  }, [])

  const handleRefresh = useCallback(async () => {
    await loadData()
    await loadFromJson()
    toast('資料已更新', 'success')
  }, [loadData, loadFromJson, toast])

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

  const sortedGroupEntries = [...groupEntries].sort(([, stocksA], [, stocksB]) => {
    switch (groupSort) {
      case 'delta': {
        const avgA = stocksA.reduce((s, x) => s + x.delta, 0) / stocksA.length
        const avgB = stocksB.reduce((s, x) => s + x.delta, 0) / stocksB.length
        return avgB - avgA
      }
      case 'return': {
        const retA = stocksA.filter(s => s.threeMonthReturn !== null)
        const retB = stocksB.filter(s => s.threeMonthReturn !== null)
        const avgA = retA.length ? retA.reduce((s, x) => s + x.threeMonthReturn!, 0) / retA.length : -999
        const avgB = retB.length ? retB.reduce((s, x) => s + x.threeMonthReturn!, 0) / retB.length : -999
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
          {dataDate && (
            <span
              className="px-2 py-0.5 rounded border"
              style={{
                color: 'var(--color-accent-cyan)',
                borderColor: 'var(--color-accent-cyan)' + '44',
                background: 'var(--color-accent-cyan)' + '11',
                fontSize: 11,
              }}
            >
              資料截至 {formatDataDate(dataDate)}
            </span>
          )}
          <span style={{ color: 'var(--color-text-muted)' }}>
            {lastUpdated ? `載入：${lastUpdated}` : '載入中…'}
          </span>
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

        {view === 'group' && (
          <>
            <div className="w-px h-5" style={{ background: 'var(--color-border)' }} />
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
              <option value="return">1年漲幅 ↓</option>
            </select>
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
          {error ? `錯誤：${error}` : loading ? '載入中…' : `共 ${stockCount} 筆 / ${groupCount} 族群`}
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
                  await fetchGroup(ids, (id, bars) => {
                    onEach?.(id, bars)
                    const ret = calcThreeMonthReturn(bars)
                    if (ret !== null) updateStockReturn(id, ret)
                  })
                }}
                getFromCache={getFromCache}
              />
            ))}
          </div>
        )}

        {view === 'table' && stockCount > 0 && (
          <StockTable stocks={filteredStocks} sort={sort} onSort={key => updateSort(key)} />
        )}
      </main>

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