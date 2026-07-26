// autosmt-score-gate.mjs — 奥施特初赛成绩门禁:登录、读取成绩、受控提交与本地断点。
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_BASE = 'http://www.autosmt.site:1000/AUTOCE_V152ZY/php';
const DEFAULT_REPORT_DIR = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const DEFAULT_CANDIDATES = path.join(DEFAULT_REPORT_DIR, 'candidate-answers.json');
const CURRENT_INDEXED_GNQ = path.join(DEFAULT_REPORT_DIR, 'current-site-indexed-gnq-map.json');
const WORK_SECTIONS = {
  1: [0, 0], 2: [0, 1], 3: [0, 2], 4: [0, 3], 5: [0, 4], 6: [0, 5], 7: [0, 6], 8: [0, 7], 9: [0, 8],
  11: [1, 0], 12: [1, 1], 13: [1, 2], 14: [1, 3], 15: [1, 4], 16: [1, 5], 17: [1, 6],
  18: [2, 0], 19: [2, 1],
  20: [3, 0], 21: [3, 1], 22: [3, 2],
  23: [4, 0], 24: [4, 1], 25: [4, 2], 26: [4, 3], 27: [4, 4],
  28: [5, 0], 29: [5, 1],
};

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    flags[key] = next && !next.startsWith('--') ? (i += 1, next) : true;
  }
  return { command, flags };
}

function option(flags, name, fallback = undefined) {
  return flags[name] === undefined ? fallback : flags[name];
}

function numberOption(flags, name, fallback = undefined) {
  const value = option(flags, name, fallback);
  if (value === undefined) return value;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) fail(`--${name} 必须是非负整数`);
  return number;
}

