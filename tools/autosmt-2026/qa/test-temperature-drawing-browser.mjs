import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const QA_DIR = path.join(ROOT, 'tools', 'autosmt-2026', 'qa');
const URL = process.env.PIGEON_QA_URL || 'http://127.0.0.1:5185/learn.html?course=2026-ic-manufacturing';
const PAGE_ORIGIN = new globalThis.URL(URL).origin;
const STATIC_FONT_ORIGINS = ['https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];
const PLAYWRIGHT_PATH = process.env.PIGEON_PLAYWRIGHT_PATH;
if (!PLAYWRIGHT_PATH) throw new Error('PIGEON_PLAYWRIGHT_PATH must point to the bundled Playwright package.');
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT_PATH);

const VIEWPORTS = [
  { name: 'desktop', width: 1377, height: 812 },
  { name: 'wide', width: 2048, height: 1216 },
  { name: 'mobile', width: 375, height: 812 },
];
const TARGETS = [
  { id: 'drawing-7-1', kpId: '1-5-2', tabIndex: 1, answers: ['1150', '1150', '3', '1150', '13', '1250', '10', '1150', '4', '300'] },
  { id: 'drawing-16-1', kpId: '1-8-4', tabIndex: 1, answers: ['950', '950', '10'] },
  { id: 'drawing-16-2', kpId: '1-8-4', tabIndex: 2, answers: ['1050', '1050', '10'] },
];

function localBrowser() {
  return [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\msedge.exe',
  ].find((candidate) => candidate && existsSync(candidate));
}

function jsonHeaders(origin) {
  return {
    'access-control-allow-origin': origin || PAGE_ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
    'content-type': 'application/json; charset=utf-8',
  };
}

function isExpectedMediaAbort(request) {
  return request.failure()?.errorText === 'net::ERR_ABORTED'
    && request.url().startsWith(`${PAGE_ORIGIN}/courses/`)
    && /\/assets\/media\/[^/?]+\.mp4(?:\?|$)/.test(request.url());
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
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ user: { id: 'qa-user', username: 'qa-user', role: 'user' } }) });
    } else if (request.method() === 'GET' && endpoint === '/sync') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ states: [] }) });
    } else if (request.method() === 'PUT' && endpoint.startsWith('/state/')) {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ applied: true, updated_at: 4102444800000 }) });
    } else {
      await route.fulfill({ status: 404, headers, body: JSON.stringify({ error: 'unexpected QA API call' }) });
    }
  });
  for (const origin of STATIC_FONT_ORIGINS) {
    await context.route(`${origin}**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
  }
}

async function waitForCourse(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.locator('#courseLogo').waitFor({ state: 'attached', timeout: 30_000 });
  await page.locator('#main').waitFor({ state: 'visible', timeout: 30_000 });
}

async function openTarget(page, target) {
  const header = page.locator(`.card-header[data-kp-id="${target.kpId}"]`);
  const body = page.locator(`#kp-${target.kpId} .card-body`);
  await header.waitFor({ state: 'visible', timeout: 30_000 });
  if ((await body.getAttribute('class') || '').includes('hidden')) await header.click();
  await body.waitFor({ state: 'visible' });
  const tabs = page.locator(`#kp-${target.kpId} .tab-set-tab`);
  assert.ok(await tabs.count() > target.tabIndex, `${target.id}: tab index ${target.tabIndex} missing`);
  await tabs.nth(target.tabIndex).click();
  const wrapper = page.locator(`#kp-${target.kpId} .sandbox-wrapper[data-sandbox-key*="${target.id}"]`);
  await wrapper.waitFor({ state: 'visible', timeout: 30_000 });
  const frameElement = wrapper.locator('iframe.sandbox-frame');
  await frameElement.waitFor({ state: 'visible' });
  return { wrapper, frameElement, frame: page.frameLocator(`#kp-${target.kpId} .sandbox-wrapper[data-sandbox-key*="${target.id}"] iframe.sandbox-frame`) };
}

async function valuesOf(frame, count) {
  return frame.locator('select[data-control-index]').evaluateAll((nodes) => nodes
    .sort((left, right) => Number(left.dataset.controlIndex) - Number(right.dataset.controlIndex))
    .map((node) => node.value)).then((values) => {
      assert.equal(values.length, count, 'drawing select count changed');
      return values;
    });
}

async function canvasPixels(frame) {
  return frame.locator('canvas.drawing-canvas').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let pixels = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) pixels += 1;
    return pixels;
  });
}

