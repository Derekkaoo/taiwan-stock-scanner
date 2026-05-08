import { useState, useCallback, useEffect } from 'react'
import type { StockRow, KlineBar, ReturnPeriod } from '../types'
import { RETURN_PERIOD_LABELS } from '../types'
import { THEME_CSS_MAP, TAG_COLORS, getGroupCssClass } from '../constants/themeGroups'
import { CandlestickSVG } from './CandlestickSVG'
import { MAToggleBar } from './MAToggleBar'
import { calcThreeMonthReturn } from '../hooks/useKline'

interface Props {
  groupName: string
  stocks: StockRow[]
  fetchGroup: (ids: string[], onEach?: (id: string, bars: KlineBar[]) => void) => Promise<void>
  getFromCache: (id: string) => KlineBar[] | null
  returnPeriod: ReturnPeriod
  /** App 層 cache 版本；變動時代表使用者按了「更新資料」，已展開的卡片要重新載入 */
  cacheVersion?: number
  /** 我的最愛（從 useFavorites 傳進來）*/
  isFavorite?: (stockId: string) => boolean
  toggleFavorite?: (stockId: string) => void
  /** K 線圖均線顯示偏好（從 App 持久化）*/
  maPeriods?: number[]
  setMaPeriods?: (p: number[]) => void
  /** K 線圖時間框架（D=日 / W=週 / M=月）*/
  timeframe?: 'D' | 'W' | 'M'
  setTimeframe?: (t: 'D' | 'W' | 'M') => void
}

function fmt(v: number | null, digits = 2) {
  if (v === null || v === undefined) return '—'
  return v.toFixed(digits)
}

/** 把 lastSeenDate（YYYY-MM-DD）轉成「N 天前 / N 週前 / N 月前」 */
function formatStaleness(lastSeenDate?: string): string {
  if (!lastSeenDate) return ''
  const last = new Date(lastSeenDate)
  if (isNaN(last.getTime())) return ''
  const days = Math.max(0, Math.floor((Date.now() - last.getTime()) / 86400000))
  if (days < 7) return `${days} 天前`
  const weeks = Math.floor(days / 7)
  if (weeks < 8) return `${weeks} 週前`
  const months = Math.floor(days / 30)
  return `${months} 月前`
}

/** 取這個股票在「本族群」下相關的細產業；若沒 subsByGroup 則 fallback 用全部 */
function getSubsForGroup(stock: StockRow, groupName: string): string[] {
  if (stock.subsByGroup && stock.subsByGroup[groupName]) {
    return stock.subsByGroup[groupName]
  }
  return stock.subIndustries ?? []
}

