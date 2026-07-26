# Admin Course Visibility and Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reversible course visibility and image/text cover overrides to the admin course editor while showing the immutable original course display beside the current platform display.

**Architecture:** Store `visible`, `cover_mode`, `cover_image`, and `cover_text` at course level for uploaded courses and built-in overrides. Keep `.pigeon` files and review/version state unchanged; read uploaded package metadata only when an administrator opens the editor. Resolve effective cover data at the database/frontend boundary so the existing home card renderer continues to consume `coverDataUrl` and `coverText`.

**Tech Stack:** Node.js 22+, Express 4, `node:sqlite`, Multer, fflate, Vite 6, browser-native JavaScript, Node test runner, Playwright.

## Global Constraints

- Do not modify, rebuild, or replace any `.pigeon` package.
- Do not change `private / pending / published / rejected`, `current_version_id`, or `latest_version_id` when editing display settings.
- `visible` controls public-list discovery only; admin lists, owner lists, existing published download access, and local caches keep their current behavior.
- Cover modes are exactly `default`, `image`, and `text`; text covers contain 1–6 Unicode characters.
- Admin image covers accept only PNG, JPEG, or WebP and must not exceed 600 KB.
- Built-in `hidden` remains the deletion tombstone; temporary visibility uses the new `visible` field.
- Preserve local-first behavior: when the backend is unavailable, bundled courses use `BUILTIN_COURSES` without online overrides.
- Use existing tokens and admin visual patterns; do not add hard-coded colors, UI emoji, decorative vertical borders, or new top/left absolute positioning.
- Keep existing Chinese files UTF-8 without BOM or mojibake.
- Preserve unrelated dirty-worktree changes. Do not create commits unless the user explicitly authorizes them.
- Design authority: `docs/superpowers/specs/2026-07-22-admin-course-visibility-cover-design.md`.

## File Map

- `docs/user-system-design.md`: authoritative platform data/API contract; update before implementation.
- `server/schema.sql`, `server/db.js`: new columns and idempotent migration for existing databases.
- `server/db-courses.js`: persistence, effective-cover projections, public visibility filter, and admin update methods.
- `server/lib/course-cover.js`: pure validation and normalization for admin cover input.
- `server/lib/pigeon-server.js`: expose package `coverText` when reading original display metadata.
- `server/routes/admin-courses.js`: admin detail GET and atomic multipart/JSON PATCH.
- `server/tests/course-cover.test.mjs`: pure validation tests.
- `server/scripts/admin-course-metadata-smoke.mjs`: reversible API integration coverage.
- `app/src/core/session.js`: method-aware multipart request helper.
- `app/src/core/course-overrides.js`: effective built-in visibility/cover merge and reusable cover resolver.
- `app/src/core/course-source.js`: normalize effective and raw display fields for uploaded courses.
- `app/src/main-home.js`: continue rendering effective uploaded and built-in covers.
- `app/src/main-admin.js`: original/current previews, visibility toggle, cover controls, live preview, multipart save.
- `app/src/styles/admin.css`: responsive unframed preview layout and form controls.
- `app/tests/course-overrides.test.mjs`: cover/visibility merge unit tests.
- `app/tests/admin-course-metadata.spec.mjs`: desktop/mobile/dark/offline admin UI checks.
- `README.md`, `app/README.md`, `app/src/core/README.md`, `server/README.md`: user and directory documentation.

---

### Task 1: Contract, Schema, and Cover Validation

**Files:**
- Modify: `docs/user-system-design.md`
- Modify: `server/schema.sql`
- Modify: `server/db.js`
- Create: `server/lib/course-cover.js`
- Create: `server/tests/course-cover.test.mjs`
- Modify: `server/package.json`

**Interfaces:**
- Produces: `ADMIN_COVER_MAX_BYTES = 614400`.
- Produces: `CoverInputError extends Error` with `code` and `message`.
- Produces: `normalizeCoverSettings({ mode, text, file, existingImage, existingText }) -> { coverMode, coverImage, coverText }`.
- Produces: four SQLite columns on both `courses` and `builtin_course_overrides`.

- [ ] **Step 1: Update the authoritative user-system contract before changing schema or code**

Add the four columns to both table definitions, document `hidden` versus `visible`, add `GET /admin/courses/:ref`, and extend PATCH to multipart. Use these exact semantics:

```markdown
visible       INTEGER NOT NULL DEFAULT 1,         -- 公开列表展示开关,不改变审核状态
cover_mode    TEXT    NOT NULL DEFAULT 'default', -- default|image|text
cover_image   TEXT,                               -- 管理员图片覆盖(data URL,原图 <= 600 KB)
cover_text    TEXT,                               -- 管理员文字覆盖(1–6 Unicode 字符)
```

