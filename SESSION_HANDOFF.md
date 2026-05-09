# Session Handoff — 2026-05-09 晚

> 給下一個 Cowork session 用。先讀 `CLAUDE.md`（專案總覽），再讀這份（最近改動 + 待辦 + retro）。
> 5/9 內容超量（外資投信圖、Yahoo 主來源切換、K 線殘缺事故 retro），下面保留 5/8 起的歷史。

---

## 🔥 2026-05-09 完成的內容

**主線進度**：
1. 加 master 外資/投信圖表（90 日 bar chart，desktop 2x2 grid + mobile 上下兩排）
2. fetch_financials.py 切換 Yahoo 主來源、FinMind fallback（避免 quota 撞牆）
3. update_klines.py smart-skip bug 修復（避免新加股票永遠抓不到 K 線）
4. 寫 verify_coverage.py 健檢工具
5. K 線殘缺事故 retro + SOP 強化

### 1. 外資/投信 90 日 bar chart

新元件 `frontend/src/components/InstitutionalChart.tsx`（純 SVG，無 Chart.js 依賴）：
- 90 日 bar chart，紅 = 買 / 綠 = 賣
- Y 軸自動 scale (niceCeiling)
- X 軸 5 個等距日期 label（首、1/4、1/2、3/4、尾）
- Header 顯示 streak + N 日累積（紅綠隨方向）

桌機 (`StockTable.tsx`) — 在 K 線+基本面那排下面加第二排，2x2 grid 對齊：
```
┌────────────┬─────────────┐
│ K 線         │ 月營收/毛利等 │  ← 既有
├────────────┼─────────────┤
│ 外資 90 日  │ 投信 90 日   │  ← 新增
└────────────┴─────────────┘
```

手機 (`MobileStockDetail.tsx`) — 在 FundamentalsPanel 下方上下排兩個 chart（不摺疊）。

### 2. 後端：institutional 30 → 90 天 + stocks.json enrich

`scripts/scrape_institutional.py`：
- `KEEP_DAYS` / `LOOKBACK_DAYS` 30 → 90
- `enrich_stocks_json()` 加寫 `institutionalHistory: [{date, foreign, trust}, ...]` 90 筆到 stocks.json

但 Yahoo 實際只回 ~54 個交易日（不是頁面說的 100 天），所以實戰約 50-60 天歷史。FinMind 補上後可達 90 天。

### 3. 前端型別 + 解析

`types/index.ts` 加 `institutionalHistory?: { date, foreign, trust }[]`
`hooks/useStocks.ts` 加 `parseInstitutionalHistory()` 容錯解析

### 4. 🔥 fetch_financials.py 切 Yahoo 主來源

**動機**：5/9 觸發雲端 cron 時 FinMind quota 撞 402，新加股票（譬如 6672）月營收只抓到 1 月 → 用戶看到只有 4 月 YoY bar。

**改動**：
- 新增 `fetch_yahoo_revenue_records(stock_id)` — 從 Yahoo TW finance 抓月營收歷史（無 quota，60 個月）
- Yahoo 改 Next.js 後資料埋在 inline JSON，用 regex 抽：`"date":"2026/04","revenue":"410,725,118"`（注意 `/` 要 unescape）
- run() 內 `need_rev` block：Yahoo 主、FinMind fallback
- run() 內 `need_fin` block：scrape_yahoo_financials.fetch_yahoo_financials 主、FinMind fallback

**結果**：384 支股票全跑 Yahoo，無 quota 撞牆，377 支有完整資料。

### 5. 🔥 update_klines.py smart-skip bug 修復

**Bug**：原 `_klines_are_fresh()` 只檢查 klines.json 第一支股票就 return True，導致：
- norway 加新股票 → 新股票沒 bar、舊股票有 bar
- smart-skip 以為「已最新」→ 跳過抓取
- 新股票永遠拿不到 K 線

**修法**：改成檢查 stocks.json 內**所有**股票都有最新 bar 才算 fresh：

```python
def _klines_are_fresh():
    stocks = json.load(open(stocks_path, encoding='utf-8'))
    kl = json.load(open(klines_path, encoding='utf-8'))
    expected = _expected_trading_day()
    missing_or_stale = 0
    for s in stocks:
        bars = kl.get(s["id"], [])
        if not bars: missing_or_stale += 1; continue
        last = parse_date(bars[-1].get("date", ""))
        if last is None or last < expected:
            missing_or_stale += 1
    return missing_or_stale == 0
```

雲端 weekly-update.yml 不用改，因為 update_klines.py 內部 smart-skip 邏輯修好了會自動偵測。

### 6. verify_coverage.py 健檢工具

`scripts/verify_coverage.py`：一鍵檢查 stocks.json 內每支股票的 K 線、price、月營收、季財報、institutional 涵蓋率。push 後跑一次驗證部署狀態。

```powershell
python scripts/verify_coverage.py            # threshold 85%
python scripts/verify_coverage.py --strict   # threshold 95%
```

非 0 exit code 表示有資料項目未達 threshold，給 CI / cron post-step 用。

---

## 🚨 5/9 K 線殘缺事故 — 完整 retro

### 時間軸

| 時間 | 事件 | 影響 |
|---|---|---|
| 11:50 | push `ba84ae7`（feat institutional）| ✅ 正常 |
| 12:03 | 手動觸發雲端 workflow_dispatch | 雲端跑 full pipeline |
| 12:30 | cloud commit `92b7187` push 上去 | ⚠️ K 線殘缺（256/384 沒抓到，因 smart-skip bug）|
| 13:00 | user 看到網頁壞、回報 | |
| 13:10 | 用 `git pull --rebase --autostash` | ❌ autostash apply 撞 conflict |
| 13:15 | 用 `git checkout --theirs` 解 conflict | ❌ 化纖原料/時尚產業兩檔報錯（UD/UA 狀態），殘留 conflict marker |
| 13:20 | commit 壞檔 push → JSON parse 炸 | ❌ 部署失敗，網頁完全空白 |
| 13:30 | reset 回 `ba84ae7` + force push | ✅ 緊急恢復 |
| 13:50-14:35 | 重跑 pipeline + force klines + force institutional + push | ✅ 完整恢復 |
| 14:50-15:10 | 切 Yahoo 主來源 + 修 smart-skip + 健檢工具 | ✅ 永久 fix |

### Root cause（三層）

1. **`update_klines.py` smart-skip 只看第一支股票** — 新股票永遠抓不到 K 線（已修 ✅）
2. **`git pull --rebase --autostash` + `--theirs` 解 stash 衝突** — 對 UA/UD 檔失敗，殘留 conflict marker，commit 後 JSON 壞
3. **Pipeline 順序遺忘** — run_pipeline.py 重建 stocks.json 會清掉 institutional 欄位，必須最後再跑 scrape_institutional.py 補回

---

## 🛡️ 預防 SOP（**必讀**）

### A. 本地修資料的標準流程（替代 `--autostash`）

