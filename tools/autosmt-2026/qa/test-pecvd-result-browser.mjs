import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORIGIN = process.env.PIGEON_QA_ORIGIN || 'http://127.0.0.1:5173';
const PLAYWRIGHT_PATH = process.env.PIGEON_PLAYWRIGHT_PATH;
if (!PLAYWRIGHT_PATH) throw new Error('PIGEON_PLAYWRIGHT_PATH must point to Playwright.');
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT_PATH);
const VIEWPORTS = [
  { name: 'desktop', width: 1377, height: 812 },
  { name: 'wide', width: 2048, height: 1216 },
  { name: 'mobile', width: 375, height: 812 },
];

function browserExecutable() {
  return [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => candidate && existsSync(candidate));
}

async function isolateExternalRequests(context) {
  await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route('http://localhost:8787/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const body = pathname === '/api/me'
      ? { user: { id: 'pecvd-qa', username: 'pecvd-qa', role: 'user' } }
      : pathname === '/api/sync' ? { states: [] } : { applied: true, updated_at: 4102444800000 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

const launch = { headless: true };
const executablePath = browserExecutable();
if (executablePath) launch.executablePath = executablePath;
const browser = await chromium.launch(launch);
const evidence = [];

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport });
    await isolateExternalRequests(context);
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    await page.goto(`${ORIGIN}/learn.html?course=2026-ic-manufacturing`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const header = page.locator('.card-header[data-kp-id="1-3-4"]');
    await header.waitFor({ state: 'visible', timeout: 120_000 });
    const body = page.locator('#kp-1-3-4 .card-body');
    if ((await body.getAttribute('class') || '').includes('hidden')) await header.click();
    await page.locator('#kp-1-3-4 .tab-set-tab').filter({ hasText: '工艺参数设置' }).click();

    const root = page.locator('.param-select[data-param-id="experiment-3-1"]');
    await root.waitFor({ state: 'visible', timeout: 30_000 });
    const selects = root.locator('.step-simulation-choice:visible');
    assert.equal(await selects.count(), 12, `${viewport.name}: expected 12 visible parameter controls`);
    for (let index = 0; index < 12; index += 1) await selects.nth(index).selectOption({ index: 1 });

    const toggle = root.locator('[data-action="param-sim-toggle"]');
    await toggle.waitFor({ state: 'visible' });
    await toggle.click();
    const figures = root.locator('.param-select-sim-figure');
    assert.equal(await figures.count(), 2, `${viewport.name}: expected two result figures`);
    assert.deepEqual(await figures.locator('figcaption').allTextContents(), ['CMOS1淀积厚度仿真', 'CMOS2淀积厚度仿真']);
    const imageResults = await figures.locator('img').evaluateAll(async (images) => Promise.all(images.map(async (image) => {
      await image.decode();
      return { src: image.src, width: image.naturalWidth, height: image.naturalHeight, alt: image.alt };
    })));
    assert.deepEqual(imageResults.map((item) => [item.width, item.height]), [[947, 323], [958, 328]]);
    assert.ok(imageResults.every((item) => item.src.startsWith('blob:')), `${viewport.name}: unresolved course image`);
    const layout = await root.evaluate((node) => ({
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      rootClientWidth: node.clientWidth,
      rootScrollWidth: node.scrollWidth,
      panelClientWidth: node.querySelector('.param-select-sim-panel')?.clientWidth,
      panelScrollWidth: node.querySelector('.param-select-sim-panel')?.scrollWidth,
    }));
    assert.ok(layout.documentWidth <= layout.viewport + 1, `${viewport.name}: document overflow`);
    assert.ok(layout.rootScrollWidth <= layout.rootClientWidth + 1, `${viewport.name}: parameter block overflow`);
    assert.ok(layout.panelScrollWidth <= layout.panelClientWidth + 1, `${viewport.name}: result panel overflow`);
    assert.deepEqual(consoleErrors, [], `${viewport.name}: console errors`);
    const screenshot = path.join(ROOT, 'tools', 'autosmt-2026', 'qa', `pecvd-result-${viewport.name}.png`);
    await root.scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshot });
    evidence.push({ viewport, imageResults, layout, screenshot: path.relative(ROOT, screenshot).replaceAll('\\', '/') });
    await context.close();
  }
} finally {
  await browser.close();
}

const report = path.join(ROOT, 'tools', 'autosmt-2026', 'qa', 'pecvd-result-browser.json');
writeFileSync(report, `${JSON.stringify({ evidence }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ evidence }, null, 2));
