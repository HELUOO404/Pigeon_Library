#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from '../../../app/node_modules/playwright/index.mjs';

const base = process.env.PIGEON_QA_BASE || 'http://127.0.0.1:5173';
const courseId = process.env.PIGEON_QA_COURSE || '2026-ic-devices';
const mediaPattern = /\/assets\/media\/.*\.(?:mp4|m4v|mov|webm|ogg)(?:[?#]|$)/i;

async function open(viewport) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const mediaRequests = [];
  page.on('request', (request) => {
    if (mediaPattern.test(request.url())) mediaRequests.push(request.url());
  });
  await page.route(mediaPattern, (route) => route.abort('blockedbyclient'));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/learn.html?course=${courseId}`, { waitUntil: 'networkidle' });
  return { browser, page, mediaRequests, errors };
}

async function revealCard(page, locator) {
  const cardId = await locator.evaluate((element) => element.closest('.knowledge-card')?.id || '');
  if (!cardId) return '';
  await page.locator(`[data-action="navigate"][data-card="${cardId}"]`).click();
  await locator.waitFor({ state: 'visible' });
  return cardId;
}

async function selectUntilMedia(page, mediaRequests) {
  const select = page.locator('.step-simulation-choice[data-action="simulation-select"]').first();
  await select.waitFor({ state: 'attached' });
  await revealCard(page, select);
  const values = await select.locator('option').evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
  const baseline = mediaRequests.length;
  for (const value of values) {
    await select.selectOption(value);
    await page.waitForTimeout(80);
    if (mediaRequests.length > baseline) return;
  }
  assert.fail('No step option triggered its experiment clip');
}

const desktop = await open({ width: 1440, height: 900 });
try {
  assert.equal(desktop.mediaRequests.length, 0, 'cold navigation must not request full video');
  const generatedImages = await desktop.page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => entry.name.includes('/assets/generated/images/')).map((entry) => entry.name));
  assert.ok(generatedImages.length > 0, 'cold view must use generated lossless WebP images');
  assert.equal(await desktop.page.locator('.course-video video, .course-video source').count(), 0, 'typed videos must start gated');
  const videoGate = desktop.page.locator('.course-video-load').first();
  assert.ok(await desktop.page.locator('.course-video-load').count() > 0, 'course must expose a typed video gate');
  assert.ok(await desktop.page.locator('.course-video-poster img[data-src], .course-video-poster img[src]').count() > 0, 'typed video gate must expose a poster');

  const id = await revealCard(desktop.page, videoGate);
  await videoGate.click();
  await desktop.page.waitForTimeout(100);
  assert.equal(desktop.mediaRequests.length, 1, 'one typed video click must start one video request');
  assert.equal(await desktop.page.locator('.course-video video source').count(), 1, 'one typed video source must exist');
  await desktop.page.locator(`#${id} [data-action="toggle-card"]`).click();
  await desktop.page.locator(`#${id} [data-action="toggle-card"]`).click();
  await videoGate.waitFor({ state: 'visible' });
  assert.equal(await videoGate.isEnabled(), true, 'video gate must be reusable after card collapse');

  const beforeExperiment = desktop.mediaRequests.length;
  await selectUntilMedia(desktop.page, desktop.mediaRequests);
  assert.equal(desktop.mediaRequests.length, beforeExperiment + 1, 'correct experiment choice must immediately request one clip');
  assert.equal(await desktop.page.locator('.step-simulation video source').count(), 1, 'only one experiment source may exist');
  assert.deepEqual(desktop.errors, [], 'desktop page errors');
} finally {
  await desktop.browser.close();
}

const mobile = await open({ width: 390, height: 844 });
try {
  assert.equal(mobile.mediaRequests.length, 0, 'mobile cold navigation must not request full video');
  await selectUntilMedia(mobile.page, mobile.mediaRequests).catch(() => {});
  assert.equal(mobile.mediaRequests.length, 0, 'mobile experiment interaction must not request clips');
  assert.equal(await mobile.page.locator('.step-simulation-media').count(), 0, 'mobile must not render experiment media panels');
  assert.deepEqual(mobile.errors, [], 'mobile page errors');
} finally {
  await mobile.browser.close();
}

console.log('progressive-media-browser: ok');