```powershell
# 1. 確認 working tree clean
git status

# 2. ⭐ 先 pull 再跑 script（避免 stash 衝突，這是 5/9 最大教訓）
git pull --rebase -X theirs

# 3. 跑 data scripts（順序固定）
python scripts/run_pipeline.py
python scripts/update_klines.py        # 不用 --force，新 smart-skip 會自動偵測
python scripts/scrape_institutional.py # ⭐ 必須最後跑，enrich institutional 欄位

# 4. 健檢
python scripts/verify_coverage.py

# 5. add + commit + push
git add backend/db/ frontend/public/data/
git commit -m "..."
git push
# 撞 race → git pull --rebase -X theirs && git push
```

### B. 鐵律

- ❌ **不用 `git pull --rebase --autostash`**（autostash apply 對新增/刪除檔卡住）
- ❌ **不用 `git checkout --theirs`** 解 stash conflict（對 UA/UD 失敗）
- ✅ **永遠先 pull 再跑 scripts**（不留 uncommitted 給 stash 處理）
- ✅ **`-X theirs` 解 rebase conflict**（資料檔以新抓的為準，CLAUDE.md quirk #5 SOP）
- ✅ **scrape_institutional.py 永遠最後跑**

### C. 如果還是撞 stash 衝突

```powershell
git status --short    # 看 UU / UA / UD 各種衝突類型

# UU（兩邊都改）→ git checkout --ours/--theirs
# UA / UD（新增 / 刪除）→ 個別 git add / git rm

# 全綠才 commit；不確定就最安全的退路：
git rebase --abort
git stash drop
# 重新跑 script 從乾淨狀態開始
```

### D. Push 後驗證

```powershell
# 等 1-2 分鐘 deploy 完
python scripts/verify_coverage.py

# 或 curl 驗 deploy URL
curl https://taiwan-stock-scanner.pages.dev/data/stocks.json -o nul
```

如果 fail → 立即 reset + force push，不要等 user 看到才回報。

---

## TODO / 開放項目（5/9 結束時）

- [ ] **Lemon Squeezy / Polar / Paddle 申請被拒** — Polar 因「stock screening for investing」被拒、appeal 也駁回；Paddle / Lemon 還沒試。考慮 Stripe 直收（自己處理 VAT，TradingView / Finviz 模式）。
- [ ] **觀察期**（5/10、5/11）：跑 verify_coverage.py 看雲端 cron 各項涵蓋率是否穩定 ≥ 95%
- [ ] **修 fetch_financials.py 的 should_refresh_revenue throttle** — 對「新加股票」可能誤判跳過（task #36 衍生）
- [ ] **Yahoo 月營收 fetcher unit test** — 今天 Yahoo HTML 改一次（table → inline JSON），未來 Yahoo 又改我們會炸
- [ ] **post-deploy 驗證自動化**（task #39）— GitHub Actions 加 step 跑 verify_coverage.py，fail 自動 alert

---

## Lemon Squeezy 申請流程（給未來 session 參考）

**最新狀態**（5/9）：
- ❌ Polar：被拒「stock screening for investing 不在 acceptable use」+ appeal 駁回
- ⏸️ Lemon Squeezy：申請過程被 rate limit 卡住、未完成
- ⏸️ Paddle：要 KYB，當天沒走完
- 🔮 **下一步**：直接 Stripe（不是 MoR，要自己處理 VAT，但 TradingView / Finviz 都這樣做）

**Lemon Squeezy 是 Stripe 在 2024 年併購的子品牌**，policy 跟 Stripe 接近 → 應該能過 stock screening。下次重試時用 `holder-tracker-tw` / `twstockscanner` 等獨特 store URL（不要 `taiwan-stock-scanner`，可能被佔用）。

---

## 🔥 2026-05-08 完成的內容 — 手機 UI 大改造

從 master 分出 `feature/mobile-v2` 重構整個手機 UX，當天合回 master。Long iteration session，user 一邊試一邊調，最後成果穩定。

### 1. 3 Tab 底部導航（替代浮動按鈕／隱藏功能）

新元件 `MobileBottomNav.tsx`：fixed bottom，3 個 tab（族群／個股／篩選），用 inline SVG icons（lucide-style，自己畫，沒裝 icon 庫）：
- 族群：2x2 方格
- 個股：折線+箭頭
- 篩選：漏斗

`mobileTab` state 在 App.tsx，預設 `'stock'`。每次切 tab 自動 `setMobileDetailStockId(null)` 清掉 detail view。

### 2. 個股 tab：列表 ↔ Detail page 雙模式

**砍掉原本的 inline expand 設計**（user 試了不喜歡 — scroll anchoring 跟 sticky 對齊問題太多），改成：

```
list view (MobileStockList)
  ├─ sticky sort header bar（排序 dropdown / 漲幅期間 / 成交值期間 / N 筆）
  └─ MobileStockRow × N（dense 兩行：id+name+chip / 收·1Y·成交·YoY 點分隔）
      ↓ tap row
detail view (MobileStockDetail)
  ├─ sticky top bar（← 列表 / id name / group chip）
  ├─ sticky prev/next nav（◀ prev / idx/total / next ▶）
  ├─ summary block（大 delta% + 4 個 metric）
  ├─ MA toggle + K 線 + D/W/M
  ├─ Fundamentals 4 underline tab + bar/line chart（可兩指 pinch zoom）
  └─ 進場分析（折疊式按鈕，預設收）
      ↓ ← 列表
回到列表（restore scrollY，user 看到原本那筆 row）
```

App.tsx 的 `mobileDetailStockId` state + `listScrollY` ref：
- `openMobileDetail(id)`：記住列表 scrollY → setMobileDetailStockId
- `closeMobileDetail()`：requestAnimationFrame 後 restore scrollY

### 3. 篩選 tab：FiltersBar 全螢幕模式

`FiltersBar` 新增 `mobileFullscreen` prop。當 `mobileTab === 'filter'`，App 在 main 內 render `<FiltersBar mobileFullscreen resultCount onShowResults>`：

- Sticky header（篩選條件 N 項 + 清除全部）
- 4 sections（基本面 / 技術面 / 籌碼面 / 其他）跟桌機共用 `renderSection`
- Fixed 底部按鈕「查看 N 筆結果 →」（在 bottom nav 上方）
- 點底部按鈕 → `setMobileTab('stock')` 看結果

舊的 modal sheet mode 保留但**不再用**（向後相容，可未來移除）。

### 4. FilterBlock 卡片化（整理多列 chip filter）

技術面 section 內每個多列 filter（譬如「N 日內突破 MA」有 天數 + MA 週期 兩列 chips）原本的 layout 把 sub-label 散在中間/右邊，視覺亂。

新 helpers in FiltersBar.tsx：
- `FilterBlock` — 卡片 wrapper（標題 + 清除按鈕 + confirm/warning hint）
- `FilterSubRow` — 左 label 56px / 右 chips（grid 等寬對齊）
- `ChipButton` — 統一樣式

Refactor 4 個 block：maBreakout / maContinuation / maSustained / downtrendBreak。每塊 ~80 行 → ~30 行（淨減 −180 行）。

### 5. Fundamentals 局部 pinch zoom（不影響整頁）

User 一開始要「page-level pinch」，試了發現太粗暴（整頁變大切不回來）。改成 chart-only：

