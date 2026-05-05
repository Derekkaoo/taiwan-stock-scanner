// ============================================================
//  個股列表 toolbar 的篩選器集合
//  桌機 + 手機都用 collapsible sections（基本面 / 技術面 / 籌碼面 / 其他）
//  默認全收起；展開狀態持久化到 localStorage
// ============================================================
import { useEffect, useMemo, useState } from 'react'
import type {
  Filters, GrowthQuarters, InstStreakDays, MarketFilter,
  NReturnDays, NHighDays,
  VolumeNewHighDays, VolumeSurgeBaseline, VolumeSurgeMultiplier,
  MaAlignmentPeriod, MaDirectionPeriod,
  MaBreakoutDays, MaBreakoutPeriod,
  MaContinuationDirection, MaContinuationPeriod,
  MaSustainedDays, MaSustainedPeriod,
  StockRow,
} from '../types'
import {
  DEFAULT_FILTERS, FILTER_BOUNDS, FILTER_LABELS, FILTER_UNITS,
  GROWTH_QUARTERS_OPTIONS, GROWTH_METRIC_LABELS,
  INST_STREAK_OPTIONS, MARKET_OPTIONS,
  N_RETURN_OPTIONS, N_HIGH_OPTIONS,
  VOLUME_NEW_HIGH_OPTIONS, VOLUME_SURGE_BASELINE_OPTIONS, VOLUME_SURGE_MULTIPLIER_OPTIONS,
  MA_ALIGNMENT_OPTIONS, MA_ALIGNMENT_DEFAULT,
  MA_DIRECTION_OPTIONS,
  MA_BREAKOUT_DAYS_OPTIONS, MA_BREAKOUT_PERIOD_OPTIONS,
  MA_CONTINUATION_DIRECTION_OPTIONS, MA_CONTINUATION_PERIOD_OPTIONS,
  MA_SUSTAINED_DAYS_OPTIONS, MA_SUSTAINED_PERIOD_OPTIONS,
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
const N_RETURN_SCALE   = makeLinearScale(FILTER_BOUNDS.nDayReturn.min, FILTER_BOUNDS.nDayReturn.max)

const EPS = 1e-6
const ranged = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) > EPS || Math.abs(a[1] - b[1]) > EPS

type SectionKey = 'fund' | 'tech' | 'chips' | 'meta'

const SECTION_LABELS: Record<SectionKey, string> = {
  fund:  '📊 基本面',
  tech:  '📈 技術面',
  chips: '💰 籌碼面',
  meta:  '🏷 其他',
}

function activeCountForSection(key: SectionKey, f: Filters): number {
  let n = 0
  switch (key) {
    case 'fund':
      if (ranged(f.marketCap,  DEFAULT_FILTERS.marketCap))  n++
      if (ranged(f.revenueYoY, DEFAULT_FILTERS.revenueYoY)) n++
      if (f.growth.quarters !== 0 &&
          (f.growth.metrics.eps || f.growth.metrics.grossMargin || f.growth.metrics.operatingMargin)) n++
      if (f.absValue.quarter && (
          ranged(f.absValue.grossMargin,     DEFAULT_FILTERS.absValue.grossMargin) ||
          ranged(f.absValue.operatingMargin, DEFAULT_FILTERS.absValue.operatingMargin) ||
          ranged(f.absValue.eps,             DEFAULT_FILTERS.absValue.eps))) n++
      return n
    case 'tech':
      if (ranged(f.volume, DEFAULT_FILTERS.volume)) n++
      if (f.nDayReturn.days !== 0) n++
      if (f.nDayHigh.days   !== 0) n++
      if (f.volumeNewHigh.days !== 0) n++
      if (f.volumeSurge.multiplier !== 0) n++
      if ((f.maAlignment?.periods?.length ?? 0) >= 2) n++
      if ((f.maDirection?.periods?.length ?? 0) >= 1) n++
      if ((f.maBreakout?.days ?? 0) !== 0 && (f.maBreakout?.period ?? 0) !== 0) n++
      if ((f.maContinuation?.direction ?? 'off') !== 'off' && (f.maContinuation?.period ?? 0) !== 0) n++
      if ((f.maSustained?.days ?? 0) !== 0 && (f.maSustained?.period ?? 0) !== 0) n++
      return n
    case 'chips':
      if (ranged(f.delta, DEFAULT_FILTERS.delta)) n++
      if (f.institutional.days !== 0 && (f.institutional.foreign || f.institutional.trust)) n++
      return n
    case 'meta':
      if (f.market !== 'all')      n++
      if (f.industries.length > 0) n++
      return n
  }
}

