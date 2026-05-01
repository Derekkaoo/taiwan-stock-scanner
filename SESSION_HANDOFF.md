# Session Handoff — 2026-05-01

> 給下一個 Cowork session 用。先讀 `CLAUDE.md`（專案總覽），再讀這份（最近改動 + 待辦）。
> 這份是 2026-05-01 一整天 debug + 規劃討論的濃縮，加上整個專案從零到現在的演進歷程。

---

## 🔥 立即接手任務（continuation note，2026-05-01 下午追加）

> 第一個 cowork session 寫完 handoff 後，user 又開了第二個 cowork 嘗試做 Phase 1（VIP UI + access tier），但結果 UI 不滿意。已 stash 全部改動。第三個 cowork（你）的任務：**從 stash 救出後端架構，UI 從新規劃**。

### 當前狀態快照（不一致警告）

**Disk 上 commit**：`319b16a docs: add data-conflict prevention rules` （= 第一個 session 結束時的乾淨狀態）

**但 D1 production / local 兩邊都已經有 `user_status` 表**（user 在第二個 session 用 Cloudflare Console 跑 migration 建好了）：

```sql
CREATE TABLE user_status (
  uid TEXT PRIMARY KEY,
  email TEXT,
  tier TEXT NOT NULL DEFAULT 'FREE',
  vip_until INTEGER,
  trial_until INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
  updated_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
);
CREATE INDEX idx_user_status_tier ON user_status(tier);
```

**所以 D1 schema 跟 disk 上的 code 不一致**：表存在但沒人引用（無害，因為現有 code 走 hardcoded `WHITELIST_EMAILS`）。

### Stash@{0} 內容（第二個 session 的成果）

```
git stash list:
  stash@{0}: 新 session VIP UI 試做（不採用）
```

裡面有：

| 檔案 | 狀態 | 評估 |
|---|---|---|
| `migrations/0003_user_status.sql` | 新增 | ✅ 救（schema 已 deploy）|
| `functions/_lib/access.ts` | 新增 | ✅ 救（多 tier 系統，後端邏輯）|
| `functions/_lib/limits.ts` | 修改成 deprecation shim | ✅ 救（向後相容）|
| `functions/api/favorites.ts` | 改用 `getUserAccess` | ✅ 救（新 access 邏輯）|
| `functions/api/strategies.ts` | 改用 `getUserAccess` | ✅ 救 |
| `frontend/public/_redirects` | 新增（SPA fallback）| ✅ 救（之後 router 必需）|
| `frontend/src/App.tsx` | 改成 Router shell | ❌ 丟（user 不滿意）|
| `frontend/src/pages/MainPage.tsx` | 新增（從 App.tsx 搬出來）| ❌ 丟 |
| `frontend/src/pages/VipPage.tsx` | 新增（VIP 訂閱頁）| ❌ 丟（UI 不滿意）|
| `frontend/package.json` | 加 react-router-dom | ❌ 丟（先不裝 router）|
| `frontend/package-lock.json` | 同上 | ❌ 丟 |
| `frontend/node_modules/.vite/...` | build cache | ❌ 丟 |

### 第三個 cowork session 的 task list

**Step 1：選擇性 cherry-pick 後端檔案（從 stash）**

```powershell
# 從 stash 取出 6 個後端 / config 檔（UI 不取）
git checkout "stash@{0}" -- functions/_lib/access.ts
git checkout "stash@{0}" -- functions/_lib/limits.ts
git checkout "stash@{0}" -- functions/api/favorites.ts
git checkout "stash@{0}" -- functions/api/strategies.ts
git checkout "stash@{0}" -- migrations/0003_user_status.sql
git checkout "stash@{0}" -- frontend/public/_redirects

# 看一下
git status

# 用戶 review，沒問題就 commit
git add functions/_lib/ functions/api/favorites.ts functions/api/strategies.ts migrations/0003_user_status.sql frontend/public/_redirects
git commit -m "feat(access): multi-tier system + 0003_user_status migration (UI 待重做)"
git push

# Cherry-pick 到 master
git log -1 --pretty=format:"%H"
git checkout master
git pull --rebase
git cherry-pick <SHA>
git push
git checkout feature/favorites-v2
```

**Step 2：跑 typecheck 確保 imports 不爆**

