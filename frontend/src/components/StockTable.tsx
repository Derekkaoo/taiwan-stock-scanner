import type { StockRow, SortState, ReturnPeriod, TurnoverPeriod, KlineBar } from '../types'
import { RETURN_PERIOD_LABELS, TURNOVER_PERIOD_LABELS } from '../types'
import { THEME_CSS_MAP, TAG_COLORS, getGroupCssClass } from '../constants/themeGroups'
import { CandlestickSVG } from './CandlestickSVG'
import { FundamentalsPanel } from './FundamentalsPanel'
import { CompanyProfilePanel } from './CompanyProfilePanel'
import { EntryAnalysisPanel } from './EntryAnalysisPanel'
import { MAToggleBar } from './MAToggleBar'
import { useEntryAnalysis } from '../hooks/useEntryAnalysis'
import { useState, useEffect } from 'react'

interface ColDef {
  key: keyof StockRow
  label: string
  align: 'left' | 'right'
  mono?: boolean
  render?: (v: StockRow) => React.ReactNode
}

// 包裝 useEntryAnalysis hook（只能在 component 裡用）
function StockEntryAnalysisInline({ stockId }: { stockId: string }) {
  const { data, loading } = useEntryAnalysis(stockId)
  return <EntryAnalysisPanel data={data} loading={loading} />
}

/**
 * 把「億」單位的金額格式化成人類可讀字串
 *  >= 100 億  → 整數億
 *  >= 1 億   → 1 位小數億
 *  < 1 億   → 換算成萬顯示
 */
function formatDeltaAmount(yi: number): string {
  const abs = Math.abs(yi)
  const sign = yi >= 0 ? '+' : '-'
  if (abs >= 100) return `${sign}${abs.toFixed(0)} 億`
  if (abs >= 1)   return `${sign}${abs.toFixed(1)} 億`
  const wan = abs * 10000
  if (wan >= 100) return `${sign}${wan.toFixed(0)} 萬`
  return `${sign}${wan.toFixed(1)} 萬`
}



interface Props {
  stocks: StockRow[]
  sort: SortState
  onSort: (key: keyof StockRow) => void
  returnPeriod: ReturnPeriod
  turnoverPeriod: TurnoverPeriod
  /** 來自 App 層的 useKline（避免 StockTable 自建獨立 cache） */
  fetchGroup: (groupName: string, stockIds: string[], onEach?: (id: string, bars: KlineBar[]) => void) => Promise<void>
  getFromCache: (stockId: string) => KlineBar[] | null
  cacheVersion: number
  /** K 線圖均線顯示偏好（從 App 持久化）*/
  maPeriods: number[]
  setMaPeriods: (p: number[]) => void
  /** K 線圖時間框架（D=日 / W=週 / M=月）*/
  timeframe: 'D' | 'W' | 'M'
  setTimeframe: (t: 'D' | 'W' | 'M') => void
}

