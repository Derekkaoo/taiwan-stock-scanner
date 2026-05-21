/**
 * 把 filters JSON 翻譯成「人話」中文描述，給 admin Telegram 通知用
 * 只列出非預設值的條件，預設值的條件直接 skip
 */

type FilterRange = [number, number]

interface Filters {
  volume?: FilterRange
  marketCap?: FilterRange
  delta?: FilterRange
  revenueYoY?: FilterRange
  industries?: string[]
  growth?: {
    quarters?: number
    metrics?: { eps?: boolean; grossMargin?: boolean; operatingMargin?: boolean }
  }
  absValue?: {
    quarter?: string
    grossMargin?: FilterRange
    operatingMargin?: FilterRange
    eps?: FilterRange
  }
  institutional?: { days?: number; foreign?: boolean; trust?: boolean }
  market?: 'all' | 'listed' | 'otc'
  nDayReturn?: { days?: number; range?: FilterRange }
  nDayHigh?: { days?: number }
  volumeNewHigh?: { days?: number }
  volumeSurge?: { baseline?: string; multiplier?: number }
  maAlignment?: { periods?: number[] }
  maDirection?: { periods?: number[] }
  maBreakout?: { days?: number; period?: number }
  maContinuation?: { direction?: string; period?: number }
  maSustained?: { days?: number; period?: number }
  downtrendBreak?: { days?: number; pivots?: number }
  pullbackMa?: { period?: number }
  [k: string]: unknown
}

const BOUNDS = {
  volume: [0, 500000],
  marketCap: [0, 5000],
  delta: [0.1, 5],
  revenueYoY: [-50, 200],
  grossMargin: [-50, 100],
  operatingMargin: [-100, 100],
  eps: [-10, 100],
  nDayReturn: [-10, 50],
}

function rangeIsDefault(r: FilterRange | undefined, def: number[]): boolean {
  if (!r) return true
  return r[0] === def[0] && r[1] === def[1]
}

function fmtRange(r: FilterRange, unit = '', useMin = true, useMax = true): string {
  const [lo, hi] = r
  if (useMin && useMax) return `${lo}-${hi}${unit}`
  if (useMin) return `≥${lo}${unit}`
  return `≤${hi}${unit}`
}