```powershell
cd frontend
npx tsc --noEmit
cd ..
```

**Step 3：拋掉舊 stash**

```powershell
git stash drop "stash@{0}"
```

**Step 4：VIP UI 重新規劃（不要急著動 code）**

User 強調：
- ❌ **不要**直接寫 VIP page TSX
- ❌ **不要**裝 react-router-dom
- ✅ 先用文字描述 mockup（佈局、按鈕文字、互動）
- ✅ 等 user 同意設計細節，再動 code
- ✅ 整合方式：問 user「modal 還是 conditional render 還是新路由」（之前討論過，user 已同意 router 方案，但因為實作出包，這次重做時建議**先用 modal 或 conditional render**，比較簡單不需 router）

**Step 5：更新 CLAUDE.md 跟這份 SESSION_HANDOFF.md**

- 把 user_status 表寫進 CLAUDE.md「資料庫」段
- access.ts 提及在 CLAUDE.md「後端架構」
- 這份 handoff 第 11 節加入新 phase

### 給第三個 cowork 的提醒

1. **看 stash 內容前先讀這段交接附註**，知道哪些救哪些丟
2. **動 code 前先給 user 計畫**（user 強調過兩次，第二個 session 沒遵守導致 UI 改糟）
3. **不要嘗試重寫 daily_screener.bat**（之前 5 次都炸，CLAUDE.md 跟第 6 節 quirks 有警告）
4. **發現新 quirk 就更新這份 handoff doc**（讓未來 session 不再踩雷）

---

---

## 0. 專案演進時間軸（從零到現在）

> Derek 跟 AI（Claude / Cowork）合作從零打造這個專案。下面是按時序累積的功能與決定，每個 ✅ 都代表一段協作 session 的成果。

### Phase 1 — 篩選器 UI 基礎建設（4 月中）

✅ Filters 型別設計 + 預設值常數（`types/index.ts`）
✅ 分段刻度 helper（market cap、turnover 用對數刻度）
✅ RangeSlider 雙把手元件（共用所有區間篩選）
✅ IndustryChips 產業多選元件（預設折疊）
✅ FiltersBar（桌面 inline / 手機 modal 雙模式）
✅ useStocks hook 套用 filters
✅ 「我的最愛」⭐ 按鈕（純前端 localStorage）

### Phase 2 — 後端資料源 + 基本面篩選（4 月中下旬）

✅ `fetch_financials.py` 抓季財報 + 月營收（FinMind）
✅ Yahoo income-statement fallback scraper（FinMind 撞 quota 用）
✅ `update_klines.py` 加 volumes（千張單位）
✅ 前端加 fundamentals 絕對值 slider（毛利率 / 營利率 / EPS）
✅ 連續 YoY 成長篩選（共用 N 季 picker + 3 個 metric checkbox）
✅ 連續買超 pill row（外資 / 投信 1/3/5/20 天）

### Phase 3 — 每日選股策略 + Telegram 推播（4 月 25-26 日）

✅ `scrape_twii.py` 抓大盤 + 算 20/60 MA（多頭判斷）
✅ `update_klines.py` 加 pctOf52wHigh 欄位
✅ `screeners/base.py`（Strategy abstract + Stock dataclass）
✅ Strategy 1（5 條件 AND：突破前高、漲幅、量、股價、大戶）
✅ Strategy 2（13 條件多頭強勢，含連續買超 / 量價 / 基本面）
✅ `screeners/runner.py` 跑全部策略 + 推 Telegram
✅ `daily_screener.bat` + Windows Task Scheduler 19:00 排程

### Phase 4 — 雲端 cron 架構大改（4 月 26-27 日）

> 起因：GitHub Actions schedule 在熱門時段被跳過，連兩天 0% 成功率。

✅ `.github/workflows/weekly-update.yml` 完整 5-step pipeline
✅ cron-job.org 外部觸發（workflow_dispatch，>99.9% 觸發率）
✅ Permission 修正（repo Settings + workflow `permissions: contents: write`）
✅ Push 重試策略（5 次 retry + `-X theirs` 自動解衝突）
✅ Schedule SHA 卡舊版修復（`actions/checkout@v4` with `ref: master`）
✅ FinMind throttle 從 0.15s 調 0.5s（避免軟限流）
✅ Yahoo TW finance fallback for institutional（無 quota 限制）
✅ `runner.py` 加「同日 hash 不重推」邏輯

