# Admin Course Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow administrators to edit and delete metadata for uploaded and built-in courses from the existing “全部课程” panel.

**Architecture:** Uploaded-course metadata remains authoritative in `courses`; built-in defaults remain in the frontend registry and receive server-side overrides/tombstones keyed by `course_key`. Public course responses carry built-in overrides so online clients merge them while offline clients continue using bundled defaults.

**Tech Stack:** Node.js 22, Express, `node:sqlite`, browser ES modules, Vite, existing CSS design tokens.

## Global Constraints

- Do not change `.pigeon` course contents or the `.pigeon` format contract.
- Keep the frontend fully usable without the optional backend.
- Use existing design tokens; add no hard-coded colors, UI emoji, or decorative vertical borders.
- Use flex/grid/gap/margin for layout; do not add hard-coded `top`/`left` positioning.
- Preserve unrelated worktree changes and do not edit `参考项目/`.
- Existing Chinese source files must remain UTF-8 without BOM or mojibake.
- Do not create Git commits unless the user explicitly requests them.

## File Map

- Modify `server/schema.sql`: persist built-in metadata overrides and hidden state.
- Modify `server/db-courses.js`: CRUD for uploaded metadata and built-in overrides.
- Modify `server/routes/admin-courses.js`: admin validation, edit/delete endpoints, package deletion, audit.
- Modify `server/routes/courses.js`: include built-in overrides in public square response.
- Modify `server/scripts/smoke.mjs`: exercise authorization, edit/delete, restore, and audit behavior.
- Modify `app/src/core/course-source.js`: normalize and expose built-in overrides from square responses.
- Modify `app/src/main-home.js`: merge online overrides into bundled built-ins and honor tombstones.
- Modify `app/src/main-admin.js`: merged listing, edit modal, delete confirmation, loading/error states.
- Modify `app/src/styles/admin.css`: token-driven form layout and textarea styling.
- Modify `docs/user-system-design.md`, `server/README.md`, and `app/README.md`: document contract and UI behavior.

---

### Task 1: Persist and Validate Course Metadata

**Files:**
- Modify: `server/schema.sql`
- Modify: `server/db-courses.js`
- Modify: `server/routes/admin-courses.js`
- Test: `server/scripts/smoke.mjs`

**Interfaces:**
- Produces: `coursesDb.updateMetadata(id, metadata, now)`.
- Produces: `coursesDb.builtinOverrides()`.
- Produces: `coursesDb.upsertBuiltinOverride(courseKey, metadata, now)`.
- Produces: `coursesDb.hideBuiltin(courseKey, now)`.
- Produces: `PATCH /api/admin/courses/:ref` and `DELETE /api/admin/courses/:ref`; `ref` is a numeric server ID or `builtin:<course_key>`.

- [ ] **Step 1: Add failing smoke assertions for authorization and validation**

Extend the existing admin section in `server/scripts/smoke.mjs` to check that a normal user receives `403` for both new endpoints and that an admin receives `400` for an empty title, an empty publisher, an invalid category, and text beyond the declared limits.

```js
const forbiddenEdit = await cb2('PATCH', '/api/admin/courses/builtin:ic-packaging', {
  title: 'IC封装技术', subtitle: '', category: '', publisherName: 'PigeonLib', author: 'PigeonLib', description: '',
});
check('admin course edit 403 for user', forbiddenEdit.status === 403, `status=${forbiddenEdit.status}`);

const invalidEdit = await ca2('PATCH', '/api/admin/courses/builtin:ic-packaging', {
  title: '', subtitle: '', category: 'invalid', publisherName: '', author: '', description: '',
});
check('admin course edit validates metadata', invalidEdit.status === 400, `status=${invalidEdit.status}`);
```

- [ ] **Step 2: Run the smoke test and confirm the new assertions fail**

Run the server and then `cd server && npm run smoke`. Expected: existing checks pass; the new course metadata assertions fail because the routes do not exist.

- [ ] **Step 3: Add the built-in override table**

Add an idempotent table to `server/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS builtin_course_overrides (
  course_key      TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  subtitle        TEXT,
  description     TEXT,
  author          TEXT,
  publisher_name  TEXT NOT NULL,
  category        TEXT,
  hidden          INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);
```

