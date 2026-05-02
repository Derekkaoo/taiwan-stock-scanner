-- 0004 schema: Telegram bot 綁定 + bind code
-- 設計：
--   user_uid             = Google ID Token sub claim（跟 strategies / favorites 一致）
--   chat_id              = Telegram 聊天 id（私訊 bot 的個人 chat）
--   username             = Telegram @username（顯示用，可能是空）
--   first_name           = Telegram first_name（顯示用，至少有這個）
--   bound_at / last_push_at / last_push_status：審計用
--
--   bind_code            = 6 位數一次性 code（隨機，過期或用過後刪掉）
--   expires_at           = unix ms；超過就視為過期
--
-- 一個 user 只能綁一個 chat（chat_id UNIQUE）；
-- 一個 chat 只能綁給一個 user（避免一支電話多帳號互踩）
-- 重新綁定時走 INSERT OR REPLACE（PRIMARY KEY 為 user_uid）

CREATE TABLE IF NOT EXISTS telegram_bindings (
  user_uid          TEXT PRIMARY KEY,
  user_email        TEXT,
  chat_id           TEXT NOT NULL UNIQUE,
  username          TEXT,
  first_name        TEXT,
  bound_at          INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
  last_push_at      INTEGER,
  last_push_status  TEXT
);

CREATE INDEX IF NOT EXISTS idx_telegram_bindings_chat ON telegram_bindings(chat_id);

CREATE TABLE IF NOT EXISTS telegram_bind_codes (
  code        TEXT PRIMARY KEY,
  user_uid    TEXT NOT NULL,
  user_email  TEXT,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
);

CREATE INDEX IF NOT EXISTS idx_telegram_bind_codes_user ON telegram_bind_codes(user_uid);
CREATE INDEX IF NOT EXISTS idx_telegram_bind_codes_expires ON telegram_bind_codes(expires_at);