function requireCredentials() {
  const username = process.env.AUTO_SMT_USERNAME;
  const password = process.env.AUTO_SMT_PASSWORD;
  if (!username || !password) {
    fail('缺少 AUTO_SMT_USERNAME 或 AUTO_SMT_PASSWORD；请在当前进程环境变量中提供，勿写入文件。');
  }
  return { username, password };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function captureResources({ resources, client, captured, failed, saveResource, saveCheckpoint }) {
  for (const resource of resources) {
    if (captured[resource.url]) continue;
    try {
      const response = await client.getBytes(resource.url);
      const hash = sha256Bytes(response.bytes);
      const file = `${hash}${resourceExtension(resource.url, response.contentType)}`;
      saveResource(file, response.bytes);
      captured[resource.url] = {
        file: `resources/${file}`,
        bytes: response.bytes.byteLength,
        sha256: hash,
        contentType: response.contentType,
        sourcePages: resource.sourcePages,
      };
      delete failed[resource.url];
    } catch (error) {
      failed[resource.url] = {
        attempts: (Number(failed[resource.url]?.attempts) || 0) + 1,
        lastError: error?.message || String(error),
        lastFailedAt: new Date().toISOString(),
        sourcePages: resource.sourcePages,
      };
    }
    saveCheckpoint();
  }
}

function resourceExtension(url, contentType) {
  const pathname = String(url).replace(/[?#].*$/, '');
  const fromUrl = path.extname(pathname).toLowerCase();
  if (fromUrl && fromUrl.length <= 8) return fromUrl;
  const type = String(contentType || '').toLowerCase();
  if (type.includes('video/mp4')) return '.mp4';
  if (type.includes('video/webm')) return '.webm';
  if (type.includes('image/bmp')) return '.bmp';
  if (type.includes('image/jpeg')) return '.jpg';
  if (type.includes('image/png')) return '.png';
  if (type.includes('text/html')) return '.html';
  if (type.includes('javascript')) return '.js';
  if (type.includes('text/css')) return '.css';
  return '.bin';
}

function discoveredResourceKind(url) {
  if (/PlayVideo\.php\?videoId=/i.test(url)) return 'video';
  return /(?:^|\/)Html\/[^/?]+\.html(?:\?.*)?$/i.test(url) ? 'theory' : 'static';
}

function processStepCount(html) {
  return [...String(html).matchAll(/<a\b(?=[^>]*\bclass=["'][^"']*\bax-btn\b[^"']*["'])[^>]*>/gi)].length;
}

function processStepVideoTargets() {
  const scorePath = path.join(DEFAULT_REPORT_DIR, 'final-score-before-capture.json');
  if (!existsSync(scorePath)) fail('Missing final-score-before-capture.json. Capture a fresh full-score snapshot first.');
  const completed = new Set(Object.entries(JSON.parse(readFileSync(scorePath, 'utf8')).scores || {})
    .flatMap(([scoreType, scores]) => (scores || []).filter((item) => item.score === '100.00').map((item) => `${scoreType}:${item.number}`)));
  const detailDir = path.join(DEFAULT_REPORT_DIR, 'activity-details');
  const targets = readdirSync(detailDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(detailDir, name), 'utf8')))
    .filter((metadata) => completed.has(`${metadata.scoreType}:${metadata.scoreNumber}`))
    .map((metadata) => ({ ...metadata, html: readFileSync(path.join(detailDir, metadata.rawHtmlFile), 'utf8') }))
    .filter(({ html }) => /\bflag\s*:\s*["']btn_gylcfz["']/i.test(html))
    .map(({ html, ...metadata }) => ({ ...metadata, stepCount: processStepCount(html) }))
    .sort((left, right) => left.scoreNumber - right.scoreNumber || left.subIndex - right.subIndex);
  const stepCount = targets.reduce((total, target) => total + target.stepCount, 0);
  const experiment43 = targets.filter((target) => target.scoreType === 'experiment' && target.scoreNumber === 43);
  if (targets.length !== 16 || stepCount !== 452 || experiment43.length !== 1 || experiment43[0].stepCount !== 13) {
    fail(`Unexpected process-video scope: pages=${targets.length}, steps=${stepCount}, experiment43=${experiment43[0]?.stepCount ?? 0}.`);
  }
  return targets;
}

function simulationImagePaths(response) {
  const value = String(response).trim();
  if (!value || /设计错误|请选择|错误|Error/i.test(value)) return [];
  const parts = value.split('|').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return [];
  if (parts.some((part) => !/\.(?:png|jpe?g|gif|bmp|webp)(?:\?|$)/i.test(part) || /["'<>|\s]/.test(part) || /^(?:https?:|\/\/)/i.test(part))) {
    return [];
  }
  return parts;
}

function resolveSimulationUrl(base, ref) {
  try {
    const origin = new URL(base).origin;
    const resolved = new URL(ref, `${base.replace(/\/$/, '')}/Submission.php`);
    if (resolved.origin !== origin) return null;
    return resolved.pathname + resolved.search;
  } catch {
    return null;
  }
}

function engineeringSimulationTargets() {
  const detailDir = path.join(DEFAULT_REPORT_DIR, 'activity-details');
  const targets = readdirSync(detailDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(detailDir, name), 'utf8')))
    .filter((metadata) => metadata.scoreType === 'engineering')
    .map((metadata) => ({ ...metadata, html: readFileSync(path.join(detailDir, metadata.rawHtmlFile), 'utf8') }))
    .filter(({ html }) => /\bflag\s*:\s*["']btn_gycsfz["']/i.test(html))
    .map(({ html, ...metadata }) => ({ ...metadata, stepCount: processStepCount(html) }))
    .sort((left, right) => left.scoreNumber - right.scoreNumber || left.subIndex - right.subIndex);
  const signature = targets.map((target) => `${target.scoreNumber}:${target.stepCount}`).join(',');
  if (signature !== '1:20,2:9,6:2') {
    fail(`Unexpected engineering simulation scope: ${signature || 'empty'} (expected 1:20,2:9,6:2).`);
  }
  return targets;
}

async function fetchSimulationImage(context, ref, sourceStep) {
  const { client, resources, failed, saveResource, saveCheckpoint } = context;
  const url = resolveSimulationUrl(context.base, ref);
  if (!url) {
    failed[`resource:${ref}`] = { reason: 'external-or-invalid-url', ref, sourceStep, lastFailedAt: new Date().toISOString() };
    saveCheckpoint();
    return null;
  }
  if (resources[url]) {
    if (!resources[url].sourceSteps.includes(sourceStep)) resources[url].sourceSteps.push(sourceStep);
    return resources[url];
  }
  try {
    const response = await client.getBytes(url);
    const hash = sha256Bytes(response.bytes);
    const file = `${hash}${resourceExtension(url, response.contentType)}`;
    saveResource(file, response.bytes);
    resources[url] = {
      ref,
      file: `resources/${file}`,
      bytes: response.bytes.byteLength,
      sha256: hash,
      contentType: response.contentType,
      sourceSteps: [sourceStep],
    };
    delete failed[`resource:${ref}`];
    saveCheckpoint();
    return resources[url];
  } catch (error) {
    failed[`resource:${ref}`] = {
      attempts: (Number(failed[`resource:${ref}`]?.attempts) || 0) + 1,
      reason: 'image-download-error',
      ref,
      sourceStep,
      lastError: error?.message || String(error),
      lastFailedAt: new Date().toISOString(),
    };
    saveCheckpoint();
    return null;
  }
}

async function captureEngineeringSimulations(context) {
  const { targets, client, steps, resources, failed, saveCheckpoint, resourceRoot } = context;
  const imageComplete = (record) => Array.isArray(record?.images) && record.images.length > 0
    && record.images.every((ref) => {
      const url = resolveSimulationUrl(context.base, ref);
      const resource = url ? resources[url] : null;
      return resource && (!resourceRoot || existsSync(path.join(resourceRoot, path.basename(resource.file))));
    });
  for (const target of targets) {
    const targetRecord = processStepTarget(target);
    const { detail } = await client.activityDetail(target);
    if (!activityActionFlags(detail).includes('btn_gycsfz') || processStepCount(detail) !== target.stepCount) {
      fail(`Current simulation page does not match saved scope for ${target.scoreType}:${target.scoreNumber}:${target.subIndex}.`);
    }
    for (let step = 0; step < target.stepCount; step += 1) {
      const key = processStepKey(target, step);
      const prior = steps[key];
      if (prior?.status === 'captured' && imageComplete(prior)) continue;
      let images = Array.isArray(prior?.images) && prior.images.length ? prior.images : null;
      if (!images) {
        const response = String(await client.post({ flag: 'btn_gycsfz', index: String(step) })).trim();
        images = simulationImagePaths(response);
        if (!images.length) {
          processStepFailure(failed, key, 'non-image-response', { response: response.slice(0, 200), target: targetRecord, step });
          saveCheckpoint();
          continue;
        }
        steps[key] = { target: targetRecord, step, images, status: 'discovered', discoveredAt: new Date().toISOString() };
        saveCheckpoint();
      }
      const captured = [];
      for (const ref of images) {
        const resource = await fetchSimulationImage(context, ref, key);
        if (resource) captured.push({ ref, file: resource.file, sha256: resource.sha256 });
      }
      if (captured.length === images.length) {
        steps[key] = { ...steps[key], target: targetRecord, step, images, captured, status: 'captured', capturedAt: new Date().toISOString() };
        delete failed[key];
      } else {
        processStepFailure(failed, key, 'incomplete-images', { images, capturedCount: captured.length, target: targetRecord, step });
      }
      saveCheckpoint();
    }
  }
}

function processStepKey(target, step) {
  return `${target.scoreType}:${target.scoreNumber}:${target.subIndex}:${step}`;
}

function processStepTarget(target) {
  return {
    scoreType: target.scoreType,
    scoreNumber: target.scoreNumber,
    chapterIndex: target.chapterIndex,
    sectionIndex: target.sectionIndex,
    activity: target.activity,
    subIndex: target.subIndex,
    rawHtmlFile: target.rawHtmlFile,
    stepCount: target.stepCount,
  };
}

function processStepFailure(failed, key, reason, extra = {}) {
  failed[key] = {
    attempts: (Number(failed[key]?.attempts) || 0) + 1,
    reason,
    lastFailedAt: new Date().toISOString(),
    ...extra,
  };
}

async function captureProcessStepVideos({ targets, client, steps, failed, resourceRoot, saveResource, saveCheckpoint }) {
  for (const target of targets) {
    const targetRecord = processStepTarget(target);
    const { detail } = await client.activityDetail(target);
    if (!activityActionFlags(detail).includes('btn_gylcfz') || processStepCount(detail) !== target.stepCount) {
      fail(`Current process-video page does not match saved scope for ${target.scoreType}:${target.scoreNumber}:${target.subIndex}.`);
    }
    for (let step = 0; step < target.stepCount; step += 1) {
      const key = processStepKey(target, step);
      const prior = steps[key];
      if (prior?.status === 'captured' && (!resourceRoot || existsSync(path.join(resourceRoot, path.basename(prior.file || ''))))) continue;
      try {
        let videoId = /^(?:\d+|\d+-\d+)$/.test(String(prior?.videoId || '')) ? String(prior.videoId) : '';
        if (!videoId) {
          const response = String(await client.post({ flag: 'btn_gylcfz', index: String(step) })).trim();
          if (/^设计错误!?$/.test(response)) {
            processStepFailure(failed, key, 'design-error', { response, target: targetRecord, step });
            saveCheckpoint();
            continue;
          }
          if (!/^(?:\d+|\d+-\d+)$/.test(response)) {
            processStepFailure(failed, key, 'non-numeric-video-id', { response: response.slice(0, 200), target: targetRecord, step });
            saveCheckpoint();
            continue;
          }
          videoId = response;
          steps[key] = { target: targetRecord, step, videoId, status: 'discovered', discoveredAt: new Date().toISOString() };
          saveCheckpoint();
        }
        const response = await client.getBytes(`PlayVideo.php?videoId=${videoId}`);
        const hash = sha256Bytes(response.bytes);
        const file = `${hash}${resourceExtension(`PlayVideo.php?videoId=${videoId}`, response.contentType)}`;
        saveResource(file, response.bytes);
        steps[key] = { ...steps[key], target: targetRecord, step, videoId, status: 'captured', file: `resources/${file}`, bytes: response.bytes.byteLength, sha256: hash, contentType: response.contentType, capturedAt: new Date().toISOString() };
        delete failed[key];
      } catch (error) {
        processStepFailure(failed, key, 'download-error', { lastError: error?.message || String(error), target: targetRecord, step });
      }
      saveCheckpoint();
    }
  }
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function textFromHtml(html) {
  return decodeHtml(String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function splitSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/g);
}

class CookieJar {
  #cookies = new Map();

  update(headers) {
    const values = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : splitSetCookie(headers.get('set-cookie'));
    for (const header of values) {
      const pair = header.split(';', 1)[0];
      const equal = pair.indexOf('=');
      if (equal <= 0) continue;
      const name = pair.slice(0, equal).trim();
      const value = pair.slice(equal + 1).trim();
      if (value) this.#cookies.set(name, value);
      else this.#cookies.delete(name);
    }
  }

  header() {
    return [...this.#cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

class AutoSmtClient {
  constructor({ base, timeoutMs, intervalMs, retries, dryRun }) {
    this.base = base.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.intervalMs = intervalMs;
    this.retries = retries;
    this.dryRun = dryRun;
    this.jar = new CookieJar();
    this.lastRequestAt = 0;
  }

  async #request(url, init, { binary = false } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const pause = this.intervalMs - (Date.now() - this.lastRequestAt);
      if (pause > 0) await sleep(pause);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers = new Headers(init.headers || {});
        headers.set('accept', headers.get('accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
        headers.set('user-agent', headers.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36');
        const cookie = this.jar.header();
        if (cookie) headers.set('cookie', cookie);
        const response = await fetch(url, { ...init, headers, redirect: 'follow', signal: controller.signal });
        this.lastRequestAt = Date.now();
        this.jar.update(response.headers);
        const body = binary
          ? { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get('content-type') || '' }
          : await response.text();
        if (response.ok) return body;
        if (![429, 502, 503, 504].includes(response.status)) {
          const error = new Error(`请求失败: HTTP ${response.status}`);
          error.retryable = false;
          throw error;
        }
        lastError = new Error(`暂时性 HTTP ${response.status}`);
      } catch (error) {
        if (error.retryable === false) throw error;
        lastError = error.name === 'AbortError'
          ? new Error(`请求超时(${this.timeoutMs}ms)`)
          : error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.retries) await sleep(Math.min(1500 * (2 ** attempt), 12000));
    }
    fail(`请求在 ${this.retries + 1} 次尝试后仍失败: ${lastError?.message || '未知网络错误'}`);
  }

  async post(data) {
    return this.#request(`${this.base}/Submission.php`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams(data).toString(),
    });
  }

  async getBytes(relativeUrl) {
    const resolved = new URL(relativeUrl, `${this.base}/Submission.php`);
    if (resolved.origin !== new URL(this.base).origin) fail(`Refusing an external resource URL: ${relativeUrl}`);
    return this.#request(resolved.toString(), { method: 'GET' }, { binary: true });
  }

  async login() {
    const { username, password } = requireCredentials();
    // 旧站会在登录页首访时建立 PHP 会话，直接 POST 会被静默送回登录页。
    await this.#request(`${this.base}/login.php`, { method: 'GET' });
    const body = await this.#request(`${this.base}/login.php`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ username, password, submit: '学生登录' }).toString(),
    });
    if (!body.includes('logOut.php')) {
      const error = textFromHtml((body.match(/<p[^>]*class=["']error["'][^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '');
      fail(`登录未确认成功：响应中缺少注销入口${error ? `（网站提示：${error.slice(0, 120)}）` : ''}。`);
    }
  }

  async scoreHtml() {
    const html = await this.post({ flag: '成绩查询' });
    if (!html.includes('作业成绩详情')) fail('成绩页未确认成功：可能已掉线或收到登录页面。');
    return html;
  }

  async navigate(chapterIndex, sectionIndex) {
    const chapter = await this.post({ flag: 'call_chapter', sectionindex: String(chapterIndex) });
    if (!chapter.includes('ax-ell-title')) fail(`章节索引 ${chapterIndex} 无法打开。`);
    const section = await this.post({ flag: 'call_section', sectionindex: String(sectionIndex) });
    if (!section.includes('ax-name')) fail(`小节索引 ${chapterIndex}.${sectionIndex} 无法打开。`);
    return { chapter, section };
  }

  async submitWork({ chapterIndex, sectionIndex, answers }) {
    await this.workHtml({ chapterIndex, sectionIndex });
    return this.post({ flag: 'submit_work', result: JSON.stringify(answers) });
  }

  async workHtml({ chapterIndex, sectionIndex }) {
    await this.navigate(chapterIndex, sectionIndex);
    const work = await this.post({ flag: '作业' });
    if (!work.includes('submit_work')) fail('当前小节没有可提交的作业。');
    return work;
  }

  async submitAnswer({ chapterIndex, sectionIndex, activity, subIndex, answerIndex, field, bz }) {
    await this.navigate(chapterIndex, sectionIndex);
    const menu = await this.post({ flag: activity });
    if (!menu.includes('call_syzxm')) fail(`活动“${activity}”无法打开。`);
    const detail = await this.post({ flag: 'call_syzxm', index: String(subIndex) });
    if (!detail.includes('submit_answer')) fail(`活动“${activity}”子项 ${subIndex} 没有可提交的选择器。`);
    const payload = { flag: 'submit_answer', xh: String(field), answer: String(answerIndex) };
    if (bz) payload.bz = bz;
    return this.post(payload);
  }

  async activityDetail({ chapterIndex, sectionIndex, activity, subIndex }) {
    await this.navigate(chapterIndex, sectionIndex);
    const menu = await this.post({ flag: activity });
    if (!menu.includes('call_syzxm')) fail(`活动“${activity}”无法打开。`);
    const detail = await this.post({ flag: 'call_syzxm', index: String(subIndex) });
    return { menu, detail };
  }
}

export function parseScoreHtml(html) {
  const groups = { homework: [], experiment: [], engineering: [] };
  const kinds = [
    { heading: '作业成绩详情', key: 'homework', prefix: '作业' },
    { heading: '实验成绩详情', key: 'experiment', prefix: '实验' },
    { heading: '工程成绩详情', key: 'engineering', prefix: '工程' },
  ];
  for (let index = 0; index < kinds.length; index += 1) {
    const kind = kinds[index];
    const start = html.indexOf(kind.heading);
    if (start < 0) continue;
    const next = index + 1 < kinds.length ? html.indexOf(kinds[index + 1].heading, start + kind.heading.length) : html.length;
    const fragment = html.slice(start, next < 0 ? html.length : next);
    for (const row of fragment.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => textFromHtml(cell[1]));
      if (cells.length !== 4 || !new RegExp(`^${kind.prefix}\\d+$`).test(cells[1])) continue;
      groups[kind.key].push({ number: Number(cells[0]), name: cells[1], content: cells[2], score: cells[3] || null });
    }
  }
  return groups;
}

export function parseWorkOptions(html) {
  const questions = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length !== 3 || !/^\d+-\d+$/.test(textFromHtml(cells[0]))) continue;
    const options = [...cells[2].matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*>/gi)]
      .map((optionMatch) => optionMatch[1])
      .filter(Boolean);
    if (!options.length || options.some((item) => !/^[A-Z]$/.test(item))) {
      fail(`题目 ${textFromHtml(cells[0])} 的选项无法解析。`);
    }
    questions.push({ id: textFromHtml(cells[0]), options });
  }
  return questions;
}

function reportFile(name) {
  if (!/^[a-z0-9._-]+$/i.test(name)) fail('断点名称只能包含字母、数字、点、下划线和连字符。');
  mkdirSync(DEFAULT_REPORT_DIR, { recursive: true });
  return path.join(DEFAULT_REPORT_DIR, `${name}.json`);
}

function writeCheckpoint(name, value) {
  writeFileSync(reportFile(name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readCheckpoint(name) {
  return JSON.parse(readFileSync(reportFile(name), 'utf8'));
}

function safeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'activity';
}

function inspectActivityHtml(html) {
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const variables = {};
  for (const name of ['jsonstr_xx', 'jsonstr_stdasr', 'jsonstr_select', 'json_gnqsy']) {
    const match = scripts.join('\n').match(new RegExp(`var\\s+${name}\\s*=\\s*'([\\s\\S]*?)';`));
    if (match) variables[name] = match[1];
  }
  const hasGnq = /\bgnq\b|bz\s*[:=]\s*["']gnq/i.test(scripts.join('\n'));
  const hasSubmit = /submit_answer\s*\(/.test(scripts.join('\n'));
  const selects = [...html.matchAll(/<select\b([^>]*)>/gi)].map((match) => match[1]);
  const resourceRefs = [...html.matchAll(/<[^>]+>/g)]
    .flatMap((tag) => [...tag[0].matchAll(/(?:src|href|poster|data)=["']([^"']+)["']/gi)].map((match) => match[1]))
    .filter((value) => value && !/^(?:#|javascript:|mailto:|tel:)/i.test(value));
  const media = resourceRefs.filter((value) => /\.(?:mp4|m4v|mov|webm|ogg|vtt)(?:\?|$)/i.test(value));
  const dynamicMedia = [...html.matchAll(/["']([^"']*(?:PlayVideo|videoId)[^"']*)["']/gi)].map((match) => match[1]);
  const kind = hasGnq ? 'process-gnq' : hasSubmit && selects.length ? 'select' : media.length ? 'video-only' : 'unknown';
  return {
    kind,
    selectCount: selects.length,
    hasSubmit,
    hasGnq,
    resources: [...new Set(resourceRefs)],
    media: [...new Set(media)],
    dynamicMedia: [...new Set(dynamicMedia)],
    variables,
    submitCalls: scripts.join('\n').match(/submit_answer\([^;]+/g) || [],
  };
}

function sectionMenuLabels(html) {
  return [...html.matchAll(/<[^>]*class=["'][^"']*\bax-name\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)]
    .map((match) => textFromHtml(match[1]))
    .filter(Boolean);
}

function initialSections() {
  return [...new Map(Object.values(WORK_SECTIONS).map(([chapterIndex, sectionIndex]) => [`${chapterIndex}:${sectionIndex}`, { chapterIndex, sectionIndex }])).values()];
}

function saveSectionInspection({ chapterIndex, sectionIndex, section }) {
  const dir = path.join(DEFAULT_REPORT_DIR, 'section-metadata');
  mkdirSync(dir, { recursive: true });
  const base = `${chapterIndex}-${sectionIndex}`;
  const metadata = { capturedAt: new Date().toISOString(), chapterIndex, sectionIndex, menuLabels: sectionMenuLabels(section) };
  writeFileSync(path.join(dir, `${base}.html`), section, 'utf8');
  writeFileSync(path.join(dir, `${base}.json`), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

function inspectActivityMenuHtml(html) {
  const buttons = (html.match(/<a[^>]*btn2[^>]*>[\s\S]*?<\/a>/gi) || [])
    .map((match) => match.replace(/^[^>]*>/, '').replace(/<\/a>$/i, ''))
    .map((label) => textFromHtml(label) || String(label).trim());
  const numericIndexes = [...new Set([...html.matchAll(/call_syzxm\s*\(\s*['"]?(\d+)/gi)].map((match) => Number(match[1])))].sort((left, right) => left - right);
  const subIndexes = numericIndexes.length ? numericIndexes : /\bcall_syzxm\b/i.test(html) ? buttons.map((_, index) => index) : [];
  const inlineTabs = [...html.matchAll(/<a\b(?=[^>]*\bdata-toggle=["']tab["'])[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => textFromHtml(match[1]))
    .filter(Boolean);
  const subitems = subIndexes.map((subIndex) => {
    const call = new RegExp(`call_syzxm\\s*\\(\\s*['"]?${subIndex}`, 'i').exec(html);
    if (!call) return { subIndex, label: buttons[subIndex] || '' };
    const start = html.lastIndexOf('<li', call.index);
    const end = html.indexOf('</li>', call.index);
    return { subIndex, label: buttons[subIndex] || (start >= 0 && end >= 0 ? textFromHtml(html.slice(start, end + 5)) : '') };
  });
  return { subIndexes, subitems, inlineTabs };
}

function activityMenuTargets() {
  const indexPath = path.join(DEFAULT_REPORT_DIR, 'section-activity-index.json');
  if (!existsSync(indexPath)) fail('Missing section-activity-index.json. Run inspect-scope and build-autosmt-section-index first.');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  return (index.sections || []).flatMap((section) => [
    ...(section.experiments || []).map((activity) => ({ ...section, activity, scoreType: 'experiment' })),
    ...(section.engineering || []).map((activity) => ({ ...section, activity, scoreType: 'engineering' })),
  ]).map((target) => {
    const scoreNumber = Number(target.activity.match(/^(?:实验|工程)(\d+)/)?.[1]);
    if (!Number.isInteger(scoreNumber)) fail(`Cannot identify activity number: ${target.activity}`);
    return { chapterIndex: target.chapterIndex, sectionIndex: target.sectionIndex, activity: target.activity, scoreType: target.scoreType, scoreNumber };
  });
}

function saveActivityMenuInspection(target, menu) {
  const dir = path.join(DEFAULT_REPORT_DIR, 'activity-metadata');
  mkdirSync(dir, { recursive: true });
  const base = `${target.chapterIndex}-${target.sectionIndex}-${safeFilePart(target.activity)}`;
  const inspected = inspectActivityMenuHtml(menu);
  const metadata = {
    capturedAt: new Date().toISOString(), ...target,
    kind: inspected.subIndexes.length ? 'subitems' : 'inline',
    capturePlan: inspected.subIndexes.length
      ? inspected.subIndexes.map((subIndex) => ({ subIndex, required: 'capture all content and assets before classifying questions' }))
      : [{ subIndex: null, required: 'capture complete inline page and every tab content, including non-question tabs' }],
    ...inspected,
  };
  writeFileSync(path.join(dir, `${base}.html`), menu, 'utf8');
  writeFileSync(path.join(dir, `${base}.json`), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

function activityMetadataBase(target) {
  return `${target.chapterIndex}-${target.sectionIndex}-${safeFilePart(target.activity)}`;
}

function activityMetadataPath(target) {
  return path.join(DEFAULT_REPORT_DIR, 'activity-metadata', `${activityMetadataBase(target)}.json`);
}

function reindexActivityMetadata() {
  const targets = activityMenuTargets();
  const reindexed = [];
  for (const target of targets) {
    const htmlPath = path.join(DEFAULT_REPORT_DIR, 'activity-metadata', `${activityMetadataBase(target)}.html`);
    if (!existsSync(htmlPath)) fail(`Missing saved activity menu: ${htmlPath}`);
    const metadata = saveActivityMenuInspection(target, readFileSync(htmlPath, 'utf8'));
    reindexed.push({
      scoreType: metadata.scoreType,
      scoreNumber: metadata.scoreNumber,
      activity: metadata.activity,
      kind: metadata.kind,
      subIndexes: metadata.subIndexes,
      subitems: metadata.subitems,
    });
  }
  return reindexed;
}

function detailCaptureBase(target, subIndex) {
  const slot = subIndex === null ? 'inline' : `tab-${subIndex}`;
  return `${target.chapterIndex}-${target.sectionIndex}-${target.scoreType}-${target.scoreNumber}-${slot}`;
}

function saveActivityDetailInspection(target, subIndex, label, detail) {
  const dir = path.join(DEFAULT_REPORT_DIR, 'activity-details');
  mkdirSync(dir, { recursive: true });
  const base = detailCaptureBase(target, subIndex);
  const metadata = {
    capturedAt: new Date().toISOString(),
    chapterIndex: target.chapterIndex,
    sectionIndex: target.sectionIndex,
    activity: target.activity,
    scoreType: target.scoreType,
    scoreNumber: target.scoreNumber,
    subIndex,
    label,
    source: subIndex === null ? 'complete-inline-activity-page' : 'activity-subitem-page',
    rawHtmlFile: `${base}.html`,
    ...inspectActivityHtml(detail),
  };
  writeFileSync(path.join(dir, `${base}.html`), detail, 'utf8');
  writeFileSync(path.join(dir, `${base}.json`), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return metadata;
}

function parseWorkList(value) {
  if (!value) return Object.keys(WORK_SECTIONS).map(Number);
  const works = String(value).split(',').map((item) => Number(item.trim()));
  if (works.some((work) => !Number.isInteger(work) || !WORK_SECTIONS[work])) {
    fail('--works 必须是逗号分隔的初赛作业编号，例如 2,3,20。');
  }
  return [...new Set(works)];
}

function loadCandidates(file) {
  if (!existsSync(file)) fail(`候选答案文件不存在: ${file}`);
  const candidates = JSON.parse(readFileSync(file, 'utf8'));
  for (const work of Object.keys(WORK_SECTIONS)) {
    if (!Array.isArray(candidates[work]) || candidates[work].some((answer) => !/^[A-Z]$/.test(answer))) {
      fail(`候选答案文件缺少或含非法选项: 作业${work}`);
    }
  }
  return candidates;
}

function scoreForHomework(scores, work) {
  const value = scores.homework.find((item) => item.number === work)?.score;
  const score = Number(value);
  if (!Number.isFinite(score)) fail(`成绩页未返回作业${work}的有效分数。`);
  return score;
}

function scoreFor(scores, type, number) {
  const collection = scores[type];
  if (!Array.isArray(collection)) fail(`未知成绩类别: ${type}`);
  const value = collection.find((item) => item.number === number)?.score;
  if (value == null || value === '') return 0;
  const score = Number(value);
  if (!Number.isFinite(score)) fail(`${type}${number} 的成绩不是数值。`);
  return score;
}

function selectOptionsFromMetadata(metadata) {
  if (metadata.kind !== 'select' || (!metadata.variables.jsonstr_xx && !metadata.variables.jsonstr_select)) {
    fail('当前子页不是可自动校正的普通参数选择页。');
  }
  let source;
  try {
    source = metadata.variables.jsonstr_xx
      ? JSON.parse(metadata.variables.jsonstr_xx)
      : Array.from({ length: metadata.selectCount }, () => JSON.parse(metadata.variables.jsonstr_select));
  } catch {
    fail('jsonstr_xx 不是合法 JSON，需人工解析该子页。');
  }
  if (!Array.isArray(source) || source.length !== metadata.selectCount) {
    fail('页面选择器数量与 jsonstr_xx 不一致，禁止自动提交。');
  }
  return source.map((entry, index) => {
    const values = Array.isArray(entry)
      ? entry.map(String).filter(Boolean)
      : String(entry).split(';').filter(Boolean);
    if (!values.length) fail(`第 ${index + 1} 个选择器没有可用选项。`);
    return values;
  });
}

function keyedSelectAnswers(metadata) {
  if (metadata.kind !== 'select' || !metadata.variables.jsonstr_xx || !metadata.variables.jsonstr_stdasr) return null;
  let options;
  let answers;
  try {
    options = JSON.parse(metadata.variables.jsonstr_xx);
    answers = JSON.parse(metadata.variables.jsonstr_stdasr);
  } catch {
    fail('The site-provided select-answer data is not valid JSON.');
  }
  if (!Array.isArray(options) || !Array.isArray(answers) || options.length !== metadata.selectCount || answers.length !== metadata.selectCount) {
    fail('The site-provided select-answer data does not match its controls.');
  }
  if (answers.some((answer) => String(answer).trim() === '')) return null;
  return answers.map((answer, index) => {
    const values = String(options[index]).split(';').filter(Boolean);
    const answerIndex = values.indexOf(String(answer));
    if (answerIndex < 0) fail(`The site answer is absent from select ${index + 1}.`);
    return { field: index + 1, answerIndex: answerIndex + 1, value: values[answerIndex] };
  });
}

function scriptStringVariable(html, name) {
  const match = String(html).match(new RegExp(`var\\s+${name}\\s*=\\s*'([\\s\\S]*?)';`));
  return match ? match[1] : null;
}

function selectedValuesFromHtml(html) {
  for (const name of ['jsonstr_stdasr', 'json_stdasr']) {
    const source = scriptStringVariable(html, name);
    if (!source) continue;
    try {
      const values = JSON.parse(source);
      if (Array.isArray(values)) return values.map((value) => String(value ?? ''));
    } catch {
      fail(`The page-selected value data in ${name} is not valid JSON.`);
    }
  }
  return null;
}

function selectFieldNumbers(html, count) {
  const source = String(html);
  const baseFirst = source.match(/submit_answer\(\s*(\d+)\s*\+\s*i\s*,/);
  const indexFirst = source.match(/submit_answer\(\s*i\s*\+\s*(\d+)\s*,/);
  const base = Number(baseFirst?.[1] || indexFirst?.[1] || 1);
  if (!Number.isInteger(base) || base < 1) fail('The select page has an invalid submission field offset.');
  return Array.from({ length: count }, (_, index) => base + index);
}

function declaredButtonSubmissions(html) {
  const source = String(html);
  const buttonCount = (source.match(/class=["'][^"']*\bax-btn\b[^"']*["']/gi) || []).length;
  const match = source.match(/submit_answer\(\s*(\d+)\s*\+\s*index\s*,\s*["']([^"']+)["']\s*\)/);
  if (!buttonCount || !match) return [];
  const base = Number(match[1]);
  const answer = match[2];
  if (!Number.isInteger(base) || base < 1 || !answer) fail('The button submission declaration is invalid.');
  return Array.from({ length: buttonCount }, (_, index) => ({ field: base + index, answer }));
}

function gnqControls(html) {
  const optionSource = scriptStringVariable(html, 'jsonstr_select');
  const activeSource = scriptStringVariable(html, 'json_gnqsy');
  if (!optionSource || !activeSource) fail('The process-design page is missing select-control data.');
  let optionGroups;
  let activeIndexes;
  try {
    optionGroups = JSON.parse(optionSource);
    activeIndexes = JSON.parse(activeSource);
  } catch {
    fail('The process-design select-control data is not valid JSON.');
  }
  if (!Array.isArray(optionGroups) || optionGroups.length !== 2 || !optionGroups.every(Array.isArray) || !Array.isArray(activeIndexes)) {
    fail('The process-design select-control data has an unsupported shape.');
  }
  const firstCount = (String(html).match(/<select[^>]*s1[^>]*>/gi) || []).length;
  const secondCount = (String(html).match(/<select[^>]*s2[^>]*>/gi) || []).length;
  if (firstCount !== activeIndexes.length) fail('The process-design first select group does not match its active indexes.');
  return [
    ...activeIndexes.map((index, position) => ({ field: Number(index) * 2 + 1, options: optionGroups[0], group: 's1', position })),
    ...Array.from({ length: secondCount }, (_, position) => ({ field: (position + 1) * 2, options: optionGroups[1], group: 's2', position })),
  ];
}

function gnqCandidateValuesByControl(html, values) {
  const source = scriptStringVariable(html, 'json_gnqsy');
  const activeIndexes = JSON.parse(source || '[]');
  const secondCount = (String(html).match(/<select[^>]*s2[^>]*>/gi) || []).length;
  const expected = secondCount + activeIndexes.length;
  if (!Array.isArray(values) || values.length !== expected) {
    fail('The process-design candidate value count does not match the current page.');
  }
  const firstValues = [];
  const secondValues = [];
  let valueIndex = 0;
  for (let row = 0; row < secondCount; row += 1) {
    if (activeIndexes.includes(row)) firstValues.push(values[valueIndex++]);
    secondValues.push(values[valueIndex++]);
  }
  if (valueIndex !== values.length || firstValues.length !== activeIndexes.length) {
    fail('The process-design candidate ordering is invalid.');
  }
  return [...firstValues, ...secondValues];
}

function siteKeyedSelectTargets() {
  const dir = path.join(DEFAULT_REPORT_DIR, 'activity-details');
  if (!existsSync(dir)) fail('Missing activity-details. Run inspect-activity-details first.');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8')))
    .filter((metadata) => keyedSelectAnswers(metadata));
}

function legacyCandidateTargets() {
  const reportDir = DEFAULT_REPORT_DIR;
  const reports = [
    'legacy-candidate-map-manufacturing.json',
    'legacy-candidate-map-devices.json',
    'legacy-candidate-map-packaging.json',
    'current-site-candidate-map-devices.json',
  ].map((name) => path.join(reportDir, name)).filter(existsSync);
  if (!reports.length) fail('No normalized legacy candidate maps are available.');
  const targets = new Map();
  for (const report of reports) {
    const entries = JSON.parse(readFileSync(report, 'utf8')).entries;
    if (!Array.isArray(entries)) fail(`Candidate report has no entries array: ${report}`);
    for (const entry of entries) {
      if (!['select', 'gnq'].includes(entry.kind) || !Array.isArray(entry.values) || !entry.values.length) continue;
      const key = `${entry.scoreType}:${entry.scoreNumber}:${entry.subIndex}:${entry.kind}`;
      const existing = targets.get(key);
      if (existing && JSON.stringify(existing.values) !== JSON.stringify(entry.values)) fail(`Conflicting normalized candidates for ${key}.`);
      targets.set(key, entry);
    }
  }
  return [...targets.values()];
}

function candidateTabsForActivity(candidates, metadataByKey, scoreType, scoreNumber) {
  const activityKey = `${scoreType}:${scoreNumber}`;
  const tabs = candidates
    .filter((candidate) => `${candidate.scoreType}:${candidate.scoreNumber}` === activityKey)
    .sort((left, right) => left.subIndex - right.subIndex);
  if (!tabs.length) fail(`No high-confidence candidate tabs are available for ${activityKey}.`);

  return tabs.map((candidate) => {
    const metadata = metadataByKey.get(`${activityKey}:${candidate.subIndex}`);
    if (!metadata) fail(`No captured activity detail exists for ${activityKey} tab ${candidate.subIndex}.`);
    if (metadata.kind !== candidate.kind && !(metadata.kind === 'process-gnq' && candidate.kind === 'gnq')) {
      fail(`Candidate kind does not match the captured page for ${activityKey} tab ${candidate.subIndex}.`);
    }
    return { candidate, metadata };
  });
}

function currentIndexedGnqTarget(scoreType, scoreNumber, subIndex) {
  if (!existsSync(CURRENT_INDEXED_GNQ)) fail('Missing current-site indexed process candidate map.');
  const entries = JSON.parse(readFileSync(CURRENT_INDEXED_GNQ, 'utf8')).entries;
  const target = (Array.isArray(entries) ? entries : []).find((entry) => entry.scoreType === scoreType
    && entry.scoreNumber === scoreNumber && entry.subIndex === subIndex);
  if (!target || !Array.isArray(target.s1Indexes) || !Array.isArray(target.s2Indexes)) {
    fail(`No indexed process candidate exists for ${scoreType}:${scoreNumber}:${subIndex}.`);
  }
  return target;
}

function answerPayload(kind, field, answerIndex) {
  const payload = { flag: 'submit_answer', xh: String(field), answer: String(answerIndex) };
  if (kind === 'gnq') payload.bz = 'gnq';
  return payload;
}

function activityActionFlags(html) {
  return [...new Set([...String(html).matchAll(/\bflag\s*:\s*["']([A-Za-z0-9_-]+)["']/g)].map((match) => match[1]))];
}

function runtimeResponseText(raw, label) {
  const text = String(raw ?? '');
  if (!text.trim()) fail(`${label} returned an empty response.`);
  if (/<!doctype\s+html|<html\b|<form\b[\s\S]*?(?:login|登录)|(?:login|登录)[\s\S]*?<form\b/i.test(text)) {
    fail(`${label} returned an HTML login page.`);
  }
  return text;
}

function parseRuntimeJsonResponse(raw, label) {
  const text = runtimeResponseText(raw, label);
  try {
    return { raw: text, value: JSON.parse(text), sha256: sha256Text(text) };
  } catch {
    fail(`${label} did not return valid JSON.`);
  }
}

function parseRuntimeNumberArrayResponse(raw, label) {
  const parsed = parseRuntimeJsonResponse(raw, label);
  if (!Array.isArray(parsed.value) || parsed.value.length !== 4) {
    fail(`${label} must return exactly four finite numeric values.`);
  }
  const numericValue = parsed.value.map((value) => {
    if (typeof value === 'string' && !value.trim()) return Number.NaN;
    return typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  });
  if (numericValue.some((value) => !Number.isFinite(value))) {
    fail(`${label} must return exactly four finite numeric values.`);
  }
  return { ...parsed, numericValue };
}

function parseRuntimeFiniteNumberArrayResponse(raw, label) {
  const parsed = parseRuntimeJsonResponse(raw, label);
  if (!Array.isArray(parsed.value) || !parsed.value.length) {
    fail(`${label} must return a non-empty finite numeric array.`);
  }
  const finiteArray = (value) => {
    if (Array.isArray(value)) {
      if (!value.length) fail(`${label} must not contain empty arrays.`);
      return value.map(finiteArray);
    }
    if (typeof value === 'string' && !value.trim()) fail(`${label} contains an empty numeric value.`);
    const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
    if (!Number.isFinite(numeric)) fail(`${label} contains a non-finite numeric value.`);
    return numeric;
  };
  return { ...parsed, numericValue: finiteArray(parsed.value) };
}

function parseRuntimeDrawingResponse(raw, label) {
  const parsed = parseRuntimeJsonResponse(raw, label);
  if (!Array.isArray(parsed.value) || !parsed.value.length) fail(`${label} must return a non-empty rectangle array.`);
  for (const [index, rectangle] of parsed.value.entries()) {
    if (!Array.isArray(rectangle) || rectangle.length !== 5) fail(`${label} rectangle ${index} must have exactly five items.`);
    const [color, x, y, width, height] = rectangle;
    if (typeof color !== 'string' || !color.trim()) fail(`${label} rectangle ${index} has an invalid color.`);
    if (![x, y, width, height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      fail(`${label} rectangle ${index} has non-finite geometry.`);
    }
    if (width <= 0 || height <= 0) fail(`${label} rectangle ${index} must have positive width and height.`);
  }
  return parsed;
}

function runtimeCaptureLocation(target) {
  return {
    scoreType: target.scoreType,
    scoreNumber: target.scoreNumber,
    chapterIndex: target.chapterIndex,
    sectionIndex: target.sectionIndex,
    activity: target.activity,
    subIndex: target.subIndex,
    label: target.label,
    rawHtmlFile: target.rawHtmlFile,
  };
}

function runtimeCaptureLocationKey(target) {
  const location = runtimeCaptureLocation(target);
  return [location.scoreType, location.scoreNumber, location.chapterIndex, location.sectionIndex, location.activity, location.subIndex].join(':');
}

function runtimeActivityContextKey(target) {
  const location = runtimeCaptureLocation(target);
  return [location.chapterIndex, location.sectionIndex, location.activity, location.subIndex].join(':');
}

function runtimeCaptureTargets() {
  const detailDir = path.join(DEFAULT_REPORT_DIR, 'activity-details');
  const requiredScores = [22, 33, 34, 7, 16];
  const requiredTabs = new Map([
    [7, [1]],
    [16, [1, 2]],
    [22, [0]],
    [33, [0]],
    [34, [0]],
  ]);
  if (!existsSync(detailDir)) fail('Runtime response capture requires saved activity-detail metadata.');
  const metadata = readdirSync(detailDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(path.join(detailDir, name), 'utf8')));
  return requiredScores.flatMap((scoreNumber) => requiredTabs.get(scoreNumber).map((subIndex) => {
    const matches = metadata.filter((item) => item.scoreType === 'experiment'
      && item.scoreNumber === scoreNumber && item.subIndex === subIndex);
    if (matches.length !== 1) fail(`Runtime response capture cannot resolve one experiment:${scoreNumber} tab ${subIndex} target.`);
    return matches[0];
  }));
}

function validateRuntimeCaptureTargets(targets) {
  const expectedTargets = new Set(['7:1', '16:1', '16:2', '22:0', '33:0', '34:0']);
  if (!Array.isArray(targets) || targets.length !== expectedTargets.size) {
    fail(`Runtime response capture requires exactly ${expectedTargets.size} targets.`);
  }
  const seenTargets = new Set();
  const seenLocations = new Set();
  for (const target of targets) {
    const targetKey = `${target?.scoreNumber}:${target?.subIndex}`;
    if (target?.scoreType !== 'experiment' || !expectedTargets.has(targetKey)) {
      fail('Runtime response capture target is outside the required experiment/tab set.');
    }
    if (seenTargets.has(targetKey)) fail(`Runtime response capture has a duplicate experiment:${targetKey} target.`);
    seenTargets.add(targetKey);
    const locationKey = runtimeActivityContextKey(target);
    if (seenLocations.has(locationKey)) fail(`Runtime response capture resolved duplicate activity context ${locationKey}.`);
    seenLocations.add(locationKey);
  }
  if (seenTargets.size !== expectedTargets.size) fail('Runtime response capture target set is incomplete.');
}

function runtimeActionForTarget(target) {
  if (target.scoreNumber === 22) return 'CZNDJS';
  if (target.scoreNumber === 33 || target.scoreNumber === 34) return 'LD';
  return 'btn_wdqxfz';
}

function runtimeResponseRecord(target, request, parsed) {
  return {
    activity: runtimeCaptureLocation(target),
    request,
    response: {
      raw: parsed.raw,
      value: parsed.value,
      ...(parsed.numericValue !== undefined ? { numericValue: parsed.numericValue } : {}),
      sha256: parsed.sha256,
    },
  };
}

async function captureRuntimeResponses({ client, targets, onCheckpoint }) {
  validateRuntimeCaptureTargets(targets);
  const orderedTargets = [...targets].sort((left, right) => left.scoreNumber - right.scoreNumber);
  const result = {
    schema: 'autosmt-runtime-response-capture-v1',
    capturedAt: new Date().toISOString(),
    activities: [],
    czndjs: [],
    drawings: [],
    temperatureCurves: [],
  };
  const seenRequestContexts = new Set();
  const drawingResponseHashes = new Map();
  const checkpoint = () => {
    result.updatedAt = new Date().toISOString();
    onCheckpoint(result);
  };
  const captureResponse = async (target, request, label, parser) => {
    const raw = await client.post(request);
    const rawText = String(raw ?? '');
    result.lastAttempt = {
      activity: runtimeCaptureLocation(target),
      request,
      response: { raw: rawText, sha256: sha256Text(rawText) },
    };
    checkpoint();
    const parsed = parser(rawText, label);
    delete result.lastAttempt;
    return parsed;
  };
  const addRecord = (collection, target, request, parsed) => {
    const context = `${runtimeCaptureLocationKey(target)}:${JSON.stringify(request)}`;
    if (seenRequestContexts.has(context)) fail(`Runtime response capture repeated request context ${context}.`);
    seenRequestContexts.add(context);
    if (collection === result.drawings) {
      const prior = drawingResponseHashes.get(parsed.sha256);
      if (prior) fail(`Runtime response capture received the same LD drawing response for experiment:${prior} and experiment:${target.scoreNumber}.`);
      drawingResponseHashes.set(parsed.sha256, target.scoreNumber);
    }
    collection.push(runtimeResponseRecord(target, request, parsed));
    checkpoint();
  };

  for (const target of orderedTargets) {
    const action = runtimeActionForTarget(target);
    const { detail } = await client.activityDetail(target);
    runtimeResponseText(detail, `experiment:${target.scoreNumber} tab ${target.subIndex} activity detail`);
    const actions = activityActionFlags(detail);
    if (!actions.includes(action)) fail(`experiment:${target.scoreNumber} tab ${target.subIndex} does not declare ${action}.`);
    result.activities.push({ location: runtimeCaptureLocation(target), action, detailSha256: sha256Text(String(detail)) });
    checkpoint();
    if (action === 'CZNDJS') {
      for (let data1 = 1; data1 <= 9; data1 += 1) {
        for (let data2 = 1; data2 <= 9; data2 += 1) {
          const request = { flag: 'CZNDJS', data1: String(data1), data2: String(data2) };
          addRecord(result.czndjs, target, request, await captureResponse(
            target,
            request,
            `CZNDJS data1=${data1} data2=${data2}`,
            parseRuntimeNumberArrayResponse,
          ));
        }
      }
    } else if (action === 'LD') {
      const request = { flag: 'LD' };
      addRecord(result.drawings, target, request, await captureResponse(
        target,
        request,
        `LD experiment:${target.scoreNumber}`,
        parseRuntimeDrawingResponse,
      ));
    } else {
      const request = { flag: 'btn_wdqxfz' };
      addRecord(result.temperatureCurves, target, request, await captureResponse(
        target,
        request,
        `temperature curve experiment:${target.scoreNumber} tab ${target.subIndex}`,
        parseRuntimeFiniteNumberArrayResponse,
      ));
    }
  }
  if (result.czndjs.length !== 81 || result.drawings.length !== 2 || result.temperatureCurves.length !== 3) {
    fail('Runtime response capture did not collect the complete required response set.');
  }
  checkpoint();
  return result;
}

function solvedSelectFields(attempts) {
  const solved = new Set();
  let previousScore = 0;
  for (const attempt of attempts || []) {
    if (Number(attempt.score) > previousScore) solved.add(attempt.field);
    previousScore = Math.max(previousScore, Number(attempt.score) || 0);
  }
  return solved;
}

function usage() {
  return `用法:\n  node tools/autosmt-score-gate.mjs score [--checkpoint NAME] [--base URL] [--timeout-ms 90000] [--interval-ms 1500] [--retries 4]\n  node tools/autosmt-score-gate.mjs capture-runtime-responses [--checkpoint NAME]\n  node tools/autosmt-score-gate.mjs capture-engineering-simulations [--checkpoint NAME]\n  node tools/autosmt-score-gate.mjs inspect-activity --chapter-index N --section-index N --activity 名称 --sub-index N\n  node tools/autosmt-score-gate.mjs audit-activity-state --score-type experiment|engineering --score-number N [--checkpoint NAME]\n  node tools/autosmt-score-gate.mjs complete-partial-select-activity --score-type experiment|engineering --score-number N [--checkpoint NAME]\n  node tools/autosmt-score-gate.mjs complete-partial-multitab-select-activity --score-type experiment|engineering --score-number N [--checkpoint NAME]\n  node tools/autosmt-score-gate.mjs invoke-activity-action --chapter-index N --section-index N --activity 名称 --sub-index N --action 名称 --score-type experiment|engineering --score-number N [--checkpoint NAME]\n  node tools/autosmt-score-gate.mjs solve-select-activity --chapter-index N --section-index N --activity 名称 --sub-index N --score-type experiment|engineering --score-number N\n  node tools/autosmt-score-gate.mjs verify-candidate-activity --score-type experiment|engineering --score-number N [--checkpoint NAME]\n  node tools/autosmt-score-gate.mjs repair-candidate-activity --score-type experiment|engineering --score-number N [--checkpoint NAME] [--replay-only]\n  node tools/autosmt-score-gate.mjs solve-partial-score-selects [--checkpoint NAME]\n  node tools/autosmt-score-gate.mjs submit-work --chapter-index N --section-index N --answers A,B,C [--dry-run]\n  node tools/autosmt-score-gate.mjs submit-homeworks [--works 2,3,20] [--candidates PATH] [--checkpoint NAME] [--dry-run]\n  node tools/autosmt-score-gate.mjs solve-work --work N [--candidates PATH] [--checkpoint NAME] [--dry-run]\n  node tools/autosmt-score-gate.mjs submit-answer --chapter-index N --section-index N --activity 名称 --sub-index N --field N --answer-index N [--bz gnq] [--dry-run]\n  node tools/autosmt-score-gate.mjs checkpoint get --name NAME\n  node tools/autosmt-score-gate.mjs checkpoint set --name NAME --data JSON\n  node tools/autosmt-score-gate.mjs selftest\n\n远端命令需在当前进程设置 AUTO_SMT_USERNAME 和 AUTO_SMT_PASSWORD。`;
}

async function selftest() {
  const parsed = parseScoreHtml('<h3>作业成绩详情</h3><table><tr><td>1</td><td>作业1</td><td>内容</td><td>100</td></tr></table><h3>实验成绩详情</h3><table><tr><td>2</td><td>实验2</td><td>实验内容</td><td></td></tr></table><h3>工程成绩详情</h3><table><tr><td>1</td><td>工程1</td><td>工程内容</td><td>80</td></tr></table>');
  if (parsed.homework[0]?.score !== '100' || parsed.experiment[0]?.score !== null || parsed.engineering[0]?.name !== '工程1') {
    fail('parseScoreHtml 自检失败。');
  }
  const questions = parseWorkOptions('<table><tr><td>3-1</td><td>题目</td><td><select><option value="">请选择</option><option value="A">A</option><option value="B">B</option></select></td></tr></table>');
  if (questions.length !== 1 || questions[0].options.join(',') !== 'A,B') fail('parseWorkOptions 自检失败。');
  const solvedFields = solvedSelectFields([{ field: 1, score: 0 }, { field: 1, score: 10 }, { field: 2, score: 10 }, { field: 2, score: 20 }]);
  if ([...solvedFields].join(',') !== '1,2') fail('solve-select-activity 自检失败。');
  const candidateTabs = candidateTabsForActivity(
    [{ scoreType: 'experiment', scoreNumber: 3, subIndex: 1, kind: 'select', values: ['A'] }],
    new Map([['experiment:3:1', { kind: 'select' }]]),
    'experiment',
    3,
  );
  if (candidateTabs.length !== 1 || candidateTabs[0].metadata.kind !== 'select') fail('candidate activity selftest failed.');
  if (answerPayload('gnq', 3, 2).bz !== 'gnq' || answerPayload('select', 3, 2).bz) fail('answer payload selftest failed.');
  if (activityActionFlags('<script>$.ajax({ data:{flag:"btn_djhdfz"} })</script>').join(',') !== 'btn_djhdfz') fail('activity action selftest failed.');
  const sharedOptions = selectOptionsFromMetadata({ kind: 'select', selectCount: 2, variables: { jsonstr_select: '["A","B"]' } });
  if (sharedOptions.length !== 2 || sharedOptions[0].join(',') !== 'A,B' || sharedOptions[1].join(',') !== 'A,B') fail('shared-select selftest failed.');
  if (selectedValuesFromHtml("<script>var jsonstr_stdasr='[\"A\",\"\"]';</script>").join(',') !== 'A,') fail('selected-value selftest failed.');
  if (selectFieldNumbers('submit_answer(13+i,result)', 4).join(',') !== '13,14,15,16') fail('select-field selftest failed.');
  const buttons = declaredButtonSubmissions('<a class="ax-btn">one</a><a class="ax-btn">two</a><script>submit_answer(5+index,"1")</script>');
  if (buttons.map((item) => `${item.field}:${item.answer}`).join(',') !== '5:1,6:1') fail('button-submission selftest failed.');
  const orderedGnq = gnqCandidateValuesByControl("<select class=\"s1\"></select><select class=\"s2\"></select><select class=\"s2\"></select><select class=\"s1\"></select><select class=\"s2\"></select><script>var json_gnqsy='[0,2]';</script>", ['A','a','b','B','c']);
  if (orderedGnq.join(',') !== 'A,B,a,b,c') fail('process candidate ordering selftest failed.');
  if (sectionMenuLabels('<span class="ax-name">Overview</span>').join(',') !== 'Overview') fail('inspect-section selftest failed.');
  if (initialSections().length !== 28) fail('inspect-scope selftest failed.');
  const menu = inspectActivityMenuHtml('<a class="btn2">First</a><a class="btn2">Second</a><script>call_syzxm(index)</script>');
  if (menu.subIndexes.join(',') !== '0,1' || menu.subitems[0].label !== 'First') fail('activity menu selftest failed.');
  const inspected = inspectActivityHtml('<img src="../img/a.png"><video poster="p.jpg" src="v.m4v"></video><script>frame.src="PlayVideo.php?videoId="+id</script>');
  if (inspected.resources.length !== 3 || inspected.media[0] !== 'v.m4v' || inspected.dynamicMedia.length !== 1) fail('activity resource inventory selftest failed.');
  const savedMenu = path.join(DEFAULT_REPORT_DIR, 'activity-metadata', '0-1-1.html');
  if (existsSync(savedMenu)) {
    const savedHtml = readFileSync(savedMenu, 'utf8');
    const saved = inspectActivityMenuHtml(savedHtml);
    if (saved.subIndexes.join(',') !== '0,1,2,3') fail(`saved experiment 1 menu selftest failed: ${JSON.stringify({ saved, btn2: (savedHtml.match(/btn2/g) || []).length, direct: (savedHtml.match(/<a[^>]*btn2[^>]*>([\s\S]*?)<\/a>/gi) || []).length, hasCall: savedHtml.includes('call_syzxm'), firstAnchor: savedHtml.match(/<a[^>]*>/i)?.[0] })}`);
  }
  const savedGnq = path.join(DEFAULT_REPORT_DIR, 'activity-details', '1-1-experiment-23-tab-0.html');
  if (existsSync(savedGnq) && gnqControls(readFileSync(savedGnq, 'utf8')).length !== 26) fail('process-design control selftest failed.');
  const resourceCalls = [];
  const capturedResources = { done: { file: 'resources/done.bin' } };
  const failedResources = {};
  await captureResources({
    resources: [{ url: 'done' }, { url: 'retry' }, { url: 'after' }],
    client: { getBytes: async (url) => {
      resourceCalls.push(url);
      if (url === 'retry') throw new Error('temporary resource failure');
      return { bytes: Uint8Array.of(1), contentType: 'image/png' };
    } },
    captured: capturedResources,
    failed: failedResources,
    saveResource: () => {},
    saveCheckpoint: () => {},
  });
  if (resourceCalls.join(',') !== 'retry,after' || !capturedResources.after || failedResources.retry?.attempts !== 1) fail('resource capture continuation selftest failed.');
  await captureResources({
    resources: [{ url: 'retry' }],
    client: { getBytes: async () => ({ bytes: Uint8Array.of(2), contentType: 'image/png' }) },
    captured: capturedResources,
    failed: failedResources,
    saveResource: () => {},
    saveCheckpoint: () => {},
  });
  if (!capturedResources.retry || failedResources.retry) fail('resource capture retry selftest failed.');
  if (discoveredResourceKind('../Html/lesson.html') !== 'theory' || discoveredResourceKind('/AUTOCE_V152ZY/Html/lesson.html') !== 'theory' || discoveredResourceKind('/AUTOCE_V152ZY/Html/lesson.files/image.png') !== 'static') fail('resource kind selftest failed.');
  if (processStepCount('<a class="ax-btn"></a><script>$(".ax-btn")</script><a class="ax-btn"></a>') !== 2) fail('process-step count selftest failed.');
  const stepVideos = {};
  const stepFailures = {};
  await captureProcessStepVideos({
    targets: [{ scoreType: 'experiment', scoreNumber: 43, subIndex: 0, chapterIndex: 4, sectionIndex: 1, activity: 'test', stepCount: 2 }],
    client: {
      activityDetail: async () => ({ detail: '<a class="ax-btn"></a><a class="ax-btn"></a><script>$.ajax({data:{flag:"btn_gylcfz"}})</script>' }),
      post: async ({ index }) => index === '0' ? '123' : '设计错误!',
      getBytes: async () => ({ bytes: Uint8Array.of(1), contentType: 'video/mp4' }),
    },
    steps: stepVideos,
    failed: stepFailures,
    saveResource: () => {},
    saveCheckpoint: () => {},
  });
  if (stepVideos['experiment:43:0:0']?.videoId !== '123' || stepFailures['experiment:43:0:1']?.reason !== 'design-error') fail('process-step capture selftest failed.');
  if (simulationImagePaths('../img/PPDS_NPN/NPN11-10.jpg').join(',') !== '../img/PPDS_NPN/NPN11-10.jpg') fail('simulation image single selftest failed.');
  if (simulationImagePaths('../img/a/1-1.jpg|../img/a/2-11.jpg').join(',') !== '../img/a/1-1.jpg,../img/a/2-11.jpg') fail('simulation image multi selftest failed.');
  if (simulationImagePaths('请选择工艺参数').length || simulationImagePaths('设计错误!').length || simulationImagePaths('inner.php?id=1').length || simulationImagePaths('http://x.org/a.jpg').length) fail('simulation image reject selftest failed.');
  const simBase = 'http://www.example.com:1000/AUTOCE_V152ZY/php';
  if (resolveSimulationUrl(simBase, '../img/a.png') !== '/AUTOCE_V152ZY/img/a.png' || resolveSimulationUrl(simBase, 'http://evil.example.org/x.jpg') !== null) fail('simulation url-resolve selftest failed.');
  const simSteps = {};
  const simResources = {};
  const simFailed = {};
  await captureEngineeringSimulations({
    targets: [{ scoreType: 'engineering', scoreNumber: 1, subIndex: 0, chapterIndex: 1, sectionIndex: 2, activity: 'test', stepCount: 2 }],
    client: {
      activityDetail: async () => ({ detail: '<a class="ax-btn"></a><a class="ax-btn"></a><script>$.ajax({data:{flag:"btn_gycsfz"}})</script>' }),
      post: async ({ index }) => index === '0' ? '../img/PPDS_NPN/NPN11-10.jpg' : '请选择工艺参数',
      getBytes: async () => ({ bytes: Uint8Array.of(1), contentType: 'image/jpeg' }),
    },
    base: simBase,
    steps: simSteps,
    resources: simResources,
    failed: simFailed,
    saveResource: () => {},
    saveCheckpoint: () => {},
  });
  if (simSteps['engineering:1:0:0']?.status !== 'captured' || simFailed['engineering:1:0:1']?.reason !== 'non-image-response'
    || !simResources['/AUTOCE_V152ZY/img/PPDS_NPN/NPN11-10.jpg']) {
    fail(`engineering simulation capture selftest failed: ${JSON.stringify({ simSteps, simResources: Object.keys(simResources), simFailed })}`);
  }
  const runtimeRawNumberResponse = ' \n["1.000","2.5","-3","4"]\r\n';
  const runtimeNumberResponse = parseRuntimeNumberArrayResponse(runtimeRawNumberResponse, 'selftest');
  if (runtimeNumberResponse.raw !== runtimeRawNumberResponse
    || runtimeNumberResponse.value.join(',') !== '1.000,2.5,-3,4'
    || runtimeNumberResponse.numericValue.join(',') !== '1,2.5,-3,4'
    || runtimeNumberResponse.sha256 !== sha256Text(runtimeRawNumberResponse)) {
    fail('runtime number response selftest failed.');
  }
  const runtimeDrawingResponse = parseRuntimeDrawingResponse('[["#112233",1,2,3,4]]', 'selftest');
  if (runtimeDrawingResponse.value[0]?.join(',') !== '#112233,1,2,3,4') fail('runtime drawing response selftest failed.');
  const runtimeCurveResponse = parseRuntimeFiniteNumberArrayResponse('[["0",25],[5,"1200"],[10,25]]', 'selftest');
  if (runtimeCurveResponse.numericValue.flat().join(',') !== '0,25,5,1200,10,25') fail('runtime curve response selftest failed.');
  for (const invalid of ['', '<!doctype html><html><form>login</form></html>', '[1,null]', '[1,2,3]', '["1","2","3",""]', '["1","2","3","Infinity"]']) {
    let rejected = false;
    try {
      parseRuntimeNumberArrayResponse(invalid, 'selftest');
    } catch {
      rejected = true;
    }
    if (!rejected) fail(`runtime invalid-response selftest failed for ${JSON.stringify(invalid)}.`);
  }
  let invalidDrawingRejected = false;
  try {
    parseRuntimeDrawingResponse('[["#112233",1,2,0,4]]', 'selftest');
  } catch {
    invalidDrawingRejected = true;
  }
  if (!invalidDrawingRejected) fail('runtime invalid-drawing selftest failed.');
  for (const invalid of ['[]', '[[]]', '[[0,25],[5,null]]', '[[0,25],[5,"Infinity"]]']) {
    let rejected = false;
    try {
      parseRuntimeFiniteNumberArrayResponse(invalid, 'selftest');
    } catch {
      rejected = true;
    }
    if (!rejected) fail(`runtime invalid-curve selftest failed for ${invalid}.`);
  }
  const runtimeTargets = [
    { scoreType: 'experiment', scoreNumber: 7, chapterIndex: 0, sectionIndex: 4, activity: 'Experiment 7', subIndex: 1 },
    { scoreType: 'experiment', scoreNumber: 16, chapterIndex: 0, sectionIndex: 7, activity: 'Experiment 16', subIndex: 1 },
    { scoreType: 'experiment', scoreNumber: 16, chapterIndex: 0, sectionIndex: 7, activity: 'Experiment 16', subIndex: 2 },
    { scoreType: 'experiment', scoreNumber: 22, chapterIndex: 1, sectionIndex: 0, activity: 'Experiment 22', subIndex: 0 },
    { scoreType: 'experiment', scoreNumber: 33, chapterIndex: 1, sectionIndex: 6, activity: 'Experiment 33', subIndex: 0 },
    { scoreType: 'experiment', scoreNumber: 34, chapterIndex: 1, sectionIndex: 6, activity: 'Experiment 34', subIndex: 0 },
  ];
  const discoveredRuntimeTargets = runtimeCaptureTargets()
    .sort((left, right) => left.scoreNumber - right.scoreNumber || left.subIndex - right.subIndex);
  const discoveredSignature = discoveredRuntimeTargets.map((target) => `${target.scoreNumber}:${target.subIndex}`).join(',');
  if (discoveredSignature !== '7:1,16:1,16:2,22:0,33:0,34:0') {
    fail(`runtime target discovery selftest failed: ${discoveredSignature || 'empty'}.`);
  }
  for (const target of discoveredRuntimeTargets) {
    const savedDetail = readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', target.rawHtmlFile), 'utf8');
    if (!activityActionFlags(savedDetail).includes(runtimeActionForTarget(target))) {
      fail(`runtime target action selftest failed for experiment:${target.scoreNumber} tab ${target.subIndex}.`);
    }
  }
  const runtimeSnapshots = [];
  let activeRuntimeScore = 0;
  const runtimeCapture = await captureRuntimeResponses({
    targets: runtimeTargets,
    client: {
      activityDetail: async (target) => {
        activeRuntimeScore = target.scoreNumber;
        return { detail: `<script>$.ajax({ data: { flag: "${runtimeActionForTarget(target)}" } });</script>` };
      },
      post: async (request) => {
        if (request.flag === 'CZNDJS') return '[1,2,3,4]';
        if (request.flag === 'btn_wdqxfz') return '[[0,25],[5,1200],[10,25]]';
        return JSON.stringify([[`#${activeRuntimeScore}334455`, 1, 2, 3, 4]]);
      },
    },
    onCheckpoint: (snapshot) => runtimeSnapshots.push(snapshot),
  });
  if (runtimeCapture.czndjs.length !== 81 || runtimeCapture.drawings.length !== 2
    || runtimeCapture.temperatureCurves.length !== 3 || !runtimeSnapshots.length
    || runtimeCapture.czndjs[80]?.request.data1 !== '9' || runtimeCapture.czndjs[80]?.request.data2 !== '9'
    || runtimeCapture.temperatureCurves[0]?.activity.subIndex !== 1
    || runtimeCapture.temperatureCurves[2]?.activity.subIndex !== 2
    || Object.hasOwn(runtimeCapture, 'lastAttempt')) {
    fail('runtime capture selftest failed.');
  }
  const rejectedRuntimeSnapshots = [];
  let rejectedRuntimeCapture = false;
  try {
    await captureRuntimeResponses({
      targets: runtimeTargets,
      client: {
        activityDetail: async (target) => ({ detail: `<script>$.ajax({ data: { flag: "${runtimeActionForTarget(target)}" } });</script>` }),
        post: async () => 'not-json',
      },
      onCheckpoint: (snapshot) => rejectedRuntimeSnapshots.push(structuredClone(snapshot)),
    });
  } catch {
    rejectedRuntimeCapture = true;
  }
  const rejectedAttempt = rejectedRuntimeSnapshots.at(-1)?.lastAttempt;
  if (!rejectedRuntimeCapture || rejectedAttempt?.response.raw !== 'not-json'
    || rejectedAttempt?.response.sha256 !== sha256Text('not-json')) {
    fail('runtime rejected-response checkpoint selftest failed.');
  }
  let duplicateRejected = false;
  let duplicateDrawingScore = 0;
  try {
    await captureRuntimeResponses({
      targets: runtimeTargets,
      client: {
        activityDetail: async (target) => {
          duplicateDrawingScore = target.scoreNumber;
          return { detail: `<script>$.ajax({ data: { flag: "${runtimeActionForTarget(target)}" } });</script>` };
        },
        post: async (request) => request.flag === 'CZNDJS'
          ? '[1,2,3,4]'
          : request.flag === 'btn_wdqxfz'
            ? '[[0,25],[5,1200],[10,25]]'
            : JSON.stringify([[`#${duplicateDrawingScore === 33 || duplicateDrawingScore === 34 ? '334455' : '000000'}`, 1, 2, 3, 4]]),
      },
      onCheckpoint: () => {},
    });
  } catch {
    duplicateRejected = true;
  }
  if (!duplicateRejected) fail('runtime duplicate-LD-response selftest failed.');
  let duplicateContextRejected = false;
  try {
    validateRuntimeCaptureTargets([
      { scoreType: 'experiment', scoreNumber: 7, chapterIndex: 0, sectionIndex: 4, activity: 'Experiment 7', subIndex: 1 },
      { scoreType: 'experiment', scoreNumber: 16, chapterIndex: 0, sectionIndex: 7, activity: 'Experiment 16', subIndex: 1 },
      { scoreType: 'experiment', scoreNumber: 16, chapterIndex: 0, sectionIndex: 7, activity: 'Experiment 16', subIndex: 2 },
      { scoreType: 'experiment', scoreNumber: 22, chapterIndex: 1, sectionIndex: 0, activity: 'Experiment 22', subIndex: 0 },
      { scoreType: 'experiment', scoreNumber: 33, chapterIndex: 1, sectionIndex: 6, activity: 'Shared activity', subIndex: 0 },
      { scoreType: 'experiment', scoreNumber: 34, chapterIndex: 1, sectionIndex: 6, activity: 'Shared activity', subIndex: 0 },
    ]);
  } catch {
    duplicateContextRejected = true;
  }
  if (!duplicateContextRejected) fail('runtime duplicate-context selftest failed.');
  const detailDir = path.join(DEFAULT_REPORT_DIR, 'activity-details');
  if (existsSync(path.join(detailDir, '1-2-engineering-1-tab-0.html')) && engineeringSimulationTargets().length !== 3) fail('engineering simulation target selftest failed.');
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  if (!command || command === '--help' || command === 'help') {
    console.log(usage());
    return;
  }
  if (command === 'selftest') {
    await selftest();
    console.log('selftest: ok');
    return;
  }
  if (command === 'checkpoint') {
    const name = option(flags, 'name');
    if (!name) fail('checkpoint 需要 --name。');
    if (option(flags, 'set') !== undefined || option(flags, 'data') !== undefined) {
      const raw = option(flags, 'data');
      if (typeof raw !== 'string') fail('checkpoint set 需要 --data JSON。');
      writeCheckpoint(name, JSON.parse(raw));
      console.log(JSON.stringify({ checkpoint: name, saved: true }));
      return;
    }
    console.log(JSON.stringify(readCheckpoint(name), null, 2));
    return;
  }
  if (command === 'reindex-activity-metadata') {
    const entries = reindexActivityMetadata();
    console.log(JSON.stringify({
      command,
      activityCount: entries.length,
      subitemActivityCount: entries.filter((item) => item.kind === 'subitems').length,
      detailPageCount: entries.reduce((count, item) => count + (item.subIndexes.length || 1), 0),
      entries: option(flags, 'verbose') ? entries : undefined,
    }, null, 2));
    return;
  }

  const dryRun = option(flags, 'dry-run', false) === true;
  const client = new AutoSmtClient({
    base: option(flags, 'base', DEFAULT_BASE),
    timeoutMs: numberOption(flags, 'timeout-ms', 90000),
    intervalMs: numberOption(flags, 'interval-ms', 1500),
    retries: numberOption(flags, 'retries', 4),
    dryRun,
  });

  if (dryRun) {
    console.log(JSON.stringify({ command, dryRun: true, remoteWrite: command.startsWith('submit-') }, null, 2));
    return;
  }
  await client.login();
  if (command === 'capture-runtime-responses') {
    const checkpoint = option(flags, 'checkpoint', 'runtime-response-capture-v1');
    const result = await captureRuntimeResponses({
      client,
      targets: runtimeCaptureTargets(),
      onCheckpoint: (snapshot) => writeCheckpoint(checkpoint, snapshot),
    });
    console.log(JSON.stringify({
      command,
      checkpoint,
      czndjsResponses: result.czndjs.length,
      drawingResponses: result.drawings.length,
      temperatureCurveResponses: result.temperatureCurves.length,
    }, null, 2));
    return;
  }
  if (command === 'score') {
    const scores = parseScoreHtml(await client.scoreHtml());
    const checkpoint = option(flags, 'checkpoint');
    if (checkpoint) writeCheckpoint(checkpoint, { capturedAt: new Date().toISOString(), scores });
    console.log(JSON.stringify(scores, null, 2));
    return;
  }
  if (command === 'capture-process-step-videos') {
    const checkpoint = option(flags, 'checkpoint', 'process-step-video-capture-v1');
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { steps: {}, failed: {} };
    const steps = prior.steps && typeof prior.steps === 'object' ? prior.steps : {};
    const failed = prior.failed && typeof prior.failed === 'object' ? prior.failed : {};
    const targets = processStepVideoTargets();
    const resourceRoot = path.join(DEFAULT_REPORT_DIR, 'source-capture', 'resources');
    mkdirSync(resourceRoot, { recursive: true });
    const saveCheckpoint = () => writeCheckpoint(checkpoint, {
      updatedAt: new Date().toISOString(),
      targetPages: targets.length,
      targetSteps: targets.reduce((total, target) => total + target.stepCount, 0),
      steps,
      failed,
    });
    await captureProcessStepVideos({
      targets,
      client,
      steps,
      failed,
      resourceRoot,
      saveResource: (file, bytes) => writeFileSync(path.join(resourceRoot, file), bytes),
      saveCheckpoint,
    });
    saveCheckpoint();
    const captured = Object.values(steps).filter((step) => step?.status === 'captured');
    const experiment43 = captured.filter((step) => step.target?.scoreType === 'experiment' && step.target?.scoreNumber === 43);
    const result = {
      command,
      targetPages: targets.length,
      targetSteps: targets.reduce((total, target) => total + target.stepCount, 0),
      captured: captured.length,
      failed: Object.keys(failed).length,
      experiment43Steps: experiment43.length,
      verified: captured.length === 452 && Object.keys(failed).length === 0 && experiment43.length === 13,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.verified) fail(`Process-video capture is incomplete: ${JSON.stringify(result)}.`);
    return;
  }
  if (command === 'capture-engineering-simulations') {
    const checkpoint = option(flags, 'checkpoint', 'engineering-simulation-capture-v1');
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : {};
    const steps = prior.steps && typeof prior.steps === 'object' ? prior.steps : {};
    const resources = prior.resources && typeof prior.resources === 'object' ? prior.resources : {};
    const failed = prior.failed && typeof prior.failed === 'object' ? prior.failed : {};
    const targets = engineeringSimulationTargets();
    const root = path.join(DEFAULT_REPORT_DIR, 'engineering-simulations');
    const resourceRoot = path.join(root, 'resources');
    mkdirSync(resourceRoot, { recursive: true });
    const targetSteps = targets.reduce((total, target) => total + target.stepCount, 0);
    const saveCheckpoint = () => writeCheckpoint(checkpoint, {
      updatedAt: new Date().toISOString(), targetPages: targets.length, targetSteps, steps, resources, failed,
    });
    await captureEngineeringSimulations({
      targets,
      client,
      base: client.base,
      steps,
      resources,
      failed,
      resourceRoot,
      saveResource: (file, bytes) => writeFileSync(path.join(resourceRoot, file), bytes),
      saveCheckpoint,
    });
    saveCheckpoint();
    const captured = Object.values(steps).filter((step) => step?.status === 'captured');
    const result = {
      command,
      targetPages: targets.length,
      targetSteps,
      capturedSteps: captured.length,
      simulationImages: Object.keys(resources).length,
      failed: Object.keys(failed).length,
      verified: captured.length === targetSteps && Object.keys(failed).length === 0,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.verified) fail(`Engineering simulation capture is incomplete: ${JSON.stringify(result)}.`);
    return;
  }
  if (command === 'inspect-scope') {
    const checkpoint = option(flags, 'checkpoint', 'section-scope-progress');
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { completed: [] };
    const completed = new Set(Array.isArray(prior.completed) ? prior.completed : []);
    const captured = [];
    for (const target of initialSections()) {
      const key = `${target.chapterIndex}:${target.sectionIndex}`;
      if (completed.has(key)) continue;
      const { section } = await client.navigate(target.chapterIndex, target.sectionIndex);
      captured.push(saveSectionInspection({ ...target, section }));
      completed.add(key);
      writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), completed: [...completed], remaining: initialSections().map((item) => `${item.chapterIndex}:${item.sectionIndex}`).filter((item) => !completed.has(item)) });
    }
    console.log(JSON.stringify({ command, capturedCount: captured.length, completedCount: completed.size, remainingCount: initialSections().length - completed.size }, null, 2));
    return;
  }
  if (command === 'inspect-activity-menus') {
    const checkpoint = option(flags, 'checkpoint', 'activity-menu-progress');
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { completed: [] };
    const completed = new Set(Array.isArray(prior.completed) ? prior.completed : []);
    const captured = [];
    const targets = activityMenuTargets();
    for (const target of targets) {
      const key = `${target.scoreType}:${target.scoreNumber}`;
      if (completed.has(key)) continue;
      await client.navigate(target.chapterIndex, target.sectionIndex);
      const menu = await client.post({ flag: target.activity });
      captured.push(saveActivityMenuInspection(target, menu));
      completed.add(key);
      writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), completed: [...completed], remaining: targets.filter((item) => !completed.has(`${item.scoreType}:${item.scoreNumber}`)).map((item) => `${item.scoreType}:${item.scoreNumber}`) });
    }
    console.log(JSON.stringify({
      command,
      capturedCount: captured.length,
      completedCount: completed.size,
      remainingCount: targets.length - completed.size,
    }, null, 2));
    return;
  }
  if (command === 'inspect-activity-details') {
    const checkpoint = option(flags, 'checkpoint', 'activity-detail-progress');
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { completed: [] };
    const completed = new Set(Array.isArray(prior.completed) ? prior.completed : []);
    const targets = activityMenuTargets();
    const total = [];
    for (const target of targets) {
      const metadataPath = activityMetadataPath(target);
      if (!existsSync(metadataPath)) fail(`Missing activity metadata: ${metadataPath}. Run reindex-activity-metadata first.`);
      const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
      const plan = Array.isArray(metadata.capturePlan) && metadata.capturePlan.length
        ? metadata.capturePlan
        : [{ subIndex: null, required: 'capture complete inline page' }];
      for (const item of plan) total.push({ target, subIndex: item.subIndex ?? null, label: metadata.subitems?.find((subitem) => subitem.subIndex === item.subIndex)?.label || '' });
    }
    const captured = [];
    for (const item of total) {
      const key = `${item.target.scoreType}:${item.target.scoreNumber}:${item.subIndex === null ? 'inline' : item.subIndex}`;
      if (completed.has(key)) continue;
      await client.navigate(item.target.chapterIndex, item.target.sectionIndex);
      const menu = await client.post({ flag: item.target.activity });
      const detail = item.subIndex === null
        ? menu
        : await client.post({ flag: 'call_syzxm', index: String(item.subIndex) });
      captured.push(saveActivityDetailInspection(item.target, item.subIndex, item.label, detail));
      completed.add(key);
      writeCheckpoint(checkpoint, {
        updatedAt: new Date().toISOString(),
        completed: [...completed],
        remaining: total
          .map((entry) => `${entry.target.scoreType}:${entry.target.scoreNumber}:${entry.subIndex === null ? 'inline' : entry.subIndex}`)
          .filter((entry) => !completed.has(entry)),
      });
    }
    console.log(JSON.stringify({ command, capturedCount: captured.length, completedCount: completed.size, remainingCount: total.length - completed.size }, null, 2));
    return;
  }
  if (command === 'solve-site-keyed-selects') {
    const checkpoint = option(flags, 'checkpoint', 'site-keyed-select-progress');
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { submittedFields: {}, activityScores: {} };
    const submittedFields = prior.submittedFields && typeof prior.submittedFields === 'object' ? prior.submittedFields : {};
    const activityScores = prior.activityScores && typeof prior.activityScores === 'object' ? prior.activityScores : {};
    const groups = new Map();
    for (const target of siteKeyedSelectTargets()) {
      const key = `${target.scoreType}:${target.scoreNumber}`;
      const items = groups.get(key) || [];
      items.push(target);
      groups.set(key, items);
    }
    const orderedGroups = [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'en'));
    for (const [activityKey, targets] of orderedGroups) {
      const [scoreType, scoreNumberText] = activityKey.split(':');
      const scoreNumber = Number(scoreNumberText);
      const currentScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
      if (currentScore >= 100) {
        activityScores[activityKey] = currentScore;
        continue;
      }
      for (const target of targets.sort((left, right) => left.subIndex - right.subIndex)) {
        const detailKey = `${activityKey}:${target.subIndex}`;
        const done = new Set(Array.isArray(submittedFields[detailKey]) ? submittedFields[detailKey] : []);
        await client.navigate(target.chapterIndex, target.sectionIndex);
        await client.post({ flag: target.activity });
        const detail = await client.post({ flag: 'call_syzxm', index: String(target.subIndex) });
        const answers = keyedSelectAnswers(inspectActivityHtml(detail));
        if (!answers) fail(`No website-provided answers for ${detailKey}.`);
        for (const answer of answers) {
          if (done.has(answer.field)) continue;
          await client.post({ flag: 'submit_answer', xh: String(answer.field), answer: String(answer.answerIndex) });
          done.add(answer.field);
          submittedFields[detailKey] = [...done].sort((left, right) => left - right);
          writeCheckpoint(checkpoint, {
            updatedAt: new Date().toISOString(), submittedFields, activityScores,
          });
        }
      }
      const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
      activityScores[activityKey] = finalScore;
      writeCheckpoint(checkpoint, {
        updatedAt: new Date().toISOString(), submittedFields, activityScores,
      });
    }
    console.log(JSON.stringify({
      command,
      activityScores,
      submittedControlCount: Object.values(submittedFields).reduce((count, fields) => count + fields.length, 0),
    }, null, 2));
    return;
  }
  if (command === 'solve-zero-score-selects') {
    const checkpoint = option(flags, 'checkpoint', 'zero-score-select-progress');
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { solvedFields: {}, attempts: [], activityScores: {}, skipped: [] };
    const solvedFields = prior.solvedFields && typeof prior.solvedFields === 'object' ? prior.solvedFields : {};
    const attempts = Array.isArray(prior.attempts) ? prior.attempts : [];
    const activityScores = prior.activityScores && typeof prior.activityScores === 'object' ? prior.activityScores : {};
    const skipped = new Set(Array.isArray(prior.skipped) ? prior.skipped : []);
    const groups = new Map();
    const detailsDir = path.join(DEFAULT_REPORT_DIR, 'activity-details');
    for (const name of readdirSync(detailsDir).filter((item) => item.endsWith('.json'))) {
      const target = JSON.parse(readFileSync(path.join(detailsDir, name), 'utf8'));
      if (target.kind !== 'select') continue;
      const activityKey = `${target.scoreType}:${target.scoreNumber}`;
      const items = groups.get(activityKey) || [];
      items.push(target);
      groups.set(activityKey, items);
    }
    for (const [activityKey, targets] of [...groups.entries()].sort(([, leftTargets], [, rightTargets]) => {
      const left = leftTargets[0];
      const right = rightTargets[0];
      const typeOrder = { experiment: 0, engineering: 1 };
      return typeOrder[left.scoreType] - typeOrder[right.scoreType] || left.scoreNumber - right.scoreNumber;
    })) {
      const [scoreType, scoreNumberText] = activityKey.split(':');
      const scoreNumber = Number(scoreNumberText);
      let aggregateScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
      if (aggregateScore !== 0) {
        skipped.add(activityKey);
        continue;
      }
      for (const target of targets.sort((left, right) => left.subIndex - right.subIndex)) {
        const detailKey = `${activityKey}:${target.subIndex}`;
        const done = new Set(Array.isArray(solvedFields[detailKey]) ? solvedFields[detailKey] : []);
        await client.navigate(target.chapterIndex, target.sectionIndex);
        await client.post({ flag: target.activity });
        const detail = await client.post({ flag: 'call_syzxm', index: String(target.subIndex) });
        const controls = selectOptionsFromMetadata(inspectActivityHtml(detail));
        for (let index = 0; index < controls.length; index += 1) {
          const field = index + 1;
          if (done.has(field)) continue;
          let solved = false;
          for (let answerIndex = 0; answerIndex <= controls[index].length; answerIndex += 1) {
            await client.post({ flag: 'submit_answer', xh: String(field), answer: String(answerIndex) });
            const score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
            attempts.push({ activityKey, subIndex: target.subIndex, field, answerIndex, value: answerIndex ? controls[index][answerIndex - 1] : '', score });
            if (score > aggregateScore) {
              aggregateScore = score;
              done.add(field);
              solvedFields[detailKey] = [...done].sort((left, right) => left - right);
              solved = true;
              break;
            }
            writeCheckpoint(checkpoint, {
              updatedAt: new Date().toISOString(), solvedFields, attempts, activityScores, skipped: [...skipped],
            });
          }
          if (!solved) fail(`No score-increasing choice was found for ${detailKey} field ${field}.`);
          writeCheckpoint(checkpoint, {
            updatedAt: new Date().toISOString(), solvedFields, attempts, activityScores, skipped: [...skipped],
          });
        }
      }
      const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
      activityScores[activityKey] = finalScore;
      writeCheckpoint(checkpoint, {
        updatedAt: new Date().toISOString(), solvedFields, attempts, activityScores, skipped: [...skipped],
      });
      if (finalScore !== 100) fail(`${activityKey} did not reach 100.00 after score-guided selection.`);
    }
    console.log(JSON.stringify({
      command, activityScores, skipped: [...skipped], attemptCount: attempts.length,
    }, null, 2));
    return;
  }
  if (command === 'solve-partial-score-selects') {
    const checkpoint = option(flags, 'checkpoint', 'partial-score-select-progress');
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { confirmedFields: {}, attempts: [], activityScores: {}, skipped: [] };
    const confirmedFields = prior.confirmedFields && typeof prior.confirmedFields === 'object' ? prior.confirmedFields : {};
    const attempts = Array.isArray(prior.attempts) ? prior.attempts : [];
    const activityScores = prior.activityScores && typeof prior.activityScores === 'object' ? prior.activityScores : {};
    const skipped = new Set(Array.isArray(prior.skipped) ? prior.skipped : []);
    const groups = new Map();
    const detailsDir = path.join(DEFAULT_REPORT_DIR, 'activity-details');
    for (const name of readdirSync(detailsDir).filter((item) => item.endsWith('.json'))) {
      const target = JSON.parse(readFileSync(path.join(detailsDir, name), 'utf8'));
      if (target.kind !== 'select') continue;
      const activityKey = `${target.scoreType}:${target.scoreNumber}`;
      const items = groups.get(activityKey) || [];
      items.push(target);
      groups.set(activityKey, items);
    }
    for (const [activityKey, targets] of [...groups.entries()].sort(([, leftTargets], [, rightTargets]) => {
      const left = leftTargets[0];
      const right = rightTargets[0];
      const typeOrder = { experiment: 0, engineering: 1 };
      return typeOrder[left.scoreType] - typeOrder[right.scoreType] || left.scoreNumber - right.scoreNumber;
    })) {
      const [scoreType, scoreNumberText] = activityKey.split(':');
      const scoreNumber = Number(scoreNumberText);
      let aggregateScore = Number(scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber)) || 0;
      if (!(aggregateScore > 0 && aggregateScore < 100)) {
        skipped.add(activityKey);
        continue;
      }
      for (const target of targets.sort((left, right) => left.subIndex - right.subIndex)) {
        const detailKey = `${activityKey}:${target.subIndex}`;
        const confirmed = new Set(Array.isArray(confirmedFields[detailKey]) ? confirmedFields[detailKey] : []);
        await client.navigate(target.chapterIndex, target.sectionIndex);
        await client.post({ flag: target.activity });
        const detail = await client.post({ flag: 'call_syzxm', index: String(target.subIndex) });
        const controls = selectOptionsFromMetadata(inspectActivityHtml(detail));
        for (let index = 0; index < controls.length; index += 1) {
          const field = index + 1;
          if (confirmed.has(field)) continue;
          let bestScore = Number.NEGATIVE_INFINITY;
          let bestAnswer = 0;
          let lastAnswer = 0;
          for (let answerIndex = 0; answerIndex <= controls[index].length; answerIndex += 1) {
            await client.post({ flag: 'submit_answer', xh: String(field), answer: String(answerIndex) });
            const score = Number(scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber)) || 0;
            lastAnswer = answerIndex;
            attempts.push({ activityKey, subIndex: target.subIndex, field, answerIndex, value: answerIndex ? controls[index][answerIndex - 1] : '', score });
            if (score > bestScore) {
              bestScore = score;
              bestAnswer = answerIndex;
            }
            writeCheckpoint(checkpoint, {
              updatedAt: new Date().toISOString(), confirmedFields, attempts, activityScores, skipped: [...skipped],
            });
          }
          if (bestAnswer && bestAnswer !== lastAnswer) {
            await client.post({ flag: 'submit_answer', xh: String(field), answer: String(bestAnswer) });
            bestScore = Number(scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber)) || 0;
          }
          if (bestScore < aggregateScore) fail(`No non-decreasing choice was found for ${detailKey} field ${field}.`);
          aggregateScore = bestScore;
          confirmed.add(field);
          confirmedFields[detailKey] = [...confirmed].sort((left, right) => left - right);
          writeCheckpoint(checkpoint, {
            updatedAt: new Date().toISOString(), confirmedFields, attempts, activityScores, skipped: [...skipped],
          });
        }
      }
      const finalScore = Number(scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber)) || 0;
      activityScores[activityKey] = finalScore;
      writeCheckpoint(checkpoint, {
        updatedAt: new Date().toISOString(), confirmedFields, attempts, activityScores, skipped: [...skipped],
      });
      if (finalScore !== 100) fail(`${activityKey} did not reach 100.00 after partial-score repair.`);
    }
    console.log(JSON.stringify({
      command, activityScores, skipped: [...skipped], attemptCount: attempts.length,
    }, null, 2));
    return;
  }
  if (command === 'solve-zero-score-gnq') {
    const checkpoint = option(flags, 'checkpoint', 'zero-score-gnq-progress');
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { solvedFields: {}, attempts: [], activityScores: {}, skipped: [] };
    const solvedFields = prior.solvedFields && typeof prior.solvedFields === 'object' ? prior.solvedFields : {};
    const attempts = Array.isArray(prior.attempts) ? prior.attempts : [];
    const activityScores = prior.activityScores && typeof prior.activityScores === 'object' ? prior.activityScores : {};
    const skipped = new Set(Array.isArray(prior.skipped) ? prior.skipped : []);
    const targets = readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .filter((target) => target.kind === 'process-gnq')
      .sort((left, right) => left.scoreNumber - right.scoreNumber);
    for (const target of targets) {
      const activityKey = `${target.scoreType}:${target.scoreNumber}`;
      let aggregateScore = scoreFor(parseScoreHtml(await client.scoreHtml()), target.scoreType, target.scoreNumber);
      if (aggregateScore !== 0) {
        skipped.add(activityKey);
        continue;
      }
      const done = new Set(Array.isArray(solvedFields[activityKey]) ? solvedFields[activityKey] : []);
      await client.navigate(target.chapterIndex, target.sectionIndex);
      await client.post({ flag: target.activity });
      const detail = await client.post({ flag: 'call_syzxm', index: String(target.subIndex) });
      const controls = gnqControls(detail);
      if (controls.length !== target.selectCount) fail(`${activityKey} control count differs from its captured page.`);
      for (const control of controls) {
        if (done.has(control.field)) continue;
        let solved = false;
        for (let answerIndex = 1; answerIndex <= control.options.length; answerIndex += 1) {
          await client.post({ flag: 'submit_answer', xh: String(control.field), answer: String(answerIndex), bz: 'gnq' });
          const score = scoreFor(parseScoreHtml(await client.scoreHtml()), target.scoreType, target.scoreNumber);
          attempts.push({ activityKey, field: control.field, group: control.group, answerIndex, value: control.options[answerIndex - 1], score });
          if (score > aggregateScore) {
            aggregateScore = score;
            done.add(control.field);
            solvedFields[activityKey] = [...done].sort((left, right) => left - right);
            solved = true;
            break;
          }
          writeCheckpoint(checkpoint, {
            updatedAt: new Date().toISOString(), solvedFields, attempts, activityScores, skipped: [...skipped],
          });
        }
        if (!solved) fail(`No score-increasing choice was found for ${activityKey} field ${control.field}.`);
        writeCheckpoint(checkpoint, {
          updatedAt: new Date().toISOString(), solvedFields, attempts, activityScores, skipped: [...skipped],
        });
      }
      const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), target.scoreType, target.scoreNumber);
      activityScores[activityKey] = finalScore;
      writeCheckpoint(checkpoint, {
        updatedAt: new Date().toISOString(), solvedFields, attempts, activityScores, skipped: [...skipped],
      });
      if (finalScore !== 100) fail(`${activityKey} did not reach 100.00 after score-guided process selection.`);
    }
    console.log(JSON.stringify({ command, activityScores, skipped: [...skipped], attemptCount: attempts.length }, null, 2));
    return;
  }
  if (command === 'verify-candidate-activity') {
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    if (!['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined) {
      fail('verify-candidate-activity requires --score-type experiment|engineering and --score-number N.');
    }
    const checkpoint = option(flags, 'checkpoint', `verify-candidate-${scoreType}-${scoreNumber}`);
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { submittedTabs: [] };
    const metadataByKey = new Map(readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .map((metadata) => [`${metadata.scoreType}:${metadata.scoreNumber}:${metadata.subIndex}`, metadata]));
    const tabs = candidateTabsForActivity(legacyCandidateTargets(), metadataByKey, scoreType, scoreNumber);
    const activityKey = `${scoreType}:${scoreNumber}`;
    const initialScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    if (initialScore === 100) {
      writeCheckpoint(checkpoint, {
        updatedAt: new Date().toISOString(), activityKey, initialScore, finalScore: initialScore,
        submittedTabs: Array.isArray(prior.submittedTabs) ? prior.submittedTabs : [], verified: true,
      });
      console.log(JSON.stringify({ command, activityKey, initialScore, finalScore: initialScore, verified: true }, null, 2));
      return;
    }

    const submittedTabs = Array.isArray(prior.submittedTabs) ? prior.submittedTabs : [];
    const firstMetadata = tabs[0].metadata;
    await client.navigate(firstMetadata.chapterIndex, firstMetadata.sectionIndex);
    await client.post({ flag: firstMetadata.activity });
    for (const { candidate, metadata } of tabs) {
      const detail = await client.post({ flag: 'call_syzxm', index: String(metadata.subIndex) });
      const controls = candidate.kind === 'gnq' ? gnqControls(detail) : selectOptionsFromMetadata(inspectActivityHtml(detail));
      const fields = candidate.kind === 'gnq' ? null : selectFieldNumbers(detail, controls.length);
      if (controls.length !== candidate.values.length) {
        fail(`Candidate value count differs from current controls for ${activityKey} tab ${candidate.subIndex}.`);
      }
      const candidateValues = candidate.kind === 'gnq'
        ? gnqCandidateValuesByControl(detail, candidate.values)
        : candidate.values;
      const selected = [];
      for (let index = 0; index < controls.length; index += 1) {
        const control = controls[index];
        const options = Array.isArray(control) ? control : control.options;
        const field = Array.isArray(control) ? fields[index] : control.field;
        const answerIndex = options.indexOf(candidateValues[index]);
        if (answerIndex < 0) {
          fail(`Candidate value is absent from current controls for ${activityKey} tab ${candidate.subIndex} field ${field}.`);
        }
        const payload = { flag: 'submit_answer', xh: String(field), answer: String(answerIndex + 1) };
        if (candidate.kind === 'gnq') payload.bz = 'gnq';
        await client.post(payload);
        selected.push({ field, answerIndex: answerIndex + 1, value: candidateValues[index] });
      }
      const tabRecord = { subIndex: candidate.subIndex, kind: candidate.kind, selected };
      const priorIndex = submittedTabs.findIndex((item) => item.subIndex === candidate.subIndex && item.kind === candidate.kind);
      if (priorIndex >= 0) submittedTabs.splice(priorIndex, 1, tabRecord);
      else submittedTabs.push(tabRecord);
      writeCheckpoint(checkpoint, {
        updatedAt: new Date().toISOString(), activityKey, initialScore, submittedTabs,
        finalScore: null, verified: false,
      });
    }
    const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const verified = finalScore === 100;
    writeCheckpoint(checkpoint, {
      updatedAt: new Date().toISOString(), activityKey, initialScore, submittedTabs,
      finalScore, verified,
    });
    if (!verified) fail(`${activityKey} candidate replay ended at ${finalScore}, not 100.00.`);
    console.log(JSON.stringify({ command, activityKey, initialScore, finalScore, verified, submittedTabs }, null, 2));
    return;
  }
  if (command === 'repair-candidate-activity') {
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    if (!['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined) {
      fail('repair-candidate-activity requires --score-type experiment|engineering and --score-number N.');
    }
    const checkpoint = option(flags, 'checkpoint', `repair-candidate-${scoreType}-${scoreNumber}`);
    const metadataByKey = new Map(readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .map((metadata) => [`${metadata.scoreType}:${metadata.scoreNumber}:${metadata.subIndex}`, metadata]));
    const tabs = candidateTabsForActivity(legacyCandidateTargets(), metadataByKey, scoreType, scoreNumber)
      .map(({ candidate, metadata }) => ({ candidate, metadata, values: [...candidate.values], valuesFromCheckpoint: false }));
    const activityKey = `${scoreType}:${scoreNumber}`;
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : {};
    const priorTabs = new Map((Array.isArray(prior.tabs) ? prior.tabs : []).map((tab) => [tab.subIndex, tab]));
    for (const tab of tabs) {
      const saved = priorTabs.get(tab.candidate.subIndex);
      if (saved && Array.isArray(saved.values) && saved.values.length === tab.values.length) {
        tab.values = saved.values;
        tab.valuesFromCheckpoint = true;
      }
    }
    const attempts = Array.isArray(prior.attempts) ? prior.attempts : [];

    const firstMetadata = tabs[0].metadata;
    const openActivity = async () => {
      await client.navigate(firstMetadata.chapterIndex, firstMetadata.sectionIndex);
      await client.post({ flag: firstMetadata.activity });
    };
    const openTab = async (tab) => {
      const detail = await client.post({ flag: 'call_syzxm', index: String(tab.candidate.subIndex) });
      const controls = tab.candidate.kind === 'gnq' ? gnqControls(detail) : selectOptionsFromMetadata(inspectActivityHtml(detail));
      if (controls.length !== tab.values.length) fail(`Current control count changed for ${activityKey} tab ${tab.candidate.subIndex}.`);
      return controls;
    };
    const applyAllTabs = async () => {
      await openActivity();
      for (const tab of tabs) {
        const controls = await openTab(tab);
        for (let index = 0; index < controls.length; index += 1) {
          const control = controls[index];
          const options = Array.isArray(control) ? control : control.options;
          const field = Array.isArray(control) ? index + 1 : control.field;
          const answerIndex = options.indexOf(tab.values[index]);
          if (answerIndex < 0) fail(`Saved value is absent from current controls for ${activityKey} tab ${tab.candidate.subIndex} field ${field}.`);
          await client.post(answerPayload(tab.candidate.kind, field, answerIndex + 1));
        }
      }
    };
    const snapshot = (finalScore = null, verified = false) => ({
      updatedAt: new Date().toISOString(), activityKey,
      tabs: tabs.map((tab) => ({ subIndex: tab.candidate.subIndex, kind: tab.candidate.kind, values: tab.values })),
      attempts, finalScore, verified,
    });

    if (option(flags, 'replay-only', false)) {
      await applyAllTabs();
      const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
      const verified = finalScore === 100;
      writeCheckpoint(checkpoint, snapshot(finalScore, verified));
      if (!verified) fail(`${activityKey} replay ended at ${finalScore}, not 100.00.`);
      console.log(JSON.stringify({ command, activityKey, finalScore, verified, replayOnly: true }, null, 2));
      return;
    }

    await openActivity();
    for (const tab of tabs) {
      if (tab.candidate.kind !== 'gnq' || tab.valuesFromCheckpoint) continue;
      const detail = await client.post({ flag: 'call_syzxm', index: String(tab.candidate.subIndex) });
      tab.values = gnqCandidateValuesByControl(detail, tab.values);
    }
    for (const tab of tabs) {
      const controls = await openTab(tab);
      for (let index = 0; index < controls.length; index += 1) {
        const control = controls[index];
        const options = Array.isArray(control) ? control : control.options;
        const field = Array.isArray(control) ? index + 1 : control.field;
        const previous = tab.values[index];
        let bestValue = previous;
        let bestScore = Number.NEGATIVE_INFINITY;
        // Reapply every tab once per field. Candidate trials then remain in the
        // currently open tab, so a tab switch cannot contaminate the comparison.
        await applyAllTabs();
        const targetControls = await openTab(tab);
        const target = targetControls[index];
        const targetOptions = Array.isArray(target) ? target : target.options;
        for (const value of options) {
          const answerIndex = targetOptions.indexOf(value);
          if (answerIndex < 0) fail(`Current option vanished for ${activityKey} tab ${tab.candidate.subIndex} field ${field}.`);
          await client.post(answerPayload(tab.candidate.kind, field, answerIndex + 1));
          const score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
          attempts.push({ subIndex: tab.candidate.subIndex, field, value, score });
          if (score > bestScore || (score === bestScore && value === previous)) {
            bestValue = value;
            bestScore = score;
          }
          writeCheckpoint(checkpoint, snapshot());
        }
        tab.values[index] = bestValue;
        writeCheckpoint(checkpoint, snapshot());
      }
    }
    await applyAllTabs();
    const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const verified = finalScore === 100;
    writeCheckpoint(checkpoint, snapshot(finalScore, verified));
    if (!verified) fail(`${activityKey} repair ended at ${finalScore}, not 100.00.`);
    console.log(JSON.stringify({ command, activityKey, finalScore, verified, attempts: attempts.length }, null, 2));
    return;
  }
  if (command === 'submit-legacy-candidates') {
    const checkpoint = option(flags, 'checkpoint', 'legacy-candidate-submit-progress');
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { submitted: [], activityScores: {} };
    const submitted = new Set(Array.isArray(prior.submitted) ? prior.submitted : []);
    const activityScores = prior.activityScores && typeof prior.activityScores === 'object' ? prior.activityScores : {};
    const metadataByKey = new Map(readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .map((metadata) => [`${metadata.scoreType}:${metadata.scoreNumber}:${metadata.subIndex}`, metadata]));
    const groups = new Map();
    for (const candidate of legacyCandidateTargets()) {
      const activityKey = `${candidate.scoreType}:${candidate.scoreNumber}`;
      const items = groups.get(activityKey) || [];
      items.push(candidate);
      groups.set(activityKey, items);
    }
    for (const [activityKey, candidates] of [...groups.entries()].sort(([, leftItems], [, rightItems]) => {
      const left = leftItems[0];
      const right = rightItems[0];
      const typeOrder = { experiment: 0, engineering: 1 };
      return typeOrder[left.scoreType] - typeOrder[right.scoreType] || left.scoreNumber - right.scoreNumber;
    })) {
      const [scoreType, scoreNumberText] = activityKey.split(':');
      const scoreNumber = Number(scoreNumberText);
      const currentScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
      if (currentScore >= 100) {
        activityScores[activityKey] = currentScore;
        continue;
      }
      for (const candidate of candidates.sort((left, right) => left.subIndex - right.subIndex)) {
        const submissionKey = `${activityKey}:${candidate.subIndex}:${candidate.kind}`;
        if (submitted.has(submissionKey)) continue;
        const target = metadataByKey.get(`${activityKey}:${candidate.subIndex}`);
        if (!target) fail(`No captured activity detail exists for ${submissionKey}.`);
        await client.navigate(target.chapterIndex, target.sectionIndex);
        await client.post({ flag: target.activity });
        const detail = await client.post({ flag: 'call_syzxm', index: String(target.subIndex) });
        const controls = candidate.kind === 'gnq' ? gnqControls(detail) : selectOptionsFromMetadata(inspectActivityHtml(detail));
        if (controls.length !== candidate.values.length) fail(`Candidate value count differs from current controls for ${submissionKey}.`);
        for (let index = 0; index < controls.length; index += 1) {
          const control = controls[index];
          const options = Array.isArray(control) ? control : control.options;
          const field = Array.isArray(control) ? index + 1 : control.field;
          const answerIndex = options.indexOf(candidate.values[index]);
          if (answerIndex < 0) fail(`Candidate value is absent from current controls for ${submissionKey} field ${field}.`);
          const payload = { flag: 'submit_answer', xh: String(field), answer: String(answerIndex + 1) };
          if (candidate.kind === 'gnq') payload.bz = 'gnq';
          await client.post(payload);
        }
        submitted.add(submissionKey);
        writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), submitted: [...submitted], activityScores });
      }
      activityScores[activityKey] = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
      writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), submitted: [...submitted], activityScores });
    }
    console.log(JSON.stringify({ command, activityScores, submitted: [...submitted] }, null, 2));
    return;
  }
  if (command === 'inspect-section') {
    const chapterIndex = numberOption(flags, 'chapter-index');
    const sectionIndex = numberOption(flags, 'section-index');
    if (chapterIndex === undefined || sectionIndex === undefined) fail('inspect-section requires chapter and section indexes.');
    const { section } = await client.navigate(chapterIndex, sectionIndex);
    const metadata = saveSectionInspection({ chapterIndex, sectionIndex, section });
    console.log(JSON.stringify(metadata, null, 2));
    return;
  }
  if (command === 'inspect-section-components') {
    const chapterIndex = numberOption(flags, 'chapter-index');
    const sectionIndex = numberOption(flags, 'section-index');
    if (chapterIndex === undefined || sectionIndex === undefined) {
      fail('inspect-section-components requires chapter and section indexes.');
    }
    const { section } = await client.navigate(chapterIndex, sectionIndex);
    const labels = sectionMenuLabels(section).slice(0, 4);
    if (labels.length !== 4) fail('The section does not expose the four standard course components.');
    const dir = path.join(DEFAULT_REPORT_DIR, 'live-component-probe', `${chapterIndex}-${sectionIndex}`);
    mkdirSync(dir, { recursive: true });
    const components = [];
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      const html = await client.post({ flag: label });
      const file = `${String(index + 1).padStart(2, '0')}-${safeFilePart(label)}.html`;
      writeFileSync(path.join(dir, file), html, 'utf8');
      components.push({ index, label, file, bytes: Buffer.byteLength(html) });
    }
    const result = { capturedAt: new Date().toISOString(), chapterIndex, sectionIndex, components };
    writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'capture-section-source') {
    const chapterIndex = numberOption(flags, 'chapter-index');
    const sectionIndex = numberOption(flags, 'section-index');
    if (chapterIndex === undefined || sectionIndex === undefined) {
      fail('capture-section-source requires chapter and section indexes.');
    }
    const { section } = await client.navigate(chapterIndex, sectionIndex);
    const labels = sectionMenuLabels(section).slice(0, 4);
    if (labels.length !== 4) fail('The section does not expose the four standard course components.');
    const dir = path.join(DEFAULT_REPORT_DIR, 'source-capture', 'sections', `${chapterIndex}-${sectionIndex}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'menu.html'), section, 'utf8');
    const keys = ['overview', 'theory', 'lecture-video', 'homework'];
    const components = [];
    for (let index = 0; index < labels.length; index += 1) {
      const label = labels[index];
      const html = await client.post({ flag: label });
      const file = `${keys[index]}.html`;
      writeFileSync(path.join(dir, file), html, 'utf8');
      components.push({ key: keys[index], label, file, bytes: Buffer.byteLength(html), sha256: sha256Text(html) });
    }
    const result = { capturedAt: new Date().toISOString(), chapterIndex, sectionIndex, menuFile: 'menu.html', components };
    writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'capture-discovered-resources') {
    const kind = option(flags, 'kind');
    if (!['theory', 'static', 'video'].includes(kind)) {
      fail('capture-discovered-resources requires --kind theory|static|video.');
    }
    const discoveryPath = path.join(DEFAULT_REPORT_DIR, 'source-capture', 'resource-discovery.json');
    if (!existsSync(discoveryPath)) fail('Resource discovery is missing. Run build-source-resource-discovery.mjs first.');
    const discovery = JSON.parse(readFileSync(discoveryPath, 'utf8'));
    const resources = (discovery.resources || []).filter((resource) => {
      const url = resource.url || '';
      if (/^(?:https?:|\/\/)/i.test(url)) return false;
      return discoveredResourceKind(url) === kind;
    });
    const root = path.join(DEFAULT_REPORT_DIR, 'source-capture', 'resources');
    mkdirSync(root, { recursive: true });
    const checkpoint = option(flags, 'checkpoint', `resource-capture-${kind}`);
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { captured: {} };
    const captured = prior.captured && typeof prior.captured === 'object' ? prior.captured : {};
    const failed = prior.failed && typeof prior.failed === 'object' ? prior.failed : {};
    const saveCheckpoint = () => writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), kind, total: resources.length, captured, failed });
    await captureResources({
      resources,
      client,
      captured,
      failed,
      saveResource: (file, bytes) => writeFileSync(path.join(root, file), bytes),
      saveCheckpoint,
    });
    const result = { updatedAt: new Date().toISOString(), kind, total: resources.length, captured, failed };
    writeCheckpoint(checkpoint, result);
    console.log(JSON.stringify({ command, kind, total: resources.length, captured: Object.keys(captured).length, failed: Object.keys(failed).length }, null, 2));
    return;
  }
  if (command === 'inspect-activity') {
    const chapterIndex = numberOption(flags, 'chapter-index');
    const sectionIndex = numberOption(flags, 'section-index');
    const activity = option(flags, 'activity');
    const subIndex = numberOption(flags, 'sub-index');
    if (chapterIndex === undefined || sectionIndex === undefined || !activity || subIndex === undefined) fail('inspect-activity 需要章节、小节、活动名称和子项索引。');
    const { detail } = await client.activityDetail({ chapterIndex, sectionIndex, activity, subIndex });
    const metadata = { capturedAt: new Date().toISOString(), chapterIndex, sectionIndex, activity, subIndex, ...inspectActivityHtml(detail) };
    const dir = path.join(DEFAULT_REPORT_DIR, 'experiment-metadata');
    mkdirSync(dir, { recursive: true });
    const base = `${chapterIndex}-${sectionIndex}-${subIndex}-${safeFilePart(activity)}`;
    writeFileSync(path.join(dir, `${base}.html`), detail, 'utf8');
    writeFileSync(path.join(dir, `${base}.json`), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(metadata, null, 2));
    return;
  }
  if (command === 'audit-activity-state') {
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    if (!['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined) {
      fail('audit-activity-state requires --score-type experiment|engineering and --score-number N.');
    }
    const targets = readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .filter((metadata) => metadata.scoreType === scoreType && metadata.scoreNumber === scoreNumber)
      .sort((left, right) => left.subIndex - right.subIndex);
    if (!targets.length) fail(`No captured activity details exist for ${scoreType}:${scoreNumber}.`);
    const first = targets[0];
    await client.navigate(first.chapterIndex, first.sectionIndex);
    await client.post({ flag: first.activity });
    const tabs = [];
    for (const target of targets) {
      const detail = await client.post({ flag: 'call_syzxm', index: String(target.subIndex) });
      const inspected = inspectActivityHtml(detail);
      const selected = selectedValuesFromHtml(detail);
      tabs.push({
        subIndex: target.subIndex,
        kind: inspected.kind,
        controlCount: inspected.selectCount,
        selectedValues: selected,
        selectedCount: selected ? selected.filter(Boolean).length : null,
        emptyCount: selected ? selected.filter((value) => !value).length : null,
      });
    }
    const score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const checkpoint = option(flags, 'checkpoint', `ui-state-${scoreType}-${scoreNumber}`);
    const result = { updatedAt: new Date().toISOString(), scoreType, scoreNumber, score, tabs };
    writeCheckpoint(checkpoint, result);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'complete-partial-select-activity') {
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    if (!['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined) {
      fail('complete-partial-select-activity requires --score-type experiment|engineering and --score-number N.');
    }
    const targets = readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .filter((metadata) => metadata.scoreType === scoreType && metadata.scoreNumber === scoreNumber && metadata.kind === 'select');
    if (targets.length !== 1) fail(`${scoreType}:${scoreNumber} must have exactly one ordinary select page for safe partial completion.`);
    const target = targets[0];
    const checkpoint = option(flags, 'checkpoint', `complete-partial-${scoreType}-${scoreNumber}`);
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { attempts: [] };
    const attempts = Array.isArray(prior.attempts) ? prior.attempts : [];

    await client.navigate(target.chapterIndex, target.sectionIndex);
    await client.post({ flag: target.activity });
    const detail = await client.post({ flag: 'call_syzxm', index: String(target.subIndex) });
    const controls = selectOptionsFromMetadata(inspectActivityHtml(detail));
    const values = selectedValuesFromHtml(detail);
    if (!values || values.length !== controls.length) fail(`${scoreType}:${scoreNumber} did not return a complete current-page selection state.`);
    let score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const snapshot = (finalScore = null, verified = false) => ({
      updatedAt: new Date().toISOString(), scoreType, scoreNumber, subIndex: target.subIndex,
      values, attempts, finalScore, verified,
    });

    for (let index = 0; index < controls.length; index += 1) {
      if (values[index]) continue;
      const field = index + 1;
      let solved = false;
      for (let answerIndex = 1; answerIndex <= controls[index].length; answerIndex += 1) {
        await client.post(answerPayload('select', field, answerIndex));
        const nextScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
        const value = controls[index][answerIndex - 1];
        attempts.push({ field, answerIndex, value, score: nextScore });
        if (nextScore > score) {
          values[index] = value;
          score = nextScore;
          solved = true;
          writeCheckpoint(checkpoint, snapshot());
          break;
        }
        writeCheckpoint(checkpoint, snapshot());
      }
      if (!solved) fail(`No score-increasing option was found for ${scoreType}:${scoreNumber} field ${field}.`);
    }
    const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const verified = finalScore === 100;
    writeCheckpoint(checkpoint, snapshot(finalScore, verified));
    if (!verified) fail(`${scoreType}:${scoreNumber} reached ${finalScore}, not 100.00.`);
    console.log(JSON.stringify({ command, scoreType, scoreNumber, finalScore, verified, attempts: attempts.length }, null, 2));
    return;
  }
  if (command === 'complete-partial-multitab-select-activity') {
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    if (!['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined) {
      fail('complete-partial-multitab-select-activity requires --score-type experiment|engineering and --score-number N.');
    }
    const targets = readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .filter((metadata) => metadata.scoreType === scoreType && metadata.scoreNumber === scoreNumber && metadata.kind === 'select')
      .sort((left, right) => left.subIndex - right.subIndex);
    if (targets.length < 2) fail(`${scoreType}:${scoreNumber} needs two or more ordinary select tabs.`);
    const checkpoint = option(flags, 'checkpoint', `complete-partial-multitab-${scoreType}-${scoreNumber}`);
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { tabs: {}, attempts: [] };
    const attempts = Array.isArray(prior.attempts) ? prior.attempts : [];
    const states = new Map();

    await client.navigate(targets[0].chapterIndex, targets[0].sectionIndex);
    await client.post({ flag: targets[0].activity });
    for (const target of targets) {
      const detail = await client.post({ flag: 'call_syzxm', index: String(target.subIndex) });
      const controls = selectOptionsFromMetadata(inspectActivityHtml(detail));
      const values = selectedValuesFromHtml(detail);
      const fields = selectFieldNumbers(detail, controls.length);
      if (!values || values.length !== controls.length) fail(`${scoreType}:${scoreNumber} tab ${target.subIndex} has no complete selection state.`);
      states.set(target.subIndex, { target, controls, fields, values });
    }
    let score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const snapshot = (finalScore = null, verified = false) => ({
      updatedAt: new Date().toISOString(), scoreType, scoreNumber,
      tabs: Object.fromEntries([...states.entries()].map(([subIndex, state]) => [subIndex, {
        fields: state.fields, values: state.values,
      }])),
      attempts, finalScore, verified,
    });

    for (const [subIndex, state] of states) {
      await client.post({ flag: 'call_syzxm', index: String(subIndex) });
      for (let index = 0; index < state.controls.length; index += 1) {
        if (state.values[index]) continue;
        const field = state.fields[index];
        let solved = false;
        for (let answerIndex = 1; answerIndex <= state.controls[index].length; answerIndex += 1) {
          await client.post(answerPayload('select', field, answerIndex));
          const nextScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
          const value = state.controls[index][answerIndex - 1];
          attempts.push({ subIndex, field, answerIndex, value, score: nextScore });
          if (nextScore > score) {
            state.values[index] = value;
            score = nextScore;
            solved = true;
            writeCheckpoint(checkpoint, snapshot());
            break;
          }
          writeCheckpoint(checkpoint, snapshot());
        }
        if (!solved) fail(`No score-increasing option was found for ${scoreType}:${scoreNumber} tab ${subIndex} field ${field}.`);
      }
    }
    const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const verified = finalScore === 100;
    writeCheckpoint(checkpoint, snapshot(finalScore, verified));
    if (!verified) fail(`${scoreType}:${scoreNumber} reached ${finalScore}, not 100.00.`);
    console.log(JSON.stringify({ command, scoreType, scoreNumber, finalScore, verified, attempts: attempts.length }, null, 2));
    return;
  }
  if (command === 'invoke-activity-action') {
    let chapterIndex = numberOption(flags, 'chapter-index');
    let sectionIndex = numberOption(flags, 'section-index');
    let activity = option(flags, 'activity');
    const subIndex = numberOption(flags, 'sub-index');
    const action = option(flags, 'action');
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    if (subIndex === undefined || !action || !['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined) {
      fail('invoke-activity-action requires --sub-index, --action, --score-type, and --score-number.');
    }
    if (chapterIndex === undefined || sectionIndex === undefined || !activity) {
      const matches = readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
        .filter((name) => name.endsWith('.json'))
        .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
        .filter((metadata) => metadata.scoreType === scoreType && metadata.scoreNumber === scoreNumber && metadata.subIndex === subIndex);
      if (matches.length !== 1) fail(`Cannot resolve one captured page for ${scoreType}:${scoreNumber} tab ${subIndex}.`);
      ({ chapterIndex, sectionIndex, activity } = matches[0]);
    }
    const { detail } = await client.activityDetail({ chapterIndex, sectionIndex, activity, subIndex });
    const allowedActions = activityActionFlags(detail);
    if (!allowedActions.includes(action)) {
      fail(`Action ${action} is not declared by the current activity page.`);
    }
    const response = await client.post({ flag: action });
    const score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const checkpoint = option(flags, 'checkpoint', `action-${scoreType}-${scoreNumber}-${subIndex}-${safeFilePart(action)}`);
    writeCheckpoint(checkpoint, {
      updatedAt: new Date().toISOString(), chapterIndex, sectionIndex, activity, subIndex,
      action, allowedActions, scoreType, scoreNumber, score, response,
    });
    console.log(JSON.stringify({ command, action, allowedActions, score, response }, null, 2));
    return;
  }
  if (command === 'submit-declared-button-actions') {
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    const subIndex = numberOption(flags, 'sub-index');
    if (!['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined || subIndex === undefined) {
      fail('submit-declared-button-actions requires --score-type, --score-number, and --sub-index.');
    }
    const matches = readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .filter((metadata) => metadata.scoreType === scoreType && metadata.scoreNumber === scoreNumber && metadata.subIndex === subIndex);
    if (matches.length !== 1) fail(`Cannot resolve one captured page for ${scoreType}:${scoreNumber} tab ${subIndex}.`);
    const target = matches[0];
    const { detail } = await client.activityDetail(target);
    const submissions = declaredButtonSubmissions(detail);
    if (!submissions.length) fail(`No declared fixed button submissions exist on ${scoreType}:${scoreNumber} tab ${subIndex}.`);
    const checkpoint = option(flags, 'checkpoint', `declared-button-actions-${scoreType}-${scoreNumber}-${subIndex}`);
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : { attempts: [] };
    const attempts = Array.isArray(prior.attempts) ? prior.attempts : [];
    for (const submission of submissions) {
      await client.post({ flag: 'submit_answer', xh: String(submission.field), answer: submission.answer });
      const score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
      attempts.push({ ...submission, score });
      writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), scoreType, scoreNumber, subIndex, submissions, attempts, score });
    }
    const score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), scoreType, scoreNumber, subIndex, submissions, attempts, score });
    console.log(JSON.stringify({ command, scoreType, scoreNumber, subIndex, submissions, score }, null, 2));
    return;
  }
  if (command === 'probe-process-actions') {
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    const subIndex = numberOption(flags, 'sub-index', 0);
    if (!['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined) {
      fail('probe-process-actions requires --score-type and --score-number.');
    }
    const matches = readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .filter((metadata) => metadata.scoreType === scoreType && metadata.scoreNumber === scoreNumber && metadata.subIndex === subIndex);
    if (matches.length !== 1) fail(`Cannot resolve one captured page for ${scoreType}:${scoreNumber} tab ${subIndex}.`);
    const target = matches[0];
    const { detail } = await client.activityDetail(target);
    if (!/\bflag\s*:\s*["']btn_gylcfz["']/i.test(detail)) {
      fail(`The current page does not declare row-level process validation for ${scoreType}:${scoreNumber}.`);
    }
    const rowCount = (detail.match(/<select[^>]*\bs2\b[^>]*>/gi) || []).length;
    if (!rowCount) fail(`The current process page has no operation rows for ${scoreType}:${scoreNumber}.`);
    const rows = [];
    for (let index = 0; index < rowCount; index += 1) {
      rows.push({ index, response: await client.post({ flag: 'btn_gylcfz', index: String(index) }) });
    }
    const checkpoint = option(flags, 'checkpoint', `process-action-probe-${scoreType}-${scoreNumber}-${subIndex}`);
    const result = { updatedAt: new Date().toISOString(), scoreType, scoreNumber, subIndex, rowCount, rows };
    writeCheckpoint(checkpoint, result);
    console.log(JSON.stringify({ command, scoreType, scoreNumber, subIndex, rowCount, invalidRows: rows.filter((row) => /设计错误/.test(row.response)).map((row) => row.index) }, null, 2));
    return;
  }
  if (command === 'repair-candidate-gnq-row') {
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    const row = numberOption(flags, 'row');
    if (!['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined || row === undefined || row < 1) {
      fail('repair-candidate-gnq-row requires --score-type, --score-number, and a positive --row.');
    }
    const metadataByKey = new Map(readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .map((metadata) => [`${metadata.scoreType}:${metadata.scoreNumber}:${metadata.subIndex}`, metadata]));
    const [{ candidate, metadata }] = candidateTabsForActivity(legacyCandidateTargets(), metadataByKey, scoreType, scoreNumber);
    if (candidate.kind !== 'gnq') fail(`${scoreType}:${scoreNumber} is not a process-design candidate.`);
    const { detail } = await client.activityDetail(metadata);
    const controls = gnqControls(detail);
    const values = gnqCandidateValuesByControl(detail, candidate.values);
    const target = controls.find((control) => control.group === 's2' && control.position === row - 1);
    if (!target) fail(`Process row ${row} does not exist for ${scoreType}:${scoreNumber}.`);
    for (let index = 0; index < controls.length; index += 1) {
      const control = controls[index];
      const answerIndex = control.options.indexOf(values[index]);
      if (answerIndex < 0) fail(`Candidate value is absent from ${scoreType}:${scoreNumber} field ${control.field}.`);
      await client.post({ flag: 'submit_answer', xh: String(control.field), answer: String(answerIndex + 1), ...(control.group === 's1' ? { bz: 'gnq' } : {}) });
    }
    const attempts = [];
    let best = { answerIndex: 0, value: '', score: Number.NEGATIVE_INFINITY };
    for (let index = 0; index < target.options.length; index += 1) {
      await client.post({ flag: 'submit_answer', xh: String(target.field), answer: String(index + 1) });
      const score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
      const attempt = { field: target.field, row, answerIndex: index + 1, value: target.options[index], score };
      attempts.push(attempt);
      if (score > best.score) best = attempt;
    }
    await client.post({ flag: 'submit_answer', xh: String(target.field), answer: String(best.answerIndex) });
    const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const checkpoint = option(flags, 'checkpoint', `repair-gnq-row-${scoreType}-${scoreNumber}-${row}`);
    writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), scoreType, scoreNumber, row, target, attempts, best, finalScore, verified: finalScore === 100 });
    if (finalScore !== 100) fail(`${scoreType}:${scoreNumber} row ${row} repair ended at ${finalScore}, not 100.00.`);
    console.log(JSON.stringify({ command, scoreType, scoreNumber, row, best, finalScore, verified: true }, null, 2));
    return;
  }
  if (command === 'verify-indexed-gnq-activity') {
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    const subIndex = numberOption(flags, 'sub-index', 0);
    if (!['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined) {
      fail('verify-indexed-gnq-activity requires --score-type and --score-number.');
    }
    const matches = readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .filter((metadata) => metadata.scoreType === scoreType && metadata.scoreNumber === scoreNumber && metadata.subIndex === subIndex);
    if (matches.length !== 1) fail(`Cannot resolve one captured page for ${scoreType}:${scoreNumber} tab ${subIndex}.`);
    const target = matches[0];
    const indexed = currentIndexedGnqTarget(scoreType, scoreNumber, subIndex);
    const { detail } = await client.activityDetail(target);
    const controls = gnqControls(detail);
    const first = controls.filter((control) => control.group === 's1');
    const second = controls.filter((control) => control.group === 's2');
    if (first.length !== indexed.s1Indexes.length || second.length !== indexed.s2Indexes.length) {
      fail(`Indexed control counts do not match the current page for ${scoreType}:${scoreNumber}.`);
    }
    const selected = [];
    for (let index = 0; index < first.length; index += 1) {
      const control = first[index];
      const answerIndex = indexed.s1Indexes[index];
      if (!Number.isInteger(answerIndex) || answerIndex < 1 || answerIndex > control.options.length) fail(`Invalid functional-area index for ${scoreType}:${scoreNumber} field ${control.field}.`);
      await client.post({ flag: 'submit_answer', xh: String(control.field), answer: String(answerIndex), bz: 'gnq' });
      selected.push({ field: control.field, group: control.group, answerIndex, value: control.options[answerIndex - 1] });
    }
    for (let index = 0; index < second.length; index += 1) {
      const control = second[index];
      const answerIndex = indexed.s2Indexes[index];
      if (!Number.isInteger(answerIndex) || answerIndex < 1 || answerIndex > control.options.length) fail(`Invalid process index for ${scoreType}:${scoreNumber} field ${control.field}.`);
      await client.post({ flag: 'submit_answer', xh: String(control.field), answer: String(answerIndex) });
      selected.push({ field: control.field, group: control.group, answerIndex, value: control.options[answerIndex - 1] });
    }
    const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const checkpoint = option(flags, 'checkpoint', `verify-indexed-gnq-${scoreType}-${scoreNumber}`);
    writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), scoreType, scoreNumber, subIndex, indexed, selected, finalScore, verified: finalScore === 100 });
    if (finalScore !== 100) fail(`${scoreType}:${scoreNumber} indexed candidate replay ended at ${finalScore}, not 100.00.`);
    console.log(JSON.stringify({ command, scoreType, scoreNumber, subIndex, finalScore, verified: true }, null, 2));
    return;
  }
  if (command === 'repair-indexed-gnq-row') {
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    const row = numberOption(flags, 'row');
    const subIndex = numberOption(flags, 'sub-index', 0);
    if (!['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined || row === undefined || row < 1) {
      fail('repair-indexed-gnq-row requires --score-type, --score-number, and a positive --row.');
    }
    const matches = readdirSync(path.join(DEFAULT_REPORT_DIR, 'activity-details'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(readFileSync(path.join(DEFAULT_REPORT_DIR, 'activity-details', name), 'utf8')))
      .filter((metadata) => metadata.scoreType === scoreType && metadata.scoreNumber === scoreNumber && metadata.subIndex === subIndex);
    if (matches.length !== 1) fail(`Cannot resolve one captured page for ${scoreType}:${scoreNumber} tab ${subIndex}.`);
    const target = matches[0];
    const indexed = currentIndexedGnqTarget(scoreType, scoreNumber, subIndex);
    const { detail } = await client.activityDetail(target);
    const controls = gnqControls(detail);
    const first = controls.filter((control) => control.group === 's1');
    const second = controls.filter((control) => control.group === 's2');
    const targetControl = second[row - 1];
    if (!targetControl || first.length !== indexed.s1Indexes.length || second.length !== indexed.s2Indexes.length) {
      fail(`Indexed controls do not match the current page for ${scoreType}:${scoreNumber}.`);
    }
    for (let index = 0; index < first.length; index += 1) {
      const answerIndex = indexed.s1Indexes[index];
      await client.post({ flag: 'submit_answer', xh: String(first[index].field), answer: String(answerIndex), bz: 'gnq' });
    }
    for (let index = 0; index < second.length; index += 1) {
      const answerIndex = indexed.s2Indexes[index];
      await client.post({ flag: 'submit_answer', xh: String(second[index].field), answer: String(answerIndex) });
    }
    const attempts = [];
    let best = { answerIndex: 0, value: '', score: Number.NEGATIVE_INFINITY };
    for (let index = 0; index < targetControl.options.length; index += 1) {
      await client.post({ flag: 'submit_answer', xh: String(targetControl.field), answer: String(index + 1) });
      const score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
      const attempt = { field: targetControl.field, row, answerIndex: index + 1, value: targetControl.options[index], score };
      attempts.push(attempt);
      if (score > best.score) best = attempt;
    }
    indexed.s2Indexes[row - 1] = best.answerIndex;
    const map = JSON.parse(readFileSync(CURRENT_INDEXED_GNQ, 'utf8'));
    const mapEntry = map.entries.find((entry) => entry.scoreType === scoreType && entry.scoreNumber === scoreNumber && entry.subIndex === subIndex);
    mapEntry.s2Indexes[row - 1] = best.answerIndex;
    writeFileSync(CURRENT_INDEXED_GNQ, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
    await client.post({ flag: 'submit_answer', xh: String(targetControl.field), answer: String(best.answerIndex) });
    const finalScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    const checkpoint = option(flags, 'checkpoint', `repair-indexed-gnq-${scoreType}-${scoreNumber}-${row}`);
    writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), scoreType, scoreNumber, row, targetControl, attempts, best, finalScore, verified: finalScore === 100 });
    console.log(JSON.stringify({ command, scoreType, scoreNumber, row, best, finalScore, verified: finalScore === 100 }, null, 2));
    return;
  }
  if (command === 'solve-select-activity') {
    const chapterIndex = numberOption(flags, 'chapter-index');
    const sectionIndex = numberOption(flags, 'section-index');
    const activity = option(flags, 'activity');
    const subIndex = numberOption(flags, 'sub-index');
    const scoreType = option(flags, 'score-type');
    const scoreNumber = numberOption(flags, 'score-number');
    if (chapterIndex === undefined || sectionIndex === undefined || !activity || subIndex === undefined || !['experiment', 'engineering'].includes(scoreType) || scoreNumber === undefined) {
      fail('solve-select-activity 缺少活动定位或成绩目标参数。');
    }
    const { detail } = await client.activityDetail({ chapterIndex, sectionIndex, activity, subIndex });
    const metadata = inspectActivityHtml(detail);
    const controls = selectOptionsFromMetadata(metadata);
    const checkpoint = option(flags, 'checkpoint', `solve-${scoreType}-${scoreNumber}-${subIndex}`);
    const prior = existsSync(reportFile(checkpoint)) ? readCheckpoint(checkpoint) : {};
    const attempts = Array.isArray(prior.attempts) ? prior.attempts : [];
    const solvedFields = solvedSelectFields(attempts);
    let aggregateScore = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
    for (let index = 0; index < controls.length; index += 1) {
      const field = index + 1;
      if (solvedFields.has(field)) continue;
      let solved = false;
      for (let answerIndex = 1; answerIndex <= controls[index].length; answerIndex += 1) {
        await client.submitAnswer({ chapterIndex, sectionIndex, activity, subIndex, field, answerIndex });
        const score = scoreFor(parseScoreHtml(await client.scoreHtml()), scoreType, scoreNumber);
        attempts.push({ field, answerIndex, value: controls[index][answerIndex - 1], score });
        if (score > aggregateScore) {
          aggregateScore = score;
          solvedFields.add(field);
          solved = true;
          break;
        }
      }
      writeCheckpoint(checkpoint, {
        updatedAt: new Date().toISOString(), activity, subIndex, scoreType, scoreNumber,
        currentAggregateScore: aggregateScore, solvedFields: [...solvedFields].sort((a, b) => a - b), attempts,
      });
      if (!solved) fail(`字段 ${field} 未找到能提高成绩的选项，需人工检查页面协议。`);
    }
    const subpageComplete = solvedFields.size === controls.length;
    console.log(JSON.stringify({ command, activity, subIndex, currentAggregateScore: aggregateScore, solvedFields: [...solvedFields].sort((a, b) => a - b), subpageComplete, attempts }, null, 2));
    return;
  }
  if (command === 'submit-homeworks') {
    const candidates = loadCandidates(path.resolve(option(flags, 'candidates', DEFAULT_CANDIDATES)));
    const works = parseWorkList(option(flags, 'works'));
    const checkpoint = option(flags, 'checkpoint', 'homework-progress');
    const existing = parseScoreHtml(await client.scoreHtml()).homework;
    const byNumber = new Map(existing.map((item) => [item.number, item]));
    const completed = [];
    const skipped = [];
    for (const work of works) {
      if (byNumber.get(work)?.score === '100.00') {
        skipped.push(work);
        continue;
      }
      const [chapterIndex, sectionIndex] = WORK_SECTIONS[work];
      await client.submitWork({ chapterIndex, sectionIndex, answers: candidates[work] });
      completed.push(work);
      writeCheckpoint(checkpoint, {
        updatedAt: new Date().toISOString(),
        completed,
        skipped,
        remaining: works.filter((item) => !completed.includes(item) && !skipped.includes(item)),
      });
    }
    console.log(JSON.stringify({ command, submitted: completed, skipped }, null, 2));
    return;
  }
  if (command === 'solve-work') {
    const work = numberOption(flags, 'work');
    if (!WORK_SECTIONS[work]) fail('--work 必须是初赛范围内的作业编号。');
    const candidates = loadCandidates(path.resolve(option(flags, 'candidates', DEFAULT_CANDIDATES)));
    const [chapterIndex, sectionIndex] = WORK_SECTIONS[work];
    const options = parseWorkOptions(await client.workHtml({ chapterIndex, sectionIndex }));
    if (options.length !== candidates[work].length) fail(`作业${work}网页题数与候选答案题数不一致。`);
    let best = candidates[work].slice();
    const checkpoint = option(flags, 'checkpoint', `solve-work-${work}`);
    const attempts = [];
    await client.submitWork({ chapterIndex, sectionIndex, answers: best });
    let bestScore = scoreForHomework(parseScoreHtml(await client.scoreHtml()), work);
    for (let index = 0; index < options.length && bestScore < 100; index += 1) {
      const base = best.slice();
      for (const answer of options[index].options) {
        if (answer === base[index]) continue;
        const trial = base.slice();
        trial[index] = answer;
        await client.submitWork({ chapterIndex, sectionIndex, answers: trial });
        const score = scoreForHomework(parseScoreHtml(await client.scoreHtml()), work);
        attempts.push({ question: index + 1, answer, score });
        if (score > bestScore) {
          best = trial;
          bestScore = score;
        }
        writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), work, answers: best, score: bestScore, attempts });
        if (bestScore === 100) break;
      }
      // 最后一次试探可能是错误选项；每题结束都恢复目前最高分的完整答案。
      await client.submitWork({ chapterIndex, sectionIndex, answers: best });
    }
    writeCheckpoint(checkpoint, { updatedAt: new Date().toISOString(), work, answers: best, score: bestScore, attempts });
    if (bestScore !== 100) fail(`作业${work}坐标校正后仍为 ${bestScore.toFixed(2)}。`);
    console.log(JSON.stringify({ command, work, score: bestScore, answers: best, attempts }, null, 2));
    return;
  }
  const chapterIndex = numberOption(flags, 'chapter-index');
  const sectionIndex = numberOption(flags, 'section-index');
  if (chapterIndex === undefined || sectionIndex === undefined) fail('提交命令需要 --chapter-index 与 --section-index。');
  if (command === 'submit-work') {
    const answers = String(option(flags, 'answers', '')).split(',').map((answer) => answer.trim());
    if (!answers.length || answers.some((answer) => !/^[A-Z]?$/.test(answer))) fail('--answers 必须是逗号分隔的大写选项字母，可用空值表示未选。');
    await client.submitWork({ chapterIndex, sectionIndex, answers });
  } else if (command === 'submit-answer') {
    const activity = option(flags, 'activity');
    const subIndex = numberOption(flags, 'sub-index');
    const field = numberOption(flags, 'field');
    const answerIndex = numberOption(flags, 'answer-index');
    if (!activity || subIndex === undefined || field === undefined || answerIndex === undefined) fail('submit-answer 需要 --activity、--sub-index、--field、--answer-index。');
    const bz = option(flags, 'bz');
    if (bz !== undefined && bz !== 'gnq') fail('--bz 目前只支持 gnq。');
    await client.submitAnswer({ chapterIndex, sectionIndex, activity, subIndex, answerIndex, field, bz });
  } else {
    fail(`未知命令: ${command}`);
  }
  console.log(JSON.stringify({ command, submitted: true }));
}

main().catch((error) => {
  console.error(`autosmt-score-gate: ${error.message}`);
  process.exitCode = 1;
});
