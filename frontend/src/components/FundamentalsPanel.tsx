import { useState } from 'react'
import type { Fundamentals } from '../types'

type TabKey = 'revenue' | 'gross' | 'op' | 'eps'

const TABS: { key: TabKey; label: string; kind: 'month' | 'quarter' }[] = [
  { key: 'revenue', label: '月營收YoY',     kind: 'month' },
  { key: 'gross',   label: '毛利率YoY',     kind: 'quarter' },
  { key: 'op',      label: '營業利益率YoY', kind: 'quarter' },
  { key: 'eps',     label: 'EPS YoY',       kind: 'quarter' },
]

interface Props {
  fundamentals?: Fundamentals
  /** viewBox 寬高比，預設 3:1（寬:高）*/
  aspectRatio?: number
}

function getSeries(f: Fundamentals | undefined, key: TabKey): Array<{ label: string; yoy: number }> {
  if (!f) return []
  if (key === 'revenue') {
    // "2025-04" → "25/04"
    return (f.revenueYoY ?? []).map(r => ({
      label: r.date.length >= 7 ? `${r.date.slice(2, 4)}/${r.date.slice(5, 7)}` : r.date,
      yoy: r.yoy,
    }))
  }
  if (key === 'gross')   return (f.grossMarginYoY     ?? []).map(r => ({ label: r.quarter, yoy: r.yoy }))
  if (key === 'op')      return (f.operatingMarginYoY ?? []).map(r => ({ label: r.quarter, yoy: r.yoy }))
  if (key === 'eps')     return (f.epsYoY             ?? []).map(r => ({ label: r.quarter, yoy: r.yoy }))
  return []
}

/** 把 maxAbs 進位到「漂亮」的刻度（10, 20, 50, 100…）*/
function niceCeiling(maxAbs: number): number {
  if (maxAbs <= 1) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(maxAbs)))
  const n = maxAbs / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * pow
}

/** 共用座標軸 + 格線 */
function Axes({
  ceiling, pad, w, h, xLabels, ticks = [1, 0.5, 0, -0.5, -1],
}: {
  ceiling: number
  pad: { top: number; right: number; bottom: number; left: number }
  w: number
  h: number
  xLabels: { x: number; text: string }[]
  ticks?: number[]
}) {
  const yScale = (v: number) => pad.top + h / 2 - (v / ceiling) * (h / 2)
  return (
    <g>
      {ticks.map((ratio, i) => {
        const t = ratio * ceiling
        const y = yScale(t)
        const isZero = ratio === 0
        return (
          <g key={i}>
            <line x1={pad.left} y1={y} x2={pad.left + w} y2={y}
                  stroke="var(--color-border)"
                  strokeWidth={isZero ? 1 : 0.6}
                  opacity={isZero ? 1 : 0.5}
                  strokeDasharray={isZero ? '' : '2,3'} />
            <text x={pad.left - 8} y={y + 3.5} fontSize={12}
                  fill="var(--color-text-muted)" textAnchor="end">
              {t >= 0 ? '+' : ''}{Math.round(t)}%
            </text>
          </g>
        )
      })}
      {/* Y 軸左線 */}
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + h}
            stroke="var(--color-border)" strokeWidth={1} />
      {/* X 軸底部線 */}
      <line x1={pad.left} y1={pad.top + h} x2={pad.left + w} y2={pad.top + h}
            stroke="var(--color-border)" strokeWidth={1} opacity={0.4} />
      {/* X 軸 label */}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={pad.top + h + 18} fontSize={12}
              fill="var(--color-text-muted)" textAnchor="middle">
          {l.text}
        </text>
      ))}
    </g>
  )
}

