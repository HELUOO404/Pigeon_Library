// routes/admin-courses.js - moderation of Course Square: review queue, listing,
//                            approve/reject versions, and takedown. All changes are audited.
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { requireAdmin, authError } from '../middleware/auth.js';
import { coursesDb } from '../db-courses.js';
import { adminDb } from '../db-admin.js';
import { config, COURSE_CATEGORIES } from '../config.js';
import { parsePigeonBuffer, PigeonError } from '../lib/pigeon-server.js';
import { ADMIN_COVER_MAX_BYTES, CoverInputError, normalizeCoverSettings } from '../lib/course-cover.js';

export const adminCoursesRouter = Router();
adminCoursesRouter.use(requireAdmin);

const coverUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: ADMIN_COVER_MAX_BYTES,
    fieldSize: 8 * 1024,
    fields: 9,
    files: 1,
    parts: 11, // Busboy raises at the boundary; field/file caps keep accepted parts at 10.
  },
});

function uploadCoverImage(req, res, next) {
  coverUpload.single('coverImage')(req, res, (error) => {
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return authError(res, 413, 'payload_too_large', '封面图片不能超过 600 KB');
    }
    if (error) return authError(res, 400, 'bad_request', error.message || '封面上传失败');
    next();
  });
}

// Record one moderation action; actor comes from the session, never the request body.
function audit(req, course, action, detail) {
  adminDb.writeAudit({
    actorId: req.user.id,
    actorName: req.user.username,
    action,
    targetId: course.id,
    targetName: course.title,
    detail: detail ?? null,
  });
}

const FIELD_LIMITS = {
  title: 120,
  subtitle: 180,
  publisherName: 120,
  author: 120,
  description: 2000,
};

function parseCourseRef(raw) {
  const value = String(raw || '');
  if (value.startsWith('builtin:')) {
    const key = value.slice('builtin:'.length);
    return key && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)
      ? { source: 'builtin', key }
      : null;
  }
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? { source: 'server', id } : null;
}

function normalizeMetadata(body) {
  const value = {};
  for (const field of Object.keys(FIELD_LIMITS)) {
    if (typeof body?.[field] !== 'string') return { error: `${field} 必须是文本` };
    value[field] = body[field].trim();
    if (value[field].length > FIELD_LIMITS[field]) return { error: `${field} 超出长度限制` };
  }
  if (!value.title) return { error: '标题不能为空' };
  if (!value.publisherName) return { error: '发布人不能为空' };
  if (typeof body?.category !== 'string') return { error: '分类必须是文本' };
  value.category = body.category.trim();
  if (value.category && !COURSE_CATEGORIES.includes(value.category)) return { error: '分类无效' };
  return { value };
}

function parseVisible(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function courseVersion(course, versionId, res) {
  const version = coursesDb.versionById(Number(versionId));
  if (!version || version.course_id !== course.id) {
    authError(res, 404, 'not_found', 'version not found');
    return null;
  }
  return version;
}

// GET /pending - versions awaiting review, newest first.
adminCoursesRouter.get('/pending', (req, res) => {
  res.json({ items: coursesDb.pendingVersions() });
});

// GET / - all courses, optionally filtered by status.
adminCoursesRouter.get('/', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  res.json({ courses: coursesDb.allCourses(status), builtinOverrides: coursesDb.builtinOverrides() });
});

// GET /:ref - editable values plus immutable package metadata for uploaded courses.
adminCoursesRouter.get('/:ref', (req, res) => {
  const ref = parseCourseRef(req.params.ref);
  if (!ref) return authError(res, 400, 'bad_request', 'invalid course reference');
  if (ref.source === 'builtin') {
    return res.json({ course: coursesDb.builtinOverrideByKey(ref.key) || null, original: null });
  }
  const course = coursesDb.courseById(ref.id);
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');
  const currentVersion = course.current_version_id
    ? courseVersion(course, course.current_version_id, res)
    : null;
  if (course.current_version_id && !currentVersion) return;
  const latestVersion = course.latest_version_id
    ? courseVersion(course, course.latest_version_id, res)
    : null;
  if (course.latest_version_id && !latestVersion) return;
  const version = currentVersion || latestVersion;
  if (!version) return authError(res, 404, 'not_found', 'course has no versions');
  if (!fs.existsSync(version.file_path)) {
    return authError(res, 404, 'not_found', 'package file missing');
  }
  let meta;
  try {
    meta = parsePigeonBuffer(fs.readFileSync(version.file_path));
  } catch (error) {
    if (error instanceof PigeonError) {
      return authError(res, 400, error.code, error.message);
    }
    throw error;
  }
  return res.json({
    course,
    original: {
      title: meta.title,
      subtitle: meta.subtitle || '',
      description: meta.description || '',
      author: meta.author || '',
      cover_image: meta.coverBase64 || '',
      cover_text: meta.coverText || '',
      version: meta.version || '',
    },
  });
});

