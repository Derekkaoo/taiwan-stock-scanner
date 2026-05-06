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
import type {
  Filters, GrowthFilter, AbsValueFilter, InstitutionalFilter, MarketFilter,
  NDayReturnFilter, NDayHighFilter,
  VolumeNewHighFilter, VolumeSurgeFilter, MaAlignmentFilter, MaDirectionFilter,
  MaBreakoutFilter, MaContinuationFilter, MaSustainedFilter, DowntrendBreakFilter,
  StockRow, KlineBar,
} from '../types'
import { DEFAULT_FILTERS, FILTER_BOUNDS } from '../types'

/** 提供給 applyFilters 的 K 線資料來源；id → 升序 K 棒陣列（最新在最後） */
export type KlinesById = Record<string, KlineBar[] | undefined> | Map<string, KlineBar[]>

function getBars(klines: KlinesById | undefined, id: string): KlineBar[] | undefined {
  if (!klines) return undefined
  if (klines instanceof Map) return klines.get(id)
  return klines[id]
}

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

/** 計算「最近 N 日漲跌幅 %」— 用最新一根 close 對 N 根前 close 比。
 *  N=1 表「跟昨天比」；資料不足或 prev/last 無效 → null。 */
function calcNDayReturn(bars: KlineBar[] | undefined, n: number): number | null {
  if (!bars || bars.length < n + 1) return null
  const last = bars[bars.length - 1]?.c
  const prev = bars[bars.length - 1 - n]?.c
  if (!last || !prev) return null
  return ((last - prev) / prev) * 100
}

function passNDayReturn(s: StockRow, f: NDayReturnFilter, klines: KlinesById | undefined): boolean {
  if (f.days === 0) return true
  const r = calcNDayReturn(getBars(klines, s.id), f.days)
  if (r == null) return false
  // 預設範圍 → 只篩「有資料」、不限定範圍
  if (!rangeActive(f.range, [FILTER_BOUNDS.nDayReturn.min, FILTER_BOUNDS.nDayReturn.max])) return true
  return inRange(r, f.range)
}

function passNDayHigh(s: StockRow, f: NDayHighFilter, klines: KlinesById | undefined): boolean {
  if (f.days === 0) return true
  const bars = getBars(klines, s.id)
  if (!bars || bars.length < f.days) return false
  const last = bars[bars.length - 1]
  if (!last || !last.h) return false
  // 看「最近 N 根（含今天）的 high」最大值是否 == 今日 high
  const window = bars.slice(-f.days)
  let maxH = -Infinity
  for (const b of window) if (b.h && b.h > maxH) maxH = b.h
  // 浮點誤差小容差
  return last.h >= maxH - 1e-6
}

function passVolumeNewHigh(s: StockRow, f: VolumeNewHighFilter, klines: KlinesById | undefined): boolean {
  if (f.days === 0) return true
  const bars = getBars(klines, s.id)
  if (!bars || bars.length < f.days) return false
  const last = bars[bars.length - 1]
  if (!last || !last.v) return false
  // 「最近 N 根（含今天）的 volume」最大值是否 == 今日 volume
  const window = bars.slice(-f.days)
  let maxV = -Infinity
  for (const b of window) if (b.v && b.v > maxV) maxV = b.v
  return last.v >= maxV - 1e-6
}

/** 算最後一根 bar 的 N 日 MA（簡單均線，等權重）*/
function calcLastMA(bars: KlineBar[], period: number): number | null {
  if (!bars || bars.length < period) return null
  let sum = 0
  for (let i = bars.length - period; i < bars.length; i++) {
    const c = bars[i]?.c
    if (!c) return null
    sum += c
  }
  return sum / period
}

