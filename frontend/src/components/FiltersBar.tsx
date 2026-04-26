// ============================================================
//  個股列表 toolbar 的篩選器集合
//  桌面（md+）：sliders inline + 連續成長 + 絕對值 + 產業 chips 各一行
//  手機（<md）：折疊成「篩選器 (N)」按鈕，點開 modal
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import type { Filters, GrowthQuarters, StockRow } from '../types'
import {
  DEFAULT_FILTERS, FILTER_BOUNDS, FILTER_LABELS, FILTER_UNITS,
  GROWTH_QUARTERS_OPTIONS, GROWTH_METRIC_LABELS,
} from '../types'
import { RangeSlider } from './RangeSlider'
import { IndustryChips } from './IndustryChips'
import { makePiecewiseScale, makeLinearScale } from '../utils/scale'
import { recentQuarters } from '../utils/filters'

interface Props {
  stocks:   StockRow[]
  filters:  Filters
  onChange: (next: Filters) => void
}

const VOLUME_SCALE     = makePiecewiseScale([0, 5000, 25000, 100000, 500000])  // 張（左密右疏）
const MARKET_CAP_SCALE = makePiecewiseScale([0, 50, 200, 1000, 5000])
const DELTA_SCALE      = makeLinearScale(FILTER_BOUNDS.delta.min,      FILTER_BOUNDS.delta.max)
const REVENUE_SCALE    = makeLinearScale(FILTER_BOUNDS.revenueYoY.min, FILTER_BOUNDS.revenueYoY.max)
const GM_SCALE         = makeLinearScale(FILTER_BOUNDS.grossMargin.min,     FILTER_BOUNDS.grossMargin.max)
const OM_SCALE         = makeLinearScale(FILTER_BOUNDS.operatingMargin.min, FILTER_BOUNDS.operatingMargin.max)
const EPS_SCALE        = makePiecewiseScale([-10, 0, 5, 20, 100])         // EPS：0~5 大公司密集，>20 少數

function activeCount(f: Filters): number {
  let n = 0
  const eps = 1e-6
  const ranged = (a: [number, number], b: [number, number]) =>
    Math.abs(a[0] - b[0]) > eps || Math.abs(a[1] - b[1]) > eps
  if (ranged(f.volume,     DEFAULT_FILTERS.volume))     n++
  if (ranged(f.marketCap,  DEFAULT_FILTERS.marketCap))  n++
  if (ranged(f.delta,      DEFAULT_FILTERS.delta))      n++
  if (ranged(f.revenueYoY, DEFAULT_FILTERS.revenueYoY)) n++
  if (f.industries.length > 0) n++
  if (f.growth.quarters !== 0 &&
      (f.growth.metrics.eps || f.growth.metrics.grossMargin || f.growth.metrics.operatingMargin)) n++
  if (f.absValue.quarter && (
      ranged(f.absValue.grossMargin,     DEFAULT_FILTERS.absValue.grossMargin) ||
      ranged(f.absValue.operatingMargin, DEFAULT_FILTERS.absValue.operatingMargin) ||
      ranged(f.absValue.eps,             DEFAULT_FILTERS.absValue.eps))) n++
  return n
}

