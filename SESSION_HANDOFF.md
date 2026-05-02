# Session Handoff — 2026-05-02 晚

> 給下個 Cowork session 用。**第一件事：讀 `CLAUDE.md`（專案總覽）+ 這份。** 5 分鐘內掌握全貌。
> 這份濃縮 2026-05-02 一整天的工作（Plan E 收尾 + cron 瘦身 + Telegram 推播後端 M1+M2）。

---

## 🔥 立即接手任務

User 想繼續做 Telegram 個人推播功能。**M1 + M2 已完成並驗證通過**（/start 測試成功）。

下個 session 直接從 **M3：前端 Telegram 綁定 UI** 開始（task #71）。

驗證 /start 通過的證據：
- Cloudflare Real-time Logs 顯示 `Status: Ok` + `POST .../api/telegram/webhook`
- User 確認 Telegram 收到歡迎訊息

---

## 當前 Git 狀態

**分支**：`feature/favorites-v2`（HEAD 在 `8b59308 data: weekly auto-update` 之後又多了 telegram debug logs commit）

**branch 上的 telegram 相關 commits（從新到舊）：**
- `feat(telegram): M1+M2 — D1 schema, bind-code/binding/webhook endpoints`
- `debug(telegram): verbose logs to diagnose silent webhook failure`（最後一個 commit）

**master 已同步**（cherry-pick 過）：
- Plan E backend（single-fetch + archive write + K-line preserve）
- Cron 瘦身

**master 還沒有的東西**（仍在 feature/favorites-v2）：
- 前端 ghost UI（App.tsx ghost row + StockTable / GroupCard 顯示）
- 收藏 favorites 功能（前端）
- Telegram 後端 endpoints + webhook
- VipPanel.tsx
- 多層級 access tier

---

## 這個 session 完成了什麼

### Plan E（每週大戶資料只抓 ≥ 0.1%，掉出榜的最愛從 archive 撈舊資料）

- `scripts/run_pipeline.py` `fetch_holdings()`：從 dual-fetch 改回 single `growthrate=0.1`
- `scripts/run_pipeline.py`：`stocks.json` 寫完後 union 進 `frontend/public/data/stocks_archive.json`，每筆帶 `_lastSeenDate`
- `scripts/run_pipeline.py`：`refresh_financials(stock_ids)` 接受參數，只跑當週 310 支
- `scripts/run_pipeline.py`：klines/<group>.json 先讀舊檔再合併新資料，**保留 archive 股票歷史 K 線**
- `scripts/fetch_financials.py`：`run(stock_ids=None)` 接 optional 參數
- 一次性 bootstrap：把 `git show 76f0a73:frontend/public/data/stocks.json` 那 1746 支 union 進 archive（給歷史最愛收藏者）
- 前端 `App.tsx` / `StockTable.tsx` / `GroupCard.tsx` / `useStocks.ts`：lazy-load archive，ghost row badge「本週未入榜・資料 X 週前」
- `types/index.ts`：加 `_lastSeenDate?: string`

### Cron 排程瘦身

- `.github/workflows/weekly-update.yml`：平日從 5 個 cron 砍到 2 個（15:37、16:37）
- `CLAUDE.md`：同步排程說明
- 平日完整觸發 = cron-job.org 15:00 / 17:00 + GitHub schedule 15:37 / 16:37 + 本地 19:00 = 5 次

### M1+M2 — Telegram 推播後端 ✅ 已驗證 /start 通

- D1 migration `migrations/0004_telegram.sql`：`telegram_bindings` + `telegram_bind_codes` 兩張表
- `functions/_lib/telegram.ts`：`sendMessage()` + `generateBindCode()` + `escapeHtml()`
- `functions/api/telegram/bind-code.ts`：`POST` → 產 6 位英數字 code（10 分鐘 TTL）
- `functions/api/telegram/binding.ts`：`GET` 查狀態 / `DELETE` 解綁
- `functions/api/telegram/webhook.ts`：`POST` 處理 `/start`、`/bind <code>`、`/status`、`/unbind`、其他 → 提示
- `wrangler.toml`：加 `TELEGRAM_BOT_USERNAME=derek_taiwanstock_bot`
- 後續加 verbose log（`[webhook] secret matched` / `[sendMessage] sent ...`）方便 debug
- 已部署 + 已測試：`/start` 在 Telegram 跟 `@derek_taiwanstock_bot` 對話會收到歡迎訊息

