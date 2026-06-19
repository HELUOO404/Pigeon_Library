// db-social.js - ratings, comments and download dedup, all keyed by course_key.
import { db } from './db.js';

export const socialDb = {
  getSocial(courseKey, userId = null) {
    const agg = db.prepare(
      'SELECT COALESCE(ROUND(AVG(score), 2), 0) AS avgRating, COUNT(*) AS ratingCount FROM course_ratings WHERE course_key=?',
    ).get(courseKey);

    const myRating = userId
      ? (db.prepare('SELECT score FROM course_ratings WHERE course_key=? AND user_id=?').get(courseKey, userId)?.score ?? null)
      : null;

    const downloadCount = db.prepare('SELECT COUNT(*) AS c FROM course_downloads WHERE course_key=?').get(courseKey).c;
    const commentCount = db.prepare(
      "SELECT COUNT(*) AS c FROM course_comments WHERE course_key=? AND status='visible'",
    ).get(courseKey).c;

    return {
      avgRating: agg.avgRating,
      ratingCount: agg.ratingCount,
      myRating,
      downloadCount,
      commentCount,
    };
  },

  setRating({ courseKey, userId, score, now }) {
    let s = Math.round(Number(score));
    if (!Number.isFinite(s)) s = 1;
    s = Math.max(1, Math.min(5, s));
    return db.prepare(
      `INSERT INTO course_ratings (course_key, user_id, score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(course_key, user_id)
       DO UPDATE SET score = excluded.score, updated_at = excluded.updated_at`,
    ).run(courseKey, userId, s, now, now).changes;
  },

  listComments({ courseKey, before = null, limit = 20 }) {
    const size = Math.min(100, Math.max(1, limit | 0));
    const rows = before != null
      ? db.prepare(
        "SELECT id, username, body, created_at, user_id FROM course_comments WHERE course_key=? AND status='visible' AND id < ? ORDER BY id DESC LIMIT ?",
      ).all(courseKey, before, size)
      : db.prepare(
        "SELECT id, username, body, created_at, user_id FROM course_comments WHERE course_key=? AND status='visible' ORDER BY id DESC LIMIT ?",
      ).all(courseKey, size);

    const nextBefore = rows.length === size ? rows[rows.length - 1].id : null;
    return { items: rows, nextBefore };
  },

  addComment({ courseKey, userId, username, body, now }) {
    const text = String(body ?? '').trim().slice(0, 1000);
    if (!text) return null;
    const info = db.prepare(
      "INSERT INTO course_comments (course_key, user_id, username, body, status, created_at) VALUES (?, ?, ?, ?, 'visible', ?)",
    ).run(courseKey, userId, username, text, now);
    return { id: info.lastInsertRowid, username, body: text, created_at: now, user_id: userId };
  },

  commentById(id) {
    return db.prepare('SELECT * FROM course_comments WHERE id=?').get(id);
  },

  hideComment(id) {
    return db.prepare("UPDATE course_comments SET status='hidden' WHERE id=?").run(id).changes;
  },

  recordDownload({ courseKey, userId, now }) {
    return db.prepare(
      'INSERT OR IGNORE INTO course_downloads (course_key, user_id, first_at) VALUES (?, ?, ?)',
    ).run(courseKey, userId, now).changes;
  },
};
