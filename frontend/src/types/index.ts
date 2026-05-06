// ============================================================
//  型別定義 (types/index.ts)
// ============================================================

/** 股票資料列，對應 FastAPI schemas.py */
export interface StockRow {
  id: string
  name: string
  group: string
  groupDesc: string
  holdingPct: number
  delta: number
  price: number
  marketCap: number
  deltaAmount?: number
  turnovers?: Partial<Record<TurnoverPeriod, number>>   // 多期間成交值（億元）
  volumes?: Partial<Record<TurnoverPeriod, number>>     // 多期間成交量（千張）
  date: string
  threeMonthReturn: number | null
  subIndustries?: string[]
  groups?: string[]
  subsByGroup?: Record<string, string[]>
  returns?: Partial<Record<ReturnPeriod, number | null>>
  revenueYoY?: number | null
  revenueMonth?: string | null
  revenueFirstSeen?: string | null
  fundamentals?: Fundamentals
  companyProfile?: CompanyProfile
  foreignBuyStreak?: number   // 外資從最新日往回連續買超天數
  trustBuyStreak?: number     // 投信從最新日往回連續買超天數
  market?: '上市' | '上櫃'    // 市場別（從 Yahoo exchangeName 抓）
  industry?: string           // TWSE 產業別（如「半導體業」）
  /** 內部 flag：本週未入榜的最愛（僅有 id，其他資料用預設值，UI 用灰底渲染）*/
  _isGhost?: boolean
  /** 從 stocks_archive.json 帶來的「最後一次入榜日期」(YYYY-MM-DD)，給 ghost row UI 顯示「資料 X 週前」*/
  _lastSeenDate?: string
}

export interface CompanyProfile {
  business?: string
  chairman?: string
  ceo?: string
  spokesman?: string
  deputySpokesman?: string
  foundedDate?: string
  listedDate?: string
  address?: string
  phone?: string
  fax?: string
  email?: string
  website?: string
  capital?: string
  sharesOutstanding?: string
  employees?: string
  group?: string
  auditor?: string
  englishName?: string
}

/** FinMind / Yahoo 財報資料 — 同時有 YoY 與絕對值序列 */
export interface Fundamentals {
  revenueYoY?: Array<{ date: string; yoy: number }>
  grossMarginYoY?: Array<{ quarter: string; yoy: number }>
  operatingMarginYoY?: Array<{ quarter: string; yoy: number }>
  epsYoY?: Array<{ quarter: string; yoy: number }>
  // 絕對值序列（後端新增）— 每季的實際數字
  grossMargin?:     Array<{ quarter: string; value: number }>   // %
  operatingMargin?: Array<{ quarter: string; value: number }>   // %
  eps?:             Array<{ quarter: string; value: number }>   // 元
}

export type ReturnPeriod = 'w1' | 'm1' | 'm3' | 'm6' | 'y1'

export const RETURN_PERIOD_LABELS: Record<ReturnPeriod, string> = {
  w1: '1週',
  m1: '1月',
  m3: '3月',
  m6: '半年',
  y1: '1年',
}

export type TurnoverPeriod = 'd1' | 'd5' | 'd10' | 'd20'

export const TURNOVER_PERIOD_LABELS: Record<TurnoverPeriod, string> = {
  d1:  '1日',
  d5:  '5日均',
  d10: '10日均',
  d20: '月均',
}

export interface KlineBar {
  date: string
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface GroupStat {
  name: string
  stocks: StockRow[]
  avgDelta: number
  avgReturn: number | null
  cssClass: string
}

export interface SortState {
  key: keyof StockRow
  dir: 'asc' | 'desc'
}

export type DataMode = 'mock' | 'api' | 'static-json'

export interface AppState {
  mode: DataMode
  stocks: StockRow[]
  filteredStocks: StockRow[]
  grouped: Record<string, StockRow[]>
  expandedGroups: Set<string>
  klineCache: Map<string, KlineBar[]>
  sort: SortState
  view: 'table' | 'group'
  loading: boolean
  error: string | null
  searchQuery: string
  lastUpdated: string | null
}

export interface ScatterPoint {
  stock: StockRow
  x: number
  y: number
}

export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error' | 'warn'
}

