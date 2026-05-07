# Taiwan Stock Scanner — 專案總覽（給 Claude 看的）

> 這份文件給未來新 Cowork / Claude Code session 用。讀完這份就有完整背景，不用花時間摸索。
> **配合 `SESSION_HANDOFF.md` 一起讀** — 那份是最近 session 的詳細交接 + 待辦事項。
> 最後更新：2026-05-07（institutional 改 Yahoo 主來源避免 publish lag + 抓轉折 filter v4 量價合成法 + (曾)回撤均線 filter 取代費波那契）

## 一句話說明

台股篩選器 + 每日選股 Telegram 推播。前端 React 19 + Vite + Tailwind v4，部署 Firebase Hosting + Cloudflare Pages。後端 Python scripts 抓資料，雲端 GitHub Actions cron + 本地 Windows Task Scheduler 雙重排程。

## Tech Stack

| 層 | 技術 |
|---|---|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| 後端 | Python 3.11 (純 scripts，沒有 web server) |
| 資料庫 | JSON 檔（`backend/db/*.json`、`frontend/public/data/*.json`） |
| 部署 | Firebase Hosting + Cloudflare Pages（雙部署） |
| 收藏功能 | Cloudflare D1 |
| 排程 | GitHub Actions cron + Windows Task Scheduler（本地備援） |
| 推播 | Telegram Bot API |

## 資料來源

| 資料 | 主要來源 | 備援 | 額度限制 |
|---|---|---|---|
| K 線 / 收盤價 | TWSE OpenAPI | — | 無 |
| 大盤 TWII | Yahoo `^TWII` | — | 無 |
| 月營收 | FinMind | Yahoo income-statement | FinMind 600/hr |
| 季財報（毛利/營利/EPS） | FinMind | Yahoo income-statement | 同上 |
| 三大法人 | FinMind | Yahoo `/quote/{id}.{TW\|TWO}/institutional-trading` | 同上 |
| 大戶持股 | norway.twsthr.info（HTML 爬蟲） | — | 無 |

**FinMind token** 在 `.env`，cloud 在 GitHub Secrets。

## 資料夾結構

```
taiwan-stock-scanner/
├── frontend/                      # React app
│   ├── src/
│   │   ├── components/FiltersBar.tsx       # 主要篩選器 UI
│   │   ├── hooks/useStocks.ts              # 解析 stocks.json
│   │   ├── utils/filters.ts                # applyFilters 邏輯
│   │   ├── types/index.ts                  # StockRow / Filters 型別
│   │   └── App.tsx
│   └── public/data/
│       ├── stocks.json                     # 主清單（前端讀這個）
│       └── klines.json                     # K 線
├── backend/db/                    # 後端 cache（不直接給前端）
│   ├── twii.json                  # 大盤指數
│   ├── institutional.json         # 三大法人歷史（30 天滾動）
│   ├── financials.json            # 季財報快取
│   └── last_telegram_push.json    # Telegram 去重
├── scripts/                       # Python 抓資料
│   ├── update_klines.py           # K 線更新
│   ├── scrape_twii.py             # 大盤
│   ├── scrape_institutional.py    # 三大法人 (FinMind + Yahoo fallback)
│   ├── fetch_financials.py        # 月營收 + 季財報
│   ├── scrape_yahoo_financials.py # Yahoo 財報 fallback
│   ├── run_pipeline.py            # 編排所有 pipeline + smart-skip 判斷
│   ├── send_telegram.py           # Telegram 推播 helper
│   └── screeners/
│       ├── base.py                # Strategy abstract + Stock dataclass
│       ├── strategy1.py           # 5 條件選股
│       ├── strategy2.py           # 13 條件多頭強勢
│       └── runner.py              # 跑全部策略 + 推 Telegram
├── .github/workflows/
│   └── weekly-update.yml          # 雲端 cron + 部署
├── daily_screener.bat             # 本地 Windows 排程腳本
└── .env                           # FINMIND_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
```

## 排程架構

### 主力：cron-job.org → workflow_dispatch（最可靠）

外部 cron 服務打 GitHub API 觸發 workflow，不依賴 GitHub schedule（後者實測連兩天 0% 成功率）。

```
平日 (Mon-Fri):
  15:00, 17:00 TW   # 主觸發（精簡後）
```

設定值：
- URL: `POST https://api.github.com/repos/Derekkaoo/taiwan-stock-scanner/actions/workflows/weekly-update.yml/dispatches`
- Headers: `Authorization: Bearer <PAT>`, `Accept: application/vnd.github+json`
- Body: `{"ref":"master"}`
- PAT scope: `workflow`（含 repo），無到期日