`FundamentalsPanel.tsx`：
- body `touch-action: pan-y` 阻擋 page-level pinch
- chart container `touch-action: none` 接管 touch event
- 兩指 pinch → 計算 distance 比例 → CSS `transform: scale(N)`，clamp 1-4 倍
- 單指 drag（scale > 1 時）→ pan offset 用 transform: translate
- 雙擊 reset；右上角「重置」按鈕 (scale > 1 時出現)

### 6. K 線 D/W/M tab + MA legend 字大 + 與日期軸間距

`CandlestickSVG.tsx`：
- D/W/M tab：rect 24×14 → 30×18，字 11→14，間距 28→34
- MA legend：rect 8×8 → 9×9，字 11→13
- `maLegendH` 20→32（給日期軸跟 legend 留 8-10px gap）
- `maLegendY` offset +14→+22

### 7. 整體字體調大

| 元素 | 原本 → 新 |
|---|---|
| Stock id (mono) | 14 → 15 |
| Stock name | 13 → 14 |
| Group chip（個股 row）| 9 → 10 |
| Delta % | 13 → 15 |
| Line 2 metrics | 10 → 12 |
| 族群 chip（GroupCard）| text-xs → text-sm |
| Fundamentals chart 字 | 已還原成原本 12（user 兩指放大就行，不用全 hardcode 大字）|

### 8. iOS Safari 修法（標準坑全踩過）

| 問題 | 修法 |
|---|---|
| input focus 自動 zoom 切不回來 | `@media (pointer: coarse) { input,select,textarea { font-size: 16px !important } }` |
| `position: fixed` 被 body `overflow-x: hidden` 破壞 | 不用 `overflow-x` 在 body，改用 `touch-action: pan-y` 鎖水平 swipe |
| `overflow-x: clip` 同樣會強制 `overflow-y: auto`，body 變 scroll container | 也不用 |
| Scroll anchoring 害展開時 page 跳 | html / body 都加 `overflow-anchor: none` |
| URL bar 遮 sticky | iOS Safari 標準行為，user scroll 一下 URL bar 就縮起來，沒額外解 |

### 9. 搜尋 / Refresh 按鈕 SVG 化

App.tsx 加 3 個 inline SVG icon component（`IconSearch` / `IconClose` / `IconRefresh`），跟 nav icon 同 lucide-style：
- 搜尋列左側放大鏡（取代 🔍 emoji）
- 搜尋列右側 X 清除按鈕（搜尋有內容才出現，點下去清空）
- Header 右上角 ⟳ 重新整理（28×28 → 36×36，loading 時 SVG 自旋 `animate-spin`）

### 10. GroupCard metrics 3 欄 grid

族群卡片的「均增持 / 週增金額 / 漲幅%」原本 flex-wrap 對齊不整齊。改 `grid grid-cols-3`，每欄上面是值（13px monospace 加粗）下面是 label（10px muted），等寬對齊。

### 11. 試了又 revert：嵌套 accordion（Commit 3）

族群 tab 展開後**內部用 MobileStockRow 列表取代桌機的 K 線 grid**。試了一版 user 不喜歡（覺得失去「掃 K 線視覺」的好處），revert 掉。族群 tab 在手機展開維持桌機原樣（K 線 grid）。

CLAUDE.md quirk #14 SOP 派上用場：用 `Edit` 工具一個一個 revert，**沒用 reset --hard**，安全。

---

## 💡 2026-05-08 用到的核心工程心法

### A. 大 refactor 用 phase 1（探索 + 痛點 + mockup） → phase 2（檔案計畫 + 行數預估） → phase 3（commit by commit）三階段

每階段拉 user 確認再走下一步。Phase 1 我提了 3 方案 + mockup 給 user 選。Phase 2 列要動的檔案 + 預估行數（~800 行新增）。Phase 3 分 4 commit 實作，每 commit 獨立可暫停。

### B. 不重寫結構只 swap 實作（同 5/07 心法）

用 `useIsMobile` hook + Tailwind `md:` class + React 條件 render，桌機 / 手機共用同一份 codebase。沒有獨立 mobile build。

### C. iOS Safari 量身訂做的不要碰 cross-cutting CSS

`overflow-x` 在 body / html 上根本不能用。`touch-action` / `scroll-behavior` / `overflow-anchor` 都要小心思考它們的副作用。出問題第一個懷疑這些。

### D. user 反饋的 scroll/sticky 怪事八成是 CSS containing block 問題

`position: fixed` 會被 ancestor 的 `transform` / `filter` / `contain` / `overflow:hidden` 破壞（變相對 ancestor 而非 viewport）。每次有人說「nav 浮在半空中」第一檢查這個。

### E. Specific git add 列檔名漏 add 兩次了

新 SOP：以後一律 `git add frontend/`（整個目錄掃），靠 .gitignore 擋雜訊。漏 add 比誤 add 出問題的次數多很多。

### F. user 反悔很正常，Edit 工具手動 revert > git reset --hard

當 user 說「我不喜歡這個更新」（譬如 Commit 3 嵌套 accordion），用 Edit 把改動回退到上一版即可，不要 reset --hard。Reflog 永遠是最後保險。

---

## 📋 2026-05-08 commit 清單（最後合進 master）

整個 mobile-v2 分支大概 20+ commits。最後 `git merge feature/mobile-v2 --no-edit` 進 master，commit hash `09581ba`（master）。重要 commit messages：

```
chore: gitignore dist and vite cache
feat(mobile): add bottom nav and isMobile hook
wip(mobile): scroll fix and sort auto-collapse
fix(mobile): touch-action lock and dual sticky detail headers
feat(mobile): wire detail page bottom nav search row scroll fab
fix(mobile): scroll-into-view on expand and sort dropdown
fix(mobile): proactive collapse before sort to avoid scroll anchoring
fix(mobile): scroll before expand for smoother transition
fix(mobile): minimal scroll only when row hidden behind sticky
debug(mobile): remove all auto-scroll on row toggle
fix(mobile): match GroupCard pattern - no auto-scroll on expand
refactor(mobile): replace inline expand with detail view and prev/next nav
fix(mobile): scroll detail view top into sticky bottom not document top
feat(mobile): sticky sort header reduced chrome and scroll-top fab
feat(mobile): full title search row turnover dropdown lock x-scroll
fix(mobile): use overflow-x clip and sticky detail header
fix(mobile): restore fixed sticky and group detail header rows
fix(mobile): touch-action lock and dual sticky detail headers
fix(mobile): proactive collapse before sort
feat(mobile): bigger fonts group sort tabs ios zoom fix sticky search
feat(mobile): tap fundamentals chart to open fullscreen zoom modal  ← 後來改 pinch
feat(mobile): pinch zoom kline tabs group chip font filter font
feat(mobile): groupcard metrics 3-col grid alignment
feat(mobile): stockrow line2 bullet separators with all labels
feat(mobile): replace bottom nav emoji with inline svg icons
feat(mobile): svg icons for search clear and refresh button
refactor(filters): card layout helpers and modal z-index fix
feat(mobile): full-screen filter tab replacing modal sheet
revert(mobile): rollback group tab nested accordion
```