// ============================================================
//  個股列表 toolbar 篩選器
// ============================================================

export type FilterRange = [number, number]

export type GrowthQuarters = 0 | 1 | 2 | 4 | 8

export interface GrowthFilter {
  quarters: GrowthQuarters
  metrics: {
    eps: boolean
    grossMargin: boolean
    operatingMargin: boolean
  }
}

/** 絕對值區塊：共用一個季別 picker，3 個 metric 各自的範圍。
 *  quarter = '' 視為未啟用（不篩、disable 3 個 slider）。
 *  quarter 字串例：'2024Q3'。 */
export interface AbsValueFilter {
  quarter: string
  grossMargin:     FilterRange
  operatingMargin: FilterRange
  eps:             FilterRange
}

/** 法人連續買超：days = 0 視為不啟用 */
export type InstStreakDays = 0 | 1 | 3 | 5 | 20

export interface InstitutionalFilter {
  days: InstStreakDays
  foreign: boolean
  trust: boolean
}

/** 市場別篩選：'all' = 不篩、'listed' = 上市、'otc' = 上櫃 */
export type MarketFilter = 'all' | 'listed' | 'otc'

/** N 日漲跌幅：days = 0 視為不啟用 */
export type NReturnDays = 0 | 1 | 3 | 5 | 10 | 20
export interface NDayReturnFilter {
  days:  NReturnDays
  /** 漲跌幅範圍 %；range = 預設範圍 視為不啟用（即使 days 已選） */
  range: FilterRange
}

/** 創 N 日新高：days = 0 視為不啟用，>0 表示「今日 high ≥ 過去 N 根 K 棒最高」 */
export type NHighDays = 0 | 5 | 10 | 20 | 60 | 120 | 200
export interface NDayHighFilter {
  days: NHighDays
}

/** 成交量創 N 日新高：days = 0 視為不啟用 */
export type VolumeNewHighDays = 0 | 5 | 10 | 20 | 60
export interface VolumeNewHighFilter {
  days: VolumeNewHighDays
}

/** 成交爆量：今日 volume ≥ baseline × multiplier
 *  baseline:
 *    'prev' = 昨量（最新一根之前的那根）
 *    'ma5' / 'ma10' / 'ma60' = 過去 N 根 K 棒平均（不含最新一根）
 *  multiplier = 0 視為不啟用 */
export type VolumeSurgeBaseline = 'prev' | 'ma5' | 'ma10' | 'ma60'
export type VolumeSurgeMultiplier = 0 | 1 | 2 | 3 | 5
export interface VolumeSurgeFilter {
  baseline:   VolumeSurgeBaseline
  multiplier: VolumeSurgeMultiplier
}

/** 均線多頭排列：選 2-5 個 MA 期數，要求短期 MA > 長期 MA（價格上）
 *  例 periods=[5,10,20] 表示要求 MA5 > MA10 > MA20
 *  periods.length < 2 視為不啟用 */
export type MaAlignmentPeriod = 5 | 10 | 20 | 60 | 120
export interface MaAlignmentFilter {
  periods: MaAlignmentPeriod[]
}

/** 均線方向朝上：選任意 MA 期數，每條都要求「今日 MA > 昨日 MA」（AND 邏輯）
 *  periods.length === 0 視為不啟用 */
export type MaDirectionPeriod = 5 | 10 | 20 | 60 | 120
export interface MaDirectionFilter {
  periods: MaDirectionPeriod[]
}

/** N 日內突破 MA：過去 N 個交易日（含今天）內，任一根 K 棒出現
 *  「該日 close > 該日 MA AND 前一日 close ≤ 前一日 MA」即視為突破。
 *  days = 0 或 period = 0 視為不啟用。 */
export type MaBreakoutDays = 0 | 1 | 3 | 5 | 10 | 20
export type MaBreakoutPeriod = 0 | 5 | 10 | 20 | 60 | 120
export interface MaBreakoutFilter {
  days:   MaBreakoutDays
  period: MaBreakoutPeriod
}

