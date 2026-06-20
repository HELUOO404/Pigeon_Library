// routes/courses.js - Course Square: upload, own courses, public square, file download,
//                     owner analytics, publish/unpublish, edit, delete, and version management.
import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { requireUser, authError, currentUser } from '../middleware/auth.js';
import { config, COURSE_CATEGORIES } from '../config.js';
import { coursesDb } from '../db-courses.js';
import { socialDb } from '../db-social.js';
import { parsePigeonBuffer, PigeonError } from '../lib/pigeon-server.js';

export const coursesRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPigeonBytes } });

// Wrap multer's single-file handler so a too-large upload returns a clean 413 instead of crashing.
function uploadSingle(field) {
  const handler = upload.single(field);
  return (req, res, next) => {
    handler(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return authError(res, 413, 'payload_too_large', '文件超过大小上限(50MB)');
        }
        return authError(res, 400, 'bad_request', err.message || '上传失败');
      }
      next();
    });
  };
}

// Owner guard: load the course, send 404/403 and return null when the caller is not its owner.
function ownerCourse(req, res) {
  const course = coursesDb.courseById(Number(req.params.id));
  if (!course) {
    authError(res, 404, 'course_not_found', 'course not found');
    return null;
  }
  if (course.owner_id !== req.user.id) {
    authError(res, 403, 'not_owner', 'not the owner of this course');
    return null;
  }
  return course;
}

// Resolve the on-disk directory for a course's package files.
function courseDir(courseId) {
  return path.join(config.coursesDir, String(courseId));
}

// POST / - upload a new course package (creates course + first version, kept private).
coursesRouter.post('/', requireUser, uploadSingle('file'), (req, res) => {
  if (!req.file) return authError(res, 400, 'bad_request', '未收到课程文件');

  let meta;
  try {
    meta = parsePigeonBuffer(req.file.buffer);
  } catch (e) {
    return authError(res, 400, e instanceof PigeonError ? e.code : 'bad_pigeon', e.message);
  }

  const category = COURSE_CATEGORIES.includes(req.body.category) ? req.body.category : null;
  const now = Date.now();
  const courseId = coursesDb.insertCourse({
    ownerId: req.user.id,
    courseKey: meta.courseKey,
    title: meta.title,
    subtitle: meta.subtitle,
    description: meta.description,
    author: meta.author,
    publisherName: req.user.username,
    category,
    now,
  });

  const dir = courseDir(courseId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${meta.fileHash}.pigeon`);
  fs.writeFileSync(filePath, req.file.buffer);

  const versionId = coursesDb.insertVersion({
    courseId,
    version: meta.version,
    filePath,
    fileSize: req.file.buffer.length,
    fileHash: meta.fileHash,
    statsJson: meta.statsJson,
    coverData: meta.coverBase64,
    now,
  });
  coursesDb.setLatestVersion(courseId, versionId, now);

  const course = coursesDb.mine(req.user.id).find((c) => c.id === courseId) || null;
  res.json({ course });
});

// GET /mine - the caller's own courses (any status).
coursesRouter.get('/mine', requireUser, (req, res) => {
  res.json({ courses: coursesDb.mine(req.user.id) });
});

// GET /square - public, paginated, filterable listing of published courses.
coursesRouter.get('/square', (req, res) => {
  const { q, category, publisher, page, pageSize } = req.query;
  res.json(coursesDb.square({
    q: typeof q === 'string' ? q : '',
    category: typeof category === 'string' ? category : '',
    publisher: typeof publisher === 'string' ? publisher : '',
    page: Number(page) || 1,
    pageSize: Number(pageSize) || 24,
  }));
});

// GET /:id/file - download a package. Public for published versions; owner/admin may grab any.
coursesRouter.get('/:id/file', (req, res) => {
  const course = coursesDb.courseById(Number(req.params.id));
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');

  const user = currentUser(req);
  const versionId = req.query.v ? Number(req.query.v) : course.current_version_id;
  const version = coursesDb.versionById(versionId);
  if (!version) return authError(res, 404, 'not_found', 'version not found');

  const isOwner = user && user.id === course.owner_id;
  const isAdmin = user && user.role === 'admin';
  const allow = version.status === 'published' || isOwner || isAdmin;
  if (!allow) return authError(res, 403, 'forbidden', 'not allowed to download this version');
  if (!fs.existsSync(version.file_path)) return authError(res, 404, 'not_found', 'package file missing');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${course.course_key}.pigeon"`);
  res.send(fs.readFileSync(version.file_path));

  if (user) socialDb.recordDownload({ courseKey: course.course_key, userId: user.id, now: Date.now() });
});