- [ ] **Step 4: Add minimal database methods**

Implement parameterized SQL in `server/db-courses.js`:

```js
updateMetadata(id, value, now) {
  return db.prepare(`UPDATE courses
    SET title=?, subtitle=?, description=?, author=?, publisher_name=?, category=?, updated_at=?
    WHERE id=?`).run(value.title, value.subtitle || null, value.description || null,
      value.author || null, value.publisherName, value.category || null, now, id).changes;
},

builtinOverrides() {
  return db.prepare('SELECT * FROM builtin_course_overrides ORDER BY updated_at DESC').all();
},
```

Use `INSERT ... ON CONFLICT(course_key) DO UPDATE` for `upsertBuiltinOverride`, always resetting `hidden=0`. Use a separate upsert for `hideBuiltin` so deleting a never-edited built-in still creates a tombstone.

- [ ] **Step 5: Implement route parsing and validation**

In `server/routes/admin-courses.js`, normalize the request body with these limits: title `1..120`, subtitle `0..180`, publisher `1..120`, author `0..120`, description `0..2000`; category is empty or one of `COURSE_CATEGORIES`. Return `400 bad_request` for invalid data and `404 course_not_found` for an unknown numeric course.

For a numeric ref, update the `courses` row. For a `builtin:` ref, upsert the override. Return `{ course }` using snake_case fields already consumed by the frontend.

- [ ] **Step 6: Implement deletion and audit**

For numeric refs, resolve the course, remove `path.join(config.coursesDir, String(course.id))` with `fs.rmSync(..., { recursive: true, force: true })`, then delete the row. For built-in refs, write a tombstone. Audit as `course_edit` or `course_delete`, with the target course title/key in the detail.

- [ ] **Step 7: Add positive smoke checks with cleanup**

As admin, edit `builtin:ic-packaging`, verify `GET /api/admin/courses` returns the override, delete it, verify `hidden=1`, then restore the original metadata with PATCH so the smoke test leaves no visible behavior change. Check the latest audit list contains `course_edit` and `course_delete`.

- [ ] **Step 8: Run backend verification**

Run `cd server && npm run smoke`. Expected: all checks pass and the final summary reports `0 failed`.

### Task 2: Deliver and Merge Built-In Overrides

**Files:**
- Modify: `server/routes/courses.js`
- Modify: `app/src/core/course-source.js`
- Modify: `app/src/main-home.js`

**Interfaces:**
- Consumes: `coursesDb.builtinOverrides()`.
- Produces: `listSquare()` result `{ items, total, page, pageSize, offline, builtinOverrides }`.
- Produces: `applyBuiltinOverrides(defaults, overrides)` returning visible normalized built-in cards.

- [ ] **Step 1: Add a failing module-level merge check**

Export `applyBuiltinOverrides` from `course-source.js`, then verify from Node that an override changes metadata, a hidden override removes the course, and an empty override list preserves defaults:

```powershell
node -e "import('./app/src/core/course-source.js').then(({applyBuiltinOverrides}) => { const d=[{id:'a',title:'A',author:'P'}]; const r=applyBuiltinOverrides(d,[{course_key:'a',title:'B',publisher_name:'Q',hidden:0}]); if(r[0].title!=='B'||r[0].publisherName!=='Q') process.exit(1); })"
```

Expected before implementation: failure because `applyBuiltinOverrides` is not exported.

- [ ] **Step 2: Include overrides in square responses**

Return `builtinOverrides: coursesDb.builtinOverrides()` alongside the existing square payload. This is a read-only public metadata list and contains no user data.

- [ ] **Step 3: Implement the merge helper and response normalization**

Map overrides by `course_key`. Filter entries with `hidden === 1`; otherwise overlay only metadata fields and keep bundled URL/stats/cover/source fields. Ensure `listSquare` returns an empty override list on network failure so callers retain defaults.

- [ ] **Step 4: Apply overrides on the homepage**

Keep `hydrateBuiltin()` as the immediate offline render. After `fetchSquare()`, replace `state.builtin` using `applyBuiltinOverrides(BUILTIN_COURSES, r.builtinOverrides)`, then rebuild publisher/category filters and render. Do not block the first paint on the network.

- [ ] **Step 5: Run the merge checks and production build**

