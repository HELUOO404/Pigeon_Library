// db-bookshelf.js - per-user saved courses (bookshelf), keyed by course_key.
import { db } from './db.js';

export const bookshelfDb = {
  list(userId) {
    return db.prepare('SELECT course_key, added_at FROM bookshelf WHERE user_id=? ORDER BY added_at DESC').all(userId);
  },

  add({ userId, courseKey, now }) {
    return db.prepare('INSERT OR IGNORE INTO bookshelf (user_id, course_key, added_at) VALUES (?, ?, ?)')
      .run(userId, courseKey, now).changes;
  },

  remove(userId, courseKey) {
    return db.prepare('DELETE FROM bookshelf WHERE user_id=? AND course_key=?').run(userId, courseKey).changes;
  },

  has(userId, courseKey) {
    return !!db.prepare('SELECT 1 FROM bookshelf WHERE user_id=? AND course_key=? LIMIT 1').get(userId, courseKey);
  },
};
