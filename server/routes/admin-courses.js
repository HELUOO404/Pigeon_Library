// routes/admin-courses.js - moderation of Course Square: review queue, listing,
//                            approve/reject versions, and takedown. All changes are audited.
import { Router } from 'express';
import { requireAdmin, authError } from '../middleware/auth.js';
import { coursesDb } from '../db-courses.js';
import { adminDb } from '../db-admin.js';

export const adminCoursesRouter = Router();
adminCoursesRouter.use(requireAdmin);

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

// GET /pending - versions awaiting review, newest first.
adminCoursesRouter.get('/pending', (req, res) => {
  res.json({ items: coursesDb.pendingVersions() });
});

// GET / - all courses, optionally filtered by status.
adminCoursesRouter.get('/', (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  res.json({ courses: coursesDb.allCourses(status) });
});

// POST /:id/versions/:vid/approve - publish a version and make it the course's current one.
adminCoursesRouter.post('/:id/versions/:vid/approve', (req, res) => {
  const course = coursesDb.courseById(Number(req.params.id));
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');
  const version = coursesDb.versionById(Number(req.params.vid));
  if (!version) return authError(res, 404, 'not_found', 'version not found');

  const now = Date.now();
  coursesDb.setVersionReview(version.id, { status: 'published', reviewNote: null, reviewerId: req.user.id, now });
  coursesDb.setCurrentVersion(course.id, Number(req.params.vid), now);
  coursesDb.setCourseStatus(course.id, 'published', now);
  audit(req, course, 'course_approve', `version #${req.params.vid}`);
  res.json({ ok: true });
});

// POST /:id/versions/:vid/reject - reject a version with an optional note.
adminCoursesRouter.post('/:id/versions/:vid/reject', (req, res) => {
  const course = coursesDb.courseById(Number(req.params.id));
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');
  const version = coursesDb.versionById(Number(req.params.vid));
  if (!version) return authError(res, 404, 'not_found', 'version not found');

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

  const now = Date.now();
  coursesDb.setCurrentVersion(course.id, null, now);
  coursesDb.setCourseStatus(course.id, 'private', now);
  audit(req, course, 'course_takedown', null);
  res.json({ ok: true });
});
