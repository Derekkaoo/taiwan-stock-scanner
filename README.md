# 台股大股東持股觀察工具

大股東持股變化 × 族群 K 線工具 — React 19 + FastAPI + TDCC OpenAPI

---

## 專案架構

```
taiwan-stock-scanner/
├── frontend/              # React 19 + TypeScript + Vite + Tailwind v4
│   ├── src/
│   │   ├── types/         # TypeScript 型別定義
│   │   ├── constants/     # 族群字典（THEME_GROUPS）
│   │   ├── hooks/
│   │   │   ├── useStocks.ts      # 股票資料載入 & 狀態
│   │   │   └── useKline.ts       # K 線懶加載 + 快取
│   │   ├── components/
│   │   │   ├── CandlestickSVG.tsx  # 純 SVG K 線圖（含 MA20/MA60/量）
│   │   │   ├── GroupCard.tsx       # 族群折疊卡片
│   │   │   └── StockTable.tsx      # 可排序表格
│   │   └── App.tsx
│   └── public/
│       └── data/
│           └── stocks.json   # ← pipeline 產生的靜態 JSON
│
├── backend/               # FastAPI + SQLAlchemy + SQLite
│   ├── main.py            # 應用程式入口 + APScheduler
│   ├── models.py          # ORM 資料模型
│   ├── scrapers/
│   │   ├── norway_scraper.py   # norway.twsthr.info（ASP.NET postback）
│   │   ├── tdcc_scraper.py     # TDCC 官方 OpenAPI（每週，免費）
│   │   └── yahoo_price.py      # Yahoo Finance K 線
│   └── routers/
│       ├── stocks.py      # GET /api/stocks
│       └── kline.py       # GET /api/kline/{stock_id}
│
├── scripts/
│   └── run_pipeline.py    # 資料管線（爬取 → DB → 靜態 JSON）
└── firebase.json
```

---

## 快速開始

### 方案 A：只跑前端（靜態模式，最快）

```bash
cd frontend
npm install
npm run dev
# → 瀏覽器開啟 http://localhost:5173
# → 預設使用內建 Mock 資料，無需後端
```

### 方案 B：完整前後端

**後端**
```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# 初次執行資料管線（爬取 + 寫入 DB + 產生靜態 JSON）
python scripts/run_pipeline.py

# 啟動 FastAPI 開發伺服器
uvicorn main:app --reload --port 8000
# API 文件：http://localhost:8000/docs
```

**前端**
```bash
cd frontend
npm install
npm run dev
# 切換資料來源為「FastAPI 後端」模式
```

---

## 資料來源說明

| 來源 | 說明 | 限制 |
|------|------|------|
| **norway.twsthr.info** | 大股東持股統計，直接含篩選條件 | 無官方 API，需爬蟲解析 HTML |
| **TDCC 集保 OpenAPI** | 官方每週股權分散表，免費 | 需自行計算週差值 |
| **Yahoo Finance** | 近三個月 K 線 | 非官方 API，可能變動 |
| **Mock 資料** | 內建假資料，開箱即用 | 僅供測試 |

### 資料管線觸發時機

- **手動**：`python scripts/run_pipeline.py`
- **API**：`GET /api/stocks/trigger-scrape`
- **定時**：每週六 07:00（APScheduler）

---

## 族群字典維護

編輯 `frontend/src/constants/themeGroups.ts` 與 `backend/grouping.py`（兩者保持同步）：

```typescript
export const THEME_GROUPS: Record<string, string[]> = {
  "AI伺服器": ["2382", "3231", "6669", ...],
  // 新增族群：
  "新族群名": ["1234", "5678"],
};
```

---

## 部署到 Firebase Hosting

```bash
# 1. 安裝 Firebase CLI
npm install -g firebase-tools
firebase login

# 2. 初始化（首次）
firebase init hosting

# 3. 執行 pipeline 產生最新資料
cd backend && python scripts/run_pipeline.py

# 4. 建置並部署
cd frontend && npm run build
firebase deploy --only hosting
```

後端（FastAPI）可部署到：
- **Railway** / **Render**（免費方案）
- **Google Cloud Run**（最省成本）
- 自架 VPS + systemd

---

## K 線策略（最省資源）

1. **Lazy Loading**：點擊族群才觸發載入
2. **session 快取**：`useRef<Map>` 避免重複請求
3. **並行請求**：`Promise.allSettled` 同族群一起抓
4. **純 SVG 手刻**：`CandlestickSVG.tsx`，零圖表庫依賴
5. **三層 fallback**：Yahoo .TW → Yahoo .TWO → Mock 隨機