export function formatFilters(filtersJson: string): string {
  let f: Filters
  try {
    f = JSON.parse(filtersJson) as Filters
  } catch {
    return '(無法解析 filters)'
  }

  const lines: string[] = []

  // 基本範圍
  if (!rangeIsDefault(f.volume, BOUNDS.volume)) {
    lines.push(`• 成交量 ${fmtRange(f.volume!, ' 張')}`)
  }
  if (!rangeIsDefault(f.marketCap, BOUNDS.marketCap)) {
    lines.push(`• 市值 ${fmtRange(f.marketCap!, ' 億')}`)
  }
  if (!rangeIsDefault(f.delta, BOUNDS.delta)) {
    lines.push(`• 週增持 ${fmtRange(f.delta!, '%')}`)
  }
  if (!rangeIsDefault(f.revenueYoY, BOUNDS.revenueYoY)) {
    lines.push(`• 月營收 YoY ${fmtRange(f.revenueYoY!, '%')}`)
  }

  // 產業
  if (f.industries && f.industries.length > 0) {
    lines.push(`• 產業: ${f.industries.join('、')}`)
  }

  // 連續 N 季 YoY 成長
  if (f.growth && f.growth.quarters && f.growth.quarters > 0) {
    const metrics: string[] = []
    if (f.growth.metrics?.eps) metrics.push('EPS')
    if (f.growth.metrics?.grossMargin) metrics.push('毛利')
    if (f.growth.metrics?.operatingMargin) metrics.push('營利')
    if (metrics.length > 0) {
      lines.push(`• 連續 ${f.growth.quarters} 季 ${metrics.join('+')} YoY 成長`)
    }
  }

  // 按季絕對值
  if (f.absValue?.quarter) {
    const parts: string[] = []
    if (!rangeIsDefault(f.absValue.grossMargin, BOUNDS.grossMargin)) {
      parts.push(`毛利 ${fmtRange(f.absValue.grossMargin!, '%')}`)
    }
    if (!rangeIsDefault(f.absValue.operatingMargin, BOUNDS.operatingMargin)) {
      parts.push(`營利 ${fmtRange(f.absValue.operatingMargin!, '%')}`)
    }
    if (!rangeIsDefault(f.absValue.eps, BOUNDS.eps)) {
      parts.push(`EPS ${fmtRange(f.absValue.eps!, ' 元')}`)
    }
    if (parts.length > 0) {
      lines.push(`• ${f.absValue.quarter} 季: ${parts.join(' / ')}`)
    }
  }

  // 三大法人
  if (f.institutional && f.institutional.days && f.institutional.days > 0) {
    const who: string[] = []
    if (f.institutional.foreign) who.push('外資')
    if (f.institutional.trust) who.push('投信')
    if (who.length > 0) {
      lines.push(`• ${who.join('+')} 連續 ${f.institutional.days} 日買超`)
    }
  }

  // 市場別
  if (f.market === 'listed') lines.push('• 只看上市')
  if (f.market === 'otc') lines.push('• 只看上櫃')

  // N 日漲幅
  if (f.nDayReturn?.days && f.nDayReturn.days > 0) {
    const r = f.nDayReturn.range
    if (r && !rangeIsDefault(r, BOUNDS.nDayReturn)) {
      lines.push(`• 近 ${f.nDayReturn.days} 日漲幅 ${fmtRange(r, '%')}`)
    } else {
      lines.push(`• 近 ${f.nDayReturn.days} 日漲幅`)
    }
  }

  // N 日內創新高
  if (f.nDayHigh?.days && f.nDayHigh.days > 0) {
    lines.push(`• ${f.nDayHigh.days} 日內收盤創新高`)
  }
  if (f.volumeNewHigh?.days && f.volumeNewHigh.days > 0) {
    lines.push(`• ${f.volumeNewHigh.days} 日內成交量創新高`)
  }
  if (f.volumeSurge?.multiplier && f.volumeSurge.multiplier > 0) {
    lines.push(`• 成交量爆量 ${f.volumeSurge.multiplier} 倍`)
  }

  // 均線相關
  if (f.maAlignment?.periods && f.maAlignment.periods.length >= 2) {
    lines.push(`• 均線多頭排列 (MA${f.maAlignment.periods.join(' / MA')})`)
  }
  if (f.maDirection?.periods && f.maDirection.periods.length >= 1) {
    lines.push(`• MA${f.maDirection.periods.join(' / MA')} 向上`)
  }
  if (f.maBreakout?.days && f.maBreakout.period) {
    lines.push(`• ${f.maBreakout.days} 日內突破 MA${f.maBreakout.period}`)
  }
  if (f.maContinuation?.direction && f.maContinuation.direction !== 'off' && f.maContinuation.period) {
    const dir = f.maContinuation.direction === 'up' ? '向上' : '向下'
    lines.push(`• MA${f.maContinuation.period} 連續${dir}`)
  }
  if (f.maSustained?.days && f.maSustained.period) {
    lines.push(`• ${f.maSustained.days} 日內收盤站上 MA${f.maSustained.period}`)
  }
  if (f.downtrendBreak?.days && f.downtrendBreak.days > 0) {
    lines.push(`• ${f.downtrendBreak.days} 日內突破下降趨勢線`)
  }
  if (f.pullbackMa?.period && f.pullbackMa.period > 0) {
    lines.push(`• 回測 MA${f.pullbackMa.period}`)
  }

  if (lines.length === 0) {
    return '(全部用預設值，無篩選條件)'
  }
  return lines.join('\n')
}