### Phase 5 — 三大法人 + 連續買超完整化（4 月底）

✅ `scrape_institutional.py` 抓三大法人 + smart-skip
✅ Buy streak 計算寫進 stocks.json
✅ Yahoo institutional fallback（FinMind 402 後接手）
✅ Smart-skip 邏輯：90% 涵蓋率門檻、1 小時 retry 視窗
✅ 前端 types + applyFilters 加 institutional 欄位

### Phase 6 — 收藏雲端同步基礎（4 月底 / 5 月初）

✅ Cloudflare D1 資料庫設置（`stock-scanner-favorites`）
✅ migration 0001：favorites table（user_token + stock_id）
✅ Pages Function `/api/favorites`（GET / POST / DELETE）
✅ 前端 useFavorites hook + 樂觀更新

### Phase 7 — 篩選 UI 大量優化 + K 線升級（5/1 上午）

✅ 搜尋擴展（id、name、group、groups[]、industry、subIndustries[]）
✅ K 線時間框架切換（日 90 / 週 60 / 月 36，狀態 localStorage）
✅ Pinch-to-zoom + pan（手機兩指縮放、單指拖曳；桌機滾輪 + 拖曳）
✅ Year on date axis（跨年度 K 線顯示年份，最左邊不顯示避免裁切）
✅ MA toggle 每張圖獨立但同步狀態（族群總覽 + 個股列表）
✅ 拿掉「60/155」神秘數字
✅ 修個股列表最左日期被裁

### Phase 8 — Google 登入 + 篩選策略雲端儲存（5/1 中午）

✅ Cloudflare Pages Functions 接 Google ID Token 自驗（無 firebase-admin）
✅ `functions/_lib/google-auth.ts`（Web Crypto API + JWKS）
✅ migration 0002：strategies table（user_uid + filters_json）
✅ Pages Function `/api/strategies`（GET / POST / PUT / DELETE）
✅ 前端 `useGoogleAuth` + `useStrategies` hooks
✅ `GoogleSignInButton`（自訂 dark-themed UI，覆蓋 GIS 預設按鈕）
✅ `StrategyManager`（下拉選單 + 儲存 / 覆蓋 / 改名 / 刪除）
✅ 收藏跨裝置同步（登入後用 Google sub 當 user_token + 一次性 migration）
✅ 行動版 Google 按鈕（icon-only 36×36）

### Phase 9 — 收藏 / 策略上限 + 白名單機制（5/1 中午）

✅ `functions/_lib/limits.ts`（FAVORITES=10, STRATEGIES=5）
✅ `WHITELIST_EMAILS`（後端 hardcode，前端看不到）
✅ 後端 POST 達上限 → 403 `limit_exceeded`
✅ `AlertModal` 元件（通用 icon + title + 雙按鈕）
✅ 「請先登入」modal（未登入點 ⭐ 觸發）
✅ 「⭐ 已達上限」modal（超過 10 收藏觸發）
✅ 「📂 已達策略上限」modal（超過 5 策略觸發）
✅ 「立馬登入」按鈕（觸發 `auth.signIn()` Google One Tap）

### Phase 10 — 行動版 UI 大修（5/1 中午）

✅ 篩選器全螢幕 modal（`100dvh` + `safe-area-inset-top`）
✅ Sticky title 不被 RangeSlider thumb 覆蓋（zIndex: 10）
✅ StrategyManager 深色主題（`appearance:none` + `colorScheme:dark`）
✅ 自訂下拉箭頭 SVG（避免瀏覽器原生白色）
✅ UUID fallback for non-secure context（手機 HTTP 訪問不再 crash）

### Phase 11 — 神秘金字塔大救援 + 通知系統（5/1 下午）

> 起因：早上手動觸發 cron 發現 norway 抓不到資料，連續好幾天都用舊資料。

✅ Headers 完整化（完整 Chrome UA + Accept-Language + 全套 Sec-Fetch headers + Referer）
✅ Cookie session 維持（先 GET 首頁拿 ASP.NET cookie）
✅ 3 次 retry with exponential backoff
✅ Cloudscraper fallback（GitHub Actions IP 段被擋時用）
✅ Multi-table merge with dedup（norway 把上市/上櫃拆兩張表）
✅ 拿掉 `br` 從 Accept-Encoding（沒裝 brotli decoder 會拿到亂碼）
✅ `HoldingsFetchError` 帶 5 種 kind（network / no_table / no_rows / parse_error / unexpected）
✅ Telegram 通知系統（成功 / 失敗 / 大戶降級三種訊息）
✅ Production 即時更新（cherry-pick + 手動 sync 到 master）

