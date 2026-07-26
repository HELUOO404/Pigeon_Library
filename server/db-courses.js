// db-courses.js - courses + course_versions CRUD and owner-facing analytics.
// All SQL is parameterized; analytics returns aggregates only, never individuals.
import { db } from './db.js';

function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, '\\$&');
}

export const coursesDb = {
  insertCourse({ ownerId, courseKey, title, subtitle, description, author, publisherName, category, now }) {
    const info = db.prepare(
      `INSERT INTO courses (owner_id, course_key, title, subtitle, description, author, publisher_name, category, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'private', ?, ?)`,
    ).run(ownerId, courseKey, title, subtitle ?? null, description ?? null, author ?? null, publisherName, category ?? null, now, now);
    return info.lastInsertRowid;
  },

  insertVersion({ courseId, version, filePath, fileSize, fileHash, statsJson, coverData, coverText, now }) {
    const info = db.prepare(
      `INSERT INTO course_versions
       (course_id, version, status, file_path, file_size, file_hash, stats_json, cover_data, cover_text, cover_text_checked, created_at)
       VALUES (?, ?, 'private', ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      courseId, version ?? null, filePath, fileSize, fileHash ?? null,
      statsJson ?? null, coverData ?? null, coverText ?? null, now,
    );
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

  updateMetadata(courseId, value, now) {
    return db.prepare(
      `UPDATE courses
       SET title=?, subtitle=?, description=?, author=?, publisher_name=?, category=?,
           visible=?, cover_mode=?, cover_image=?, cover_text=?, updated_at=?
       WHERE id=?`,
    ).run(
      value.title, value.subtitle || null, value.description || null, value.author || null,
      value.publisherName, value.category || null, value.visible ? 1 : 0,
      value.coverMode, value.coverImage, value.coverText, now, courseId,
    ).changes;
  },

  builtinOverrides() {
    return db.prepare('SELECT * FROM builtin_course_overrides ORDER BY updated_at DESC').all();
  },

  publicBuiltinOverrides() {
    const active = db.prepare(
      `SELECT course_key, title, subtitle, description, author, publisher_name, category,
              hidden, visible, cover_mode,
              CASE cover_mode WHEN 'image' THEN cover_image ELSE NULL END AS cover_data,
              CASE cover_mode WHEN 'text' THEN cover_text ELSE NULL END AS cover_text,
              updated_at
       FROM builtin_course_overrides
       WHERE hidden=0 AND visible=1
       ORDER BY updated_at DESC`,
    ).all();
    const suppressed = db.prepare(
      `SELECT course_key, hidden, visible
       FROM builtin_course_overrides
       WHERE hidden=1 OR visible=0
       ORDER BY updated_at DESC`,
    ).all();
    return [...active, ...suppressed];
  },

  builtinOverrideByKey(courseKey) {
    return db.prepare('SELECT * FROM builtin_course_overrides WHERE course_key=?').get(courseKey);
  },

  upsertBuiltinOverride(courseKey, value, now) {
    return db.prepare(
      `INSERT INTO builtin_course_overrides
       (course_key,title,subtitle,description,author,publisher_name,category,hidden,
        visible,cover_mode,cover_image,cover_text,updated_at)
       VALUES(?,?,?,?,?,?,?,0,?,?,?,?,?)
       ON CONFLICT(course_key) DO UPDATE SET
         title=excluded.title, subtitle=excluded.subtitle, description=excluded.description,
         author=excluded.author, publisher_name=excluded.publisher_name, category=excluded.category,
         visible=excluded.visible, cover_mode=excluded.cover_mode,
         cover_image=excluded.cover_image, cover_text=excluded.cover_text,
         updated_at=excluded.updated_at`,
    ).run(
      courseKey, value.title, value.subtitle || null, value.description || null,
      value.author || null, value.publisherName, value.category || null, value.visible ? 1 : 0,
      value.coverMode, value.coverImage, value.coverText, now,
    ).changes;
  },

  hideBuiltin(courseKey, now) {
    return db.prepare(
      `INSERT INTO builtin_course_overrides
       (course_key,title,publisher_name,hidden,updated_at)
       VALUES(?,?,?,1,?)
       ON CONFLICT(course_key) DO UPDATE SET hidden=1, updated_at=excluded.updated_at`,
    ).run(courseKey, courseKey, courseKey, now).changes;
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
      `SELECT c.id, c.course_key, c.title, c.subtitle, c.description, c.publisher_name, c.category, c.status,
              c.visible, c.cover_mode, c.cover_image, c.cover_text AS cover_text_override,
              c.current_version_id, c.latest_version_id, c.created_at, c.updated_at,
              lat.status AS latest_status, lat.stats_json,
              CASE c.cover_mode
                WHEN 'image' THEN c.cover_image
                WHEN 'text' THEN NULL
                ELSE CASE WHEN c.current_version_id IS NOT NULL THEN cur.cover_data ELSE lat.cover_data END
              END AS cover_data,
              CASE c.cover_mode
                WHEN 'text' THEN c.cover_text
                WHEN 'image' THEN NULL
                ELSE CASE WHEN c.current_version_id IS NOT NULL THEN cur.cover_text ELSE lat.cover_text END
              END AS cover_text,
              lat.file_size
       FROM courses c
       LEFT JOIN course_versions cur ON cur.id = c.current_version_id AND cur.course_id = c.id
       LEFT JOIN course_versions lat ON lat.id = c.latest_version_id AND lat.course_id = c.id
       WHERE c.owner_id=?
       ORDER BY c.updated_at DESC`,
    ).all(ownerId);
  },

  square({ q = '', category = '', publisher = '', page = 1, pageSize = 24 } = {}) {
    const where = ["c.status = 'published'", 'c.current_version_id IS NOT NULL', 'c.visible = 1'];
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
      `SELECT c.id, c.course_key, c.title, c.subtitle, c.description, c.author, c.publisher_name, c.category, c.status,
              c.current_version_id, c.created_at, c.updated_at,
              cv.version, cv.stats_json,
              CASE c.cover_mode
                WHEN 'image' THEN c.cover_image
                WHEN 'text' THEN NULL
                ELSE cv.cover_data
              END AS cover_data,
              CASE c.cover_mode
                WHEN 'text' THEN c.cover_text
                WHEN 'image' THEN NULL
                ELSE cv.cover_text
              END AS cover_text,
              cv.file_size, cv.published_at,
              (SELECT COALESCE(ROUND(AVG(r.score), 2), 0) FROM course_ratings r WHERE r.course_key = c.course_key) AS avg_rating,
              (SELECT COUNT(*) FROM course_ratings r WHERE r.course_key = c.course_key) AS rating_count,
              (SELECT COUNT(*) FROM course_downloads d WHERE d.course_key = c.course_key) AS download_count
       FROM courses c
       JOIN course_versions cv ON cv.id = c.current_version_id AND cv.course_id = c.id
       ${whereSql}
       ORDER BY COALESCE(cv.published_at, c.updated_at) DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, size, offset);

    return { items, total, page: pageNum, pageSize: size };
  },

  byKeyPublished(courseKey) {
    return db.prepare(
      `SELECT c.id, c.course_key, c.title, c.subtitle, c.description, c.author, c.publisher_name, c.category, c.status,
              c.visible, c.cover_mode, c.cover_image, c.cover_text AS cover_text_override,
              c.current_version_id, c.created_at, c.updated_at,
              cv.version, cv.stats_json,
              CASE c.cover_mode
                WHEN 'image' THEN c.cover_image
                WHEN 'text' THEN NULL
                ELSE cv.cover_data
              END AS cover_data,
              CASE c.cover_mode
                WHEN 'text' THEN c.cover_text
                WHEN 'image' THEN NULL
                ELSE cv.cover_text
              END AS cover_text,
              cv.file_size, cv.published_at
       FROM courses c
       JOIN course_versions cv ON cv.id = c.current_version_id AND cv.course_id = c.id
       WHERE c.course_key=? AND c.status = 'published' AND c.current_version_id IS NOT NULL AND c.visible = 1
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
      `SELECT c.id, c.course_key, c.title, c.subtitle, c.description, c.author,
              c.publisher_name, c.category, c.status,
              c.visible, c.cover_mode, c.cover_image, c.cover_text AS cover_text_override,
              c.current_version_id, c.latest_version_id, c.created_at, c.updated_at,
              CASE c.cover_mode
                WHEN 'image' THEN c.cover_image
                WHEN 'text' THEN NULL
                ELSE CASE WHEN c.current_version_id IS NOT NULL THEN cur.cover_data ELSE lat.cover_data END
              END AS cover_data,
              CASE c.cover_mode
                WHEN 'text' THEN c.cover_text
                WHEN 'image' THEN NULL
                ELSE CASE WHEN c.current_version_id IS NOT NULL THEN cur.cover_text ELSE lat.cover_text END
              END AS cover_text
       FROM courses c
       LEFT JOIN course_versions cur ON cur.id = c.current_version_id AND cur.course_id = c.id
       LEFT JOIN course_versions lat ON lat.id = c.latest_version_id AND lat.course_id = c.id
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
