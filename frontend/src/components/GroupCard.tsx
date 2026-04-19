import { useState, useCallback, useEffect } from 'react'
import type { StockRow, KlineBar } from '../types'
import { THEME_CSS_MAP, TAG_COLORS } from '../constants/themeGroups'
import { CandlestickSVG } from './CandlestickSVG'
import { calcThreeMonthReturn } from '../hooks/useKline'

interface Props {
  groupName: string
  stocks: StockRow[]
  fetchGroup: (ids: string[], onEach?: (id: string, bars: KlineBar[]) => void) => Promise<void>
  getFromCache: (id: string) => KlineBar[] | null
  forceExpand?: boolean
  forceCollapse?: boolean
}

function fmt(v: number | null, digits = 2) {
  if (v === null || v === undefined) return '—'
  return v.toFixed(digits)
}

export function GroupCard({ groupName, stocks, fetchGroup, getFromCache, forceExpand, forceCollapse }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [klineMap, setKlineMap] = useState<Record<string, KlineBar[]>>({})
  const [loading,  setLoading]  = useState(false)
  const [loaded,   setLoaded]   = useState(false)

  const cssClass = THEME_CSS_MAP[groupName] ?? 'tag-other'
  const color    = TAG_COLORS[cssClass] ?? '#6b7280'

  const avgDelta  = stocks.reduce((s, x) => s + x.delta, 0) / stocks.length
  const retStocks = stocks.filter(s => s.threeMonthReturn !== null)
  const avgRet    = retStocks.length
    ? retStocks.reduce((s, x) => s + x.threeMonthReturn!, 0) / retStocks.length
    : null
  const groupDesc = (stocks[0] as StockRow & { groupDesc?: string })?.groupDesc ?? ''

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

  useEffect(() => {
    if (forceExpand) openAndLoad()
  }, [forceExpand])

  useEffect(() => {
    if (forceCollapse) setExpanded(false)
  }, [forceCollapse])

  const getKline = (id: string) => klineMap[id] ?? getFromCache(id)

  return (
    <div className="rounded border transition-colors duration-150"
      style={{ borderColor: expanded ? color + '55' : 'var(--color-border)', background: 'var(--color-bg-600)' }}>

      <button onClick={handleToggle}
        className="w-full text-left px-4 py-2.5 flex items-center gap-3 hover:bg-[var(--color-bg-500)] transition-colors rounded-t select-none"
        aria-expanded={expanded}>
        <span className="text-[10px] transition-transform duration-200" style={{
          display: 'inline-block',
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          color: 'var(--color-text-muted)',
        }}>▶</span>

        <span className="text-xs font-bold px-2 py-0.5 rounded-full border whitespace-nowrap"
          style={{ color, borderColor: color + '44', background: color + '18' }}>
          {groupName}
        </span>

        {groupDesc && (
          <span className="text-[11px] hidden sm:block" style={{ color: 'var(--color-text-muted)' }}>
            {groupDesc}
          </span>
        )}

        <span className="font-mono tabular text-xs ml-auto flex items-center gap-4 shrink-0">
          <span style={{ color: 'var(--color-text-muted)' }}>{stocks.length} 支</span>
          <span
            title="本週大股東持股週增幅平均值（非股價漲跌）"
            style={{ color: avgDelta >= 0 ? 'var(--color-up)' : 'var(--color-down)', cursor: 'help' }}
          >
            均增持 +{fmt(avgDelta, 3)}%
          </span>
          {avgRet !== null && (
            <span
              title="近三個月股價報酬率平均值"
              style={{ color: avgRet >= 0 ? 'var(--color-up)' : 'var(--color-down)', cursor: 'help' }}
            >
              3個月報酬 {avgRet >= 0 ? '+' : ''}{fmt(avgRet, 1)}%
            </span>
          )}
        </span>
      </button>

      {expanded && (
        <div className="border-t px-3 py-3 animate-fadein" style={{ borderColor: 'var(--color-border)' }}>
          {loading && (
            <div className="flex items-center gap-2 py-6 justify-center" style={{ color: 'var(--color-text-muted)' }}>
              <span className="animate-spin inline-block w-4 h-4 border-2 rounded-full"
                style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-accent-blue)' }} />
              <span className="text-xs">載入 K 線資料…</span>
            </div>
          )}
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            {stocks.map(stock => {
              const bars = getKline(stock.id)
              const ret  = bars ? calcThreeMonthReturn(bars) : null
              const retColor = ret === null ? 'var(--color-text-muted)'
                : ret >= 0 ? 'var(--color-up)' : 'var(--color-down)'

              return (
                <div key={stock.id} className="rounded border overflow-hidden"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-700)' }}>

                  <div className="flex items-center justify-between px-2.5 py-1.5 border-b"
                    style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold tabular text-xs" style={{ color: 'var(--color-accent-cyan)' }}>
                        {stock.id}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{stock.name}</span>
                    </div>
                    <div className="flex items-center gap-2 font-mono tabular text-[11px]">
                      <span title="收盤價" style={{ color: 'var(--color-text-primary)' }}>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 9 }}>收 </span>
                        {fmt(stock.price, stock.price >= 100 ? 1 : 2)}
                      </span>
                      <span title="本週大股東持股週增幅（非股價漲跌）" style={{ color: 'var(--color-up)', cursor: 'help' }}>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 9 }}>週增持 </span>
                        +{fmt(stock.delta, 3)}%
                      </span>
                      <span title="近三個月股價報酬率" style={{ color: retColor, cursor: 'help' }}>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 9 }}>3個月報酬 </span>
                        {ret !== null ? `${ret >= 0 ? '+' : ''}${fmt(ret, 1)}%` : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="p-1">
                    {bars ? (
                      <CandlestickSVG data={bars} width={316} height={150} showVolume={true} showMA={true} className="w-full" />
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