// GET /:id/analytics - aggregate-only stats for the course owner.
coursesRouter.get('/:id/analytics', requireUser, (req, res) => {
  const course = coursesDb.courseById(Number(req.params.id));
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');
  if (course.owner_id !== req.user.id) return authError(res, 403, 'not_owner', 'not the owner of this course');
  res.json(coursesDb.analytics(course.course_key));
});

// POST /:id/publish - submit the latest version for review.
coursesRouter.post('/:id/publish', requireUser, (req, res) => {
  const course = ownerCourse(req, res);
  if (!course) return;
  if (!COURSE_CATEGORIES.includes(req.body.category)) {
    return authError(res, 400, 'bad_request', '分类无效,请从预设分类中选择');
  }
  const vid = course.latest_version_id;
  if (!vid) return authError(res, 400, 'bad_request', '没有可发布的版本');

  const now = Date.now();
  coursesDb.setCategory(course.id, req.body.category, now);
  coursesDb.setVersionStatus(vid, 'pending', now);
  coursesDb.setCourseStatus(course.id, 'pending', now);
  res.json({ ok: true });
});

// POST /:id/unpublish - pull the course from the square back to private.
coursesRouter.post('/:id/unpublish', requireUser, (req, res) => {
  const course = ownerCourse(req, res);
  if (!course) return;
  const now = Date.now();
  coursesDb.setCurrentVersion(course.id, null, now);
  coursesDb.setCourseStatus(course.id, 'private', now);
  res.json({ ok: true });
});

// PATCH /:id - edit course metadata (currently category only).
coursesRouter.patch('/:id', requireUser, (req, res) => {
  const course = ownerCourse(req, res);
  if (!course) return;
  if (COURSE_CATEGORIES.includes(req.body.category)) {
    coursesDb.setCategory(course.id, req.body.category, Date.now());
  }
  const fresh = coursesDb.mine(req.user.id).find((c) => c.id === course.id) || null;
  res.json({ course: fresh });
});

// DELETE /:id - remove the course and its on-disk package files.
coursesRouter.delete('/:id', requireUser, (req, res) => {
  const course = ownerCourse(req, res);
  if (!course) return;
  fs.rmSync(courseDir(course.id), { recursive: true, force: true });
  coursesDb.deleteCourse(course.id);
  res.json({ deleted: true });
});

// POST /:id/versions - upload a new version of an existing course (kept private).
coursesRouter.post('/:id/versions', requireUser, uploadSingle('file'), (req, res) => {
  const course = ownerCourse(req, res);
  if (!course) return;
  if (!req.file) return authError(res, 400, 'bad_request', '未收到课程文件');

  let meta;
  try {
    meta = parsePigeonBuffer(req.file.buffer);
  } catch (e) {
    return authError(res, 400, e instanceof PigeonError ? e.code : 'bad_pigeon', e.message);
  }
  if (meta.courseKey !== course.course_key) {
    return authError(res, 400, 'key_mismatch', '新版本的课程包 id 与该课程不一致');
  }

  const dir = courseDir(course.id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${meta.fileHash}.pigeon`);
  fs.writeFileSync(filePath, req.file.buffer);

  const now = Date.now();
  const versionId = coursesDb.insertVersion({
    courseId: course.id,
    version: meta.version,
    filePath,
    fileSize: req.file.buffer.length,
    fileHash: meta.fileHash,
    statsJson: meta.statsJson,
    coverData: meta.coverBase64,
    now,
  });
  coursesDb.setLatestVersion(course.id, versionId, now);
  res.json({ version: coursesDb.versionById(versionId) });
});

// GET /:id/versions - list every version. Visible to the owner or an admin.
coursesRouter.get('/:id/versions', requireUser, (req, res) => {
  const course = coursesDb.courseById(Number(req.params.id));
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');
  if (course.owner_id !== req.user.id && req.user.role !== 'admin') {
    return authError(res, 403, 'forbidden', 'not allowed to view versions');
  }
  res.json({ versions: coursesDb.versionsOfCourse(course.id) });
});

// POST /:id/versions/:vid/publish - submit a specific version for review.
coursesRouter.post('/:id/versions/:vid/publish', requireUser, (req, res) => {
  const course = ownerCourse(req, res);
  if (!course) return;
  const now = Date.now();
  coursesDb.setVersionStatus(Number(req.params.vid), 'pending', now);
  coursesDb.setCourseStatus(course.id, 'pending', now);
  res.json({ ok: true });
});
