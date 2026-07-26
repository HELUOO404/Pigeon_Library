import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORIGIN = process.env.PIGEON_QA_ORIGIN || 'http://127.0.0.1:5185';
const PLAYWRIGHT_PATH = process.env.PIGEON_PLAYWRIGHT_PATH;
if (!PLAYWRIGHT_PATH) throw new Error('PIGEON_PLAYWRIGHT_PATH must point to Playwright.');
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT_PATH);
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((candidate) => candidate && existsSync(candidate));

const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1377, height: 812 } });
await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
await context.route('http://localhost:8787/api/**', (route) => {
  const pathname = new URL(route.request().url()).pathname;
  const body = pathname === '/api/me'
    ? { user: { id: 'oxidation-clear-qa', username: 'oxidation-clear-qa', role: 'user' } }
    : pathname === '/api/sync' ? { states: [] } : { applied: true, updated_at: 4102444800000 };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
const page = await context.newPage();

async function openSimulation() {
  const header = page.locator('.card-header[data-kp-id="1-2-4"]');
  await header.waitFor({ state: 'attached', timeout: 120_000 });
  await page.locator('#chapterTabs .tab[data-chapter="1"]').click();
  await header.waitFor({ state: 'visible' });
  const body = page.locator('#kp-1-2-4 .card-body');
  if ((await body.getAttribute('class') || '').includes('hidden')) await header.click();
  await body.waitFor({ state: 'visible' });
  await page.locator('#kp-1-2-4 .tab-set-tab').nth(1).click();
  const frame = page.frameLocator('#kp-1-2-4 .sandbox-frame');
  await frame.locator('[data-oxidation-simulation]').waitFor({ state: 'visible' });
  const frameElement = page.locator('#kp-1-2-4 .sandbox-frame');
  await frameElement.evaluate((node) => node.scrollIntoView({ behavior: 'auto', block: 'end' }));
  return { frame, frameElement, selects: frame.locator('select'), clear: frame.locator('[data-clear-oxidation]'), draw: frame.locator('[data-draw-oxidation]') };
}

await page.goto(`${ORIGIN}/learn.html?course=2026-ic-manufacturing`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
let simulation = await openSimulation();
const values = ['500', '500', '500', '10', '10'];
for (let index = 0; index < values.length; index += 1) await simulation.selects.nth(index).selectOption(values[index]);
await simulation.draw.click();
await new Promise((resolve) => setTimeout(resolve, 1_600));
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
simulation = await openSimulation();
assert.deepEqual(await simulation.selects.evaluateAll((nodes) => nodes.map((node) => node.value)), values, 'refresh must restore practice values');
await simulation.frameElement.evaluate((node) => node.scrollIntoView({ behavior: 'auto', block: 'end' }));
await simulation.clear.click();
await page.waitForTimeout(500);
const empty = ['', '', '', '', ''];
assert.deepEqual(await simulation.selects.evaluateAll((nodes) => nodes.map((node) => node.value)), empty, 'clear must empty restored controls');
await page.waitForTimeout(1_600);
const stored = await page.evaluate(() => {
  const raw = localStorage.getItem('pglib:u:oxidation-clear-qa:2026-ic-manufacturing:simulations');
  return raw ? JSON.parse(raw)['sandbox:experiment-1-oxidation-temperature-curve'] : null;
});
assert.deepEqual(stored?.controls?.map((item) => item.value), empty, 'clear must persist empty controls');
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
simulation = await openSimulation();
assert.deepEqual(await simulation.selects.evaluateAll((nodes) => nodes.map((node) => node.value)), empty, 'refresh after clear must remain empty');

const report = path.join(ROOT, 'tools', 'autosmt-2026', 'qa', 'oxidation-clear-refresh.json');
writeFileSync(report, `${JSON.stringify({ origin: ORIGIN, restored: values, afterClear: empty, persisted: true }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ report, restored: values, afterClear: empty }));
await context.close();
await browser.close();