function totalActiveCount(f: Filters): number {
  return activeCountForSection('fund', f)
       + activeCountForSection('tech', f)
       + activeCountForSection('chips', f)
       + activeCountForSection('meta', f)
}

const STORAGE_KEY = 'filtersbar_open_sections_v1'
function loadOpenSections(): Set<SectionKey> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as string[]
      const valid = new Set<SectionKey>()
      for (const k of arr) {
        if (k === 'fund' || k === 'tech' || k === 'chips' || k === 'meta') valid.add(k)
      }
      return valid
    }
  } catch { /* ignore */ }
  return new Set() // 預設全收起
}
function saveOpenSections(s: Set<SectionKey>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...s])) } catch { /* ignore */ }
}

export function FiltersBar({ stocks, filters, onChange }: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(() => loadOpenSections())

  const totalActive = useMemo(() => totalActiveCount(filters), [filters])
  const quarters = useMemo(() => recentQuarters(stocks, 4), [stocks])

  useEffect(() => { saveOpenSections(openSections) }, [openSections])

  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileOpen])

  const toggleSection = (k: SectionKey) => {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

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

  const setInstDays = (d: InstStreakDays) =>
    set({ institutional: { ...filters.institutional, days: d } })
  const toggleInstWho = (k: 'foreign' | 'trust') =>
    set({ institutional: { ...filters.institutional, [k]: !filters.institutional[k] } })

  const setMarket = (m: MarketFilter) => set({ market: m })

  const setNReturnDays = (d: NReturnDays) =>
    set({ nDayReturn: { ...filters.nDayReturn, days: d } })
  const setNReturnRange = (v: [number, number]) =>
    set({ nDayReturn: { ...filters.nDayReturn, range: v } })
  const setNHighDays = (d: NHighDays) =>
    set({ nDayHigh: { days: d } })

  const setVolumeNewHighDays = (d: VolumeNewHighDays) =>
    set({ volumeNewHigh: { days: d } })
  const setVolumeSurgeBaseline = (b: VolumeSurgeBaseline) =>
    set({ volumeSurge: { ...filters.volumeSurge, baseline: b } })
  const setVolumeSurgeMultiplier = (m: VolumeSurgeMultiplier) =>
    set({ volumeSurge: { ...filters.volumeSurge, multiplier: m } })

  const toggleMaPeriod = (p: MaAlignmentPeriod) => {
    const current = filters.maAlignment?.periods ?? []
    const next = current.includes(p)
      ? current.filter(x => x !== p)
      : [...current, p].sort((a, b) => a - b)
    set({ maAlignment: { periods: next as MaAlignmentPeriod[] } })
  }
  const resetMaAlignment = () =>
    set({ maAlignment: { periods: MA_ALIGNMENT_DEFAULT } })
  const clearMaAlignment = () =>
    set({ maAlignment: { periods: [] } })

  const toggleMaDirPeriod = (p: MaDirectionPeriod) => {
    const current = filters.maDirection?.periods ?? []
    const next = current.includes(p)
      ? current.filter(x => x !== p)
      : [...current, p].sort((a, b) => a - b)
    set({ maDirection: { periods: next as MaDirectionPeriod[] } })
  }
  const clearMaDirection = () =>
    set({ maDirection: { periods: [] } })

  const setMaBreakoutDays = (d: MaBreakoutDays) =>
    set({ maBreakout: { ...filters.maBreakout, days: d } })
  const setMaBreakoutPeriod = (p: MaBreakoutPeriod) =>
    set({ maBreakout: { ...filters.maBreakout, period: p } })
  const clearMaBreakout = () =>
    set({ maBreakout: { days: 0, period: 0 } })

  const setMaContDirection = (d: MaContinuationDirection) =>
    set({ maContinuation: { ...filters.maContinuation, direction: d } })
  const setMaContPeriod = (p: MaContinuationPeriod) =>
    set({ maContinuation: { ...filters.maContinuation, period: p } })
  const clearMaContinuation = () =>
    set({ maContinuation: { direction: 'off', period: 0 } })

  const setMaSustDays = (d: MaSustainedDays) =>
    set({ maSustained: { ...filters.maSustained, days: d } })
  const setMaSustPeriod = (p: MaSustainedPeriod) =>
    set({ maSustained: { ...filters.maSustained, period: p } })
  const clearMaSustained = () =>
    set({ maSustained: { days: 0, period: 0 } })

  // === 個別 sliders（拆出來方便分到各 section）===
  const volumeSlider = (
    <RangeSlider
      label={FILTER_LABELS.volume} unit={FILTER_UNITS.volume}
      value={filters.volume} bounds={FILTER_BOUNDS.volume}
      scale={VOLUME_SCALE} display={{ snapTo: 1000, digits: 0 }}
      onChange={v => set({ volume: v })}
    />
  )
  const marketCapSlider = (
    <RangeSlider
      label={FILTER_LABELS.marketCap} unit={FILTER_UNITS.marketCap}
      value={filters.marketCap} bounds={FILTER_BOUNDS.marketCap}
      scale={MARKET_CAP_SCALE} display={{ snapTo: 10, digits: 0 }}
      onChange={v => set({ marketCap: v })}
    />
  )
  const deltaSlider = (
    <RangeSlider
      label={FILTER_LABELS.delta} unit={FILTER_UNITS.delta}
      value={filters.delta} bounds={FILTER_BOUNDS.delta}
      scale={DELTA_SCALE} display={{ snapTo: 0.1, digits: 1 }}
      onChange={v => set({ delta: v })}
    />
  )
  const revenueYoYSlider = (
    <RangeSlider
      label={FILTER_LABELS.revenueYoY} unit={FILTER_UNITS.revenueYoY}
      value={filters.revenueYoY} bounds={FILTER_BOUNDS.revenueYoY}
      scale={REVENUE_SCALE} display={{ snapTo: 1, digits: 0 }}
      onChange={v => set({ revenueYoY: v })}
    />
  )

  // === Block JSX（同一 block 內含 chips 跟 sliders）===
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

  const instEnabled = filters.institutional.days !== 0
  const institutionalBlock = (
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>連續買超</span>
      <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>近</span>
      <div className="flex items-center gap-1">
        {INST_STREAK_OPTIONS.map(d => {
          const active = filters.institutional.days === d
          return (
            <button
              key={d}
              onClick={() => setInstDays(d)}
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
              {d === 0 ? '不限' : `${d}日`}
            </button>
          )
        })}
      </div>
      <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>都買超</span>
      <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
      {(['foreign', 'trust'] as const).map(k => {
        const checked = filters.institutional[k]
        return (
          <label
            key={k}
            className="inline-flex items-center gap-1 text-[11px] select-none"
            style={{
              cursor: instEnabled ? 'pointer' : 'not-allowed',
              opacity: instEnabled ? 1 : 0.4,
              color: 'var(--color-text-secondary)',
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={!instEnabled}
              onChange={() => toggleInstWho(k)}
              style={{ accentColor: 'var(--color-accent-cyan)' }}
            />
            {k === 'foreign' ? '外資' : '投信'}
          </label>
        )
      })}
    </div>
  )

  const marketBlock = (
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>市場</span>
      <div className="flex items-center gap-1">
        {MARKET_OPTIONS.map(opt => {
          const active = filters.market === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => setMarket(opt.value)}
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
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )

  const nReturnEnabled = filters.nDayReturn.days !== 0
  const nReturnBlock = (
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>N 日漲跌幅</span>
      <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>近</span>
      <div className="flex items-center gap-1">
        {N_RETURN_OPTIONS.map(d => {
          const active = filters.nDayReturn.days === d
          return (
            <button
              key={d}
              onClick={() => setNReturnDays(d)}
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
              {d === 0 ? '不限' : `${d}日`}
            </button>
          )
        })}
      </div>
      <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
      <div
        className="min-w-[180px] max-w-[260px]"
        style={{ opacity: nReturnEnabled ? 1 : 0.4, pointerEvents: nReturnEnabled ? 'auto' : 'none' }}
      >
        <RangeSlider
          label="漲跌幅範圍"
          unit={FILTER_UNITS.nDayReturn}
          value={filters.nDayReturn.range}
          bounds={FILTER_BOUNDS.nDayReturn}
          scale={N_RETURN_SCALE}
          display={{ snapTo: 0.5, digits: 1 }}
          onChange={setNReturnRange}
        />
      </div>
    </div>
  )

  const nHighBlock = (
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>創新高</span>
      <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>盤中創</span>
      <div className="flex items-center gap-1 flex-wrap">
        {N_HIGH_OPTIONS.map(d => {
          const active = filters.nDayHigh.days === d
          return (
            <button
              key={d}
              onClick={() => setNHighDays(d)}
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
              {d === 0 ? '不限' : `${d}日新高`}
            </button>
          )
        })}
      </div>
    </div>
  )

  // 成交量創 N 日新高
  const volumeNewHighBlock = (
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>成交量創新高</span>
      <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>盤中創</span>
      <div className="flex items-center gap-1 flex-wrap">
        {VOLUME_NEW_HIGH_OPTIONS.map(d => {
          const active = filters.volumeNewHigh.days === d
          return (
            <button
              key={d}
              onClick={() => setVolumeNewHighDays(d)}
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
              {d === 0 ? '不限' : `${d}日新高`}
            </button>
          )
        })}
      </div>
    </div>
  )

  // 成交爆量（baseline + multiplier 兩列 chip）
  const volumeSurgeEnabled = filters.volumeSurge.multiplier !== 0
  const volumeSurgeBlock = (
    <div className="flex flex-col gap-1">
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>成交爆量</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>大於</span>
        <div className="flex items-center gap-1 flex-wrap">
          {VOLUME_SURGE_MULTIPLIER_OPTIONS.map(m => {
            const active = filters.volumeSurge.multiplier === m
            return (
              <button
                key={m}
                onClick={() => setVolumeSurgeMultiplier(m)}
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
                {m === 0 ? '不限' : `${m}倍`}
              </button>
            )
          })}
        </div>
      </div>
      <div
        className="flex items-center flex-wrap gap-2 ml-1"
        style={{ opacity: volumeSurgeEnabled ? 1 : 0.4, pointerEvents: volumeSurgeEnabled ? 'auto' : 'none' }}
      >
        <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>基準</span>
        <div className="flex items-center gap-1 flex-wrap">
          {VOLUME_SURGE_BASELINE_OPTIONS.map(opt => {
            const active = filters.volumeSurge.baseline === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setVolumeSurgeBaseline(opt.value)}
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
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )

  // 均線多頭排列 block（多選 chip + 預覽顯示順序）
  const maPeriodsSelected = (filters.maAlignment?.periods ?? [])
    .slice()
    .sort((a, b) => a - b)
  const maAlignmentBlock = (
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>均線多頭排列</span>
      <div className="flex items-center gap-1 flex-wrap">
        {MA_ALIGNMENT_OPTIONS.map(p => {
          const active = maPeriodsSelected.includes(p)
          return (
            <button
              key={p}
              onClick={() => toggleMaPeriod(p)}
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
              {p}MA
            </button>
          )
        })}
      </div>
      {/* 預覽：選了 2+ 才顯示順序 */}
      {maPeriodsSelected.length >= 2 && (
        <span className="text-[10px] tabular font-mono" style={{ color: 'var(--color-accent-cyan)' }}>
          {maPeriodsSelected.map(p => `${p}MA`).join(' > ')}
        </span>
      )}
      {maPeriodsSelected.length === 1 && (
        <span className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>
          （至少選 2 個才生效）
        </span>
      )}
      <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
      <button
        onClick={resetMaAlignment}
        className="text-[10px] px-2 py-0.5 rounded border transition-colors"
        style={{
          background: 'var(--color-bg-600)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
        }}
        title="預設 5/10/20MA"
      >
        預設
      </button>
      {maPeriodsSelected.length > 0 && (
        <button
          onClick={clearMaAlignment}
          className="text-[10px] px-2 py-0.5 rounded border transition-colors"
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
  )

  // 均線方向朝上 block（多選 chip，每條 MA 都要求今日 > 昨日）
  const maDirSelected = (filters.maDirection?.periods ?? [])
    .slice()
    .sort((a, b) => a - b)
  const maDirectionBlock = (
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>均線方向朝上</span>
      <div className="flex items-center gap-1 flex-wrap">
        {MA_DIRECTION_OPTIONS.map(p => {
          const active = maDirSelected.includes(p)
          return (
            <button
              key={p}
              onClick={() => toggleMaDirPeriod(p)}
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
              {p}MA
            </button>
          )
        })}
      </div>
      {maDirSelected.length > 0 && (
        <span className="text-[10px] tabular font-mono" style={{ color: 'var(--color-accent-cyan)' }}>
          {maDirSelected.map(p => `${p}MA↑`).join(' & ')}
        </span>
      )}
      {maDirSelected.length > 0 && (
        <>
          <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
          <button
            onClick={clearMaDirection}
            className="text-[10px] px-2 py-0.5 rounded border transition-colors"
            style={{
              background: 'var(--color-bg-600)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
            }}
          >
            清除
          </button>
        </>
      )}
    </div>
  )

  // N 日內突破 MA block（兩個單選 chip：天數 + MA 週期）
  const maBreakoutDaysSel   = filters.maBreakout?.days   ?? 0
  const maBreakoutPeriodSel = filters.maBreakout?.period ?? 0
  const maBreakoutActive    = maBreakoutDaysSel !== 0 && maBreakoutPeriodSel !== 0
  const maBreakoutBlock = (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>N 日內突破 MA</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>天數</span>
        <div className="flex items-center gap-1 flex-wrap">
          {MA_BREAKOUT_DAYS_OPTIONS.map(d => {
            const active = maBreakoutDaysSel === d
            return (
              <button
                key={d}
                onClick={() => setMaBreakoutDays(d)}
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
                {d === 0 ? '關閉' : `${d}日`}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)', visibility: 'hidden' }}>N 日內突破 MA</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>MA 週期</span>
        <div className="flex items-center gap-1 flex-wrap">
          {MA_BREAKOUT_PERIOD_OPTIONS.map(p => {
            const active = maBreakoutPeriodSel === p
            return (
              <button
                key={p}
                onClick={() => setMaBreakoutPeriod(p)}
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
                {p === 0 ? '關閉' : `${p}MA`}
              </button>
            )
          })}
        </div>
        {maBreakoutActive && (
          <span className="text-[10px] tabular font-mono" style={{ color: 'var(--color-accent-cyan)' }}>
            {maBreakoutDaysSel} 日內突破 {maBreakoutPeriodSel}MA
          </span>
        )}
        {(maBreakoutDaysSel !== 0 || maBreakoutPeriodSel !== 0) && !maBreakoutActive && (
          <span className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>
            （天數與 MA 都要選才生效）
          </span>
        )}
        {(maBreakoutDaysSel !== 0 || maBreakoutPeriodSel !== 0) && (
          <>
            <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
            <button
              onClick={clearMaBreakout}
              className="text-[10px] px-2 py-0.5 rounded border transition-colors"
              style={{
                background: 'var(--color-bg-600)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}
            >
              清除
            </button>
          </>
        )}
      </div>
    </div>
  )

  // 明日 MA 續揚 / 下彎 block（扣抵值預測）
  const maContDir    = filters.maContinuation?.direction ?? 'off'
  const maContPeriod = filters.maContinuation?.period    ?? 0
  const maContActive = maContDir !== 'off' && maContPeriod !== 0
  const maContinuationBlock = (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>明日 MA 續揚 / 下彎</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>方向</span>
        <div className="flex items-center gap-1 flex-wrap">
          {MA_CONTINUATION_DIRECTION_OPTIONS.map(opt => {
            const active = maContDir === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setMaContDirection(opt.value)}
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
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)', visibility: 'hidden' }}>明日 MA 續揚 / 下彎</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>MA 週期</span>
        <div className="flex items-center gap-1 flex-wrap">
          {MA_CONTINUATION_PERIOD_OPTIONS.map(p => {
            const active = maContPeriod === p
            return (
              <button
                key={p}
                onClick={() => setMaContPeriod(p)}
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
                {p === 0 ? '關閉' : `${p}MA`}
              </button>
            )
          })}
        </div>
        {maContActive && (
          <span className="text-[10px] tabular font-mono" style={{ color: 'var(--color-accent-cyan)' }}>
            明日 {maContPeriod}MA {maContDir === 'up' ? '續揚 ▲' : '下彎 ▼'}
          </span>
        )}
        {(maContDir !== 'off' || maContPeriod !== 0) && !maContActive && (
          <span className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>
            （方向與 MA 都要選才生效）
          </span>
        )}
        {(maContDir !== 'off' || maContPeriod !== 0) && (
          <>
            <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
            <button
              onClick={clearMaContinuation}
              className="text-[10px] px-2 py-0.5 rounded border transition-colors"
              style={{
                background: 'var(--color-bg-600)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}
            >
              清除
            </button>
          </>
        )}
      </div>
    </div>
  )

  // 未來 N 日 MA 易續揚 block（扣抵保護）+ tooltip
  const maSustDays   = filters.maSustained?.days   ?? 0
  const maSustPeriod = filters.maSustained?.period ?? 0
  const maSustActive = maSustDays !== 0 && maSustPeriod !== 0
  const maSustainedBlock = (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
          未來 N 日 MA 易續揚
          <span
            className="inline-block"
            style={{
              fontSize: 10,
              color: 'var(--color-accent-cyan)',
              opacity: 0.7,
              cursor: 'help',
              userSelect: 'none',
            }}
            title={
              '未來 N 個交易日內，即使股價盤整不漲、甚至小跌（容忍度 ≈ 現價與扣抵值差距），\n' +
              'MA 仍會連續上揚。\n\n' +
              '例：選 5 日 + 20MA → 命中股票表示「未來 5 天即使每天小跌 1-3%，MA-20 仍會續揚」。\n\n' +
              '又稱「黃金扣抵期」— 技術派常用來確認波段安全進場區。'
            }
          >
            ⓘ
          </span>
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>天數</span>
        <div className="flex items-center gap-1 flex-wrap">
          {MA_SUSTAINED_DAYS_OPTIONS.map(d => {
            const active = maSustDays === d
            return (
              <button
                key={d}
                onClick={() => setMaSustDays(d)}
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
                {d === 0 ? '關閉' : `${d}日`}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)', visibility: 'hidden' }}>未來 N 日 MA 易續揚</span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>MA 週期</span>
        <div className="flex items-center gap-1 flex-wrap">
          {MA_SUSTAINED_PERIOD_OPTIONS.map(p => {
            const active = maSustPeriod === p
            return (
              <button
                key={p}
                onClick={() => setMaSustPeriod(p)}
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
                {p === 0 ? '關閉' : `${p}MA`}
              </button>
            )
          })}
        </div>
        {maSustActive && (
          <span className="text-[10px] tabular font-mono" style={{ color: 'var(--color-accent-cyan)' }}>
            未來 {maSustDays} 日 {maSustPeriod}MA 易續揚
          </span>
        )}
        {(maSustDays !== 0 || maSustPeriod !== 0) && !maSustActive && (
          <span className="text-[10px] italic" style={{ color: 'var(--color-text-muted)' }}>
            （天數與 MA 都要選才生效）
          </span>
        )}
        {(maSustDays !== 0 || maSustPeriod !== 0) && (
          <>
            <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
            <button
              onClick={clearMaSustained}
              className="text-[10px] px-2 py-0.5 rounded border transition-colors"
              style={{
                background: 'var(--color-bg-600)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}
            >
              清除
            </button>
          </>
        )}
      </div>
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

  // === 各 section 內容 ===
  const sectionContent: Record<SectionKey, React.ReactNode> = {
    fund: (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-4 flex-wrap">{marketCapSlider}{revenueYoYSlider}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{growthBlock}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{absValueBlock}</div>
      </div>
    ),
    tech: (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-4 flex-wrap">{volumeSlider}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{nReturnBlock}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{nHighBlock}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{volumeNewHighBlock}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{volumeSurgeBlock}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{maAlignmentBlock}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{maDirectionBlock}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{maBreakoutBlock}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{maContinuationBlock}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{maSustainedBlock}</div>
      </div>
    ),
    chips: (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-4 flex-wrap">{deltaSlider}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{institutionalBlock}</div>
      </div>
    ),
    meta: (
      <div className="flex flex-col gap-2">
        {marketBlock}
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
          <div className="text-[10px] mb-2" style={{ color: 'var(--color-text-muted)' }}>產業別（多選任一）</div>
          <IndustryChips
            stocks={stocks}
            selected={filters.industries}
            onChange={v => set({ industries: v })}
          />
        </div>
      </div>
    ),
  }

  // === Collapsible Section header + body 渲染 ===
  const renderSection = (key: SectionKey) => {
    const open = openSections.has(key)
    const count = activeCountForSection(key, filters)
    return (
      <div
        key={key}
        className="border-b"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg-700)' }}
      >
        <button
          onClick={() => toggleSection(key)}
          className="w-full flex items-center justify-between px-5 py-2 text-xs select-none transition-colors"
          style={{ background: 'transparent', cursor: 'pointer', color: 'var(--color-text-primary)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-600)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          aria-expanded={open}
        >
          <span className="flex items-center gap-2 font-medium">
            <span style={{ display: 'inline-block', width: 12, color: 'var(--color-text-muted)' }}>
              {open ? '▾' : '▸'}
            </span>
            {SECTION_LABELS[key]}
            {count > 0 && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-mono tabular"
                style={{
                  background: 'var(--color-accent-cyan)',
                  color: '#fff',
                  minWidth: 18,
                  textAlign: 'center',
                }}
              >
                {count}
              </span>
            )}
          </span>
        </button>
        {open && (
          <div className="px-5 pb-3 pt-1">
            {sectionContent[key]}
          </div>
        )}
      </div>
    )
  }

  const allSections: SectionKey[] = ['fund', 'tech', 'chips', 'meta']

  return (
    <>
      {/* 桌機 */}
      <div className="hidden md:block">
        {/* 全域工具列：清除按鈕（有任何 filter 啟用時顯示） */}
        {totalActive > 0 && (
          <div
            className="flex items-center justify-end px-5 py-1.5 border-b"
            style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
          >
            <button
              onClick={reset}
              className="text-[10px] px-2 py-1 rounded border transition-colors"
              style={{
                background: 'var(--color-bg-600)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}
              title="清除所有篩選條件"
            >
              清除全部 ({totalActive})
            </button>
          </div>
        )}
        {allSections.map(renderSection)}
      </div>

      {/* 手機按鈕 */}
      <div className="flex md:hidden items-center gap-2 px-5 py-2 border-b"
        style={{ background: 'var(--color-bg-700)', borderColor: 'var(--color-border)' }}
      >
        <button
          onClick={() => setMobileOpen(true)}
          className="text-xs px-3 py-1 rounded border font-medium transition-colors"
          style={{
            background: totalActive > 0 ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
            borderColor: totalActive > 0 ? 'var(--color-accent-cyan)' : 'var(--color-border)',
            color: totalActive > 0 ? '#fff' : 'var(--color-text-secondary)',
            cursor: 'pointer',
          }}
        >
          篩選器{totalActive > 0 ? ` (${totalActive})` : ''}
        </button>
        {totalActive > 0 && (
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

      {/* 手機 modal */}
      {mobileOpen && (
        <div
          className="fixed left-0 right-0 top-0 z-[9999] md:hidden"
          style={{
            // 100dvh = dynamic viewport height（會跟著 iOS Safari URL bar 收合動態調整）
            // 所有 modern 瀏覽器都支援（Safari 15.4+、Chrome 108+、Firefox 101+）
            height: '100dvh',
            background: 'var(--color-bg-800)',
            display: 'flex',
            flexDirection: 'column',
            overscrollBehavior: 'contain',
            touchAction: 'pan-y',
          }}
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="w-full overflow-y-auto animate-fadein flex flex-col flex-1"
            style={{
              background: 'var(--color-bg-800)',
              // 處理 iPhone notch / Dynamic Island 安全區域
              paddingTop: 'env(safe-area-inset-top, 0)',
              paddingBottom: 'env(safe-area-inset-bottom, 0)',
              overscrollBehavior: 'contain',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              className="sticky top-0 flex items-center justify-between px-4 py-3 border-b"
              style={{
                background: 'var(--color-bg-700)',
                borderColor: 'var(--color-border)',
                // RangeSlider thumb 用 z-index 3~4，sticky 要比它高才不會被圓圈蓋住
                zIndex: 10,
              }}
            >
              <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
                篩選條件{totalActive > 0 ? ` · ${totalActive} 項` : ''}
              </span>
              <div className="flex items-center gap-2">
                {totalActive > 0 && (
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
            <div>
              {allSections.map(renderSection)}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
