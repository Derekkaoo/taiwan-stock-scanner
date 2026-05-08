// ============================================================
//  手機個股 detail view
//  - 取代 inline expand：tap row 進入這個 view，不在列表內展開
//  - 上方 prev/next 按鈕在列表順序內切換股票
//  - 完整 K 線 + Fundamentals + 進場分析（折疊式）
// ============================================================
import { useEffect, useState } from 'react'
import type { StockRow, KlineBar, ReturnPeriod, TurnoverPeriod } from '../types'
import { TAG_COLORS, getGroupCssClass } from '../constants/themeGroups'
import { CandlestickSVG } from './CandlestickSVG'
import { CompanyProfilePanel } from './CompanyProfilePanel'
import { FundamentalsPanel } from './FundamentalsPanel'
import { EntryAnalysisPanel } from './EntryAnalysisPanel'
import { MAToggleBar } from './MAToggleBar'
import { useEntryAnalysis } from '../hooks/useEntryAnalysis'

interface Props {
  /** 排序+篩選後的列表（用於 prev/next 導航）*/
  stocks: StockRow[]
  /** 目前顯示的股票 id */
  currentId: string
  returnPeriod: ReturnPeriod
  turnoverPeriod: TurnoverPeriod
  fetchGroup: (groupName: string, ids: string[], onEach?: (id: string, bars: KlineBar[]) => void) => Promise<void>
  getFromCache: (id: string) => KlineBar[] | null
  cacheVersion: number
  maPeriods: number[]
  setMaPeriods: (p: number[]) => void
  timeframe: 'D' | 'W' | 'M'
  setTimeframe: (t: 'D' | 'W' | 'M') => void
  /** 返回列表 */
  onClose: () => void
  /** 切換到 prev/next 股票 */
  onChange: (newId: string) => void
}

const RETURN_LABEL: Record<ReturnPeriod, string> = {
  w1: '1週', m1: '1月', m3: '3月', m6: '6月', y1: '1Y',
}

function fmtPrice(p: number) {
  return p.toFixed(p >= 100 ? 1 : 2)
}
function fmtTurnoverYi(yi: number) {
  if (yi >= 100) return `${yi.toFixed(0)}億`
  if (yi >= 10)  return `${yi.toFixed(1)}億`
  return `${yi.toFixed(2)}億`
}
function fmtPctShort(r: number) {
  return `${r >= 0 ? '+' : ''}${r.toFixed(0)}%`
}

/** wrap useEntryAnalysis hook（hook 只能在 component 裡呼叫）*/
function StockEntryAnalysisInline({ stockId }: { stockId: string }) {
  const { data, loading } = useEntryAnalysis(stockId)
  return <EntryAnalysisPanel data={data} loading={loading} />
}

/** scroll page 把 detail view 的頂端對齊到 sticky 下方（露出 ← 列表 + 股票名稱）*/
function scrollDetailIntoView() {
  const detail = document.querySelector<HTMLElement>('[data-mobile-detail]')
  if (!detail) return
  // 動態量 sticky 總高
  let stickyBottom = 0
  document.querySelectorAll<HTMLElement>('[class*="sticky"]').forEach(s => {
    if (getComputedStyle(s).position !== 'sticky') return
    const r = s.getBoundingClientRect()
    if (r.top < 100 && r.bottom > stickyBottom) stickyBottom = r.bottom
  })
  const rect = detail.getBoundingClientRect()
  const targetY = window.scrollY + rect.top - stickyBottom
  window.scrollTo({ top: Math.max(0, targetY), behavior: 'auto' })
}