### Cloudflare Pages 設定（已完成）

- D1 migration `0004_telegram.sql` 已執行
- Production **跟** Preview 兩邊都設了：
  - `TELEGRAM_BOT_TOKEN` (Secret)
  - `TELEGRAM_WEBHOOK_SECRET` (Secret)
  - `TELEGRAM_BOT_USERNAME` (Plaintext, derek_taiwanstock_bot)
  - `GOOGLE_CLIENT_ID` (Plaintext，原本就有)
- Telegram bot webhook 設好：`https://feature-favorites-v2.taiwan-stock-scanner.pages.dev/api/telegram/webhook`
  - 注意：用的是 **feature 分支的 alias URL**，因為 production master 還沒有 telegram code
  - 之後 telegram 整套要 deploy 到 production 時，再改回 `https://taiwan-stock-scanner.pages.dev/...`

---

## 未完成的事

### M3：前端綁定 UI（task #71）⏳ 下個 session 從這開始

設定面板要新增「Telegram 推播」區塊。建議實作：

1. **新元件 `frontend/src/components/TelegramPanel.tsx`**
   - 需要 props：`idToken: string | null`
   - 內部 state：`binding`（query 結果）、`code`（產的 bind code）、`showModal`

2. **流程：**
   ```
   未綁定 →「綁定 Telegram」按鈕
            → 點擊：POST /api/telegram/bind-code 拿 code
            → 開 modal 顯示 code + Telegram 開啟連結
            → 同時開始 polling GET /api/telegram/binding（每 3 秒）
            → 偵測到 bound:true → 關 modal + 顯示「已綁定」
            → polling 30 秒 timeout 顯示「未在限時內完成綁定」
   已綁定 → 顯示 @username + 上次推播時間 + 「解除綁定」按鈕
            → 點擊：DELETE /api/telegram/binding → 重新顯示綁定按鈕
   ```

3. **Telegram deeplink 格式：**
   ```
   https://t.me/<bot_username>?start=<bind_code>
   ```
   會自動開 Telegram 並帶 `/start <code>` — 但我們的 webhook 目前 handler 是 `/bind`。
   兩個選項：
   - A. 改 Telegram deeplink 為純 `https://t.me/<bot_username>` + 在 modal 顯示「複製 `/bind ABC123` 貼到對話」
   - B. 改 webhook 也接受 `/start <code>`（簡單：在 handleStart 內加參數解析）

   **建議 B**（一鍵流程更順）。

4. **Modal UI 範例：**
   ```
   ┌──────────────────────────────────┐
   │  綁定 Telegram                    │
   │                                  │
   │  你的綁定碼：                     │
   │  ┌────────────────┐              │
   │  │   ABC123        │  [複製]     │
   │  └────────────────┘              │
   │                                  │
   │  [📱 開啟 Telegram]               │
   │                                  │
   │  10:00 後過期 ・ 等待綁定...     │
   │                                  │
   │  [取消]                          │
   └──────────────────────────────────┘
   ```

5. **整合進現有 UI：** 推薦放在 StrategyManager.tsx 的下方或 App.tsx 的 settings panel 區。**user 是 free tier 也要能用**（不只 VIP）。

### M4：推播腳本（task #72）

`scripts/push_user_strategies.py`：

1. **取得綁定使用者：** 因為 Cloudflare D1 不能從 Python 直接讀，需要新建一個 admin endpoint：
   - `GET /api/internal/cron/bound-users`（用 `INTERNAL_CRON_TOKEN` env 驗證）
   - 回傳所有 `telegram_bindings` 加上每個 user 的 strategies
2. **Port `frontend/src/utils/filters.ts` → Python**：
   - applyFilters 的所有 condition：價格 / 市值 / 成交量 / 產業 / 連續 YoY / 季別絕對值 / 連續買超 / 市場別
   - 注意 normalizeRow 的轉換（千張→張）
3. **訊息格式（user 確認）：**
   ```
   📊 你的每日選股 (2026/05/02 週五)

   🎯 多頭強勢-50%留利
   ✅ 5 支符合
     • 2330 台積電  +5.4%  收 1190
     • ...

   ─────────────

   🎯 我的價值股
   ℹ️ 今日無符合

   ─────────────

   ⏱ 19:00 自動推播 ・ 共 N 套策略
   ```