async function waitForCanvasPixels(frame, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  let pixels = 0;
  while (Date.now() < deadline) {
    pixels = await canvasPixels(frame);
    if (pixels > 0) return pixels;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return pixels;
}

async function layoutAudit(page, targetLabel) {
  const result = await page.evaluate(() => {
    const visible = (node) => node.getClientRects().length > 0;
    const nodes = [...document.querySelectorAll('.knowledge-card, .card-body, .tab-set, table, .sandbox-wrapper, .sandbox-frame')]
      .filter(visible)
      .map((node) => ({
        selector: node.id || node.className || node.tagName,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        right: node.getBoundingClientRect().right,
      }))
      .filter((item) => item.scrollWidth > item.clientWidth + 1 || item.right > innerWidth + 1);
    return { innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, offenders: nodes };
  });
  assert.ok(result.documentWidth <= result.innerWidth + 1, `${targetLabel}: page horizontal overflow`);
  assert.ok(result.bodyWidth <= result.innerWidth + 1, `${targetLabel}: body horizontal overflow`);
  assert.deepEqual(result.offenders, [], `${targetLabel}: card/table/sandbox horizontal overflow`);
  return result;
}

async function sandboxLayoutAudit(simulation, targetLabel) {
  const inner = await simulation.frame.locator('html').evaluate((html) => {
    const body = document.body;
    const root = document.querySelector('[data-drawing-simulation]');
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
  assert.ok(Math.abs(iframeHeight - inner.htmlScrollHeight) <= 2, `${targetLabel}: iframe height is not adaptive`);
  assert.ok(inner.htmlScrollHeight <= inner.htmlClientHeight + 2, `${targetLabel}: sandbox vertical scroll`);
  assert.ok(inner.htmlScrollWidth <= inner.htmlClientWidth + 1, `${targetLabel}: sandbox horizontal scroll`);
  assert.equal(inner.htmlOverflowY, 'hidden', `${targetLabel}: sandbox html overflow-y`);
  assert.equal(inner.bodyOverflowY, 'hidden', `${targetLabel}: sandbox body overflow-y`);
  assert.equal(inner.htmlScrollTop, 0, `${targetLabel}: sandbox html scrolled`);
  assert.equal(inner.bodyScrollTop, 0, `${targetLabel}: sandbox body scrolled`);
  assert.equal(inner.canvasInsideRoot, true, `${targetLabel}: canvas overflows sandbox root`);
  return { ...inner, iframeHeight };
}

async function auditTarget(page, target, viewport, screenshotPaths) {
  const label = `${viewport.name}/${target.id}`;
  let simulation = await openTarget(page, target);
  const selects = simulation.frame.locator('select[data-control-index]');
  const canvas = simulation.frame.locator('canvas.drawing-canvas');
  const answerButton = simulation.wrapper.locator('[data-action="switch-sandbox-mode"][data-mode="answer"]');
  const practiceButton = simulation.wrapper.locator('[data-action="switch-sandbox-mode"][data-mode="practice"]');
  const clearButton = simulation.frame.locator('[data-drawing-clear]');
  const drawButton = simulation.frame.locator('[data-drawing-draw]');
  const count = target.answers.length;

  assert.deepEqual(await valuesOf(simulation.frame, count), Array(count).fill(''), `${label}: initial controls not empty`);
  assert.equal(await canvasPixels(simulation.frame), 0, `${label}: initial canvas is not blank`);
  const initialLayout = await sandboxLayoutAudit(simulation, `${label}/initial`);

  await answerButton.click();
  await page.waitForTimeout(160);
  assert.deepEqual(await valuesOf(simulation.frame, count), target.answers, `${label}: reference answers incomplete`);
  for (let index = 0; index < count; index += 1) assert.equal(await selects.nth(index).isDisabled(), true, `${label}: answer select editable`);
  assert.ok(await waitForCanvasPixels(simulation.frame) > 0, `${label}: reference answer canvas blank`);
  const answerShot = path.join(QA_DIR, `temperature-drawing-${viewport.name}-${target.id}-answer.png`);
  await page.screenshot({ path: answerShot, fullPage: true });
  screenshotPaths.push(path.relative(ROOT, answerShot).replace(/\\/g, '/'));

  await practiceButton.click();
  await page.waitForTimeout(120);
  assert.deepEqual(await valuesOf(simulation.frame, count), Array(count).fill(''), `${label}: practice did not clear answer mode`);
  assert.equal(await canvasPixels(simulation.frame), 0, `${label}: practice canvas not blank`);

  for (let index = 0; index < count; index += 1) await selects.nth(index).selectOption(target.answers[index]);
  await drawButton.evaluate((button) => button.click());
  await page.waitForTimeout(180);
  const alternatives = await valuesOf(simulation.frame, count);
  assert.ok(alternatives.every(Boolean), `${label}: practice values incomplete`);
  assert.ok(await waitForCanvasPixels(simulation.frame) > 0, `${label}: practice canvas blank`);
  await page.waitForTimeout(1_500);
  const beforeReloadStorage = await page.evaluate(() => Object.fromEntries(
    Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)]),
  ));

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  simulation = await openTarget(page, target);
  const restoredValues = await valuesOf(simulation.frame, count);
  assert.deepEqual(restoredValues, alternatives, `${label}: refresh did not restore practice values; beforeReloadStorage=${JSON.stringify(beforeReloadStorage)}`);
  assert.ok(await canvasPixels(simulation.frame) > 0, `${label}: refresh did not restore practice canvas`);
  const restoredLayout = await sandboxLayoutAudit(simulation, `${label}/restored`);

  const restoredClear = simulation.frame.locator('[data-drawing-clear]');
  await restoredClear.evaluate((button) => button.click());
  await page.waitForTimeout(160);
  assert.deepEqual(await valuesOf(simulation.frame, count), Array(count).fill(''), `${label}: clear did not reset controls`);
  assert.equal(await canvasPixels(simulation.frame), 0, `${label}: clear did not reset canvas`);
  assert.equal(await simulation.wrapper.locator('.sandbox-score-chip').count(), 0, `${label}: clear did not remove score`);
  const finalLayout = await layoutAudit(page, label);
  return { initialLayout, restoredLayout, finalLayout, answerScreenshot: screenshotPaths.at(-1), alternatives };
}

