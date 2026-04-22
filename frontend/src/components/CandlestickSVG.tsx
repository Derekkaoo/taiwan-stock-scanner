import type { KlineBar } from '../types'

interface Props {
  data: KlineBar[]
  fullData?: KlineBar[]  // 完整資料，用來計算 MA
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
  data, fullData, width = 400, height = 200,
  showVolume = true, showMA = true, className,
}: Props) {
  if (!data || data.length === 0) return null

  const dateAxisH = 20
  const maLegendH = showMA ? 20 : 0
  const volHeight = showVolume ? Math.floor(height * 0.2) : 0
  const chartH    = height - volHeight - dateAxisH - maLegendH - 4
  const padL = 18, padR = 54, padT = 8, padB = 8

  const highs   = data.map(d => d.h)
  const lows    = data.map(d => d.l)
  const volumes = data.map(d => d.v)

  // MA 用完整資料計算，只取最後 data.length 筆
  const sourceData = fullData && fullData.length >= data.length ? fullData : data
  const sourceCloses = sourceData.map(d => d.c)
  const fullMA20 = calcMA(sourceCloses, 20)
  const fullMA60 = calcMA(sourceCloses, 60)
  const offset = sourceData.length - data.length
  const ma20 = fullMA20.slice(offset)
  const ma60 = fullMA60.slice(offset)

  const rawMin = Math.min(...lows)
  const rawMax = Math.max(...highs)
  const rawRange = rawMax - rawMin || 1
  const pricePad = rawRange * 0.05
  const minP = rawMin - pricePad
  const maxP = rawMax + pricePad
  const rangeP = maxP - minP

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

  const Y_TICKS = 4
  const yTicks = Array.from({ length: Y_TICKS }, (_, i) => {
    return minP + (rangeP * i) / (Y_TICKS - 1)
  })

  const tickIndices = [0, Math.floor(n / 3), Math.floor(n * 2 / 3), n - 1]
  const dateAxisY = height - maLegendH - dateAxisH + 14
  const dateLineY = height - maLegendH - dateAxisH
  const maLegendY = height - maLegendH + 14
  const priceLabelX = width - padR + 4

  return (
    <svg
      width={width} height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      {/* Y 軸格線 */}
      {yTicks.map((t, i) => (
        <line key={i}
          x1={padL} y1={py(t)}
          x2={width - padR} y2={py(t)}
          stroke={mutedColor} strokeWidth="0.3" opacity="0.2"
          strokeDasharray="3,3"
        />
      ))}

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

      {/* Y 軸刻度標籤 */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line
            x1={width - padR} y1={py(t)}
            x2={width - padR + 3} y2={py(t)}
            stroke={mutedColor} strokeWidth="0.5" opacity="0.5"
          />
          <text
            x={priceLabelX} y={py(t)}
            fontSize={12} fill={mutedColor}
            fontFamily="monospace" textAnchor="start"
            dominantBaseline="middle"
          >
            {t.toFixed(t >= 100 ? 1 : 2)}
          </text>
        </g>
      ))}

      {/* 日期軸分隔線 */}
      <line x1={padL} y1={dateLineY} x2={width - padR} y2={dateLineY}
        stroke={mutedColor} strokeWidth="0.5" opacity="0.3" />

      {/* 4 個日期刻度 */}
      {tickIndices.map((idx, ti) => {
        const x    = px(idx)
        const date = data[idx]?.date ? shortDate(data[idx].date) : ''
        return (
          <g key={ti}>
            <line x1={x} y1={dateLineY} x2={x} y2={dateLineY + 3}
              stroke={mutedColor} strokeWidth="0.5" opacity="0.5" />
            <text x={x} y={dateAxisY} fontSize={12} fill={mutedColor}
              fontFamily="monospace" textAnchor="middle">
              {date}
            </text>
          </g>
        )
      })}

      {/* MA 圖例（日期軸下方） */}
      {showMA && (
        <g>
          <rect x={width - 96} y={maLegendY - 10} width={8} height={8} fill="#f59e0b" rx="1" />
          <text x={width - 85} y={maLegendY} fontSize={11} fill={mutedColor} fontFamily="monospace">MA20</text>
          <rect x={width - 46} y={maLegendY - 10} width={8} height={8} fill="#3b82f6" rx="1" />
          <text x={width - 35} y={maLegendY} fontSize={11} fill={mutedColor} fontFamily="monospace">MA60</text>
        </g>
      )}
    </svg>
  )
}