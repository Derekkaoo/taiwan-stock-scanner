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
  date: string         // 資料日期 YYYY-MM-DD
  threeMonthReturn: number | null  // 近三個月報酬率（從 K 線計算）
  subIndustries?: string[]
  groups?: string[]                         // 股票同時屬於多個產業別
  subsByGroup?: Record<string, string[]>   // 每個產業別下該股票相關的細產業
  returns?: Partial<Record<ReturnPeriod, number | null>>  // 各期間漲幅 %
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