function passMaAlignment(s: StockRow, f: MaAlignmentFilter, klines: KlinesById | undefined): boolean {
  const periods = f.periods || []
  if (periods.length < 2) return true
  const bars = getBars(klines, s.id)
  if (!bars) return false
  // 短期 MA > 長期 MA：依期數遞增遍歷，要求 MA 值嚴格遞減
  const sorted = [...periods].sort((a, b) => a - b)
  let prevValue = Infinity
  for (const p of sorted) {
    const v = calcLastMA(bars, p)
    if (v == null) return false
    if (v >= prevValue) return false
    prevValue = v
  }
  return true
}

function passMaDirection(s: StockRow, f: MaDirectionFilter, klines: KlinesById | undefined): boolean {
  const periods = f.periods || []
  if (periods.length === 0) return true
  const bars = getBars(klines, s.id)
  if (!bars || bars.length < 2) return false
  // 每條選中的 MA 都要求「今日 MA > 昨日 MA」（AND）
  for (const p of periods) {
    const today     = calcLastMA(bars, p)
    const yesterday = calcLastMA(bars.slice(0, -1), p)  // 拿掉最新一根當「昨日」
    if (today == null || yesterday == null) return false
    if (today <= yesterday) return false
  }
  return true
}

/** N 日內任一根 K 棒出現 close 由下往上突破 MA。
 *  突破事件定義：bar[i].c > MA(i) AND bar[i-1].c ≤ MA(i-1)
 *  其中 MA(i) = bars[..i] 末尾 period 根的 close 平均（含 bar[i] 自己）。
 *  搜尋窗口：最後 days 根 K 棒（含今天）。 */
function passMaBreakout(s: StockRow, f: MaBreakoutFilter, klines: KlinesById | undefined): boolean {
  if (f.days === 0 || f.period === 0) return true
  const bars = getBars(klines, s.id)
  // 至少要有 period+1 根才算得出「前一日 MA」
  if (!bars || bars.length < f.period + 1) return false

  // 算每一根 bar 的 MA(i)（含 bar[i]）
  const period = f.period
  const ma: Array<number | null> = new Array(bars.length).fill(null)
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    const c = bars[i]?.c
    if (!c) {
      // close 缺值：當前 window 重置（保守做法）
      sum = 0
      // 重新累加最近 period 根需要 valid close，這裡簡化：直接讓後續 i 重算
      // 因為 user 資料 close 通常不會缺，這個 case 可忽略
      continue
    }
    sum += c
    if (i >= period) {
      const old = bars[i - period]?.c
      if (old) sum -= old
    }
    if (i >= period - 1) ma[i] = sum / period
  }

  // 在最後 days 根（含今天）找突破事件；需要 i 跟 i-1 都有 MA
  const startIdx = Math.max(period, bars.length - f.days)  // 至少從 period 開始才有 MA(i-1)
  for (let i = startIdx; i < bars.length; i++) {
    const cToday = bars[i]?.c
    const cYest  = bars[i - 1]?.c
    const maToday = ma[i]
    const maYest  = ma[i - 1]
    if (!cToday || !cYest || maToday == null || maYest == null) continue
    if (cToday > maToday && cYest <= maYest) return true
  }
  return false
}

/** 明日 MA 續揚 / 下彎（扣抵值預測）：
 *  扣抵值 = 明日將從 MA 計算窗口扣掉的那根 close = bars[len - period].c
 *  - up:   today close > 扣抵值（即使明日盤平，MA 也會上揚）
 *  - down: today close < 扣抵值（即使明日盤平，MA 也會下彎） */
function passMaContinuation(s: StockRow, f: MaContinuationFilter, klines: KlinesById | undefined): boolean {
  if (f.direction === 'off' || f.period === 0) return true
  const bars = getBars(klines, s.id)
  if (!bars || bars.length < f.period) return false
  const lastClose = bars[bars.length - 1]?.c
  const dropoutClose = bars[bars.length - f.period]?.c  // N 天前 close（明日扣抵值）
  if (!lastClose || !dropoutClose) return false
  if (f.direction === 'up')   return lastClose > dropoutClose
  if (f.direction === 'down') return lastClose < dropoutClose
  return true
}

