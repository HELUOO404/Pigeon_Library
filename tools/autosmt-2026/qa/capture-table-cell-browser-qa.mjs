#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const APP = path.join(ROOT, 'app');
const QA_DIR = path.join(ROOT, 'tools', 'autosmt-2026', 'qa');
const NODE = process.execPath;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const VITE_PORT = 5174;
const CDP_PORT = 9223;
const URL = `http://127.0.0.1:${VITE_PORT}/table-cell-qa.html`;
const CHROME_PROFILE = path.join(process.env.TEMP || 'C:\\tmp', 'pigeon-table-cell-cdp-profile');

mkdirSync(QA_DIR, { recursive: true });

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitFor(url, predicate, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (predicate(response)) return;
    } catch { /* server is still starting */ }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function killTree(child) {
  if (!child?.pid) return;
  spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
}

class Cdp {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.events.get(message.method) || []) listener(message.params || {});
    });
  }

  on(method, listener) {
    const listeners = this.events.get(method) || [];
    listeners.push(listener);
    this.events.set(method, listeners);
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

async function newTarget() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  if (!response.ok) throw new Error(`CDP target creation failed: ${response.status}`);
  return response.json();
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
  return result.result?.value;
}

const viewports = [
  { name: 'desktop', width: 1377, height: 812, mobile: false },
  { name: 'wide', width: 2048, height: 1216, mobile: false },
  { name: 'mobile', width: 375, height: 812, mobile: true },
];

const vite = spawn(NODE, [path.join(APP, 'node_modules', 'vite', 'bin', 'vite.js'), '--configLoader', 'runner', '--host', '127.0.0.1', '--port', String(VITE_PORT)], {
  cwd: APP,
  stdio: 'ignore',
});
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${CHROME_PROFILE}`,
  'about:blank',
], { stdio: 'ignore' });

try {
  await waitFor(`http://127.0.0.1:${VITE_PORT}/table-cell-qa.html`, (response) => response.ok);
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`, (response) => response.ok);
  const target = await newTarget();
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  const consoleErrors = [];
  const externalRequests = [];
  cdp.on('Runtime.exceptionThrown', (event) => consoleErrors.push(event.exceptionDetails?.text || 'runtime exception'));
  cdp.on('Log.entryAdded', (event) => { if (event.entry?.level === 'error') consoleErrors.push(event.entry.text || 'console error'); });
  cdp.on('Network.requestWillBeSent', (event) => {
    const requestUrl = event.request?.url || '';
    if (requestUrl && !requestUrl.startsWith(`http://127.0.0.1:${VITE_PORT}/`) && !requestUrl.startsWith('data:') && !requestUrl.startsWith('blob:') && !requestUrl.startsWith('devtools:')) externalRequests.push(requestUrl);
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');

  const reports = [];
  for (const viewport of viewports) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    });
    await cdp.send('Page.navigate', { url: URL });
    await wait(500);
    const report = await evaluate(cdp, `new Promise((resolve, reject) => {
      const started = Date.now();
      const poll = () => {
        if (document.body?.dataset.qa) {
          resolve({ status: document.body.dataset.qa, report: JSON.parse(document.querySelector('#qaResult').textContent) });
          return;
        }
        if (Date.now() - started > 15000) {
          resolve({
            status: 'timeout',
            report: {
              readyState: document.readyState,
              qaErrors: window.__qaErrors || [],
              rootHtml: document.querySelector('#qaRoot')?.innerHTML.slice(0, 500) || '',
            },
          });
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    })`, true);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const screenshotPath = path.join(QA_DIR, `table-cell-multi-image-${viewport.name}.png`);
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    reports.push({ viewport, ...report, screenshot: path.relative(ROOT, screenshotPath).replaceAll('\\', '/') });
  }
  cdp.close();
  const result = {
    schemaVersion: 1,
    status: reports.every((item) => item.status === 'pass') && consoleErrors.length === 0 && externalRequests.length === 0 ? 'passed' : 'failed',
    reports,
    consoleErrors,
    externalRequests,
    screenshotSha256: reports.map((item) => ({ file: item.screenshot, sha256: createHash('sha256').update(readFileSync(path.join(ROOT, item.screenshot))).digest('hex') })),
  };
  writeFileSync(path.join(QA_DIR, 'table-cell-multi-image-browser.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== 'passed') process.exitCode = 1;
} finally {
  killTree(chrome);
  killTree(vite);
}