Document effective cover priority as `image override -> text override -> package/built-in default -> title first character` and state that offline bundled defaults remain visible when the optional backend is unavailable.

- [ ] **Step 2: Write failing pure validation tests**

Create `server/tests/course-cover.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_COVER_MAX_BYTES, CoverInputError, normalizeCoverSettings } from '../lib/course-cover.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('normalizes default, text, and image cover settings', () => {
  assert.deepEqual(normalizeCoverSettings({ mode: 'default', text: '旧值', existingImage: 'data:image/png;base64,AA==' }), {
    coverMode: 'default', coverImage: null, coverText: null,
  });
  assert.deepEqual(normalizeCoverSettings({ mode: 'text', text: '封装技术', existingImage: 'kept-image' }), {
    coverMode: 'text', coverImage: 'kept-image', coverText: '封装技术',
  });
  const image = normalizeCoverSettings({ mode: 'image', existingText: '旧文字', file: { mimetype: 'image/png', buffer: png }, existingImage: null });
  assert.equal(image.coverMode, 'image');
  assert.match(image.coverImage, /^data:image\/png;base64,/);
  assert.equal(image.coverText, '旧文字');
});

test('counts text by Unicode code points and enforces one through six characters', () => {
  assert.equal(normalizeCoverSettings({ mode: 'text', text: '课程封面六字' }).coverText, '课程封面六字');
  assert.throws(() => normalizeCoverSettings({ mode: 'text', text: '' }), CoverInputError);
  assert.throws(() => normalizeCoverSettings({ mode: 'text', text: '超过六个字符了' }), CoverInputError);
});

test('rejects missing, oversized, mismatched, and unsupported image uploads', () => {
  assert.equal(ADMIN_COVER_MAX_BYTES, 600 * 1024);
  assert.throws(() => normalizeCoverSettings({ mode: 'image', existingImage: null }), CoverInputError);
  assert.throws(() => normalizeCoverSettings({ mode: 'image', file: { mimetype: 'image/png', buffer: Buffer.alloc(ADMIN_COVER_MAX_BYTES + 1) } }), CoverInputError);
  assert.throws(() => normalizeCoverSettings({ mode: 'image', file: { mimetype: 'image/png', buffer: Buffer.from('not png') } }), CoverInputError);
  assert.throws(() => normalizeCoverSettings({ mode: 'image', file: { mimetype: 'image/gif', buffer: Buffer.from('GIF89a') } }), CoverInputError);
});
```

- [ ] **Step 3: Run the test and confirm the new module is missing**

Run: `node --test server/tests/course-cover.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/lib/course-cover.js`.

- [ ] **Step 4: Implement the minimum cover validator**

Create `server/lib/course-cover.js` with these exports and signature checks:

```js
export const ADMIN_COVER_MAX_BYTES = 600 * 1024;

export class CoverInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CoverInputError';
    this.code = 'bad_request';
  }
}

const TYPES = {
  'image/png': (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

export function normalizeCoverSettings({ mode, text = '', file = null, existingImage = null, existingText = null }) {
  if (!['default', 'image', 'text'].includes(mode)) throw new CoverInputError('封面模式无效');
  if (mode === 'default') return { coverMode: 'default', coverImage: null, coverText: null };
  if (mode === 'text') {
    const value = String(text).trim();
    if (Array.from(value).length < 1 || Array.from(value).length > 6) throw new CoverInputError('文字封面须为 1–6 个字符');
    return { coverMode: 'text', coverImage: existingImage || null, coverText: value };
  }
  if (!file && !existingImage) throw new CoverInputError('请选择封面图片');
  if (!file) return { coverMode: 'image', coverImage: existingImage, coverText: existingText || null };
  if (file.buffer.length > ADMIN_COVER_MAX_BYTES) throw new CoverInputError('封面图片不能超过 600 KB');
  const check = TYPES[file.mimetype];
  if (!check || !check(file.buffer)) throw new CoverInputError('封面图片仅支持 PNG、JPEG 或 WebP');
  return {
    coverMode: 'image',
    coverImage: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
    coverText: existingText || null,
  };
}
```

- [ ] **Step 5: Add schema defaults and idempotent old-database migration**

Add the four columns to both `CREATE TABLE` statements in `server/schema.sql`. In `server/db.js`, extend the existing `PRAGMA table_info` migration:

```js
if (!courseCols.includes('visible')) db.exec('ALTER TABLE courses ADD COLUMN visible INTEGER NOT NULL DEFAULT 1');
if (!courseCols.includes('cover_mode')) db.exec("ALTER TABLE courses ADD COLUMN cover_mode TEXT NOT NULL DEFAULT 'default'");
if (!courseCols.includes('cover_image')) db.exec('ALTER TABLE courses ADD COLUMN cover_image TEXT');
if (!courseCols.includes('cover_text')) db.exec('ALTER TABLE courses ADD COLUMN cover_text TEXT');

const builtinOverrideCols = db.prepare('PRAGMA table_info(builtin_course_overrides)').all().map((c) => c.name);
if (!builtinOverrideCols.includes('visible')) db.exec('ALTER TABLE builtin_course_overrides ADD COLUMN visible INTEGER NOT NULL DEFAULT 1');
if (!builtinOverrideCols.includes('cover_mode')) db.exec("ALTER TABLE builtin_course_overrides ADD COLUMN cover_mode TEXT NOT NULL DEFAULT 'default'");
if (!builtinOverrideCols.includes('cover_image')) db.exec('ALTER TABLE builtin_course_overrides ADD COLUMN cover_image TEXT');
if (!builtinOverrideCols.includes('cover_text')) db.exec('ALTER TABLE builtin_course_overrides ADD COLUMN cover_text TEXT');
```

Add `"test:admin-cover": "node --test tests/course-cover.test.mjs"` to `server/package.json`.

- [ ] **Step 6: Run validation and migration checks**

Run: `npm run test:admin-cover` from `server/`.

Expected: `3` tests pass, `0` fail.

Run: `node --disable-warning=ExperimentalWarning -e "import('./db.js').then(({db})=>{for(const t of ['courses','builtin_course_overrides']) console.log(t,db.prepare('PRAGMA table_info('+t+')').all().filter(c=>['visible','cover_mode','cover_image','cover_text'].includes(c.name)).map(c=>c.name));db.close()})"` from `server/`.

Expected: both tables print all four column names.

- [ ] **Step 7: Review checkpoint**

Run: `git diff --check -- docs/user-system-design.md server/schema.sql server/db.js server/lib/course-cover.js server/tests/course-cover.test.mjs server/package.json`

Expected: no output. Do not commit without explicit user authorization.

---

### Task 2: Database Projections and Admin API

**Files:**
- Modify: `server/db-courses.js`
- Modify: `server/lib/pigeon-server.js`
- Modify: `server/routes/admin-courses.js`
- Modify: `server/scripts/admin-course-metadata-smoke.mjs`

**Interfaces:**
- Consumes: `normalizeCoverSettings()` and the four migrated columns from Task 1.
- Produces: `parsePigeonBuffer(buffer).coverText`.
- Produces: `GET /api/admin/courses/:ref -> { course, original }`.
- Produces: multipart or JSON `PATCH /api/admin/courses/:ref` with atomic metadata/display update.
- Produces: list rows containing raw display settings plus effective `cover_data` and `cover_text`.

- [ ] **Step 1: Extend the reversible API smoke with failing display assertions**

Update `server/scripts/admin-course-metadata-smoke.mjs` so `request()` accepts JSON or `FormData`:

```js
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
```

Import `zipSync` and `strToU8` from `fflate`, then create the uploaded test package and insert a published version so the test can prove original-package reads and public visibility:

```js
const packageBytes = Buffer.from(zipSync({
  'manifest.json': strToU8(JSON.stringify({
    schemaVersion: 1, id: testCourseKey, title: 'Package title', subtitle: 'Package subtitle',
    description: 'Package description', author: 'Package author', coverText: '原封面',
    chapters: [{ id: '1', title: '第一章', sections: [{ id: '1.1', title: '第一节', knowledgePoints: [{ id: '1-1-1', title: '知识点' }] }] }],
  })),
  'content.json': strToU8(JSON.stringify({ knowledgePoints: {} })),
}));
```

Add checks for:

```js
check('detail returns immutable package display', detail.status === 200
  && detail.json?.original?.title === 'Package title'
  && detail.json?.original?.cover_text === '原封面');
check('six-character text cover saves', edited.cover_mode === 'text' && edited.cover_text === '课程封面六字');
check('seven-character text cover is rejected atomically', invalidText.status === 400 && unchanged.cover_text === '课程封面六字');
check('hidden uploaded course leaves square but stays in admin list', !squareIds.has(testCourseId) && adminIds.has(testCourseId));
check('built-in visibility is separate from deletion tombstone', builtin.visible === 0 && builtin.hidden === 0);
check('default mode clears cover overrides', reset.cover_mode === 'default' && reset.cover_image == null && reset.cover_text == null);
check('package bytes remain unchanged', fs.readFileSync(packagePath).equals(packageBytes));
```

