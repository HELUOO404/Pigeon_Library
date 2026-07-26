import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const QA_DIR = path.join(ROOT, 'tools', 'autosmt-2026', 'qa');
const ORIGIN = process.env.PIGEON_QA_ORIGIN || 'http://127.0.0.1:5184';
const PLAYWRIGHT_PATH = process.env.PIGEON_PLAYWRIGHT_PATH;
if (!PLAYWRIGHT_PATH) throw new Error('PIGEON_PLAYWRIGHT_PATH must point to Playwright.');
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT_PATH);

const ALL_VIEWPORTS = [
  { width: 1377, height: 812, name: 'desktop' },
  { width: 2048, height: 1216, name: 'wide' },
  { width: 375, height: 812, name: 'mobile' },
];
const VIEWPORTS = process.env.PIGEON_QA_VIEWPORT
  ? ALL_VIEWPORTS.filter((viewport) => viewport.name === process.env.PIGEON_QA_VIEWPORT)
  : ALL_VIEWPORTS;
if (!VIEWPORTS.length) throw new Error(`Unknown PIGEON_QA_VIEWPORT: ${process.env.PIGEON_QA_VIEWPORT}`);
const PACKAGING = '2026-ic-packaging';
const MANUFACTURING = '2026-ic-manufacturing';
const SANDBOX_KEY = 'sandbox:experiment-1-oxidation-temperature-curve';
const PROGRESS_FILE = path.join(QA_DIR, 'vocational-browser-progress.log');

function progress(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  writeFileSync(PROGRESS_FILE, `${line}\n`, { encoding: 'utf8', flag: 'a' });
}

function localBrowser() {
  return [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => candidate && existsSync(candidate));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifactEvidence(file) {
  const bytes = readFileSync(file);
  return {
    path: path.relative(ROOT, file).replace(/\\/g, '/'),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function jsonHeaders(origin) {
  return {
    'access-control-allow-origin': origin || ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
    'content-type': 'application/json; charset=utf-8',
  };
}

async function installMockSync(context, calls) {
  await context.route('http://localhost:8787/api/**', async (route) => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname.replace(/^\/api/, '');
    const headers = jsonHeaders(request.headers().origin);
    calls.push({ method: request.method(), endpoint });
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' });
    } else if (request.method() === 'GET' && endpoint === '/me') {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ user: { id: 'qa-user', username: 'qa-user', role: 'user' } }),
      });
    } else if (request.method() === 'GET' && endpoint === '/sync') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ states: [] }) });
    } else if (request.method() === 'PUT' && endpoint.startsWith('/state/')) {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ applied: true, updated_at: 4102444800000 }),
      });
    } else {
      await route.fulfill({ status: 404, headers, body: JSON.stringify({ error: 'unexpected QA API call' }) });
    }
  });
}

async function isolatePlatformFonts(context, calls) {
  await context.route('https://fonts.googleapis.com/**', async (route) => {
    calls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' });
  });
}

async function loadCourse(page, courseId, readyCard) {
  const url = `${ORIGIN}/learn.html?course=${courseId}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await showCardChapter(page, readyCard);
  return url;
}

async function showCardChapter(page, cardId) {
  const header = page.locator(`.card-header[data-kp-id="${cardId}"]`);
  await header.waitFor({ state: 'attached', timeout: 120_000 });
  const chapter = String(cardId).split('-')[0];
  const tab = page.locator(`#chapterTabs .tab[data-chapter="${chapter}"]`);
  if (await tab.count() && !(await tab.getAttribute('class') || '').includes('active')) await tab.click();
  await header.waitFor({ state: 'visible', timeout: 120_000 });
}

async function openCard(page, id) {
  await showCardChapter(page, id);
  const header = page.locator(`.card-header[data-kp-id="${id}"]`);
  const body = page.locator(`#kp-${id} .card-body`);
  await header.waitFor({ state: 'visible' });
  if ((await body.getAttribute('class') || '').includes('hidden')) await header.click();
  await body.waitFor({ state: 'visible' });
  await page.waitForFunction((selector) => {
    const node = document.querySelector(selector);
    return node && !node.classList.contains('is-animating');
  }, `#kp-${id} .card-body`);
}

