import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const QA_DIR = path.join(ROOT, 'tools', 'autosmt-2026', 'qa');
const REPORT_FILE = path.join(QA_DIR, 'devices-all-interactions-browser.json');
const URL = process.env.PIGEON_QA_URL || 'http://127.0.0.1:5185/learn.html?course=2026-ic-devices';
const PAGE_ORIGIN = new globalThis.URL(URL).origin;
const STATIC_FONT_ORIGINS = ['https://fonts.googleapis.com/', 'https://fonts.gstatic.com/'];
const PLAYWRIGHT_PATH = process.env.PIGEON_PLAYWRIGHT_PATH;
if (!PLAYWRIGHT_PATH) throw new Error('PIGEON_PLAYWRIGHT_PATH must point to the bundled Playwright package.');
const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT_PATH);

const ALL_VIEWPORTS = [
  { name: 'desktop', width: 1377, height: 812 },
  { name: 'wide', width: 2048, height: 1216 },
  { name: 'mobile', width: 375, height: 812 },
];
const VIEWPORTS = process.env.PIGEON_QA_VIEWPORT
  ? ALL_VIEWPORTS.filter((item) => item.name === process.env.PIGEON_QA_VIEWPORT)
  : ALL_VIEWPORTS;
if (!VIEWPORTS.length) throw new Error(`Unknown PIGEON_QA_VIEWPORT: ${process.env.PIGEON_QA_VIEWPORT}`);

function localBrowser() {
  return [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
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

async function installRoutes(context, syncCalls) {
  await context.route('http://localhost:8787/api/**', async (route) => {
    const request = route.request();
    const endpoint = new globalThis.URL(request.url()).pathname.replace(/^\/api/, '');
    const headers = jsonHeaders(request.headers().origin);
    syncCalls.push({ method: request.method(), endpoint });
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' });
    } else if (request.method() === 'GET' && endpoint === '/me') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ user: { id: 'devices-qa', username: 'devices-qa', role: 'user' } }) });
    } else if (request.method() === 'GET' && endpoint === '/sync') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ states: [] }) });
    } else if (request.method() === 'PUT' && endpoint.startsWith('/state/')) {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ applied: true, updated_at: 4102444800000 }) });
    } else {
      await route.fulfill({ status: 404, headers, body: JSON.stringify({ error: 'unexpected QA API call' }) });
    }
  });
  for (const origin of STATIC_FONT_ORIGINS) {
    await context.route(`${origin}**`, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  }
}

async function loadCourse(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.locator('.knowledge-card').first().waitFor({ state: 'attached', timeout: 120_000 });
  await page.locator('#main').waitFor({ state: 'visible', timeout: 30_000 });
}

async function discoverInventory(page) {
  return page.evaluate(() => {
    const describe = (node, id) => {
      const card = node.closest('.knowledge-card');
      const panel = node.closest('.tab-set-panel');
      return {
        id,
        kpId: card?.id.replace(/^kp-/, '') || '',
        tabButtonId: panel?.getAttribute('aria-labelledby') || '',
      };
    };
    return {
      sandboxes: [...document.querySelectorAll('.sandbox-wrapper')].map((node) => describe(
        node,
        (node.dataset.sandboxKey || '').replace(/^sandbox:/, ''),
      )),
      stepSimulations: [...document.querySelectorAll('.step-simulation[data-simulation-id]')]
        .map((node) => describe(node, node.dataset.simulationId)),
      paramSelects: [...document.querySelectorAll('.param-select[data-param-id]')]
        .map((node) => describe(node, node.dataset.paramId)),
    };
  });
}

async function discoverStaticInventory(page) {
  return page.evaluate(() => {
    const context = (node) => {
      const card = node.closest('.knowledge-card');
      const panel = node.closest('.tab-set-panel');
      return {
        kpId: card?.id.replace(/^kp-/, '') || '',
        tabButtonId: panel?.getAttribute('aria-labelledby') || '',
      };
    };
    return {
      cards: [...document.querySelectorAll('.knowledge-card')].map((node) => ({
        kpId: node.id.replace(/^kp-/, ''),
        title: node.querySelector('.card-title')?.textContent?.trim() || '',
      })),
      tabSets: [...document.querySelectorAll('.tab-set[data-tab-set-id]')].map((node) => ({
        ...context(node),
        id: node.dataset.tabSetId,
        buttonIds: [...node.querySelectorAll('.tab-set-tab')].map((button) => button.id),
      })),
      standaloneImages: [...document.querySelectorAll('img[style*="max-width:100%"][style*="margin:8px auto"]')]
        .map((node, index) => ({ ...context(node), index, alt: node.alt })),
      imageGroups: [...document.querySelectorAll('.image-group')]
        .map((node, index) => ({ ...context(node), index, imageCount: node.querySelectorAll('img').length })),
      paramsTables: [...document.querySelectorAll('.params-table-wrap')]
        .map((node, index) => ({ ...context(node), index })),
      videos: [...document.querySelectorAll('.course-video')]
        .map((node, index) => ({ ...context(node), index, title: node.querySelector('figcaption')?.textContent?.trim() || '' })),
    };
  });
}

async function ensureVisible(page, item, root) {
  const chapter = item.kpId.split('-')[0];
  const chapterTab = page.locator(`#chapterTabs .tab[data-chapter="${chapter}"]`);
  if (await chapterTab.count()) await chapterTab.evaluate((button) => button.click());
  const header = page.locator(`.card-header[data-kp-id="${item.kpId}"]`);
  const body = page.locator(`#kp-${item.kpId} .card-body`);
  await header.waitFor({ state: 'visible', timeout: 30_000 });
  if ((await body.getAttribute('class') || '').includes('hidden')) await header.evaluate((button) => button.click());
  await body.waitFor({ state: 'visible', timeout: 30_000 });
  if (item.tabButtonId) {
    const tab = page.locator(`[id="${item.tabButtonId}"]`);
    await tab.evaluate((button) => button.click());
  }
  await root.waitFor({ state: 'visible', timeout: 30_000 });
  await root.evaluate((node) => node.scrollIntoView({ behavior: 'auto', block: 'center' }));
}