Restore all four new built-in override columns in `finally`, just as the existing metadata fields are restored.

- [ ] **Step 2: Run the smoke and verify the new assertions fail**

Run: `npm run smoke:admin-courses` from `server/` while the backend is running.

Expected: existing checks pass; new detail/display checks fail because the route and projections do not exist yet.

- [ ] **Step 3: Return package `coverText` for original-display reads**

In `server/lib/pigeon-server.js`, add this returned field without changing package bytes:

```js
coverText: typeof manifest.coverText === 'string' ? manifest.coverText : null,
```

Keep `coverBase64` behavior unchanged.

- [ ] **Step 4: Extend database updates and list projections**

In `server/db-courses.js`:

1. Extend `updateMetadata()` to set metadata and all four display fields in one `UPDATE` statement.
2. Extend `upsertBuiltinOverride()` with the four fields while keeping `hidden=0` for an edited live built-in.
3. Do not let visibility edits call `hideBuiltin()`.
4. Add `c.visible = 1` to the public square `WHERE` clauses in `square()` and `byKeyPublished()`.
5. Return raw `visible`, `cover_mode`, `cover_image`, and `cover_text AS cover_text_override` from `mine()`, `square()`, `byKeyPublished()`, and `allCourses()`.
6. Resolve effective card values with the following SQL expressions, substituting the correct joined version alias:

```sql
CASE c.cover_mode
  WHEN 'image' THEN c.cover_image
  WHEN 'text' THEN NULL
  ELSE cv.cover_data
END AS cover_data,
CASE c.cover_mode
  WHEN 'text' THEN c.cover_text
  ELSE NULL
END AS cover_text
```

For `allCourses()`, keep the existing current-version-then-latest fallback as `COALESCE(cur.cover_data, lat.cover_data)` inside the `ELSE` branch. A single SQL `UPDATE` or UPSERT is atomic; do not add a transaction abstraction around one statement.

- [ ] **Step 5: Add admin detail GET and multipart PATCH**

In `server/routes/admin-courses.js`:

- Configure a memory Multer instance with `ADMIN_COVER_MAX_BYTES` and a `coverImage` single-file wrapper.
- Parse `visible` from JSON boolean or multipart `'true'/'false'`; reject every other value.
- Call `normalizeCoverSettings()` with the existing stored image/text values.
- Keep metadata limits and category validation unchanged.
- For uploaded courses, choose `current_version_id || latest_version_id`, read the package path, and call `parsePigeonBuffer()` for the immutable `original` response.
- For built-ins, return the stored override and `original: null`; the frontend supplies `BUILTIN_COURSES`.

The route shapes must be:

```js
adminCoursesRouter.get('/:ref', (req, res) => {
  const ref = parseCourseRef(req.params.ref);
  if (!ref) return authError(res, 400, 'bad_request', 'invalid course reference');
  if (ref.source === 'builtin') {
    return res.json({ course: coursesDb.builtinOverrideByKey(ref.key) || null, original: null });
  }
  const course = coursesDb.courseById(ref.id);
  if (!course) return authError(res, 404, 'course_not_found', 'course not found');
  const version = coursesDb.versionById(course.current_version_id || course.latest_version_id);
  if (!version || !fs.existsSync(version.file_path)) return authError(res, 404, 'not_found', 'package file missing');
  const meta = parsePigeonBuffer(fs.readFileSync(version.file_path));
  return res.json({
    course,
    original: {
      title: meta.title, subtitle: meta.subtitle || '', description: meta.description || '', author: meta.author || '',
      cover_image: meta.coverBase64 || '', cover_text: meta.coverText || '', version: meta.version || '',
    },
  });
});
```

The PATCH handler must finish normalization before calling exactly one database update/UPSERT. Map `CoverInputError` to `400 bad_request` and Multer size errors to `413 payload_too_large`. Audit `course_edit` with a concise detail such as `server:12; visible=0; cover=text`; never include image data.

- [ ] **Step 6: Run API integration and backend regression**

Restart the backend so migrations and routes reload.

Run: `npm run smoke:admin-courses` from `server/`.

Expected: every check prints `PASS` and the final summary reports `0 failed`.

Run: `npm run smoke` from `server/`.

Expected: existing backend smoke reports `0 failed`.

Run: `npm run test:admin-cover` from `server/`.

Expected: `3` tests pass, `0` fail.