export function MobileStockDetail({
  stocks, currentId,
  returnPeriod, turnoverPeriod,
  fetchGroup, getFromCache, cacheVersion,
  maPeriods, setMaPeriods, timeframe, setTimeframe,
  onClose, onChange,
}: Props) {
  const [entryOpen, setEntryOpen] = useState(false)

  const idx       = stocks.findIndex(s => s.id === currentId)
  const stock     = idx >= 0 ? stocks[idx] : null
  const prevStock = idx > 0 ? stocks[idx - 1] : null
  const nextStock = idx >= 0 && idx < stocks.length - 1 ? stocks[idx + 1] : null

  // Lazy load K line on mount + currentId change + cacheVersion change
  useEffect(() => {
    if (!stock) return
    if (getFromCache(stock.id)) return
    const group = stock.groups?.[0] ?? stock.group
    if (group) {
      fetchGroup(group, [stock.id])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, cacheVersion])

  // Switch to a different stock → scroll detail's top into view + reset 進場分析 collapsed
  // 不能 scrollTo(0) — 0 是整個 document 頂端，detail 上面還有 header/toolbar/stat cards 等
  useEffect(() => {
    setEntryOpen(false)
    requestAnimationFrame(() => scrollDetailIntoView())
  }, [currentId])

  if (!stock) {
    return (
      <div className="flex items-center justify-center py-16" style={{ color: 'var(--color-text-muted)' }}>
        找不到股票（可能被篩掉了）
        <button onClick={onClose} className="ml-2 text-[12px]"
          style={{ color: 'var(--color-accent-cyan)', cursor: 'pointer', background: 'transparent', border: 0 }}>
          ← 返回
        </button>
      </div>
    )
  }

  const cssClass   = getGroupCssClass(stock.group)
  const groupColor = TAG_COLORS[cssClass] ?? '#6b7280'
  const klineBars  = getFromCache(stock.id)

  const rv  = stock.returns && stock.returns[returnPeriod]
  const ret = rv == null ? stock.threeMonthReturn : rv
  const turnover = stock.turnovers?.[turnoverPeriod] ?? 0
  const yoy = stock.revenueYoY

  return (
    <div
      data-mobile-detail
      className="rounded border"
      style={{ background: 'var(--color-bg-800)', borderColor: 'var(--color-border)' }}
    >
      {/* Top bar: back + stock identity（單獨 sticky，釘在頁首下方）*/}
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-bg-700)',
          position: 'sticky',
          top: 44,
          zIndex: 31,
        }}
      >
        <button
          onClick={onClose}
          className="text-[12px] px-2.5 py-1 rounded transition-colors"
          style={{
            background: 'var(--color-bg-600)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border)',
            cursor: 'pointer',
          }}
        >
          ← 列表
        </button>
        <span className="flex items-baseline gap-1.5 ml-1 min-w-0 flex-1 overflow-hidden">
          <span className="font-mono tabular text-[14px] shrink-0" style={{ color: 'var(--color-accent-cyan)', fontWeight: 500 }}>
            {stock.id}
          </span>
          <span className="text-[13px] shrink-0">{stock.name}</span>
        </span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded-full border shrink-0"
          style={{
            color: groupColor,
            borderColor: groupColor + '44',
            background: groupColor + '18',
            whiteSpace: 'nowrap',
          }}
        >
          {stock.group}
        </span>
      </div>

      {/* Prev/Next nav（獨立 sticky，疊在 top bar 下方）*/}
      <div
        className="flex items-center border-b"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-bg-700)',
          position: 'sticky',
          top: 92,
          zIndex: 30,
        }}
      >
        <button
          onClick={() => prevStock && onChange(prevStock.id)}
          disabled={!prevStock}
          className="flex-1 px-3 py-2 text-[10px] text-left transition-colors min-w-0"
          style={{
            background: 'transparent',
            border: 0,
            color: prevStock ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
            cursor: prevStock ? 'pointer' : 'not-allowed',
            opacity: prevStock ? 1 : 0.4,
          }}
        >
          <span className="truncate inline-block max-w-full">
            ← {prevStock ? `${prevStock.id} ${prevStock.name}` : '已是第一筆'}
          </span>
        </button>
        <span className="px-2 text-[10px] font-mono tabular shrink-0" style={{ color: 'var(--color-text-muted)' }}>
          {idx + 1} / {stocks.length}
        </span>
        <button
          onClick={() => nextStock && onChange(nextStock.id)}
          disabled={!nextStock}
          className="flex-1 px-3 py-2 text-[10px] text-right transition-colors min-w-0"
          style={{
            background: 'transparent',
            border: 0,
            color: nextStock ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
            cursor: nextStock ? 'pointer' : 'not-allowed',
            opacity: nextStock ? 1 : 0.4,
          }}
        >
          <span className="truncate inline-block max-w-full">
            {nextStock ? `${nextStock.id} ${nextStock.name}` : '已是最後一筆'} →
          </span>
        </button>
      </div>

      {/* Summary block */}
      <div className="px-3.5 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-baseline gap-3 mb-1.5">
          <span
            className="font-mono tabular text-[20px]"
            style={{
              color: stock.delta >= 0 ? 'var(--color-up)' : 'var(--color-down)',
              fontWeight: 500,
            }}
          >
            {stock.delta >= 0 ? '+' : ''}{stock.delta.toFixed(3)}%
          </span>
          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>本週大戶增持</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono tabular text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          <span>收 <span style={{ color: 'var(--color-text-secondary)' }}>{fmtPrice(stock.price)}</span></span>
          {ret != null && (
            <span>{RETURN_LABEL[returnPeriod]} <span style={{ color: ret >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>{fmtPctShort(ret)}</span></span>
          )}
          {turnover > 0 && (
            <span>成交 <span style={{ color: 'var(--color-text-secondary)' }}>{fmtTurnoverYi(turnover)}</span></span>
          )}
          {yoy != null && (
            <span>YoY <span style={{ color: yoy >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>{fmtPctShort(yoy)}</span></span>
          )}
        </div>
        {(stock.subIndustries ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {(stock.subIndustries ?? []).map(si => (
              <span key={si} className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'var(--color-bg-500)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                {si}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Company profile（內部已自帶折疊）*/}
      {stock.companyProfile?.business && (
        <div className="px-3.5 py-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <CompanyProfilePanel profile={stock.companyProfile} />
        </div>
      )}

      {/* MA toggle + K 線 */}
      <div className="px-3.5 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="mb-1.5">
          <MAToggleBar selected={maPeriods} onChange={setMaPeriods} />
        </div>
        {klineBars && klineBars.length > 0 ? (
          <CandlestickSVG
            bars={klineBars}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            width={400}
            height={240}
            showVolume
            showMA
            maPeriods={maPeriods}
            className="w-full"
          />
        ) : (
          <div
            className="flex items-center justify-center h-[180px] text-[11px] rounded"
            style={{
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-600)',
              border: '1px solid var(--color-border)',
            }}
          >
            ⏳ 載入 K 線中…
          </div>
        )}
      </div>

      {/* Fundamentals（內部 4 個 tab）*/}
      <div className="px-3.5 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <FundamentalsPanel fundamentals={stock.fundamentals} />
      </div>

      {/* 進場分析（折疊式，預設收）*/}
      <div className="px-3.5 py-3">
        <button
          onClick={() => setEntryOpen(v => !v)}
          className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded text-[11px] transition-colors"
          style={{
            background: 'var(--color-bg-600)',
            border: '1px solid var(--color-border)',
            color: entryOpen ? 'var(--color-accent-cyan)' : 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
          aria-expanded={entryOpen}
        >
          <span style={{ fontSize: 10 }}>{entryOpen ? '▾' : '▸'}</span>
          <span>📊 進場分析（多頭觸發 + 4×3 策略對比）</span>
        </button>
        {entryOpen && (
          <div className="mt-2">
            <StockEntryAnalysisInline stockId={stock.id} />
          </div>
        )}
      </div>
    </div>
  )
}
