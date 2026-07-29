#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '../../../app/node_modules/playwright/index.mjs';

const base = process.env.PIGEON_QA_BASE || 'http://127.0.0.1:5173';
const output = new URL('./poster-audit/', import.meta.url);
mkdirSync(output, { recursive: true });

async function navigateToCard(page, cardId) {
  const item = page.locator(`[data-action="navigate"][data-card="${cardId}"]`);
  const sectionId = await item.getAttribute('data-section');
  const chapterId = sectionId?.split('.')[0];
  if (chapterId && !await item.isVisible()) {
    await page.locator(`[data-action="switch-sidebar-chapter"][data-chapter="${chapterId}"]`).click();
  }
  await item.click();
}

async function audit(courseId) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.route(/\/assets\/media\/.*\.(?:mp4|m4v|mov|webm|ogg)(?:[?#]|$)/i, (route) => route.abort('blockedbyclient'));
  const started = performance.now();
  await page.goto(`${base}/learn.html?course=${courseId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.course-video-load').first().waitFor({ state: 'attached', timeout: 60000 });
  const interactiveMs = performance.now() - started;

  const gate = page.locator('.course-video-load').first();
  const cardId = await gate.evaluate((element) => element.closest('.knowledge-card')?.id || '');
  assert.ok(cardId, 'typed video must belong to a knowledge card');
  await navigateToCard(page, cardId);
  await gate.waitFor({ state: 'visible' });
  const poster = gate.locator('xpath=../span[contains(@class,"course-video-poster")]');
  await poster.locator('img').waitFor({ state: 'visible' });
  await page.waitForFunction((element) => element.dataset.mediaState === 'loaded', await poster.elementHandle());
  await poster.screenshot({ path: fileURLToPath(new URL(`${courseId}-normal-poster.png`, output)) });
  const normal = await poster.evaluate((element) => {
    const image = element.querySelector('img');
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(image);
    const imageBox = image.getBoundingClientRect();
    return {
      url: image.currentSrc,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      boxWidth: box.width,
      boxHeight: box.height,
      imageWidth: imageBox.width,
      imageHeight: imageBox.height,
      objectFit: style.objectFit,
      objectPosition: style.objectPosition,
      complete: image.complete,
    };
  });

  const step = page.locator('.step-simulation').first();
  if (await step.count()) {
    const stepCardId = await step.evaluate((element) => element.closest('.knowledge-card')?.id || '');
    await navigateToCard(page, stepCardId);
    const stepPoster = step.locator('.step-simulation-poster');
    await stepPoster.locator('img').waitFor({ state: 'visible' });
    await page.waitForFunction((element) => element.dataset.mediaState === 'loaded', await stepPoster.elementHandle());
    await stepPoster.screenshot({ path: fileURLToPath(new URL(`${courseId}-step-poster.png`, output)) });
  }

  const resources = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => /\/assets\/images\/posters\//.test(entry.name))
    .map((entry) => ({
      url: entry.name,
      startTime: entry.startTime,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
    })));
  const videoRequests = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter((entry) => /\/assets\/media\/.*\.(?:mp4|m4v|mov|webm|ogg)(?:[?#]|$)/i.test(entry.name)).length);
  await browser.close();
  const naturalRatio = normal.naturalWidth / normal.naturalHeight;
  const renderedRatio = normal.imageWidth / normal.imageHeight;
  assert.ok(Math.abs(naturalRatio - renderedRatio) < 0.01, `${courseId}: poster aspect ratio changed (${naturalRatio} → ${renderedRatio})`);
  assert.equal(normal.objectFit, 'contain', `${courseId}: poster must use object-fit contain`);
  assert.ok(normal.url.includes('/assets/images/posters/'), `${courseId}: poster URL`);
  assert.equal(videoRequests, 0, `${courseId}: cold view requested full video`);
  const manifestPath = path.resolve(fileURLToPath(new URL('../../../dist-courses/2026-vocational-preliminary/', import.meta.url)), courseId, 'delivery-manifest.json');
  const delivery = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const posterBytes = delivery.deployment.externalAssets
    .filter((asset) => asset.path.includes('/posters/'))
    .map((asset) => asset.bytes)
    .sort((left, right) => left - right);
  const p90 = posterBytes[Math.ceil(posterBytes.length * 0.9) - 1] || 0;
  const maximum = posterBytes.at(-1) || 0;
  assert.ok(p90 <= 64 * 1024, `${courseId}: poster p90 exceeds 64 KiB (${p90})`);
  assert.ok(maximum <= 100 * 1024, `${courseId}: poster maximum exceeds 100 KiB (${maximum})`);
  return { courseId, interactiveMs, normal, resources, posterBudget: { count: posterBytes.length, p90, maximum } };
}

const reports = [];
for (const id of ['2026-ic-manufacturing', '2026-ic-devices', '2026-ic-packaging']) reports.push(await audit(id));
writeFileSync(new URL('report.json', output), `${JSON.stringify(reports, null, 2)}\n`);
console.log(JSON.stringify(reports, null, 2));