export function StockTable({ stocks, sort, onSort, returnPeriod, turnoverPeriod, fetchGroup, getFromCache, cacheVersion, maPeriods, setMaPeriods, timeframe, setTimeframe }: Props) {
  const COLS: ColDef[] = [
    { key: 'id', label: '代號', align: 'left', mono: true,
      render: (s) => {
        const isExpanded = expandedId === s.id
        return (
          <span className="inline-flex items-center gap-2">
            <span
              className="text-[10px] transition-transform duration-200 shrink-0"
              style={{
                display: 'inline-block',
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                color: isExpanded ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
              }}
            >▶</span>
            <span className="font-mono tabular" style={{ color: 'var(--color-accent-cyan)' }}>
              {s.id}
            </span>
          </span>
        )
      }
    },
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
    { key: 'deltaAmount', label: '週增金額', align: 'right', mono: true,
      render: (s) => {
        const amt = s.deltaAmount ?? 0
        if (!amt) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
        return (
          <span className="tabular font-mono" style={{ color: amt >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
            {formatDeltaAmount(amt)}
          </span>
        )
      }
    },
    { key: 'price', label: '收盤價', align: 'right', mono: true,
      render: (s) => <span className="tabular font-mono">{s.price.toFixed(s.price >= 100 ? 1 : 2)}</span>
    },
    { key: 'turnovers', label: `${TURNOVER_PERIOD_LABELS[turnoverPeriod]}成交值`, align: 'right', mono: true,
      render: (s) => {
        const t = s.turnovers?.[turnoverPeriod] ?? 0
        if (!t) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
        // 億元為單位：>=100 億不帶小數、>=10 億 1 位、<10 億 2 位
        const display = t >= 100 ? `${t.toFixed(0)} 億`
                      : t >= 10  ? `${t.toFixed(1)} 億`
                      :            `${t.toFixed(2)} 億`
        return <span className="tabular font-mono" style={{ color: 'var(--color-text-secondary)' }}>{display}</span>
      }
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
    { key: 'revenueYoY', label: '月營收YoY', align: 'right', mono: true,
      render: (s) => {
        const r = s.revenueYoY
        if (r == null) return <span style={{ color: 'var(--color-text-muted)' }}>—</span>
        // 判斷是否為「近期新公佈」：今天在該營收月份的「下一個月 1-10 號」
        // （MOPS 在隔月 1-10 號陸續公告當月營收）
        let isFresh = false
        if (s.revenueMonth) {
          const m = /^(\d{4})-(\d{2})$/.exec(s.revenueMonth)
          if (m) {
            const yy = parseInt(m[1], 10)
            const mm = parseInt(m[2], 10)
            const pubYear = mm === 12 ? yy + 1 : yy
            const pubMonth = mm === 12 ? 1 : mm + 1
            const now = new Date()
            isFresh = now.getFullYear() === pubYear
                   && now.getMonth() + 1 === pubMonth
                   && now.getDate() >= 1
                   && now.getDate() <= 10
          }
        }
        return (
          <span className="inline-flex items-center gap-1 tabular font-mono justify-end">
            {isFresh && (
              <span className="text-[9px] px-1 py-0 rounded font-semibold"
                style={{
                  color: '#fff',
                  background: 'var(--color-accent-cyan)',
                  letterSpacing: '0.5px',
                }}>
                新
              </span>
            )}
            <span style={{ color: r >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
              {r >= 0 ? '+' : ''}{r.toFixed(1)}%
            </span>
          </span>
        )
      }
    },
  ]

  const [expandedId, setExpandedId] = useState<string | null>(null)

  // cacheVersion 一變 → 使用者按了「更新資料」→
  //   展開中的列自動去觸發重新載入（繞開 cache 剛被清空的狀態）
  useEffect(() => {
    if (!expandedId) return
    const stock = stocks.find(st => st.id === expandedId)
    const group = stock?.groups?.[0] ?? stock?.group
    if (stock && group && !getFromCache(stock.id)) {
      fetchGroup(group, [stock.id])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion])

  const handleRowClick = async (id: string) => {
    const willExpand = expandedId !== id
    setExpandedId(willExpand ? id : null)
    if (!willExpand) return
    // Lazy-load K 線資料：找該股票所屬族群檔（第一個 group）
    const stock = stocks.find(st => st.id === id)
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

                </tr>

                {isExpanded && (
                  <tr
                    key={stock.id + '-kline'}
                    style={{ background: 'var(--color-bg-700)', borderBottom: '1px solid var(--color-border)' }}
                  >
                    <td colSpan={COLS.length} className="p-0 md:p-3">
                      {/*
                        手機（< md）：position: sticky + left:0 + width:100vw
                          → 展開內容黏在視窗左邊，不用橫向捲動就能看
                        桌面（≥ md）：靜態佈局，跟原本一樣
                      */}
                      <div className="sticky left-0 w-screen max-w-full p-3 box-border md:static md:left-auto md:w-auto md:max-w-none md:p-0">
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
                      {/* 公司簡介（業務介紹，折疊式）*/}
                      {stock.companyProfile?.business && (
                        <div
                          className="mb-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <CompanyProfilePanel profile={stock.companyProfile} />
                        </div>
                      )}
                      <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-stretch">
                        <div className="w-full md:flex-1 md:min-w-0">
                          {cached && cached.length > 0 ? (
                            <>
                              <div className="mb-1.5" onClick={(e) => e.stopPropagation()}>
                                <MAToggleBar selected={maPeriods} onChange={setMaPeriods} />
                              </div>
                              <CandlestickSVG
                                bars={cached}
                                timeframe={timeframe}
                                onTimeframeChange={setTimeframe}
                                width={600}
                                height={200}
                                showVolume={true}
                                showMA={true}
                                maPeriods={maPeriods}
                                className="w-full"
                              />
                            </>
                          ) : (
                            <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>⚠ 無 K 線資料</span>
                          )}
                        </div>
                        {/* 分隔線：桌面直線、手機橫線 */}
                        <div
                          aria-hidden
                          className="hidden md:block self-stretch"
                          style={{
                            width: 1,
                            background: 'linear-gradient(to bottom, transparent, var(--color-border) 15%, var(--color-border) 85%, transparent)',
                            flexShrink: 0,
                          }}
                        />
                        <div
                          aria-hidden
                          className="block md:hidden w-full"
                          style={{
                            height: 1,
                            background: 'linear-gradient(to right, transparent, var(--color-border) 15%, var(--color-border) 85%, transparent)',
                          }}
                        />
                        <div
                          className="w-full md:flex-1 md:min-w-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FundamentalsPanel fundamentals={stock.fundamentals} />
                        </div>
                      </div>
                      {/* 進場分析（多頭觸發 + 4×3 策略對比）*/}
                      <div
                        aria-hidden
                        className="my-3"
                        style={{
                          height: 1,
                          background: 'linear-gradient(to right, transparent, var(--color-border) 15%, var(--color-border) 85%, transparent)',
                        }}
                      />
                      <div onClick={(e) => e.stopPropagation()}>
                        <div className="text-[10px] mb-2" style={{ color: 'var(--color-text-muted)' }}>
                          📊 進場分析（多頭觸發後的歷史回測模式）
                        </div>
                        <StockEntryAnalysisInline stockId={stock.id} />
                      </div>
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