迭代次數爆多 — user 邊用邊提需求的典型流程。

---

## ⚠️ 2026-05-08 接續待辦

### 立即（給下個 session）

- [ ] **`feature/favorites-v2` 同步**：當下分支還在 5/02 後沒合 master 過，要 sync：
  ```bash
  git checkout feature/favorites-v2
  git pull --rebase
  git merge master --no-edit
  git checkout --theirs frontend/public/data/ backend/db/
  git add frontend/public/data/ backend/db/
  git commit --no-edit
  git push
  ```
  Sync 完 favorites-v2 就有手機 UI + 5/8 之後的所有 cron 資料。

### 短期

- [ ] **舊 `feature/mobile-v2` 分支**：保留一週左右備查 reflog，再刪
- [ ] **手機版 production 視覺驗證**：master 上線後在真機 iPhone / Android 走完流程
- [ ] **`feature/favorites-v2` 把 Telegram 整套合 master**：看 favorites-v2 有沒有跟手機 UI 衝突，沒問題就合
- [ ] **GroupCard 嵌套 accordion 第二次嘗試**：user 說不喜歡只是初版 mockup，未來可以做更輕量版本（譬如族群 header 簡化 + 內部維持 K 線縮圖但更小）

### 長期

- [ ] **設定 tab**：底部 nav 目前 3 tab，未來把 Telegram 綁定 / VipPanel / StrategyManager 移到第 4 tab「⚙ 設定」（要等 favorites-v2 合 master 之後）
- [ ] **Service Worker / PWA**：手機 add to home screen 體驗
- [ ] **手機 K 線 pinch 體驗優化**：CandlestickSVG 自製 pinch 在手機上偶爾 jittery，可以調 sensitivity

---

## 📜 2026-05-07 完成的內容（歷史）

> 以下保留 5/07 那次 session 的完整濃縮 — institutional 改 Yahoo 主、抓轉折 filter v4、回撤均線 filter。

### 1. institutional 改 Yahoo 主來源（修 publish lag）

**事故起源**：5/6 user 發現 filter「近 1 日外資+投信買」抓到國巨 (2327)，但 5/6 國巨外資是賣超的。

**根因**：FinMind 5/6 法人資料 publish 晚於 Yahoo TW finance。當天 cron 17:08 跑時 FinMind 還沒 5/6 資料，但 Yahoo 已經有了。原邏輯 FinMind 撞 402 才走 Yahoo fallback；FinMind 回 200 OK 但內容是舊的（stale），不會觸發 fallback。

**修法**（`scripts/scrape_institutional.py`）：
- Yahoo **主來源**（先抓）
- Yahoo 沒到 expected publish date → 走 FinMind fallback
- FinMind 還在但角色變備援
- 結尾 log 改成「Yahoo N 支 / FinMind 補 N 支 / 跳過 N 支」

**效果**：每天 17:00 後跑 cron 都能抓到當日法人，不再 lag 一天。

---

### 2. 抓轉折 filter（v1→v4 大改 4 次，最後 XQ 量價合成法）

**v1 嘗試**：pivot-based（左右各 3 根更低）+ 嚴格遞減 lower-highs + ABC 條件 → **0 命中**（太嚴）

**v2 嘗試**：max-to-last pivot 連線 + 加突破 margin / 跌幅 → 7 命中含飆漲 outlier

**v3 嘗試**：線性迴歸法（XQ 文章 #1）→ 55 命中但抓到福壽這種 sideways（迴歸線被中間反彈拉低 → 偽「下降」）

**v4 採用**（user 接受）：XQ 量價合成法（XQ 文章 #2）：
- `kk[i] = kk[i-1] + (return × volume)` 累積量價合成指標
- `value1 = linregslope(kk, Length)` 長期斜率 < 0（下降中）
- `value2 = linregslope(kk, 5)` 短期斜率 > 0（近期反彈）
- 今日 close > **過去 N 日最高 high**（突破壓力位，不是趨勢線）
- 今日漲幅 ≥ 2%（強勢紅 K）

**chip 對應**：
- 「趨勢期間」(30/60/120) → Length（最大 60）
- 「壓力位」(3/4/5) → HighN 5/10/15 日

**關鍵差異 vs trendline 法**：用「過去 N 日 high」當 resistance level，不用畫趨勢線，避開 pivot 偵測 / regression line 偏低等噪音問題。

---

### 3. (曾)回撤均線 filter（取代費波那契）

**先嘗試** Fibonacci retracement（3 levels: 38.2/50/61.8%），但 user 覺得太複雜，**改用更直觀的 MA 回撤**。

**最終邏輯**（`utils/filters.ts` `passPullbackMa`）：
1. MA 朝上：今日 MA > 5 天前 MA
2. **今日 low ≤ MA**（盤中觸及或跌破）
3. **今日 close > MA**（收盤站回上方）
4. 過去 20 天最高 close > MA × 1.05（確認真的「漲過」再「拉回」）

**UI**：單排 chip「(曾)回撤均線」+ 均線 [關閉/5MA/10MA/20MA/60MA]

「(曾)」字暗示「今天盤中曾經觸及」。

---

## 💡 2026-05-07 用到的核心工程原則：「最少改動、最高效率」

這次連續做 5 個 filter 修改 / 嘗試，沒讓 code 變肥的關鍵：

### A. 不重寫結構，只 swap 實作
- 抓轉折 v1→v4：schema (`DowntrendBreakFilter`) **完全沒改**，只改 `passDowntrendBreak()` 函式體
- chip 值 `pivots: 3/4/5` 不動，**內部重新詮釋**為 HighN 5/10/15 日（差異藏在 `pivotsToHighN()`）
- UI label 文字改、底層 schema 不變 → 不會觸發 type cascading 改動

### B. 重複利用現有 helpers
- `calcLastMA(bars, period)` 已存在 → pullbackMa 直接用，不另寫
- `getBars(klines, id)` 已存在 → 所有新 filter 都用
- `linregSlope()` 寫一次給 downtrend break 用，pullbackMa / 其他可再用

### C. 不留垃圾
- 砍 Fib filter 時連根拔除（schema / OPTIONS / passFib / Python `_pass_fib` / UI block），不留 dead code
- 過時 const（如 `_FIB_MIN_UP_RANGE`）一起拔

### D. 改一個檔就走完一條 pipeline
每個 filter 改 5 個檔位置：
```
types/index.ts        → schema + DEFAULT + OPTIONS
utils/filters.ts      → pass function + applyFilters wire-in
App.tsx               → klineFiltersActive 加上去
FiltersBar.tsx        → UI block + setter functions + active count
user_filters.py       → Python 同步邏輯
```
有固定 checklist，不會漏。

### E. tsc + Python sanity test 雙保險
- 改完 frontend → `npx tsc --noEmit` 必跑
- 改完 Python → 寫 inline sanity test（make_bars + 5-8 個 case）必跑
- 全綠才 commit，不依賴 user 來測 bug