- [ ] **Step 7: Review checkpoint**

Run: `git diff --check -- server/db-courses.js server/lib/pigeon-server.js server/routes/admin-courses.js server/scripts/admin-course-metadata-smoke.mjs`

Expected: no output. Do not commit without explicit user authorization.

---

### Task 3: Frontend Cover Resolution and Data Normalization

**Files:**
- Modify: `app/tests/course-overrides.test.mjs`
- Modify: `app/src/core/course-overrides.js`
- Modify: `app/src/core/course-source.js`
- Modify: `app/src/core/session.js`
- Modify: `app/src/main-home.js`

**Interfaces:**
- Consumes: server effective `cover_data`, `cover_text`, and raw display fields from Task 2.
- Produces: `resolveCourseCover({ title, baseImage, baseText, mode, image, text }) -> { coverUrl, coverText }`.
- Produces: `applyBuiltinOverrides(defaults, overrides, { includeInvisible = false })`.
- Produces: `apiForm(method, path, formData)`.

- [ ] **Step 1: Add failing built-in merge tests**

Extend `app/tests/course-overrides.test.mjs`:

```js
import { applyBuiltinOverrides, resolveCourseCover } from '../src/core/course-overrides.js';

test('filters invisible built-ins for the square but retains them for admin', () => {
  const overrides = [{ course_key: 'alpha', hidden: 0, visible: 0, cover_mode: 'default' }];
  assert.deepEqual(applyBuiltinOverrides(defaults, overrides).map((c) => c.id), ['beta']);
  assert.deepEqual(applyBuiltinOverrides(defaults, overrides, { includeInvisible: true }).map((c) => c.id), ['alpha', 'beta']);
});

test('resolves image, text, and default covers without mutating the base course', () => {
  assert.deepEqual(resolveCourseCover({ title: '课程', baseImage: '/base.png', baseText: '原', mode: 'image', image: 'data:image/png;base64,AA==' }), {
    coverUrl: 'data:image/png;base64,AA==', coverText: '',
  });
  assert.deepEqual(resolveCourseCover({ title: '课程', baseImage: '/base.png', baseText: '原', mode: 'text', text: '新封面' }), {
    coverUrl: '', coverText: '新封面',
  });
  assert.deepEqual(resolveCourseCover({ title: '课程', baseImage: '/base.png', baseText: '原', mode: 'default' }), {
    coverUrl: '/base.png', coverText: '原',
  });
});
```

Extend the existing online metadata test to assert raw properties `visible`, `coverMode`, `coverImageOverride`, `coverTextOverride`, `baseCoverUrl`, and `baseCoverText`.

- [ ] **Step 2: Run the unit test and verify the new exports fail**

Run: `node --test app/tests/course-overrides.test.mjs`

Expected: FAIL because `resolveCourseCover` and the `includeInvisible` option do not exist.

- [ ] **Step 3: Implement effective built-in cover and visibility merging**

In `app/src/core/course-overrides.js`, export:

```js
export function resolveCourseCover({ title = '', baseImage = '', baseText = '', mode = 'default', image = '', text = '' }) {
  if (mode === 'image' && image) return { coverUrl: image, coverText: '' };
  if (mode === 'text' && text) return { coverUrl: '', coverText: text };
  return { coverUrl: baseImage, coverText: baseText || (baseImage ? '' : title.slice(0, 1)) };
}
```

Change `applyBuiltinOverrides()` to accept `{ includeInvisible = false } = {}`. Always filter `hidden === 1`; filter `visible === 0` only when `includeInvisible` is false. Preserve these properties on each merged course:

```js
visible: override?.visible !== 0,
coverMode: override?.cover_mode || 'default',
coverImageOverride: override?.cover_image || '',
coverTextOverride: override?.cover_text || '',
baseCoverUrl: course.coverUrl || '',
baseCoverText: course.coverText || '',
coverUrl: resolved.coverUrl,
coverText: resolved.coverText,
```

- [ ] **Step 4: Normalize uploaded display fields and add multipart PATCH support**

In `app/src/core/course-source.js`, add to `normalizeServerCourse()`:

```js
coverText: row.cover_text || '',
visible: row.visible !== 0,
coverMode: row.cover_mode || 'default',
coverImageOverride: row.cover_image || '',
coverTextOverride: row.cover_text_override || '',
```

Keep `coverDataUrl: row.cover_data || ''` as the effective image.

In `app/src/core/session.js`, add a method-aware helper without changing existing `apiUpload()` callers:

```js
export async function apiForm(method, path, formData) {
  try {
    const res = await fetch(API_BASE + path, { method, credentials: 'include', body: formData });
    let json = null;
    try { json = await res.json(); } catch { /* empty response */ }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null, networkError: true };
  }
}
```

- [ ] **Step 5: Keep home rendering on effective fields**

In `app/src/main-home.js`, keep `fetchSquare()` using default `applyBuiltinOverrides()` so invisible built-ins are removed. Ensure `normalizeBuiltins()` copies effective `course.coverUrl` and `course.coverText`; no visibility logic belongs in the card renderer.

- [ ] **Step 6: Run frontend unit and production build checks**

Run: `node --test app/tests/course-overrides.test.mjs`

Expected: all override tests pass.

Run: `npm run build` from `app/`.

Expected: Vite completes successfully with all HTML entry points built.

- [ ] **Step 7: Review checkpoint**

Run: `git diff --check -- app/tests/course-overrides.test.mjs app/src/core/course-overrides.js app/src/core/course-source.js app/src/core/session.js app/src/main-home.js`

Expected: no output. Do not commit without explicit user authorization.

---

### Task 4: Admin Original/Current Display Editor

**Files:**
- Modify: `app/src/main-admin.js`
- Modify: `app/src/styles/admin.css`
- Modify: `app/tests/admin-course-metadata.spec.mjs`

**Interfaces:**
- Consumes: `GET /api/admin/courses/:ref`, multipart PATCH, `apiForm()`, `resolveCourseCover()`, and `applyBuiltinOverrides(..., { includeInvisible: true })`.
- Produces: one modal showing immutable original display, live current display, metadata inputs, visibility, and cover controls.

- [ ] **Step 1: Extend the Playwright check before changing the UI**

Update `app/tests/admin-course-metadata.spec.mjs` to require these form fields and previews:

```js
const expected = new Set([
  'title', 'subtitle', 'category', 'publisherName', 'author', 'description',
  'visible', 'coverMode', 'coverImage', 'coverText',
]);
await page.locator('[data-preview="original"]').waitFor({ state: 'visible' });
await page.locator('[data-preview="current"]').waitFor({ state: 'visible' });

const originalTitle = await page.locator('[data-preview="original"] [data-preview-title]').textContent();
await page.locator('#courseEditForm [name="title"]').fill('实时预览标题');
await page.locator('#courseEditForm [name="coverMode"][value="text"]').check();
await page.locator('#courseEditForm [name="coverText"]').fill('课程封面六字');
await page.locator('[data-preview="current"] [data-preview-title]').waitFor({ state: 'visible' });
if (await page.locator('[data-preview="current"] [data-preview-title]').textContent() !== '实时预览标题') {
  throw new Error('Current preview did not update its title');
}
if (await page.locator('[data-preview="original"] [data-preview-title]').textContent() !== originalTitle) {
  throw new Error('Original preview changed while editing');
}
```

Add assertions that the original cover is visible, `visible` reflects the stored value, a six-character text cover renders, and the modal has no horizontal overflow at 1377×812 and 390×844 dark mode. Do not submit the form in this visual test; the reversible API smoke owns persistence checks.

- [ ] **Step 2: Run Playwright and confirm the new controls are absent**

With frontend and backend running, run: `node app/tests/admin-course-metadata.spec.mjs`.

Expected: FAIL waiting for `[data-preview="original"]` or the new field names.

- [ ] **Step 3: Preserve original built-in information in the admin list model**

In `renderAllCourses()`, create an immutable source lookup and call:

```js
const builtinSources = new Map(BUILTIN_COURSES.map((course) => [course.id, course]));
const builtins = applyBuiltinOverrides(BUILTIN_COURSES, overrides, { includeInvisible: true }).map((course) => {
  const source = builtinSources.get(course.id);
  return {
    id: null,
    ref: `builtin:${course.id}`,
    title: course.title,
    visible: course.visible,
    cover_mode: course.coverMode,
    cover_image: course.coverImageOverride,
    cover_text: course.coverTextOverride,
    original: {
      title: source.title,
      subtitle: source.subtitle || '',
      description: source.description || '',
      author: source.author || '',
      cover_image: source.coverUrl || '',
      cover_text: source.coverText || '',
    },
  };
});
```

Retain the existing subtitle, description, author, publisher, category, status, and timestamp properties in the returned row alongside the fields shown above. Display an `已隐藏` badge when `visible === false`. Do not show deletion tombstones because `applyBuiltinOverrides()` still removes `hidden === 1`.

- [ ] **Step 4: Load immutable uploaded originals before rendering the form**