// PATCH /:ref - edit uploaded metadata or save an online override for a built-in course.
adminCoursesRouter.patch('/:ref', uploadCoverImage, (req, res) => {
  const ref = parseCourseRef(req.params.ref);
  if (!ref) return authError(res, 400, 'bad_request', 'invalid course reference');
  const normalized = normalizeMetadata(req.body);
  if (normalized.error) return authError(res, 400, 'bad_request', normalized.error);

  const visible = parseVisible(req.body?.visible);
  if (visible === null) return authError(res, 400, 'bad_request', 'visible 必须是布尔值');

  const existing = ref.source === 'builtin'
    ? coursesDb.builtinOverrideByKey(ref.key)
    : coursesDb.courseById(ref.id);
  if (ref.source === 'server' && !existing) {
    return authError(res, 404, 'course_not_found', 'course not found');
  }

  let cover;
  try {
    cover = normalizeCoverSettings({
      mode: req.body?.coverMode,
      text: req.body?.coverText,
      file: req.file || null,
      existingImage: existing?.cover_image || null,
      existingText: existing?.cover_text || null,
    });
  } catch (error) {
    if (error instanceof CoverInputError) {
      return authError(res, 400, 'bad_request', error.message);
    }
    throw error;
  }

  const value = {
    ...normalized.value,
    visible,
    coverMode: cover.coverMode,
    coverImage: cover.coverImage,
    coverText: cover.coverText,
  };

  const now = Date.now();
  if (ref.source === 'builtin') {
    coursesDb.upsertBuiltinOverride(ref.key, value, now);
    const course = coursesDb.builtinOverrideByKey(ref.key);
    audit(req, { id: null, title: value.title }, 'course_edit', `builtin:${ref.key}; visible=${visible ? 1 : 0}; cover=${cover.coverMode}`);
    return res.json({ course });
  }

  coursesDb.updateMetadata(existing.id, value, now);
  const course = coursesDb.courseById(existing.id);
  audit(req, course, 'course_edit', `server:${existing.id}; visible=${visible ? 1 : 0}; cover=${cover.coverMode}`);
  return res.json({ course });
});

// DELETE /:ref - uploaded packages are removed; built-ins receive a server-side tombstone.
adminCoursesRouter.delete('/:ref', (req, res) => {
  const ref = parseCourseRef(req.params.ref);
  if (!ref) return authError(res, 400, 'bad_request', 'invalid course reference');

  if (ref.source === 'builtin') {
    coursesDb.hideBuiltin(ref.key, Date.now());
    audit(req, { id: null, title: ref.key }, 'course_delete', `builtin:${ref.key}`);
    return res.json({ deleted: true });
  }

  const course = coursesDb.courseById(ref.id);
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');
  fs.rmSync(path.join(config.coursesDir, String(course.id)), { recursive: true, force: true });
  const deleted = coursesDb.deleteCourse(course.id) > 0;
  audit(req, course, 'course_delete', `server:${course.id}`);
  return res.json({ deleted });
});

// POST /:id/versions/:vid/approve - publish a version and make it the course's current one.
adminCoursesRouter.post('/:id/versions/:vid/approve', (req, res) => {
  const course = coursesDb.courseById(Number(req.params.id));
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');
  const version = courseVersion(course, req.params.vid, res);
  if (!version) return;

  const now = Date.now();
  coursesDb.setVersionReview(version.id, { status: 'published', reviewNote: null, reviewerId: req.user.id, now });
  coursesDb.setCurrentVersion(course.id, version.id, now);
  coursesDb.setCourseStatus(course.id, 'published', now);
  audit(req, course, 'course_approve', `version #${req.params.vid}`);
  res.json({ ok: true });
});

// POST /:id/versions/:vid/reject - reject a version with an optional note.
adminCoursesRouter.post('/:id/versions/:vid/reject', (req, res) => {
  const course = coursesDb.courseById(Number(req.params.id));
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');
  const version = courseVersion(course, req.params.vid, res);
  if (!version) return;

  const now = Date.now();
  const note = String(req.body.note || '');
  coursesDb.setVersionReview(version.id, { status: 'rejected', reviewNote: note, reviewerId: req.user.id, now });
  // Only flag the whole course as rejected when no published version is live.
  if (course.current_version_id == null) {
    coursesDb.setCourseStatus(course.id, 'rejected', now);
  }
  audit(req, course, 'course_reject', note || `version #${req.params.vid}`);
  res.json({ ok: true });
});

// POST /:id/takedown - pull a course off the square back to private.
adminCoursesRouter.post('/:id/takedown', (req, res) => {
  const course = coursesDb.courseById(Number(req.params.id));
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');
  if (course.current_version_id && !courseVersion(course, course.current_version_id, res)) return;

  const now = Date.now();
  coursesDb.setCurrentVersion(course.id, null, now);
  coursesDb.setCourseStatus(course.id, 'private', now);
  audit(req, course, 'course_takedown', null);
  res.json({ ok: true });
});