### F. push SOP 三層防呆（避免昨天那種事故）
- 單行短英文 commit message（避 Cloudflare UTF-8 bug）
- specific `git add` 列每檔（避漏 add）
- feature 分支 `merge --no-edit`（避 reset 砍歷史）
- `git pull --rebase --autostash`（race-safe，cron bot 同時 push 不會被擋）

---

## 📋 2026-05-07 commit 清單

```
6ba31f1?  fix(institutional): yahoo primary with finmind fallback (publish lag)
7156e52   feat: downtrend break filter and yahoo institutional fallback
d710f15   feat: pullback MA filter replacing fib
```

均同步到 `feature/favorites-v2`（merge --no-edit，未 reset）。

---

## ⚠️ 接續待辦（針對今天工作）

- [ ] **Yahoo HTML 結構穩定性**：institutional 改 Yahoo 主後，整個系統依賴 Yahoo TW 法人 inline JSON 結構。如果他們改設計就會 break。建議定期手動驗證 (`fetch_yahoo_institutional('2330')` 看回傳格式有沒有變)
- [ ] **dist/ + node_modules/.vite/ 加進 `.gitignore`**：每次 git status 都顯示 4-13 個 modified 雜訊，影響 review 體驗。已存在很久但沒清
- [ ] **PullbackMa 實戰驗證**：今天剛上，需要 user 連續觀察幾天命中清單品質
- [ ] **抓轉折 v4 vs v1 兩個邏輯**：v1 (pivot trendline) code 已被 v4 (kk 量價) 取代，但 v1 概念可能也有人喜歡。考慮未來給 chip 第三個選項切換邏輯

---



## 📜 2026-05-05 完成的內容（歷史）

### 1. 三個新 filter — 扣抵值 / 突破系列（技術面 section）✅

| Filter (key) | 邏輯 | UI |
|---|---|---|
| **N 日內突破 MA** (`maBreakout`) | 過去 N 個交易日（含今天）內，任一根 K 棒 close 由下往上 cross MA（`bar[i].c > MA(i) AND bar[i-1].c ≤ MA(i-1)`）→ 命中 | 兩排 chip：天數 [1/3/5/10/20] + MA 週期 [5/10/20/60/120] |
| **明日 MA 續揚 / 下彎** (`maContinuation`) | 扣抵值 = `bars[len - period].c`（明日將從 MA 窗口扣掉的 close）。`up` = 今日 close > 扣抵值 → 明日 MA 必上揚；`down` = 反向 | 兩排 chip：方向 [續揚▲/下彎▼] + MA 週期 |
| **未來 N 日 MA 易續揚** (`maSustained`) | 未來第 d 天扣抵值 = `bars[len - period + d - 1].c`。命中：每個 d 的扣抵值都 < 今日 close → 即使盤整 MA 也續揚 N 天 | 兩排 chip：天數 [3/5/10] + MA 週期 + ⓘ tooltip |

**命名教訓**：原本叫「未來 N 日 MA 不下彎」太武斷（user 反映），改成「易續揚」軟化但意思不變；tooltip 補上「即使每天小跌 1-3% 也撐住」明確化條件。

**Schema 都在 `types/index.ts`**，邏輯在 `utils/filters.ts` 跟 `scripts/screeners/user_filters.py` 同步（Python 8 + 15 個 sanity case 全 PASS）。

### 2. 240MA — 嘗試加進 chart 然後回退 ⚠️

- 一度幫 `CandlestickSVG.tsx` 加 240MA（slate `#94a3b8`），user 決定先不加 → revert
- 同時把 240 從 `MaAlignmentPeriod` / `MaDirectionPeriod` / `MaBreakoutPeriod` 三個 schema 拿掉（原本都含 240，但 chart 顯示不出來會誤導使用者選了沒辦法視覺驗證）
- `MA_ALIGNMENT_OPTIONS` / `MA_DIRECTION_OPTIONS` / `MA_BREAKOUT_PERIOD_OPTIONS` 同步精簡

### 3. Mobile-friendly ⓘ tooltip ✅

- 原本用 HTML `title=` 屬性 → 手機無 hover，使用者點不開
- 改寫成 `InfoPopup` component（在 `FiltersBar.tsx` 頂部）：
  - click-to-toggle，外點自動關閉（mousedown + touchstart 雙監聽）
  - **`position: fixed` + `getBoundingClientRect()` + viewport bounds clamp** — 不被父層 overflow 切、不衝出螢幕
  - 多行支援（`whiteSpace: 'pre-line'`）
  - 加大 tap target padding (`2px 4px`)
- 目前只用在「未來 N 日 MA 易續揚」一處，未來其他 filter 要加 tooltip 直接 `<InfoPopup text={...} />` 就行

### 4. 今天的 commit 列表

```
46037ad  feat(filters): add N-day MA breakout filter
59705a9  refactor(filters): drop 240MA from MA filter options
152b14d  ui(filters): rename sustained-trend filter to 易續揚
<sha>    feat(filters): add MA continuation and sustained-trend logic
<sha>    fix(filters): tooltip viewport-aware positioning
```

(後兩筆 hash 沒記到，看 `git log` 即可)

---

## ⚠️ 今天踩到的新坑（更新 quirks）

11. **Cloudflare Pages commit message UTF-8 bug** — 多行中文 commit message + 特殊字元（`<=`、全形括號）會讓 wrangler 在傳 Cloudflare API 時截斷在 multi-byte UTF-8 char 中間，部署 fail with `Invalid commit message [code 8000111]`。Firebase 那邊 OK，只 Cloudflare 中招。**SOP：以後 commit message 一律單行短英文**。修法：`git commit --amend -m "短訊息"` + `git push --force-with-lease`

12. **多檔 commit 容易漏 add** — 5 個檔的大 commit（types/utils/App/FiltersBar/Python）今天踩過：只 add FiltersBar 就 commit + push → master 上的 FiltersBar 引用還沒上去的 type → build 壞。**SOP：commit 前 `git status` 確認 staged 數**。修法：補 commit 把缺檔 push 上去就好

13. **localStorage `chartMaPeriods` 殘留** — 把 `ALL_MA_PERIODS` 中的某個值（如 240）拿掉後，舊使用者 localStorage 仍存著 `[20, 240]`。`MAToggleBar` iterate `ALL_MA_PERIODS` 不顯示 240 chip，但 `CandlestickSVG` 直接 iterate `maPeriods` state → 鬼魂 MA240 永遠在圖上、user 沒地方關掉它。臨時解：教使用者 console 跑 `localStorage.removeItem('chartMaPeriods'); location.reload()`。**長期 TODO**：`App.tsx` 讀 localStorage 時 filter against `ALL_MA_PERIODS`，暫未做（user 沒推 240MA 那版，影響只限我們測試帳號）

