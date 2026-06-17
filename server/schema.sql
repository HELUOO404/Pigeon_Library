-- schema.sql — PigeonLib 同步后端数据表(契约见 docs/user-system-design.md §4)。
-- 启动时执行,IF NOT EXISTS 幂等。

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL UNIQUE,           -- 登录名,3–32 字符,大小写敏感
  pass_hash   TEXT    NOT NULL,                  -- bcrypt 哈希(含盐),绝不存明文
  role        TEXT    NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  disabled    INTEGER NOT NULL DEFAULT 0,        -- 0/1;禁用后不能登录
  created_at  INTEGER NOT NULL,                  -- epoch ms
  last_seen   INTEGER                            -- epoch ms,最近一次有效请求
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT    PRIMARY KEY,               -- 随机 256-bit 十六进制;作为 cookie 值
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL                   -- epoch ms;过期即失效
);

-- 每用户 × 每课程 × 每 slot 一行;data_json 是该 slot 的整块 JSON。
CREATE TABLE IF NOT EXISTS user_state (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   TEXT    NOT NULL,                  -- 课程 id('__global__' 表示站点级,如 theme)
  slot        TEXT    NOT NULL,                  -- progress|quiz|wrong|studyTime|theme|localCourses
  data_json   TEXT    NOT NULL,                  -- 该 slot 的 JSON 字符串
  updated_at  INTEGER NOT NULL,                  -- epoch ms;LWW 比较键
  PRIMARY KEY (user_id, course_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_state_user ON user_state(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
