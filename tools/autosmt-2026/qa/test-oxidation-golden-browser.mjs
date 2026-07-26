import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const QA_DIR = path.join(ROOT, 'tools', 'autosmt-2026', 'qa');
const URL = process.env.PIGEON_QA_URL
  || 'http://127.0.0.1:5173/learn.html?course=autosmt-oxidation-golden';
const PAGE_ORIGIN = new globalThis.URL(URL).origin;
const PLAYWRIGHT_PATH = process.env.PIGEON_PLAYWRIGHT_PATH;
if (!PLAYWRIGHT_PATH) throw new Error('PIGEON_PLAYWRIGHT_PATH must point to the bundled Playwright package.');
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT_PATH);

const VIEWPORTS = [
  { width: 1377, height: 812, name: 'desktop' },
  { width: 2048, height: 1216, name: 'wide' },
  { width: 375, height: 812, name: 'mobile' },
];
const COURSE_ID = 'autosmt-oxidation-golden';
const SANDBOX_KEY = 'sandbox:experiment-1-oxidation-temperature-curve';
const ARTIFACTS = {
  sourceLedger: path.join(ROOT, 'courses', 'autosmt-previews', COURSE_ID, 'source-ledger.json'),
  deploymentPackage: path.join(
    ROOT, 'dist-courses', 'autosmt-previews', COURSE_ID, `${COURSE_ID}.pigeon`,
  ),
  fullPackage: path.join(ROOT, 'dist-courses', 'autosmt-previews', `${COURSE_ID}.full.pigeon`),
};

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

function localBrowser() {
  return [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => candidate && existsSync(candidate));
}

function jsonHeaders(origin) {
  return {
    'access-control-allow-origin': origin || 'http://127.0.0.1:5173',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
    'content-type': 'application/json; charset=utf-8',
  };
}

