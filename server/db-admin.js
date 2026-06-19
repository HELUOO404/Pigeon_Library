import { db } from './db.js';
import { config } from './config.js';
import fs from 'node:fs';

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, '\\$&');
}

function count(sql, params = []) {
  return db.prepare(sql).get(...params).c;
}

function fileSize(path) {
  try {
    return fs.statSync(path).size;
  } catch {
    return 0;
  }
}

export const adminDb = {
  stats(now = Date.now()) {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const startOfToday = today.getTime();
    const day = 24 * 60 * 60 * 1000;

    return {
      userCount: count('SELECT COUNT(*) AS c FROM users'),
      adminCount: count("SELECT COUNT(*) AS c FROM users WHERE role='admin'"),
      disabledCount: count('SELECT COUNT(*) AS c FROM users WHERE disabled=1'),
      neverLoggedIn: count('SELECT COUNT(*) AS c FROM users WHERE last_seen IS NULL'),
      newToday: count('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', [startOfToday]),
      new7d: count('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', [now - 7 * day]),
      new30d: count('SELECT COUNT(*) AS c FROM users WHERE created_at >= ?', [now - 30 * day]),
      activeToday: count('SELECT COUNT(*) AS c FROM users WHERE last_seen >= ?', [startOfToday]),
      active7d: count('SELECT COUNT(*) AS c FROM users WHERE last_seen >= ?', [now - 7 * day]),
      active30d: count('SELECT COUNT(*) AS c FROM users WHERE last_seen >= ?', [now - 30 * day]),
      activeSessions: count('SELECT COUNT(*) AS c FROM sessions WHERE expires_at > ?', [now]),
      stateRows: count('SELECT COUNT(*) AS c FROM user_state'),
      courseCount: count("SELECT COUNT(DISTINCT course_id) AS c FROM user_state WHERE course_id != '__global__'"),
      dbBytes: fileSize(config.dbPath) + fileSize(`${config.dbPath}-wal`),
    };
  },

  listUsers({ q = '', role = '', status = '', sort = 'id', dir = 'asc', page = 1, pageSize = 20 } = {}) {
    const where = [];
    const params = [];

    if (q) {
      where.push("username LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(q)}%`);
    }
    if (role === 'user' || role === 'admin') {
      where.push('role = ?');
      params.push(role);
    }
    if (status === 'active') where.push('disabled=0');
    if (status === 'disabled') where.push('disabled=1');
    if (status === 'never') where.push('last_seen IS NULL');

    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const sortKey = ['id', 'username', 'created_at', 'last_seen'].includes(sort) ? sort : 'id';
    const sortDir = dir === 'desc' ? 'desc' : 'asc';
    const pageNum = Math.max(1, page | 0);
    const size = Math.min(100, Math.max(1, pageSize | 0));
    const offset = (pageNum - 1) * size;
    const total = count(`SELECT COUNT(*) AS c FROM users${whereSql}`, params);
    const users = db.prepare(
      `SELECT id,username,role,disabled,created_at,last_seen FROM users${whereSql} ORDER BY ${sortKey} ${sortDir} LIMIT ? OFFSET ?`,
    ).all(...params, size, offset);

    return { users, total, page: pageNum, pageSize: size };
  },

  userDetail(id, now = Date.now()) {
    const user = db.prepare('SELECT id,username,role,disabled,created_at,last_seen FROM users WHERE id=?').get(id);
    if (!user) return null;

    const sessionCount = count('SELECT COUNT(*) AS c FROM sessions WHERE user_id=? AND expires_at > ?', [id, now]);
    const courses = db.prepare(
      `SELECT course_id, COUNT(*) AS slots, MAX(updated_at) AS lastActivity, COALESCE(SUM(LENGTH(data_json)),0) AS bytes
       FROM user_state WHERE user_id=? GROUP BY course_id ORDER BY lastActivity DESC`,
    ).all(id);

    return { user, sessionCount, courses };
  },

  rename(id, username) {
    return db.prepare('UPDATE users SET username=? WHERE id=?').run(username, id).changes;
  },

  deleteUser(id) {
    return db.prepare('DELETE FROM users WHERE id=?').run(id).changes;
  },

  forceLogout(userId) {
    return db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId).changes;
  },

  resetState(userId, course) {
    const info = course === 'all'
      ? db.prepare('DELETE FROM user_state WHERE user_id=?').run(userId)
      : db.prepare('DELETE FROM user_state WHERE user_id=? AND course_id=?').run(userId, course);
    return info.changes;
  },

  courses() {
    return db.prepare(
      `SELECT course_id, COUNT(DISTINCT user_id) AS learners, MAX(updated_at) AS lastActivity,
              COALESCE(SUM(LENGTH(data_json)),0) AS bytes, COUNT(*) AS rows
       FROM user_state WHERE course_id != '__global__'
       GROUP BY course_id ORDER BY learners DESC, lastActivity DESC`,
    ).all();
  },

  sessionsList(now = Date.now(), limit = 200) {
    return db.prepare(
      `SELECT s.rowid AS sid, u.username, s.user_id AS userId, s.created_at, s.expires_at, s.ip, s.user_agent
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.expires_at > ? ORDER BY s.created_at DESC LIMIT ?`,
    ).all(now, limit);
  },

  revokeSession(sid) {
    return db.prepare('DELETE FROM sessions WHERE rowid=?').run(sid).changes;
  },

  writeAudit({ actorId, actorName, action, targetId = null, targetName = null, detail = null, now = Date.now() }) {
    db.prepare(
      'INSERT INTO audit_log(actor_id,actor_name,action,target_id,target_name,detail,created_at) VALUES(?,?,?,?,?,?,?)',
    ).run(actorId, actorName, action, targetId, targetName, detail, now);
  },

  listAudit(limit = 50) {
    return db.prepare(
      'SELECT id, actor_name, action, target_name, detail, created_at FROM audit_log ORDER BY created_at DESC LIMIT ?',
    ).all(limit);
  },

  trends(days = 14, now = Date.now()) {
    const rows = db.prepare(
      "SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch', 'localtime') AS d, COUNT(*) AS c FROM users GROUP BY d",
    ).all();
    const byDate = new Map(rows.map((row) => [row.d, row.c]));
    const span = Math.max(1, days | 0);
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);

    const registrations = [];
    for (let i = span - 1; i >= 0; i -= 1) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      registrations.push({
        day: `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        count: byDate.get(key) || 0,
      });
    }

    let total = count('SELECT COUNT(*) AS c FROM users') - registrations.reduce((sum, row) => sum + row.count, 0);
    const cumulative = registrations.map(({ day, count: c }) => {
      total += c;
      return { day, total };
    });

    return { registrations, cumulative };
  },
};