async function layoutAudit(page, label) {
  const result = await page.evaluate(() => {
    const visible = (node) => node.getClientRects().length > 0;
    const selectors = [
      '.knowledge-card', '.card-body-content', '.params-table-wrap', '.params-table-mobile',
      '.param-select', '.param-select-table-wrap', '.param-select-mobile',
      '.param-select-mobile-record', '.param-select-merged-images',
      '.tab-set', '.sandbox-wrapper', '.sandbox-frame', '.section-quiz', '.quiz-item',
    ];
    const offenders = [...document.querySelectorAll(selectors.join(','))]
      .filter(visible)
      .map((node) => ({
        selector: node.id || node.className || node.tagName,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        left: node.getBoundingClientRect().left,
        right: node.getBoundingClientRect().right,
      }))
      .filter((item) => (
        item.scrollWidth > item.clientWidth + 1
        || item.left < -1
        || item.right > innerWidth + 1
      ));
    return {
      innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      offenders,
    };
  });
  assert.ok(result.documentWidth <= result.innerWidth + 1, `${label}: document horizontal overflow`);
  assert.ok(result.bodyWidth <= result.innerWidth + 1, `${label}: body horizontal overflow`);
  assert.deepEqual(result.offenders, [], `${label}: visible content horizontal overflow`);
  return result;
}

async function imageAudit(locator, label) {
  const count = await locator.count();
  assert.ok(count > 0, `${label}: no images rendered`);
  for (let index = 0; index < count; index += 1) {
    const image = locator.nth(index);
    if (!await image.isVisible()) continue;
    await image.scrollIntoViewIfNeeded();
    const result = await image.evaluate(async (node) => {
      await Promise.race([
        node.decode(),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('image decode timeout')), 10_000)),
      ]);
      return { src: node.src, width: node.naturalWidth, height: node.naturalHeight };
    });
    assert.match(result.src, /^blob:/, `${label}: unresolved course asset`);
    assert.ok(result.width > 0 && result.height > 0, `${label}: image did not decode`);
  }
  return count;
}

async function multiImageProof(page, viewportName) {
  const data = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await page.evaluate(async (image) => {
    const { renderParamSelect } = await import('/src/render/param-select.js');
    const host = document.createElement('div');
    host.id = 'qa-param-two-images';
    host.innerHTML = renderParamSelect({
      type: 'paramSelect',
      id: 'qa-param-two-images-block',
      headers: ['序号', '示意图', '参数名称', '选择'],
      groups: [{
        merged: [{ images: [{ src: image, alt: '图示' }, { src: image, alt: '设备' }] }],
        params: [{ label: '验证参数', options: ['一', '二'], answerIndex: 1 }],
      }],
    }, { resolveAsset: (src) => src });
    document.querySelector('#main').append(host);
  }, data);
  const proof = page.locator('#qa-param-two-images');
  const representation = proof.locator(viewportName === 'mobile' ? '.param-select-mobile' : '.param-select-table-wrap');
  await representation.scrollIntoViewIfNeeded();
  assert.equal(await representation.isVisible(), true, `${viewportName}: multi-image proof representation hidden`);
  const images = representation.locator('.param-select-merged-images img');
  assert.equal(await images.count(), 2, `${viewportName}: one merged cell did not show two images`);
  assert.deepEqual(await images.evaluateAll((nodes) => nodes.map((node) => node.alt)), ['图示', '设备']);
  assert.doesNotMatch(await proof.innerText(), /\[object Object\]/);
  await proof.evaluate((node) => node.remove());
  return { visibleImages: 2, alt: ['图示', '设备'] };
}