/** 明日 MA 續揚 / 下彎（扣抵值預測）：
 *  扣抵值 = N 天前的 close = bars[len - period].c
 *  - direction='up'  → 命中條件：今日 close > 扣抵值（明日 MA 必然上揚，前提：明日 close ≥ 扣抵值）
 *  - direction='down'→ 命中條件：今日 close < 扣抵值（明日 MA 必然下彎）
 *  direction='off' 或 period=0 視為不啟用 */
export type MaContinuationDirection = 'off' | 'up' | 'down'
export type MaContinuationPeriod    = 0 | 5 | 10 | 20 | 60 | 120
export interface MaContinuationFilter {
  direction: MaContinuationDirection
  period:    MaContinuationPeriod
}

/** 未來 N 日 MA 不下彎（扣抵保護）：
 *  未來 N 天每天的扣抵值都 < 今日 close
 *  → 即使股價盤整不漲，MA 仍會連續上揚 N 天
 *  days = 0 或 period = 0 視為不啟用 */
export type MaSustainedDays   = 0 | 3 | 5 | 10
export type MaSustainedPeriod = 0 | 5 | 10 | 20 | 60 | 120
export interface MaSustainedFilter {
  days:   MaSustainedDays
  period: MaSustainedPeriod
}

/** 抓轉折 — N 日內突破下降趨勢線：
 *  1. 在最近 N 日 K 棒中找 pivot highs（左右各 3 根都比它低）
 *  2. 取最新 P 個 pivots，要求嚴格遞減（lower highs）
 *  3. 第一個 pivot 連最後一個 pivot 形成下降趨勢線
 *  4. 今日 close > 趨勢線今日值 AND 昨日 close ≤ 趨勢線昨日值（突破當日）
 *  days = 0 視為不啟用 */
export type DowntrendBreakDays   = 0 | 30 | 60 | 120
export type DowntrendBreakPivots = 3 | 4 | 5
export interface DowntrendBreakFilter {
  days:   DowntrendBreakDays
  pivots: DowntrendBreakPivots
}

/** 回撤均線 — 找多頭股拉回到均線附近的進場點：
 *  1. MA 朝上（今日 MA > 5 天前 MA）— 確認上升趨勢
 *  2. 今日 close 站在 MA 上方
 *  3. 過去 3 天內 low ≤ 該日 MA（曾觸及或跌破均線）
 *  4. 過去 20 天最高 close > MA × 1.05（確認有「漲過」再「拉回」）
 *  period = 0 視為不啟用 */
export type PullbackMaPeriod = 0 | 5 | 10 | 20 | 60
export interface PullbackMaFilter {
  period: PullbackMaPeriod
}

export interface Filters {
  volume:     FilterRange      // 5 日均成交量（千張）
  marketCap:  FilterRange      // 市值（億）
  delta:      FilterRange      // 大戶本週增持 %
  revenueYoY: FilterRange      // 月營收 YoY %
  industries: string[]
  growth:     GrowthFilter
  absValue:   AbsValueFilter
  institutional: InstitutionalFilter
  market:        MarketFilter
  nDayReturn:    NDayReturnFilter
  nDayHigh:      NDayHighFilter
  volumeNewHigh: VolumeNewHighFilter
  volumeSurge:   VolumeSurgeFilter
  maAlignment:     MaAlignmentFilter
  maDirection:     MaDirectionFilter
  maBreakout:      MaBreakoutFilter
  maContinuation:  MaContinuationFilter
  maSustained:     MaSustainedFilter
  downtrendBreak:  DowntrendBreakFilter
  pullbackMa:      PullbackMaFilter
}

export const FILTER_BOUNDS = {
  volume:     { min: 0,    max: 500000 },    // 張（normalizeRow 已 ×1000）
  marketCap:  { min: 0,    max: 5000 },
  delta:      { min: 0.1,  max: 5    },
  revenueYoY: { min: -50,  max: 200  },
  // 絕對值範圍（依實測分布調整）
  grossMargin:     { min: -50,  max: 100 },  // % — P5 -0.4、P95 61、max 97
  operatingMargin: { min: -100, max: 100 },  // % — P5 -35、P95 27、有極端虧損
  eps:             { min: -10,  max: 100 },  // 元 — P95 8.5、max 74
  // N 日漲幅範圍 % — 涵蓋常見區間（1 日 ±10%、N 日 ±50%）
  nDayReturn:      { min: -10,  max: 50 },
} as const