Make the edit action async. For uploaded rows, request `GET /admin/courses/:ref`; for built-ins, use the attached `original`. Show the existing modal with a loading message during the request and preserve the error toast behavior if it fails.

Use one editor state object:

```js
let courseEditorState = null;

courseEditorState = {
  ref: course.ref,
  original,
  current: course,
  selectedImage: null,
  previewObjectUrl: '',
};
```

Clear and revoke `previewObjectUrl` from `closeModal()`.

- [ ] **Step 5: Render accessible original/current previews and edit controls**

Add a pure template helper in `main-admin.js`:

```js
function courseDisplayPreview(kind, value) {
  const image = value.cover_image || value.coverDataUrl || '';
  const coverText = value.cover_text || value.coverText || value.title?.slice(0, 1) || '课';
  return `<section class="admin-course-preview" data-preview="${kind}">
    <p class="admin-preview-label">${kind === 'original' ? '原始展示' : '当前展示'}</p>
    <div class="admin-preview-cover${image ? ' has-image' : ''}"${image ? ` style="background-image:url('${esc(image)}')"` : ''}>
      ${image ? '' : `<span data-preview-cover-text>${esc(coverText)}</span>`}
    </div>
    <div class="admin-preview-copy">
      <strong data-preview-title>${esc(value.title || '')}</strong>
      <span data-preview-subtitle>${esc(value.subtitle || '')}</span>
      <span data-preview-author>${esc(value.author || '未署名')}</span>
      <p data-preview-description>${esc(value.description || '')}</p>
    </div>
  </section>`;
}
```

Render the two previews in `.admin-course-previews`, then the existing fields with these label changes and controls:

```html
<label>发布人（平台）<input name="publisherName" type="text" maxlength="120" required></label>
<label>作者（内容署名）<input name="author" type="text" maxlength="120"></label>
<label class="admin-visibility-toggle"><input name="visible" type="checkbox">课程可见</label>
<fieldset class="admin-cover-fieldset">
  <legend>封面展示</legend>
  <div class="admin-cover-segments">
    <label><input name="coverMode" type="radio" value="default">原封面</label>
    <label><input name="coverMode" type="radio" value="image">图片</label>
    <label><input name="coverMode" type="radio" value="text">文字</label>
  </div>
  <label data-cover-panel="image">图片封面<input name="coverImage" type="file" accept="image/png,image/jpeg,image/webp"></label>
  <label data-cover-panel="text">文字封面<input name="coverText" type="text" aria-describedby="coverTextCount"></label>
  <span id="coverTextCount" class="admin-cover-count" aria-live="polite">0 / 6</span>
</fieldset>
```

Use radio inputs for the segmented control and a checkbox for visibility. Count with `Array.from(value.trim()).length`, update the counter on input, and call `setCustomValidity('文字封面须为 1–6 个字符')` outside the accepted range. Keep the original preview immutable.

- [ ] **Step 6: Implement live current preview and multipart save**

On `input` and `change`, read current form values, call `resolveCourseCover()` with the base/original and stored override values, and rerender only `[data-preview="current"]`. For a newly selected image, use `URL.createObjectURL(file)` and revoke the previous object URL.

Replace JSON submit with:

```js
const payload = new FormData();
for (const name of ['title', 'subtitle', 'category', 'publisherName', 'author', 'description']) {
  payload.set(name, String(data.get(name) || '').trim());
}
payload.set('visible', form.elements.visible.checked ? 'true' : 'false');
payload.set('coverMode', String(data.get('coverMode') || 'default'));
payload.set('coverText', String(data.get('coverText') || '').trim());
const image = form.elements.coverImage.files?.[0];
if (image) payload.set('coverImage', image);
const response = await apiForm('PATCH', `/admin/courses/${encodeURIComponent(ref)}`, payload);
```

Keep the form open and preserve selected values on failure. On success, show `课程展示信息已更新`, close, and call `loadAll()`.

- [ ] **Step 7: Add restrained responsive styling**

In `app/src/styles/admin.css`:

- Increase the course modal width with `width:min(920px,92vw)`, add `max-height:calc(100vh - 40px)` and `overflow-y:auto`.
- Use `.admin-course-previews{display:grid;grid-template-columns:1fr 1fr;gap:18px}`.
- Keep preview sections unframed; separate them from the form with an existing horizontal hairline token.
- Give covers a stable `aspect-ratio:16/7`, `background-size:cover`, and `background-position:center`.
- Style the segmented radios and checkbox using `var(--line-2)`, `var(--surface-sunken)`, `var(--gold)`, `var(--ink)`, and `var(--focus-ring)` only.
- At `max-width:600px`, switch previews and the form to one column.