async function quizWrongAnswerAudit(page, { kpId, questionId, correct, wrong }, label) {
  await openCard(page, kpId);
  const item = page.locator(`#kp-${kpId} .quiz-item[data-qid="${questionId}"]`);
  await item.locator(`label:has(input[value="${wrong}"])`).click();
  await item.locator('[data-action="submit-quiz"]').click();
  assert.match(await item.locator(`label:has(input[value="${correct}"])`).getAttribute('class') || '', /correct/, `${label}: correct option not highlighted`);
  assert.match(await item.locator(`label:has(input[value="${wrong}"])`).getAttribute('class') || '', /wrong/, `${label}: wrong option not marked`);
  return { kpId, questionId, correct, wrong };
}

async function packagingAudit(page, viewport) {
  progress(`[${viewport.name}] packaging: load`);
  await loadCourse(page, PACKAGING, '5-2-6');
  await openCard(page, '5-2-6');
  progress(`[${viewport.name}] packaging: structure rendered`);
  const root = page.locator('.param-select[data-param-id="engineering-5-0-params"]');
  await root.waitFor({ state: 'visible' });
  assert.equal(await root.locator('.param-select-number').count(), 46, `${viewport.name}: desktop parameter count`);
  assert.equal(await root.locator('.param-select-mobile-record').count(), 46, `${viewport.name}: mobile parameter count`);
  assert.equal(await root.locator('.param-select-mobile-group').count(), 9, `${viewport.name}: mobile group count`);
  assert.equal(await root.locator('.param-select-mobile-group-context').count(), 9, `${viewport.name}: mobile context count`);
  assert.equal(await root.locator('.param-select-table-wrap').isVisible(), viewport.name !== 'mobile');
  assert.equal(await root.locator('.param-select-mobile').isVisible(), viewport.name === 'mobile');
  assert.doesNotMatch(await root.innerText(), /\[object Object\]/);
  const imageCount = await imageAudit(root.locator('.param-select-merged-images img'), `${viewport.name} engineering 5`);
  progress(`[${viewport.name}] packaging: images decoded`);

  progress(`[${viewport.name}] packaging: interaction and refresh`);
  let select = root.locator('.step-simulation-choice:visible').first();
  await select.focus();
  const chosen = await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(chosen);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.param), '1', `${viewport.name}: focus left visible representation`);
  await page.waitForTimeout(1_600);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await showCardChapter(page, '5-2-6');
  await openCard(page, '5-2-6');
  select = page.locator('.param-select[data-param-id="engineering-5-0-params"] .step-simulation-choice:visible').first();
  assert.equal(await select.inputValue(), chosen, `${viewport.name}: parameter state did not survive refresh`);

  const refreshedRoot = page.locator('.param-select[data-param-id="engineering-5-0-params"]');
  await refreshedRoot.locator('[data-action="param-mode"][data-mode="answer"]').click();
  assert.equal(await refreshedRoot.locator('.param-select-answer:visible').count(), 46, `${viewport.name}: answer mode incomplete`);
  await refreshedRoot.locator('[data-action="param-mode"][data-mode="practice"]').click();
  assert.equal(await refreshedRoot.locator('.step-simulation-choice:visible').first().inputValue(), chosen, `${viewport.name}: practice state lost`);

  progress(`[${viewport.name}] packaging: quiz and persistence`);
  const quiz = await quizWrongAnswerAudit(page, {
    kpId: '4-1-1', questionId: '4-001', correct: 'A', wrong: 'B',
  }, `${viewport.name} packaging quiz`);
  await page.waitForTimeout(1_600);
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('pglib:u:qa-user:2026-ic-packaging:simulations');
    return raw ? JSON.parse(raw)['engineering-5-0-params'] : null;
  });
  assert.equal(stored?.selected?.['1'], Number(chosen), `${viewport.name}: logged-in parameter state missing`);
  await showCardChapter(page, '5-2-6');
  await openCard(page, '5-2-6');
  await refreshedRoot.scrollIntoViewIfNeeded();
  const screenshot = path.join(QA_DIR, `vocational-packaging-${viewport.name}.png`);
  await page.screenshot({ path: screenshot });
  return {
    layout: await layoutAudit(page, `${viewport.name} packaging`),
    parameters: 46,
    groups: 9,
    sourceImagesAcrossRepresentations: imageCount,
    persistence: true,
    quiz,
    multiImage: await multiImageProof(page, viewport.name),
    screenshot: path.relative(ROOT, screenshot).replace(/\\/g, '/'),
  };
}

