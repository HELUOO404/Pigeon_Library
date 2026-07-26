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
  expires_at  INTEGER NOT NULL,                  -- epoch ms;过期即失效
  ip          TEXT,                              -- 登录时 req.ip(会话/安全面板用)
  user_agent  TEXT                               -- 登录时 UA(截断存储)
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

-- 审计日志:管理员每次变更操作留痕(契约见 docs/user-system-design.md §12.1)
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER NOT NULL,                  -- 执行操作的管理员 id
  actor_name  TEXT    NOT NULL,                  -- 冗余用户名(被删后仍可读)
  action      TEXT    NOT NULL,                  -- disable|enable|set_role|reset_pw|rename|delete|create|force_logout|reset_state
  target_id   INTEGER,                           -- 受影响用户 id
  target_name TEXT,                              -- 受影响用户名(冗余)
  detail      TEXT,                              -- 简短补充
  created_at  INTEGER NOT NULL                   -- epoch ms
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- ===== 课程广场 + 私人课程(契约见 docs/user-system-design.md §13)=====

-- 课级元数据 + 版本指针。文件级字段下沉到 course_versions。
CREATE TABLE IF NOT EXISTS courses (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_key         TEXT    NOT NULL,                 -- manifest.id(展示/进度/社交/书架关联键,可重复)
  title              TEXT    NOT NULL,
  subtitle           TEXT,
  description        TEXT,                             -- manifest.description(课程简介,详情弹窗展示)
  author             TEXT,                             -- manifest.author(原始创作者署名)
  publisher_name     TEXT    NOT NULL,                 -- 发布人(卡片 tag):用户课=上传者 username,内置=author
  category           TEXT,                             -- 预设分类枚举之一(非法回退「其他」)
  status             TEXT    NOT NULL DEFAULT 'private', -- private|pending|published|rejected(由版本推导维护)
  visible            INTEGER NOT NULL DEFAULT 1,       -- 公开列表展示开关，不改变审核状态
  cover_mode         TEXT    NOT NULL DEFAULT 'default', -- default|image|text
  cover_image        TEXT,                              -- 管理员图片封面 data URL，原图 <= 600 KB
  cover_text         TEXT,                              -- 管理员文字封面，1 至 6 个 Unicode 字符
  current_version_id INTEGER,                          -- 广场展示的「当前已发布版」(指向 course_versions.id,不设外键避免建表循环)
  latest_version_id  INTEGER,                          -- 最新上传版(可能 pending)
  created_at         INTEGER NOT NULL,                 -- epoch ms
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courses_owner  ON courses(owner_id);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);
CREATE INDEX IF NOT EXISTS idx_courses_key    ON courses(course_key);

-- 内置课程仍由前端常量提供离线默认值；本表只保存服务端在线时的元数据覆盖与隐藏标记。
CREATE TABLE IF NOT EXISTS builtin_course_overrides (
  course_key      TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  subtitle        TEXT,
  description     TEXT,
  author          TEXT,
  publisher_name  TEXT NOT NULL,
  category        TEXT,
  hidden          INTEGER NOT NULL DEFAULT 0,
  visible         INTEGER NOT NULL DEFAULT 1,       -- 公开列表展示开关，不改变审核状态
  cover_mode      TEXT    NOT NULL DEFAULT 'default', -- default|image|text
  cover_image     TEXT,                              -- 管理员图片封面 data URL，原图 <= 600 KB
  cover_text      TEXT,                              -- 管理员文字封面，1 至 6 个 Unicode 字符
  updated_at      INTEGER NOT NULL
);

-- 版本级文件(多版本核心)。文件落盘 server/data/courses/<courseId>/<versionId>.pigeon。
CREATE TABLE IF NOT EXISTS course_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version      TEXT,                                   -- manifest.version
  status       TEXT    NOT NULL DEFAULT 'private',     -- private|pending|published|rejected(本版自己的审核态)
  file_path    TEXT    NOT NULL,
  file_size    INTEGER NOT NULL,
  file_hash    TEXT,                                   -- sha256
  stats_json   TEXT,                                   -- {chapters,knowledgePoints,questions}(服务端解析,权威)
  cover_data   TEXT,                                   -- base64 缩略(卡片用,无图为空)
  cover_text   TEXT,                                   -- manifest.coverText(版本级默认文字封面)
  cover_text_checked INTEGER NOT NULL DEFAULT 0,       -- 旧包文字封面回填已处理(含无封面/失败)
  review_note  TEXT,                                   -- 拒绝原因
  reviewer_id  INTEGER,
  created_at   INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_versions_course ON course_versions(course_id);

-- 评分:每用户每课一条(可改),关联键 course_key。
CREATE TABLE IF NOT EXISTS course_ratings (
  course_key  TEXT    NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,                        -- 1..5
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (course_key, user_id)
);

-- 评论:先发后审,软删(status=hidden)。username 冗余存,删号后仍可显示。
CREATE TABLE IF NOT EXISTS course_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_key  TEXT    NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username    TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'visible',      -- visible|hidden
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_course ON course_comments(course_key, created_at);

-- 下载去重:每用户每课一条,统计 distinct 学习人数。
CREATE TABLE IF NOT EXISTS course_downloads (
  course_key  TEXT    NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_at    INTEGER NOT NULL,
  PRIMARY KEY (course_key, user_id)
);

-- 书架(收藏):每用户收藏一门课一条。
CREATE TABLE IF NOT EXISTS bookshelf (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_key  TEXT    NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_key)
);
