// ============================================================
//  外資 / 投信 買賣超 bar chart（純 SVG，無依賴）
//  - 90 天歷史 (institutionalHistory) 渲染為紅綠 bar
//  - Y 軸自動 scale（niceCeiling）
//  - 紅 = 買超 / 綠 = 賣超（沿用台股慣例）
//  - 接 desktop / mobile 共用，靠 width/height props 調整
// ============================================================
import type { StockRow } from '../types'

interface Props {
  /** 從 stocks.json 解析的 90 天歷史（最後一筆是最新日）*/
  history?: StockRow['institutionalHistory']
  /** 哪個系列：外資 or 投信 */
  series: 'foreign' | 'trust'
  /** 標題顯示文字（預設「外資」/「投信」）*/
  label?: string
  /** 連續買 streak（從 stocks.foreignBuyStreak / trustBuyStreak 來）*/
  streak?: number
  /** SVG viewBox 寬，預設 320。實際渲染寬由父層 CSS 控制 */
  vbWidth?: number
  /** SVG viewBox 高，預設 100 */
  vbHeight?: number
}

/** 把 maxAbs 進位到「漂亮」刻度（沿用 FundamentalsPanel 同邏輯）*/
function niceCeiling(maxAbs: number): number {
  if (maxAbs <= 0) return 1
  if (maxAbs <= 1) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(maxAbs)))
  const n = maxAbs / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * pow
}

/** 千分位 + K/M 縮寫格式化（張數）*/
function fmtZhang(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 10000) return `${(v / 10000).toFixed(1)}萬`
  if (abs >= 1000)  return `${(v / 1000).toFixed(1)}k`
  return Math.round(v).toString()
}

/** Y 軸刻度 label（簡短表示）*/
function fmtYLabel(v: number): string {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1000) return `${v >= 0 ? '+' : '−'}${(abs / 1000).toFixed(0)}k`
  return `${v >= 0 ? '+' : '−'}${abs}`
}

/** "2026-05-08" → "05/08" */
function fmtMD(date: string): string {
  if (date.length < 10) return date
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`
}

export function InstitutionalChart({
  history,
  series,
  label,
  streak,
  vbWidth = 320,
  vbHeight = 100,
}: Props) {
  const defaultLabel = series === 'foreign' ? '外資' : '投信'
  const title = label ?? defaultLabel

  // 過濾出有效資料（series 對應欄位非 null）
  const data = (history ?? []).map(d => ({
    date: d.date,
    val:  series === 'foreign' ? d.foreign : d.trust,
  }))

  if (data.length === 0) {
    return (
      <div className="text-[12px] py-4 px-2" style={{ color: 'var(--color-text-muted)' }}>
        <span className="font-medium" style={{ color: 'var(--color-text-secondary)' }}>{title}</span>
        ：尚無資料
      </div>
    )
  }

  // 計算 Y 軸 ceiling（取絕對值最大）
  const maxAbs = Math.max(...data.map(d => Math.abs(d.val)), 1)
  const ceiling = niceCeiling(maxAbs)

  // 計算 30/90 日累積（顯示在 header）
  const cumulative = data.reduce((s, d) => s + d.val, 0)

  // 顏色語義：紅 = 買 / 綠 = 賣
  const cumColor = cumulative >= 0 ? 'var(--color-up)' : 'var(--color-down)'

  // SVG layout
  const padLeft   = 36   // Y 軸 label 留空間
  const padRight  = 8
  const padTop    = 6
  const padBottom = 18   // X 軸 label 留空間

  const chartW = vbWidth  - padLeft - padRight
  const chartH = vbHeight - padTop  - padBottom
  const yMid   = padTop + chartH / 2

  // Bar 寬度：均分 chartW，留 1px gap
  const n = data.length
  const slotW   = chartW / n
  const barW    = Math.max(1, Math.min(slotW - 0.5, 6))
  const barOffX = (slotW - barW) / 2

  const yScale = (v: number) => yMid - (v / ceiling) * (chartH / 2)

  // X 軸 label：等距 5 個（首、1/4、1/2、3/4、尾），資料少於 5 筆時動態減少
  const xLabelIdxs = (() => {
    if (n <= 1) return [0]
    if (n === 2) return [0, 1]
    if (n === 3) return [0, 1, 2]
    if (n === 4) return [0, 1, 2, 3]
    if (n < 9)   return [0, Math.floor(n / 2), n - 1]
    // 5 個 evenly-spaced
    const last = n - 1
    return [
      0,
      Math.round(last * 0.25),
      Math.round(last * 0.5),
      Math.round(last * 0.75),
      last,
    ]
  })()
  const xLabels = xLabelIdxs.map(i => ({
    x: padLeft + slotW * i + barOffX + barW / 2,
    text: fmtMD(data[i].date),
  }))

  const streakText = streak && streak > 0 ? `連 ${streak} 日買` : null

  return (
    <div className="w-full">
      {/* Header */}
      <div
        className="flex items-baseline gap-2 flex-wrap mb-1.5"
        style={{ fontSize: 13 }}
      >
        <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{title}</span>
        {streakText && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{
              background: 'var(--color-bg-500)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {streakText}
          </span>
        )}
        <span className="text-[11px] font-mono tabular ml-auto" style={{ color: 'var(--color-text-muted)' }}>
          {data.length} 日累積{' '}
          <span style={{ color: cumColor, fontWeight: 500 }}>
            {cumulative >= 0 ? '+' : ''}{fmtZhang(cumulative)} 張
          </span>
        </span>
      </div>

      {/* SVG bar chart */}
      <svg viewBox={`0 0 ${vbWidth} ${vbHeight}`}
           className="w-full h-auto block"
           preserveAspectRatio="none"
           style={{ maxHeight: 200 }}>
        {/* Y 軸刻度（+ceiling, 0, -ceiling）*/}
        {[ceiling, 0, -ceiling].map((v, i) => {
          const y = yScale(v)
          const isZero = v === 0
          return (
            <g key={i}>
              <line x1={padLeft} y1={y} x2={padLeft + chartW} y2={y}
                    stroke="var(--color-border)"
                    strokeWidth={isZero ? 1 : 0.6}
                    opacity={isZero ? 1 : 0.5}
                    strokeDasharray={isZero ? '' : '2,3'} />
              <text x={padLeft - 4} y={y + 3} fontSize={9}
                    fill="var(--color-text-muted)" textAnchor="end">
                {fmtYLabel(v)}
              </text>
            </g>
          )
        })}

        {/* Y 軸左線 */}
        <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + chartH}
              stroke="var(--color-border)" strokeWidth={1} />

        {/* Bars */}
        {data.map((d, i) => {
          if (d.val === 0) return null
          const x = padLeft + slotW * i + barOffX
          const yV = yScale(d.val)
          const y = Math.min(yV, yMid)
          const h = Math.abs(yV - yMid)
          const fill = d.val >= 0 ? 'var(--color-up)' : 'var(--color-down)'
          return <rect key={i} x={x} y={y} width={barW} height={h} fill={fill} />
        })}

        {/* X 軸 labels */}
        {xLabels.map((l, i) => (
          <text key={i} x={l.x} y={padTop + chartH + 12} fontSize={9}
                fill="var(--color-text-muted)" textAnchor="middle">
            {l.text}
          </text>
        ))}
      </svg>
    </div>
  )
}