async function nontransparentPixels(canvas) {
  return canvas.evaluate((node) => {
    const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) count += 1;
    return count;
  });
}

async function waitForCanvasState(canvas, nonempty, label) {
  const deadline = Date.now() + 3_000;
  let pixels = 0;
  do {
    pixels = await nontransparentPixels(canvas);
    if ((pixels > 0) === nonempty) return pixels;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail(`${label}: Canvas did not become ${nonempty ? 'nonempty' : 'empty'} (pixels=${pixels})`);
}

async function waitForSelectValues(selects, expected, label) {
  const deadline = Date.now() + 3_000;
  let values = [];
  do {
    values = await selects.evaluateAll((nodes) => nodes.map((node) => node.value));
    if (values.length === expected.length && values.every((value, index) => value === expected[index])) return values;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.deepEqual(values, expected, label);
}

async function openManufacturingSimulation(page) {
  await openCard(page, '1-2-4');
  const tabs = page.locator('#kp-1-2-4 .tab-set-tab');
  assert.equal(await tabs.count(), 4, 'manufacturing experiment tab count changed');
  await tabs.nth(1).click();
  const frameLocator = page.frameLocator('#kp-1-2-4 .sandbox-frame');
  await frameLocator.locator('[data-oxidation-simulation]').waitFor({ state: 'visible' });
  return {
    frameLocator,
    frameElement: page.locator('#kp-1-2-4 .sandbox-frame'),
    selects: frameLocator.locator('select'),
    canvas: frameLocator.locator('canvas'),
  };
}

async function sandboxLayoutAudit(simulation, label) {
  const inner = await simulation.frameLocator.locator('body').evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.querySelector('[data-oxidation-simulation]');
    const canvas = root.querySelector('canvas');
    return {
      htmlScrollHeight: html.scrollHeight,
      htmlClientHeight: html.clientHeight,
      htmlScrollWidth: html.scrollWidth,
      htmlClientWidth: html.clientWidth,
      htmlScrollTop: html.scrollTop,
      bodyScrollTop: body.scrollTop,
      htmlOverflowY: getComputedStyle(html).overflowY,
      bodyOverflowY: getComputedStyle(body).overflowY,
      canvasInsideRoot: canvas.getBoundingClientRect().bottom <= root.getBoundingClientRect().bottom + 1,
    };
  });
  const iframeHeight = await simulation.frameElement.evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(Math.abs(iframeHeight - inner.htmlScrollHeight) <= 2, `${label}: iframe is not adaptive`);
  assert.ok(inner.htmlScrollHeight <= inner.htmlClientHeight + 2, `${label}: sandbox vertical scroll`);
  assert.ok(inner.htmlScrollWidth <= inner.htmlClientWidth + 1, `${label}: sandbox horizontal scroll`);
  assert.equal(inner.htmlOverflowY, 'hidden', `${label}: sandbox html overflow`);
  assert.equal(inner.bodyOverflowY, 'hidden', `${label}: sandbox body overflow`);
  assert.equal(inner.htmlScrollTop, 0, `${label}: sandbox html scroll position`);
  assert.equal(inner.bodyScrollTop, 0, `${label}: sandbox body scroll position`);
  assert.equal(inner.canvasInsideRoot, true, `${label}: canvas overlaps root`);
  return { ...inner, iframeHeight };
}

