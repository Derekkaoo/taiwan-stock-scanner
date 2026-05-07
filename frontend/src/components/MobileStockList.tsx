// ============================================================
//  手機個股 tab 主容器
//  - 接 stocks（已排序+篩選後）
//  - 管 expandedId：accordion 單開（一次只 1 筆 K 線展開，避免畫面爆長）
//  - lazy fetch K 線：點開 row 才向 useKline 拿資料
// ============================================================
import { useState, useEffect } from 'react'
import type { StockRow, KlineBar, ReturnPeriod, TurnoverPeriod, SortState } from '../types'
import { MobileStockRow } from './MobileStockRow'

interface Props {
  stocks: StockRow[]
  returnPeriod: ReturnPeriod
  turnoverPeriod: TurnoverPeriod
  /** 來自 App 層 useKline 的 fetchGroup（進 cache + 觸發 onEach callback）*/
  fetchGroup: (groupName: string, ids: string[], onEach?: (id: string, bars: KlineBar[]) => void) => Promise<void>
  getFromCache: (id: string) => KlineBar[] | null
  /** App 層 cache 版本；變動時代表「更新資料」按了 → 展開中的 row 重新拉 */
  cacheVersion: number
  maPeriods: number[]
  setMaPeriods: (p: number[]) => void
  timeframe: 'D' | 'W' | 'M'
  setTimeframe: (t: 'D' | 'W' | 'M') => void
  /** 排序狀態（從 useStocks 來）— mobile 沒有欄位 header，靠 dropdown 切 */
  sort: SortState
  onSort: (key: SortState['key']) => void
}

interface SortOption { key: SortState['key']; label: string }
const SORT_OPTIONS: SortOption[] = [
  { key: 'delta',             label: '週增%' },
  { key: 'threeMonthReturn',  label: '漲幅%' },
  { key: 'price',             label: '收盤' },
  { key: 'revenueYoY',        label: '月營收 YoY' },
  { key: 'holdingPct',        label: '持股%' },
  { key: 'turnovers',         label: '成交' },
  { key: 'deltaAmount',       label: '週增金額' },
]

export function MobileStockList({
  stocks, returnPeriod, turnoverPeriod,
  fetchGroup, getFromCache, cacheVersion,
  maPeriods, setMaPeriods, timeframe, setTimeframe,
  sort, onSort,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // cacheVersion 變動 → 展開中的 row 重新拉（繞開 cache 剛被清空的瞬間）
  useEffect(() => {
    if (!expandedId) return
    const stock = stocks.find(s => s.id === expandedId)
    const group = stock?.groups?.[0] ?? stock?.group
    if (stock && group && !getFromCache(stock.id)) {
      fetchGroup(group, [stock.id])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion])

  // sort 變動 → auto-collapse 已展開的 row
  // 原因：展開 row 體積大（K 線 + Fundamentals + 進場分析），瀏覽器 scroll anchoring
  //      會把它當錨點。sort 後 row 換位置，瀏覽器為了「維持錨點視覺位置」會把 page 拉到 row 新位置
  //      （常常是底部）→ 體驗很差。collapse 後就沒大型錨點 → page 留在原位
  useEffect(() => {
    setExpandedId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort.key, sort.dir])

  const handleToggle = async (id: string) => {
    const willExpand = expandedId !== id
    setExpandedId(willExpand ? id : null)
    if (!willExpand) return

    // Lazy-load K 線（用該股票的第一個 group 名找對應的 klines.json 區塊）
    const stock = stocks.find(s => s.id === id)
    const group = stock?.groups?.[0] ?? stock?.group
    if (stock && group && !getFromCache(id)) {
      await fetchGroup(group, [id])
    }
  }

  if (!stocks.length) {
    return (
      <div className="flex items-center justify-center py-16" style={{ color: 'var(--color-text-muted)' }}>
        <div className="text-center">
          <div className="text-lg mb-2">📭</div>
          <div className="text-sm">沒有符合條件的股票</div>
        </div>
      </div>
    )
  }

  // 切到沒在 dropdown 出現的 sort key（譬如 desktop 點欄位 sort 'name'）→ fallback display
  const currentInOptions = SORT_OPTIONS.some(o => o.key === sort.key)

  return (
    <div
      className="flex flex-col rounded border"
      style={{
        background: 'var(--color-bg-800)',
        borderColor: 'var(--color-border)',
      }}
    >
      {/* Sort header bar（手機沒有欄位 header，靠這條切排序）*/}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>排序</span>
        <select
          value={currentInOptions ? sort.key : ''}
          onChange={e => onSort(e.target.value as SortState['key'])}
          className="text-[11px] px-2 py-1 rounded border outline-none"
          style={{
            background: 'var(--color-bg-600)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
          }}
        >
          {!currentInOptions && (
            <option value="" disabled>{String(sort.key)}</option>
          )}
          {SORT_OPTIONS.map(opt => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
        <button
          onClick={() => onSort(sort.key)}
          className="text-[11px] px-2 py-1 rounded border transition-colors"
          style={{
            background: 'var(--color-bg-600)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-accent-cyan)',
            cursor: 'pointer',
            minWidth: 28,
          }}
          title={sort.dir === 'desc' ? '由高到低（點切換）' : '由低到高（點切換）'}
        >
          {sort.dir === 'desc' ? '↓' : '↑'}
        </button>
        <span className="ml-auto text-[10px] font-mono tabular" style={{ color: 'var(--color-text-muted)' }}>
          {stocks.length} 筆
        </span>
      </div>

      {stocks.map(stock => (
        <MobileStockRow
          key={stock.id}
          stock={stock}
          expanded={expandedId === stock.id}
          onToggle={() => handleToggle(stock.id)}
          klineBars={getFromCache(stock.id)}
          returnPeriod={returnPeriod}
          turnoverPeriod={turnoverPeriod}
          maPeriods={maPeriods}
          setMaPeriods={setMaPeriods}
          timeframe={timeframe}
          setTimeframe={setTimeframe}
        />
      ))}
    </div>
  )
}