Do not add new absolute positioning. The pre-existing modal positioning and close button are outside this feature scope.

- [ ] **Step 8: Run UI, unit, and build verification**

Run: `node app/tests/admin-course-metadata.spec.mjs`.

Expected: exits `0`, both previews remain stable/correct, and desktop/mobile overflow checks pass.

Run: `node --test app/tests/course-overrides.test.mjs`.

Expected: all tests pass.

Run: `npm run build` from `app/`.

Expected: Vite production build succeeds.

- [ ] **Step 9: Review checkpoint**

Run: `git diff --check -- app/src/main-admin.js app/src/styles/admin.css app/tests/admin-course-metadata.spec.mjs`

Expected: no output. Do not commit without explicit user authorization.

---

### Task 5: Documentation and End-to-End Regression

**Files:**
- Modify: `README.md`
- Modify: `app/README.md`
- Modify: `app/src/core/README.md`
- Modify: `server/README.md`
- Verify: `docs/user-system-design.md`

**Interfaces:**
- Consumes: completed API, frontend, tests, and design terminology from Tasks 1–4.
- Produces: synchronized user/developer documentation and final verification evidence.

- [ ] **Step 1: Update user-facing and directory documentation**

Use the same wording everywhere:

```markdown
管理员可编辑上传课和内置课的展示元数据，独立控制课程广场可见性，并在原封面、图片封面和 1–6 字文字封面之间切换；课程包、版本和审核状态不变。编辑弹层同时展示课程来源中的原始展示与平台当前展示。
```

In `server/README.md`, document `GET /api/admin/courses/:ref` and multipart-capable PATCH, plus `npm run test:admin-cover`. In `app/src/core/README.md`, document that `course-overrides.js` merges temporary visibility and cover modes while preserving offline defaults.

- [ ] **Step 2: Run the complete automated regression set**

With backend and Vite dev server running:

Run from `server/`:

```powershell
npm run test:admin-cover
npm run smoke:admin-courses
npm run smoke
```

Expected: every suite reports `0 failed`.

Run from the repository root:

```powershell
node --test app/tests/course-overrides.test.mjs
node app/tests/admin-course-metadata.spec.mjs
```

Expected: both commands exit `0`.

Run from `app/`:

```powershell
npm run build
```

Expected: Vite production build succeeds.

- [ ] **Step 3: Capture and inspect visual evidence**

Run from the repository root:

```powershell
$env:SCREENSHOT_DIR='C:\tmp\pigeonlib-admin-cover-qa'
node app/tests/admin-course-metadata.spec.mjs
Remove-Item Env:SCREENSHOT_DIR
```

Expected files:

- `C:\tmp\pigeonlib-admin-cover-qa\admin-course-desktop.png`
- `C:\tmp\pigeonlib-admin-cover-qa\admin-course-mobile-dark.png`

Inspect both images. Confirm original/current previews are distinguishable without nested cards, all labels fit, the 1–6 character text cover remains centered, action controls do not overlap, and the mobile sequence is original → current → form.

- [ ] **Step 4: Verify local-first behavior explicitly**

Use the Playwright offline route already in `app/tests/admin-course-metadata.spec.mjs` to abort `http://localhost:8787/api/**` and load `/index.html`.

Expected: at least one bundled `.course-card` renders, no page error occurs, and no online visibility/cover override blocks the static defaults.

- [ ] **Step 5: Verify encoding and forbidden-style constraints**

Run from the repository root:

```powershell
$paths = @(
  'app/src/main-admin.js','app/src/main-home.js','app/src/core/course-overrides.js','app/src/core/course-source.js',
  'app/src/core/session.js','app/src/styles/admin.css','server/routes/admin-courses.js','server/db-courses.js',
  'server/lib/course-cover.js','server/lib/pigeon-server.js','server/schema.sql','docs/user-system-design.md'
)
foreach ($path in $paths) {
  $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $path))
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { throw "UTF-8 BOM: $path" }
}
Select-String -Path $paths -Pattern '锟|�|馃|鈥|銆|绠|璇|蹇|鍙戝竷浜'
git diff -- 'app/src/styles/admin.css' | Select-String -Pattern '^\+.*(#[0-9A-Fa-f]{3,8}|border-left:|border-right:)'
```

Expected: no BOM exception; no mojibake matches; no output from the added-line CSS scan.

- [ ] **Step 6: Final diff review**

Run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: `git diff --check` has no output. Review only files named in this plan and leave unrelated dirty-worktree files untouched. Do not commit without explicit user authorization.
