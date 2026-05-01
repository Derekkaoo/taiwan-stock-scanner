-- 0003 schema: 使用者 tier / 訂閱狀態
--
-- 設計：
--   uid          = Google ID Token 的 sub claim（同 strategies.user_uid）
--   email        = 顯示用 + audit 用，非識別
--   tier         = 'FREE' | 'FRIEND' | 'TRIAL' | 'VIP'
--                  （沒紀錄 = FREE，不一定每個 user 都有 row → lazy 寫入）
--   vip_until    = unix epoch 秒；NULL 代表非 VIP / 未設過期
--   trial_until  = unix epoch 秒；NULL 代表沒給過 trial
--   note         = 自由欄位，給之後 admin tool 寫備註用
--
-- 注意：
--   1. 白名單朋友（FRIEND tier）目前直接 hardcode 在 _lib/access.ts，
--      不寫進這張表（避免每加一個朋友就要 SQL）。等之後接 admin UI 再 migrate。
--   2. tier 用 TEXT 不用 ENUM 是 D1（SQLite）相容性考量。
--   3. tier='FREE' 的 row 通常不會被寫入（lazy）；只有實際升 tier 時才 INSERT。

CREATE TABLE IF NOT EXISTS user_status (
  uid          TEXT PRIMARY KEY,
  email        TEXT,
  tier         TEXT NOT NULL DEFAULT 'FREE',
  vip_until    INTEGER,
  trial_until  INTEGER,
  note         TEXT,
  created_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
  updated_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
);

CREATE INDEX IF NOT EXISTS idx_user_status_tier ON user_status(tier);