async function layoutAudit(page, root, label) {
  const result = await page.evaluate((selector) => {
    const node = document.querySelector(selector);
    const rect = node.getBoundingClientRect();
    return {
      innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      rootClientWidth: node.clientWidth,
      rootScrollWidth: node.scrollWidth,
      rootLeft: rect.left,
      rootRight: rect.right,
    };
  }, await root.evaluate((node) => {
    if (node.dataset.sandboxKey) return `.sandbox-wrapper[data-sandbox-key="${CSS.escape(node.dataset.sandboxKey)}"]`;
    if (node.dataset.simulationId) return `.step-simulation[data-simulation-id="${CSS.escape(node.dataset.simulationId)}"]`;
    return `.param-select[data-param-id="${CSS.escape(node.dataset.paramId)}"]`;
  }));
  assert.ok(result.documentWidth <= result.innerWidth + 1, `${label}: document horizontal overflow`);
  assert.ok(result.bodyWidth <= result.innerWidth + 1, `${label}: body horizontal overflow`);
  assert.ok(result.rootScrollWidth <= result.rootClientWidth + 1, `${label}: object horizontal overflow`);
  assert.ok(result.rootLeft >= -1 && result.rootRight <= result.innerWidth + 1, `${label}: object outside viewport`);
  return result;
}

async function directLayoutAudit(root, label) {
  const result = await root.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      left: rect.left,
      right: rect.right,
    };
  });
  assert.ok(result.documentWidth <= result.innerWidth + 1, `${label}: document horizontal overflow`);
  assert.ok(result.bodyWidth <= result.innerWidth + 1, `${label}: body horizontal overflow`);
  assert.ok(result.scrollWidth <= result.clientWidth + 1, `${label}: internal horizontal overflow`);
  assert.ok(result.left >= -1 && result.right <= result.innerWidth + 1, `${label}: outside viewport`);
  return result;
}

async function imageAudit(locator, label) {
  const images = locator.locator('img:visible');
  const count = await images.count();
  const results = await images.evaluateAll(async (nodes) => Promise.all(nodes.map(async (image) => {
    image.loading = 'eager';
    await image.decode();
    return { src: image.currentSrc || image.src, width: image.naturalWidth, height: image.naturalHeight, alt: image.alt };
  })));
  assert.equal(results.length, count, `${label}: image count changed while decoding`);
  assert.ok(results.every((item) => item.width > 0 && item.height > 0), `${label}: undecoded image`);
  assert.ok(results.every((item) => item.src.startsWith('blob:') || item.src.startsWith('data:') || item.src.startsWith(`${PAGE_ORIGIN}/`)), `${label}: unresolved image URL`);
  return { count, images: results, dimensions: results.map((item) => [item.width, item.height]) };
}

