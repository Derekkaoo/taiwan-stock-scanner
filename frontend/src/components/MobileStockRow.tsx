// ============================================================
//  手機個股 dense row + inline expand
//  - Collapsed: 兩行（id+name+group chip+週增% / 收 1Y 成交 YoY）
//  - Expanded: MA toggle → K 線 → divider → Fundamentals (4 tab) → divider → 進場分析（折疊式）
//  - 桌機完全不渲染（由 App 用 isMobile 切換）
// ============================================================
import { useEffect, useRef, useState } from 'react'
import type {
  StockRow, KlineBar, ReturnPeriod, TurnoverPeriod,
} from '../types'
import { TAG_COLORS, getGroupCssClass } from '../constants/themeGroups'
import { CandlestickSVG } from './CandlestickSVG'
import { CompanyProfilePanel } from './CompanyProfilePanel'
import { FundamentalsPanel } from './FundamentalsPanel'
import { EntryAnalysisPanel } from './EntryAnalysisPanel'
import { MAToggleBar } from './MAToggleBar'
import { useEntryAnalysis } from '../hooks/useEntryAnalysis'

interface Props {
  stock: StockRow
  expanded: boolean
  onToggle: () => void
  /** 從 useKline 的 cache 取的 K 線（null = 還沒載入或無資料）*/
  klineBars: KlineBar[] | null
  returnPeriod: ReturnPeriod
  turnoverPeriod: TurnoverPeriod
  /** K 線圖均線選擇（從 App 持久化 state）*/
  maPeriods: number[]
  setMaPeriods: (p: number[]) => void
  timeframe: 'D' | 'W' | 'M'
  setTimeframe: (t: 'D' | 'W' | 'M') => void
  /** 自訂 sub-industry chips（族群 tab 內可傳「該股票在此族群」相關 subs；不傳則用 stock.subIndustries）*/
  subIndustries?: string[]
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

/** 短百分比：+87% (整數)；給次要 metric 用 */
function fmtPctShort(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(0)}%`
}

/** wrap useEntryAnalysis hook（hook 只能在 component 裡呼叫）*/
function StockEntryAnalysisInline({ stockId }: { stockId: string }) {
  const { data, loading } = useEntryAnalysis(stockId)
  return <EntryAnalysisPanel data={data} loading={loading} />
}

export function MobileStockRow({
  stock, expanded, onToggle, klineBars,
  returnPeriod, turnoverPeriod,
  maPeriods, setMaPeriods, timeframe, setTimeframe,
  subIndustries,
}: Props) {
  // 進場分析：預設折疊，避免 expand area 太長
  const [entryOpen, setEntryOpen] = useState(false)

  // 點開 row 時自動 scroll 把 row 頂端對齊到 sticky header 下緣
  // （避免展開後 row header 被推到看不見、user 看到的是 K 線中段）
  // 動態量目前頂部所有 sticky 元素的 visible bottom，這樣手機 toolbar wrap 多少行都能對齊
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!expanded || !rowRef.current) return
    const raf = requestAnimationFrame(() => {
      const el = rowRef.current
      if (!el) return

      // 找頂部所有 position:sticky 元素的最低 bottom
      const stickyBottom = (() => {
        const cands = document.querySelectorAll<HTMLElement>('[class*="sticky"]')
        let max = 0
        cands.forEach(s => {
          if (getComputedStyle(s).position !== 'sticky') return
          const r = s.getBoundingClientRect()
          // 還黏在頂部的（top 接近 0 或視窗範圍內）
          if (r.top >= -1 && r.top <= 50 && r.bottom > max) max = r.bottom
        })
        return max || 120  // fallback
      })()

      const rect = el.getBoundingClientRect()
      const targetY = window.scrollY + rect.top - stickyBottom - 6
      window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(raf)
  }, [expanded])

  const cssClass   = getGroupCssClass(stock.group)
  const groupColor = TAG_COLORS[cssClass] ?? '#6b7280'

  const rv  = stock.returns && stock.returns[returnPeriod]
  const ret = rv == null ? stock.threeMonthReturn : rv
  const turnover = stock.turnovers?.[turnoverPeriod] ?? 0
  const yoy = stock.revenueYoY

  const subs = subIndustries ?? stock.subIndustries ?? []

  return (
    <div
      ref={rowRef}
      className="border-b transition-colors"
      style={{
        borderColor: 'var(--color-border)',
        background: expanded ? 'var(--color-bg-700)' : 'transparent',
        borderLeft: expanded
          ? '2px solid var(--color-accent-cyan)'
          : '2px solid transparent',
      }}
    >
      {/* === Collapsed row（整 row clickable）=== */}
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full text-left px-3.5 py-2.5"
        style={{
          background: 'transparent',
          border: 0,
          cursor: 'pointer',
          color: 'var(--color-text-primary)',
        }}
      >
        {/* line 1: ▶ + id + name + group chip + 週增% */}
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
            <span
              className="text-[10px] shrink-0 transition-transform"
              style={{
                display: 'inline-block',
                transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
                color: expanded ? 'var(--color-accent-cyan)' : 'var(--color-text-muted)',
              }}
            >▶</span>
            <span
              className="font-mono tabular text-[14px] shrink-0"
              style={{ color: 'var(--color-accent-cyan)', fontWeight: 500 }}
            >
              {stock.id}
            </span>
            <span className="text-[13px] shrink-0">{stock.name}</span>
            <span
              className="text-[9px] shrink-0 px-1.5 py-0.5 rounded-full border"
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
          <span
            className="font-mono tabular text-[13px] shrink-0"
            style={{
              color: stock.delta >= 0 ? 'var(--color-up)' : 'var(--color-down)',
              fontWeight: 500,
            }}
          >
            {stock.delta >= 0 ? '+' : ''}{stock.delta.toFixed(3)}%
          </span>
        </div>

        {/* line 2: 收 / 1Y / 成交 / YoY */}
        <div className="flex gap-3 font-mono tabular text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          <span>
            收 <span style={{ color: 'var(--color-text-secondary)' }}>{fmtPrice(stock.price)}</span>
          </span>
          {ret != null && (
            <span>
              {RETURN_LABEL[returnPeriod]}{' '}
              <span style={{ color: ret >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
                {fmtPctShort(ret)}
              </span>
            </span>
          )}
          {turnover > 0 && (
            <span>
              成交 <span style={{ color: 'var(--color-text-secondary)' }}>{fmtTurnoverYi(turnover)}</span>
            </span>
          )}
          {yoy != null && (
            <span>
              YoY{' '}
              <span style={{ color: yoy >= 0 ? 'var(--color-up)' : 'var(--color-down)' }}>
                {fmtPctShort(yoy)}
              </span>
            </span>
          )}
        </div>
      </button>

      {/* === Expanded area === */}
      {expanded && (
        <div className="px-3.5 pb-3" onClick={(e) => e.stopPropagation()}>
          {/* sub-industry chips */}
          {subs.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {subs.map(si => (
                <span
                  key={si}
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    background: 'var(--color-bg-500)',
                    color: 'var(--color-text-secondary)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {si}
                </span>
              ))}
            </div>
          )}

          {/* Company profile (內部已自帶折疊) */}
          {stock.companyProfile?.business && (
            <div className="mb-2">
              <CompanyProfilePanel profile={stock.companyProfile} />
            </div>
          )}

          {/* MA toggle */}
          <div className="mb-1.5">
            <MAToggleBar selected={maPeriods} onChange={setMaPeriods} />
          </div>

          {/* K line */}
          {klineBars && klineBars.length > 0 ? (
            <CandlestickSVG
              bars={klineBars}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              width={400}
              height={200}
              showVolume
              showMA
              maPeriods={maPeriods}
              className="w-full"
            />
          ) : (
            <div
              className="flex items-center justify-center h-[120px] text-[11px] rounded"
              style={{
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg-600)',
                border: '1px solid var(--color-border)',
              }}
            >
              {klineBars === null ? '⏳ 載入 K 線中…' : '⚠ 無 K 線資料'}
            </div>
          )}

          {/* divider */}
          <div
            aria-hidden
            className="my-3"
            style={{
              height: 1,
              background: 'linear-gradient(to right, transparent, var(--color-border) 15%, var(--color-border) 85%, transparent)',
            }}
          />

          {/* Fundamentals（4 個 tab 自帶在元件內）*/}
          <FundamentalsPanel fundamentals={stock.fundamentals} />

          {/* divider */}
          <div
            aria-hidden
            className="my-3"
            style={{
              height: 1,
              background: 'linear-gradient(to right, transparent, var(--color-border) 15%, var(--color-border) 85%, transparent)',
            }}
          />

          {/* 進場分析（折疊式，預設收）*/}
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
      )}
    </div>
  )
}
