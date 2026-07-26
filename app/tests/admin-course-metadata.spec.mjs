import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(here, '..', '..', 'server', 'data', 'pglib.db');
const token = randomBytes(32).toString('hex');
const uploadedId = 987654321;
const maliciousTitle = '" data-xss="injected" autofocus onfocus="globalThis.__courseXss=1';
const maliciousPendingKey = 'pending" data-pending-xss="injected" onfocus="globalThis.__courseXss=2';

async function main() {
  const db = new DatabaseSync(dbPath);
  const admin = db.prepare("SELECT id FROM users WHERE role='admin' AND disabled=0 ORDER BY id LIMIT 1").get();
  if (!admin) throw new Error('No active administrator exists in the local database');

  const now = Date.now();
  db.prepare(
    'INSERT INTO sessions(token,user_id,created_at,expires_at,ip,user_agent) VALUES(?,?,?,?,?,?)',
  ).run(token, admin.id, now, now + 10 * 60 * 1000, '127.0.0.1', 'admin-course-ui-test');

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1377, height: 812 } });
    await context.addCookies([{
      name: 'pglib_sess', value: token, domain: 'localhost', path: '/', sameSite: 'Lax',
    }]);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => { globalThis.__courseXss = 0; });
    await page.route('http://localhost:8787/api/admin/courses', (route) => route.fulfill({
      json: {
        courses: [{
          id: uploadedId,
          course_key: 'admin-ui-uploaded',
          title: '上传课程当前标题',
          subtitle: '上传课程当前副标题',
          description: '上传课程当前简介',
          author: '上传课程当前作者',
          publisher_name: '上传课程发布人',
          category: '其他',
          status: 'private',
          visible: 1,
          cover_mode: 'default',
          cover_image: null,
          cover_text_override: null,
          cover_data: null,
          cover_text: '上传',
          current_version_id: 1,
          latest_version_id: 1,
          updated_at: now,
        }],
        builtinOverrides: [{
          course_key: 'ic-packaging',
          title: maliciousTitle,
          subtitle: '带引号的当前副标题',
          description: '安全属性回归测试',
          author: '当前作者',
          publisher_name: '当前发布人',
          category: '其他',
          hidden: 0,
          visible: 0,
          cover_mode: 'text',
          cover_image: null,
          cover_text: '隐藏封面',
          updated_at: now,
        }],
      },
    }));
    await page.route('http://localhost:8787/api/admin/courses/pending', (route) => route.fulfill({
      json: {
        items: [{
          course_id: uploadedId,
          version_id: 77,
          course_key: maliciousPendingKey,
          title: maliciousTitle,
          publisher_name: 'Pending publisher',
          category: '其他',
          version: '1.0.0',
          file_size: 100,
          created_at: now,
        }],
      },
    }));
    let uploadedDetailCalls = 0;
    await page.route(`http://localhost:8787/api/admin/courses/${uploadedId}`, async (route) => {
      uploadedDetailCalls += 1;
      if (uploadedDetailCalls === 1) await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({
        json: {
          course: {
            id: uploadedId,
            course_key: 'admin-ui-uploaded',
            title: '上传课程当前标题',
            subtitle: '上传课程当前副标题',
            description: '上传课程当前简介',
            author: '上传课程当前作者',
            publisher_name: '上传课程发布人',
            category: '其他',
            status: 'private',
            visible: 1,
            cover_mode: 'default',
            cover_image: null,
            cover_text: null,
          },
          original: {
            title: '上传包原始标题',
            subtitle: '上传包原始副标题',
            description: '上传包原始简介',
            author: '上传包原始作者',
            cover_image: '',
            cover_text: '原始封面',
          },
        },
      });
    });
    let patchCalls = 0;
    const submittedCoverImage = [];
    await page.route(/\/api\/admin\/courses\/builtin(?:%3A|:)ic-packaging$/, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      patchCalls += 1;
      submittedCoverImage.push(route.request().postData()?.includes('name="coverImage"') || false);
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (patchCalls === 1 || patchCalls === 3) {
        await route.fulfill({ json: { course: { title: '旧保存成功' } } });
        return;
      }
      await route.fulfill({
        status: 400,
        json: { error: { message: '旧请求失败，不得污染新表单' } },
      });
    });
    await page.goto('http://localhost:5173/admin.html');
    await page.waitForLoadState('networkidle');

    const edit = page.locator('[data-act="edit-course"]').first();
    if (await edit.count() === 0) {
      console.error('admin gate:', await page.locator('#adminGate').innerText());
      console.error('page errors:', pageErrors);
    }
    await edit.waitFor({ state: 'visible' });
    const pendingPreview = page.locator('#adminPending [data-act="preview-course"]');
    await pendingPreview.waitFor({ state: 'visible' });
    if (await pendingPreview.getAttribute('data-key') !== maliciousPendingKey) {
      throw new Error('Pending package key was not preserved as one attribute value');
    }
    if (await pendingPreview.getAttribute('data-pending-xss') !== null) {
      throw new Error('Pending package key injected a quoted data attribute');
    }
    if (await page.locator('#adminPending [data-xss="injected"]').count()) {
      throw new Error('Pending package title injected a quoted data attribute');
    }
    if (await page.evaluate(() => globalThis.__courseXss) !== 0) {
      throw new Error('Pending package metadata executed an injected event handler');
    }
    await edit.locator('xpath=ancestor::div[contains(@class,"admin-row")][1]//span[contains(@class,"is-hidden")]').waitFor({ state: 'visible' });
    await edit.click();
    await page.locator('#courseEditForm').waitFor({ state: 'visible' });

    const expected = new Set([
      'title', 'subtitle', 'category', 'publisherName', 'author', 'description',
      'visible', 'coverMode', 'coverImage', 'coverText',
    ]);
    const actual = await page.locator('#courseEditForm [name]').evaluateAll((nodes) => nodes.map((node) => node.name));
    const missing = [...expected].filter((name) => !actual.includes(name));
    if (missing.length) throw new Error(`Missing form fields: ${missing.join(', ')}`);

    await page.locator('[data-preview="original"]').waitFor({ state: 'visible' });
    await page.locator('[data-preview="current"]').waitFor({ state: 'visible' });
    const originalCover = page.locator('[data-preview="original"] .admin-preview-cover');
    await originalCover.waitFor({ state: 'visible' });
    const originalCoverVisible = await originalCover.evaluate((node) => (
      getComputedStyle(node).backgroundImage !== 'none'
      || Boolean(node.querySelector('[data-preview-cover-text]')?.textContent?.trim())
    ));
    if (!originalCoverVisible) throw new Error('Original cover did not render');
    if (await page.locator('#courseEditForm [name="visible"]').isChecked()) {
      throw new Error('Visibility control did not reflect the stored visible value');
    }

    const titleInput = page.locator('#courseEditForm [name="title"]');
    if (await titleInput.inputValue() !== maliciousTitle) {
      throw new Error('Quoted title was not preserved as one input value');
    }
    if (await titleInput.getAttribute('data-xss') !== null) {
      throw new Error('Quoted title injected an extra input attribute');
    }
    if (await page.evaluate(() => globalThis.__courseXss) !== 0) {
      throw new Error('Quoted title executed an injected event handler');
    }

    const originalTitle = await page.locator('[data-preview="original"] [data-preview-title]').textContent();
    await page.locator('#courseEditForm [name="title"]').fill('实时预览标题');
    await page.locator('#courseEditForm [name="coverMode"][value="text"]').check();
    await page.locator('#courseEditForm [name="coverText"]').fill('课程封面六字');
    await page.locator('[data-preview="current"] [data-preview-title]').waitFor({ state: 'visible' });
    if (await page.locator('[data-preview="current"] [data-preview-title]').textContent() !== '实时预览标题') {
      throw new Error('Current preview did not update its title');
    }
    if (await page.locator('[data-preview="current"] [data-preview-cover-text]').textContent() !== '课程封面六字') {
      throw new Error('Current preview did not render a six-character text cover');
    }
    if (await page.locator('[data-preview="current"] [data-preview-publisher]').textContent() !== '当前发布人') {
      throw new Error('Current preview did not show the public-card publisher');
    }
    if (await page.locator('[data-preview="current"] [data-preview-category]').textContent() !== '其他') {
      throw new Error('Current preview did not show the public-card category');
    }
    if (await page.locator('[data-preview="current"] [data-preview-visibility]').textContent() !== '已隐藏') {
      throw new Error('Current preview did not show the hidden state');
    }
    if (await page.locator('[data-preview="original"] [data-preview-title]').textContent() !== originalTitle) {
      throw new Error('Original preview changed while editing');
    }

    await page.locator('[data-act="close-modal"][aria-label="关闭"]').click();
    await page.locator('#modalOverlay').waitFor({ state: 'hidden' });
    const uploadedEdit = page.locator(`[data-act="edit-course"][data-course-ref="${uploadedId}"]`);
    await uploadedEdit.click();
    await page.locator('#adminModal .admin-empty').waitFor({ state: 'visible' });
    await page.locator('[data-act="close-modal"][aria-label="关闭"]').click();
    await page.locator('#modalOverlay').waitFor({ state: 'hidden' });
    await edit.click();
    await page.locator('#courseEditForm').waitFor({ state: 'visible' });
    await page.waitForTimeout(700);
    if (await page.locator('#courseEditForm [name="title"]').inputValue() !== maliciousTitle) {
      throw new Error('A delayed uploaded detail response replaced the newer editor');
    }

    await page.locator('[data-act="close-modal"][aria-label="关闭"]').click();
    await page.locator('#modalOverlay').waitFor({ state: 'hidden' });
    await uploadedEdit.click();
    await page.locator('#courseEditForm').waitFor({ state: 'visible' });
    if (await page.locator('[data-preview="original"] [data-preview-title]').textContent() !== '上传包原始标题') {
      throw new Error('Uploaded immutable original did not load from the detail endpoint');
    }
    if (await page.locator('#courseEditForm [name="title"]').inputValue() !== '上传课程当前标题') {
      throw new Error('Uploaded editor did not retain current metadata');
    }

    const closeEditor = async () => {
      await page.locator('[data-act="close-modal"][aria-label="关闭"]').click();
      await page.locator('#modalOverlay').waitFor({ state: 'hidden' });
    };
    const openUploadedWithDraft = async (draft) => {
      await uploadedEdit.click();
      await page.locator('#courseEditForm').waitFor({ state: 'visible' });
      await page.locator('#courseEditForm [name="title"]').fill(draft);
    };
    const submitBuiltinThenSwitch = async (draft) => {
      await closeEditor();
      await edit.click();
      await page.locator('#courseEditForm').waitFor({ state: 'visible' });
      const patchStarted = page.waitForRequest((request) => (
        request.method() === 'PATCH' && request.url().includes('builtin%3Aic-packaging')
      ));
      await page.locator('#courseEditForm button[type="submit"]').click();
      await patchStarted;
      await closeEditor();
      await openUploadedWithDraft(draft);
      await page.waitForTimeout(700);
    };

    await submitBuiltinThenSwitch('新编辑器保留成功竞态草稿');
    if (await page.locator('#modalOverlay').getAttribute('hidden') !== null) {
      throw new Error('An old successful save closed the newer editor');
    }
    if (await page.locator('#courseEditForm [name="title"]').inputValue() !== '新编辑器保留成功竞态草稿') {
      throw new Error('An old successful save discarded newer unsaved content');
    }

    await submitBuiltinThenSwitch('新编辑器保留失败竞态草稿');
    if (await page.locator('#courseEditForm [name="title"]').inputValue() !== '新编辑器保留失败竞态草稿') {
      throw new Error('An old failed save changed newer unsaved content');
    }
    if (await page.locator('#courseEditMsg').textContent() !== '') {
      throw new Error('An old failed save polluted the newer editor error message');
    }

    await closeEditor();
    await edit.click();
    await page.locator('#courseEditForm').waitFor({ state: 'visible' });
    await page.locator('#courseEditForm [name="title"]').fill('同一编辑器慢成功');
    const sameSuccessRequest = page.waitForRequest((request) => (
      request.method() === 'PATCH' && request.url().includes('builtin%3Aic-packaging')
    ));
    await page.locator('#courseEditForm button[type="submit"]').click();
    await sameSuccessRequest;
    if (!await page.locator('#courseEditForm [name="title"]').isDisabled()) {
      throw new Error('Same-editor inputs remained editable during a slow successful save');
    }
    await page.locator('#modalOverlay').waitFor({ state: 'hidden' });

    await edit.click();
    await page.locator('#courseEditForm').waitFor({ state: 'visible' });
    await page.locator('#courseEditForm [name="title"]').fill('同一编辑器慢失败保留');
    const sameFailureRequest = page.waitForRequest((request) => (
      request.method() === 'PATCH' && request.url().includes('builtin%3Aic-packaging')
    ));
    await page.locator('#courseEditForm button[type="submit"]').click();
    await sameFailureRequest;
    if (!await page.locator('#courseEditForm [name="title"]').isDisabled()) {
      throw new Error('Same-editor inputs remained editable during a slow failed save');
    }
    await page.waitForFunction(() => document.querySelector('#courseEditMsg')?.textContent?.trim());
    if (await page.locator('#courseEditForm [name="title"]').inputValue() !== '同一编辑器慢失败保留') {
      throw new Error('Slow failure discarded the submitted snapshot');
    }
    if (await page.locator('#courseEditForm [name="title"]').isDisabled()) {
      throw new Error('Slow failure did not restore form controls');
    }

    await page.locator('#courseEditForm [name="coverMode"][value="image"]').check();
    await page.locator('#courseEditForm [name="coverImage"]').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await page.locator('#courseEditForm [name="coverMode"][value="text"]').check();
    await page.locator('#courseEditForm [name="coverText"]').fill('文字模式');
    await page.locator('#courseEditForm button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('#courseEditMsg')?.textContent?.trim());
    if (submittedCoverImage.at(-1)) {
      throw new Error('Text mode submitted an inactive coverImage part');
    }

    const assertNoHorizontalOverflow = async (label) => {
      const result = await page.evaluate(() => {
        const modal = document.querySelector('#adminModal');
        const rect = modal.getBoundingClientRect();
        return {
          viewportWidth: document.documentElement.clientWidth,
          documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          modalLeft: rect.left,
          modalRight: rect.right,
        };
      });
      if (result.documentOverflow || result.modalLeft < 0 || result.modalRight > result.viewportWidth) {
        throw new Error(`${label} horizontal overflow: ${JSON.stringify(result)}`);
      }
    };

    const screenshotDir = process.env.SCREENSHOT_DIR;
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: path.join(screenshotDir, 'admin-course-desktop.png'), fullPage: true });
    }
    await assertNoHorizontalOverflow('desktop');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await assertNoHorizontalOverflow('mobile dark');
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, 'admin-course-mobile-dark.png'), fullPage: true });
    }

    const offlinePage = await context.newPage();
    const offlineErrors = [];
    offlinePage.on('pageerror', (error) => offlineErrors.push(error.message));
    await offlinePage.route('http://localhost:8787/api/**', (route) => route.abort());
    await offlinePage.goto('http://localhost:5173/index.html');
    await offlinePage.waitForLoadState('networkidle');
    if (await offlinePage.locator('.course-card').count() === 0) {
      throw new Error('Homepage rendered no bundled courses while the backend was unavailable');
    }
    if (offlineErrors.length) throw new Error(`Offline homepage errors: ${offlineErrors.join('; ')}`);
  } finally {
    if (browser) await browser.close();
    db.prepare('DELETE FROM sessions WHERE token=?').run(token);
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