### 戰略討論（這次 session 做的決策）

🎯 VIP 訂閱定價：NT$128/月、288/季、888/年
🎯 朋友分級：FRIEND tier 解上限但**不解 push**（push 留給 VIP）
🎯 金流商選型：Paddle 為主（中文客服、MoR 處理稅務）+ Lemon Squeezy 備胎
🎯 試用期：14 天免綁卡 trial（不選 30 天，避免 user 適應免費版）
🎯 Push 通知設計：daily 收盤摘要 + 突破警示 + 大戶異動 + 個人策略命中

---

## 1. Session 開始時的問題

早上手動觸發 GitHub Actions 發現 norway.twsthr.info 抓不到大戶持股資料：

```
Error: 持股名單抓取失敗：403 Client Error: Forbidden
Warning: 使用舊資料：372 筆
```

這個 cron 已連續好幾天用舊資料（最新 2026-04-24，距今 7 天），但都沒人通知。

---

## 2. 解決過程（按時間軸）

### 2.1 Norway scraper 健壯化

**問題鏈**：headers 殘缺 → 加 cloudscraper → HTML 結構改了 → 兩張 table 要 merge → Brotli 沒裝。

最終解法（commits）：
- `a6c40a8 / 5bf58f7` — 完整 browser headers + Referer + 3 次 retry with backoff + multi-table dedup + 拿掉 `br` 從 `Accept-Encoding`（避免 brotli 解碼問題）
- `55aef89 / dcd499f` — cloudscraper fallback（GitHub Actions IP 段被擋時自動接手）
- `39abfba / 8b25a21` — `HoldingsFetchError` 帶 5 種 kind（`network` / `no_table` / `no_rows` / `parse_error` / `unexpected`）

### 2.2 Telegram 通知系統（P0）

`scripts/run_pipeline.py` 加了 `_notify_telegram()` 跟 `_notify_failure()`：
- **成功**：`✅ Pipeline 成功` + 持股數 + 資料日期 + 族群數
- **失敗**：`❌ Pipeline 失敗` + 階段 + 錯誤訊息
- **大戶降級**：`⚠️ 大戶持股抓取失敗` + 具體 kind label（網路 / 結構變動 / 解析失敗）

驗證指令（三個都收到 = 通過）：
```powershell
# 1. 成功通知（直接跑 pipeline）
python scripts/run_pipeline.py --force --skip-klines

# 2. 失敗通知（程式直接觸發）
python -c "import sys; sys.path.insert(0, 'scripts'); from run_pipeline import _notify_failure; _notify_failure('TEST', RuntimeError('test'))"

# 3. 大戶降級通知（程式直接觸發）
python -c "import sys; sys.path.insert(0, 'scripts'); from run_pipeline import _notify_telegram; from datetime import datetime; _notify_telegram('⚠️ <b>大戶持股抓取失敗</b>\n🔴 ...')"
```

### 2.3 Production 即時更新

cherry-pick scraper code 到 master + 直接 sync feature 上的最新資料到 master：
```powershell
git checkout master
git checkout feature/favorites-v2 -- backend/db/ frontend/public/data/
git commit -m "data: sync latest holdings from feature (norway 2026-04-30, 310 stocks)"
git push
```

---

## 3. 系統當前狀態（2026-05-01 結束時）

### 分支
| 分支 | 最新 commit | 內容 |
|---|---|---|
| **master** | `41a462c` | scraper fix + telegram 通知 + bat 補的 K 線資料更新（剛剛驗證 bat 用的）|
| **feature/favorites-v2** | `39abfba` | 同上 + Google 登入 + 篩選策略 + 收藏跨裝置同步 + AlertModal + 限制白名單機制 |