/** 未來 N 日 MA 不下彎（扣抵保護）：
 *  未來第 d 日（d=1..N）的扣抵值 = bars[len - period + d - 1].c
 *  條件：每個 d 的扣抵值都 < 今日 close
 *  → 即使股價盤整不漲，MA 仍會連續上揚 N 天 */
function passMaSustained(s: StockRow, f: MaSustainedFilter, klines: KlinesById | undefined): boolean {
  if (f.days === 0 || f.period === 0) return true
  const bars = getBars(klines, s.id)
  if (!bars || bars.length < f.period) return false
  const lastClose = bars[bars.length - 1]?.c
  if (!lastClose) return false
  for (let d = 1; d <= f.days; d++) {
    const idx = bars.length - f.period + d - 1
    const dropoutClose = bars[idx]?.c
    if (!dropoutClose) return false
    if (lastClose <= dropoutClose) return false
  }
  return true
}

/** 抓轉折 — XQ 量價合成 + N 日 high 突破法（v4，2026-05-06 換邏輯）
 *
 *  邏輯（仿 XQ 量價合成腳本）：
 *  1. 累積量價：kk[i] = kk[i-1] + (close[i] - close[i-1]) / close[i-1] × volume[i]
 *  2. 長期斜率 value1 = linregslope(kk, Length)；短期斜率 value2 = linregslope(kk, 5)
 *  3. 條件 A: value1 < 0（長期量價下降）AND value2 > 0（短期量價反彈）
 *  4. 條件 B: 今日 close > 過去 HighN 日 high 最大值（不含今天） — 突破壓力位
 *  5. 條件 C: 今日漲幅 ≥ 2%（強勢紅 K）
 *
 *  chip 對應：
 *  - 觀察期間 (30/60/120) → Length = min(days, 60)
 *  - 高點數量 (3/4/5)     → HighN 5 / 10 / 15
 */
const SHORT_SLOPE_BARS = 5
const MIN_DAILY_RETURN = 0.02   // 今日漲幅 ≥ 2%

function pivotsToHighN(pivots: number): number {
  if (pivots <= 3) return 5
  if (pivots === 4) return 10
  return 15
}

function linregSlope(values: number[]): number | null {
  const n = values.length
  if (n < 2) return null
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0
  for (let i = 0; i < n; i++) {
    sumX  += i
    sumY  += values[i]
    sumXY += i * values[i]
    sumX2 += i * i
  }
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return null
  return (n * sumXY - sumX * sumY) / denom
}

function passDowntrendBreak(s: StockRow, f: DowntrendBreakFilter, klines: KlinesById | undefined): boolean {
  if (f.days === 0) return true
  const bars = getBars(klines, s.id)
  const Length = Math.min(f.days, 60)
  const HighN  = pivotsToHighN(f.pivots)
  const required = Math.max(Length, HighN) + 2
  if (!bars || bars.length < required) return false

  // 1. 累積量價 kk
  const kk: number[] = new Array(bars.length).fill(0)
  for (let i = 1; i < bars.length; i++) {
    const prevC = bars[i - 1]?.c
    const curC  = bars[i]?.c
    const v     = bars[i]?.v ?? 0
    if (!prevC || !curC) {
      kk[i] = kk[i - 1]
      continue
    }
    const ret = (curC - prevC) / prevC
    kk[i] = kk[i - 1] + ret * v
  }

  // 2. 長/短斜率
  const value1 = linregSlope(kk.slice(-Length))
  const value2 = linregSlope(kk.slice(-SHORT_SLOPE_BARS))
  if (value1 == null || value2 == null) return false

  // 3. 條件 A: 長期下降 + 短期反彈
  if (!(value1 < 0 && value2 > 0)) return false

  // 4. 條件 B: 今日 close > 過去 HighN 日 high 最大值（不含今天）
  const todayIdx = bars.length - 1
  const todayClose = bars[todayIdx]?.c
  if (!todayClose) return false
  let HH = -Infinity
  for (let i = todayIdx - HighN; i < todayIdx; i++) {
    if (i < 0) continue
    const h = bars[i]?.h
    if (h != null && h > HH) HH = h
  }
  if (HH === -Infinity) return false
  if (todayClose <= HH) return false

  // 5. 條件 C: 今日漲幅 ≥ 2%
  const yestClose = bars[todayIdx - 1]?.c
  if (!yestClose) return false
  if ((todayClose - yestClose) / yestClose < MIN_DAILY_RETURN) return false

  return true
}