async function manufacturingAudit(page, viewport) {
  progress(`[${viewport.name}] manufacturing: load and quiz`);
  await loadCourse(page, MANUFACTURING, '1-2-4');
  const quiz = await quizWrongAnswerAudit(page, {
    kpId: '1-1-1', questionId: '1-001', correct: 'D', wrong: 'A',
  }, `${viewport.name} manufacturing quiz`);
  let simulation = await openManufacturingSimulation(page);
  assert.equal(await simulation.selects.count(), 5, `${viewport.name}: sandbox parameter count`);
  assert.deepEqual(await simulation.selects.evaluateAll((nodes) => nodes.map((node) => node.value)), ['', '', '', '', '']);
  assert.equal(await nontransparentPixels(simulation.canvas), 0, `${viewport.name}: sandbox prefilled canvas`);
  const sandboxLayout = await sandboxLayoutAudit(simulation, `${viewport.name} manufacturing sandbox`);

  progress(`[${viewport.name}] manufacturing: answer, draw, refresh, clear`);
  const answer = page.locator('#kp-1-2-4 [data-action="switch-sandbox-mode"][data-mode="answer"]');
  const practice = page.locator('#kp-1-2-4 [data-action="switch-sandbox-mode"][data-mode="practice"]');
  await answer.click();
  await waitForSelectValues(simulation.selects, ['800', '850', '920', '20', '60'], `${viewport.name}: answer values incomplete`);
  await waitForCanvasState(simulation.canvas, true, `${viewport.name}: answer mode`);
  await practice.click();
  await waitForCanvasState(simulation.canvas, false, `${viewport.name}: practice mode`);
  await waitForSelectValues(simulation.selects, ['', '', '', '', ''], `${viewport.name}: practice controls did not clear`);
  await page.waitForTimeout(300);

  const correctValues = ['800', '850', '920', '20', '60'];
  for (let index = 0; index < correctValues.length; index += 1) await simulation.selects.nth(index).selectOption(correctValues[index]);
  await simulation.frameLocator.locator('[data-draw-oxidation]').click();
  await waitForCanvasState(simulation.canvas, true, `${viewport.name}: correct practice drawing`);
  await simulation.frameLocator.locator('[data-clear-oxidation]').click();
  await waitForCanvasState(simulation.canvas, false, `${viewport.name}: intermediate clear`);
  await waitForSelectValues(simulation.selects, ['', '', '', '', ''], `${viewport.name}: intermediate clear controls`);
  await page.waitForTimeout(200);

  const values = ['500', '500', '500', '10', '10'];
  for (let index = 0; index < values.length; index += 1) await simulation.selects.nth(index).selectOption(values[index]);
  await simulation.frameLocator.locator('[data-draw-oxidation]').click();
  await waitForCanvasState(simulation.canvas, true, `${viewport.name}: alternative practice drawing`);
  await page.waitForTimeout(1_600);
  const canvasScreenshot = path.join(QA_DIR, `vocational-manufacturing-${viewport.name}-canvas.png`);
  await simulation.canvas.screenshot({ path: canvasScreenshot });

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await showCardChapter(page, '1-2-4');
  simulation = await openManufacturingSimulation(page);
  assert.deepEqual(await simulation.selects.evaluateAll((nodes) => nodes.map((node) => node.value)), values, `${viewport.name}: sandbox state did not survive refresh`);
  await page.waitForTimeout(300);
  await simulation.frameElement.evaluate((node) => node.scrollIntoView({ behavior: 'auto', block: 'end' }));
  const refreshedClear = simulation.frameLocator.locator('[data-clear-oxidation]');
  assert.equal(await refreshedClear.isVisible(), true, `${viewport.name}: clear control hidden after refresh`);
  await refreshedClear.dispatchEvent('click');
  await waitForSelectValues(simulation.selects, ['', '', '', '', ''], `${viewport.name}: clear did not reset controls`);
  await waitForCanvasState(simulation.canvas, false, `${viewport.name}: final clear`);

  await page.waitForTimeout(1_600);
  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem('pglib:u:qa-user:2026-ic-manufacturing:simulations');
    return raw ? JSON.parse(raw)[key] : null;
  }, SANDBOX_KEY);
  assert.deepEqual(stored?.controls?.map((item) => item.value), ['', '', '', '', ''], `${viewport.name}: cleared logged-in state missing`);
  const screenshot = path.join(QA_DIR, `vocational-manufacturing-${viewport.name}.png`);
  await page.screenshot({ path: screenshot });
  return {
    layout: await layoutAudit(page, `${viewport.name} manufacturing`),
    sandboxLayout,
    initialEmpty: true,
    answerMode: true,
    clear: true,
    persistence: true,
    quiz,
    screenshot: path.relative(ROOT, screenshot).replace(/\\/g, '/'),
    canvasScreenshot: path.relative(ROOT, canvasScreenshot).replace(/\\/g, '/'),
  };
}

