// ============================================================
//  手機個股 list view
//  - 純列表：sort header bar (sticky) + N 個 MobileStockRow
//  - sort header bar 含：排序 / 漲幅期間 / 升降序 / 筆數
//  - 沒 expand 邏輯：tap row → 父層 onRowClick 處理（通常是進 detail view）
// ============================================================
import type { StockRow, ReturnPeriod, TurnoverPeriod, SortState } from '../types'
import { RETURN_PERIOD_LABELS, TURNOVER_PERIOD_LABELS } from '../types'
import { MobileStockRow } from './MobileStockRow'

interface Props {
  stocks: StockRow[]
  returnPeriod: ReturnPeriod
  /** 給 sort header bar 的漲幅期間下拉用 */
  setReturnPeriod: (p: ReturnPeriod) => void
  turnoverPeriod: TurnoverPeriod
  /** 給 sort header bar 的成交值期間下拉用 */
  setTurnoverPeriod: (p: TurnoverPeriod) => void
  /** 排序狀態（從 useStocks 來）— mobile 沒有欄位 header，靠 dropdown 切 */
  sort: SortState
  onSort: (key: SortState['key']) => void
  /** Tap row 進 detail view（id 由父層 setMobileDetailStockId）*/
  onRowClick: (id: string) => void
  /** sort header 在 viewport sticky 位置（避免被頁首 header 遮住）*/
  stickyTopPx?: number
}

interface SortOption { key: SortState['key']; label: string }
const SORT_OPTIONS: SortOption[] = [
  { key: 'delta',             label: '週增%' },
  { key: 'threeMonthReturn',  label: '漲幅%' },
  { key: 'price',             label: '收盤' },
  { key: 'revenueYoY',        label: '月營收 YoY' },
  { key: 'holdingPct',        label: '持股%' },
  { key: 'turnovers',         label: '成交值' },
  { key: 'deltaAmount',       label: '週增金額' },
]

const RETURN_PERIODS: ReturnPeriod[]    = ['w1', 'm1', 'm3', 'm6', 'y1']
const TURNOVER_PERIODS: TurnoverPeriod[] = ['d1', 'd5', 'd10', 'd20']

export function MobileStockList({
  stocks, returnPeriod, setReturnPeriod, turnoverPeriod, setTurnoverPeriod,
  sort, onSort, onRowClick,
  stickyTopPx = 44,
}: Props) {
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
      {/* Sort header bar — sticky 在頁首 header + search row 下方 */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b flex-wrap"
        style={{
          background: 'var(--color-bg-700)',
          borderColor: 'var(--color-border)',
          position: 'sticky',
          top: stickyTopPx,
          zIndex: 30,
        }}
      >
        <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>排序</span>
        <select
          value={currentInOptions ? sort.key : ''}
          onChange={e => onSort(e.target.value as SortState['key'])}
          className="text-[11px] px-2 py-1 rounded border outline-none"
          style={{
            background: 'var(--color-bg-600)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
            maxWidth: 110,
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
          className="text-[11px] px-2 py-1 rounded border transition-colors shrink-0"
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

        <span className="text-[10px] shrink-0 ml-1" style={{ color: 'var(--color-text-muted)' }}>漲幅</span>
        <select
          value={returnPeriod}
          onChange={e => setReturnPeriod(e.target.value as ReturnPeriod)}
          className="text-[11px] px-2 py-1 rounded border outline-none"
          style={{
            background: 'var(--color-bg-600)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
            maxWidth: 70,
          }}
        >
          {RETURN_PERIODS.map(p => (
            <option key={p} value={p}>{RETURN_PERIOD_LABELS[p]}</option>
          ))}
        </select>

        <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>成交值</span>
        <select
          value={turnoverPeriod}
          onChange={e => setTurnoverPeriod(e.target.value as TurnoverPeriod)}
          className="text-[11px] px-2 py-1 rounded border outline-none"
          style={{
            background: 'var(--color-bg-600)',
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-primary)',
            cursor: 'pointer',
            maxWidth: 80,
          }}
        >
          {TURNOVER_PERIODS.map(p => (
            <option key={p} value={p}>{TURNOVER_PERIOD_LABELS[p]}</option>
          ))}
        </select>

        <span className="ml-auto text-[10px] font-mono tabular shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {stocks.length} 筆
        </span>
      </div>

      {stocks.map(stock => (
        <MobileStockRow
          key={stock.id}
          stock={stock}
          onClick={() => onRowClick(stock.id)}
          returnPeriod={returnPeriod}
          turnoverPeriod={turnoverPeriod}
        />
      ))}
    </div>
  )
}
