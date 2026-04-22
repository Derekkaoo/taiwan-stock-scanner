import { useState, useCallback } from 'react'
import type { StockRow, KlineBar, ReturnPeriod } from '../types'
import { RETURN_PERIOD_LABELS } from '../types'
import { THEME_CSS_MAP, TAG_COLORS, getGroupCssClass } from '../constants/themeGroups'
import { CandlestickSVG } from './CandlestickSVG'
import { calcThreeMonthReturn } from '../hooks/useKline'

interface Props {
  groupName: string
  stocks: StockRow[]
  fetchGroup: (ids: string[], onEach?: (id: string, bars: KlineBar[]) => void) => Promise<void>
  getFromCache: (id: string) => KlineBar[] | null
  returnPeriod: ReturnPeriod
}

function fmt(v: number | null, digits = 2) {
  if (v === null || v === undefined) return '—'
  return v.toFixed(digits)
}

/** 取這個股票在「本族群」下相關的細產業；若沒 subsByGroup 則 fallback 用全部 */
function getSubsForGroup(stock: StockRow, groupName: string): string[] {
  if (stock.subsByGroup && stock.subsByGroup[groupName]) {
    return stock.subsByGroup[groupName]
  }
  return stock.subIndustries ?? []
}

export function GroupCard({ groupName, stocks, fetchGroup, getFromCache, returnPeriod }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [klineMap, setKlineMap] = useState<Record<string, KlineBar[]>>({})
  const [loading,  setLoading]  = useState(false)
  const [loaded,   setLoaded]   = useState(false)

  const cssClass = getGroupCssClass(groupName)
  const color    = TAG_COLORS[cssClass] ?? '#6b7280'

  const getRet = (s: StockRow): number | null => {
    const v = s.returns && s.returns[returnPeriod]
    return v == null ? s.threeMonthReturn : v
  }
  const avgDelta  = stocks.reduce((s, x) => s + x.delta, 0) / stocks.length
  const retVals   = stocks.map(getRet).filter((x): x is number => x != null)
  const avgRet    = retVals.length ? retVals.reduce((s, x) => s + x, 0) / retVals.length : null
  const retLabel  = `${RETURN_PERIOD_LABELS[returnPeriod]}漲幅`
  const groupDesc = stocks[0]?.groupDesc ?? ''

  // 本族群內最常出現的細產業 Top 3（aggregate chips）— 只算跟此族群相關的
  const topSubIndustries = (() => {
    const counts = new Map<string, number>()
    stocks.forEach(s => {
      for (const sub of getSubsForGroup(s, groupName)) {
        counts.set(sub, (counts.get(sub) ?? 0) + 1)
      }
    })
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
  })()

  const openAndLoad = useCallback(async () => {
    setExpanded(true)
    if (!loaded) {
      setLoading(true)
      const fromCache: Record<string, KlineBar[]> = {}
      stocks.forEach(s => {
        const cached = getFromCache(s.id)
        if (cached) fromCache[s.id] = cached
      })
      if (Object.keys(fromCache).length > 0) setKlineMap(prev => ({ ...prev, ...fromCache }))
      const missing = stocks.filter(s => !fromCache[s.id]).map(s => s.id)
      if (missing.length > 0) {
        await fetchGroup(missing, (id, bars) => setKlineMap(prev => ({ ...prev, [id]: bars })))
      }
      setLoaded(true)
      setLoading(false)
    }
  }, [loaded, fetchGroup, stocks, getFromCache])

  const handleToggle = useCallback(async () => {
    if (expanded) {
      setExpanded(false)
    } else {
      await openAndLoad()
    }
  }, [expanded, openAndLoad])

  const getKline = (id: string) => klineMap[id] ?? getFromCache(id)

  return (
    <div className="rounded border transition-colors duration-150"
      style={{ borderColor: expanded ? color + '55' : 'var(--color-border)', background: 'var(--color-bg-600)' }}>

      <button onClick={handleToggle}
        className="w-full text-left px-4 py-2.5 flex items-start gap-2 hover:bg-[var(--color-bg-500)] transition-colors rounded-t select-none"
        aria-expanded={expanded}>

        <span className="text-[10px] transition-transform duration-200 shrink-0 mt-1" style={{
          display: 'inline-block',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          color: 'var(--color-text-muted)',
        }}>▶</span>

        <div className="flex flex-col gap-0.5 flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold px-2 py-0.5 rounded-full border shrink-0"
              style={{ color, borderColor: color + '44', background: color + '18', whiteSpace: 'nowrap' }}>
              {groupName}
            </span>
            <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>
              {stocks.length} 支
            </span>
          </div>

          {groupDesc && (
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
              {groupDesc}
            </span>
          )}

          <div className="flex items-center gap-3 font-mono tabular text-[11px]">
            <span style={{ color: avgDelta >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
              均增持 +{fmt(avgDelta, 3)}%
            </span>
            {avgRet !== null && (
              <span style={{ color: avgRet >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
                {retLabel} {avgRet >= 0 ? '+' : ''}{fmt(avgRet, 1)}%
              </span>
            )}
          </div>

          {topSubIndustries.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {topSubIndustries.map(([name, count]) => (
                <span key={name} className="text-[11px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--color-bg-500)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                  {name} <span style={{ opacity: 0.55 }}>×{count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t px-3 py-3" style={{ borderColor: 'var(--color-border)' }}>
          {loading && (
            <div className="flex items-center gap-2 py-6 justify-center" style={{ color: 'var(--color-text-muted)' }}>
              <span className="animate-spin inline-block w-4 h-4 border-2 rounded-full"
                style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent-blue)' }} />
              <span className="text-xs">載入 K 線資料…</span>
            </div>
          )}
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {stocks.map(stock => {
              const bars = getKline(stock.id)
              const ret  = getRet(stock)
              const retColor = ret === null ? 'var(--color-text-muted)'
                : ret >= 0 ? 'var(--color-up)' : 'var(--color-down)'
              const stockSubs = getSubsForGroup(stock, groupName)

              return (
                <div key={stock.id} className="rounded border overflow-hidden"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-700)' }}>

                  <div className="px-2.5 py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 flex-1 min-w-0">
                        <span className="font-mono font-bold tabular text-xs" style={{ color: 'var(--color-accent-cyan)' }}>
                          {stock.id}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{stock.name}</span>
                        {stockSubs.map(si => (
                          <span key={si} className="text-[11px] px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--color-bg-500)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                            {si}
                          </span>
                        ))}
                      </div>
                      <span className="font-mono tabular text-xs shrink-0" style={{ color: 'var(--color-text-primary)' }}>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 9 }}>收 </span>
                        {fmt(stock.price, stock.price >= 100 ? 1 : 2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between font-mono tabular text-[11px]">
                      <span style={{ color: 'var(--color-up)' }}>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 9 }}>週增持 </span>
                        +{fmt(stock.delta, 3)}%
                      </span>
                      <span style={{ color: retColor }}>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 9 }}>{retLabel} </span>
                        {ret !== null ? `${ret >= 0 ? '+' : ''}${fmt(ret, 1)}%` : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="p-1">
                    {bars && bars.length > 0 ? (
                      <CandlestickSVG
                        data={bars.slice(-65)}
                        fullData={bars}
                        width={400}
                        height={200}
                        showVolume={true}
                        showMA={true}
                        className="w-full"
                      />
                    ) : (
                      <div className="flex items-center justify-center text-xs h-[150px]"
                        style={{ color: 'var(--color-text-muted)' }}>
                        {loading ? '載入中…' : '⚠ 無 K 線資料'}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
