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
const COURSES = [
  { id: '2026-ic-manufacturing', title: '2026职业赛道初赛IC制造', chapters: 1, cards: 44 },
  { id: '2026-ic-devices', title: '2026职业赛道初赛IC器件', chapters: 2, cards: 36 },
  { id: '2026-ic-packaging', title: '2026职业赛道初赛IC封装', chapters: 3, cards: 49 },
];

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
    ? { user: { id: 'load-qa', username: 'load-qa', role: 'user' } }
    : pathname === '/api/sync' ? { states: [] } : { applied: true, updated_at: 4102444800000 };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
const page = await context.newPage();
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(String(error)));
const evidence = { homepage: [], courses: [] };

try {
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  for (const course of COURSES) {
    const card = page.locator(`.course-card[data-course-key="${course.id}"]`);
    await card.waitFor({ state: 'visible', timeout: 120_000 });
    evidence.homepage.push({ id: course.id, title: (await card.locator('h3').textContent())?.trim() });
  }
  for (const course of COURSES) {
    await page.goto(`${ORIGIN}/learn.html?course=${course.id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.locator('.knowledge-card').first().waitFor({ state: 'visible', timeout: 120_000 });
    const actual = {
      id: course.id,
      title: (await page.locator('#courseLogo').textContent())?.trim(),
      chapters: await page.locator('#chapterTabs .tab').count(),
      cards: await page.locator('.knowledge-card').count(),
      sections: await page.locator('.tree-section-label').count(),
    };
    assert.equal(actual.title, course.title, `${course.id}: title`);
    assert.equal(actual.chapters, course.chapters, `${course.id}: chapter count`);
    assert.equal(actual.cards, course.cards, `${course.id}: knowledge-card count`);
    evidence.courses.push(actual);
  }
  assert.deepEqual(errors, [], 'three-course loading must not produce console errors');
} finally {
  await context.close();
  await browser.close();
}

const report = path.join(ROOT, 'tools', 'autosmt-2026', 'qa', 'three-course-load-browser.json');
writeFileSync(report, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
