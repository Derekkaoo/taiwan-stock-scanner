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

export interface Filters {
  volume:     FilterRange      // 5 日均成交量（千張）
  marketCap:  FilterRange      // 市值（億）
  delta:      FilterRange      // 大戶本週增持 %
  revenueYoY: FilterRange      // 月營收 YoY %
  industries: string[]
  growth:     GrowthFilter
  absValue:   AbsValueFilter
  institutional: InstitutionalFilter
  market:     MarketFilter
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
}

export const INST_STREAK_OPTIONS: InstStreakDays[] = [0, 1, 3, 5, 20]

export const MARKET_OPTIONS: Array<{ value: MarketFilter; label: string }> = [
  { value: 'all',    label: '全部' },
  { value: 'listed', label: '上市' },
  { value: 'otc',    label: '上櫃' },
]

export const FILTER_LABELS = {
  volume:     '今日成交量',
  marketCap:  '市值',
  delta:      '大戶本週增持',
  revenueYoY: '月營收YoY',
  grossMargin:     '毛利率',
  operatingMargin: '營利率',
  eps:             'EPS',
} as const

export const FILTER_UNITS = {
  volume:     '張',
  marketCap:  '億',
  delta:      '%',
  revenueYoY: '%',
  grossMargin:     '%',
  operatingMargin: '%',
  eps:             '元',
} as const

export const GROWTH_QUARTERS_OPTIONS: GrowthQuarters[] = [0, 1, 2, 4, 8]

export const GROWTH_METRIC_LABELS = {
  eps:             'EPS',
  grossMargin:     '毛利率',
  operatingMargin: '營利率',
} as const