### feature/favorites-v2 比 master 多的功能（still in dev）
- Google 帳號登入（`useGoogleAuth.ts`、`GoogleSignInButton.tsx`）
- 篩選策略雲端儲存（`StrategyManager.tsx` + `/api/strategies` Pages Function + D1 `strategies` table）
- 收藏跨裝置同步（用 Google sub 當 user_token，未登入用 UUID）
- 收藏 10 / 策略 5 上限 + email 白名單繞過（`functions/_lib/limits.ts`）
- 「請先登入」「VIP 限制」AlertModal

要看 feature 多出來的所有 commits：
```powershell
git log master..feature/favorites-v2 --oneline
```

### 部署狀態
- **production**：https://taiwan-stock-scanner.pages.dev/（master deploy）— 顯示 2026-04-30 大戶資料 + 310 支股票
- **預覽**：https://feature-favorites-v2.taiwan-stock-scanner.pages.dev/（feature deploy）— 多了 Google 登入 + 策略儲存

---

## 4. 戰略討論（這次 session 的重要對話）

### 4.1 VIP 訂閱規劃（pending）

**已決定**：
- 收藏上限 10、策略上限 5（已實作 + 可白名單繞過）
- 朋友分級：FRIEND tier 解上限但**沒有 push**（push 留給 VIP）
- 較遠朋友走 discount code（Paddle / Lemon Squeezy 內建）

**還沒做**：
- D1 加 `user_status` 表（vip_until / trial_until）
- `_lib/access.ts` 取代現有 `limits.ts`（多 tier 系統）
- VIP 訂閱頁面 UI（mockup，未接金流）
- 預設策略市集（10 個專家策略，free 跟 vip 區分）

### 4.2 Push 通知（VIP 核心 feature）

**現有**：你個人的 Telegram bot 跑兩個策略 daily push（**只給你**，不給其他 user）

**規劃**：
- VIP user 綁定自己 chat_id（`/start <token>` 流程）
- daily summary（13:30 收盤後推 user 的 favorites 表現）
- 突破 / 跌破 MA20 警示
- 大戶異動（favorites 中本週增 ≥ 0.5%）
- 個人策略命中（user 自己存的策略每天跑）
- 大盤 ±1% 即時推

### 4.3 金流商選擇（pending user 申請）

**結論：Paddle 為主，Lemon Squeezy 當備胎**
- Paddle：5% + $0.50 / 多語言客服（含中文）/ 老牌 / 退款 UX 流暢
- 兩家都申請帳號（並行做）但只整合一家
- 個人開發者不開公司直接走 MoR（Merchant of Record），他們處理稅務發票

**理由**：用戶要求「客戶易聯絡、不能難找」，MoR 最符合。退款由 Paddle 處理，user 不用當 24/7 客服。

### 4.4 試用期策略

**選 14 天免綁卡 trial**（不是 30 天，不是綁卡 trial）。
理由：免費版已很完整，試用 30 天 user 反而適應免費；trial 結束推播停掉，FOMO 觸發訂閱。

---

## 5. 未完成 TODO（按優先順序）

### 短期（next 1-2 sessions）

| 優先 | 任務 | 預估工時 |
|---|---|---|
| 🔴 P0 | Phase 1：朋友分級系統重構（`_lib/access.ts` + D1 `user_status` 表 + tier check） | 0.5 天 |
| 🔴 P0 | VIP 訂閱頁面 UI（仿 Cowork 截圖那個 NT$128/288/888 三欄）— 不接金流 | 0.5-1 天 |
| 🟡 P1 | Telegram per-user 綁定流程（`/start <token>` → 寫進 D1 → user 自己拿 chat_id）| 1 天 |
| 🟡 P1 | Daily push cron：favorites + 個人策略命中通知 | 2 天 |
| 🟢 P2 | 預設策略市集（10 個寫死的專家策略）| 1 天 |
| 🟢 P2 | 申請 Paddle / Lemon Squeezy 帳號 | 並行做、1-3 天等審核 |

### 長期

- 接 Paddle webhook + checkout flow + cancel + 續訂處理（2-3 天）
- 公開 14 天 trial → 觀察轉換率
- 上正式訂閱

### 不急但要做

- bat 重寫成 PowerShell `.ps1`（cmd 太脆弱，今天嘗試 5 次都炸；當前 bat 能用但沒 master-switch / 沒 autostash）
- `.gitignore` 清理 UTF-16 亂碼殘留
- 把已 track 的 `__pycache__/*.pyc` 從 repo 移除

---

