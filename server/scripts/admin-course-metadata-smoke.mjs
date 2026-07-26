// admin-course-metadata-smoke.mjs - Reversible API smoke test for admin course metadata management.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { applyBuiltinOverrides } from '../../app/src/core/course-overrides.js';

const BASE = process.env.BASE || 'http://localhost:8787';
const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.join(here, '..');
const dbPath = path.join(serverRoot, 'data', 'pglib.db');
const coursesDir = path.join(serverRoot, 'data', 'courses');
const builtinKey = 'ic-packaging';
const marker = `admin-course-smoke-${Date.now()}`;
const token = randomBytes(32).toString('hex');

let pass = 0;
let fail = 0;

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ''}`);
  }
}

async function request(method, url, body) {
  const multipart = body instanceof FormData;
  const response = await fetch(`${BASE}${url}`, {
    method,
    headers: { cookie: `pglib_sess=${token}`, ...(body === undefined || multipart ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  let json = null;
  try { json = await response.json(); } catch { /* responses without JSON */ }
  return { status: response.status, json };
}

function tableExists(db, name) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

async function main() {
  const db = new DatabaseSync(dbPath);
  const now = Date.now();
  const createdAdmin = db.prepare(
    "INSERT INTO users(username,pass_hash,role,disabled,created_at) VALUES(?,?,'admin',0,?)",
  ).run(marker, 'smoke-session-only', now);
  const admin = { id: Number(createdAdmin.lastInsertRowid), username: marker };

  const hadOverrideTable = tableExists(db, 'builtin_course_overrides');
  const previousOverride = hadOverrideTable
    ? db.prepare('SELECT * FROM builtin_course_overrides WHERE course_key=?').get(builtinKey)
    : null;
  db.prepare(
    'INSERT INTO sessions(token,user_id,created_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?)',
  ).run(token, admin.id, now, now + 10 * 60 * 1000, '127.0.0.1', marker);

  const testCourseKey = marker;
  const inserted = db.prepare(
    `INSERT INTO courses(owner_id,course_key,title,subtitle,description,author,publisher_name,category,status,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(admin.id, testCourseKey, marker, '', '', 'Smoke', 'Smoke', null, 'private', now, now);
  const testCourseId = Number(inserted.lastInsertRowid);
  const testCourseDir = path.join(coursesDir, String(testCourseId));
  fs.mkdirSync(testCourseDir, { recursive: true });
  const packageBytes = Buffer.from(zipSync({
    'manifest.json': strToU8(JSON.stringify({
      schemaVersion: 1,
      id: testCourseKey,
      title: 'Package title',
      subtitle: 'Package subtitle',
      description: 'Package description',
      author: 'Package author',
      coverText: '原封面',
      chapters: [{
        id: '1',
        title: '第一章',
        sections: [{
          id: '1.1',
          title: '第一节',
          knowledgePoints: [{ id: '1-1-1', title: '知识点' }],
        }],
      }],
    })),
    'content.json': strToU8(JSON.stringify({ knowledgePoints: {} })),
  }));
  const packagePath = path.join(testCourseDir, 'smoke.pigeon');
  fs.writeFileSync(packagePath, packageBytes);
  const insertedVersion = db.prepare(
    `INSERT INTO course_versions(course_id,version,status,file_path,file_size,cover_text,created_at,published_at)
     VALUES(?,?,'published',?,?,?, ?,?)`,
  ).run(testCourseId, '1.0.0', packagePath, packageBytes.length, '原封面', now, now);
  const testVersionId = Number(insertedVersion.lastInsertRowid);

  const pendingPackagePath = path.join(testCourseDir, 'pending.pigeon');
  fs.writeFileSync(pendingPackagePath, packageBytes);
  const pendingVersion = db.prepare(
    `INSERT INTO course_versions(course_id,version,status,file_path,file_size,cover_data,cover_text,created_at)
     VALUES(?,?,'pending',?,?,?,?,?)`,
  ).run(testCourseId, '2.0.0', pendingPackagePath, packageBytes.length, 'data:image/png;base64,bGF0ZXN0', '最新待审', now + 1);
  const pendingVersionId = Number(pendingVersion.lastInsertRowid);
  db.prepare(
    "UPDATE courses SET status='published', current_version_id=?, latest_version_id=? WHERE id=?",
  ).run(testVersionId, pendingVersionId, testCourseId);

  const otherCourse = db.prepare(
    `INSERT INTO courses(owner_id,course_key,title,publisher_name,status,created_at,updated_at)
     VALUES(?,?,?,?,'private',?,?)`,
  ).run(admin.id, `${marker}-other`, 'Other course', 'Smoke', now, now);
  const otherCourseId = Number(otherCourse.lastInsertRowid);
  const otherCourseDir = path.join(coursesDir, String(otherCourseId));
  fs.mkdirSync(otherCourseDir, { recursive: true });
  const otherPackagePath = path.join(otherCourseDir, 'other.pigeon');
  fs.writeFileSync(otherPackagePath, packageBytes);
  const otherVersion = db.prepare(
    `INSERT INTO course_versions(course_id,version,status,file_path,file_size,cover_text,created_at)
     VALUES(?,?,'private',?,?,?,?)`,
  ).run(otherCourseId, '1.0.0', otherPackagePath, packageBytes.length, '他课封面', now);
  const otherVersionId = Number(otherVersion.lastInsertRowid);
  db.prepare('UPDATE courses SET latest_version_id=? WHERE id=?').run(otherVersionId, otherCourseId);

  try {
    const detail = await request('GET', `/api/admin/courses/${testCourseId}`);
    check('detail returns immutable package display', detail.status === 200
      && detail.json?.original?.title === 'Package title'
      && detail.json?.original?.cover_text === '原封面');

    const mine = await request('GET', '/api/courses/mine');
    const mineCourse = mine.json?.courses?.find((course) => course.id === testCourseId);
    check('mine default cover uses current published version before latest pending', mineCourse?.cover_text === '原封面'
      && !mineCourse?.cover_data && mineCourse?.latest_status === 'pending');
    const squareText = await request('GET', '/api/courses/square?pageSize=100');
    const squareCourse = squareText.json?.items?.find((course) => course.id === testCourseId);
    check('square projects version-level text-only cover', squareCourse?.cover_text === '原封面' && !squareCourse?.cover_data);
    const adminText = await request('GET', '/api/admin/courses');
    const adminCourse = adminText.json?.courses?.find((course) => course.id === testCourseId);
    check('admin projects current text as a unit instead of latest image', adminCourse?.cover_text === '原封面' && !adminCourse?.cover_data);

    db.prepare('UPDATE course_versions SET cover_text=NULL, cover_data=NULL WHERE id=?').run(testVersionId);
    const mineWithoutCurrentCover = (await request('GET', '/api/courses/mine')).json?.courses
      ?.find((course) => course.id === testCourseId);
    const adminWithoutCurrentCover = (await request('GET', '/api/admin/courses')).json?.courses
      ?.find((course) => course.id === testCourseId);
    check('mine current version without cover does not borrow latest pending cover', mineWithoutCurrentCover?.cover_text == null
      && mineWithoutCurrentCover?.cover_data == null);
    check('admin current version without cover does not borrow latest pending cover', adminWithoutCurrentCover?.cover_text == null
      && adminWithoutCurrentCover?.cover_data == null);
    db.prepare('UPDATE course_versions SET cover_text=? WHERE id=?').run('原封面', testVersionId);

    const crossDownload = await request('GET', `/api/courses/${testCourseId}/file?v=${otherVersionId}`);
    check('download rejects a version owned by another URL course', crossDownload.status === 404, `status=${crossDownload.status}`);
    const crossSubmit = await request('POST', `/api/courses/${testCourseId}/versions/${otherVersionId}/publish`, {});
    check('owner submit rejects a version owned by another URL course', crossSubmit.status === 404
      && db.prepare('SELECT status FROM course_versions WHERE id=?').get(otherVersionId)?.status === 'private');
    const crossApprove = await request('POST', `/api/admin/courses/${testCourseId}/versions/${otherVersionId}/approve`, {});
    check('admin approve rejects a version owned by another URL course', crossApprove.status === 404
      && db.prepare('SELECT status FROM course_versions WHERE id=?').get(otherVersionId)?.status === 'private');
    const crossReject = await request('POST', `/api/admin/courses/${testCourseId}/versions/${otherVersionId}/reject`, { note: 'must not apply' });
    check('admin reject rejects a version owned by another URL course', crossReject.status === 404
      && db.prepare('SELECT status FROM course_versions WHERE id=?').get(otherVersionId)?.status === 'private');

    db.prepare('UPDATE courses SET latest_version_id=? WHERE id=?').run(otherVersionId, testCourseId);
    const corruptDetail = await request('GET', `/api/admin/courses/${testCourseId}`);
    const corruptPublish = await request('POST', `/api/courses/${testCourseId}/publish`, { category: '其他' });
    check('admin detail rejects cross-course original-display provenance', corruptDetail.status === 404);
    check('latest-pointer publish rejects cross-course provenance', corruptPublish.status === 404
      && db.prepare('SELECT status FROM course_versions WHERE id=?').get(otherVersionId)?.status === 'private');
    db.prepare('UPDATE courses SET latest_version_id=? WHERE id=?').run(pendingVersionId, testCourseId);

    const invalid = await request('PATCH', `/api/admin/courses/${encodeURIComponent(`builtin:${builtinKey}`)}`, {
      title: '', subtitle: '', category: 'invalid', publisherName: '', author: '', description: '',
      visible: true, coverMode: 'default', coverText: '',
    });
    check('rejects invalid metadata', invalid.status === 400, `status=${invalid.status}`);

    const tooManyFields = new FormData();
    for (const [field, value] of Object.entries({
      title: marker, subtitle: '', category: '其他', publisherName: 'Smoke publisher',
      author: '', description: '', visible: 'true', coverMode: 'default', coverText: '',
    })) tooManyFields.set(field, value);
    tooManyFields.set('unexpected', 'must be rejected');
    const limited = await request('PATCH', `/api/admin/courses/${encodeURIComponent(`builtin:${builtinKey}`)}`, tooManyFields);
    check('admin multipart rejects excess fields with controlled 4xx', limited.status === 400, `status=${limited.status}`);

    const editBody = new FormData();
    for (const [field, value] of Object.entries({
      title: marker, subtitle: 'Smoke subtitle', category: '其他', publisherName: 'Smoke publisher',
      author: 'Smoke author', description: 'Smoke description', visible: 'false',
      coverMode: 'text', coverText: '课程封面六字',
    })) editBody.set(field, value);
    const edit = await request('PATCH', `/api/admin/courses/${encodeURIComponent(`builtin:${builtinKey}`)}`, editBody);
    check('edits built-in metadata', edit.status === 200 && edit.json?.course?.title === marker, `status=${edit.status}`);

    const listAfterEdit = await request('GET', '/api/admin/courses');
    const edited = listAfterEdit.json?.builtinOverrides?.find((item) => item.course_key === builtinKey);
    check('admin list returns built-in override', edited?.title === marker && edited?.hidden === 0);
    check('six-character text cover saves', edited?.cover_mode === 'text' && edited?.cover_text === '课程封面六字');

    const invalidText = await request('PATCH', `/api/admin/courses/${encodeURIComponent(`builtin:${builtinKey}`)}`, {
      title: marker, subtitle: 'Changed subtitle', category: '其他', publisherName: 'Smoke publisher',
      author: 'Smoke author', description: 'Smoke description', visible: true,
      coverMode: 'text', coverText: '超过六个字符啊',
    });
    const unchangedList = await request('GET', '/api/admin/courses');
    const unchanged = unchangedList.json?.builtinOverrides?.find((item) => item.course_key === builtinKey);
    check('seven-character text cover is rejected atomically', invalidText.status === 400
      && unchanged?.subtitle === 'Smoke subtitle' && unchanged?.cover_text === '课程封面六字');
    check('built-in visibility is separate from deletion tombstone', edited?.visible === 0 && edited?.hidden === 0);

    const invisibleImage = new FormData();
    for (const [field, value] of Object.entries({
      title: marker, subtitle: 'Smoke subtitle', category: '其他', publisherName: 'Smoke publisher',
      author: 'Smoke author', description: 'Smoke description', visible: 'false',
      coverMode: 'image', coverText: '',
    })) invisibleImage.set(field, value);
    invisibleImage.set('coverImage', new Blob([
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], { type: 'image/png' }), 'cover.png');
    const invisibleImageEdit = await request('PATCH', `/api/admin/courses/${encodeURIComponent(`builtin:${builtinKey}`)}`, invisibleImage);
    check('saves an invisible built-in image override', invisibleImageEdit.status === 200,
      `status=${invisibleImageEdit.status} body=${JSON.stringify(invisibleImageEdit.json)}`);

    const publicList = await request('GET', '/api/courses/square?pageSize=1');
    const publicOverride = publicList.json?.builtinOverrides?.find((item) => item.course_key === builtinKey);
    const publicMerged = applyBuiltinOverrides([{ id: builtinKey, title: 'Bundled title' }], publicList.json?.builtinOverrides || []);
    check('square returns invisible built-in control rows and merged homepage excludes them', publicOverride?.visible === 0
      && publicMerged.length === 0);
    check('square suppressed built-in row contains only merge controls', JSON.stringify(Object.keys(publicOverride || {}).sort())
      === JSON.stringify(['course_key', 'hidden', 'visible']));

    const resetResponse = await request('PATCH', `/api/admin/courses/${encodeURIComponent(`builtin:${builtinKey}`)}`, {
      title: marker, subtitle: 'Smoke subtitle', category: '其他', publisherName: 'Smoke publisher',
      author: 'Smoke author', description: 'Smoke description', visible: true,
      coverMode: 'default', coverText: '',
    });
    const reset = resetResponse.json?.course;
    check('default mode clears cover overrides', reset?.cover_mode === 'default'
      && reset?.cover_image == null && reset?.cover_text == null);

    const uploadedImage = new FormData();
    for (const [field, value] of Object.entries({
      title: marker, subtitle: '', category: '其他', publisherName: 'Smoke', author: 'Smoke', description: '',
      visible: 'true', coverMode: 'image', coverText: '',
    })) uploadedImage.set(field, value);
    uploadedImage.set('coverImage', new Blob([
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], { type: 'image/png' }), 'cover.png');
    const uploadedImageEdit = await request('PATCH', `/api/admin/courses/${testCourseId}`, uploadedImage);
    const uploadedImageSquare = (await request('GET', '/api/courses/square?pageSize=100')).json?.items
      ?.find((course) => course.id === testCourseId);
    check('public uploaded image mode returns image data with null cover text', uploadedImageEdit.status === 200
      && uploadedImageSquare?.cover_data?.startsWith('data:image/png;base64,')
      && uploadedImageSquare?.cover_text == null,
    `status=${uploadedImageEdit.status} body=${JSON.stringify(uploadedImageEdit.json)} square=${JSON.stringify(uploadedImageSquare)}`);

    const hideUploaded = await request('PATCH', `/api/admin/courses/${testCourseId}`, {
      title: marker, subtitle: '', category: '其他', publisherName: 'Smoke', author: 'Smoke', description: '',
      visible: false, coverMode: 'default', coverText: '',
    });
    const squareAfterHide = await request('GET', '/api/courses/square?pageSize=100');
    const adminAfterHide = await request('GET', '/api/admin/courses');
    const squareIds = new Set((squareAfterHide.json?.items || []).map((item) => item.id));
    const adminIds = new Set((adminAfterHide.json?.courses || []).map((item) => item.id));
    check('hidden uploaded course leaves square but stays in admin list', hideUploaded.status === 200
      && !squareIds.has(testCourseId) && adminIds.has(testCourseId));
    check('package bytes remain unchanged', fs.readFileSync(packagePath).equals(packageBytes));

    const hide = await request('DELETE', `/api/admin/courses/${encodeURIComponent(`builtin:${builtinKey}`)}`);
    check('hides a built-in course', hide.status === 200 && hide.json?.deleted === true, `status=${hide.status}`);

    const listAfterHide = await request('GET', '/api/admin/courses');
    const hidden = listAfterHide.json?.builtinOverrides?.find((item) => item.course_key === builtinKey);
    check('built-in tombstone is returned', hidden?.hidden === 1);

    const stalePatch = await request('PATCH', `/api/admin/courses/${encodeURIComponent(`builtin:${builtinKey}`)}`, {
      title: marker, subtitle: 'stale', category: '其他', publisherName: 'Smoke publisher',
      author: 'Smoke author', description: 'stale edit', visible: true,
      coverMode: 'text', coverText: '旧编辑',
    });
    const afterStale = (await request('GET', '/api/admin/courses')).json?.builtinOverrides
      ?.find((item) => item.course_key === builtinKey);
    const tombstoneSquare = await request('GET', '/api/courses/square?pageSize=1');
    const tombstoneControl = tombstoneSquare.json?.builtinOverrides?.find((item) => item.course_key === builtinKey);
    const tombstoneMerged = applyBuiltinOverrides([{ id: builtinKey, title: 'Bundled title' }], tombstoneSquare.json?.builtinOverrides || [], { includeInvisible: true });
    check('stale built-in PATCH cannot revive a deletion tombstone', stalePatch.status === 200
      && afterStale?.hidden === 1 && tombstoneControl?.hidden === 1 && tombstoneMerged.length === 0);
    check('square tombstone row contains only merge controls', JSON.stringify(Object.keys(tombstoneControl || {}).sort())
      === JSON.stringify(['course_key', 'hidden', 'visible']));

    const removeUploaded = await request('DELETE', `/api/admin/courses/${testCourseId}`);
    const deletedRow = db.prepare('SELECT id FROM courses WHERE id=?').get(testCourseId);
    check('deletes uploaded course row and files', removeUploaded.status === 200
      && removeUploaded.json?.deleted === true && !deletedRow && !fs.existsSync(testCourseDir), `status=${removeUploaded.status}`);

    const audit = await request('GET', '/api/admin/audit?limit=200');
    const actions = new Set((audit.json?.entries || [])
      .filter((entry) => entry.actor_name === marker)
      .map((entry) => entry.action));
    check('audits course edits and deletes', actions.has('course_edit') && actions.has('course_delete'));
  } finally {
    db.prepare('DELETE FROM courses WHERE id=?').run(testCourseId);
    fs.rmSync(testCourseDir, { recursive: true, force: true });
    db.prepare('DELETE FROM courses WHERE id=?').run(otherCourseId);
    fs.rmSync(otherCourseDir, { recursive: true, force: true });

    if (tableExists(db, 'builtin_course_overrides')) {
      if (previousOverride) {
        db.prepare(
          `INSERT OR REPLACE INTO builtin_course_overrides
           (course_key,title,subtitle,description,author,publisher_name,category,hidden,
            visible,cover_mode,cover_image,cover_text,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          previousOverride.course_key, previousOverride.title, previousOverride.subtitle,
          previousOverride.description, previousOverride.author, previousOverride.publisher_name,
          previousOverride.category, previousOverride.hidden, previousOverride.visible,
          previousOverride.cover_mode, previousOverride.cover_image, previousOverride.cover_text,
          previousOverride.updated_at,
        );
      } else {
        db.prepare('DELETE FROM builtin_course_overrides WHERE course_key=?').run(builtinKey);
      }
    }
    db.prepare('DELETE FROM audit_log WHERE actor_id=?').run(admin.id);
    db.prepare('DELETE FROM users WHERE id=?').run(admin.id);
    db.close();
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