### 第二層：GitHub Actions schedule（保險，有時會掛）

`.github/workflows/weekly-update.yml` 內定的 cron：

```yaml
平日 (Mon-Fri):
  15:37, 16:37 TW   # 2 個備援，補 cron-job.org 失敗的情境

週六:
  12:00 TW  # 完整 pipeline + 推 Telegram
  18:00 TW  # 補跑 (Telegram 去重)

每月 1-10 號:
  14:43 TW  # 完整 pipeline 更新月營收 YoY

每月 15 號:
  14:43 TW  # 季財報 + 自結補抓
```

**注意**：GitHub schedule 在熱門時段常被跳過。月初/月中的 full / financials mode 還是要靠這個觸發（cron-job.org 那 5 個只觸發平日 mode=klines）。

每次 workflow run 跑：
1. K 線更新（mode=klines/full/financials 看日期決定）
2. `scrape_twii.py`
3. `scrape_institutional.py`（含 FinMind → Yahoo fallback）
4. `screeners/runner.py`（跑策略 + 推 Telegram，hash 去重）
5. Commit data updates → push（retry 5 次 + `-X theirs` 衝突自動解）
6. Build frontend + deploy Firebase + Cloudflare

### 第三層：本地 Windows Task Scheduler（最後備援）

```
平日 19:00 TW: daily_screener.bat
  → git pull --rebase
  → update_klines, scrape_twii, scrape_institutional
  → screeners + Telegram (hash 去重，不會跟 cloud 雙推)
  → commit + push
```

設定方式（管理員 PowerShell）：
```powershell
$action = New-ScheduledTaskAction -Execute "C:\Users\Derek\Desktop\taiwan-stock-scanner\taiwan-stock-scanner\daily_screener.bat"
$trigger = New-ScheduledTaskTrigger -Daily -At 19:00
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "TaiwanStockDailyScreener" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest
```

### 容錯層級總計

```
平日一天觸發機會：
  cron-job.org × 5     ← 最可靠 (>99.9%)
  GitHub schedule × 5  ← 不穩 (今天 0%)
  本地 19:00 × 1       ← 看電腦狀態
  ───────────────────────
  共 11 次嘗試
任一成功 → 後續 smart-skip 秒過
```

## Frontend Filters

`FiltersBar.tsx` 的篩選器（桌面 inline / 手機 modal）：

- **價格 / 市值滑桿**（雙把手 RangeSlider）
- **成交量** (`volumes.d1`，單位「張」，piecewise scale 0~500000)
- **產業 chips**（多選，預設折疊）
- **大戶本週增持**（delta slider 0.1~5）
- **連續 YoY 成長**（B1 設計：共用 N 選擇器 + 3 個 metric checkbox）
- **按季絕對值**（季別 picker + 毛利率/營利率/EPS sliders）
- **連續買超 pill row**（外資 / 投信，1/3/5/20 天）

`utils/filters.ts` 的 `applyFilters()` 串聯所有 filter pipeline。

## Smart-skip 設計（關鍵邏輯）

每個資料抓取 script 都有 smart-skip 避免重複工作：

### `scrape_institutional.py` smart-skip

```python
1. 算 expected_latest_trading_day（TW 時區，14:00 切換點，週末回上週五）
2. 算 cache 中「達到 expected」的股票占比 coverage
3. 如果 coverage >= 90% → 跳過 FinMind，直接用 cache 重算 streak
4. 如果 cache 落後 + 1 小時內試過 → 仍跳過（FinMind 可能還沒 publish，省 quota）
5. 不然 → FinMind 主流程（throttle 0.5s/支）
6. FinMind 撞 402 → Yahoo fallback 接手剩餘股票（自動偵測 .TW / .TWO）
7. 寫 cache → enrich stocks.json（算 foreignBuyStreak / trustBuyStreak）
```

`--force` 旗標可繞過 smart-skip。

### `update_klines.py` smart-skip
看 `klines.json` 最後一根 bar 是不是預期最新交易日。

### `run_pipeline.py` smart-skip
最上層 orchestrator，呼叫 `check_what_needs_refresh()` 看哪些子 pipeline 該跑。

## Telegram 推播

`screeners/runner.py` 內建去重：
- 訊息內容 hash 後比對 `backend/db/last_telegram_push.json`
- 同日同 hash → 跳過推送
- 因此本地 + 雲端多 trigger 不會雙推

CLI flags:
- `--skip-telegram`: 不推（測試）
- `--force-telegram`: 強制推（無視去重）

## 常用 debug 指令