export const DEFAULT_FILTERS: Filters = {
  volume:     [FILTER_BOUNDS.volume.min,     FILTER_BOUNDS.volume.max],
  marketCap:  [FILTER_BOUNDS.marketCap.min,  FILTER_BOUNDS.marketCap.max],
  delta:      [FILTER_BOUNDS.delta.min,      FILTER_BOUNDS.delta.max],
  revenueYoY: [FILTER_BOUNDS.revenueYoY.min, FILTER_BOUNDS.revenueYoY.max],
  industries: [],
  growth: {
    quarters: 0,
    metrics: { eps: false, grossMargin: false, operatingMargin: false },
  },
  absValue: {
    quarter: '',
    grossMargin:     [FILTER_BOUNDS.grossMargin.min,     FILTER_BOUNDS.grossMargin.max],
    operatingMargin: [FILTER_BOUNDS.operatingMargin.min, FILTER_BOUNDS.operatingMargin.max],
    eps:             [FILTER_BOUNDS.eps.min,             FILTER_BOUNDS.eps.max],
  },
  institutional: { days: 0, foreign: false, trust: false },
  market: 'all',
  nDayReturn: {
    days: 0,
    range: [FILTER_BOUNDS.nDayReturn.min, FILTER_BOUNDS.nDayReturn.max],
  },
  nDayHigh:      { days: 0 },
  volumeNewHigh: { days: 0 },
  volumeSurge:   { baseline: 'ma5', multiplier: 0 },
  maAlignment:    { periods: [] },  // 預設不啟用；user 啟用建議 [5,10,20]
  maDirection:    { periods: [] },  // 預設不啟用
  maBreakout:     { days: 0, period: 0 },  // 預設不啟用（兩個 chip 都需要選）
  maContinuation: { direction: 'off', period: 0 },  // 預設不啟用
  maSustained:    { days: 0, period: 0 },           // 預設不啟用
  downtrendBreak: { days: 0, pivots: 3 },           // 預設不啟用；高點數量預設 3
  pullbackMa:     { period: 0 },                    // 預設不啟用
}

export const INST_STREAK_OPTIONS: InstStreakDays[] = [0, 1, 3, 5, 20]

export const MARKET_OPTIONS: Array<{ value: MarketFilter; label: string }> = [
  { value: 'all',    label: '全部' },
  { value: 'listed', label: '上市' },
  { value: 'otc',    label: '上櫃' },
]

export const N_RETURN_OPTIONS: NReturnDays[] = [0, 1, 3, 5, 10, 20]

export const N_HIGH_OPTIONS: NHighDays[] = [0, 5, 10, 20, 60, 120, 200]

export const VOLUME_NEW_HIGH_OPTIONS: VolumeNewHighDays[] = [0, 5, 10, 20, 60]

export const VOLUME_SURGE_BASELINE_OPTIONS: Array<{ value: VolumeSurgeBaseline; label: string }> = [
  { value: 'prev', label: '昨量' },
  { value: 'ma5',  label: '5日均量' },
  { value: 'ma10', label: '10日均量' },
  { value: 'ma60', label: '60日均量' },
]

export const VOLUME_SURGE_MULTIPLIER_OPTIONS: VolumeSurgeMultiplier[] = [0, 1, 2, 3, 5]

export const MA_ALIGNMENT_OPTIONS: MaAlignmentPeriod[] = [5, 10, 20, 60, 120]
export const MA_ALIGNMENT_DEFAULT: MaAlignmentPeriod[] = [5, 10, 20]

export const MA_DIRECTION_OPTIONS: MaDirectionPeriod[] = [5, 10, 20, 60, 120]

export const MA_BREAKOUT_DAYS_OPTIONS:   MaBreakoutDays[]   = [0, 1, 3, 5, 10, 20]
export const MA_BREAKOUT_PERIOD_OPTIONS: MaBreakoutPeriod[] = [0, 5, 10, 20, 60, 120]

