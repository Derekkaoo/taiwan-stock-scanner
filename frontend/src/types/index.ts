// ============================================================
//  型別定義 (types/index.ts)
// ============================================================

/** 股票資料列，對應 FastAPI schemas.py */
export interface StockRow {
  id: string           // 股票代號
  name: string         // 股票名稱
  group: string        // 族群名稱
  groupDesc: string    // 族群業務說明
  holdingPct: number   // 大股東持股比例 %
  delta: number        // 本週增持幅度 %
  price: number        // 收盤價
  marketCap: number    // 市值（億）
  deltaAmount?: number // 本週增持金額（億）= delta% × marketCap，normalizeRow 時衍生
  turnovers?: Partial<Record<TurnoverPeriod, number>>  // 多期間成交值（億元）
  date: string         // 資料日期 YYYY-MM-DD
  threeMonthReturn: number | null  // 近三個月報酬率（從 K 線計算）
  subIndustries?: string[]
  groups?: string[]                         // 股票同時屬於多個產業別
  subsByGroup?: Record<string, string[]>   // 每個產業別下該股票相關的細產業
  returns?: Partial<Record<ReturnPeriod, number | null>>  // 各期間漲幅 %
  revenueYoY?: number | null            // 月營收年增率 %
  revenueMonth?: string | null          // 該月營收資料月份 YYYY-MM
  revenueFirstSeen?: string | null      // 首次抓到此月份營收資料的日期 YYYY-MM-DD
  fundamentals?: Fundamentals           // FinMind 12 月營收 + 8 季財報 YoY 序列
  companyProfile?: CompanyProfile       // Yahoo 公司基本資料 + 業務介紹
}

/** 公司基本資料 + 業務介紹（來源：Yahoo 股市 profile）*/
export interface CompanyProfile {
  business?: string         // 主要經營業務（一段文字）
  chairman?: string         // 董事長
  ceo?: string              // 總經理
  spokesman?: string        // 發言人
  deputySpokesman?: string  // 代理發言人
  foundedDate?: string      // 成立時間
  listedDate?: string       // 上市/上櫃時間
  address?: string          // 公司地址
  phone?: string            // 電話
  fax?: string              // 傳真
  email?: string            // 電子郵件
  website?: string          // 公司網址
  capital?: string          // 實收資本額
  sharesOutstanding?: string  // 已發行普通股數
  employees?: string        // 員工人數
  group?: string            // 所屬集團
  auditor?: string          // 簽證會計師
  englishName?: string      // 英文簡稱
}

/** FinMind 抓下來的基本面資料 */
export interface Fundamentals {
  revenueYoY?: Array<{ date: string; yoy: number }>          // 12 個月
  grossMarginYoY?: Array<{ quarter: string; yoy: number }>   // 8 季
  operatingMarginYoY?: Array<{ quarter: string; yoy: number }>
  epsYoY?: Array<{ quarter: string; yoy: number }>
}

/** 漲幅期間 key */
export type ReturnPeriod = 'w1' | 'm1' | 'm3' | 'm6' | 'y1'

/** UI 顯示用的期間標籤 */
export const RETURN_PERIOD_LABELS: Record<ReturnPeriod, string> = {
  w1: '1週',
  m1: '1月',
  m3: '3月',
  m6: '半年',
  y1: '1年',
}

/** 成交值期間 key */
export type TurnoverPeriod = 'd1' | 'd5' | 'd10' | 'd20'

/** UI 顯示用的成交值期間標籤 */
export const TURNOVER_PERIOD_LABELS: Record<TurnoverPeriod, string> = {
  d1:  '1日',
  d5:  '5日均',
  d10: '10日均',
  d20: '月均',
}

/** K 線資料列 */
export interface KlineBar {
  date: string   // 日期字串
  o: number      // 開
  h: number      // 高
  l: number      // 低
  c: number      // 收
  v: number      // 量
}

/** 族群統計 */
export interface GroupStat {
  name: string
  stocks: StockRow[]
  avgDelta: number
  avgReturn: number | null
  cssClass: string
}

/** 排序狀態 */
export interface SortState {
  key: keyof StockRow
  dir: 'asc' | 'desc'
}

/** 資料載入模式 */
export type DataMode = 'mock' | 'api' | 'static-json'

/** App 全域狀態 */
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

/** 散點圖資料點 */
export interface ScatterPoint {
  stock: StockRow
  x: number   // X 軸：增持幅度 delta
  y: number   // Y 軸：三個月報酬
}

/** Toast 通知 */
export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error' | 'warn'
}