```bash
# 看 institutional cache 涵蓋率
python -c "import json; d=json.load(open('backend/db/institutional.json')); print('updated:', d['updated']); from collections import Counter; c=Counter(h[-1]['date'] for h in d['by_stock'].values() if h); [print(f'{k}: {v}') for k,v in sorted(c.items(), reverse=True)]"

# 看特定股票的 institutional 歷史
python -c "import json; sid='8028'; d=json.load(open('backend/db/institutional.json')); h=d['by_stock'].get(sid, []); [print(r) for r in h[-5:]]"

# 強制重抓 institutional
python scripts/scrape_institutional.py --force

# 測 Yahoo fallback 單支股票
python -c "import sys; sys.path.insert(0, 'scripts'); from scrape_institutional import fetch_yahoo_institutional; r=fetch_yahoo_institutional('8028'); print('count:', len(r) if r else 'None'); [print(' ',x) for x in (r[-5:] if r else [])]"

# 看 cloud bot commits
git log --oneline --author=github-actions --since="yesterday" -5

# 查 daily_screener.log 本地排程紀錄
type daily_screener.log | findstr /N "Run started"
```

## 已知 quirks（曾經坑過的）

1. **GitHub Actions schedule 不穩** — cron 常延遲 30 分鐘以上，偶爾整個跳過。所以排了 5 個冗餘時段 + 本地排程。
2. **Schedule SHA 卡舊版** — schedule 排程時 cache 住當下 master HEAD；被延遲時實際跑的還是舊 SHA。**解法**：`actions/checkout@v4` 加 `with: ref: master`（強制拿最新）。
3. **FinMind 軟限流** — 撞過 402 後會降速回應（5-6 秒/request 而不是直接拒絕）。**解法**：throttle 從 0.15s 調 0.5s + Yahoo fallback。
4. **Bot push 403** — repo Settings → Actions → Workflow permissions 預設可能是 read-only。**解法**：(1) 改成「Read and write permissions」並按 Save，(2) workflow yaml 內顯式聲明 `permissions: contents: write`（雙保險）。
5. **Push race condition** — 本地 push + cloud bot 同時 push 會撞。**解法**：commit step 加 retry 5 次 + `-X theirs` 衝突策略（資料檔以新抓的為準）。
6. **TPEx OpenAPI 廢了** — `/openapi/v1/tpex_3insti_daily_trade` 302 跳轉首頁。所以三大法人沒用 batch endpoint，走 FinMind + Yahoo per-stock。
7. **Yahoo TW finance 沒用 `__NEXT_DATA__`** — 資料藏在 inline JSON，找 key `institutionBuySell-100-day-{stock_id}.{TW\|TWO}`。
8. **Windows cmd 中文編碼坑** — `time` / `date` 顯示週幾用 cp950，`type ... | findstr` 對長行會炸。讀 JSON 一律加 `encoding='utf-8'`。`runner.py` 強制 stdout reconfigure 成 UTF-8 避免 emoji 推爆。
9. **`stocks.json` 沒 market 欄位** — 還沒辦法直接從 stocks.json 判斷上市/上櫃。要做這個 filter 之前要先補欄位（建議從 Yahoo 的 `exchangeName` 抓）。
10. **bat 跟 user push race** — 本地排程跑到 commit step 時，user 剛好同時 commit 同樣檔案，bat 的 `git diff --cached --quiet` 會誤判「沒變動」就 exit。資料還是會上去（被 user commit 帶上），但 bat 不會留下 `data: local backup auto-update` commit。
11. **Cloudflare Pages commit message UTF-8 bug** — 多行中文 commit message + 特殊字元（`<=`、全形括號）會讓 wrangler 在傳 Cloudflare API 時截斷在 multi-byte UTF-8 char 中間，部署 fail with `Invalid commit message [code 8000111]`。Firebase 那邊 OK，只 Cloudflare 中招。**SOP**：commit message 一律單行短英文（中文敘述放 PR / handoff）。修法：`git commit --amend -m "短訊息"` + `git push --force-with-lease`。
12. **多檔 commit 容易漏 add** — 5 檔以上的大 commit 容易漏 add（曾踩：FiltersBar 上去了 types/utils/App/Python 沒上去 → master build 壞）。**SOP**：commit 前 `git status` 確認 staged 數對。修法：補 commit 把缺檔再 push 一次即可。
13. **localStorage stale schema** — `ALL_MA_PERIODS` 增刪期數時，舊使用者 `chartMaPeriods` 可能存著無效值（如拿掉 240 後仍有 240 殘留），`MAToggleBar` 不顯示但 chart 還在畫鬼魂線。**SOP**：之後改 localStorage-driven 的 schema 時，加 valid set 過濾（App.tsx useState init 時 filter against `ALL_MA_PERIODS`）。臨時解：教使用者 console 跑 `localStorage.removeItem('chartMaPeriods'); location.reload()`。
14. **🚨 `git reset --hard master` 在 feature/favorites-v2 是地雷** — 2026-05-05 踩過：當 master 被 amend 換 hash 後，誤用 `git reset --hard master` 想「同步」feature 分支，結果 feature 自己 95+ 個 commit（favorites/Telegram/strategies/migrations）**全部被覆蓋**。靠 git reflog 才救回（找到 8232137 是最後好狀態，cherry-pick 8 筆 master 新 commit 還原）。**鐵律：分支同步永遠用 merge，不用 reset --hard，除非你 100% 確定要丟掉當前分支歷史**。
15. **FinMind 法人資料 publish 比 Yahoo TW 慢一天** — 2026-05-06 踩過：用戶看到 filter「近 1 日法人買」抓國巨但實際國巨當天外資是賣超。根因：cron 17:00 跑時 FinMind 還沒 5/6 資料、回 200 OK 但內容是 5/5 stale；原 fallback 邏輯只在 FinMind 撞 402 才走 Yahoo。**修法**：scrape_institutional.py 改 Yahoo 主來源（先抓 Yahoo），FinMind 變 fallback。**SOP**：scrape 完成後驗證 institutional.json 最後一筆日期 = expected_latest_trading_day，落差就警報。

