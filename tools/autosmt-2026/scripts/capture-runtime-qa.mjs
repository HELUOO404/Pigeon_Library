import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WORKBENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QA = path.join(WORKBENCH, 'qa');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.PIGEON_QA_BASE || 'http://127.0.0.1:5173';
const profile = mkdtempSync(path.join(tmpdir(), 'pigeon-chrome-'));

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForDebugPort() {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (existsSync(file)) {
      const [port] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
      if (port) return Number(port);
    }
    await delay(100);
  }
  throw new Error('Chrome did not expose a DevTools port.');
}

function cdpClient(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 0;
    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = ++nextId;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveCall, rejectCall) => pending.set(id, { resolveCall, rejectCall }));
        },
        once(method) {
          return new Promise((resolveEvent) => {
            const queue = listeners.get(method) || [];
            queue.push(resolveEvent);
            listeners.set(method, queue);
          });
        },
        close() { socket.close(); },
      });
    });
    socket.addEventListener('error', reject);
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const call = pending.get(message.id);
        if (!call) return;
        pending.delete(message.id);
        if (message.error) call.rejectCall(new Error(message.error.message));
        else call.resolveCall(message.result);
        return;
      }
      const queue = listeners.get(message.method);
      const listener = queue?.shift();
      if (listener) listener(message.params);
    });
  });
}

async function pageClient(port) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const page = targets.find((target) => target.type === 'page');
    if (page?.webSocketDebuggerUrl) return cdpClient(page.webSocketDebuggerUrl);
    await delay(100);
  }
  throw new Error('Chrome page target was not available.');
}

async function capture(client, { name, url, width, height, mobile }) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  const loaded = client.once('Page.loadEventFired');
  await client.send('Page.navigate', { url });
  await loaded;
  await delay(500);
  const evaluation = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector)?.getBoundingClientRect();
        return value ? { left: value.left, right: value.right, width: value.width } : null;
      };
      return {
        innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        simulation: rect('.step-simulation'),
        media: rect('.step-simulation-media'),
        choice: rect('.step-simulation-choice'),
      };
    })()`,
    returnByValue: true,
  });
  const metrics = evaluation.result.value;
  assert.equal(metrics.innerWidth, width, `${name}: device viewport width was not applied.`);
  assert.ok(metrics.documentScrollWidth <= width, `${name}: document overflows horizontally: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.bodyScrollWidth <= width, `${name}: body overflows horizontally: ${JSON.stringify(metrics)}`);
  for (const [label, rect] of Object.entries({ simulation: metrics.simulation, media: metrics.media, choice: metrics.choice })) {
    if (rect) assert.ok(rect.left >= 0 && rect.right <= width + 0.5, `${name}: ${label} is clipped: ${JSON.stringify(rect)}`);
  }
  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  writeFileSync(path.join(QA, name), Buffer.from(screenshot.data, 'base64'));
  return metrics;
}

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  'about:blank',
], { windowsHide: true, stdio: 'ignore' });

let client;
try {
  const health = await fetch(`${BASE}/offline-runtime-qa.html`);
  assert.equal(health.status, 200, `QA server returned ${health.status}.`);
  const port = await waitForDebugPort();
  client = await pageClient(port);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  const results = {};
  results.desktop = await capture(client, { name: 'step-simulation-desktop.png', url: `${BASE}/offline-runtime-qa.html`, width: 1280, height: 900, mobile: false });
  results.mobile = await capture(client, { name: 'step-simulation-mobile.png', url: `${BASE}/offline-runtime-qa.html`, width: 390, height: 844, mobile: true });
  results.verified = await capture(client, { name: 'step-simulation-verified.png', url: `${BASE}/offline-runtime-qa.html?verified=1`, width: 1280, height: 900, mobile: false });
  console.log(JSON.stringify(results, null, 2));
  await client.send('Browser.close').catch(() => {});
  await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), delay(3000)]);
} finally {
  client?.close();
  if (!chrome.killed) chrome.kill();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { rmSync(profile, { recursive: true, force: true }); break; } catch { await delay(100); }
  }
}
