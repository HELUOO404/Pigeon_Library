// db.js — node:sqlite(Node 内置)连接 + 建表 + 预备语句封装。
// 选用内置 node:sqlite 而非 better-sqlite3:免原生编译,装即用(契约见 user-system-design §0 说明)。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

// 旧库迁移:sessions 若缺 ip/user_agent 列则补
// (schema.sql 的 CREATE IF NOT EXISTS 不会给既有表加列;ALTER 幂等,见 user-system-design §12.1)。
const sessionCols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
if (!sessionCols.includes('ip')) db.exec('ALTER TABLE sessions ADD COLUMN ip TEXT');
if (!sessionCols.includes('user_agent')) db.exec('ALTER TABLE sessions ADD COLUMN user_agent TEXT');

// 旧库迁移:courses 若缺 description 列则补(课程简介,v1.3 引入)
const courseCols = db.prepare('PRAGMA table_info(courses)').all().map((c) => c.name);
if (!courseCols.includes('description')) db.exec('ALTER TABLE courses ADD COLUMN description TEXT');

// ---- users ----
export const users = {
  count: () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
  countAdmins: () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND disabled=0").get().n,
  byUsername: (username) => db.prepare('SELECT * FROM users WHERE username = ?').get(username),
  byId: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),
  create: ({ username, passHash, role, createdAt }) =>
    db.prepare('INSERT INTO users (username, pass_hash, role, created_at) VALUES (?, ?, ?, ?)')
      .run(username, passHash, role, createdAt),
  setPassword: (id, passHash) => db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(passHash, id),
  rename: (id, username) => db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, id),
  setDisabled: (id, disabled) => db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, id),
  setRole: (id, role) => db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id),
  touch: (id, ts) => db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(ts, id),
  listAll: () => db.prepare('SELECT id, username, role, disabled, created_at, last_seen FROM users ORDER BY id').all(),
};

// ---- sessions ----
export const sessions = {
  create: ({ token, userId, createdAt, expiresAt, ip, userAgent }) =>
    db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
      .run(token, userId, createdAt, expiresAt, ip ?? null, userAgent ?? null),
  byToken: (token) => db.prepare('SELECT * FROM sessions WHERE token = ?').get(token),
  delete: (token) => db.prepare('DELETE FROM sessions WHERE token = ?').run(token),
  deleteExpired: (now) => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now),
};

// ---- user_state ----
export const userState = {
  get: (userId, courseId, slot) =>
    db.prepare('SELECT data_json, updated_at FROM user_state WHERE user_id=? AND course_id=? AND slot=?')
      .get(userId, courseId, slot),
  byCourse: (userId, courseId) =>
    db.prepare('SELECT slot, data_json, updated_at FROM user_state WHERE user_id=? AND course_id=?')
      .all(userId, courseId),
  since: (userId, since) =>
    db.prepare('SELECT course_id, slot, data_json, updated_at FROM user_state WHERE user_id=? AND updated_at > ? ORDER BY updated_at')
      .all(userId, since),
  upsert: ({ userId, courseId, slot, dataJson, updatedAt }) =>
    db.prepare(`INSERT INTO user_state (user_id, course_id, slot, data_json, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, course_id, slot)
                DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at`)
      .run(userId, courseId, slot, dataJson, updatedAt),
  countRows: () => db.prepare('SELECT COUNT(*) AS n FROM user_state').get().n,
  topCourses: (limit) =>
    db.prepare(`SELECT course_id, COUNT(DISTINCT user_id) AS learners
                FROM user_state WHERE course_id != '__global__'
                GROUP BY course_id ORDER BY learners DESC LIMIT ?`).all(limit),
};