## 6. 已知 quirks（接手前要知道）

1. **cmd batch 對複雜流程容錯極差** — 加 if-block 內 echo 含括號、subroutine `:label`、中文 REM 都會炸。bat 改動要極保守。
2. **`crypto.randomUUID()` 在 HTTP non-localhost 會 throw** — 已修（用純 JS fallback）；若再加 secure-context-only API 要記得 fallback。
3. **GitHub Actions IP 段被 norway 擋** — 已加 cloudscraper fallback，但若 cloudscraper 之後也擋，最終 backup 是本機 daily_screener.bat 從家裡 IP 抓。
4. **Telegram 推播的 log 中文亂碼** — Windows cmd CP950 vs Python UTF-8 編碼。實際 telegram 是好的，只有寫 log 時被 cmd 重編碼。讀 log 用 `Get-Content -Encoding UTF8`。
5. **PowerShell 字面字符 `<>`** — 不能在指令裡打 `<placeholder>`，PS 會吃掉（當 redirect）。給 user 指令時用 PS 變數：`$SHA = "..."; git cherry-pick $SHA`。
6. **bat 在 feature 分支跑會 push 到 feature** — 沒做自動切 master 邏輯（嘗試過炸 5 次，現約定人工先切 master 再跑）。
7. **資料 commit 大量重疊 → 容易 rebase 衝突** — feature/master 兩邊都會自動 commit data。處理流程：用 `git checkout <branch> -- <paths>` 直接覆蓋而非 merge。

### 7.1 預防 data conflict 的規則（重要）

- **bat 永遠在 master 跑**：跑 `daily_screener.bat` 前先 `git checkout master`，跑完才切回 feature
- **feature 不 commit data**：純 code 開發，data 從 master 同步過來
- **每週 sync master → feature**（單向）：

```powershell
git checkout feature/favorites-v2
git fetch origin
git merge origin/master --no-edit
# 如有 data 衝突，全部用 master 版本：
git checkout origin/master -- frontend/public/data backend/db
git add frontend/public/data backend/db
git commit --no-edit
git push
```

- **永遠不要 `git merge feature` 進 master**（除非 feature 真的要 release）
- **跨分支同步 code 用 cherry-pick，不要 merge**（避免帶 data）

---

## 7. 環境設置驗證指令（新 session 開始前跑一次）

```powershell
# 1. 確認在正確路徑
cd C:\Users\Derek\Desktop\taiwan-stock-scanner\taiwan-stock-scanner
git branch --show-current

# 2. 確認 master 是最新
git checkout master
git pull --rebase
git log -3 --oneline
# 預期看到：
#   41a462c data: local backup auto-update
#   8b25a21 feat(scrape): HoldingsFetchError ...
#   1d9165c feat(notify): telegram alert ...

# 3. 切回 feature 繼續開發
git checkout feature/favorites-v2
git pull --rebase
git log -5 --oneline

# 4. 確認 telegram 還能用
python scripts/send_telegram.py "🤖 new cowork session test"
# 預期：你的 telegram 收到 "new cowork session test"

# 5. 確認 typescript 沒有 lint error
cd frontend
npx tsc --noEmit
# 預期：tsc exit: 0
cd ..
```

---

## 8. 給下一個 Cowork session 的接手 prompt

複製以下整段給新 session：

```
我是 Derek，台股篩選器（Taiwan Stock Scanner）的開發者。

請依序讀以下兩份文件了解完整專案背景，再開始任何工作：
1. C:\Users\Derek\Desktop\taiwan-stock-scanner\taiwan-stock-scanner\CLAUDE.md
   （專案總覽：架構、資料流、排程、已知 quirks）
2. C:\Users\Derek\Desktop\taiwan-stock-scanner\taiwan-stock-scanner\SESSION_HANDOFF.md
   （2026-05-01 上一個 session 的完整紀錄 + 戰略討論 + 待辦清單）

讀完後請回我：
- 簡短摘要你理解的「目前系統狀態」（master 跟 feature 各自狀態 / 最近完成的事）
- 下一步建議優先做什麼（看 SESSION_HANDOFF.md 第 5 節 TODO）

不要直接動 code 或下指令，先確認背景對齊。

我目前在 feature/favorites-v2 分支。今天可能想做的事：
[TBD — 開新 session 時告訴 Claude 你今天想做什麼]
```