export const MA_CONTINUATION_DIRECTION_OPTIONS: Array<{ value: MaContinuationDirection; label: string }> = [
  { value: 'off',  label: '關閉' },
  { value: 'up',   label: '續揚 ▲' },
  { value: 'down', label: '下彎 ▼' },
]
export const MA_CONTINUATION_PERIOD_OPTIONS: MaContinuationPeriod[] = [0, 5, 10, 20, 60, 120]

export const MA_SUSTAINED_DAYS_OPTIONS:   MaSustainedDays[]   = [0, 3, 5, 10]
export const MA_SUSTAINED_PERIOD_OPTIONS: MaSustainedPeriod[] = [0, 5, 10, 20, 60, 120]

export const DOWNTREND_BREAK_DAYS_OPTIONS:   DowntrendBreakDays[]   = [0, 30, 60, 120]
export const DOWNTREND_BREAK_PIVOTS_OPTIONS: DowntrendBreakPivots[] = [3, 4, 5]

export const PULLBACK_MA_PERIOD_OPTIONS: PullbackMaPeriod[] = [0, 5, 10, 20, 60]

// ============================================================
//  進場分析（多頭觸發回測研究）
// ============================================================
export type EntryStrategy = 'breakout' | 'ma5' | 'ma10' | 'ma20'
export type ExitStrategy  = 'ma5' | 'ma10' | 'ma20'

export interface EntryStrategyStats {
  count:      number
  winCount:   number
  winRate:    number | null
  avgReturn:  number | null
  avgMae:     number | null
  rrRatio:    number | null
}

export interface EntryAnalysisBest {
  entry:      EntryStrategy
  exit:       ExitStrategy
  count:      number
  winRate:    number
  avgReturn:  number
  avgMae:     number
  rrRatio:    number
}

export interface EntryEventByExit {
  ma5:  { returnPct: number; maePct: number } | null
  ma10: { returnPct: number; maePct: number } | null
  ma20: { returnPct: number; maePct: number } | null
}

export interface EntryEventEntryPoint {
  date:        string
  entryClose:  number
  daysFromTrigger?: number
  byExit:      EntryEventByExit
}

export interface EntryEvent {
  triggerDate:   string
  triggerClose:  number
  highestClose:  number
  ongoing:       boolean
  exits: {
    ma5:  { date: string; close: number }
    ma10: { date: string; close: number }
    ma20: { date: string; close: number }
  }
  breakout: EntryEventEntryPoint
  ma5:  EntryEventEntryPoint | null
  ma10: EntryEventEntryPoint | null
  ma20: EntryEventEntryPoint | null
}

export interface EntryAnalysis {
  stockId:      string
  sampleSize:   number
  best:         EntryAnalysisBest | null
  strategies:   Record<EntryStrategy, Record<ExitStrategy, EntryStrategyStats>>
  events:       EntryEvent[]
}

export const ENTRY_LABELS: Record<EntryStrategy, string> = {
  breakout: '突破直入',
  ma5:      '回測 MA5',
  ma10:     '回測 MA10',
  ma20:     '回測 MA20',
}

export const EXIT_LABELS: Record<ExitStrategy, string> = {
  ma5:  '<MA5 退',
  ma10: '<MA10 退',
  ma20: '<MA20 退',
}

export const FILTER_LABELS = {
  volume:     '今日成交量',
  marketCap:  '市值',
  delta:      '大戶本週增持',
  revenueYoY: '月營收YoY',
  grossMargin:     '毛利率',
  operatingMargin: '營利率',
  eps:             'EPS',
  nDayReturn:      'N 日漲跌幅',
} as const

export const FILTER_UNITS = {
  volume:     '張',
  marketCap:  '億',
  delta:      '%',
  revenueYoY: '%',
  grossMargin:     '%',
  operatingMargin: '%',
  eps:             '元',
  nDayReturn:      '%',
} as const

export const GROWTH_QUARTERS_OPTIONS: GrowthQuarters[] = [0, 1, 2, 4, 8]

export const GROWTH_METRIC_LABELS = {
  eps:             'EPS',
  grossMargin:     '毛利率',
  operatingMargin: '營利率',
} as const