function passVolumeSurge(s: StockRow, f: VolumeSurgeFilter, klines: KlinesById | undefined): boolean {
  if (f.multiplier === 0) return true
  const bars = getBars(klines, s.id)
  if (!bars || bars.length < 2) return false
  const last = bars[bars.length - 1]
  if (!last || !last.v) return false

  // baseline 永遠用「最新一根之前」的資料 — 盤中盤後語意一致
  let baseline: number | null = null
  if (f.baseline === 'prev') {
    const prev = bars[bars.length - 2]
    baseline = prev?.v ?? null
  } else {
    const n = f.baseline === 'ma5' ? 5 : f.baseline === 'ma10' ? 10 : 60
    if (bars.length < n + 1) return false
    const window = bars.slice(-n - 1, -1)  // 不含最新一根
    let sum = 0, count = 0
    for (const b of window) {
      if (b.v && b.v > 0) {
        sum += b.v
        count++
      }
    }
    baseline = count > 0 ? sum / count : null
  }
  if (baseline == null || baseline <= 0) return false
  return last.v >= baseline * f.multiplier
}

export function applyFilters(stocks: StockRow[], f: Filters, klines?: KlinesById): StockRow[] {
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
  const nRetActive  = f.nDayReturn.days !== 0
  const nHighActive = f.nDayHigh.days   !== 0
  const vNewHighActive = f.volumeNewHigh.days !== 0
  const vSurgeActive   = f.volumeSurge.multiplier !== 0
  const maAlignActive  = (f.maAlignment?.periods?.length ?? 0) >= 2
  const maDirActive    = (f.maDirection?.periods?.length ?? 0) >= 1
  const maBreakActive  = (f.maBreakout?.days ?? 0) !== 0 && (f.maBreakout?.period ?? 0) !== 0
  const maContActive   = (f.maContinuation?.direction ?? 'off') !== 'off' && (f.maContinuation?.period ?? 0) !== 0
  const maSustActive   = (f.maSustained?.days ?? 0) !== 0 && (f.maSustained?.period ?? 0) !== 0
  const downBreakActive = (f.downtrendBreak?.days ?? 0) !== 0

  if (!volActive && !mcActive && !dActive && !rActive && !indActive && !growActive && !absActive && !instActive && !marketActive && !nRetActive && !nHighActive && !vNewHighActive && !vSurgeActive && !maAlignActive && !maDirActive && !maBreakActive && !maContActive && !maSustActive && !downBreakActive) return stocks

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
    if (nRetActive  && !passNDayReturn(s, f.nDayReturn, klines)) return false
    if (nHighActive && !passNDayHigh(s,   f.nDayHigh,   klines)) return false
    if (vNewHighActive && !passVolumeNewHigh(s, f.volumeNewHigh, klines)) return false
    if (vSurgeActive   && !passVolumeSurge(s,   f.volumeSurge,   klines)) return false
    if (maAlignActive   && !passMaAlignment(s,    f.maAlignment,    klines)) return false
    if (maDirActive     && !passMaDirection(s,    f.maDirection,    klines)) return false
    if (maBreakActive   && !passMaBreakout(s,     f.maBreakout,     klines)) return false
    if (maContActive    && !passMaContinuation(s, f.maContinuation, klines)) return false
    if (maSustActive    && !passMaSustained(s,    f.maSustained,    klines)) return false
    if (downBreakActive && !passDowntrendBreak(s, f.downtrendBreak, klines)) return false
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
