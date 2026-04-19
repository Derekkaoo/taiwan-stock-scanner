import type { KlineBar } from '../types'

interface Props {
  data: KlineBar[]
  width?: number
  height?: number
  showVolume?: boolean
  showMA?: boolean
  className?: string
}

function calcMA(data: number[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null
    return data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  })
}

function shortDate(dateStr: string): string {
  const parts = dateStr.replace(/-/g, '/').split('/')
  if (parts.length >= 3) return `${parts[1]}/${parts[2]}`
  return dateStr
}

export function CandlestickSVG({
  data, width = 316, height = 150,
  showVolume = true, showMA = true, className,
}: Props) {
  if (!data || data.length === 0) return null

  const dateAxisH = 14
  const maLegendH = showMA ? 14 : 0
  const volHeight = showVolume ? Math.floor(height * 0.2) : 0
  const chartH    = height - volHeight - dateAxisH - maLegendH - 4
  const padL = 4, padR = 44, padT = 8, padB = 8

  const closes  = data.map(d => d.c)
  const highs   = data.map(d => d.h)
  const lows    = data.map(d => d.l)
  const volumes = data.map(d => d.v)

  const ma20 = calcMA(closes, 20)
  const ma60 = calcMA(closes, 60)

  const minP   = Math.min(...lows)
  const maxP   = Math.max(...highs)
  const rangeP = maxP - minP || 1
  const maxV   = Math.max(...volumes) || 1

  const n       = data.length
  const candleW = Math.max(1, Math.floor((width - padL - padR) / n) - 1)
  const step    = (width - padL - padR) / n

  const px = (i: number) => padL + i * step + step / 2
  const py = (p: number) => padT + (1 - (p - minP) / rangeP) * (chartH - padT - padB)
  const vy = (v: number) => chartH + 4 + (1 - v / maxV) * (volHeight - 4)

  const upColor    = 'var(--color-up,   #22c55e)'
  const downColor  = 'var(--color-down, #ef4444)'
  const mutedColor = 'var(--color-text-muted, #6b7280)'

  const maPath = (vals: (number | null)[], color: string) => {
    const segments: string[] = []
    let seg = ''
    vals.forEach((v, i) => {
      if (v === null) {
        if (seg) { segments.push(seg); seg = '' }
      } else {
        seg += (seg ? ' L' : 'M') + ` ${px(i).toFixed(1)} ${py(v).toFixed(1)}`
      }
    })
    if (seg) segments.push(seg)
    return segments.map((s, i) => (
      <path key={i} d={s} fill="none" stroke={color} strokeWidth="1.5" opacity="0.9" />
    ))
  }

  const tickIndices = [0, Math.floor(n / 3), Math.floor(n * 2 / 3), n - 1]

  const dateAxisY = height - maLegendH - dateAxisH + 10
  const dateLineY = height - maLegendH - dateAxisH
  const maLegendY = height - maLegendH + 10
  const priceLabelX = width - padR + 4

  // 最高最低價對應的 Y 座標
  const maxPY = py(maxP)
  const minPY = py(minP)

  return (
    <svg
      width={width} height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      {/* 成交量柱 */}
      {showVolume && data.map((d, i) => {
        const isUp  = d.c >= d.o
        const color = isUp ? upColor : downColor
        const y     = vy(d.v)
        const bH    = chartH + 4 + volHeight - y - 2
        return (
          <rect key={i} x={px(i) - candleW / 2} y={y}
            width={candleW} height={Math.max(1, bH)}
            fill={color} opacity="0.4" />
        )
      })}

      {/* K 線蠟燭 */}
      {data.map((d, i) => {
        const isUp  = d.c >= d.o
        const color = isUp ? upColor : downColor
        const x     = px(i)
        const top   = py(Math.max(d.o, d.c))
        const bot   = py(Math.min(d.o, d.c))
        const bodyH = Math.max(1, bot - top)
        return (
          <g key={i}>
            <line x1={x} y1={py(d.h)} x2={x} y2={py(d.l)} stroke={color} strokeWidth="1" />
            <rect x={x - candleW / 2} y={top} width={candleW} height={bodyH} fill={color} />
          </g>
        )
      })}

      {/* MA 線 */}
      {showMA && maPath(ma20, '#f59e0b')}
      {showMA && maPath(ma60, '#3b82f6')}

      {/* 右側分隔線 */}
      <line
        x1={width - padR} y1={padT}
        x2={width - padR} y2={dateLineY}
        stroke={mutedColor} strokeWidth="0.5" opacity="0.2"
      />

      {/* 最高價標籤（對齊實際 Y 位置） */}
      <line
        x1={width - padR} y1={maxPY}
        x2={width - padR + 2} y2={maxPY}
        stroke={mutedColor} strokeWidth="0.5" opacity="0.5"
      />
      <text
        x={priceLabelX} y={maxPY + 4}
        fontSize={9} fill={mutedColor} fontFamily="monospace"
        textAnchor="start"
      >
        {maxP.toFixed(maxP >= 100 ? 1 : 2)}
      </text>

      {/* 最低價標籤（對齊實際 Y 位置） */}
      <line
        x1={width - padR} y1={minPY}
        x2={width - padR + 2} y2={minPY}
        stroke={mutedColor} strokeWidth="0.5" opacity="0.5"
      />
      <text
        x={priceLabelX} y={minPY + 4}
        fontSize={9} fill={mutedColor} fontFamily="monospace"
        textAnchor="start"
      >
        {minP.toFixed(minP >= 100 ? 1 : 2)}
      </text>

      {/* 日期軸分隔線 */}
      <line
        x1={padL} y1={dateLineY}
        x2={width - padR} y2={dateLineY}
        stroke={mutedColor} strokeWidth="0.5" opacity="0.3"
      />

      {/* 4 個日期刻度 */}
      {tickIndices.map((idx, ti) => {
        const x    = px(idx)
        const date = data[idx]?.date ? shortDate(data[idx].date) : ''
        return (
          <g key={ti}>
            <line
              x1={x} y1={dateLineY}
              x2={x} y2={dateLineY + 3}
              stroke={mutedColor} strokeWidth="0.5" opacity="0.5"
            />
            <text
              x={x} y={dateAxisY}
              fontSize={9} fill={mutedColor} fontFamily="monospace"
              textAnchor="middle"
            >
              {date}
            </text>
          </g>
        )
      })}

      {/* MA 圖例（日期軸下方） */}
      {showMA && (
        <g>
          <rect x={width - 68} y={maLegendY - 8} width={6} height={6} fill="#f59e0b" rx="1" />
          <text x={width - 60} y={maLegendY} fontSize={8} fill={mutedColor} fontFamily="monospace">MA20</text>
          <rect x={width - 32} y={maLegendY - 8} width={6} height={6} fill="#3b82f6" rx="1" />
          <text x={width - 24} y={maLegendY} fontSize={8} fill={mutedColor} fontFamily="monospace">MA60</text>
        </g>
      )}
    </svg>
  )
}