// ============================================================
//  手機個股 dense row（純 list item）
//  - 沒 expand 邏輯：tap row → 由父層處理（個股 tab 進 detail view、族群內也走同邏輯）
//  - Collapsed 兩行：id+name+chip+週增% / 收 1Y 成交 YoY
// ============================================================
import type { StockRow, ReturnPeriod, TurnoverPeriod } from '../types'
import { TAG_COLORS, getGroupCssClass } from '../constants/themeGroups'

interface Props {
  stock: StockRow
  /** Tap row 觸發；父層自己決定要 navigate 或別的事 */
  onClick: () => void
  returnPeriod: ReturnPeriod
  turnoverPeriod: TurnoverPeriod
  /** 我的最愛 — 從 useFavorites 傳進來 */
  isFavorite?: (stockId: string) => boolean
  toggleFavorite?: (stockId: string) => void
}

const RETURN_LABEL: Record<ReturnPeriod, string> = {
  w1: '1週', m1: '1月', m3: '3月', m6: '6月', y1: '1Y',
}

function fmtPrice(p: number): string {
  return p.toFixed(p >= 100 ? 1 : 2)
}
function fmtTurnoverYi(yi: number): string {
  if (yi >= 100) return `${yi.toFixed(0)}億`
  if (yi >= 10)  return `${yi.toFixed(1)}億`
  return `${yi.toFixed(2)}億`
}
function fmtPctShort(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(0)}%`
}

export function MobileStockRow({
  stock, onClick,
  returnPeriod, turnoverPeriod,
  isFavorite, toggleFavorite,
}: Props) {
  const cssClass   = getGroupCssClass(stock.group)
  const groupColor = TAG_COLORS[cssClass] ?? '#6b7280'

  const rv  = stock.returns && stock.returns[returnPeriod]
  const ret = rv == null ? stock.threeMonthReturn : rv
  const turnover = stock.turnovers?.[turnoverPeriod] ?? 0
  const yoy = stock.revenueYoY
  const fav = isFavorite?.(stock.id) ?? false

  return (
    <div
      className="relative w-full transition-colors"
      style={{
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <button
        onClick={onClick}
        className="w-full text-left px-3.5 py-2.5 transition-colors"
        style={{
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          color: 'var(--color-text-primary)',
        }}
      >
      {/* line 1: › + id + name + group chip + 週增% — 只有這行為星星留空間 */}
      <div
        className="flex items-baseline justify-between gap-2 mb-1.5"
        style={{ paddingRight: toggleFavorite ? 32 : 0 }}
      >
        <div className="flex items-baseline gap-2 min-w-0 flex-1 overflow-hidden">
          <span className="text-[12px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>›</span>
          <span
            className="font-mono tabular text-[15px] shrink-0"
            style={{ color: 'var(--color-accent-cyan)', fontWeight: 500 }}
          >
            {stock.id}
          </span>
          <span className="text-[14px] shrink-0">{stock.name}</span>
          <span
            className="text-[10px] px-2 py-0.5 rounded-full border"
            style={{
              color: groupColor,
              borderColor: groupColor + '44',
              background: groupColor + '18',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 110,
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            {stock.group}
          </span>
        </div>
        <span
          className="font-mono tabular text-[15px] shrink-0"
          style={{
            color: stock.delta >= 0 ? 'var(--color-up)' : 'var(--color-down)',
            fontWeight: 500,
          }}
        >
          {stock.delta >= 0 ? '+' : ''}{stock.delta.toFixed(3)}%
        </span>
      </div>
      {/* line 2: 收 · 1Y · 成交 · YoY — inline with bullet separators */}
      <div className="font-mono tabular text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
        <span style={{ whiteSpace: 'nowrap' }}>
          收 <span style={{ color: 'var(--color-text-secondary)' }}>{fmtPrice(stock.price)}</span>
        </span>
        {ret != null && (
          <>
            <span style={{ color: 'var(--color-bg-500)', margin: '0 6px' }}>·</span>
            <span style={{ whiteSpace: 'nowrap' }}>
              {RETURN_LABEL[returnPeriod]}{' '}
              <span style={{ color: ret >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
                {fmtPctShort(ret)}
              </span>
            </span>
          </>
        )}
        {turnover > 0 && (
          <>
            <span style={{ color: 'var(--color-bg-500)', margin: '0 6px' }}>·</span>
            <span style={{ whiteSpace: 'nowrap' }}>
              成交 <span style={{ color: 'var(--color-text-secondary)' }}>{fmtTurnoverYi(turnover)}</span>
            </span>
          </>
        )}
        {yoy != null && (
          <>
            <span style={{ color: 'var(--color-bg-500)', margin: '0 6px' }}>·</span>
            <span style={{ whiteSpace: 'nowrap' }}>
              YoY{' '}
              <span style={{ color: yoy >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
                {fmtPctShort(yoy)}
              </span>
            </span>
          </>
        )}
      </div>
      </button>

      {/* ★ 收藏按鈕 — overlay 在 row 右上角（對齊 line 1），line 2 metrics 拿回全寬 */}
      {toggleFavorite && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleFavorite(stock.id)
          }}
          aria-label={fav ? '從最愛移除' : '加入最愛'}
          className="absolute flex items-center justify-center transition-colors"
          style={{
            top: 2,
            right: 2,
            width: 32,
            height: 32,
            background: 'transparent',
            border: 0,
            cursor: 'pointer',
            color: fav ? '#fbbf24' : 'var(--color-text-muted)',
            fontSize: 20,
            lineHeight: 1,
            padding: 0,
          }}
        >
          {fav ? '★' : '☆'}
        </button>
      )}
    </div>
  )
}