14. **🚨 災情：`git reset --hard master` 把 feature/favorites-v2 全砍掉** — 5/5 晚上踩到。當時 master 因 Cloudflare commit message bug 做了 amend force-push 換 hash，誤以為 feature 分支需要 `reset --hard master` 對齊。**結果 feature 上 95+ 個 commit（含 favorites/Telegram/strategies/migrations 全套）瞬間被覆蓋**。Cloudflare preview URL 也跟著掛。
    - 救援：`git reflog --all` 找出 `8232137` 是最後好狀態 → reset 回去 → 把 master 後續 8 筆 commit 一筆一筆 `git cherry-pick`（46037ad 已被 feature 自帶過，skip；其他乾淨套，preview-deploy.yml 一個 conflict 取 master 版） → build 驗證 → `--force-with-lease` 推回去
    - **長期 SOP（已寫進 CLAUDE.md quirk #14）**：分支同步**永遠用 `git merge master --no-edit`，不要用 `git reset --hard master`**。reset --hard 只能用在「要丟掉當前分支歷史」這種明確意圖。
    - 教訓：寫指令給 user 之前要先想清楚對方分支歷史是不是 superset。當時應該說 `git merge master --no-edit`（會做 merge commit 保留兩邊），而不是 reset。

---

## 📋 接續待辦（針對今天工作）

- [ ] **localStorage 防呆驗證**（quirk #13）— App.tsx 加 `validPeriods.has(x)` filter，未來再增刪 `ALL_MA_PERIODS` 不會出鬼魂
- [ ] **線上視覺驗證新三個 filter** — 5/5 push 後 user 還沒在 production 完整測過
- [ ] **commit message SOP 寫進 CLAUDE.md** — 避免下次 session 又踩 Cloudflare 那坑
- [ ] **Python 同步驗證** — 改天用 production stocks/klines 跑一次 `push_user_strategies.py --dry-run` 帶新 filter，確認 Telegram 推結果跟 web 一致

---



## 📜 2026-05-02 完成的內容（歷史，已上線）

> 以下保留 5/2 那次 session 的完整濃縮 — Telegram M3/M4、N 日漲幅 + 創新高 filter、4-section UI、TW 假日支援。後續所有功能都建在這個基礎上。

### A1. Telegram M3 — 前端綁定 UI（推播設定頁）✅

- **新元件 `frontend/src/components/SettingsPanel.tsx`**：全頁佈局（跟 VipPanel 同模式），3 張卡片 — VIP 狀態 + 通知頻道（Telegram 行）+ 通知類型（每日選股 placeholder）
- **入口**：header 在 GoogleSignInButton 旁加鈴鐺 SVG 按鈕（登入時才顯示）
- **新 hook `useTelegramBinding.ts`** + **新 API client `api/telegram.ts`** — 封裝 binding state + 3 秒輪詢自動偵測綁定完成
- **BindModal 內嵌 SettingsPanel**：code 顯示、複製、開啟 Telegram deeplink、倒數、輪詢狀態、>30s 提示
- **Telegram 安裝引導**：modal 上方加「請先安裝 Telegram 桌面/手機 app」提示 + 三個下載連結（桌面 / iOS / Android）— Telegram Web 的 START BOT 按鈕常常點不動
- **Webhook `/start <code>` deeplink**：functions/api/telegram/webhook.ts 改 `handleStart` 偵測 args，有 args 就 reuse `handleBind` → 一鍵綁定流程通

### A2. Telegram M4 — 個人化每日選股推播（path A + path B 都完工）✅

**path A — 本地版（`--source d1` 走 wrangler）：**
- `scripts/screeners/user_filters.py` — Python port of `frontend/src/utils/filters.ts`（applyFilters 完整對等）
- `scripts/push_user_strategies.py` — 主腳本：`wrangler d1 execute --remote` 撈 bindings + strategies → applyFilters → Telegram sendMessage（per chat_id）
- 訊息格式：`📊 你的每日選股 (YYYY/MM/DD 週X)` 標題、`🎯 策略名` + `✅ N 支符合 / ℹ️ 今日無符合`、`─────` 分隔、footer 含網址
- Flags：`--dry-run` / `--user EMAIL` / `--top N` / `--skip-empty` / `--source d1|endpoint`
- ✅ 本地測通：user Telegram 收到訊息 (sent=1 failed=0)

**path B — 雲端版（`--source endpoint` 走 HTTPS）：**
- `functions/api/internal/cron/bound-users.ts` — admin GET endpoint，回所有 bindings + strategies；用 `INTERNAL_CRON_TOKEN` Bearer 驗證
- push 腳本 `--source endpoint` mode：用 `PUSH_API_BASE` + `INTERNAL_CRON_TOKEN` env 打 HTTPS（不依賴 wrangler，CI 可跑）
- `.github/workflows/daily-push.yml` — workflow_dispatch + schedule（cron `'0 11 * * 1-5'` = 19:00 TW 平日）
- ✅ 已部署 + GitHub Actions 手動觸發測通 + cron-job.org 加好平日 19:00 排程

**環境變數（user 已在 3 處設好）：**
- `.env`（本地）
- Cloudflare Pages → Production + Preview
- GitHub Secrets

### A3. 新 filters — N 日漲跌幅 + 創 N 日新高 ✅

**Schema（`types/index.ts`）：**
```ts
NDayReturnFilter { days: 0|1|3|5|10|20, range: [lo, hi] }
NDayHighFilter   { days: 0|5|10|20|60|120|200 }
```
（FILTER_BOUNDS.nDayReturn = -10~50，DEFAULT_FILTERS 都加進去）

**前端即時算（讀 klines.json）：**
- `utils/filters.ts` — 加 `passNDayReturn` / `passNDayHigh`，applyFilters 接 `klines: KlinesById` 第 3 參數
- `useKline.ts` — 加 `getAllKlines()` 暴露整個 cache
- `App.tsx` — `klineFiltersActive` useEffect lazy 觸發 `loadFromJson()`（klines.json 6MB，一次性載入）
- `applyFilters` 重算 dep 加 `cacheVersion`（K 線 lazy-load 完會 bump）

**FiltersBar 重構（大改）：**
- 4 個 collapsible sections：📊 基本面 / 📈 技術面 / 💰 籌碼面 / 🏷 其他
- 默認全收起（user 偏好），展開狀態存 localStorage `filtersbar_open_sections_v1`
- 每個 section header 顯示 active count badge
- 全域「清除全部 (N)」按鈕在最頂端
- 桌機 + 手機 modal 共用同一套 collapsible 邏輯
- N 日漲幅 RangeSlider 寬度 cap 在 `min-w-[180px] max-w-[260px]`（不再 flex-1 撐滿）

**分類：**
- 基本面：市值、月營收 YoY、連續 YoY 成長、按季絕對值
- 技術面：今日成交量、N 日漲跌幅（新）、創 N 日新高（新）
- 籌碼面：大戶本週增持、連續買超
- 其他：市場別、產業 chips

**Python 端同步：**
- `scripts/screeners/user_filters.py` — 加 `_pass_n_day_return` / `_pass_n_day_high`，apply_filters 接 `klines` 第 3 參數
- `scripts/push_user_strategies.py` — load `klines.json` 一起傳進去

### A4. 國定假日 + 神秘金字塔對齊 ✅

**問題：** 5/1 勞動節 TWSE 沒交易，原 smart-skip `expected_trading_day` 直接 weekday 算 → 永遠覺得「該抓 5/1 但抓不到」一直重試。  
**還有：** 神秘金字塔（norway.twsthr.info）在「該週最後交易日 + 1 天」publish；正常週是 Sat，但假日 Fri 週會變 Fri publish — 原來的 7 天 rolling check 抓不到「應該提早一天 publish」。