4. **發送：** 走 Telegram Bot API `sendMessage(chat_id, text, parse_mode=HTML)`
5. **寫回 D1：** PATCH `last_push_at` 跟 `last_push_status`

### M5：排程（task #73）

驗證完才做。`daily-push.yml` workflow + cron-job.org 19:00（平日）。

---

## 架構決策（重要！別重做）

1. **Bot 重用**（不另開 bot）— admin alerts 跟 user pushes 都走 `@derek_taiwanstock_bot`，靠 `chat_id` 來源區分，**不會交叉**：
   - Pipeline 成功/失敗（`scripts/send_telegram.py` → `TELEGRAM_CHAT_ID` env，admin 個人 chat）
   - User 個人推播（`push_user_strategies.py` → 從 D1 拿每個 user 的 chat_id）

2. **Webhook secret token** — `TELEGRAM_WEBHOOK_SECRET` env 驗證 incoming `X-Telegram-Bot-Api-Secret-Token` header；不一致直接靜默回 200，避免被偽造

3. **訊息格式** — 一則訊息含所有策略，`─────` 分隔；空結果推「今日無符合」；只平日推

4. **觸發** — cron-job.org → workflow_dispatch（不靠 GitHub schedule，那個太不穩）

5. **策略上限** — Free 5、VIP 50（實質無上限）

---

## 已部署 / 測試狀態

| 項目 | 狀態 |
|---|---|
| Plan E backend | ✅ master + ✅ 雲端 cron 跑過 |
| Plan E frontend ghost UI | ✅ feature/favorites-v2 部署 + ⚠️ 未進 master |
| stocks_archive.json bootstrap | ✅ 已含 1746 支歷史股票 |
| Cron 瘦身 | ✅ master + ✅ 已生效 |
| Telegram M1 endpoints | ✅ 部署 preview |
| Telegram M2 webhook | ✅ 部署 preview + ✅ /start 測通 |
| Telegram M3 UI | ⏳ 未開始 |
| Telegram M4 push 腳本 | ⏳ 未開始 |
| Telegram M5 排程 | ⏳ 未開始 |

---

## 主要環境變數（Cloudflare Pages env）

| 名稱 | 型別 | 範圍 | 用途 |
|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Plaintext | Production + Preview | Google ID Token 驗證 |
| `TELEGRAM_BOT_TOKEN` | Secret | Production + Preview | Bot API token |
| `TELEGRAM_WEBHOOK_SECRET` | Secret | Production + Preview | 驗證 webhook 來源 |
| `TELEGRAM_BOT_USERNAME` | Plaintext | Production + Preview | 給前端 deeplink，目前 = `derek_taiwanstock_bot` |

---

## 已知坑（避免下個 session 踩）

1. **Cloudflare Pages env 改完不會 auto-redeploy** — 要 push commit 或從 dashboard 手動 retry。建議測試流程：改 env → push 一個 `--allow-empty` commit → 等 deploy
2. **Production 跟 Preview 的 env 是分開的** — 兩邊都要設，否則 preview URL 跑 function 時讀不到 secret
3. **PowerShell 的 `curl` 是 alias 不是真 curl** — API 測試用 `Invoke-RestMethod` 或 `curl.exe`（加 .exe）
4. **`Out-File -Encoding utf8` 在 PS5 還是會寫 BOM** — Python 讀要用 `utf-8-sig`，或用 Python subprocess 直接拿 git output
5. **bash sandbox 看 Windows 檔案有時 stale / 截斷**（CRLF/LF mount 問題）— 以 Read tool 看到的內容為準，Python syntax check 在 user 那邊跑
6. **Webhook URL 是 feature 分支 preview** — production master 還沒有 telegram code。alias URL `feature-favorites-v2.taiwan-stock-scanner.pages.dev` 永遠指最新的 preview deployment（穩定）
7. **Webhook silent failure** — webhook secret 不一致時，code 故意回 200（防偽造）→ Telegram 看到 200 以為成功，實際完全沒處理 message。debug 時看 Real-time Logs 找 `[webhook] secret mismatch!`
8. **cherry-pick 衝突避免法** — 跨 commit 改同一檔，建議直接 `git checkout <branch> -- <file>` 把整檔複製，不用 cherry-pick

