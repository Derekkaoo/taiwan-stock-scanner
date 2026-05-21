-- 事件追蹤表（給 admin 分析 user 行為用）
--   - favorite_added / favorite_removed
--   - strategy_saved / strategy_updated / strategy_deleted / strategy_renamed
-- 隱私：不存 email / sub，只存 user_token（已 hash 過的 google:<sub> 或 raw uuid）

CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type   TEXT NOT NULL,             -- 'favorite_added' / 'strategy_saved' / etc
  user_token   TEXT NOT NULL,             -- google:<sub> 或 uuid（不暴露 email）
  stock_id     TEXT,                       -- 收藏事件用
  strategy_name TEXT,                      -- 策略事件用
  filters_json TEXT,                       -- 策略事件用（save / update 時 dump）
  created_at   INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_type_time ON events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events (user_token, created_at DESC);