Run the Node merge command above and `cd app && npm run build`. Expected: both exit `0`; Vite reports a successful production build.

### Task 3: Add Admin Editing and Deletion UI

**Files:**
- Modify: `app/src/main-admin.js`
- Modify: `app/src/styles/admin.css`

**Interfaces:**
- Consumes: `GET /api/admin/courses` fields `{ courses, builtinOverrides }`.
- Consumes: `PATCH /api/admin/courses/:ref` and `DELETE /api/admin/courses/:ref`.
- Produces: edit form fields `title`, `subtitle`, `category`, `publisherName`, `author`, `description`.

- [ ] **Step 1: Render merged rows with stable refs**

Merge `BUILTIN_COURSES` with override rows using `course_key`. Omit hidden built-ins. Give every row a `ref`: numeric ID for uploaded courses, `builtin:<id>` for built-ins. Add icon-backed or concise text “编辑” and dangerous “删除” buttons while retaining preview/takedown controls where applicable.

- [ ] **Step 2: Build the edit modal**

Reuse `modalOverlay` and `adminModal`. Escape every interpolated course value. Use text inputs for title/subtitle/publisher/author, the existing category select, and a textarea for description. The form submits the six normalized fields to PATCH.

- [ ] **Step 3: Implement save feedback**

Disable the submit button during the request. On failure, retain the form and place the API message in `.admin-form-msg`. On success, close the modal, show a success toast, and reload all courses plus audit entries.

- [ ] **Step 4: Implement destructive delete flow**

Use the existing confirmation pattern with the exact course title. Disable the clicked button while DELETE is pending. On success, show a toast and reload all courses, pending courses, summary counts, and audit entries; on failure restore the button and show an error toast.

- [ ] **Step 5: Add token-driven form styles**

Extend `.admin-form input` styling to `textarea`; set `resize:vertical`, a stable minimum height, and inherited font/color. Add only flex/grid/gap responsive rules necessary for the six-field form. Do not modify `tokens.css`.

- [ ] **Step 6: Verify syntax and build**

Run `node --check app/src/main-admin.js` and `cd app && npm run build`. Expected: both exit `0`.

### Task 4: Update Contracts and Perform Browser QA

**Files:**
- Modify: `docs/user-system-design.md`
- Modify: `server/README.md`
- Modify: `app/README.md`
- Verify: `app/admin.html`, `app/index.html`

**Interfaces:**
- Documents the new table, endpoint contracts, deletion semantics, and offline fallback.

- [ ] **Step 1: Update the authoritative user-system contract**

Document `builtin_course_overrides`, the two admin methods, validation bounds, uploaded-course physical deletion, built-in tombstones, audit actions, and the fact that social/shelf/progress data keyed by `course_key` is retained.

- [ ] **Step 2: Update directory documentation**

Add the new admin course capabilities and endpoint summaries to `server/README.md` and `app/README.md`. Do not rewrite unrelated sections.

- [ ] **Step 3: Run text and encoding checks**

Run `git diff --check`, inspect the first bytes of every changed Chinese file to confirm no UTF-8 BOM, and search changed UI code/CSS for added emoji, hard-coded color literals, or `border-left`/`border-right`.

- [ ] **Step 4: Start the local services**

Start the optional backend on `http://localhost:8787` and Vite on an available port, preferring `http://localhost:5173`. Keep both sessions running through QA.

- [ ] **Step 5: Verify the administrator workflow in a browser**

At `1377 x 812`, edit an uploaded course and an internal course, verify refreshed values, cancel a delete once, complete a delete on disposable test data, and verify audit entries. Confirm buttons do not shift row layout and the modal has no overlap.

- [ ] **Step 6: Verify responsive and theme states**

Capture or inspect the admin page at desktop and mobile widths in light and dark themes. Check the six-field form, long descriptions, long publisher names, focus states, pending disabled controls, and error messages.

- [ ] **Step 7: Verify offline fallback**

Stop or bypass the backend and reload the homepage. Expected: bundled built-in courses render with default metadata and remain learnable; no remote failure blocks the UI.

- [ ] **Step 8: Final verification**

Run `cd server && npm run smoke`, `node --check app/src/main-admin.js`, and `cd app && npm run build` once more. Review `git diff --stat` and `git diff` to ensure every changed line traces to this feature.
