// ============================================================
//  個股列表 toolbar 的篩選器集合
//  桌機 + 手機都用 collapsible sections（基本面 / 技術面 / 籌碼面 / 其他）
//  默認全收起；展開狀態持久化到 localStorage
// ============================================================
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Filters, GrowthQuarters, InstStreakDays, MarketFilter,
  NReturnDays, NHighDays,
  VolumeNewHighDays, VolumeSurgeBaseline, VolumeSurgeMultiplier,
  MaAlignmentPeriod, MaDirectionPeriod,
  MaBreakoutDays, MaBreakoutPeriod,
  MaContinuationDirection, MaContinuationPeriod,
  MaSustainedDays, MaSustainedPeriod,
  DowntrendBreakDays, DowntrendBreakPivots,
  PullbackMaPeriod,
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
  DOWNTREND_BREAK_DAYS_OPTIONS, DOWNTREND_BREAK_PIVOTS_OPTIONS,
  PULLBACK_MA_PERIOD_OPTIONS,
} from '../types'
import { RangeSlider } from './RangeSlider'
import { IndustryChips } from './IndustryChips'
import { makePiecewiseScale, makeLinearScale } from '../utils/scale'
import { recentQuarters } from '../utils/filters'

interface Props {
  stocks:   StockRow[]
  filters:  Filters
  onChange: (next: Filters) => void
  /** 手機 modal 開關（受控）。提供時 FiltersBar 會用父層 state；未提供則用內部 state（向後相容）*/
  mobileOpen?:    boolean
  setMobileOpen?: (open: boolean) => void
  /** 隱藏手機觸發按鈕條（如果父層用 bottom nav 已經提供了入口）*/
  hideMobileTrigger?: boolean
  /** 手機全螢幕模式：取代既有 trigger+modal，直接 inline 渲染 sections + 底部「查看結果」按鈕 */
  mobileFullscreen?: boolean
  /** 全螢幕模式：篩出來的結果筆數（顯示在底部按鈕）*/
  resultCount?: number
  /** 全螢幕模式：點底部按鈕觸發（通常切到 stock tab）*/
  onShowResults?: () => void
}

const VOLUME_SCALE     = makePiecewiseScale([0, 5000, 25000, 100000, 500000])  // 張（左密右疏）
const MARKET_CAP_SCALE = makePiecewiseScale([0, 50, 200, 1000, 5000])
const DELTA_SCALE      = makeLinearScale(FILTER_BOUNDS.delta.min,      FILTER_BOUNDS.delta.max)
const REVENUE_SCALE    = makeLinearScale(FILTER_BOUNDS.revenueYoY.min, FILTER_BOUNDS.revenueYoY.max)
const GM_SCALE         = makeLinearScale(FILTER_BOUNDS.grossMargin.min,     FILTER_BOUNDS.grossMargin.max)
const OM_SCALE         = makeLinearScale(FILTER_BOUNDS.operatingMargin.min, FILTER_BOUNDS.operatingMargin.max)
const EPS_SCALE        = makePiecewiseScale([-10, 0, 5, 20, 100])         // EPS：0~5 大公司密集，>20 少數
const N_RETURN_SCALE   = makeLinearScale(FILTER_BOUNDS.nDayReturn.min, FILTER_BOUNDS.nDayReturn.max)

/** 手機友善的 tooltip — 點擊 ⓘ 開關（HTML title= 在 mobile 不會顯示）
 *  用 position: fixed + viewport bounds clamp，避免被父層 overflow 切到、避免衝出螢幕 */