---

## 關鍵檔案地圖

```
backend (Python pipeline):
  scripts/run_pipeline.py       — 所有 pipeline 入口（含 archive 寫入、K-line preserve）
  scripts/fetch_financials.py   — 月營收 + 季財報（accept stock_ids）
  scripts/scrape_institutional.py — 三大法人 + buy streak
  scripts/send_telegram.py      — admin alerts (用 TELEGRAM_CHAT_ID env)
  scripts/screeners/runner.py   — 跑 strategy 1/2 + 推 admin Telegram

functions (Cloudflare Pages):
  functions/_lib/google-auth.ts — Google ID Token 驗簽
  functions/_lib/telegram.ts    — Telegram Bot API helper（這次 session 新建）
  functions/_lib/access.ts      — 多層級權限（VIP/FREE/etc）
  functions/_lib/limits.ts      — favorites/strategies 上限邏輯
  functions/api/favorites.ts
  functions/api/strategies.ts + strategies/[id].ts
  functions/api/telegram/       — 這次 session 新建
    bind-code.ts                — POST 產 code
    binding.ts                  — GET status / DELETE 解綁
    webhook.ts                  — POST bot 收訊息（含 verbose debug log）

frontend (React):
  src/App.tsx                   — favorites mode + archive lazy-load
  src/components/VipPanel.tsx   — VIP 訂閱頁
  src/components/StrategyManager.tsx — 策略 CRUD（M3 要在附近加 TelegramPanel）
  src/components/StockTable.tsx + GroupCard.tsx — ghost row badge
  src/hooks/useStocks.ts        — normalizeRow exported（archive 也用）
  src/hooks/useFavorites.ts     — favorites D1 同步
  src/hooks/useGoogleAuth.ts    — Google login
  src/hooks/useStrategies.ts    — strategies CRUD via /api/strategies

migrations:
  0001_init.sql        — favorites
  0002_strategies.sql  — saved filter strategies
  0003_user_status.sql — VIP/FREE tier
  0004_telegram.sql    — telegram_bindings + telegram_bind_codes（這次 session）
```

---

## Telegram bot 測試用 PowerShell 指令（給驗證用）

```powershell
# 看 webhook 狀態
Invoke-RestMethod "https://api.telegram.org/bot<TOKEN>/getWebhookInfo" | Select-Object -ExpandProperty result | ConvertTo-Json

# 設 webhook（feature 分支 alias）
$body = @{
  url = "https://feature-favorites-v2.taiwan-stock-scanner.pages.dev/api/telegram/webhook"
  secret_token = "<SECRET>"
  allowed_updates = @("message")
} | ConvertTo-Json
Invoke-RestMethod -Uri "https://api.telegram.org/bot<TOKEN>/setWebhook" -Method POST -ContentType "application/json" -Body $body

# 直接測 webhook（不透過 Telegram，給開發測 endpoint）
$body = @{
  update_id = 1
  message = @{
    message_id = 1
    chat = @{ id = 12345; type = "private"; first_name = "Test" }
    from = @{ id = 12345; first_name = "Test" }
    date = 1234567890
    text = "/start"
  }
} | ConvertTo-Json -Depth 5
Invoke-WebRequest "https://feature-favorites-v2.taiwan-stock-scanner.pages.dev/api/telegram/webhook" `
  -Method POST -Body $body -ContentType "application/json" `
  -Headers @{ "X-Telegram-Bot-Api-Secret-Token" = "<SECRET>" }
```

---

## 下個 session 開頭 Checklist

1. ☐ 讀 `CLAUDE.md` + 這份 `SESSION_HANDOFF.md`
2. ☐ `git log --oneline -10` 看最新 commits
3. ☐ `git status` 確認分支乾淨
4. ☐ 確認 user 想接 M3 還是其他先
5. ☐ M3 開始前看 `src/components/StrategyManager.tsx` 跟 `src/hooks/useStrategies.ts` 學現有的 D1 endpoint pattern
6. ☐ 還有 task list（id 71-73 待做），跟 user 確認後開始 in_progress

祝順利 ⚡
