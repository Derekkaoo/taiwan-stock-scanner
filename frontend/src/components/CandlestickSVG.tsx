// ============================================================
//  CandlestickSVG — 純 SVG 手刻 K 線圖
//  包含：K 棒 OHLC、20MA（橙）、60MA（藍）、成交量柱（下方）
//  特點：零外部依賴、最省資源、SSR 友好
// ============================================================
import { useMemo } from 'react'
import type { KlineBar } from '../types'
import { calcMA } from '../hooks/useKline'

interface Props {
  data: KlineBar[]
  width?: number
  height?: number
  showVolume?: boolean
  showMA?: boolean
  className?: string
}

// 台股顏色規則：收紅 = 上漲，收綠 = 下跌
const C = {
  UP:       '#ef4444',
  DOWN:     '#22c55e',
  MA20:     '#f97316',
  MA60:     '#60a5fa',
  VOL_UP:   'rgba(239,68,68,0.45)',
  VOL_DOWN: 'rgba(34,197,94,0.45)',
  GRID:     'rgba(255,255,255,0.04)',
  TEXT:     '#4a5568',
  BG:       '#141c2e',
}

export function CandlestickSVG({
  data,
  width = 340,
  height = 160,
  showVolume = true,
  showMA = true,
  className = '',
}: Props) {
  const n = data.length

  const dims = useMemo(() => {
    const PAD = { t: 10, r: 4, b: showVolume ? 34 : 14, l: 40 }
    const volH  = showVolume ? 30 : 0
    const chartH = height - PAD.t - PAD.b - volH - (showVolume ? 4 : 0)
    const chartW = width - PAD.l - PAD.r
    return { PAD, volH, chartH, chartW }
  }, [width, height, showVolume])

  const { PAD, volH, chartH, chartW } = dims

  const { maxH, minL, maxV, ma20, ma60 } = useMemo(() => {
    if (!n) return { maxH: 100, minL: 0, maxV: 1, ma20: [] as (number|null)[], ma60: [] as (number|null)[] }
    const highs  = data.map(d => d.h)
    const lows   = data.map(d => d.l)
    const closes = data.map(d => d.c)
    const vols   = data.map(d => d.v)
    const maxH   = Math.max(...highs) * 1.005
    const minL   = Math.min(...lows)  * 0.995
    const maxV   = Math.max(...vols, 1)
    return {
      maxH, minL, maxV,
      ma20: calcMA(closes, 20),
      ma60: calcMA(closes, 60),
    }
  }, [data, n])

  const toX = (i: number) => PAD.l + (i + 0.5) * chartW / n
  const toY = (v: number) => PAD.t + (1 - (v - minL) / (maxH - minL)) * chartH
  const barW = Math.max(1, chartW / n * 0.7)

  // 格線 Y 值
  const gridYs = [0.2, 0.5, 0.8].map(pct => {
    const v = minL + (maxH - minL) * (1 - pct)
    return { y: PAD.t + pct * chartH, label: v >= 100 ? v.toFixed(0) : v.toFixed(1) }
  })

  // MA 折線 path
  const maPath = (arr: (number | null)[]) => {
    let d = ''
    let started = false
    arr.forEach((v, i) => {
      if (v === null) { started = false; return }
      const x = toX(i), y = toY(v)
      d += started ? ` L${x.toFixed(1)},${y.toFixed(1)}` : `M${x.toFixed(1)},${y.toFixed(1)}`
      started = true
    })
    return d
  }

  // 日期標籤（頭 / 中 / 尾）
  const dateLabels = n >= 2
    ? [[0, 'start'], [Math.floor(n / 2), 'middle'], [n - 1, 'end']] as [number, string][]
    : []

  const volTop = PAD.t + chartH + 6

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={`block ${className}`}
      style={{ background: C.BG, borderRadius: 4 }}
    >
      {/* 背景格線 */}
      {gridYs.map(({ y, label }) => (
        <g key={y}>
          <line x1={PAD.l} y1={y} x2={width - PAD.r} y2={y} stroke={C.GRID} strokeWidth={0.5} />
          <text x={PAD.l - 3} y={y + 3} textAnchor="end" fontSize={8} fill={C.TEXT}
                fontFamily="monospace" fontVariantNumeric="tabular-nums">
            {label}
          </text>
        </g>
      ))}

      {/* K 棒 */}
      {data.map((d, i) => {
        const up    = d.c >= d.o
        const color = up ? C.UP : C.DOWN
        const x     = toX(i)
        const yH    = toY(d.h)
        const yL    = toY(d.l)
        const yO    = toY(d.o)
        const yC    = toY(d.c)
        const bodyTop = Math.min(yO, yC)
        const bodyH   = Math.max(0.8, Math.abs(yO - yC))
        return (
          <g key={i}>
            {/* 影線 */}
            <line x1={x} y1={yH} x2={x} y2={yL} stroke={color} strokeWidth={0.8} />
            {/* 實體 */}
            <rect
              x={x - barW / 2}
              y={bodyTop}
              width={barW}
              height={bodyH}
              fill={color}
            />
          </g>
        )
      })}

      {/* MA 線 */}
      {showMA && n >= 20 && (
        <path d={maPath(ma20)} stroke={C.MA20} strokeWidth={1} fill="none" />
      )}
      {showMA && n >= 60 && (
        <path d={maPath(ma60)} stroke={C.MA60} strokeWidth={1} fill="none" />
      )}

      {/* MA 圖例 */}
      {showMA && n >= 20 && (
        <g>
          <rect x={width - 68} y={4} width={6} height={6} rx={1} fill={C.MA20} />
          <text x={width - 60} y={10} fontSize={7.5} fill={C.MA20} fontFamily="monospace">MA20</text>
          {n >= 60 && (
            <>
              <rect x={width - 38} y={4} width={6} height={6} rx={1} fill={C.MA60} />
              <text x={width - 30} y={10} fontSize={7.5} fill={C.MA60} fontFamily="monospace">MA60</text>
            </>
          )}
        </g>
      )}

      {/* 成交量柱 */}
      {showVolume && data.map((d, i) => {
        const up    = d.c >= d.o
        const vh    = Math.max(1, (d.v / maxV) * (volH - 2))
        const x     = toX(i)
        return (
          <rect
            key={i}
            x={x - barW / 2}
            y={volTop + volH - vh}
            width={barW}
            height={vh}
            fill={up ? C.VOL_UP : C.VOL_DOWN}
          />
        )
      })}

      {/* 日期軸 */}
      {dateLabels.map(([i, anchor]) => (
        <text
          key={i}
          x={toX(i)}
          y={height - 2}
          textAnchor={anchor}
          fontSize={7.5}
          fill={C.TEXT}
          fontFamily="sans-serif"
        >
          {data[i]?.date?.slice(-5) ?? ''}
        </text>
      ))}
    </svg>
  )
}

/** 迷你 Sparkline（表格行內使用，不含量） */
export function SparklineSVG({
  data,
  width = 80,
  height = 28,
}: { data: KlineBar[]; width?: number; height?: number }) {
  const closes = data.map(d => d.c)
  if (!closes.length) return null
  const max = Math.max(...closes)
  const min = Math.min(...closes)
  const range = max - min || 1
  const n = closes.length
  const toX = (i: number) => (i / (n - 1)) * width
  const toY = (v: number) => height - 2 - ((v - min) / range) * (height - 4)
  const pts = closes.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
  const up = closes[closes.length - 1] >= closes[0]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block">
      <polyline points={pts} fill="none" stroke={up ? C.UP : C.DOWN} strokeWidth={1.2} />
    </svg>
  )
}
