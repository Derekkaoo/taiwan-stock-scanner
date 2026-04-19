// ============================================================
//  型別定義 (types/index.ts)
//  與後端 FastAPI schemas.py 對應，欄位名稱保持一致
// ============================================================

/** 股票基礎資料 — 對應後端 StockRow schema */
export interface StockRow {
  id: string           // 股票代號（四位數）
  name: string         // 股票名稱
  group: string        // 族群名稱（由 assignThemeGroup 指派）
  holdingPct: number   // 本週大股東持股比例 %
  delta: number        // 與上週差異 %
  price: number        // 收盤價
  marketCap: number    // 市值（億元）
  date: string         // 資料日期 YYYY-MM-DD
  threeMonthReturn: number | null  // 近三個月報酬率（K 線載入後填入）
}

/** K 線單根資料 — 對應後端 KlineBar schema */
export interface KlineBar {
  date: string   // 日期字串
  o: number      // 開盤
  h: number      // 最高
  l: number      // 最低
  c: number      // 收盤
  v: number      // 成交量
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

/** 資料來源模式 */
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

/** 四象限散佈圖資料點 */
export interface ScatterPoint {
  stock: StockRow
  x: number   // X 軸：週增持 delta
  y: number   // Y 軸：三個月報酬率
}

/** Toast 通知 */
export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error' | 'warn'
}
