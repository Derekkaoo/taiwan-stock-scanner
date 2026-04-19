// ============================================================
//  StockTable — 可排序股票主表格
//  數字欄位一律 font-mono + tabular-nums
// ============================================================
import type { StockRow, SortState } from '../types'
import { THEME_CSS_MAP, TAG_COLORS } from '../constants/themeGroups'
import { SparklineSVG } from './CandlestickSVG'
import { useKline } from '../hooks/useKline'

interface ColDef {
  key: keyof StockRow
  label: string
  align: 'left' | 'right'
  mono?: boolean
  render?: (v: StockRow) => React.ReactNode
}

const COLS: ColDef[] = [
  { key: 'id',         label: '代號',    align: 'left',  mono: true },
  { key: 'name',       label: '名稱',    align: 'left' },
  { key: 'group',      label: '族群',    align: 'left',
    render: (s) => {
      const css = THEME_CSS_MAP[s.group] ?? 'tag-other'
      const c   = TAG_COLORS[css] ?? '#6b7280'
      return (
        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border"
          style={{ color: c, borderColor: c + '44', background: c + '18', whiteSpace: 'nowrap' }}>
          {s.group}
        </span>
      )
    }
  },
  { key: 'holdingPct', label: '持股%',   align: 'right', mono: true,
    render: (s) => <span className="tabular font-mono">{s.holdingPct.toFixed(2)}%</span>
  },
  { key: 'delta',      label: '週增%',   align: 'right', mono: true,
    render: (s) => (
      <span className="tabular font-mono" style={{ color: s.delta >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
        +{s.delta.toFixed(3)}%
      </span>
    )
  },
  { key: 'price',      label: '收盤價',  align: 'right', mono: true,
    render: (s) => <span className="tabular font-mono">{s.price.toFixed(s.price >= 100 ? 1 : 2)}</span>
  },
  { key: 'marketCap',  label: '市值(億)', align: 'right', mono: true,
    render: (s) => (
      <span className="tabular font-mono" style={{ color: 'var(--color-text-secondary)' }}>
        {s.marketCap > 0 ? s.marketCap.toLocaleString() : '—'}
      </span>
    )
  },
  { key: 'threeMonthReturn', label: '3M報酬', align: 'right', mono: true,
    render: (s) => {
      const r = s.threeMonthReturn
      if (r === null) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
      return (
        <span className="tabular font-mono" style={{ color: r >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
          {r >= 0 ? '+' : ''}{r.toFixed(1)}%
        </span>
      )
    }
  },
  { key: 'date', label: '更新日', align: 'right',
    render: (s) => <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{s.date}</span>
  },
]

interface Props {
  stocks: StockRow[]
  sort: SortState
  onSort: (key: keyof StockRow) => void
}

export function StockTable({ stocks, sort, onSort }: Props) {
  const { getFromCache } = useKline()

  if (!stocks.length) {
    return (
      <div className="flex items-center justify-center py-16" style={{ color: 'var(--color-text-muted)' }}>
        <div className="text-center">
          <div className="text-lg mb-2">📭</div>
          <div className="text-sm">無符合條件的資料</div>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--color-border)' }}>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr style={{ background: 'var(--color-bg-600)', borderBottom: '1px solid var(--color-border)' }}>
            {COLS.map(col => {
              const active = sort.key === col.key
              return (
                <th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  className="px-3 py-2 cursor-pointer select-none font-semibold whitespace-nowrap transition-colors"
                  style={{
                    textAlign: col.align,
                    color: active ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
                  }}
                >
                  {col.label}
                  {active && (
                    <span className="ml-1 text-[9px]">{sort.dir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
              )
            })}
            <th className="px-3 py-2" style={{ color: 'var(--color-text-muted)', textAlign: 'right' }}>
              走勢
            </th>
          </tr>
        </thead>
        <tbody>
          {stocks.map(stock => {
            const cached = getFromCache(stock.id)
            return (
              <tr
                key={stock.id}
                className="border-b transition-colors"
                style={{
                  borderColor: 'var(--color-border)',
                  cursor: 'default',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-500)'
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = ''
                }}
              >
                {COLS.map(col => (
                  <td
                    key={col.key}
                    className="px-3 py-1.5 whitespace-nowrap"
                    style={{ textAlign: col.align }}
                  >
                    {col.render ? col.render(stock) : (
                      <span className={col.mono ? 'font-mono tabular' : ''}>
                        {String(stock[col.key] ?? '—')}
                      </span>
                    )}
                  </td>
                ))}
                {/* 迷你 Sparkline */}
                <td className="px-3 py-1.5" style={{ textAlign: 'right' }}>
                  {cached ? (
                    <SparklineSVG data={cached} width={72} height={24} />
                  ) : (
                    <span style={{ color: 'var(--color-text-disabled)', fontSize: 10 }}>—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