async function main() {
  const executablePath = localBrowser();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const report = { generatedAt: new Date().toISOString(), url: URL, viewports: {}, status: 'passed' };
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const syncCalls = [];
      await installMockSync(context, syncCalls);
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      const requests = [];
      const sandboxRequests = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      page.on('requestfailed', (request) => {
        if (!isExpectedMediaAbort(request)) failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' });
      });
      page.on('request', (request) => {
        requests.push(request.url());
        try {
          if (request.frame().url().startsWith('about:srcdoc')) sandboxRequests.push(request.url());
        } catch { /* navigation may not have a frame yet */ }
      });
      try {
        await waitForCourse(page);
        const screenshotPaths = [];
        const targets = {};
        for (const target of TARGETS) targets[target.id] = await auditTarget(page, target, viewport, screenshotPaths);
        const externalRequests = [...new Set(requests)].filter((url) => !(
          url.startsWith(`${PAGE_ORIGIN}/`) || url.startsWith('http://localhost:8787/') || url.startsWith('blob:') || url.startsWith('data:')
        ) && !STATIC_FONT_ORIGINS.some((origin) => url.startsWith(origin)));
        assert.deepEqual(consoleErrors, [], `${viewport.name}: console errors`);
        assert.deepEqual(pageErrors, [], `${viewport.name}: page errors`);
        assert.deepEqual(failedRequests, [], `${viewport.name}: failed requests`);
        assert.deepEqual(externalRequests, [], `${viewport.name}: external requests`);
        assert.deepEqual(sandboxRequests, [], `${viewport.name}: sandbox requests`);
        assert.ok(syncCalls.some((call) => call.endpoint === '/me'), `${viewport.name}: mock login unused`);
        assert.ok(syncCalls.some((call) => call.method === 'PUT' && call.endpoint.endsWith('/simulations')), `${viewport.name}: simulation state not synchronized`);
        report.viewports[viewport.name] = {
          viewport,
          targets,
          screenshots: screenshotPaths,
          consoleErrors,
          pageErrors,
          failedRequests,
          externalRequests,
          sandboxRequests,
          syncCalls,
        };
      } finally {
        await context.close();
      }
    }
  } catch (error) {
    report.status = 'failed';
    report.error = error?.stack || String(error);
    throw error;
  } finally {
    const reportFile = path.join(QA_DIR, 'temperature-drawing-browser.json');
    writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await browser.close();
  }
  console.log(JSON.stringify({ status: report.status, report: 'tools/autosmt-2026/qa/temperature-drawing-browser.json', viewports: Object.keys(report.viewports) }));
}

await main();
