# Session Handoff — 2026-05-02 晚

> 給下一個 Cowork session 用。先讀 `CLAUDE.md`（專案總覽），再讀這份（最近改動 + 待辦）。
> 這份是 2026-05-02 一整天（M3 + M4 + 新 filters + 假日支援）的濃縮。

---

## 🔥 立即接手任務

User 已經完成今天三大塊（M3 / M4 / 新 filters）。**目前有兩個分支同步**：

- **`master`** ← 最新基礎，所有今天的功能都進去了
- **`feature/favorites-v2`** ← 已 merge master，含收藏 + Telegram 完整套件

下個 session 直接從 **視覺驗證新 filters 在 production** 開始（task pending：user 還沒在線上點過 N 日漲幅 + 創新高），其他都已驗證通過。

---

## 0. 今天完成的 4 大塊

### A. Telegram M3 — 前端綁定 UI（推播設定頁）✅

- **新元件 `frontend/src/components/SettingsPanel.tsx`**：全頁佈局（跟 VipPanel 同模式），3 張卡片 — VIP 狀態 + 通知頻道（Telegram 行）+ 通知類型（每日選股 placeholder）
- **入口**：header 在 GoogleSignInButton 旁加鈴鐺 SVG 按鈕（登入時才顯示）
- **新 hook `useTelegramBinding.ts`** + **新 API client `api/telegram.ts`** — 封裝 binding state + 3 秒輪詢自動偵測綁定完成
- **BindModal 內嵌 SettingsPanel**：code 顯示、複製、開啟 Telegram deeplink、倒數、輪詢狀態、>30s 提示
- **Telegram 安裝引導**：modal 上方加「請先安裝 Telegram 桌面/手機 app」提示 + 三個下載連結（桌面 / iOS / Android）— Telegram Web 的 START BOT 按鈕常常點不動
- **Webhook `/start <code>` deeplink**：functions/api/telegram/webhook.ts 改 `handleStart` 偵測 args，有 args 就 reuse `handleBind` → 一鍵綁定流程通

### B. Telegram M4 — 個人化每日選股推播（path A + path B 都完工）✅

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

### C. 新 filters — N 日漲跌幅 + 創 N 日新高 ✅

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

### D. 國定假日 + 神秘金字塔對齊 ✅

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
