-- 初始 schema：favorites 表
-- user_token 是每個使用者的隨機 UUID（前端 localStorage 持有）
-- 目前單人用，未來商業化只要每個用戶有獨立 token 就能多人共用同表

CREATE TABLE IF NOT EXISTS favorites (
  user_token  TEXT NOT NULL,
  stock_id    TEXT NOT NULL,
  added_at    INTEGER DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
  PRIMARY KEY (user_token, stock_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_token);
