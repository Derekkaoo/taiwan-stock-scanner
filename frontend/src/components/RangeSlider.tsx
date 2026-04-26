// ============================================================
//  雙把手範圍 slider
//  用法：
//    <RangeSlider label="市值" unit="億" value={[0, 5000]}
//                 bounds={{min:0,max:5000}} scale={marketCapScale}
//                 display={{ snapTo: 10 }} onChange={setRange} />
//  - scale: 線性或分段刻度（從 utils/scale 拿）
//  - display.snapTo: 拉動後對齊到該步距（例 10 → 整十億）
// ============================================================
import type { PiecewiseScale } from '../utils/scale'
import { snap } from '../utils/scale'

interface Props {
  label:    string
  unit?:    string
  value:    [number, number]
  bounds:   { min: number; max: number }
  scale:    PiecewiseScale
  display?: { digits?: number; snapTo?: number }
  onChange: (v: [number, number]) => void
}

export function RangeSlider({ label, unit, value, bounds, scale, display, onChange }: Props) {
  const [lo, hi] = value
  const loPos = scale.toSlider(lo)
  const hiPos = scale.toSlider(hi)

  const fmt = (v: number): string => {
    const stepSize = display?.snapTo
    const x = stepSize ? snap(v, stepSize) : v
    const d = display?.digits ?? (stepSize && stepSize >= 1 ? 0 : 1)
    return x.toFixed(d)
  }

  const eps = 1e-6
  const loDisplay = lo <= bounds.min + eps ? '不限' : `${fmt(lo)}${unit ?? ''}`
  const hiDisplay = hi >= bounds.max - eps ? '不限' : `${fmt(hi)}${unit ?? ''}`

  const handleLo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pos = parseFloat(e.target.value)
    let v = scale.fromSlider(pos)
    if (display?.snapTo) v = snap(v, display.snapTo)
    v = Math.max(bounds.min, Math.min(v, hi))
    if (v !== lo) onChange([v, hi])
  }
  const handleHi = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pos = parseFloat(e.target.value)
    let v = scale.fromSlider(pos)
    if (display?.snapTo) v = snap(v, display.snapTo)
    v = Math.min(bounds.max, Math.max(v, lo))
    if (v !== hi) onChange([lo, v])
  }

  const fillLeft  = `${loPos * 100}%`
  const fillWidth = `${Math.max(0, (hiPos - loPos)) * 100}%`

  // 兩個 handle 都靠右時 lo 會被 hi 蓋住，靠左時相反 → 動態 z-index 讓兩個都可拖
  // 若 hi 距離左邊很近、lo 也在左邊，提高 lo 的 z-index 才能拉動
  const loZ = loPos > 0.5 ? 4 : 3
  const hiZ = loPos > 0.5 ? 3 : 4

  return (
    <div className="range-slider-row flex flex-col gap-1 min-w-[180px]">
      <div className="flex items-center justify-between text-[10px] gap-2 px-0.5">
        <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
        <span className="font-mono tabular" style={{ color: 'var(--color-text-secondary)' }}>
          {loDisplay} ~ {hiDisplay}
        </span>
      </div>
      <div className="range-slider relative h-5">
        {/* 灰底軌道 */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded pointer-events-none"
          style={{ background: 'var(--color-bg-500)' }}
        />
        {/* 選中段（亮色） */}
        <div
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 h-1 rounded pointer-events-none"
          style={{
            background: 'var(--color-accent-cyan)',
            left:  fillLeft,
            width: fillWidth,
          }}
        />
        <input
          type="range"
          min={0} max={1} step={scale.step}
          value={loPos}
          onChange={handleLo}
          aria-label={`${label} 最小值`}
          className="range-thumb-input absolute inset-0 w-full h-full"
          style={{ zIndex: loZ }}
        />
        <input
          type="range"
          min={0} max={1} step={scale.step}
          value={hiPos}
          onChange={handleHi}
          aria-label={`${label} 最大值`}
          className="range-thumb-input absolute inset-0 w-full h-full"
          style={{ zIndex: hiZ }}
        />
      </div>
    </div>
  )
}