async function installMockSync(context, calls) {
  await context.route('http://localhost:8787/api/**', async (route) => {
    const request = route.request();
    const endpoint = new globalThis.URL(request.url()).pathname.replace(/^\/api/, '');
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

async function isolatePlatformFontRequest(context, calls) {
  await context.route('https://fonts.googleapis.com/**', async (route) => {
    calls.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' });
  });
}

async function waitForCourse(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.locator('.card-header[data-kp-id="1-2-1"]').waitFor({ state: 'visible', timeout: 30_000 });
  assert.match(await page.locator('#courseLogo').innerText(), /AutoSMT/, 'course title did not render');
}

async function openCard(page, id) {
  const header = page.locator(`.card-header[data-kp-id="${id}"]`);
  const body = page.locator(`#kp-${id} .card-body`);
  await header.waitFor({ state: 'visible' });
  if ((await body.getAttribute('class') || '').includes('hidden')) await header.click();
  await body.waitFor({ state: 'visible' });
}

async function layoutAudit(page, label) {
  const result = await page.evaluate(() => {
    const visible = (node) => node.getClientRects().length > 0;
    const selectors = [
      '.knowledge-card', '.card-body-content', '.params-table-wrap', '.params-table-mobile',
      '.tab-set', '.sandbox-wrapper', '.sandbox-frame', '.section-quiz', '.quiz-item',
    ];
    const offenders = [...document.querySelectorAll(selectors.join(','))]
      .filter(visible)
      .map((node) => ({
        selector: node.id || node.className || node.tagName,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        right: node.getBoundingClientRect().right,
      }))
      .filter((item) => item.scrollWidth > item.clientWidth + 1 || item.right > innerWidth + 1);
    return {
      innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      offenders,
    };
  });
  assert.ok(result.documentWidth <= result.innerWidth + 1, `${label}: document horizontal overflow ${JSON.stringify(result)}`);
  assert.ok(result.bodyWidth <= result.innerWidth + 1, `${label}: body horizontal overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.offenders, [], `${label}: card/table/sandbox horizontal overflow`);
  return result;
}

async function structureAudit(page, viewportName) {
  const chapters = page.locator('#chapterTabs .tab');
  assert.equal(await chapters.count(), 1, `${viewportName}: chapter count changed`);
  assert.equal(await page.locator('.tree-subsection').count(), 1, `${viewportName}: sidebar section count changed`);
  assert.equal(await page.locator('.knowledge-card').count(), 4, `${viewportName}: knowledge-card count changed`);
  await openCard(page, '1-2-1');
  const desktopTables = page.locator('#kp-1-2-1 .params-table');
  const mobileTables = page.locator('#kp-1-2-1 .params-table-mobile');
  assert.equal(await desktopTables.count(), 2, `${viewportName}: native table count changed`);
  assert.equal(await mobileTables.count(), 2, `${viewportName}: mobile table count changed`);
  if (viewportName === 'mobile') {
    for (let index = 0; index < 2; index += 1) {
      assert.equal(await mobileTables.nth(index).isVisible(), true, `${viewportName}: mobile record table hidden`);
      assert.equal(await desktopTables.nth(index).isVisible(), false, `${viewportName}: desktop table visible on mobile`);
    }
  } else {
    for (let index = 0; index < 2; index += 1) {
      assert.equal(await desktopTables.nth(index).isVisible(), true, `${viewportName}: desktop native table hidden`);
    }
  }
  await openCard(page, '1-2-2');
  await openCard(page, '1-2-3');
  assert.equal(await page.locator('#kp-1-2-2 .course-html, #kp-1-2-3 .course-html').count(), 0, 'theory fell back to html');
  const images = page.locator('#kp-1-2-2 img, #kp-1-2-3 img');
  assert.ok(await images.count() > 0, `${viewportName}: theory images missing`);
  for (let index = 0; index < await images.count(); index += 1) {
    const image = images.nth(index);
    if (!await image.isVisible()) continue;
    const decoded = await image.evaluate(async (node) => {
      await node.decode();
      return { width: node.naturalWidth, height: node.naturalHeight };
    });
    assert.ok(decoded.width > 0 && decoded.height > 0, `${viewportName}: image did not decode`);
  }
  return layoutAudit(page, `${viewportName} structure`);
}

async function quizAudit(page, viewportName) {
  await openCard(page, '1-2-2');
  const item = page.locator('#kp-1-2-2 .quiz-item[data-qid="1-003"]');
  const correct = item.locator('label:has(input[value="A"])');
  const wrong = item.locator('label:has(input[value="B"])');
  await wrong.click();
  await item.locator('[data-action="submit-quiz"]').click();
  await page.waitForTimeout(180);
  assert.match(await correct.getAttribute('class') || '', /correct/, `${viewportName}: correct option not green-highlighted`);
  assert.match(await wrong.getAttribute('class') || '', /wrong/, `${viewportName}: selected wrong option not marked`);
  assert.equal(await item.locator('.quiz-opt.correct').count(), 1, `${viewportName}: correct feedback not unique`);
  assert.equal(await item.locator('.quiz-opt.wrong').count(), 1, `${viewportName}: wrong feedback not unique`);
}

async function nontransparentPixels(canvas) {
  return canvas.evaluate((node) => {
    const pixels = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) count += 1;
    return count;
  });
}

async function openSimulation(page) {
  await openCard(page, '1-2-4');
  const tabs = page.locator('#kp-1-2-4 .tab-set-tab');
  assert.equal(await tabs.count(), 4, 'experiment tab count changed');
  await tabs.nth(1).click();
  const frameLocator = page.frameLocator('#kp-1-2-4 .sandbox-frame');
  await frameLocator.locator('[data-oxidation-simulation]').waitFor({ state: 'visible' });
  return {
    tabs,
    frameLocator,
    frameElement: page.locator('#kp-1-2-4 .sandbox-frame'),
    selects: frameLocator.locator('select'),
    canvas: frameLocator.locator('canvas'),
  };
}

async function sandboxLayoutAudit(simulation, viewportName) {
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
  assert.ok(Math.abs(iframeHeight - inner.htmlScrollHeight) <= 2, `${viewportName}: iframe height is not adaptive`);
  assert.ok(inner.htmlScrollHeight <= inner.htmlClientHeight + 2, `${viewportName}: sandbox has internal vertical scroll`);
  assert.ok(inner.htmlScrollWidth <= inner.htmlClientWidth + 1, `${viewportName}: sandbox has internal horizontal scroll`);
  assert.equal(inner.htmlOverflowY, 'hidden', `${viewportName}: sandbox html overflow is not hidden`);
  assert.equal(inner.bodyOverflowY, 'hidden', `${viewportName}: sandbox body overflow is not hidden`);
  assert.equal(inner.htmlScrollTop, 0, `${viewportName}: sandbox html scrolled internally`);
  assert.equal(inner.bodyScrollTop, 0, `${viewportName}: sandbox body scrolled internally`);
  assert.equal(inner.canvasInsideRoot, true, `${viewportName}: canvas overlaps its sandbox root`);
  return { ...inner, iframeHeight };
}

async function restoredStateAudit(page, viewportName, transition, alternatives) {
  if (transition === 'refresh') {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  } else {
    await waitForCourse(page);
  }
  const simulation = await openSimulation(page);
  const values = [];
  for (let index = 0; index < 5; index += 1) values.push(await simulation.selects.nth(index).inputValue());
  assert.deepEqual(values, alternatives, `${viewportName}: ${transition} did not restore sandbox controls`);
  const chip = page.locator('#kp-1-2-4 .sandbox-score-chip');
  await chip.waitFor({ state: 'visible' });
  assert.match(await chip.innerText(), /正确率 0\/5/, `${viewportName}: ${transition} did not restore sandbox score`);
  return simulation;
}

async function interactionAudit(page, viewportName) {
  let simulation = await openSimulation(page);
  const { selects, canvas, frameLocator } = simulation;
  assert.equal(await selects.count(), 5, `${viewportName}: sandbox parameter count changed`);
  assert.equal(await simulation.frameElement.getAttribute('srcdoc') !== null, true, 'sandbox is not isolated srcdoc');
  assert.equal(
    await page.locator(`#kp-1-2-4 .sandbox-wrapper[data-sandbox-key="${SANDBOX_KEY}"]`).count(),
    1,
    `${viewportName}: stable sandbox id is not rendered`,
  );
  const layout = await sandboxLayoutAudit(simulation, viewportName);
  const initial = [];
  for (let index = 0; index < 5; index += 1) initial.push(await selects.nth(index).inputValue());
  assert.deepEqual(initial, ['', '', '', '', ''], `${viewportName}: sandbox prefilled an answer`);
  assert.equal(await nontransparentPixels(canvas), 0, `${viewportName}: Canvas is not blank initially`);

  const practice = page.locator('#kp-1-2-4 [data-action="switch-sandbox-mode"][data-mode="practice"]');
  const answer = page.locator('#kp-1-2-4 [data-action="switch-sandbox-mode"][data-mode="answer"]');
  const draw = frameLocator.locator('[data-draw-oxidation]');
  let clear = frameLocator.locator('[data-clear-oxidation]');
  await answer.click();
  await page.waitForTimeout(120);
  const answerValues = [];
  for (let index = 0; index < 5; index += 1) answerValues.push(await selects.nth(index).inputValue());
  assert.deepEqual(answerValues, ['800', '850', '920', '20', '60'], `${viewportName}: answer mode is incomplete`);
  for (let index = 0; index < 5; index += 1) assert.equal(await selects.nth(index).isDisabled(), true);
  assert.ok(await nontransparentPixels(canvas) > 0, `${viewportName}: answer mode did not draw`);
  await practice.click();
  await page.waitForTimeout(100);
  assert.equal(await nontransparentPixels(canvas), 0, `${viewportName}: returning to practice did not clear Canvas`);

  const correct = ['800', '850', '920', '20', '60'];
  for (let index = 0; index < 5; index += 1) await selects.nth(index).selectOption(correct[index]);
  await draw.click();
  await page.waitForTimeout(120);
  const correctShot = path.join(QA_DIR, `oxidation-golden-${viewportName}-canvas-correct.png`);
  const correctBytes = await canvas.screenshot({ path: correctShot });
  assert.ok(await nontransparentPixels(canvas) > 0, `${viewportName}: correct draw is empty`);
  assert.match(await page.locator('#kp-1-2-4 .sandbox-score-chip').innerText(), /正确率 5\/5/);

  await clear.click();
  await page.waitForTimeout(100);
  const alternatives = ['500', '500', '500', '10', '10'];
  for (let index = 0; index < 5; index += 1) await selects.nth(index).selectOption(alternatives[index]);
  await draw.click();
  await page.waitForTimeout(120);
  const alternateShot = path.join(QA_DIR, `oxidation-golden-${viewportName}-canvas-alternative.png`);
  const alternateBytes = await canvas.screenshot({ path: alternateShot });
  assert.notEqual(sha256(correctBytes), sha256(alternateBytes), `${viewportName}: alternative curve equals answer curve`);
  assert.match(await page.locator('#kp-1-2-4 .sandbox-score-chip').innerText(), /正确率 0\/5/);

  await page.waitForTimeout(1_500);
  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem('pglib:u:qa-user:autosmt-oxidation-golden:simulations');
    return raw ? JSON.parse(raw)[key] : null;
  }, SANDBOX_KEY);
  assert.deepEqual(stored?.score, { score: 0, total: 5, detail: '' }, `${viewportName}: sandbox score not persisted`);
  assert.deepEqual(stored?.controls?.map((item) => item.value), alternatives, `${viewportName}: sandbox controls not persisted`);

  simulation = await restoredStateAudit(page, viewportName, 'refresh', alternatives);
  simulation = await restoredStateAudit(page, viewportName, 'reenter', alternatives);
  await openCard(page, '1-2-2');
  const quiz = page.locator('#kp-1-2-2 .quiz-item[data-qid="1-003"]');
  assert.equal(await quiz.locator('input[value="B"]').isChecked(), true, `${viewportName}: quiz choice did not persist`);
  assert.match(await quiz.locator('label:has(input[value="A"])').getAttribute('class') || '', /correct/);
  assert.match(await quiz.locator('label:has(input[value="B"])').getAttribute('class') || '', /wrong/);

  simulation = await openSimulation(page);
  clear = simulation.frameLocator.locator('[data-clear-oxidation]');
  await clear.click();
  await page.waitForTimeout(160);
  const cleared = [];
  for (let index = 0; index < 5; index += 1) cleared.push(await simulation.selects.nth(index).inputValue());
  assert.deepEqual(cleared, ['', '', '', '', ''], `${viewportName}: clear did not reset controls`);
  assert.equal(await nontransparentPixels(simulation.canvas), 0, `${viewportName}: clear did not reset Canvas`);
  assert.equal(await page.locator('#kp-1-2-4 .sandbox-score-chip').count(), 0, `${viewportName}: clear did not remove score`);
  await layoutAudit(page, `${viewportName} after sandbox`);
  return {
    layout,
    correctCanvas: { path: path.relative(ROOT, correctShot).replace(/\\/g, '/'), sha256: sha256(correctBytes) },
    alternativeCanvas: { path: path.relative(ROOT, alternateShot).replace(/\\/g, '/'), sha256: sha256(alternateBytes) },
    persistence: { namespace: 'qa-user', sandboxKey: SANDBOX_KEY, refresh: true, reenter: true, quiz: true },
  };
}

async function mediaRangeAudit(page, context) {
  const urls = await page.locator('video source').evaluateAll((nodes) => [...new Set(nodes.map((node) => node.src))]);
  assert.equal(urls.length, 4, `expected four local videos, found ${urls.length}`);
  const checks = [];
  for (const url of urls) {
    const response = await context.request.get(url, { headers: { Range: 'bytes=0-1023' } });
    const body = await response.body();
    checks.push({ url, status: response.status(), bytes: body.byteLength });
    assert.equal(response.status(), 206, `video range request failed: ${url}`);
    assert.equal(body.byteLength, 1024, `video range length changed: ${url}`);
  }
  return checks;
}

function classifyFailures(failures) {
  const ignored = failures.filter((item) => (
    item.url.includes(`/courses/autosmt-previews/${COURSE_ID}/assets/media/`)
    && item.error.includes('ERR_ABORTED')
  ));
  return { ignored, unexpected: failures.filter((item) => !ignored.includes(item)) };
}

async function main() {
  const executablePath = localBrowser();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const report = {
    generatedAt: new Date().toISOString(),
    url: URL,
    artifacts: Object.fromEntries(Object.entries(ARTIFACTS).map(([key, file]) => [key, artifactEvidence(file)])),
    viewports: {},
  };
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const syncCalls = [];
      const platformBaselineRequests = [];
      await isolatePlatformFontRequest(context, platformBaselineRequests);
      await installMockSync(context, syncCalls);
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      const allRequests = [];
      const sandboxRequests = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      page.on('requestfailed', (request) => failedRequests.push({
        url: request.url(), error: request.failure()?.errorText || 'unknown',
      }));
      page.on('request', (request) => {
        allRequests.push(request.url());
        try {
          if (request.frame().url().startsWith('about:srcdoc')) sandboxRequests.push(request.url());
        } catch { /* navigation request without a frame */ }
      });
      try {
        await waitForCourse(page);
        const structure = await structureAudit(page, viewport.name);
        await quizAudit(page, viewport.name);
        const interaction = await interactionAudit(page, viewport.name);
        const media = viewport.name === 'mobile' ? [] : await mediaRangeAudit(page, context);
        const finalLayout = await layoutAudit(page, `${viewport.name} final`);
        const screenshot = path.join(QA_DIR, `oxidation-golden-${viewport.name}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });

        const externalRequests = [...new Set(allRequests)].filter((url) => !(
          url.startsWith(`${PAGE_ORIGIN}/`)
          || url.startsWith('http://localhost:8787/')
          || url.startsWith('blob:')
          || url.startsWith('data:')
        ));
        const unexpectedExternalRequests = externalRequests.filter(
          (url) => !platformBaselineRequests.includes(url),
        );
        const failures = classifyFailures(failedRequests);
        assert.deepEqual(consoleErrors, [], `${viewport.name}: console errors`);
        assert.deepEqual(pageErrors, [], `${viewport.name}: page errors`);
        assert.deepEqual(failures.unexpected, [], `${viewport.name}: failed requests`);
        assert.deepEqual(unexpectedExternalRequests, [], `${viewport.name}: course or sandbox external network requests`);
        assert.deepEqual(sandboxRequests, [], `${viewport.name}: sandbox made network requests`);
        assert.ok(syncCalls.some((call) => call.endpoint === '/me'), `${viewport.name}: mocked login was not used`);
        assert.ok(
          syncCalls.some((call) => call.method === 'PUT' && call.endpoint.endsWith('/simulations')),
          `${viewport.name}: logged-in simulation state was not synchronized`,
        );
        report.viewports[viewport.name] = {
          viewport: { width: viewport.width, height: viewport.height },
          structure,
          interaction,
          media,
          finalLayout,
          screenshot: path.relative(ROOT, screenshot).replace(/\\/g, '/'),
          consoleErrors,
          pageErrors,
          failedRequests: failures,
          externalRequests,
          unexpectedExternalRequests,
          platformBaselineRequests,
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
  const reportFile = path.join(QA_DIR, 'oxidation-golden-browser.json');
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    report: path.relative(ROOT, reportFile).replace(/\\/g, '/'),
    viewports: Object.keys(report.viewports),
    artifacts: report.artifacts,
  }));
}

await main();
