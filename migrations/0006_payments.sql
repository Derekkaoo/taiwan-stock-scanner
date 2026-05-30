-- 0006 schema: 訂閱訂單 (orders) + 扣款明細 (payments)
--
-- 設計：
--   orders   = 每位 user 每次訂閱建一筆（首期扣款成功才算正式生效）
--   payments = 每一期扣款都留一筆（首期 + 之後每月綠界自動扣款）
--   user_status (既有) = 真正控制 access 的權威來源，paid 後升 VIP + 設 vip_until
--
-- 為什麼分兩張表：
--   - orders 是「訂閱合約」的概念（卡綁哪張、目前狀態），固定 1 筆
--   - payments 是「扣款明細」（每月一筆），對帳用
--   - 退款 / 客訴查詢都要靠 payments.raw_payload
--
-- 流程：
--   1. user 按訂閱 → INSERT orders (status='pending')
--   2. ECPay ReturnURL 首期成功 → UPDATE orders SET status='paid', paid_at=..., gwsr=...
--                                  INSERT payments (is_first_period=1)
--                                  UPDATE user_status SET tier='VIP', vip_until=+1月/+1年
--   3. 之後每月綠界自動扣 → ReturnURL 再次打進來 → INSERT payments (is_first_period=0)
--                                                  UPDATE user_status SET vip_until=+1月/+1年
--                                                  UPDATE orders SET total_success_times++
--   4. user 取消 → 打綠界廢止授權 → UPDATE orders SET status='cancelled', cancelled_at=...
--                                  （vip_until 不動 → 當期到期前還是 VIP）
--   5. 退款 → 綠界後台退刷 → UPDATE orders SET status='refunded', refunded_at=...
--                          UPDATE user_status SET vip_until=now（立刻降回 FREE）

CREATE TABLE IF NOT EXISTS orders (
  merchant_trade_no       TEXT PRIMARY KEY,        -- 我們生的 20 字內單號，傳給綠界當 MerchantTradeNo
  user_uid                TEXT NOT NULL,           -- Google sub（同 strategies.user_uid）
  user_email              TEXT,                    -- audit 顯示用
  plan                    TEXT NOT NULL,           -- 'monthly' | 'yearly'
  amount                  INTEGER NOT NULL,        -- 首期金額（88 or 888）
  period_type             TEXT NOT NULL,           -- 'M' | 'Y'（綠界 PeriodType）
  period_frequency        INTEGER NOT NULL DEFAULT 1,
  period_times            INTEGER NOT NULL DEFAULT 99, -- 綠界 ExecTimes 上限：M=99, Y=9
  status                  TEXT NOT NULL DEFAULT 'pending',
                          -- 'pending'    建單但首期還沒扣成功
                          -- 'paid'       首期已扣，訂閱生效中
                          -- 'cancelled'  user 取消（廢止授權，但 vip_until 不動）
                          -- 'refunded'   退款（vip_until 拉回 now）
                          -- 'failed'     首期就扣失敗（從沒生效過）
                          -- 'expired'    訂閱自然到期且未續約
  ecpay_trade_no          TEXT,                    -- 綠界 TradeNo（首期成功才有）
  gwsr                    TEXT,                    -- 廢止授權 / 退款用
  auth_code               TEXT,                    -- 銀行授權碼（用戶查詢顯示）
  card4no                 TEXT,                    -- 卡末 4 碼
  card6no                 TEXT,                    -- 卡前 6 碼
  total_success_times     INTEGER NOT NULL DEFAULT 0, -- 累計成功扣款次數（首期 + 續期）
  next_charge_at          INTEGER,                 -- 預估下次扣款 unix epoch（給續約通知 cron 用）
  auto_renew_notified_at  INTEGER,                 -- 上次續約通知時間（避免重複通知）
  created_at              INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
  paid_at                 INTEGER,                 -- 首期付款成功時間
  cancelled_at            INTEGER,
  refunded_at             INTEGER,
  note                    TEXT                     -- 自由欄位（手動退款原因等）
);

CREATE INDEX IF NOT EXISTS idx_orders_user_uid ON orders(user_uid);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_next_charge_at ON orders(next_charge_at);

CREATE TABLE IF NOT EXISTS payments (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant_trade_no       TEXT NOT NULL,           -- FK to orders.merchant_trade_no（不寫 FOREIGN KEY，D1 預設關閉）
  ecpay_trade_no          TEXT,                    -- 綠界 TradeNo
  amount                  INTEGER NOT NULL,
  rtn_code                INTEGER,                 -- 綠界 RtnCode（1=成功，其他為失敗碼）
  rtn_msg                 TEXT,                    -- 綠界 RtnMsg（成功訊息 或 失敗原因）
  process_date            TEXT,                    -- 綠界 PaymentDate（yyyy/MM/dd HH:mm:ss 字串）
  total_success_times     INTEGER,                 -- 綠界 TotalSuccessTimes（這次扣完累計）
  is_first_period         INTEGER NOT NULL DEFAULT 0, -- 1=首期；0=後續每月續期
  raw_payload             TEXT,                    -- 整包 form-urlencoded 留底（對帳 + 客訴查證）
  created_at              INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
);

CREATE INDEX IF NOT EXISTS idx_payments_merchant_trade_no ON payments(merchant_trade_no);
CREATE INDEX IF NOT EXISTS idx_payments_rtn_code ON payments(rtn_code);