## 工程原則（給未來 Cowork session 的修 code 心法）

每次 user 想加新 filter / 改現有 filter，遵循「**最少改動、最高效率**」：

### A. 不重寫結構，只 swap 實作
- 改 filter 邏輯時，**schema 不動**只改 pass function 函式體（用戶不覺得 chip 行為改變）
- 用「內部映射函式」(如 `pivotsToHighN()`) 重新詮釋既有 chip 值，避開 schema migration 痛苦
- 例：抓轉折 v1→v4 換了 4 種演算法，`DowntrendBreakFilter` schema 完全沒改

### B. 重複利用 helpers
- `calcLastMA(bars, period)`、`getBars(klines, id)`、`linregSlope()` 等已存在 → 新 filter 直接用，不另寫
- 真要新 helper 也寫成 module-level function 給未來 filter 用

### C. 不留垃圾
- 砍舊 filter 時連根拔除（schema / OPTIONS / pass function / Python 同步 / UI block / DEFAULT_FILTERS / klineFiltersActive）
- 過時 const 一起拔
- 不留 dead code（譬如 v1 邏輯被 v4 取代後就刪掉，不註解保留）

### D. 標準 pipeline（每個 filter 改 5 個檔位置）
```
frontend/src/types/index.ts       → schema + DEFAULT + OPTIONS const
frontend/src/utils/filters.ts     → pass function + applyFilters wire-in
frontend/src/App.tsx              → klineFiltersActive 加上去（如果用 K 線）
frontend/src/components/FiltersBar.tsx → UI block + setter functions + active count
scripts/screeners/user_filters.py → Python 同步邏輯（給 daily-push 用）
```
有固定 checklist，不會漏。漏一個 → 推上去 build 就壞 (踩過 2026-05-05)。

### E. tsc + Python sanity test 雙保險
- 改完 frontend → `npx tsc --noEmit` 必跑
- 改完 Python → 寫 inline sanity test（make_bars + 5-8 個 case）必跑
- 全綠才 commit，不依賴 user 來幫測 bug

### F. push SOP 三層防呆
- 單行短英文 commit message（避 Cloudflare UTF-8 bug — quirk #11）
- specific `git add <file1> <file2> ...` 列每檔（避漏 add — quirk #12）
- feature 分支用 `merge --no-edit`，**永不 reset --hard**（quirk #14）
- `git pull --rebase --autostash` 開頭跑（race-safe，cron bot 同時 push 不會擋）

## 分支同步 SOP（master → feature/favorites-v2）

每次 master 推完想同步到 feature/favorites-v2：

```bash
git checkout feature/favorites-v2
git pull --rebase                      # 拉 cron bot 的 data commits
git merge master --no-edit             # ✅ 安全：保留兩邊歷史
git push origin feature/favorites-v2
git checkout master
```

**絕對不要**：

```bash
git reset --hard master                # ❌ 會吃掉 feature 自己的 commits
git reset --hard origin/master         # ❌ 同上
```

**如果 master 被 amend / rebase / force-pushed 換了 hash**：
- feature 應該 `git merge master --no-edit`（會做 merge commit，OK）
- 或者 `git rebase master`（更乾淨但要小心 — 會 rewrite feature 的 commits）
- **不要** reset