export function GroupCard({ groupName, stocks, fetchGroup, getFromCache, returnPeriod, cacheVersion, isFavorite, toggleFavorite, maPeriods, setMaPeriods, timeframe, setTimeframe }: Props) {
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
  // 本族群本週總增持金額（億）
  const totalDeltaAmount = stocks.reduce((s, x) => s + (x.deltaAmount ?? 0), 0)
  const retVals   = stocks.map(getRet).filter((x): x is number => x != null)
  const avgRet    = retVals.length ? retVals.reduce((s, x) => s + x, 0) / retVals.length : null
  const retLabel  = `${RETURN_PERIOD_LABELS[returnPeriod]}漲幅`
  const groupDesc = stocks[0]?.groupDesc ?? ''

  const fmtAmount = (yi: number): string => {
    const abs = Math.abs(yi)
    const sign = yi >= 0 ? '+' : '-'
    if (abs >= 100) return `${sign}${abs.toFixed(0)} 億`
    if (abs >= 1)   return `${sign}${abs.toFixed(1)} 億`
    const wan = abs * 10000
    if (wan >= 100) return `${sign}${wan.toFixed(0)} 萬`
    return `${sign}${wan.toFixed(1)} 萬`
  }

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

  /**
   * 共用載入邏輯（不用 `loaded` 當守門員，改用 useKline 內部的 loadedGroups 去重）。
   * `force=true` 代表來自「更新資料」→ 強制重新從 useKline 拉最新（loadedGroups
   * 已經被 clearCache 清掉了，所以會真的去網路重抓）。
   */
  const doLoad = useCallback(async () => {
    setLoading(true)
    const fromCache: Record<string, KlineBar[]> = {}
    stocks.forEach(s => {
      const cached = getFromCache(s.id)
      if (cached) fromCache[s.id] = cached
    })
    if (Object.keys(fromCache).length > 0) {
      setKlineMap(prev => ({ ...prev, ...fromCache }))
    }
    const missing = stocks.filter(s => !fromCache[s.id]).map(s => s.id)
    if (missing.length > 0) {
      await fetchGroup(missing, (id, bars) =>
        setKlineMap(prev => ({ ...prev, [id]: bars }))
      )
    }
    setLoaded(true)
    setLoading(false)
  }, [fetchGroup, stocks, getFromCache])

  const openAndLoad = useCallback(async () => {
    setExpanded(true)
    if (!loaded) await doLoad()
  }, [loaded, doLoad])

  // cacheVersion 一變 → 使用者按了「更新資料」
  //   - 展開中：直接觸發 doLoad，讓新 K 線到齊後才覆蓋 klineMap（避免閃空白）
  //   - 折疊中：只重置 loaded / klineMap，下次展開時會重抓
  useEffect(() => {
    if (cacheVersion === undefined) return
    setLoaded(false)
    if (expanded) {
      doLoad()
    } else {
      setKlineMap({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheVersion])

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
            <span className="text-sm font-bold px-2.5 py-0.5 rounded-full border shrink-0"
              style={{ color, borderColor: color + '44', background: color + '18', whiteSpace: 'nowrap' }}>
              {groupName}
            </span>
            <span className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)' }}>
              {stocks.length} 支
            </span>
          </div>

          {groupDesc && (
            <span className="text-[11px]" style={{ color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
              {groupDesc}
            </span>
          )}

          {/* 桌機：inline flex（保留原本網頁版排法）*/}
          <div className="hidden md:flex items-center gap-3 font-mono tabular text-[12px] flex-wrap">
            <span style={{ color: avgDelta >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
              均增持 +{fmt(avgDelta, 3)}%
            </span>
            {totalDeltaAmount > 0 && (
              <span style={{ color: 'var(--color-up)' }}>
                週增金額 {fmtAmount(totalDeltaAmount)}
              </span>
            )}
            {avgRet !== null && (
              <span style={{ color: avgRet >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
                {retLabel} {avgRet >= 0 ? '+' : ''}{fmt(avgRet, 1)}%
              </span>
            )}
          </div>

          {/* 手機：3 欄等寬 metric grid（值大 / label 小，整齊對齊）*/}
          <div className="grid grid-cols-3 gap-1 mt-0.5 md:hidden">
            <div>
              <div
                className="font-mono tabular text-[13px]"
                style={{
                  color: avgDelta >= 0 ? 'var(--color-up)' : 'var(--color-down)',
                  fontWeight: 600,
                }}
              >
                +{fmt(avgDelta, 3)}%
              </div>
              <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>均增持</div>
            </div>
            <div>
              <div
                className="font-mono tabular text-[13px]"
                style={{
                  color: totalDeltaAmount > 0 ? 'var(--color-up)'
                       : totalDeltaAmount < 0 ? 'var(--color-down)'
                       : 'var(--color-text-muted)',
                  fontWeight: 600,
                }}
              >
                {totalDeltaAmount !== 0 ? fmtAmount(totalDeltaAmount) : '—'}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>週增金額</div>
            </div>
            <div>
              <div
                className="font-mono tabular text-[13px]"
                style={{
                  color: avgRet === null ? 'var(--color-text-muted)'
                       : avgRet >= 0 ? 'var(--color-up)' : 'var(--color-down)',
                  fontWeight: 600,
                }}
              >
                {avgRet === null ? '—' : `${avgRet >= 0 ? '+' : ''}${fmt(avgRet, 1)}%`}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{retLabel}</div>
            </div>
          </div>

          {/* 細產業 chips：只在「展開狀態」顯示，避免摺疊時畫面太擠 */}
          {expanded && topSubIndustries.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {topSubIndustries.map(([name, count]) => (
                <span key={name} className="text-[12px] px-2 py-0.5 rounded"
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

              const isGhost = stock._isGhost === true
              return (
                <div key={stock.id} className="rounded border overflow-hidden"
                  style={{
                    borderColor: 'var(--color-border)',
                    background: 'var(--color-bg-700)',
                    opacity: isGhost ? 0.7 : 1,
                  }}>

                  <div className="px-2.5 py-1.5 border-b" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 flex-1 min-w-0">
                        {toggleFavorite && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleFavorite(stock.id) }}
                            className="cursor-pointer transition-transform hover:scale-110 shrink-0"
                            style={{
                              fontSize: 14,
                              lineHeight: 1,
                              color: isFavorite?.(stock.id) ? '#fbbf24' : 'var(--color-text-muted)',
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                            }}
                            title={isFavorite?.(stock.id) ? '從最愛移除' : '加入最愛'}
                          >
                            {isFavorite?.(stock.id) ? '★' : '☆'}
                          </button>
                        )}
                        <span className="font-mono font-bold tabular text-xs" style={{ color: 'var(--color-accent-cyan)' }}>
                          {stock.id}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{stock.name}</span>
                        {isGhost && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{
                              background: 'var(--color-bg-600)',
                              color: 'var(--color-text-muted)',
                              border: '1px solid var(--color-border)',
                              whiteSpace: 'nowrap',
                            }}
                            title={
                              `本週大戶持股增幅 < 0.1%，未進入當週榜單。\n` +
                              `顯示的 K 線/基本面是上次入榜時的舊資料` +
                              (stock._lastSeenDate ? `（${formatStaleness(stock._lastSeenDate)}）` : '') +
                              `，不再每週更新。`
                            }
                          >
                            本週未入榜
                            {stock._lastSeenDate && (
                              <span style={{ marginLeft: 4, opacity: 0.7 }}>
                                · 資料 {formatStaleness(stock._lastSeenDate)}
                              </span>
                            )}
                          </span>
                        )}
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
                        {(stock.deltaAmount ?? 0) > 0 && (
                          <span style={{ color: 'var(--color-text-muted)', fontSize: 10, marginLeft: 4 }}>
                            ({fmtAmount(stock.deltaAmount ?? 0)})
                          </span>
                        )}
                      </span>
                      <span style={{ color: retColor }}>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 9 }}>{retLabel} </span>
                        {ret !== null ? `${ret >= 0 ? '+' : ''}${fmt(ret, 1)}%` : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="p-1">
                    {bars && bars.length > 0 ? (
                      <>
                        {maPeriods && setMaPeriods && (
                          <div className="mb-1.5" onClick={(e) => e.stopPropagation()}>
                            <MAToggleBar selected={maPeriods} onChange={setMaPeriods} />
                          </div>
                        )}
                        <CandlestickSVG
                          bars={bars}
                          timeframe={timeframe}
                          onTimeframeChange={setTimeframe}
                          width={400}
                          height={200}
                          showVolume={true}
                          showMA={true}
                          maPeriods={maPeriods}
                          className="w-full"
                        />
                      </>
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