async function auditStaticCourse(page, inventory, viewport) {
  assert.equal(inventory.cards.length, 36, `${viewport.name}: knowledge-card inventory`);
  assert.equal(inventory.tabSets.length, 19, `${viewport.name}: tabSet inventory`);
  assert.equal(inventory.standaloneImages.length, 42, `${viewport.name}: image block inventory`);
  assert.equal(inventory.imageGroups.length, 1, `${viewport.name}: imageGroup inventory`);
  assert.equal(inventory.paramsTables.length, 9, `${viewport.name}: paramsTable inventory`);
  assert.equal(inventory.videos.length, 17, `${viewport.name}: video inventory`);

  const cards = [];
  for (const item of inventory.cards) {
    const root = page.locator(`#kp-${item.kpId}`);
    await ensureVisible(page, item, root);
    assert.ok((await root.locator('.card-body-content').count()) > 0, `${viewport.name}/${item.kpId}: card content missing`);
    cards.push({ ...item, layout: await directLayoutAudit(root, `${viewport.name}/card/${item.kpId}`) });
  }

  const tabSets = [];
  for (const item of inventory.tabSets) {
    const root = page.locator(`.tab-set[data-tab-set-id="${item.id}"]`);
    await ensureVisible(page, item, root);
    assert.ok(item.buttonIds.length > 0, `${viewport.name}/${item.id}: tabSet has no tabs`);
    const panels = [];
    for (const buttonId of item.buttonIds) {
      const button = page.locator(`[id="${buttonId}"]`);
      const panelId = await button.getAttribute('aria-controls');
      await button.evaluate((node) => node.click());
      const panel = page.locator(`[id="${panelId}"]`);
      await panel.waitFor({ state: 'visible', timeout: 30_000 });
      assert.equal(await button.getAttribute('aria-selected'), 'true', `${viewport.name}/${item.id}/${buttonId}: tab not selected`);
      panels.push({ buttonId, panelId, layout: await directLayoutAudit(panel, `${viewport.name}/tab/${item.id}/${buttonId}`) });
    }
    tabSets.push({ ...item, panels });
  }

  const imageLocator = page.locator('img[style*="max-width:100%"][style*="margin:8px auto"]');
  const images = await imageLocator.evaluateAll(async (nodes) => Promise.all(nodes.map(async (image, index) => {
    image.loading = 'eager';
    await image.decode();
    return {
      index,
      src: image.currentSrc || image.src,
      alt: image.alt,
      width: image.naturalWidth,
      height: image.naturalHeight,
      represented: image.isConnected,
    };
  })));
  assert.equal(images.length, 42, `${viewport.name}: decoded image block count`);
  assert.ok(images.every((item) => item.represented && item.width > 0 && item.height > 0), `${viewport.name}: image block decode failure`);
  assert.ok(images.every((item) => item.src.startsWith('blob:') || item.src.startsWith(`${PAGE_ORIGIN}/`)), `${viewport.name}: non-local image block`);

  const imageGroups = [];
  for (const item of inventory.imageGroups) {
    const root = page.locator('.image-group').nth(item.index);
    await ensureVisible(page, item, root);
    assert.equal(item.imageCount, 2, `${viewport.name}/imageGroup/${item.index}: image count`);
    const decoded = await root.locator('img').evaluateAll(async (nodes) => Promise.all(nodes.map(async (image) => {
      image.loading = 'eager';
      await image.decode();
      return { src: image.currentSrc || image.src, width: image.naturalWidth, height: image.naturalHeight, alt: image.alt };
    })));
    assert.equal(decoded.length, 2, `${viewport.name}/imageGroup/${item.index}: decoded image count`);
    assert.ok(decoded.every((image) => image.width > 0 && image.height > 0), `${viewport.name}/imageGroup/${item.index}: natural size`);
    assert.ok(decoded.every((image) => image.src.startsWith('blob:') || image.src.startsWith(`${PAGE_ORIGIN}/`)), `${viewport.name}/imageGroup/${item.index}: non-local image`);
    const childLayouts = [];
    for (let index = 0; index < 2; index += 1) {
      childLayouts.push(await directLayoutAudit(root.locator('figure').nth(index), `${viewport.name}/imageGroup/${item.index}/figure/${index}`));
      childLayouts.push(await directLayoutAudit(root.locator('img').nth(index), `${viewport.name}/imageGroup/${item.index}/image/${index}`));
    }
    imageGroups.push({ ...item, decoded, layout: await directLayoutAudit(root, `${viewport.name}/imageGroup/${item.index}`), childLayouts });
  }

  const paramsTables = [];
  for (const item of inventory.paramsTables) {
    const root = page.locator('.params-table-wrap').nth(item.index);
    await ensureVisible(page, item, root);
    const representation = viewport.name === 'mobile' ? root.locator('.params-table-mobile') : root.locator('.params-table');
    await representation.waitFor({ state: 'visible', timeout: 30_000 });
    const rows = viewport.name === 'mobile'
      ? await representation.locator('.params-table-record').count()
      : await representation.locator('tbody tr').count();
    assert.ok(rows > 0, `${viewport.name}/paramsTable/${item.index}: no rows`);
    paramsTables.push({
      ...item,
      rows,
      layout: await directLayoutAudit(root, `${viewport.name}/paramsTable/${item.index}`),
      representationLayout: await directLayoutAudit(representation, `${viewport.name}/paramsTable/${item.index}/representation`),
    });
  }

  const videos = [];
  for (const item of inventory.videos) {
    const root = page.locator('.course-video').nth(item.index);
    await ensureVisible(page, item, root);
    const video = root.locator('video');
    const metadata = await video.evaluate(async (node) => {
      const source = node.querySelector('source')?.src || node.currentSrc;
      if (node.readyState < 1) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('video metadata timeout')), 15_000);
          node.addEventListener('loadedmetadata', () => { clearTimeout(timeout); resolve(); }, { once: true });
          node.addEventListener('error', () => { clearTimeout(timeout); reject(new Error(`video error ${node.error?.code || 'unknown'}`)); }, { once: true });
          node.load();
        });
      }
      return {
        source,
        readyState: node.readyState,
        duration: node.duration,
        videoWidth: node.videoWidth,
        videoHeight: node.videoHeight,
      };
    });
    assert.ok(metadata.source.startsWith('blob:') || metadata.source.startsWith(`${PAGE_ORIGIN}/`), `${viewport.name}/video/${item.index}: non-local source`);
    assert.ok(metadata.readyState >= 1, `${viewport.name}/video/${item.index}: metadata unavailable`);
    assert.ok(Number.isFinite(metadata.duration) && metadata.duration > 0, `${viewport.name}/video/${item.index}: invalid duration`);
    assert.ok(metadata.videoWidth > 0 && metadata.videoHeight > 0, `${viewport.name}/video/${item.index}: invalid dimensions`);
    videos.push({ ...item, metadata, layout: await directLayoutAudit(root, `${viewport.name}/video/${item.index}`) });
  }
  return { cards, tabSets, images, imageGroups, paramsTables, videos };
}

async function canvasPixels(frame) {
  return frame.locator('canvas.drawing-canvas').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let pixels = 0;
    for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) pixels += 1;
    return pixels;
  });
}