**事故救援步驟**（如果不小心 reset 把分支搞掉）：

```bash
git reflog --all | grep "feature/favorites-v2"           # 找最後好狀態的 commit hash
git checkout feature/favorites-v2
git reset --hard <good_hash>                              # 救回
# 然後 cherry-pick 期間 master 多出來的 commit 一筆一筆套上
git log --oneline <good_hash>..origin/master
git cherry-pick <hash1> <hash2> ...
git push --force-with-lease origin feature/favorites-v2
```

reflog 預設保留 30 天（可設 90 天），所以**24 小時內發現幾乎都救得回**。

## 環境變數（`.env`）

```
FINMIND_TOKEN=<JWT>
TELEGRAM_BOT_TOKEN=<bot token>
TELEGRAM_CHAT_ID=<your chat id>
USER_FAVORITES_TOKEN=<uuid>
```

GitHub Secrets 也要設這些（雲端 cron 用）：
- `FINMIND_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `FIREBASE_SERVICE_ACCOUNT_TAIWAN_STOCK_SCANNER`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 分支策略

- `master`：production，所有資料/功能改動先進這裡
- `feature/favorites-v2`：收藏功能 + Telegram 改動的長期分支，需要定期 merge master
- `add-ga4`、`seo-setup`：暫時分支（用完可以刪）

每次 master 有重要改動，跑：
```bash
git checkout feature/favorites-v2
git merge master --no-edit
git push
git checkout master
```

## 關鍵設計決定（時間軸）

### 2026-04 中
- 設計多面向 filter（價格/市值/產業/連續 YoY/季別絕對值/連續買超）
- 加 Yahoo income-statement scraper 當財報 fallback（FinMind 撞額度時）
- 雙 deploy（Firebase + Cloudflare Pages）

### 2026-04-25 ~ 26
- 加每日選股 Strategy 1 (5 條件) + Strategy 2 (13 條件)
- Telegram 推播 + hash 去重
- 本地 daily_screener.bat + Windows Task Scheduler

### 2026-04-26 晚
- 重新設計 cron 架構：本地 + 雲端雙跑，雲端為主、本地備援
- 雲端 weekly-update.yml 加 TWII / 法人 / screener / Telegram steps
- runner.py 加同日去重邏輯

### 2026-04-27 全天大除錯
- 發現 GitHub Actions schedule 不穩（cron 沒觸發）
- 發現 bot push 403（permissions 從未設對）→ 修 workflow `permissions:` + repo settings
- 發現 schedule SHA 卡舊版 → 加 `ref: master`
- 發現 FinMind 軟限流 → throttle 調 0.5s
- 發現 smart-skip 用 max 誤判 → 改 90% 涵蓋率
- 發現 push race → 加 `-X theirs` 衝突解
- 完成 Yahoo TW finance fallback for institutional（無 quota，100 天歷史）
- 統一 timestamp 用 TW 時區

完整故障容錯到位，明天起 cron 自動更新應該真的可靠。

## TODO / 開放項目

- [ ] 加上市/上櫃 filter（要先在 stocks.json 補 `market` 欄位，可從 Yahoo `exchangeName` 取）
- [ ] 修 FinMind 外資分類口徑（目前把 `Foreign_Dealer_Self` 算進外資，跟 TWSE「外資不含外資自營商」口徑不一致；註解說「不含」但 code 算進去了）
- [ ] 評估 Yahoo fallback 在實戰運作狀況（明天起會看到）
- [ ] 月底掃一次 cron 成功率，看雲端 + 本地交叉備援的命中率

## 給未來 Cowork session 的指示

如果 user 來問問題或請求改動：
1. 先讀這份 `CLAUDE.md` 確認背景
2. 看 `git log --oneline -20` 知道最近改了什麼
3. 涉及 cron / pipeline → 看 `.github/workflows/weekly-update.yml` + `daily_screener.bat`
4. 涉及前端篩選器 → 看 `frontend/src/components/FiltersBar.tsx` + `utils/filters.ts` + `types/index.ts`
5. 涉及資料抓取 → 看對應的 `scripts/*.py`（特別注意每支都有 smart-skip）
6. 改 code 前先用 bash 驗證資料源（user 已經被「沒驗證直接改」坑過，**所以驗證 → 改 → 測 → push 是 user 偏好的流程**）
7. user 用 Windows，shell 是 cmd，注意中文編碼跟 `|` pipe 的特殊處理
8. user 偏好回 markdown / 表格 / 簡潔，避免冗長 prose
