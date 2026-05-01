-- 0002 schema: 使用者儲存的篩選策略
-- 設計：
--   user_uid     = Google ID Token 的 sub claim（穩定 user 識別碼）
--   user_email   = 顯示用，非識別
--   filters_json = 完整 Filters 物件 JSON.stringify

CREATE TABLE IF NOT EXISTS strategies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_uid      TEXT NOT NULL,
  user_email    TEXT,
  name          TEXT NOT NULL,
  filters_json  TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
  updated_at    INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
);

CREATE INDEX IF NOT EXISTS idx_strategies_user ON strategies(user_uid);