---

## 9. 重要檔案 quick reference

```
backend/
  └── db/                              # JSON cache（不直接給前端）
      ├── financials.json              # 季財報
      ├── monthly_revenue.json         # 月營收
      ├── institutional.json           # 三大法人 30 天滾動
      ├── twii.json                    # 大盤
      └── last_telegram_push.json      # Telegram 去重 hash

frontend/
  ├── src/
  │   ├── App.tsx                      # main 元件，串接所有功能
  │   ├── components/
  │   │   ├── FiltersBar.tsx           # 桌面 inline / 手機 modal 篩選器
  │   │   ├── StrategyManager.tsx      # 策略 CRUD UI（feature only）
  │   │   ├── GoogleSignInButton.tsx   # 自訂 dark-themed Google 登入（feature only）
  │   │   ├── AlertModal.tsx           # 通用提示型 modal（feature only）
  │   │   └── ...
  │   ├── hooks/
  │   │   ├── useStocks.ts             # 載入 stocks.json + 篩選排序
  │   │   ├── useFavorites.ts          # 我的最愛 + 跨裝置同步（feature only）
  │   │   ├── useStrategies.ts         # 策略 CRUD（feature only）
  │   │   └── useGoogleAuth.ts         # Google 登入（feature only）
  │   ├── api/
  │   │   ├── favorites.ts             # /api/favorites client
  │   │   └── strategies.ts            # /api/strategies client（feature only）
  │   └── config.ts                    # GOOGLE_CLIENT_ID（feature only）
  └── public/data/
      ├── stocks.json                  # 主清單
      └── klines/*.json                # K 線（按族群拆檔）

functions/  (Cloudflare Pages Functions)
  ├── _lib/
  │   ├── google-auth.ts               # 自驗 Google ID Token (feature only)
  │   └── limits.ts                    # 收藏 / 策略上限 + 白名單 (feature only)
  └── api/
      ├── favorites.ts                 # 收藏 CRUD（master 也有，但 feature 多了 JWT 驗證）
      └── strategies.ts                # 策略 CRUD（feature only）

scripts/
  ├── run_pipeline.py                  # 主 pipeline + telegram 通知
  ├── update_klines.py                 # 增量 K 線更新
  ├── scrape_twii.py                   # 大盤
  ├── scrape_institutional.py          # 三大法人 + buy streak
  ├── send_telegram.py                 # Telegram 通知 helper
  ├── debug_norway.py                  # 神秘金字塔 debug 腳本（這次新增）
  └── screeners/
      ├── runner.py                    # 跑全部策略 + Telegram 推播
      ├── strategy1.py / strategy2.py
      └── base.py

migrations/
  ├── 0001_init.sql                    # favorites table
  └── 0002_strategies.sql              # strategies table（feature only，已 deploy 到 prod D1）
```

---

## 10. 環境變數 / Secrets 檢查清單

`.env` 應有：
```
FINMIND_TOKEN=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
USER_FAVORITES_TOKEN=...
```

GitHub Secrets（cron 用）：
- `FINMIND_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `FIREBASE_SERVICE_ACCOUNT_TAIWAN_STOCK_SCANNER`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Cloudflare：
- D1 binding `DB` → `stock-scanner-favorites` (id `7631cf70-84d4-477a-9627-9994a7806685`)
- Pages var `GOOGLE_CLIENT_ID = 225818828453-n5g26iet76lg8jngc4u6kujjlsp7fdih.apps.googleusercontent.com`

Google Cloud Console OAuth Authorized origins：
- `https://taiwan-stock-scanner.pages.dev`
- `https://feature-favorites-v2.taiwan-stock-scanner.pages.dev`
- `http://localhost:5173`
- `http://localhost:8788`

---

## 11. 給未來自己的話

今天從 09:00 debug 到 15:00 主要在「讓系統知道自己壞了」這個 meta 問題（之前是 user 手動觸發才發現失敗）。現在 telegram 通知機制完整，未來資料源變動 → 5 分鐘內收到通知，不用再經歷今天這種 6 小時 debug。

下次 session 應該回到正題：**做 VIP feature**。但記得不要忘了驗證 cron 真的能 work（明天看雲端有沒有自動跑 + 收到 telegram「✅ Pipeline 成功」）。

End of session 2026-05-01.