**新模組 `scripts/trading_calendar.py`：**
- 用 `holidays` 套件（pip install holidays）— 自動含 2024-2030 所有 TW 假日
- `is_trading_day(d)` / `previous_trading_day(d)` — 跳過週末 + 假日
- `expected_latest_trading_day(now)` — K 線 / 三大法人 smart-skip 用，14:00 切換點
- `last_completed_trading_week_end(now, publish_hour=14)` — holdings smart-skip 用，**對齊 norway publish 節奏**（會偵測 holiday-Fri 週的早一天 publish）

**3 支 script refactor：**
- `run_pipeline.py` — `expected_latest_trading_day` 改 import 共用模組；holdings 從「7 天 rolling」改成「對齊 last_completed_trading_week_end」
- `update_klines.py` — `_expected_trading_day` 改 import 共用模組
- `scrape_institutional.py` — inline expected 計算改 import 共用模組

**Workflow yaml 改動：**
- `weekly-update.yml` 加 `IS_PUBLISH_DAY` 判斷：「昨天交易 + 今天非交易」→ mode=full（捕捉 holiday-Fri 那天）
- 加 `holidays` 進 `pip install` 步驟
- **新 schedule 11:30 平日 + Sat**（神秘金字塔 ~10:30 publish 後 1 小時）— user 要求
- 月營收 / 季財報 cron 從 14:43 改 **20:00**（user 要求）

**8 個測試案例全 OK：**
- Sat 5/2 12:00 → 4/30 ✅（Labor Fri 跳過）
- Fri 5/1 17:00 → 4/30 ✅（assumed publish 已過）
- Fri 5/1 10:00 → 4/24 ✅（pre-publish，回上週）
- Sat 5/9 14:30 → 5/8 ✅（normal Sat post-publish）
- Sat 5/9 10:00 → 4/30 ✅（normal Sat pre-publish）
- Mon 5/4 → 4/30 ✅
- Fri 5/8 17:00 → 4/30 ✅（normal Fri，pre-Sat-publish）
- Sun 12/27 → 12/24 ✅（12/25 Constitution Fri 假日週）

---

## 1. 當前 Git 狀態

**master**：所有今天功能都進去（最後 commit ~ `feat(schedule): holidays-aware holdings + 11:30 + monthly 20:00`）

**feature/favorites-v2**：已 merge master，含全套：
- 收藏 favorites
- ghost UI for stocks_archive.json
- VipPanel
- StrategyManager + 策略 D1
- Telegram 後端 endpoints + webhook + bot
- Telegram 前端 SettingsPanel + 鈴鐺
- 新 filters（N 日漲幅 + 創 N 日新高）
- collapsible sections
- TW holidays 支援

**Merge 過程**：master → feature/favorites-v2 有 70+ data file 衝突（klines/stocks.json 等），全用 `git checkout --theirs` 取 master；M4 scripts (push_user_strategies.py / user_filters.py) add/add 衝突也取 master superset；App.tsx 一個衝突手動合（feature 的 auth/Telegram/favorites + master 的 klines lazy load 兩邊都保留）。

---

## 2. 未完成 / 下個 session 待辦

### 立即 — 視覺驗證（user 還沒測線上）

- [ ] master：打開正式網站，點 N 日漲幅「5日」chip → 看是否 lazy-load klines.json + 滑桿生效
- [ ] master：點「20日新高」→ 看是否只顯示創新高股
- [ ] master：4 個 sections 全展開/收起 + localStorage 狀態跨重整保留
- [ ] feature/favorites-v2 preview：同上 + 設定頁、Telegram 綁定
- [ ] **儲存帶 N 日 filter 的策略**（StrategyManager）→ 跑 push_user_strategies.py → 看 Telegram 收到對的篩選結果

### 短期改善

- [ ] **Yahoo revenue fallback 啟用**：`fetch_monthly_revenue.py` 已寫好 `fetch_yahoo_revenue()` 函式但 0 成功率（猜的 HTML 結構抓不到 Yahoo TW 的 inline JSON）。要啟用：(1) PowerShell `curl.exe -A "Mozilla/5.0" "https://tw.stock.yahoo.com/quote/2330.TW/revenue" -o test.html` 抓樣本，(2) grep 出 inline JSON 的 revenue key pattern（仿 institutional 的 `institutionBuySell-100-day-{id}.{TW|TWO}`），(3) 修 fetch_yahoo_revenue 的 regex。目前預設 `--yahoo` 才啟用，安全
- [ ] **Telegram 推播訊息去重**：目前 push_user_strategies.py 沒做 hash 去重（`screeners/runner.py` 有），雲端 cron 多次觸發會重複推。可仿 runner.py 加 `last_user_push.json` cache（per-user hash）
- [ ] **D1 `last_push_at` 回寫**：endpoint 已預留欄位，腳本還沒呼 PATCH 更新 `last_push_at` / `last_push_status`。要新增 `POST /api/internal/cron/last-push` endpoint
- [ ] master 還沒併 telegram code（webhook、bind-code、binding endpoints、SettingsPanel）→ 等 favorites-v2 整套穩了再合過去 production；目前 telegram webhook 仍指 feature preview
- [ ] FiltersBar 默認全收起後，新使用者第一次來會看不到任何 filter — 觀察一陣子，如果太多人不知道有篩選器，考慮預設展開「基本面」一個 section

### 長期

- [ ] 設計更多策略 / 加更多 filter（user 提過想做：成交額、波動度、ETF 排除）
- [ ] Telegram bot 自動推播 + admin 統計（多少人綁了、推播成功率）
- [ ] 月底掃 cron 命中率（11:30 跟 20:00 兩個新 schedule 加進去後）

---

## 3. 已知 quirks（今天踩到的）

1. **Telegram Web 的 START BOT 點不動** — 切換 Telegram 帳號後尤其常見。Modal 上方已加引導文字提示用桌面/手機 app
2. **Cloudflare Pages env 改完不會 auto-redeploy** — 要 push commit 或 dashboard 手動 retry。SOP：改 env → push 一個 `--allow-empty` commit
3. **PowerShell 的 `set` 不是 cmd 的 `set`** — PS 設環境變數要 `$env:VAR = "..."`，不能 `set VAR=...`（後者只設 PS 變數）
4. **bash sandbox 對大檔（>~5MB 或 >300 行）會 truncate** — Read tool 看到的內容才是真檔案；webhook.ts、stocks.json、klines.json、run_pipeline.py 都中過。要在 bash 跑 Python 測試時，建議拆小檔或直接 inline 整段 code
5. **bash sandbox 偶爾把 `.git/index` 讀成 corrupt** — git 操作都在 Windows 跑
6. **跨分支 merge 時資料檔大量衝突** — 對策：`git checkout --theirs frontend/public/data/ backend/db/` 全取（master 的資料更新）
7. **cron-job.org 設定時忘了 PAT 是用同一個** — 重用 weekly-update 那條的 Bearer token 即可
8. **GitHub Actions workflow_dispatch UI 只在 default branch 的 yaml 顯示** — 我們把 daily-push.yml + 必要 scripts cherry-pick 到 master 才看得到
9. **Workflow 的 mode 判斷在 Sat 12:00 之外用 `IS_PUBLISH_DAY` 偵測** — 假日 Fri 那天 cron 自動切 mode=full（trading_calendar 判斷邏輯：昨天交易 + 今天非交易）
10. **YAML multi-line block 裡 inline python `-c "..."` 會帶縮排 → IndentationError** — 寫成單行 + `PYTHONPATH=scripts` 才行。例：`IS_PUBLISH_DAY=$(PYTHONPATH=scripts python3 -c 'from datetime ...; ...')`

