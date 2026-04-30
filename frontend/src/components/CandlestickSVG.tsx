import { useMemo, useState, useRef, useEffect } from 'react'
import type { KlineBar } from '../types'
import { aggregateForTimeframe, type Timeframe } from '../utils/klineAggregate'

// 各 MA 的固定顏色（避開漲跌色）
export const MA_COLORS: Record<number, string> = {
  5:   '#ec4899',  // pink
  10:  '#06b6d4',  // cyan
  20:  '#f59e0b',  // orange
  60:  '#3b82f6',  // blue
  120: '#a855f7',  // purple
}

export const ALL_MA_PERIODS = [5, 10, 20, 60, 120] as const
export const DEFAULT_MA_PERIODS: number[] = [20, 60]

// 各 timeframe 的預設顯示根數
const DEFAULT_VISIBLE: Record<Timeframe, number> = { D: 90, W: 60, M: 36 }
const MIN_VISIBLE = 10

interface Props {
  /** 完整日 K 線（時間升序）。會依 timeframe 內部聚合 + 切到顯示範圍。 */
  bars?: KlineBar[]
  /** （舊 API，向後相容）顯示用 K 線陣列 */
  data?: KlineBar[]
  /** （舊 API，向後相容）完整 K 線給 MA 算 */
  fullData?: KlineBar[]
  /** 時間框架：D=日 / W=週 / M=月（預設 D）。給 bars 時才有效。 */
  timeframe?: Timeframe
  /** tab 切換 callback，提供時左下角會渲染 [日][週][月] tab */
  onTimeframeChange?: (t: Timeframe) => void
  width?: number
  height?: number
  showVolume?: boolean
  showMA?: boolean
  maPeriods?: number[]   // 要顯示哪幾條 MA（預設 [20, 60]）
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

/** 帶年份的日期（用 YY/MM/DD 縮寫年份）*/
function dateWithYear(dateStr: string): string {
  const parts = dateStr.replace(/-/g, '/').split('/')
  if (parts.length >= 3) return `${parts[0].slice(2)}/${parts[1]}/${parts[2]}`
  return dateStr
}

/** 從 date 字串取年份（YYYY）*/
function getYear(dateStr: string | undefined): string {
  if (!dateStr) return ''
  return dateStr.replace(/-/g, '/').split('/')[0]
}

function touchDist(t1: Touch, t2: Touch): number {
  const dx = t1.clientX - t2.clientX
  const dy = t1.clientY - t2.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

export function CandlestickSVG({
  bars, data, fullData,
  timeframe = 'D', onTimeframeChange,
  width = 400, height = 200,
  showVolume = true, showMA = true,
  maPeriods = DEFAULT_MA_PERIODS,
  className,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  // 聚合（依 timeframe）→ sourceData = 完整聚合後 K 線（給 MA 算 + 平移底）
  const sourceData = useMemo(() => {
    if (bars && bars.length > 0) {
      const { full } = aggregateForTimeframe(bars, timeframe)
      return full
    }
    return fullData ?? data ?? []
  }, [bars, timeframe, data, fullData])

  // 縮放 + 平移 state
  // zoomCount: 顯示根數（null = 用 timeframe 預設值）
  // panOffset: 從最新往前偏移的根數（0 = 看到最新；正值 = 往歷史滾）
  const [zoomCount, setZoomCount] = useState<number | null>(null)
  const [panOffset, setPanOffset] = useState(0)

  // bars 或 timeframe 改變 → 重置（避免狀態污染）
  useEffect(() => {
    setZoomCount(null)
    setPanOffset(0)
  }, [bars, timeframe])

  // 計算實際顯示範圍
  const totalBars = sourceData.length
  const defaultCount = DEFAULT_VISIBLE[timeframe] ?? 90
  const effectiveCount = Math.min(
    Math.max(MIN_VISIBLE, zoomCount ?? defaultCount),
    Math.max(MIN_VISIBLE, totalBars)
  )
  const maxOffset = Math.max(0, totalBars - effectiveCount)
  const clampedOffset = Math.min(Math.max(0, panOffset), maxOffset)
  const endIdx = totalBars - clampedOffset
  const startIdx = Math.max(0, endIdx - effectiveCount)
  const displayData = sourceData.slice(startIdx, endIdx)

  // 手勢狀態（不需 re-render，只在事件中暫存初始值）
  const gestureRef = useRef<{
    mode?: 'pinch' | 'pan'
    initialDist?: number
    initialZoomCount?: number
    initialX?: number
    initialPanOffset?: number
  }>({})
  const [isMouseDown, setIsMouseDown] = useState(false)

  // ─── 桌面滾輪 + 手機 touchmove（passive: false 才能 preventDefault）───
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // 滾輪向下（deltaY > 0）→ 拉遠（看更多根）；向上 → 拉近
      const ratio = e.deltaY > 0 ? 1.15 : 1 / 1.15
      const baseCount = zoomCount ?? defaultCount
      const newCount = Math.round(baseCount * ratio)
      setZoomCount(Math.max(MIN_VISIBLE, Math.min(totalBars, newCount)))
    }

    const onTouchMove = (e: TouchEvent) => {
      const g = gestureRef.current
      if (g.mode === 'pinch' && e.touches.length === 2) {
        e.preventDefault()
        const newDist = touchDist(e.touches[0], e.touches[1])
        const initial = g.initialDist ?? newDist
        // 兩指張開（newDist > initial）→ ratio < 1 → zoomCount 減少 → 拉近 ✓
        // 兩指捏合（newDist < initial）→ ratio > 1 → zoomCount 增加 → 拉遠 ✓
        const ratio = initial / newDist
        const newCount = Math.round((g.initialZoomCount ?? effectiveCount) * ratio)
        setZoomCount(Math.max(MIN_VISIBLE, Math.min(totalBars, newCount)))
      } else if (g.mode === 'pan' && e.touches.length === 1) {
        e.preventDefault()
        const delta = e.touches[0].clientX - (g.initialX ?? 0)
        const barWidth = (width - 18 - 54) / effectiveCount
        const deltaBar = Math.round(delta / barWidth)
        // 向右拖（delta 正）→ 看更早的歷史 → panOffset 增加
        const newOffset = (g.initialPanOffset ?? 0) + deltaBar
        setPanOffset(Math.max(0, Math.min(maxOffset, newOffset)))
      }
    }

    svg.addEventListener('wheel', onWheel, { passive: false })
    svg.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      svg.removeEventListener('wheel', onWheel)
      svg.removeEventListener('touchmove', onTouchMove)
    }
  }, [effectiveCount, totalBars, maxOffset, width, zoomCount, defaultCount])

  // ─── 觸控開始/結束（記初始值；移動由上面 onTouchMove 處理）───
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      gestureRef.current = {
        mode: 'pinch',
        initialDist: touchDist(e.touches[0] as unknown as Touch, e.touches[1] as unknown as Touch),
        initialZoomCount: effectiveCount,
      }
    } else if (e.touches.length === 1) {
      gestureRef.current = {
        mode: 'pan',
        initialX: e.touches[0].clientX,
        initialPanOffset: clampedOffset,
      }
    }
  }
  const onTouchEnd = () => {
    gestureRef.current = {}
  }

  // ─── 桌面滑鼠拖動 (pan) ───
  const onMouseDown = (e: React.MouseEvent) => {
    const target = e.target as Element
    if (target.closest('[data-no-pan]')) return  // 點到 tab 不要 pan
    setIsMouseDown(true)
    gestureRef.current = {
      mode: 'pan',
      initialX: e.clientX,
      initialPanOffset: clampedOffset,
    }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!isMouseDown) return
    const g = gestureRef.current
    if (g.mode !== 'pan') return
    const delta = e.clientX - (g.initialX ?? 0)
    const barWidth = (width - 18 - 54) / effectiveCount
    const deltaBar = Math.round(delta / barWidth)
    const newOffset = (g.initialPanOffset ?? 0) + deltaBar
    setPanOffset(Math.max(0, Math.min(maxOffset, newOffset)))
  }
  const onMouseUp = () => {
    setIsMouseDown(false)
    gestureRef.current = {}
  }

  const onDoubleClick = () => {
    setZoomCount(null)
    setPanOffset(0)
  }

  if (!displayData || displayData.length === 0) return null

  const dateAxisH = 20
  const maLegendH = showMA ? 20 : 0
  const volHeight = showVolume ? Math.floor(height * 0.2) : 0
  const chartH    = height - volHeight - dateAxisH - maLegendH - 4
  const padL = 18, padR = 54, padT = 8, padB = 8

  const highs   = displayData.map(d => d.h)
  const lows    = displayData.map(d => d.l)
  const volumes = displayData.map(d => d.v)

  // MA 用完整聚合資料計算 → 切到當前顯示範圍
  const sourceCloses = sourceData.map(d => d.c)
  const sortedPeriods = [...maPeriods].sort((a, b) => a - b)
  const maData = sortedPeriods.map(period => ({
    period,
    color:  MA_COLORS[period] ?? '#888',
    values: calcMA(sourceCloses, period).slice(startIdx, endIdx),
  }))

  const rawMin = Math.min(...lows)
  const rawMax = Math.max(...highs)
  const rawRange = rawMax - rawMin || 1
  const pricePad = rawRange * 0.05
  const minP = rawMin - pricePad
  const maxP = rawMax + pricePad
  const rangeP = maxP - minP

  const maxV   = Math.max(...volumes) || 1

  const n       = displayData.length
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
      ref={svgRef}
      width={width} height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={{
        display: 'block', width: '100%', height: 'auto',
        cursor: isMouseDown ? 'grabbing' : 'grab',
        touchAction: 'none',  // 阻擋瀏覽器預設 touch 行為（給我們自訂 pan/pinch）
        userSelect: 'none',
      }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onDoubleClick={onDoubleClick}
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
      {showVolume && displayData.map((d, i) => {
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
      {displayData.map((d, i) => {
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

      {/* MA 線（依 period 由短到長，短的後畫蓋在上面）*/}
      {showMA && maData.map(({ period, color, values }) => (
        <g key={period}>{maPath(values, color)}</g>
      ))}

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

      {/* 4 個日期刻度
         跨年範圍：「跟前一個 tick 年份不同」的 tick 帶年份（不含 leftmost，避免邊界裁切）
         單一年範圍：所有 tick 只顯示 MM/DD */}
      {tickIndices.map((idx, ti) => {
        const x = px(idx)
        const dateStr = displayData[idx]?.date
        if (!dateStr) return null
        // leftmost (ti=0) 永遠不帶年份；其他 tick 跟前一個比，年份不同就帶
        let showYear = false
        if (ti > 0) {
          const prevYear = getYear(displayData[tickIndices[ti - 1]]?.date)
          const thisYear = getYear(dateStr)
          if (prevYear && thisYear && prevYear !== thisYear) showYear = true
        }
        const label = showYear ? dateWithYear(dateStr) : shortDate(dateStr)
        return (
          <g key={ti}>
            <line x1={x} y1={dateLineY} x2={x} y2={dateLineY + 3}
              stroke={mutedColor} strokeWidth="0.5" opacity="0.5" />
            <text x={x} y={dateAxisY} fontSize={12} fill={mutedColor}
              fontFamily="monospace" textAnchor="middle">
              {label}
            </text>
          </g>
        )
      })}

      {/* 左下角：時間框架 tab（[日][週][月]） — data-no-pan 阻止點到時觸發 pan */}
      {onTimeframeChange && (
        <g data-no-pan="true">
          {(['D', 'W', 'M'] as const).map((t, i) => {
            const x = padL + i * 28
            const active = timeframe === t
            const label = t === 'D' ? '日' : t === 'W' ? '週' : '月'
            return (
              <g key={t}
                onClick={(e) => { e.stopPropagation(); onTimeframeChange(t) }}
                onMouseDown={(e) => e.stopPropagation()}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={x} y={maLegendY - 12} width={24} height={14} rx={7}
                  fill={active ? 'var(--color-accent-cyan, #06b6d4)' : 'var(--color-bg-600, #374151)'}
                  stroke={active ? 'var(--color-accent-cyan, #06b6d4)' : 'var(--color-border, #4b5563)'}
                  strokeWidth={0.8}
                />
                <text
                  x={x + 12} y={maLegendY - 1} fontSize={11}
                  fill={active ? '#fff' : 'var(--color-text-secondary, #d1d5db)'}
                  textAnchor="middle"
                  fontWeight={active ? 700 : 400}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}
                >
                  {label}
                </text>
              </g>
            )
          })}
        </g>
      )}

      {/* MA 圖例（日期軸下方，依條數動態排列，從右側往左）*/}
      {showMA && maData.length > 0 && (() => {
        const itemW = 50  // 每個 MA 標籤寬度
        const totalW = maData.length * itemW
        const startX = width - totalW - 4
        return (
          <g>
            {maData.map(({ period, color }, i) => {
              const x = startX + i * itemW
              return (
                <g key={period}>
                  <rect x={x} y={maLegendY - 10} width={8} height={8} fill={color} rx="1" />
                  <text x={x + 11} y={maLegendY} fontSize={11} fill={mutedColor} fontFamily="monospace">
                    MA{period}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })()}
    </svg>
  )
}
