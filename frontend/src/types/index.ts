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
export type MaAlignmentPeriod = 5 | 10 | 20 | 60 | 120 | 240
export interface MaAlignmentFilter {
  periods: MaAlignmentPeriod[]
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
  maAlignment:   MaAlignmentFilter
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
  maAlignment:   { periods: [] },  // 預設不啟用；user 啟用建議 [5,10,20]
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

export const MA_ALIGNMENT_OPTIONS: MaAlignmentPeriod[] = [5, 10, 20, 60, 120, 240]
export const MA_ALIGNMENT_DEFAULT: MaAlignmentPeriod[] = [5, 10, 20]

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