function InfoPopup({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)

  const POPUP_W = 280
  const MARGIN  = 8

  // ⓘ 點開時 → 量 icon 位置 → 算 popup 該在哪
  useEffect(() => {
    if (!open || !ref.current) {
      setPos(null)
      return
    }
    const rect = ref.current.getBoundingClientRect()
    const vw   = window.innerWidth
    // 想以 icon 中心為水平中心，但 clamp 在 viewport 邊界
    const desiredCenter = rect.left + rect.width / 2
    let left = desiredCenter - POPUP_W / 2
    if (left < MARGIN) left = MARGIN
    if (left + POPUP_W > vw - MARGIN) left = vw - POPUP_W - MARGIN
    setPos({
      top:  rect.top - MARGIN,  // popup 底部離 icon 上緣 8px
      left,
    })
  }, [open])

  // 外點關閉
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [open])

  return (
    <span ref={ref} style={{ display: 'inline-block' }}>
      <span
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
        style={{
          cursor: 'pointer',
          fontSize: 11,
          color: 'var(--color-accent-cyan)',
          opacity: 0.7,
          userSelect: 'none',
          padding: '2px 4px',  // 加大 tap target（手機）
          marginLeft: 2,
        }}
      >
        ⓘ
      </span>
      {open && pos && (
        <div style={{
          position: 'fixed',
          top:  pos.top,
          left: pos.left,
          transform: 'translateY(-100%)',  // 整個 popup 移到 top 點之上
          background: 'var(--color-bg-800)',
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: '8px 10px',
          fontSize: 11,
          color: 'var(--color-text-primary)',
          whiteSpace: 'pre-line',  // 尊重 \n 換行
          width: POPUP_W,
          maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
          zIndex: 9999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          lineHeight: 1.5,
          textAlign: 'left',
        }}>
          {text}
        </div>
      )}
    </span>
  )
}

const EPS = 1e-6
const ranged = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) > EPS || Math.abs(a[1] - b[1]) > EPS

