// db-courses.js - courses + course_versions CRUD and owner-facing analytics.
// All SQL is parameterized; analytics returns aggregates only, never individuals.
import { db } from './db.js';

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, '\\$&');
}

export const coursesDb = {
  insertCourse({ ownerId, courseKey, title, subtitle, author, publisherName, category, now }) {
    const info = db.prepare(
      `INSERT INTO courses (owner_id, course_key, title, subtitle, author, publisher_name, category, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'private', ?, ?)`,
    ).run(ownerId, courseKey, title, subtitle ?? null, author ?? null, publisherName, category ?? null, now, now);
    return info.lastInsertRowid;
  },

  insertVersion({ courseId, version, filePath, fileSize, fileHash, statsJson, coverData, now }) {
    const info = db.prepare(
      `INSERT INTO course_versions (course_id, version, status, file_path, file_size, file_hash, stats_json, cover_data, created_at)
       VALUES (?, ?, 'private', ?, ?, ?, ?, ?, ?)`,
    ).run(courseId, version ?? null, filePath, fileSize, fileHash ?? null, statsJson ?? null, coverData ?? null, now);
    return info.lastInsertRowid;
  },

  setLatestVersion(courseId, versionId, now) {
    return db.prepare('UPDATE courses SET latest_version_id=?, updated_at=? WHERE id=?')
      .run(versionId, now, courseId).changes;
  },

  setCurrentVersion(courseId, versionId, now) {
    return db.prepare('UPDATE courses SET current_version_id=?, updated_at=? WHERE id=?')
      .run(versionId, now, courseId).changes;
  },

  setCourseStatus(courseId, status, now) {
    return db.prepare('UPDATE courses SET status=?, updated_at=? WHERE id=?')
      .run(status, now, courseId).changes;
  },

  setCategory(courseId, category, now) {
    return db.prepare('UPDATE courses SET category=?, updated_at=? WHERE id=?')
      .run(category ?? null, now, courseId).changes;
  },

  setVersionStatus(versionId, status, now) {
    return db.prepare(
      `UPDATE course_versions
       SET status=?, published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END
       WHERE id=?`,
    ).run(status, status, now, versionId).changes;
  },

  setVersionReview(versionId, { status, reviewNote, reviewerId, now }) {
    return db.prepare(
      `UPDATE course_versions
       SET status=?, review_note=?, reviewer_id=?,
           published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END
       WHERE id=?`,
    ).run(status, reviewNote ?? null, reviewerId ?? null, status, now, versionId).changes;
  },

  courseById(id) {
    return db.prepare('SELECT * FROM courses WHERE id=?').get(id);
  },

  versionById(id) {
    return db.prepare('SELECT * FROM course_versions WHERE id=?').get(id);
  },

  versionsOfCourse(courseId) {
    return db.prepare('SELECT * FROM course_versions WHERE course_id=? ORDER BY created_at DESC').all(courseId);
  },

  mine(ownerId) {
    return db.prepare(
      `SELECT c.id, c.course_key, c.title, c.subtitle, c.publisher_name, c.category, c.status,
              c.current_version_id, c.latest_version_id, c.created_at, c.updated_at,
              cv.status AS latest_status, cv.stats_json, cv.cover_data, cv.file_size
       FROM courses c
       LEFT JOIN course_versions cv ON cv.id = c.latest_version_id
       WHERE c.owner_id=?
       ORDER BY c.updated_at DESC`,
    ).all(ownerId);
  },

  square({ q = '', category = '', publisher = '', page = 1, pageSize = 24 } = {}) {
    const where = ["c.status = 'published'", 'c.current_version_id IS NOT NULL'];
    const params = [];

    if (q) {
      where.push("(c.title LIKE ? ESCAPE '\\' OR c.subtitle LIKE ? ESCAPE '\\' OR c.publisher_name LIKE ? ESCAPE '\\')");
      const like = `%${escapeLike(q)}%`;
      params.push(like, like, like);
    }
    if (category) {
      where.push('c.category = ?');
      params.push(category);
    }
    if (publisher) {
      where.push('c.publisher_name = ?');
      params.push(publisher);
    }

    const whereSql = ` WHERE ${where.join(' AND ')}`;
    const pageNum = Math.max(1, page | 0);
    const size = Math.min(100, Math.max(1, pageSize | 0));
    const offset = (pageNum - 1) * size;

    const total = db.prepare(`SELECT COUNT(*) AS c FROM courses c${whereSql}`).get(...params).c;
    const items = db.prepare(
      `SELECT c.id, c.course_key, c.title, c.subtitle, c.author, c.publisher_name, c.category, c.status,
              c.current_version_id, c.created_at, c.updated_at,
              cv.version, cv.stats_json, cv.cover_data, cv.file_size, cv.published_at,
              (SELECT COALESCE(ROUND(AVG(r.score), 2), 0) FROM course_ratings r WHERE r.course_key = c.course_key) AS avg_rating,
              (SELECT COUNT(*) FROM course_ratings r WHERE r.course_key = c.course_key) AS rating_count,
              (SELECT COUNT(*) FROM course_downloads d WHERE d.course_key = c.course_key) AS download_count
       FROM courses c
       JOIN course_versions cv ON cv.id = c.current_version_id
       ${whereSql}
       ORDER BY COALESCE(cv.published_at, c.updated_at) DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, size, offset);

    return { items, total, page: pageNum, pageSize: size };
  },

  byKeyPublished(courseKey) {
    return db.prepare(
      `SELECT c.id, c.course_key, c.title, c.subtitle, c.author, c.publisher_name, c.category, c.status,
              c.current_version_id, c.created_at, c.updated_at,
              cv.version, cv.stats_json, cv.cover_data, cv.file_size, cv.published_at
       FROM courses c
       JOIN course_versions cv ON cv.id = c.current_version_id
       WHERE c.course_key=? AND c.status = 'published' AND c.current_version_id IS NOT NULL
       ORDER BY COALESCE(cv.published_at, c.updated_at) DESC
       LIMIT 1`,
    ).get(courseKey);
  },

  // Pending review queue: every version awaiting moderation, newest first.
  pendingVersions() {
    return db.prepare(
      `SELECT c.id AS course_id, cv.id AS version_id, c.course_key, c.title,
              c.publisher_name, c.category, cv.version, cv.file_size, cv.cover_data, cv.created_at
       FROM course_versions cv
       JOIN courses c ON c.id = cv.course_id
       WHERE cv.status='pending'
       ORDER BY cv.created_at DESC`,
    ).all();
  },

  // Admin course list. Cover/summary come from the current version, falling back to the latest.
  allCourses(status = '') {
    const where = status ? ' WHERE c.status = ?' : '';
    const params = status ? [status] : [];
    return db.prepare(
      `SELECT c.id, c.course_key, c.title, c.publisher_name, c.category, c.status,
              c.current_version_id, c.latest_version_id, c.created_at, c.updated_at,
              COALESCE(cur.cover_data, lat.cover_data) AS cover_data
       FROM courses c
       LEFT JOIN course_versions cur ON cur.id = c.current_version_id
       LEFT JOIN course_versions lat ON lat.id = c.latest_version_id
       ${where}
       ORDER BY c.updated_at DESC`,
    ).all(...params);
  },

  deleteCourse(id) {
    return db.prepare('DELETE FROM courses WHERE id=?').run(id).changes;
  },

  // Aggregate-only analytics for an owner's course. Never selects user_id/username out.
  analytics(courseKey, now = Date.now()) {
    const learners = db.prepare(
      "SELECT COUNT(DISTINCT user_id) AS c FROM user_state WHERE course_id=? AND course_id != '__global__'",
    ).get(courseKey).c;

    const studyRows = db.prepare(
      "SELECT data_json FROM user_state WHERE course_id=? AND slot='studyTime'",
    ).all(courseKey);

    let totalStudyMs = 0;
    let learnersWithStudyTime = 0;
    for (const row of studyRows) {
      let ms = 0;
      try {
        const parsed = JSON.parse(row.data_json);
        ms = typeof parsed === 'number' ? parsed : Number(parsed);
      } catch {
        ms = 0;
      }
      if (!Number.isFinite(ms) || ms < 0) ms = 0;
      totalStudyMs += ms;
      learnersWithStudyTime += 1;
    }
    const avgStudyMs = totalStudyMs / Math.max(1, learnersWithStudyTime);

    const active7d = db.prepare(
      'SELECT COUNT(DISTINCT user_id) AS c FROM user_state WHERE course_id=? AND updated_at >= ?',
    ).get(courseKey, now - 7 * 86400000).c;

    return { learners, totalStudyMs, avgStudyMs, active7d };
  },
};
