import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ORIGIN = process.env.PIGEON_QA_ORIGIN || 'http://127.0.0.1:5173';
const COURSE_URL = `${ORIGIN}/learn.html?course=2026-ic-packaging`;
const REPORT = path.join(ROOT, 'tools', 'autosmt-2026', 'qa', 'sidebar-reading-progress.json');
const PLAYWRIGHT_PATH = process.env.PIGEON_PLAYWRIGHT_PATH;
if (!PLAYWRIGHT_PATH) throw new Error('PIGEON_PLAYWRIGHT_PATH must point to Playwright.');
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT_PATH);

function browserExecutable() {
  return [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((candidate) => candidate && existsSync(candidate));
}

async function activeSection(page) {
  const labels = page.locator('.tree-section-label.active');
  assert.equal(await labels.count(), 1, 'exactly one sidebar section must be active');
  return labels.first().getAttribute('data-section');
}

async function waitForActive(page, sectionId) {
  await page.waitForFunction(
    (section) => document.querySelector('.tree-section-label.active')?.dataset.section === section,
    sectionId,
    { timeout: 10_000 },
  );
}

async function scrollToSection(page, sectionId) {
  await page.locator(`#overview-${sectionId.replace('.', '-')}`).evaluate((node) => {
    node.scrollIntoView({ behavior: 'auto', block: 'start' });
  });
  await waitForActive(page, sectionId);
}

const launch = { headless: true };
const executablePath = browserExecutable();
if (executablePath) launch.executablePath = executablePath;

const evidence = { url: COURSE_URL, steps: [] };
const browser = await chromium.launch(launch);
const context = await browser.newContext({ viewport: { width: 1377, height: 812 } });
await context.route('https://fonts.googleapis.com/**', (route) => route.fulfill({
  status: 200,
  contentType: 'text/css; charset=utf-8',
  body: '',
}));
await context.route('http://localhost:8787/api/**', (route) => {
  const pathname = new URL(route.request().url()).pathname;
  const body = pathname === '/api/me'
    ? { user: { id: 'sidebar-qa', username: 'sidebar-qa', role: 'user' } }
    : pathname === '/api/sync'
      ? { states: [] }
      : { applied: true, updated_at: 4102444800000 };
  return route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(String(error)));

try {
  await page.goto(COURSE_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('#tree-section-4-1').waitFor({ state: 'visible', timeout: 120_000 });
  await page.locator('.tree-title[data-chapter="4"]').click();
  await page.locator('#overview-4-1').waitFor({ state: 'visible', timeout: 30_000 });

  for (const sectionId of ['4.1', '4.2', '4.3', '4.2', '4.1']) {
    await scrollToSection(page, sectionId);
    evidence.steps.push({ scroll: sectionId, active: await activeSection(page) });
  }

  await scrollToSection(page, '4.3');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('#tree-section-4-3').waitFor({ state: 'visible', timeout: 120_000 });
  await waitForActive(page, '4.3');
  evidence.afterReload = {
    active: await activeSection(page),
    scrollTop: await page.locator('#main').evaluate((node) => Math.round(node.scrollTop)),
  };
  evidence.consoleErrors = consoleErrors;
  assert.deepEqual(consoleErrors, [], 'sidebar QA must not produce console errors');
} finally {
  await context.close();
  await browser.close();
}

writeFileSync(REPORT, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
