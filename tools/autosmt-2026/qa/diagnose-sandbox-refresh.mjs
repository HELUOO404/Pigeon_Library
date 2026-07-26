import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORIGIN = process.env.PIGEON_QA_ORIGIN || 'http://127.0.0.1:5184';
const PLAYWRIGHT_PATH = process.env.PIGEON_PLAYWRIGHT_PATH;
if (!PLAYWRIGHT_PATH) throw new Error('PIGEON_PLAYWRIGHT_PATH must point to Playwright.');
const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT_PATH);
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && existsSync(candidate));

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1377, height: 812 } });
await context.route('http://localhost:8787/api/**', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(route.request().url().endsWith('/me')
    ? { user: { id: 'diagnostic-user', username: 'diagnostic-user', role: 'user' } }
    : { states: [] }),
}));
const page = await context.newPage();
await page.goto(`${ORIGIN}/learn.html?course=2026-ic-manufacturing`, { waitUntil: 'domcontentloaded' });
const header = page.locator('.card-header[data-kp-id="1-2-4"]');
await header.waitFor({ state: 'attached', timeout: 120_000 });
await page.locator('#chapterTabs .tab[data-chapter="1"]').click();
await header.waitFor({ state: 'visible' });
await header.click();
const tabs = page.locator('#kp-1-2-4 .tab-set-tab');
await tabs.nth(1).click();
const frame = page.locator('#kp-1-2-4 .sandbox-frame');
const frameLocator = page.frameLocator('#kp-1-2-4 .sandbox-frame');
await frameLocator.locator('[data-oxidation-simulation]').waitFor({ state: 'visible' });
const controls = frameLocator.locator('select');
for (const [index, value] of ['500', '500', '500', '10', '10'].entries()) await controls.nth(index).selectOption(value);
await frameLocator.locator('[data-draw-oxidation]').click();
await new Promise((resolve) => setTimeout(resolve, 1600));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('#chapterTabs .tab[data-chapter="1"]').click();
await page.locator('.card-header[data-kp-id="1-2-4"]').waitFor({ state: 'visible' });
await page.locator('.card-header[data-kp-id="1-2-4"]').click();
await page.locator('#kp-1-2-4 .tab-set-tab').nth(1).click();
const refreshedFrame = page.locator('#kp-1-2-4 .sandbox-frame');
const refreshedLocator = page.frameLocator('#kp-1-2-4 .sandbox-frame');
await refreshedLocator.locator('[data-oxidation-simulation]').waitFor({ state: 'visible' });
await new Promise((resolve) => setTimeout(resolve, 300));
await refreshedFrame.evaluate((node) => node.scrollIntoView({ behavior: 'auto', block: 'end' }));
await new Promise((resolve) => setTimeout(resolve, 100));
const snapshot = {
  main: await page.locator('#main').evaluate((node) => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop })),
  outer: await refreshedFrame.evaluate((node) => ({
    rect: node.getBoundingClientRect().toJSON(),
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    styleHeight: node.style.height,
  })),
  wrapper: await refreshedFrame.locator('xpath=..').evaluate((node) => ({ rect: node.getBoundingClientRect().toJSON(), scrollHeight: node.scrollHeight })),
  inner: await refreshedLocator.locator('body').evaluate(() => ({
    html: { clientHeight: document.documentElement.clientHeight, scrollHeight: document.documentElement.scrollHeight, scrollTop: document.documentElement.scrollTop },
    body: { clientHeight: document.body.clientHeight, scrollHeight: document.body.scrollHeight, scrollTop: document.body.scrollTop },
    root: document.querySelector('[data-oxidation-simulation]').getBoundingClientRect().toJSON(),
    clear: document.querySelector('[data-clear-oxidation]').getBoundingClientRect().toJSON(),
  })),
  clearVisible: await refreshedLocator.locator('[data-clear-oxidation]').isVisible(),
  clearBox: await refreshedLocator.locator('[data-clear-oxidation]').boundingBox(),
};
const report = path.join(ROOT, 'tools', 'autosmt-2026', 'qa', 'diagnose-sandbox-refresh.json');
writeFileSync(report, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(snapshot, null, 2));
await context.close();
await browser.close();
