import { useState, useCallback, useEffect, useRef } from 'react'
import type { Toast } from './types'
import { useStocks } from './hooks/useStocks'
import { useKline, calcThreeMonthReturn } from './hooks/useKline'
import { StockTable } from './components/StockTable'
import { GroupCard } from './components/GroupCard'

type View = 'group' | 'table'

function fmt(v: number | null, d = 2) {
  return v !== null && v !== undefined ? v.toFixed(d) : '—'
}

export default function App() {
  const {
    filteredStocks, grouped, sort, loading, error,
    searchQuery, lastUpdated,
    loadData, setSearchQuery, updateSort, updateStockReturn,
  } = useStocks()

  const { fetchGroup, getFromCache, loadFromJson } = useKline()

  const [view,        setView]        = useState<View>('group')
  const [collapseAll, setCollapseAll] = useState(false)
  const [expandAll,   setExpandAll]   = useState(false)
  const [toasts,      setToasts]      = useState<Toast[]>([])
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

  const handleExpandAll = useCallback(async () => {
    setCollapseAll(false)
    setExpandAll(true)
    setTimeout(() => setExpandAll(false), 100)
    toast('已展開全部族群', 'info')
  }, [toast])

  const handleCollapseAll = useCallback(() => {
    setExpandAll(false)
    setCollapseAll(true)
    setTimeout(() => setCollapseAll(false), 100)
  }, [])

  const groupEntries = Object.entries(grouped)
  const stockCount = filteredStocks.length
  const groupCount = groupEntries.length
  const avgDelta = stockCount
    ? filteredStocks.reduce((s, x) => s + x.delta, 0) / stockCount
    : null
  const maxDelta = stockCount ? Math.max(...filteredStocks.map(x => x.delta)) : null

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--color-bg-800)' }}>

      <header
        className="sticky top-0 z-50 flex items-center gap-4 px-5 py-2.5 border-b"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        <h1 className="text-sm font-bold" style={{ color: 'var(--color-accent-cyan)', letterSpacing: '0.5px' }}>
          📊 台股大股東持股觀察
          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>
            族群 K 線工具
          </span>
        </h1>
        <div className="ml-auto text-xs tabular font-mono" style={{ color: 'var(--color-text-muted)' }}>
          {lastUpdated ? `更新：${lastUpdated}` : '載入中…'}
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
            {v === 'group' ? '🗂 族群 K 線' : '📋 表格'}
          </button>
        ))}

        {view === 'group' && (
          <>
            <button onClick={handleExpandAll}
              className="text-xs px-3 py-1 rounded border transition-colors cursor-pointer"
              style={{ background: 'var(--color-bg-600)', borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              展開全部
            </button>
            <button onClick={handleCollapseAll}
              className="text-xs px-3 py-1 rounded border transition-colors cursor-pointer"
              style={{ background: 'var(--color-bg-600)', borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
              收合全部
            </button>
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
              平均週增 <span style={{ color: 'var(--color-up)' }}>+{fmt(avgDelta, 3)}%</span>
            </span>
            <span className="font-mono tabular" style={{ color: 'var(--color-text-muted)' }}>
              最高 <span style={{ color: 'var(--color-up)' }}>+{fmt(maxDelta, 3)}%</span>
            </span>
          </>
        )}
      </div>

      {stockCount > 0 && (
        <div className="flex gap-3 px-5 py-3 flex-wrap">
          {[
            { label: '符合條件股票', value: stockCount.toString(),    color: 'var(--color-accent-cyan)' },
            { label: '族群數量',     value: groupCount.toString(),    color: 'var(--color-accent-blue)' },
            { label: '平均週增持',   value: `+${fmt(avgDelta, 3)}%`, color: 'var(--color-up)' },
            { label: '最高週增持',   value: `+${fmt(maxDelta, 3)}%`, color: 'var(--color-up)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex-1 min-w-[120px] rounded px-3 py-2 border"
              style={{ background: 'var(--color-bg-600)', borderColor: 'var(--color-border)' }}>
              <div className="text-[10px] mb-0.5" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
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
            {groupEntries.map(([name, stks]) => (
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
                forceExpand={expandAll}
                forceCollapse={collapseAll}
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
