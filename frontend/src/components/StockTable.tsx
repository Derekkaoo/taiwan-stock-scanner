import type { StockRow, SortState, ReturnPeriod } from '../types'
import { RETURN_PERIOD_LABELS } from '../types'
import { THEME_CSS_MAP, TAG_COLORS, getGroupCssClass } from '../constants/themeGroups'
import { CandlestickSVG } from './CandlestickSVG'
import { useKline } from '../hooks/useKline'
import { useEffect, useState } from 'react'

interface ColDef {
  key: keyof StockRow
  label: string
  align: 'left' | 'right'
  mono?: boolean
  render?: (v: StockRow) => React.ReactNode
}



interface Props {
  stocks: StockRow[]
  sort: SortState
  onSort: (key: keyof StockRow) => void
  returnPeriod: ReturnPeriod
}

export function StockTable({ stocks, sort, onSort, returnPeriod }: Props) {
  const COLS: ColDef[] = [
    { key: 'id',   label: '代號', align: 'left', mono: true },
    { key: 'name', label: '名稱', align: 'left' },
    { key: 'group', label: '族群', align: 'left',
      render: (s) => {
        const css = getGroupCssClass(s.group)
        const c   = TAG_COLORS[css] ?? '#6b7280'
        return (
          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border"
            style={{ color: c, borderColor: c + '44', background: c + '18', whiteSpace: 'nowrap' }}>
            {s.group}
          </span>
        )
      }
    },
    { key: 'holdingPct', label: '持股%', align: 'right', mono: true,
      render: (s) => <span className="tabular font-mono">{s.holdingPct.toFixed(2)}%</span>
    },
    { key: 'delta', label: '週增%', align: 'right', mono: true,
      render: (s) => (
        <span className="tabular font-mono" style={{ color: s.delta >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
          +{s.delta.toFixed(3)}%
        </span>
      )
    },
    { key: 'price', label: '收盤價', align: 'right', mono: true,
      render: (s) => <span className="tabular font-mono">{s.price.toFixed(s.price >= 100 ? 1 : 2)}</span>
    },
    { key: 'threeMonthReturn', label: `${RETURN_PERIOD_LABELS[returnPeriod]}漲幅`, align: 'right', mono: true,
      render: (s) => {
        const rv = s.returns && s.returns[returnPeriod]
        const r  = rv == null ? s.threeMonthReturn : rv
        if (r == null) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
        return (
          <span className="tabular font-mono" style={{ color: r >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
            {r >= 0 ? '+' : ''}{r.toFixed(1)}%
          </span>
        )
      }
    },
  ]

  const { getFromCache, loadFromJson } = useKline()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    loadFromJson()
  }, [])

  const handleRowClick = (id: string) => {
    setExpandedId(prev => prev === id ? null : id)
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
                    <span className="ml-1 text-[9px]">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                  )}
                </th>
              )
            })}
            <th className="px-3 py-2 text-right" style={{ color: 'var(--color-text-muted)' }}>
              K 線
            </th>
          </tr>
        </thead>
        <tbody>
          {stocks.map(stock => {
            const isExpanded = expandedId === stock.id
            const cached = getFromCache(stock.id)
            return (
              <>
                <tr
                  key={stock.id}
                  className="border-b transition-colors cursor-pointer"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: isExpanded ? 'var(--color-bg-500)' : '',
                  }}
                  onClick={() => handleRowClick(stock.id)}
                  onMouseEnter={e => {
                    if (!isExpanded)
                      (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-500)'
                  }}
                  onMouseLeave={e => {
                    if (!isExpanded)
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
                  <td className="px-3 py-1.5 text-right">
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  </td>
                </tr>

                {isExpanded && (
                  <tr
                    key={stock.id + '-kline'}
                    style={{ background: 'var(--color-bg-700)', borderBottom: '1px solid var(--color-border)' }}
                  >
                    <td colSpan={COLS.length + 1} className="p-3">
                      <div className="flex items-center flex-wrap gap-2 mb-2">
                        <span className="font-mono font-bold tabular text-xs" style={{ color: 'var(--color-accent-cyan)' }}>
                          {stock.id}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{stock.name}</span>
                        {(stock.subIndustries ?? []).map(si => (
                          <span key={si} className="text-[11px] px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--color-bg-500)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                            {si}
                          </span>
                        ))}
                      </div>
                      <div style={{ width: '50%', minWidth: 200 }}>
                        {cached ? (
                          <CandlestickSVG
                            data={cached.slice(-90)}
			    fullData={cached}
                            width={600}
                            height={200}
                            showVolume={true}
                            showMA={true}
                            className="w-full"
                          />
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>⚠ 無 K 線資料</span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}