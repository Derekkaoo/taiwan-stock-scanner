# 千張大戶持股追蹤器 — 專案狀態

## 網站資訊
- **網址**：https://taiwan-stock-scanner.web.app
- **GitHub**：https://github.com/Derekkaoo/taiwan-stock-scanner
- **本機路徑**：`C:\Users\Derek\Desktop\taiwan-stock-scanner\taiwan-stock-scanner`

---

## 技術架構
- **前端**：React 19 + TypeScript + Vite + Tailwind CSS v4
- **資料**：靜態 JSON（`stocks.json` + `klines.json`），部署到 Firebase Hosting
- **Pipeline**：Python 腳本，GitHub Actions 自動執行
- **後端虛擬環境**：`backend/venv/`

---

## 專案目錄結構
```
taiwan-stock-scanner/
├── frontend/src/
│   ├── App.tsx
│   ├── hooks/useStocks.ts, useKline.ts
│   ├── components/GroupCard.tsx, StockTable.tsx, CandlestickSVG.tsx
│   ├── constants/themeGroups.ts
│   └── types/index.ts
├── scripts/
│   ├── run_pipeline.py       ← 主要資料管線（v2 穩定版）
│   ├── update_klines.py      ← 每日輕量K線更新
│   └── build_stock_db.py     ← MoneyDJ細產業爬蟲（已跑完）
├── frontend/public/data/
│   ├── stocks.json
│   └── klines.json
├── backend/db/
│   ├── stock_industry_map.json  ← MoneyDJ 1964支股票細產業資料庫
│   └── sub_industries.json
└── .github/workflows/weekly-update.yml
```

---

## Pipeline 架構（run_pipeline.py）

### 四步驟流程
1. **Step 1**：從神秘金字塔抓持股名單（`norway.twsthr.info`）
2. **Step 2**：從 TWSE 抓官方產業別
3. **Step 3**：從財報狗抓族群標籤
4. **Step 4**：從 Yahoo Finance 抓 K 線（1年資料）

### 族群分類優先順序
```
STOCK_OVERRIDE > 財報狗 > MoneyDJ細產業 > NAME_KEYWORD > INDUSTRY_TO_GROUP
```

### 排程（weekly-update.yml）
- 週六 04:00 UTC = 台灣時間 12:00（完整更新）
- 週六 10:00 UTC = 台灣時間 18:00（補跑）
- 週一至週五 09:00 UTC = 台灣時間 17:00（每日K線更新）

---

## 族群名稱對照（最新版本）

| 族群名稱 | 說明 |
|---------|------|
| AI伺服器 | AI 伺服器組裝、ODM 代工 |
| 散熱 | 均熱板、散熱模組、液冷系統 |
| 先進封裝 | 先進封裝、IC 載板（原CoWoS先進封裝） |
| 光通訊/矽光子 | 共封裝光學、矽光子、光模組（原CPO矽光子） |
| PCB載板 | 印刷電路板、ABF 載板 |
| 被動元件 | MLCC、電阻、電感 |
| IC設計/半導體 | Fabless IC 設計 |
| 晶圓代工 | 晶圓代工廠 |
| 記憶體 | DRAM、Flash 記憶體（原記憶體DRAM） |
| 連接器 | 線材連接器、背板連接器 |
| 電子零組件 | 其他電子零組件 |
| 電源供應器 | 伺服器電源、工業電源 |
| 重電電網 | 變壓器、配電設備、電網 |
| 太陽能 | 太陽能電池、模組 |
| 機器人 | 工業機器手臂、AMR |
| 工業自動化 | CNC 工具機、工業電腦 |
| 5G通訊 | 5G 基站、Open RAN |
| 車用電子 | ADAS、ECU、電動車 |
| 衛星通訊 | 低軌衛星、Starlink 供應鏈（原低軌衛星） |
| 光電/LED | LED 照明、面板 |
| 光學/鏡頭 | 光學鏡頭、鏡片 |
| 航運 | 貨櫃航運、散裝航運（原貨櫃航運） |
| 生技醫療 | 新藥研發、醫療器材 |
| 鋼鐵 | 鋼鐵製造 |
| 塑化 | 石化原料、塑膠製品 |
| 金控銀行 | 銀行、金控、壽險 |
| 建設營造 | 不動產開發、營建 |
| 紡織 | 紡紗、織布 |
| 食品飲料 | 食品加工、飲料 |
| 其他/未分組 | 尚未分類 |

---

## MoneyDJ 資料庫
- **位置**：`backend/db/stock_industry_map.json`
- **內容**：1964 支股票，每支對應多個 MoneyDJ 細產業
- **格式**：
```json
{
  "2330": {
    "name": "台積電",
    "sub_industries": [
      {"code": "C099001", "name": "晶圓代工"}
    ]
  }
}
```

---

## stocks.json 欄位說明
```json
{
  "id": "2330",
  "name": "台積電",
  "group": "晶圓代工",
  "groupDesc": "族群說明文字",
  "holdingPct": 59.58,
  "delta": 0.44,
  "price": 950.0,
  "marketCap": 0.0,
  "date": "2026-04-17",
  "threeMonthReturn": 12.5,
  "industry": "半導體業",
  "subIndustries": ["晶圓代工", "化合物晶圓"]
}
```

---

## 前端重要設定

### K 線顯示
- 資料範圍：1年（`range=1y`）
- 顯示根數：`bars.slice(-120)` + `fullData={bars}` 確保 MA60 完整
- 個股列表：`bars.slice(-65)` + `fullData={bars}`

### 族群顏色（themeGroups.ts）
- `THEME_CSS_MAP`：族群名稱 → CSS class
- `TAG_COLORS`：CSS class → 顏色代碼

---

## 待辦事項
- [ ] 確認 run_pipeline.py 的 GROUP_DESC 裡 CoWoS先進封裝 key 改成 先進封裝
- [ ] 補充 MONEYDJ_TO_GROUP 對應表（目前其他/未分組還有 40 支）
- [ ] 網站 UI 重新設計（TradingView / FinTech 風格）

---

## 常用指令

### 本機開發
```powershell
# 前端開發（含手機測試）
cd frontend
cmd /c "npm run dev -- --host"

# 跑 pipeline
cd backend
venv\Scripts\python.exe ..\scripts\run_pipeline.py

# 跑 K 線更新
cd backend
venv\Scripts\python.exe ..\scripts\update_klines.py
```

### Build + Push
```powershell
cd frontend
cmd /c "npm run build"
cd ..
git add .
git commit -m "描述"
git push
```