---

## 4. 環境變數總覽

| 名稱 | 位置 | 用途 |
|---|---|---|
| `FINMIND_TOKEN` | .env / GH Secrets | 抓財報 + 法人 |
| `TELEGRAM_BOT_TOKEN` | .env / GH Secrets / Cloudflare Pages env | Bot API |
| `TELEGRAM_CHAT_ID` | .env / GH Secrets | admin alerts（pipeline log 推送）|
| `TELEGRAM_WEBHOOK_SECRET` | Cloudflare Pages env | 驗證 webhook 來源 |
| `TELEGRAM_BOT_USERNAME` | Cloudflare Pages env (Plaintext) | 給前端 deeplink |
| `INTERNAL_CRON_TOKEN` | .env / GH Secrets / Cloudflare Pages env | M4 admin endpoint 認證 |
| `PUSH_API_BASE` | .env / workflow yaml env | M4 endpoint URL（目前指 feature preview）|
| `GOOGLE_CLIENT_ID` | Cloudflare Pages env | Google ID Token 驗證 |
| `FIREBASE_SERVICE_ACCOUNT_TAIWAN_STOCK_SCANNER` | GH Secrets | Firebase deploy |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | GH Secrets | Cloudflare deploy |
| `USER_FAVORITES_TOKEN` | .env | （legacy，沒在用？）|

---

## 5. 排程總覽（目前狀態）

**weekly-update.yml（GitHub schedule）：**

| Cron (UTC) | TW 時間 | 用途 |
|---|---|---|
| `30 3 * * 6` | Sat 11:30 | 神秘金字塔 publish 後 1 小時拉資料 |
| `30 3 * * 1-5` | 平日 11:30 | 同上（IS_PUBLISH_DAY 偵測 holiday-Fri）|
| `0 4 * * 6` | Sat 12:00 | 主觸發備援 |
| `37 7 * * 1-5` | 平日 15:37 | K 線備援 1 |
| `37 8 * * 1-5` | 平日 16:37 | K 線備援 2 |
| `0 12 1-10 * *` | 1-10 號 20:00 | 月營收 YoY 更新 |
| `0 12 15 * *` | 15 號 20:00 | 季財報 + 自結補抓 |
| `0 10 * * 6` | Sat 18:00 | Sat 補跑 |

**daily-push.yml：**

| Cron | TW | 用途 |
|---|---|---|
| `0 11 * * 1-5` | 平日 19:00 | 個人化每日選股推播（M4 path B）|

**cron-job.org（user 設）：**

| 時間 | 觸發 |
|---|---|
| 平日 15:00 / 17:00 | weekly-update.yml dispatch |
| 平日 19:00 | daily-push.yml dispatch |

**本地 Windows Task Scheduler：**

| 時間 | 動作 |
|---|---|
| 平日 19:00 | `daily_screener.bat`（最後備援，僅 admin alert）|

---

## 6. 關鍵檔案地圖（更新版）

```
backend (Python pipeline):
  scripts/run_pipeline.py            — pipeline 入口（含 archive 寫入、K-line preserve、holidays smart-skip）
  scripts/trading_calendar.py        — 共用日曆模組（holidays 套件 + 公開函式）⭐ NEW
  scripts/update_klines.py           — K 線（用 trading_calendar）
  scripts/scrape_institutional.py    — 三大法人 + buy streak（用 trading_calendar）
  scripts/fetch_financials.py        — 月營收 + 季財報
  scripts/send_telegram.py           — admin alerts (TELEGRAM_CHAT_ID env)
  scripts/screeners/runner.py        — strategy 1/2 跑 admin Telegram
  scripts/screeners/user_filters.py  — Python port of frontend filters.ts ⭐ NEW
  scripts/push_user_strategies.py    — 個人化推播主腳本（--source d1|endpoint）⭐ NEW

functions (Cloudflare Pages):
  functions/_lib/google-auth.ts
  functions/_lib/telegram.ts
  functions/_lib/access.ts
  functions/_lib/limits.ts
  functions/api/favorites.ts
  functions/api/strategies.ts + strategies/[id].ts
  functions/api/telegram/
    bind-code.ts                     — POST 產 6 位 code
    binding.ts                       — GET / DELETE
    webhook.ts                       — bot 收訊息（含 /start <code> deeplink）
  functions/api/internal/cron/
    bound-users.ts                   — admin GET（INTERNAL_CRON_TOKEN）⭐ NEW

frontend (React):
  src/App.tsx                        — favorites mode + archive lazy-load + bell + showSettings + klines lazy
  src/components/SettingsPanel.tsx   — 推播設定全頁（VIP / 通知頻道 / 通知類型）⭐ NEW
  src/components/VipPanel.tsx
  src/components/StrategyManager.tsx
  src/components/StockTable.tsx + GroupCard.tsx — ghost row badge
  src/components/FiltersBar.tsx      — 4 collapsible sections（大改）
  src/api/telegram.ts                — Telegram API client ⭐ NEW
  src/hooks/useStocks.ts
  src/hooks/useKline.ts              — exposes getAllKlines()
  src/hooks/useFavorites.ts
  src/hooks/useGoogleAuth.ts
  src/hooks/useStrategies.ts
  src/hooks/useTelegramBinding.ts    — binding state + 3s poll ⭐ NEW
  src/utils/filters.ts               — 加 passNDayReturn / passNDayHigh

migrations:
  0001_init.sql                      — favorites
  0002_strategies.sql                — saved filter strategies
  0003_user_status.sql               — VIP/FREE tier
  0004_telegram.sql                  — telegram_bindings + telegram_bind_codes

.github/workflows/
  weekly-update.yml                  — 大幅擴充（11:30 schedule + IS_PUBLISH_DAY + holidays）
  daily-push.yml                     — 個人化推播 ⭐ NEW
```

---

## 7. 給下個 session 的開頭 Checklist

1. ☐ 讀 `CLAUDE.md` + 這份 `SESSION_HANDOFF.md`
2. ☐ `git log --oneline -15` 看最近 commits
3. ☐ `git status`、`git branch --show-current` 確認分支乾淨
4. ☐ user 想接視覺驗證、推播去重、其他？
5. ☐ 開始前看 `src/components/FiltersBar.tsx`（重構後 ~700 行）+ `src/components/SettingsPanel.tsx`（~500 行）熟悉新結構
6. ☐ 任何涉及 K 線即時計算的 filter，記得 `applyFilters` 第 3 參數要傳 klines map

祝順利 ⚡