function BarChart({ data, viewW, viewH }: { data: Array<{ label: string; yoy: number }>; viewW: number; viewH: number }) {
  const pad = { top: 26, right: 22, bottom: 36, left: 58 }
  const w = viewW - pad.left - pad.right
  const h = viewH - pad.top - pad.bottom
  if (data.length === 0) {
    return <text x={viewW / 2} y={viewH / 2} fontSize={12} fill="var(--color-text-muted)" textAnchor="middle">無資料</text>
  }
  const maxAbs = Math.max(...data.map(d => Math.abs(d.yoy)), 1)
  const ceiling = niceCeiling(maxAbs * 1.15) // 多留 15% 空間給 value label
  const yScale = (v: number) => pad.top + h / 2 - (v / ceiling) * (h / 2)
  const barW = Math.min((w / data.length) * 0.6, 34)
  const step = w / data.length

  const xLabels = data.map((d, i) => ({ x: pad.left + i * step + step / 2, text: d.label }))

  return (
    <>
      <Axes ceiling={ceiling} pad={pad} w={w} h={h} xLabels={xLabels} />
      {data.map((d, i) => {
        const cx = pad.left + i * step + step / 2
        const y0 = yScale(0)
        const y1 = yScale(d.yoy)
        const yTop = Math.min(y0, y1)
        const barH = Math.abs(y1 - y0)
        const up = d.yoy >= 0
        // 值標籤位置：bar 外側，但 clamp 在 chart 範圍內
        const labelY = up
          ? Math.max(yTop - 5, pad.top + 10)
          : Math.min(yTop + barH + 12, pad.top + h - 2)
        return (
          <g key={i}>
            <rect x={cx - barW / 2} y={yTop} width={barW} height={Math.max(barH, 1)}
                  fill={up ? 'var(--color-up)' : 'var(--color-down)'} opacity={0.9} rx={1} />
            <text x={cx} y={labelY} fontSize={12} fontWeight={600}
                  fill={up ? 'var(--color-up)' : 'var(--color-down)'} textAnchor="middle">
              {up ? '+' : ''}{Math.round(d.yoy)}%
            </text>
          </g>
        )
      })}
    </>
  )
}

function LineChart({ data, viewW, viewH }: { data: Array<{ label: string; yoy: number }>; viewW: number; viewH: number }) {
  const pad = { top: 26, right: 26, bottom: 36, left: 58 }
  const w = viewW - pad.left - pad.right
  const h = viewH - pad.top - pad.bottom
  if (data.length === 0) {
    return <text x={viewW / 2} y={viewH / 2} fontSize={12} fill="var(--color-text-muted)" textAnchor="middle">無資料</text>
  }
  const maxAbs = Math.max(...data.map(d => Math.abs(d.yoy)), 1)
  const ceiling = niceCeiling(maxAbs * 1.15)
  const yScale = (v: number) => pad.top + h / 2 - (v / ceiling) * (h / 2)
  const step = data.length > 1 ? w / (data.length - 1) : w

  const points = data.map((d, i) => ({
    x: pad.left + i * step,
    y: yScale(d.yoy),
    yoy: d.yoy,
    label: d.label,
  }))
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')

  const xLabels = points.map(p => ({ x: p.x, text: p.label }))

  return (
    <>
      <Axes ceiling={ceiling} pad={pad} w={w} h={h} xLabels={xLabels} />
      <path d={pathD} stroke="var(--color-accent-cyan)" strokeWidth={1.8} fill="none" />
      {points.map((p, i) => {
        const up = p.yoy >= 0
        // 值標籤 clamp 在 chart 範圍內
        const labelY = up
          ? Math.max(p.y - 8, pad.top + 10)
          : Math.min(p.y + 14, pad.top + h - 2)
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={3.5}
                    fill={up ? 'var(--color-up)' : 'var(--color-down)'}
                    stroke="var(--color-bg-700)" strokeWidth={1.5} />
            <text x={p.x} y={labelY} fontSize={12} fontWeight={600}
                  fill={up ? 'var(--color-up)' : 'var(--color-down)'} textAnchor="middle">
              {up ? '+' : ''}{Math.round(p.yoy)}%
            </text>
          </g>
        )
      })}
    </>
  )
}

export function FundamentalsPanel({ fundamentals, aspectRatio = 3 }: Props) {
  const [tab, setTab] = useState<TabKey>('revenue')
  const active = TABS.find(t => t.key === tab)!
  const series = getSeries(fundamentals, tab)
  // 固定 viewBox（實際大小靠容器決定，viewBox 負責比例）
  const viewW = 600
  const viewH = Math.round(viewW / aspectRatio)

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-1 flex-wrap">
        {TABS.map(t => {
          const isActive = t.key === tab
          return (
            <button
              key={t.key}
              onClick={(e) => { e.stopPropagation(); setTab(t.key) }}
              className="text-xs px-2 py-1 rounded border transition-colors"
              style={{
                background: isActive ? 'var(--color-accent-cyan)' : 'var(--color-bg-600)',
                borderColor: isActive ? 'var(--color-accent-cyan)' : 'var(--color-border)',
                color: isActive ? '#fff' : 'var(--color-text-secondary)',
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <svg
        viewBox={`0 0 ${viewW} ${viewH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        {active.kind === 'month'
          ? <BarChart  data={series} viewW={viewW} viewH={viewH} />
          : <LineChart data={series} viewW={viewW} viewH={viewH} />}
      </svg>
    </div>
  )
}
