// verify-platform-runtime-preview.mjs — 平台预览课浏览器验收(paramSelect 架构)。
// 验证:paramSelect 表格渲染/填满即出现仿真按钮(与对错无关)/统一提交计分/组级 sandbox 曲线绘制。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const OUTPUT = path.join(ROOT, 'tools', 'autosmt-2026', 'qa');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const URL = 'http://localhost:5173/learn.html?course=platform-runtime-preview&qa=10#kp-1-1-3';
const profile = path.join(tmpdir(), `pigeon-runtime-qa-${process.pid}`);

mkdirSync(OUTPUT, { recursive: true });

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function debuggerTarget() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' });
      if (response.ok) return response.json();
    } catch {}
    await delay(250);
  }
  throw new Error('Chrome remote debugger did not start');
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 0;
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    opened,
    send(method, params = {}) {
      sequence += 1;
      return new Promise((resolve, reject) => {
        pending.set(sequence, { resolve, reject });
        socket.send(JSON.stringify({ id: sequence, method, params }));
      });
    },
    close() { socket.close(); },
  };
}

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--window-size=1377,1000',
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

try {
  const target = await debuggerTarget();
  const client = connect(target.webSocketDebuggerUrl);
  await client.opened;
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await delay(3500);

  const evalMain = (expression) => client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    .then((r) => (typeof r.result?.value === 'string' ? JSON.parse(r.result.value) : r.result?.value));

  // 1) 展开工程卡,验证 paramSelect 初始渲染:五列表头、3 个下拉、无仿真按钮、提交禁用
  const initial = await evalMain(`(async () => {
    const card = document.getElementById('kp-1-1-3');
    const header = card.querySelector('.card-header');
    if (header?.classList.contains('collapsed')) header.click();
    await new Promise(r => setTimeout(r, 500));
    const ps = card.querySelector('.param-select');
    return JSON.stringify({
      title: document.title,
      hasParamSelect: !!ps,
      headers: [...ps.querySelectorAll('th')].map(x => x.textContent.trim()),
      selects: ps.querySelectorAll('select.step-simulation-choice').length,
      simToggles: ps.querySelectorAll('.param-select-sim-toggle').length,
      submitDisabled: ps.querySelector('[data-action="param-submit"]').disabled,
    });
  })()`);

  // 2) 填满(第一项故意选错):仿真按钮应出现(填满即出现,与对错无关);提交可用
  // 注意:每次 change 会整块重渲染(outerHTML),必须逐次重新查询 select
  const filled = await evalMain(`(async () => {
    const values = ['1','2','2']; // 工艺类型选错,其余正确
    for (let i = 0; i < values.length; i += 1) {
      const s = document.querySelectorAll('#kp-1-1-3 .param-select select.step-simulation-choice')[i];
      s.value = values[i];
      s.dispatchEvent(new Event('change', {bubbles: true}));
      await new Promise(r => setTimeout(r, 150));
    }
    const ps2 = document.querySelector('#kp-1-1-3 .param-select');
    return JSON.stringify({
      simToggles: ps2.querySelectorAll('.param-select-sim-toggle').length,
      simLabel: ps2.querySelector('.param-select-sim-toggle')?.textContent.trim(),
      submitDisabled: ps2.querySelector('[data-action="param-submit"]').disabled,
    });
  })()`);

  // 3) 提交:得分 67 分 · 正确率 2/3,错项行下给正确答案
  const submitted = await evalMain(`(async () => {
    document.querySelector('#kp-1-1-3 [data-action="param-submit"]').click();
    await new Promise(r => setTimeout(r, 400));
    const ps = document.querySelector('#kp-1-1-3 .param-select');
    return JSON.stringify({
      result: ps.querySelector('.step-simulation-result')?.textContent.trim(),
      incorrectSelects: ps.querySelectorAll('select.incorrect').length,
      correctSelects: ps.querySelectorAll('select.correct').length,
      correctAnswerNotes: [...ps.querySelectorAll('.step-simulation-correct-answer p')].map(x => x.textContent.trim()),
      simStillThere: ps.querySelectorAll('.param-select-sim-toggle').length,
    });
  })()`);

  // 4) 点开仿真面板:sandbox iframe 创建
  const simOpened = await evalMain(`(async () => {
    const ps = document.querySelector('#kp-1-1-3 .param-select');
    ps.querySelector('.param-select-sim-toggle').click();
    await new Promise(r => setTimeout(r, 400));
    const ps2 = document.querySelector('#kp-1-1-3 .param-select');
    const frame = ps2.querySelector('.param-select-sim-panel iframe.sandbox-frame');
    if (frame) { frame.loading = 'eager'; frame.scrollIntoView({block: 'center'}); }
    return JSON.stringify({ hasFrame: !!frame, srcdocLength: frame?.srcdoc.length || 0 });
  })()`);
  await delay(2500);

  // 5) 进 iframe 验证 canvas 实际绘制
  const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((response) => response.json());
  const sandboxTarget = targets.find((item) => item.type === 'iframe');
  if (!sandboxTarget?.webSocketDebuggerUrl) {
    throw new Error(`Sandbox iframe target not found: ${JSON.stringify(targets.map((t) => t.type))}`);
  }
  const sandboxClient = connect(sandboxTarget.webSocketDebuggerUrl);
  await sandboxClient.opened;
  await sandboxClient.send('Runtime.enable');
  const sandbox = await sandboxClient.send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const canvas = document.getElementById('engineeringCanvas');
      if (!canvas) return { canvas: false };
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let coloredPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] && (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245)) coloredPixels += 1;
      }
      return {
        canvas: true,
        backingWidth: canvas.width,
        displayedWidth: Math.round(canvas.getBoundingClientRect().width),
        coloredPixels,
        result: document.getElementById('engineeringResult').textContent.trim(),
      };
    })())`,
    returnByValue: true,
  });

  const report = {
    initial, filled, submitted, simOpened,
    sandbox: JSON.parse(sandbox.result.value),
  };
  writeFileSync(path.join(OUTPUT, 'platform-runtime-preview.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report));

  const shot = await client.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(OUTPUT, 'platform-runtime-preview.png'), Buffer.from(shot.data, 'base64'));

  // 断言(填满即出现是核心行为)
  const assert = (cond, msg) => { if (!cond) throw new Error(`ASSERT: ${msg}`); };
  assert(report.initial.hasParamSelect, 'paramSelect rendered');
  assert(report.initial.headers.join(',') === '序号,结构,工艺,参数名称,选择', `headers: ${report.initial.headers}`);
  assert(report.initial.simToggles === 0, 'sim button hidden before filled');
  assert(report.initial.submitDisabled === true, 'submit disabled before filled');
  assert(report.filled.simToggles === 1, 'sim button appears when filled (even with wrong answer)');
  assert(report.filled.submitDisabled === false, 'submit enabled when filled');
  assert(report.submitted.result.includes('67') && report.submitted.result.includes('2/3'), `score: ${report.submitted.result}`);
  assert(report.submitted.incorrectSelects === 1 && report.submitted.correctSelects === 2, 'per-item grading');
  assert(report.submitted.simStillThere === 1, 'sim button unaffected by grading');
  assert(report.simOpened.hasFrame, 'sandbox iframe created on toggle');
  assert(report.sandbox.canvas && report.sandbox.coloredPixels > 1000, 'canvas actually drawn');
  console.log('verify-platform-runtime-preview: ok');
  sandboxClient.close();
  client.close();
} finally {
  chrome.kill();
}