export function FiltersBar({ stocks, filters, onChange }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const n = useMemo(() => activeCount(filters), [filters])
  const quarters = useMemo(() => recentQuarters(stocks, 4), [stocks])

  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileOpen])

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })
  const reset = () => onChange(DEFAULT_FILTERS)

  const setGrowthQ = (q: GrowthQuarters) => set({ growth: { ...filters.growth, quarters: q } })
  const toggleGrowthMetric = (k: 'eps' | 'grossMargin' | 'operatingMargin') => set({
    growth: { ...filters.growth, metrics: { ...filters.growth.metrics, [k]: !filters.growth.metrics[k] } }
  })

  const setAbsQuarter = (q: string) => set({
    absValue: { ...filters.absValue, quarter: filters.absValue.quarter === q ? '' : q }
  })
  const setAbsRange = (k: 'grossMargin' | 'operatingMargin' | 'eps', v: [number, number]) =>
    set({ absValue: { ...filters.absValue, [k]: v } })

  const sliders = (
    <>
      <RangeSlider
        label={FILTER_LABELS.volume} unit={FILTER_UNITS.volume}
        value={filters.volume} bounds={FILTER_BOUNDS.volume}
        scale={VOLUME_SCALE} display={{ snapTo: 1000, digits: 0 }}
        onChange={v => set({ volume: v })}
      />
      <RangeSlider
        label={FILTER_LABELS.marketCap} unit={FILTER_UNITS.marketCap}
        value={filters.marketCap} bounds={FILTER_BOUNDS.marketCap}
        scale={MARKET_CAP_SCALE} display={{ snapTo: 10, digits: 0 }}
        onChange={v => set({ marketCap: v })}
      />
      <RangeSlider
        label={FILTER_LABELS.delta} unit={FILTER_UNITS.delta}
        value={filters.delta} bounds={FILTER_BOUNDS.delta}
        scale={DELTA_SCALE} display={{ snapTo: 0.1, digits: 1 }}
        onChange={v => set({ delta: v })}
      />
      <RangeSlider
        label={FILTER_LABELS.revenueYoY} unit={FILTER_UNITS.revenueYoY}
        value={filters.revenueYoY} bounds={FILTER_BOUNDS.revenueYoY}
        scale={REVENUE_SCALE} display={{ snapTo: 1, digits: 0 }}
        onChange={v => set({ revenueYoY: v })}
      />
    </>
  )

  const growthBlock = (
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>連續 YoY 成長</span>
      <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>近</span>
      <div className="flex items-center gap-1">
        {GROWTH_QUARTERS_OPTIONS.map(q => {
          const active = filters.growth.quarters === q
          return (
            <button
              key={q}
              onClick={() => setGrowthQ(q)}
              className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
              style={{
                background:  active ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
                borderColor: active ? 'var(--color-accent-cyan)' : 'var(--color-border)',
                color:       active ? '#fff' : 'var(--color-text-secondary)',
                fontWeight:  active ? 600 : 400,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {q === 0 ? '不限' : `${q}季`}
            </button>
          )
        })}
      </div>
      <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>都正</span>
      <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
      {(['eps', 'grossMargin', 'operatingMargin'] as const).map(k => {
        const checked = filters.growth.metrics[k]
        const enabled = filters.growth.quarters !== 0
        return (
          <label
            key={k}
            className="inline-flex items-center gap-1 text-[11px] select-none"
            style={{
              cursor: enabled ? 'pointer' : 'not-allowed',
              opacity: enabled ? 1 : 0.4,
              color: 'var(--color-text-secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!enabled}
              onChange={() => toggleGrowthMetric(k)}
              style={{ accentColor: 'var(--color-accent-cyan)' }}
            />
            {GROWTH_METRIC_LABELS[k]}
          </label>
        )
      })}
    </div>
  )

  const absEnabled = !!filters.absValue.quarter

  const absValueBlock = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>按季篩選</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>選一季</span>
        <div className="flex items-center gap-1 flex-wrap">
          {quarters.length === 0 && (
            <span className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>
              （暫無資料，請點上方「🔄 更新資料」按鈕）
            </span>
          )}
          {quarters.map(q => {
            const active = filters.absValue.quarter === q
            return (
              <button
                key={q}
                onClick={() => setAbsQuarter(q)}
                className="text-[10px] px-2 py-0.5 rounded-full border transition-colors font-mono tabular"
                style={{
                  background:  active ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
                  borderColor: active ? 'var(--color-accent-cyan)' : 'var(--color-border)',
                  color:       active ? '#fff' : 'var(--color-text-secondary)',
                  fontWeight:  active ? 600 : 400,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {q}
              </button>
            )
          })}
        </div>
        {absEnabled && (
          <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            （拉動下方 slider 篩該季的值）
          </span>
        )}
      </div>
      <div className="flex items-center gap-4 flex-wrap" style={{ opacity: absEnabled ? 1 : 0.45, pointerEvents: absEnabled ? 'auto' : 'none' }}>
        <RangeSlider
          label={FILTER_LABELS.grossMargin} unit={FILTER_UNITS.grossMargin}
          value={filters.absValue.grossMargin} bounds={FILTER_BOUNDS.grossMargin}
          scale={GM_SCALE} display={{ snapTo: 1, digits: 0 }}
          onChange={v => setAbsRange('grossMargin', v)}
        />
        <RangeSlider
          label={FILTER_LABELS.operatingMargin} unit={FILTER_UNITS.operatingMargin}
          value={filters.absValue.operatingMargin} bounds={FILTER_BOUNDS.operatingMargin}
          scale={OM_SCALE} display={{ snapTo: 1, digits: 0 }}
          onChange={v => setAbsRange('operatingMargin', v)}
        />
        <RangeSlider
          label={FILTER_LABELS.eps} unit={FILTER_UNITS.eps}
          value={filters.absValue.eps} bounds={FILTER_BOUNDS.eps}
          scale={EPS_SCALE} display={{ snapTo: 0.5, digits: 1 }}
          onChange={v => setAbsRange('eps', v)}
        />
      </div>
    </div>
  )

  return (
    <>
      <div className="hidden md:flex items-start gap-3 px-5 py-2 border-b flex-wrap"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center gap-4 flex-wrap flex-1 min-w-0">
          {sliders}
        </div>
        {n > 0 && (
          <button
            onClick={reset}
            className="text-[10px] px-2 py-1 rounded border self-center transition-colors shrink-0"
            style={{
              background: 'var(--color-bg-600)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
            title="清除所有篩選條件"
          >
            清除 ({n})
          </button>
        )}
      </div>

      <div className="hidden md:block px-5 py-2 border-b"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        {growthBlock}
      </div>

      <div className="hidden md:block px-5 py-2 border-b"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        {absValueBlock}
      </div>

      <div className="hidden md:block px-5 py-2 border-b"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        <IndustryChips
          stocks={stocks}
          selected={filters.industries}
          onChange={v => set({ industries: v })}
        />
      </div>

      <div className="flex md:hidden items-center gap-2 px-5 py-2 border-b"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        <button
          onClick={() => setMobileOpen(true)}
          className="text-xs px-3 py-1 rounded border font-medium transition-colors"
          style={{
            background: n > 0 ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
            borderColor: n > 0 ? 'var(--color-accent-cyan)' : 'var(--color-border)',
            color: n > 0 ? '#fff' : 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          篩選器{n > 0 ? ` (${n})` : ''}
        </button>
        {n > 0 && (
          <button
            onClick={reset}
            className="text-[10px] px-2 py-1 rounded border transition-colors"
            style={{
              background: 'var(--color-bg-600)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            清除
          </button>
        )}
      </div>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end md:hidden"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="w-full rounded-t-lg max-h-[85vh] overflow-y-auto animate-fadein"
            style={{ background: 'var(--color-bg-700)', borderTop: '1px solid var(--color-border)' }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="sticky top-0 flex items-center justify-between px-4 py-3 border-b"
              style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
            >
              <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                篩選條件{n > 0 ? ` · ${n} 項` : ''}
              </span>
              <div className="flex items-center gap-2">
                {n > 0 && (
                  <button
                    onClick={reset}
                    className="text-xs px-2 py-1 rounded border"
                    style={{
                      background: 'var(--color-bg-600)',
                      borderColor: 'var(--color-border)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    清除
                  </button>
                )}
                <button
                  onClick={() => setMobileOpen(false)}
                  className="text-xs px-3 py-1 rounded border font-medium"
                  style={{
                    background: 'var(--color-accent-blue)',
                    borderColor: 'var(--color-accent-blue)',
                    color: '#fff',
                  }}
                >
                  完成
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-4 p-4">
              {sliders}
              <div className="border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
                {growthBlock}
              </div>
              <div className="border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
                {absValueBlock}
              </div>
              <div className="border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
                <div className="text-[10px] mb-2" style={{ color: 'var(--color-text-muted)' }}>
                  產業別（多選任一）
                </div>
                <IndustryChips
                  stocks={stocks}
                  selected={filters.industries}
                  onChange={v => set({ industries: v })}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