async function waitForCanvas(frame, nonblank, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  let pixels = await canvasPixels(frame);
  while ((nonblank ? pixels === 0 : pixels !== 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    pixels = await canvasPixels(frame);
  }
  return pixels;
}

async function sandboxValues(frame) {
  return frame.locator('select[data-control-index]').evaluateAll((nodes) => nodes
    .sort((left, right) => Number(left.dataset.controlIndex) - Number(right.dataset.controlIndex))
    .map((node) => node.value));
}

async function sandboxInnerLayout(frame, frameElement, label) {
  const result = await frame.locator('html').evaluate((html) => {
    const root = document.querySelector('[data-drawing-simulation]');
    return {
      htmlClientWidth: html.clientWidth,
      htmlScrollWidth: html.scrollWidth,
      htmlClientHeight: html.clientHeight,
      htmlScrollHeight: html.scrollHeight,
      htmlScrollTop: html.scrollTop,
      bodyScrollTop: document.body.scrollTop,
      htmlOverflowY: getComputedStyle(html).overflowY,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
    };
  });
  result.iframeHeight = await frameElement.evaluate((node) => node.getBoundingClientRect().height);
  assert.ok(result.htmlScrollWidth <= result.htmlClientWidth + 1, `${label}: iframe horizontal scroll`);
  assert.ok(result.rootScrollWidth <= result.rootClientWidth + 1, `${label}: sandbox root horizontal scroll`);
  assert.ok(result.htmlScrollHeight <= result.htmlClientHeight + 2, `${label}: iframe internal vertical scroll`);
  assert.ok(Math.abs(result.iframeHeight - result.htmlScrollHeight) <= 2, `${label}: iframe height is not adaptive`);
  assert.equal(result.htmlScrollTop, 0, `${label}: iframe html scrolled`);
  assert.equal(result.bodyScrollTop, 0, `${label}: iframe body scrolled`);
  assert.equal(result.htmlOverflowY, 'hidden', `${label}: iframe html overflow-y`);
  assert.equal(result.bodyOverflowY, 'hidden', `${label}: iframe body overflow-y`);
  return result;
}

function sandboxRoot(page, item) {
  return page.locator(`.sandbox-wrapper[data-sandbox-key="sandbox:${item.id}"]`);
}

function sandboxFrame(page, item) {
  return page.frameLocator(`.sandbox-wrapper[data-sandbox-key="sandbox:${item.id}"] iframe.sandbox-frame`);
}

async function auditSandbox(page, item, viewport) {
  const label = `${viewport.name}/${item.id}`;
  const root = sandboxRoot(page, item);
  await ensureVisible(page, item, root);
  const frameElement = root.locator('iframe.sandbox-frame');
  const frame = sandboxFrame(page, item);
  await frame.locator('[data-drawing-simulation]').waitFor({ state: 'visible', timeout: 30_000 });
  const selects = frame.locator('select[data-control-index]');
  const controlCount = await selects.count();
  assert.ok(controlCount > 0, `${label}: missing controls`);
  const optionCounts = await selects.evaluateAll((nodes) => nodes.map((node) => node.options.length - 1));
  assert.ok(optionCounts.every((count) => count > 0), `${label}: empty option list`);
  assert.deepEqual(await sandboxValues(frame), Array(controlCount).fill(''), `${label}: initial values not empty`);
  assert.equal(await canvasPixels(frame), 0, `${label}: initial canvas not blank`);
  const initialInnerLayout = await sandboxInnerLayout(frame, frameElement, `${label}/initial`);
  const images = await imageAudit(frame.locator('[data-drawing-simulation]'), `${label}/sandbox`);

  await root.locator('[data-action="switch-sandbox-mode"][data-mode="answer"]').evaluate((button) => button.click());
  await page.waitForTimeout(160);
  const answers = await sandboxValues(frame);
  assert.equal(answers.length, controlCount, `${label}: answer control count`);
  assert.ok(answers.every(Boolean), `${label}: incomplete reference answers`);
  assert.ok(await waitForCanvas(frame, true) > 0, `${label}: reference canvas blank`);
  assert.ok(await selects.evaluateAll((nodes) => nodes.every((node) => node.disabled)), `${label}: answer controls editable`);

  await root.locator('[data-action="switch-sandbox-mode"][data-mode="practice"]').evaluate((button) => button.click());
  await page.waitForTimeout(120);
  assert.deepEqual(await sandboxValues(frame), Array(controlCount).fill(''), `${label}: practice did not clear answer state`);
  assert.equal(await waitForCanvas(frame, false), 0, `${label}: practice canvas not blank`);
  for (let index = 0; index < answers.length; index += 1) {
    await selects.nth(index).evaluate((node, value) => {
      node.value = value;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }, answers[index]);
  }
  await frame.locator('[data-drawing-action]').first().evaluate((button) => button.click());
  assert.ok(await waitForCanvas(frame, true) > 0, `${label}: practice canvas blank`);
  const practiceInnerLayout = await sandboxInnerLayout(frame, frameElement, `${label}/practice`);
  const outerLayout = await layoutAudit(page, root, label);
  return { ...item, controlCount, optionCounts, answers, images, initialInnerLayout, practiceInnerLayout, outerLayout };
}

function stepRoot(page, item) {
  return page.locator(`.step-simulation[data-simulation-id="${item.id}"]`);
}

function controlSelector(control) {
  const index = control.action === 'simulation-group-select' ? `data-group="${control.index}"` : `data-step="${control.index}"`;
  return `[data-action="${control.action}"][${index}]`;
}

async function setAllStepControls(page, id, value) {
  return page.evaluate(({ simulationId, nextValue }) => {
    const rootSelector = `.step-simulation[data-simulation-id="${CSS.escape(simulationId)}"]`;
    const root = document.querySelector(rootSelector);
    const controls = [...root.querySelectorAll('.step-simulation-choice')].map((node) => ({
      action: node.dataset.action,
      index: node.dataset.group || node.dataset.step,
    }));
    for (const control of controls) {
      const attr = control.action === 'simulation-group-select' ? 'data-group' : 'data-step';
      const current = document.querySelector(`${rootSelector} [data-action="${control.action}"][${attr}="${CSS.escape(control.index)}"]`);
      current.value = nextValue;
      current.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return controls;
  }, { simulationId: id, nextValue: value });
}

async function setAllParamControls(page, id, value) {
  return page.evaluate(({ paramId, nextValue }) => {
    const rootSelector = `.param-select[data-param-id="${CSS.escape(paramId)}"]`;
    const root = document.querySelector(rootSelector);
    const params = [...new Set([...root.querySelectorAll('[data-action="param-select"]')].map((node) => node.dataset.param))];
    for (const param of params) {
      const candidates = [...document.querySelectorAll(`${rootSelector} [data-action="param-select"][data-param="${CSS.escape(param)}"]`)];
      const current = candidates.find((node) => node.getClientRects().length > 0) || candidates[0];
      current.value = nextValue;
      current.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return params;
  }, { paramId: id, nextValue: value });
}

async function auditStepSimulation(page, item, viewport) {
  const label = `${viewport.name}/${item.id}`;
  const root = stepRoot(page, item);
  await ensureVisible(page, item, root);
  const counts = await root.evaluate((node) => {
    const groupControls = [...node.querySelectorAll('[data-action="simulation-group-select"]')];
    const stepControls = [...node.querySelectorAll('[data-action="simulation-select"]')];
    const optionCounts = [...groupControls, ...stepControls].map((select) => select.options.length - 1);
    return {
      groups: node.querySelectorAll('.step-simulation-group').length,
      groupQuestions: groupControls.length,
      steps: node.querySelectorAll('.step-simulation-step').length,
      stepQuestions: stepControls.length,
      optionCounts,
      initialValues: [...groupControls, ...stepControls].map((select) => select.value),
    };
  });
  const questionCount = counts.groupQuestions + counts.stepQuestions;
  assert.ok(counts.steps > 0 && questionCount > 0, `${label}: missing questions`);
  assert.equal(counts.steps, counts.stepQuestions, `${label}: step/control count mismatch`);
  assert.ok(counts.optionCounts.every((count) => count > 0), `${label}: empty options`);
  assert.ok(counts.initialValues.every((value) => value === ''), `${label}: initial state not empty`);
  const images = await imageAudit(root, `${label}/step-simulation`);

  await root.locator('[data-action="simulation-mode"][data-mode="answer"]').evaluate((button) => button.click());
  assert.equal(await root.locator('.step-simulation-answer').count(), questionCount, `${label}: reference answer count`);
  await root.locator('[data-action="simulation-mode"][data-mode="practice"]').evaluate((button) => button.click());
  assert.equal(await root.locator('.step-simulation-choice').count(), questionCount, `${label}: practice controls not restored`);
  const changedControls = await setAllStepControls(page, item.id, '1');
  assert.equal(changedControls.length, questionCount, `${label}: changed control count`);
  assert.ok(await root.locator('.step-simulation-choice').evaluateAll((nodes) => nodes.every((node) => node.value === '1')), `${label}: not every control selected`);
  const submit = root.locator('[data-action="simulation-submit"]');
  assert.equal(await submit.isEnabled(), true, `${label}: submit disabled after filling controls`);
  await submit.evaluate((button) => button.click());
  const gradedControlCount = await root.locator('.step-simulation-choice.correct, .step-simulation-choice.incorrect').count();
  const correctCount = await root.locator('.step-simulation-choice.correct').count();
  const incorrectCount = await root.locator('.step-simulation-choice.incorrect').count();
  const incorrectDetailCount = await root.locator('.step-simulation-correct-answer').count();
  assert.equal(gradedControlCount, questionCount, `${label}: not every question graded`);
  assert.equal(correctCount + incorrectCount, questionCount, `${label}: graded result count`);
  assert.equal(incorrectDetailCount, incorrectCount, `${label}: incorrect feedback count`);
  assert.equal(await root.locator('.step-simulation-result').count(), 1, `${label}: score feedback missing`);
  const layout = await layoutAudit(page, root, label);
  return {
    ...item,
    ...counts,
    questionCount,
    allControlsSelected: changedControls.length,
    submitted: true,
    gradedControlCount,
    correctCount,
    incorrectCount,
    incorrectDetailCount,
    scoreText: await root.locator('.step-simulation-result').textContent(),
    images,
    layout,
  };
}

function paramRoot(page, item) {
  return page.locator(`.param-select[data-param-id="${item.id}"]`);
}

async function auditParamSelect(page, item, viewport) {
  const label = `${viewport.name}/${item.id}`;
  const root = paramRoot(page, item);
  await ensureVisible(page, item, root);
  const counts = await root.evaluate((node) => {
    const byParam = new Map();
    node.querySelectorAll('.step-simulation-choice').forEach((select) => {
      if (!byParam.has(select.dataset.param)) byParam.set(select.dataset.param, select);
    });
    return {
      params: byParam.size,
      optionCounts: [...byParam.values()].map((select) => select.options.length - 1),
      initialValues: [...byParam.values()].map((select) => select.value),
      desktopRecords: node.querySelectorAll('.param-select-number').length,
      mobileRecords: node.querySelectorAll('.param-select-mobile-record').length,
    };
  });
  const visibleSelects = root.locator('.step-simulation-choice:visible');
  assert.ok(counts.params > 0, `${label}: missing parameters`);
  assert.equal(await visibleSelects.count(), counts.params, `${label}: visible representation parameter count`);
  assert.ok(counts.optionCounts.every((count) => count > 0), `${label}: empty options`);
  assert.ok(counts.initialValues.every((value) => value === ''), `${label}: initial state not empty`);
  const images = await imageAudit(root, `${label}/param-select`);

  await root.locator('[data-action="param-mode"][data-mode="answer"]').evaluate((button) => button.click());
  assert.equal(await root.locator('.param-select-answer:visible').count(), counts.params, `${label}: reference answer count`);
  await root.locator('[data-action="param-mode"][data-mode="practice"]').evaluate((button) => button.click());
  assert.equal(await root.locator('.step-simulation-choice:visible').count(), counts.params, `${label}: practice controls not restored`);
  const changedParams = await setAllParamControls(page, item.id, '1');
  assert.equal(changedParams.length, counts.params, `${label}: changed parameter count`);
  assert.ok(await root.locator('.step-simulation-choice:visible').evaluateAll((nodes) => nodes.every((node) => node.value === '1')), `${label}: not every parameter selected`);
  const simulationButtons = root.locator('[data-action="param-sim-toggle"]');
  const simulationCount = await simulationButtons.count();
  assert.ok(simulationCount > 0, `${label}: result simulation buttons missing`);
  await root.evaluate((node) => {
    const indexes = [...node.querySelectorAll('[data-action="param-sim-toggle"]')].map((button) => button.dataset.sim);
    for (const index of indexes) {
      const current = document.querySelector(`.param-select[data-param-id="${CSS.escape(node.dataset.paramId)}"] [data-action="param-sim-toggle"][data-sim="${CSS.escape(index)}"]`);
      if (!current.classList.contains('open')) current.click();
    }
  });
  assert.equal(await root.locator('.param-select-sim-panel:not([hidden])').count(), simulationCount, `${label}: not every result simulation expanded`);
  const resultFigures = root.locator('.param-select-sim-figure:visible');
  const resultImageCount = await resultFigures.locator('img').count();
  const captions = await resultFigures.locator('figcaption').allTextContents();
  const resultCaptionCount = captions.length;
  assert.equal(resultImageCount, simulationCount, `${label}: result image count`);
  assert.ok(captions.every((caption) => caption.trim()), `${label}: empty result caption`);
  const labels = await root.locator('[data-action="param-sim-toggle"]').allTextContents();
  assert.equal(labels.length, simulationCount, `${label}: result label count`);
  const resultImages = await imageAudit(root, `${label}/result-images`);
  assert.equal(resultImages.count, resultImageCount, `${label}: decoded result image count`);
  const resultLayouts = await resultFigures.evaluateAll((figures) => figures.map((figure) => {
    const image = figure.querySelector('img');
    return {
      figureClientWidth: figure.clientWidth,
      figureScrollWidth: figure.scrollWidth,
      imageClientWidth: image.clientWidth,
      imageScrollWidth: image.scrollWidth,
      figureRight: figure.getBoundingClientRect().right,
      imageRight: image.getBoundingClientRect().right,
      viewport: innerWidth,
    };
  }));
  assert.ok(resultLayouts.every((entry) => entry.figureScrollWidth <= entry.figureClientWidth + 1), `${label}: result figure overflow`);
  assert.ok(resultLayouts.every((entry) => entry.imageScrollWidth <= entry.imageClientWidth + 1), `${label}: result image overflow`);
  assert.ok(resultLayouts.every((entry) => entry.figureRight <= entry.viewport + 1 && entry.imageRight <= entry.viewport + 1), `${label}: result outside viewport`);
  const submit = root.locator('[data-action="param-submit"]');
  assert.equal(await submit.isEnabled(), true, `${label}: submit disabled after filling parameters`);
  await submit.evaluate((button) => button.click());
  const gradedControlCount = await root.locator('.step-simulation-choice.correct:visible, .step-simulation-choice.incorrect:visible').count();
  const correctCount = await root.locator('.step-simulation-choice.correct:visible').count();
  const incorrectCount = await root.locator('.step-simulation-choice.incorrect:visible').count();
  const incorrectDetailCount = await root.locator('.step-simulation-correct-answer:visible').count();
  assert.equal(gradedControlCount, counts.params, `${label}: not every parameter graded`);
  assert.equal(correctCount + incorrectCount, counts.params, `${label}: parameter graded result count`);
  assert.equal(incorrectDetailCount, incorrectCount, `${label}: parameter feedback count`);
  assert.equal(await root.locator('.step-simulation-result').count(), 1, `${label}: parameter score feedback missing`);
  const layout = await layoutAudit(page, root, label);
  return {
    ...item,
    ...counts,
    allControlsSelected: changedParams.length,
    submitted: true,
    gradedControlCount,
    correctCount,
    incorrectCount,
    incorrectDetailCount,
    scoreText: await root.locator('.step-simulation-result').textContent(),
    simulationCount,
    resultImageCount,
    resultCaptionCount,
    sourceImageCount: resultImageCount,
    labels,
    captions,
    resultImages,
    resultLayouts,
    images,
    layout,
  };
}

async function verifyPersistedAndClear(page, inventory, audited, viewport) {
  const result = { sandboxes: [], stepSimulations: [], paramSelects: [] };
  const stepEvidence = new Map(audited.stepSimulations.map((item) => [item.id, item]));
  const paramEvidence = new Map(audited.paramSelects.map((item) => [item.id, item]));
  for (const item of inventory.sandboxes) {
    const root = sandboxRoot(page, item);
    await ensureVisible(page, item, root);
    const frame = sandboxFrame(page, item);
    await frame.locator('[data-drawing-simulation]').waitFor({ state: 'visible', timeout: 30_000 });
    const values = await sandboxValues(frame);
    assert.ok(values.every(Boolean), `${viewport.name}/${item.id}: sandbox state not restored`);
    assert.ok(await waitForCanvas(frame, true) > 0, `${viewport.name}/${item.id}: restored canvas blank`);
    await frame.locator('[data-drawing-clear]').evaluate((button) => button.click());
    assert.ok((await sandboxValues(frame)).every((value) => value === ''), `${viewport.name}/${item.id}: clear did not reset controls`);
    assert.equal(await waitForCanvas(frame, false), 0, `${viewport.name}/${item.id}: clear did not reset canvas`);
    assert.equal(await root.locator('.sandbox-score-chip').count(), 0, `${viewport.name}/${item.id}: clear did not remove score`);
    result.sandboxes.push({ id: item.id, restored: true, cleared: true });
  }
  for (const item of inventory.stepSimulations) {
    const root = stepRoot(page, item);
    await ensureVisible(page, item, root);
    const expected = stepEvidence.get(item.id).questionCount;
    const controls = root.locator('.step-simulation-choice');
    assert.equal(await controls.count(), expected, `${viewport.name}/${item.id}: restored step control count`);
    assert.ok(await controls.evaluateAll((nodes) => nodes.every((node) => node.value === '1')), `${viewport.name}/${item.id}: not all step states restored`);
    assert.equal(await root.locator('.step-simulation-choice.correct, .step-simulation-choice.incorrect').count(), expected, `${viewport.name}/${item.id}: submitted grading not restored`);
    const cleared = await setAllStepControls(page, item.id, '');
    assert.equal(cleared.length, expected, `${viewport.name}/${item.id}: cleared step count`);
    assert.ok(await root.locator('.step-simulation-choice').evaluateAll((nodes) => nodes.every((node) => node.value === '')), `${viewport.name}/${item.id}: step clear failed`);
    result.stepSimulations.push({ id: item.id, restored: expected, cleared: cleared.length });
  }
  for (const item of inventory.paramSelects) {
    const root = paramRoot(page, item);
    await ensureVisible(page, item, root);
    const expected = paramEvidence.get(item.id).params;
    const controls = root.locator('.step-simulation-choice:visible');
    assert.equal(await controls.count(), expected, `${viewport.name}/${item.id}: restored parameter count`);
    assert.ok(await controls.evaluateAll((nodes) => nodes.every((node) => node.value === '1')), `${viewport.name}/${item.id}: not all parameter states restored`);
    assert.equal(await root.locator('.step-simulation-choice.correct:visible, .step-simulation-choice.incorrect:visible').count(), expected, `${viewport.name}/${item.id}: submitted parameter grading not restored`);
    assert.equal(await root.locator('[data-action="param-sim-toggle"]').count(), paramEvidence.get(item.id).simulationCount, `${viewport.name}/${item.id}: simulation buttons not restored`);
    const cleared = await setAllParamControls(page, item.id, '');
    assert.equal(cleared.length, expected, `${viewport.name}/${item.id}: cleared parameter count`);
    assert.ok(await root.locator('.step-simulation-choice').evaluateAll((nodes) => nodes.every((node) => node.value === '')), `${viewport.name}/${item.id}: parameter clear failed`);
    assert.equal(await root.locator('[data-action="param-sim-toggle"]').count(), 0, `${viewport.name}/${item.id}: simulations remained after clear`);
    result.paramSelects.push({ id: item.id, restored: expected, cleared: cleared.length });
  }
  return result;
}

async function verifyClearedAfterReload(page, inventory, viewport) {
  for (const item of inventory.sandboxes) {
    const root = sandboxRoot(page, item);
    await ensureVisible(page, item, root);
    const frame = sandboxFrame(page, item);
    await frame.locator('[data-drawing-simulation]').waitFor({ state: 'visible', timeout: 30_000 });
    assert.ok((await sandboxValues(frame)).every((value) => value === ''), `${viewport.name}/${item.id}: cleared sandbox state returned`);
    assert.equal(await waitForCanvas(frame, false), 0, `${viewport.name}/${item.id}: cleared sandbox canvas returned`);
  }
  for (const item of inventory.stepSimulations) {
    const root = stepRoot(page, item);
    await ensureVisible(page, item, root);
    assert.ok(await root.locator('.step-simulation-choice').evaluateAll((nodes) => nodes.every((node) => node.value === '')), `${viewport.name}/${item.id}: cleared step state returned`);
  }
  for (const item of inventory.paramSelects) {
    const root = paramRoot(page, item);
    await ensureVisible(page, item, root);
    assert.ok(await root.locator('.step-simulation-choice').evaluateAll((nodes) => nodes.every((node) => node.value === '')), `${viewport.name}/${item.id}: cleared parameter state returned`);
  }
  return true;
}

async function quizFeedbackAudit(page, viewport) {
  const item = page.locator('.quiz-item').first();
  const descriptor = await item.evaluate((node) => {
    const card = node.closest('.knowledge-card');
    const panel = node.closest('.tab-set-panel');
    return {
      id: node.dataset.qid,
      kpId: card?.id.replace(/^kp-/, '') || '',
      tabButtonId: panel?.getAttribute('aria-labelledby') || '',
    };
  });
  await ensureVisible(page, descriptor, item);
  const options = item.locator('.quiz-opt');
  assert.ok(await options.count() >= 2, `${viewport.name}: quiz needs at least two options`);
  let wrongValue = '';
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    wrongValue = await option.locator('input').getAttribute('value');
    await option.evaluate((label) => label.click());
    await item.locator('[data-action="submit-quiz"]').evaluate((button) => button.click());
    if (await item.locator('.quiz-fb.wrong').count()) break;
  }
  assert.equal(await item.locator('.quiz-fb.wrong').count(), 1, `${viewport.name}: failed to submit a wrong answer`);
  assert.equal(await item.locator('.quiz-opt.correct').count(), 1, `${viewport.name}: correct option not highlighted`);
  assert.equal(await item.locator('.quiz-opt.wrong').count(), 1, `${viewport.name}: wrong option not highlighted`);
  const styles = await item.evaluate((node) => {
    const correct = node.querySelector('.quiz-opt.correct');
    const wrong = node.querySelector('.quiz-opt.wrong');
    const probe = document.createElement('span');
    probe.style.color = 'var(--correct-tx)';
    document.body.append(probe);
    const expectedCorrectColor = getComputedStyle(probe).color;
    probe.remove();
    const correctStyle = getComputedStyle(correct);
    const wrongStyle = getComputedStyle(wrong);
    return {
      expectedCorrectColor,
      correctColor: correctStyle.color,
      correctBackground: correctStyle.backgroundColor,
      correctBorder: correctStyle.borderColor,
      wrongColor: wrongStyle.color,
      wrongBackground: wrongStyle.backgroundColor,
    };
  });
  assert.equal(styles.correctColor, styles.expectedCorrectColor, `${viewport.name}: correct option is not green`);
  assert.notEqual(styles.correctBackground, styles.wrongBackground, `${viewport.name}: correct/wrong feedback backgrounds match`);
  const screenshot = path.join(QA_DIR, `devices-all-interactions-${viewport.name}-quiz-feedback.png`);
  await item.screenshot({ path: screenshot });
  return { ...descriptor, wrongValue, styles, screenshot: path.relative(ROOT, screenshot).replace(/\\/g, '/') };
}

async function main() {
  const executablePath = localBrowser();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const report = { generatedAt: new Date().toISOString(), url: URL, status: 'passed', viewports: {} };
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
      const syncCalls = [];
      await installRoutes(context, syncCalls);
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];
      const requests = [];
      page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('pageerror', (error) => pageErrors.push(String(error)));
      page.on('requestfailed', (request) => {
        if (!isExpectedMediaAbort(request)) failedRequests.push({ url: request.url(), error: request.failure()?.errorText || 'unknown' });
      });
      page.on('request', (request) => requests.push(request.url()));
      try {
        await loadCourse(page);
        const inventory = await discoverInventory(page);
        const staticInventory = await discoverStaticInventory(page);
        assert.equal(inventory.sandboxes.length, 5, `${viewport.name}: sandbox inventory`);
        assert.equal(inventory.stepSimulations.length, 10, `${viewport.name}: stepSimulation inventory`);
        assert.equal(inventory.paramSelects.length, 2, `${viewport.name}: paramSelect inventory`);
        assert.equal(new Set(inventory.sandboxes.map((item) => item.id)).size, 5, `${viewport.name}: duplicate sandbox id`);
        assert.equal(new Set(inventory.stepSimulations.map((item) => item.id)).size, 10, `${viewport.name}: duplicate stepSimulation id`);
        assert.equal(new Set(inventory.paramSelects.map((item) => item.id)).size, 2, `${viewport.name}: duplicate paramSelect id`);
        const staticCourse = await auditStaticCourse(page, staticInventory, viewport);

        const sandboxes = [];
        for (const item of inventory.sandboxes) sandboxes.push(await auditSandbox(page, item, viewport));
        const stepSimulations = [];
        for (const item of inventory.stepSimulations) stepSimulations.push(await auditStepSimulation(page, item, viewport));
        const paramSelects = [];
        for (const item of inventory.paramSelects) paramSelects.push(await auditParamSelect(page, item, viewport));
        assert.equal(stepSimulations.reduce((sum, item) => sum + item.questionCount, 0), 438, `${viewport.name}: total step controls`);
        assert.equal(stepSimulations.reduce((sum, item) => sum + item.allControlsSelected, 0), 438, `${viewport.name}: selected step controls`);
        assert.equal(paramSelects.reduce((sum, item) => sum + item.params, 0), 242, `${viewport.name}: total parameter controls`);
        assert.equal(paramSelects.reduce((sum, item) => sum + item.allControlsSelected, 0), 242, `${viewport.name}: selected parameter controls`);
        assert.equal(paramSelects.reduce((sum, item) => sum + item.simulationCount, 0), 29, `${viewport.name}: result simulation buttons`);
        assert.equal(paramSelects.reduce((sum, item) => sum + item.resultImageCount, 0), 29, `${viewport.name}: result simulation images`);

        await page.waitForTimeout(1_600);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.locator('.knowledge-card').first().waitFor({ state: 'attached', timeout: 120_000 });
        const persistenceAndClear = await verifyPersistedAndClear(page, inventory, { stepSimulations, paramSelects }, viewport);
        await page.waitForTimeout(1_600);
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.locator('.knowledge-card').first().waitFor({ state: 'attached', timeout: 120_000 });
        const clearedAfterReload = await verifyClearedAfterReload(page, inventory, viewport);
        const quiz = await quizFeedbackAudit(page, viewport);
        await page.waitForTimeout(1_600);

        const externalRequests = [...new Set(requests)].filter((url) => !(
          url.startsWith(`${PAGE_ORIGIN}/`) || url.startsWith('http://localhost:8787/') || url.startsWith('blob:') || url.startsWith('data:')
        ) && !STATIC_FONT_ORIGINS.some((origin) => url.startsWith(origin)));
        assert.deepEqual(consoleErrors, [], `${viewport.name}: console errors`);
        assert.deepEqual(pageErrors, [], `${viewport.name}: page errors`);
        assert.deepEqual(failedRequests, [], `${viewport.name}: failed requests`);
        assert.deepEqual(externalRequests, [], `${viewport.name}: external requests`);
        assert.ok(syncCalls.some((call) => call.endpoint === '/me'), `${viewport.name}: mock login unused`);
        assert.ok(syncCalls.some((call) => call.method === 'PUT' && call.endpoint.endsWith('/simulations')), `${viewport.name}: interaction state not synchronized`);
        const illegalSyncCalls = syncCalls.filter((call) => !(
          (call.method === 'GET' && (call.endpoint === '/me' || call.endpoint === '/sync'))
          || (call.method === 'PUT' && /^\/state\/2026-ic-devices\/(progress|quiz|wrong|studyTime|simulations|theme|exams)$/.test(call.endpoint))
        ));
        assert.deepEqual(illegalSyncCalls, [], `${viewport.name}: illegal sync calls`);
        report.viewports[viewport.name] = {
          viewport,
          inventory,
          staticInventory,
          staticCourse,
          sandboxes,
          stepSimulations,
          paramSelects,
          persistenceAndClear,
          clearedAfterReload,
          quiz,
          consoleErrors,
          pageErrors,
          failedRequests,
          externalRequests,
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
    writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await browser.close();
  }
  console.log(JSON.stringify({ status: report.status, report: path.relative(ROOT, REPORT_FILE).replace(/\\/g, '/'), viewports: Object.keys(report.viewports) }));
}

await main();