function classifyFailures(failures) {
  const unique = [...new Map(failures.map((item) => [`${item.error}\n${item.url}`, item])).values()];
  const ignored = unique.filter((item) => (
    item.url.startsWith(`${ORIGIN}/courses/2026-vocational-preliminary/`)
    && item.url.includes('/assets/media/')
    && item.error.includes('ERR_ABORTED')
  ));
  return { ignored, unexpected: unique.filter((item) => !ignored.includes(item)) };
}

async function main() {
  writeFileSync(PROGRESS_FILE, '', 'utf8');
  const executablePath = localBrowser();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const report = {
    generatedAt: new Date().toISOString(),
    origin: ORIGIN,
    artifacts: {
      packagingPackage: artifactEvidence(path.join(ROOT, 'dist-courses', '2026-vocational-preliminary', PACKAGING, `${PACKAGING}.pigeon`)),
      packagingDelivery: artifactEvidence(path.join(ROOT, 'dist-courses', '2026-vocational-preliminary', PACKAGING, 'delivery-manifest.json')),
      manufacturingPackage: artifactEvidence(path.join(ROOT, 'dist-courses', '2026-vocational-preliminary', MANUFACTURING, `${MANUFACTURING}.pigeon`)),
      manufacturingDelivery: artifactEvidence(path.join(ROOT, 'dist-courses', '2026-vocational-preliminary', MANUFACTURING, 'delivery-manifest.json')),
    },
    viewports: {},
  };
  try {
    for (const viewport of VIEWPORTS) {
      progress(`[${viewport.name}] start`);
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const syncCalls = [];
      const platformFontRequests = [];
      await installMockSync(context, syncCalls);
      await isolatePlatformFonts(context, platformFontRequests);
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      const allRequests = [];
      const sandboxRequests = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' }));
      page.on('request', (request) => {
        allRequests.push(request.url());
        try {
          if (request.frame().url().startsWith('about:srcdoc')) sandboxRequests.push(request.url());
        } catch { /* navigation request without a frame */ }
      });
      try {
        const packaging = await packagingAudit(page, viewport);
        const manufacturing = await manufacturingAudit(page, viewport);
        const externalRequests = [...new Set(allRequests)].filter((url) => !(
          url.startsWith(`${ORIGIN}/`)
          || url.startsWith('http://localhost:8787/')
          || url.startsWith('blob:')
          || url.startsWith('data:')
        ));
        const unexpectedExternalRequests = externalRequests.filter((url) => !platformFontRequests.includes(url));
        const failures = classifyFailures(failedRequests);
        assert.deepEqual(consoleErrors, [], `${viewport.name}: console errors`);
        assert.deepEqual(pageErrors, [], `${viewport.name}: page errors`);
        assert.deepEqual(failures.unexpected, [], `${viewport.name}: failed requests`);
        assert.deepEqual(unexpectedExternalRequests, [], `${viewport.name}: external course or sandbox requests`);
        assert.deepEqual(sandboxRequests, [], `${viewport.name}: sandbox network requests`);
        assert.ok(syncCalls.some((call) => call.endpoint === '/me'), `${viewport.name}: mocked login unused`);
        assert.ok(syncCalls.some((call) => call.method === 'PUT' && call.endpoint.endsWith('/simulations')), `${viewport.name}: state not synchronized`);
        report.viewports[viewport.name] = {
          viewport: { width: viewport.width, height: viewport.height },
          packaging,
          manufacturing,
          consoleErrors,
          pageErrors,
          failedRequests: failures,
          externalRequests,
          unexpectedExternalRequests,
          sandboxRequests,
          syncCalls,
        };
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const reportFile = path.join(QA_DIR, 'vocational-courses-browser.json');
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ report: path.relative(ROOT, reportFile).replace(/\\/g, '/'), viewports: Object.keys(report.viewports) }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
