// ============================================================
//  個股列表 Filters 套用邏輯
//  - 範圍 slider 在「預設範圍」時視為未啟用，跳過該欄位
//  - revenueYoY 的 null 在 slider = 預設時保留、調整時排除
//  - 產業別 OR 邏輯：空陣列 = 不篩；多選 = 任一符合即留
//  - 連續 YoY 成長 (B1)：勾選的指標近 N 季 YoY 全部 > 0；
//    quarters = 0 → 不篩；資料不足 N 季 → 排除
//  - 按季篩選：選定季別後，勾選的 metric 範圍要符合；找不到該季 → 排除
//  - 成交量：5 日均（千張）；缺資料時排除（同 revenueYoY 邏輯）
// ============================================================
import type { Filters, GrowthFilter, AbsValueFilter, InstitutionalFilter, MarketFilter, StockRow } from '../types'
import { DEFAULT_FILTERS } from '../types'

const eps = 1e-6

function rangeActive(value: [number, number], def: [number, number]): boolean {
  return Math.abs(value[0] - def[0]) > eps || Math.abs(value[1] - def[1]) > eps
}

function inRange(v: number, [lo, hi]: [number, number]): boolean {
  return v >= lo - eps && v <= hi + eps
}

function lastNYoy(arr: Array<{ yoy: number }> | undefined, n: number): number[] | null {
  if (!arr || arr.length < n) return null
  return arr.slice(-n).map(x => x.yoy)
}

function passGrowth(s: StockRow, g: GrowthFilter): boolean {
  if (g.quarters === 0) return true
  const f = s.fundamentals
  if (!f) return false
  const checks: Array<Array<{ yoy: number }> | undefined> = []
  if (g.metrics.eps)             checks.push(f.epsYoY)
  if (g.metrics.grossMargin)     checks.push(f.grossMarginYoY)
  if (g.metrics.operatingMargin) checks.push(f.operatingMarginYoY)
  if (checks.length === 0) return true
  for (const arr of checks) {
    const last = lastNYoy(arr, g.quarters)
    if (!last) return false
    if (!last.every(v => v > 0)) return false
  }
  return true
}

function findQuarterValue(
  arr: Array<{ quarter: string; value: number }> | undefined,
  quarter: string,
): number | null {
  if (!arr || !quarter) return null
  for (const x of arr) if (x.quarter === quarter) return x.value
  return null
}

function passMarket(s: StockRow, m: MarketFilter): boolean {
  if (m === 'all') return true
  // 沒抓到 market 欄位 → 不確定，slider 動過就排除（與 volume 同邏輯）
  if (!s.market) return false
  if (m === 'listed') return s.market === '上市'
  if (m === 'otc')    return s.market === '上櫃'
  return true
}

function passInstitutional(s: StockRow, f: InstitutionalFilter): boolean {
  if (f.days === 0) return true
  if (!f.foreign && !f.trust) return true   // 沒選任何法人 = 不篩
  if (f.foreign) {
    if ((s.foreignBuyStreak ?? 0) < f.days) return false
  }
  if (f.trust) {
    if ((s.trustBuyStreak ?? 0) < f.days) return false
  }
  return true
}

function passAbsValue(s: StockRow, a: AbsValueFilter): boolean {
  if (!a.quarter) return true
  const f = s.fundamentals
  if (!f) return false

  const gmActive = rangeActive(a.grossMargin,     DEFAULT_FILTERS.absValue.grossMargin)
  const omActive = rangeActive(a.operatingMargin, DEFAULT_FILTERS.absValue.operatingMargin)
  const epActive = rangeActive(a.eps,             DEFAULT_FILTERS.absValue.eps)

  if (!gmActive && !omActive && !epActive) return true

  if (gmActive) {
    const v = findQuarterValue(f.grossMargin, a.quarter)
    if (v == null) return false
    if (!inRange(v, a.grossMargin)) return false
  }
  if (omActive) {
    const v = findQuarterValue(f.operatingMargin, a.quarter)
    if (v == null) return false
    if (!inRange(v, a.operatingMargin)) return false
  }
  if (epActive) {
    const v = findQuarterValue(f.eps, a.quarter)
    if (v == null) return false
    if (!inRange(v, a.eps)) return false
  }
  return true
}

export function applyFilters(stocks: StockRow[], f: Filters): StockRow[] {
  const volActive = rangeActive(f.volume,     DEFAULT_FILTERS.volume)
  const mcActive  = rangeActive(f.marketCap,  DEFAULT_FILTERS.marketCap)
  const dActive   = rangeActive(f.delta,      DEFAULT_FILTERS.delta)
  const rActive   = rangeActive(f.revenueYoY, DEFAULT_FILTERS.revenueYoY)
  const indActive = f.industries.length > 0
  const indSet    = new Set(f.industries)
  const growActive = f.growth.quarters !== 0 &&
    (f.growth.metrics.eps || f.growth.metrics.grossMargin || f.growth.metrics.operatingMargin)
  const absActive = !!f.absValue.quarter && (
    rangeActive(f.absValue.grossMargin,     DEFAULT_FILTERS.absValue.grossMargin) ||
    rangeActive(f.absValue.operatingMargin, DEFAULT_FILTERS.absValue.operatingMargin) ||
    rangeActive(f.absValue.eps,             DEFAULT_FILTERS.absValue.eps)
  )
  const instActive = f.institutional.days !== 0 &&
    (f.institutional.foreign || f.institutional.trust)
  const marketActive = f.market !== 'all'

  if (!volActive && !mcActive && !dActive && !rActive && !indActive && !growActive && !absActive && !instActive && !marketActive) return stocks

  return stocks.filter(s => {
    if (volActive) {
      // volumes 欄位缺失 = 資料還沒跑 pipeline；slider 動過就排除（同 revenueYoY 邏輯）
      const v = s.volumes?.d1
      if (v == null) return false
      if (!inRange(v, f.volume)) return false
    }
    if (mcActive && !inRange(s.marketCap, f.marketCap)) return false
    if (dActive  && !inRange(s.delta,     f.delta))     return false
    if (rActive) {
      if (s.revenueYoY == null) return false
      if (!inRange(s.revenueYoY, f.revenueYoY)) return false
    }
    if (indActive) {
      const gs = (s.groups && s.groups.length > 0) ? s.groups : [s.group]
      if (!gs.some(g => indSet.has(g))) return false
    }
    if (growActive && !passGrowth(s, f.growth)) return false
    if (absActive  && !passAbsValue(s, f.absValue)) return false
    if (instActive && !passInstitutional(s, f.institutional)) return false
    if (marketActive && !passMarket(s, f.market)) return false
    return true
  })
}

/** 從 stocks 抽出最近 N 個季別字串（給按季篩選 picker 用） */
export function recentQuarters(stocks: StockRow[], maxN = 4): string[] {
  const set = new Set<string>()
  for (const s of stocks) {
    const f = s.fundamentals
    if (!f) continue
    for (const arr of [f.grossMargin, f.operatingMargin, f.eps]) {
      if (!arr) continue
      for (const x of arr) set.add(x.quarter)
    }
  }
  return [...set].sort().reverse().slice(0, maxN)
}