// ============================================================
//  Filter block helper components
//  - FilterBlock: 一個 filter 的卡片 wrapper（標題 + 清除 + 內容 + confirm/warning hint）
//  - FilterSubRow: 卡片內的「左 label / 右 chips」橫排
//  - ChipButton: 統一樣式的 chip 按鈕
// ============================================================
function FilterBlock({
  title, active = false, onClear, confirmText, warningText, children,
}: {
  title: React.ReactNode
  active?: boolean
  onClear?: () => void
  confirmText?: string
  warningText?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-[13px]" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
          {title}
        </div>
        {active && onClear && (
          <button
            onClick={onClear}
            className="text-[11px] px-2 py-0.5 rounded border transition-colors"
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
      {children}
      {confirmText && (
        <span className="text-[11px] tabular font-mono" style={{ color: 'var(--color-accent-cyan)' }}>
          ✓ {confirmText}
        </span>
      )}
      {warningText && (
        <span className="text-[11px] italic" style={{ color: 'var(--color-text-muted)' }}>
          {warningText}
        </span>
      )}
    </div>
  )
}

function FilterSubRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className="text-[11px] shrink-0 pt-1"
        style={{ color: 'var(--color-text-muted)', minWidth: 56 }}
      >
        {label}
      </span>
      <div className="flex items-center flex-wrap gap-1 flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}

function ChipButton({
  active, label, onClick,
}: {
  active: boolean
  label: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
      style={{
        background:  active ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
        borderColor: active ? 'var(--color-accent-cyan)' : 'var(--color-border)',
        color:       active ? '#fff' : 'var(--color-text-secondary)',
        fontWeight:  active ? 600 : 400,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

type SectionKey = 'fund' | 'tech' | 'chips' | 'meta'

const SECTION_LABELS: Record<SectionKey, string> = {
  fund:  '📊 基本面',
  tech:  '📈 技術面',
  chips: '💰 籌碼面',
  meta:  '🏷 其他',
}

export function activeCountForSection(key: SectionKey, f: Filters): number {
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
      if ((f.downtrendBreak?.days ?? 0) !== 0) n++
      if ((f.pullbackMa?.period ?? 0) !== 0) n++
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

export function totalActiveCount(f: Filters): number {
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

export function FiltersBar({
  stocks, filters, onChange,
  mobileOpen: extOpen, setMobileOpen: extSetOpen, hideMobileTrigger,
  mobileFullscreen, resultCount, onShowResults,
}: Props) {
  // 控制模式：父層提供 mobileOpen + setMobileOpen → 用父層 state；否則用內部 state（向後相容）
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = extOpen !== undefined && extSetOpen !== undefined
  const mobileOpen    = isControlled ? extOpen!  : internalOpen
  const setMobileOpen = isControlled ? extSetOpen! : setInternalOpen
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

  const setDownBreakDays = (d: DowntrendBreakDays) =>
    set({ downtrendBreak: { ...filters.downtrendBreak, days: d } })
  const setDownBreakPivots = (p: DowntrendBreakPivots) =>
    set({ downtrendBreak: { ...filters.downtrendBreak, pivots: p } })
  const clearDowntrendBreak = () =>
    set({ downtrendBreak: { days: 0, pivots: 3 } })

  const setPullbackMaPeriod = (p: PullbackMaPeriod) =>
    set({ pullbackMa: { period: p } })
  const clearPullbackMa = () =>
    set({ pullbackMa: { period: 0 } })

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
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>連續 YoY 成長</span>
      <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>近</span>
      <div className="flex items-center gap-1">
        {GROWTH_QUARTERS_OPTIONS.map(q => {
          const active = filters.growth.quarters === q
          return (
            <button
              key={q}
              onClick={() => setGrowthQ(q)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
      <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>都正</span>
      <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
      {(['eps', 'grossMargin', 'operatingMargin'] as const).map(k => {
        const checked = filters.growth.metrics[k]
        const enabled = filters.growth.quarters !== 0
        return (
          <label
            key={k}
            className="inline-flex items-center gap-1 text-[12px] select-none"
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
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>連續買超</span>
      <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>近</span>
      <div className="flex items-center gap-1">
        {INST_STREAK_OPTIONS.map(d => {
          const active = filters.institutional.days === d
          return (
            <button
              key={d}
              onClick={() => setInstDays(d)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
      <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>都買超</span>
      <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
      {(['foreign', 'trust'] as const).map(k => {
        const checked = filters.institutional[k]
        return (
          <label
            key={k}
            className="inline-flex items-center gap-1 text-[12px] select-none"
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
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>市場</span>
      <div className="flex items-center gap-1">
        {MARKET_OPTIONS.map(opt => {
          const active = filters.market === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => setMarket(opt.value)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>N 日漲跌幅</span>
      <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>近</span>
      <div className="flex items-center gap-1">
        {N_RETURN_OPTIONS.map(d => {
          const active = filters.nDayReturn.days === d
          return (
            <button
              key={d}
              onClick={() => setNReturnDays(d)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>創新高</span>
      <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>盤中創</span>
      <div className="flex items-center gap-1 flex-wrap">
        {N_HIGH_OPTIONS.map(d => {
          const active = filters.nDayHigh.days === d
          return (
            <button
              key={d}
              onClick={() => setNHighDays(d)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>成交量創新高</span>
      <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>盤中創</span>
      <div className="flex items-center gap-1 flex-wrap">
        {VOLUME_NEW_HIGH_OPTIONS.map(d => {
          const active = filters.volumeNewHigh.days === d
          return (
            <button
              key={d}
              onClick={() => setVolumeNewHighDays(d)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>成交爆量</span>
        <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>大於</span>
        <div className="flex items-center gap-1 flex-wrap">
          {VOLUME_SURGE_MULTIPLIER_OPTIONS.map(m => {
            const active = filters.volumeSurge.multiplier === m
            return (
              <button
                key={m}
                onClick={() => setVolumeSurgeMultiplier(m)}
                className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
        <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>基準</span>
        <div className="flex items-center gap-1 flex-wrap">
          {VOLUME_SURGE_BASELINE_OPTIONS.map(opt => {
            const active = filters.volumeSurge.baseline === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setVolumeSurgeBaseline(opt.value)}
                className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>均線多頭排列</span>
      <div className="flex items-center gap-1 flex-wrap">
        {MA_ALIGNMENT_OPTIONS.map(p => {
          const active = maPeriodsSelected.includes(p)
          return (
            <button
              key={p}
              onClick={() => toggleMaPeriod(p)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
        <span className="text-[11px] tabular font-mono" style={{ color: 'var(--color-accent-cyan)' }}>
          {maPeriodsSelected.map(p => `${p}MA`).join(' > ')}
        </span>
      )}
      {maPeriodsSelected.length === 1 && (
        <span className="text-[11px] italic" style={{ color: 'var(--color-text-muted)' }}>
          （至少選 2 個才生效）
        </span>
      )}
      <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
      <button
        onClick={resetMaAlignment}
        className="text-[11px] px-2 py-0.5 rounded border transition-colors"
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
          className="text-[11px] px-2 py-0.5 rounded border transition-colors"
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
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>均線方向朝上</span>
      <div className="flex items-center gap-1 flex-wrap">
        {MA_DIRECTION_OPTIONS.map(p => {
          const active = maDirSelected.includes(p)
          return (
            <button
              key={p}
              onClick={() => toggleMaDirPeriod(p)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
        <span className="text-[11px] tabular font-mono" style={{ color: 'var(--color-accent-cyan)' }}>
          {maDirSelected.map(p => `${p}MA↑`).join(' & ')}
        </span>
      )}
      {maDirSelected.length > 0 && (
        <>
          <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
          <button
            onClick={clearMaDirection}
            className="text-[11px] px-2 py-0.5 rounded border transition-colors"
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
    <FilterBlock
      title="N 日內突破 MA"
      active={maBreakoutDaysSel !== 0 || maBreakoutPeriodSel !== 0}
      onClear={clearMaBreakout}
      confirmText={maBreakoutActive ? `${maBreakoutDaysSel} 日內突破 ${maBreakoutPeriodSel}MA` : undefined}
      warningText={
        (maBreakoutDaysSel !== 0 || maBreakoutPeriodSel !== 0) && !maBreakoutActive
          ? '（天數與 MA 都要選才生效）'
          : undefined
      }
    >
      <FilterSubRow label="天數">
        {MA_BREAKOUT_DAYS_OPTIONS.map(d => (
          <ChipButton
            key={d}
            active={maBreakoutDaysSel === d}
            label={d === 0 ? '關閉' : `${d}日`}
            onClick={() => setMaBreakoutDays(d)}
          />
        ))}
      </FilterSubRow>
      <FilterSubRow label="MA 週期">
        {MA_BREAKOUT_PERIOD_OPTIONS.map(p => (
          <ChipButton
            key={p}
            active={maBreakoutPeriodSel === p}
            label={p === 0 ? '關閉' : `${p}MA`}
            onClick={() => setMaBreakoutPeriod(p)}
          />
        ))}
      </FilterSubRow>
    </FilterBlock>
  )

  // 明日 MA 續揚 / 下彎 block（扣抵值預測）
  const maContDir    = filters.maContinuation?.direction ?? 'off'
  const maContPeriod = filters.maContinuation?.period    ?? 0
  const maContActive = maContDir !== 'off' && maContPeriod !== 0
  const maContinuationBlock = (
    <FilterBlock
      title="明日 MA 續揚 / 下彎"
      active={maContDir !== 'off' || maContPeriod !== 0}
      onClear={clearMaContinuation}
      confirmText={maContActive ? `明日 ${maContPeriod}MA ${maContDir === 'up' ? '續揚 ▲' : '下彎 ▼'}` : undefined}
      warningText={
        (maContDir !== 'off' || maContPeriod !== 0) && !maContActive
          ? '（方向與 MA 都要選才生效）'
          : undefined
      }
    >
      <FilterSubRow label="方向">
        {MA_CONTINUATION_DIRECTION_OPTIONS.map(opt => (
          <ChipButton
            key={opt.value}
            active={maContDir === opt.value}
            label={opt.label}
            onClick={() => setMaContDirection(opt.value)}
          />
        ))}
      </FilterSubRow>
      <FilterSubRow label="MA 週期">
        {MA_CONTINUATION_PERIOD_OPTIONS.map(p => (
          <ChipButton
            key={p}
            active={maContPeriod === p}
            label={p === 0 ? '關閉' : `${p}MA`}
            onClick={() => setMaContPeriod(p)}
          />
        ))}
      </FilterSubRow>
    </FilterBlock>
  )

  // 未來 N 日 MA 易續揚 block（扣抵保護）+ tooltip
  const maSustDays   = filters.maSustained?.days   ?? 0
  const maSustPeriod = filters.maSustained?.period ?? 0
  const maSustActive = maSustDays !== 0 && maSustPeriod !== 0
  const maSustainedBlock = (
    <FilterBlock
      title={
        <>
          未來 N 日 MA 易續揚
          <InfoPopup
            text={
              '未來 N 個交易日內，即使股價盤整不漲、甚至小跌（容忍度 ≈ 現價與扣抵值差距），MA 仍會連續上揚。\n\n' +
              '例：選 5 日 + 20MA → 命中股票表示「未來 5 天即使每天小跌 1-3%，MA-20 仍會續揚」。\n\n' +
              '又稱「黃金扣抵期」— 技術派常用來確認波段安全進場區。'
            }
          />
        </>
      }
      active={maSustDays !== 0 || maSustPeriod !== 0}
      onClear={clearMaSustained}
      confirmText={maSustActive ? `未來 ${maSustDays} 日 ${maSustPeriod}MA 易續揚` : undefined}
      warningText={
        (maSustDays !== 0 || maSustPeriod !== 0) && !maSustActive
          ? '（天數與 MA 都要選才生效）'
          : undefined
      }
    >
      <FilterSubRow label="天數">
        {MA_SUSTAINED_DAYS_OPTIONS.map(d => (
          <ChipButton
            key={d}
            active={maSustDays === d}
            label={d === 0 ? '關閉' : `${d}日`}
            onClick={() => setMaSustDays(d)}
          />
        ))}
      </FilterSubRow>
      <FilterSubRow label="MA 週期">
        {MA_SUSTAINED_PERIOD_OPTIONS.map(p => (
          <ChipButton
            key={p}
            active={maSustPeriod === p}
            label={p === 0 ? '關閉' : `${p}MA`}
            onClick={() => setMaSustPeriod(p)}
          />
        ))}
      </FilterSubRow>
    </FilterBlock>
  )

  // 抓轉折 — 突破下降趨勢 block
  const downBreakDays   = filters.downtrendBreak?.days   ?? 0
  const downBreakPivots = filters.downtrendBreak?.pivots ?? 3
  const downBreakActive = downBreakDays !== 0
  const pivotsToHighNDays = (p: number) => p <= 3 ? 5 : p === 4 ? 10 : 15
  const downtrendBreakBlock = (
    <FilterBlock
      title="抓轉折（突破下降趨勢）"
      active={downBreakActive}
      onClear={clearDowntrendBreak}
      confirmText={
        downBreakActive
          ? `${downBreakDays} 日量價反轉 + 突破 ${pivotsToHighNDays(downBreakPivots)} 日高`
          : undefined
      }
    >
      <FilterSubRow label="趨勢期間">
        {DOWNTREND_BREAK_DAYS_OPTIONS.map(d => (
          <ChipButton
            key={d}
            active={downBreakDays === d}
            label={d === 0 ? '關閉' : `${d}日`}
            onClick={() => setDownBreakDays(d)}
          />
        ))}
      </FilterSubRow>
      <FilterSubRow label="壓力位">
        {DOWNTREND_BREAK_PIVOTS_OPTIONS.map(p => (
          <ChipButton
            key={p}
            active={downBreakPivots === p}
            label={`${pivotsToHighNDays(p)} 日高`}
            onClick={() => setDownBreakPivots(p)}
          />
        ))}
      </FilterSubRow>
    </FilterBlock>
  )

  // 回撤均線 block
  const pullbackMaPeriod = filters.pullbackMa?.period ?? 0
  const pullbackMaActive = pullbackMaPeriod !== 0
  const pullbackMaBlock = (
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>(曾)回撤均線</span>
      <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>均線</span>
      <div className="flex items-center gap-1 flex-wrap">
        {PULLBACK_MA_PERIOD_OPTIONS.map(p => {
          const active = pullbackMaPeriod === p
          return (
            <button
              key={p}
              onClick={() => setPullbackMaPeriod(p)}
              className="text-[11px] px-2 py-0.5 rounded-full border transition-colors"
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
      {pullbackMaActive && (
        <span className="text-[11px] tabular font-mono" style={{ color: 'var(--color-accent-cyan)' }}>
          回撤到 {pullbackMaPeriod}MA
        </span>
      )}
      {pullbackMaActive && (
        <>
          <span className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
          <button
            onClick={clearPullbackMa}
            className="text-[11px] px-2 py-0.5 rounded border transition-colors"
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

  const absEnabled = !!filters.absValue.quarter
  const absValueBlock = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center flex-wrap gap-2">
        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>按季篩選</span>
        <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>選一季</span>
        <div className="flex items-center gap-1 flex-wrap">
          {quarters.length === 0 && (
            <span className="text-[11px] italic" style={{ color: 'var(--color-text-muted)' }}>
              （暫無資料，請點上方「🔄 更新資料」按鈕）
            </span>
          )}
          {quarters.map(q => {
            const active = filters.absValue.quarter === q
            return (
              <button
                key={q}
                onClick={() => setAbsQuarter(q)}
                className="text-[11px] px-2 py-0.5 rounded-full border transition-colors font-mono tabular"
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
          <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
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
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{downtrendBreakBlock}</div>
        <div className="border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>{pullbackMaBlock}</div>
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
          <div className="text-[11px] mb-2" style={{ color: 'var(--color-text-muted)' }}>產業別（多選任一）</div>
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
                className="rounded-full px-1.5 py-0.5 text-[11px] font-mono tabular"
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

  // 手機全螢幕模式：直接 inline 渲染 sections + sticky header + fixed 底部按鈕
  if (mobileFullscreen) {
    const count = resultCount ?? 0
    return (
      <div className="flex flex-col" style={{ background: 'var(--color-bg-700)' }}>
        {/* Sticky header：篩選條件 + 清除全部 */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{
            background: 'var(--color-bg-700)',
            borderColor: 'var(--color-border)',
            position: 'sticky',
            top: 44,
            zIndex: 30,
          }}
        >
          <span className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>
            篩選條件{totalActive > 0 ? ` · ${totalActive} 項` : ''}
          </span>
          {totalActive > 0 && (
            <button
              onClick={reset}
              className="text-[12px] px-2.5 py-1 rounded border"
              style={{
                background: 'var(--color-bg-600)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-secondary)',
              }}
            >
              清除全部
            </button>
          )}
        </div>

        {/* Sections（normal flow，paddingBottom 留空間給底部 fixed 按鈕）*/}
        <div style={{ paddingBottom: 120 }}>
          {allSections.map(renderSection)}
        </div>

        {/* Fixed 底部按鈕：在 bottom nav 上方 */}
        <div
          className="fixed left-0 right-0 px-4 py-2.5 border-t"
          style={{
            bottom: 'calc(64px + env(safe-area-inset-bottom, 0))',
            background: 'var(--color-bg-700)',
            borderColor: 'var(--color-border)',
            zIndex: 40,
          }}
        >
          <button
            onClick={onShowResults}
            disabled={count === 0}
            className="w-full py-3 rounded font-medium transition-colors"
            style={{
              background: count === 0 ? 'var(--color-bg-600)' : 'var(--color-accent-cyan)',
              color: count === 0 ? 'var(--color-text-muted)' : '#fff',
              border: 0,
              cursor: count === 0 ? 'not-allowed' : 'pointer',
              fontSize: 14,
              opacity: count === 0 ? 0.6 : 1,
            }}
          >
            {count === 0 ? '無符合條件' : `查看 ${count} 筆結果 →`}
          </button>
        </div>
      </div>
    )
  }

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
              className="text-[11px] px-2 py-1 rounded border transition-colors"
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

      {/* 手機按鈕（如果父層用 bottom nav 接管 filter 入口，可隱藏）*/}
      {!hideMobileTrigger && (
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
            className="text-[11px] px-2 py-1 rounded border transition-colors"
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
      )}

      {/* 手機 modal */}
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
              style={{
                background: 'var(--color-bg-700)',
                borderColor: 'var(--color-border)',
                zIndex: 10,  // 高於下方 RangeSlider thumbs，避免 scroll 時 thumb 透出 header
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
