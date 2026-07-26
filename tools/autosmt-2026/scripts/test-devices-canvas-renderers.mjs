import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { devicesCanvasRendererSourceFromCapture, requireDevicesCanvasRendererSource } from '../lib/devices-canvas-renderers.mjs';

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const SANDBOX_TOKENS = new Set(['--paper', '--surface', '--card', '--ink', '--text', '--text-soft',
  '--line', '--line-2', '--gold', '--gold-deep', '--seal', '--hover', '--serif', '--sans', '--mono',
  '--radius', '--correct-bg', '--correct-tx', '--wrong-bg', '--wrong-tx']);
const location = (scoreNumber) => ({
  scoreType: 'experiment',
  scoreNumber,
  chapterIndex: 1,
  sectionIndex: scoreNumber === 22 ? 0 : 6,
  activity: `Experiment ${scoreNumber}`,
  subIndex: 0,
  label: `Drawing ${scoreNumber}`,
  rawHtmlFile: scoreNumber === 22
    ? '1-0-experiment-22-tab-0.html'
    : `1-6-experiment-${scoreNumber}-tab-0.html`,
});

function response(value) {
  const raw = JSON.stringify(value);
  return { raw, value, sha256: sha256(raw) };
}

function numericResponse(value) {
  return { ...response(value), numericValue: value.map((entry) => Number(entry)) };
}

function capture() {
  const czndjs = [];
  for (let data1 = 1; data1 <= 9; data1 += 1) {
    for (let data2 = 1; data2 <= 9; data2 += 1) {
      czndjs.push({
        activity: location(22),
        request: { flag: 'CZNDJS', data1: String(data1), data2: String(data2) },
        response: numericResponse([String(data1 / 10), String(data2), String(data1 + data2), String(data1 + data2 + 1)]),
      });
    }
  }
  const npn = [['#aa0000', 10, 20, 30, 40], ['#00aa00', 50, 60, 70, 80]];
  const cmos = [['#0000aa', 100, 200, 50, 60], ['#aaaa00', 150, 300, 40, 70]];
  return {
    schema: 'autosmt-runtime-response-capture-v1',
    capturedAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:01.000Z',
    activities: [
      { location: location(22), action: 'CZNDJS', detailSha256: 'a'.repeat(64) },
      { location: location(33), action: 'LD', detailSha256: 'b'.repeat(64) },
      { location: location(34), action: 'LD', detailSha256: 'c'.repeat(64) },
    ],
    czndjs,
    drawings: [
      { activity: location(33), request: { flag: 'LD' }, response: response(npn) },
      { activity: location(34), request: { flag: 'LD' }, response: response(cmos) },
    ],
  };
}

function canvasCalls() {
  const calls = [];
  return {
    calls,
    context: {
      measureText: (value) => ({ width: String(value).length * 8 }),
      beginPath: () => calls.push(['beginPath']),
      moveTo: (...args) => calls.push(['moveTo', ...args]),
      lineTo: (...args) => calls.push(['lineTo', ...args]),
      fillRect: (...args) => calls.push(['fillRect', ...args]),
      fillText: (...args) => calls.push(['fillText', ...args]),
      arc: (...args) => calls.push(['arc', ...args]),
      fill: () => calls.push(['fill']),
      stroke: () => calls.push(['stroke']),
      setLineDash: (...args) => calls.push(['setLineDash', ...args]),
    },
  };
}

function run(source, values = []) {
  const name = source.match(/^function\s+(render\w+)\(/)?.[1];
  assert.ok(name, 'renderer source must begin with a named render function');
  const render = Function(`${source}; return ${name};`)();
  const drawing = canvasCalls();
  render(drawing.context, values, (name) => name);
  return drawing.calls;
}

function assertSandboxRendererSyntax(source) {
  assert.doesNotThrow(
    () => Function(`const renderDrawing=${source}; return renderDrawing;`)(),
    'renderer must parse when injected by buildDrawingSandbox',
  );
  for (const token of source.match(/--[a-z0-9-]+/g) || []) {
    assert.ok(SANDBOX_TOKENS.has(token), `renderer references sandbox token outside the platform whitelist: ${token}`);
  }
}

const valid = capture();
const pnSource = devicesCanvasRendererSourceFromCapture('drawing-22-0', valid);
assert.match(pnSource, /^function renderPnConcentration\(/);
assert.doesNotMatch(pnSource, /#aa0000|RGB\(/);
assertSandboxRendererSyntax(pnSource);
const oldDocument = globalThis.document;
const cells = [{ textContent: '' }, { textContent: '' }, { textContent: '' }, { textContent: '' }];
globalThis.document = { querySelectorAll: (selector) => selector === '.data' ? cells : [] };
const pnCalls = run(pnSource, ['Si', 2, 3, 'decrease']);
globalThis.document = oldDocument;
assert.deepEqual(cells.map((cell) => cell.textContent), ['0.2', '3', '5', '6']);
assert.ok(pnCalls.some((call) => call[0] === 'fillRect'), 'PN renderer must preserve source drawing geometry');
const fallbackCells = [{ textContent: '' }, { textContent: '' }, { textContent: '' }, { textContent: '' }];
globalThis.document = {
  querySelectorAll: (selector) => {
    if (selector === '.data') return [];
    if (selector === '.drawing-fields table tr') return Array.from({ length: 7 }, (_, index) => ({
      querySelector: () => fallbackCells[index - 3] || null,
    }));
    return [];
  },
};
run(pnSource, ['Si', 2, 3, 'decrease']);
globalThis.document = oldDocument;
assert.deepEqual(fallbackCells.map((cell) => cell.textContent), ['0.2', '3', '5', '6'], 'sanitized source tables must retain all four output cells');
assert.throws(() => run(pnSource, ['Si', 10, 3, 'decrease']), /not captured/, 'uncaptured CZNDJS request must hard-stop');

const npnSource = devicesCanvasRendererSourceFromCapture('drawing-33-0', valid);
assert.doesNotMatch(npnSource, /#aa0000|#00aa00/, 'source drawing colors must not become Canvas styles');
assertSandboxRendererSyntax(npnSource);
const npnCalls = run(npnSource);
assert.deepEqual(npnCalls.filter((call) => call[0] === 'fillRect').map((call) => call.slice(1)), [[10, 20, 30, 40], [50, 60, 70, 80]]);
assert.ok(npnCalls.some((call) => call[0] === 'moveTo' && call.slice(1).join(',') === '10,20'), 'NPN boundary must use source coordinates');

const cmosSource = devicesCanvasRendererSourceFromCapture('drawing-34-0', valid);
assert.doesNotMatch(cmosSource, /#0000aa|#aaaa00/, 'source drawing colors must not become Canvas styles');
assertSandboxRendererSyntax(cmosSource);
const cmosCalls = run(cmosSource);
assert.deepEqual(cmosCalls.filter((call) => call[0] === 'fillRect').map((call) => call.slice(1)), [[100, 340, 50, 60], [150, 230, 40, 70]]);
assert.ok(cmosCalls.some((call) => call[0] === 'moveTo' && call.slice(1).join(',') === '100,200'), 'CMOS boundary must retain source boundary coordinates');

const brokenHash = capture();
brokenHash.czndjs[0].response.sha256 = '0'.repeat(64);
assert.throws(() => devicesCanvasRendererSourceFromCapture('drawing-22-0', brokenHash), /SHA-256/, 'tampered response hash must hard-stop');

const missingCombination = capture();
missingCombination.czndjs.pop();
assert.throws(() => devicesCanvasRendererSourceFromCapture('drawing-22-0', missingCombination), /81/, 'missing CZNDJS combination must hard-stop');

const badRectangle = capture();
badRectangle.drawings[0].response = response([['#aa0000', 1, 2, 0, 4]]);
assert.throws(() => devicesCanvasRendererSourceFromCapture('drawing-33-0', badRectangle), /positive/, 'invalid LD rectangle must hard-stop');

const badNumeric = capture();
badNumeric.czndjs[0].response = numericResponse(['', '2', '3', '4']);
assert.throws(() => devicesCanvasRendererSourceFromCapture('drawing-22-0', badNumeric), /finite/, 'empty CZNDJS numeric string must hard-stop');

const tooManyColors = capture();
tooManyColors.drawings[0].response = response(Array.from({ length: 15 }, (_, index) => [`#${String(index).padStart(6, '0')}`, 1, 2, 3, 4]));
assert.throws(() => devicesCanvasRendererSourceFromCapture('drawing-33-0', tooManyColors), /token palette/, 'color count beyond token palette must hard-stop');

const duplicateLd = capture();
duplicateLd.drawings[1].response = duplicateLd.drawings[0].response;
assert.throws(() => devicesCanvasRendererSourceFromCapture('drawing-34-0', duplicateLd), /different/, 'duplicate LD response must hard-stop');

const pnBiasRendererSource = requireDevicesCanvasRendererSource('drawing-22-1');
assert.match(pnBiasRendererSource, /^function renderPnBias\(/);
assert.match(pnBiasRendererSource, /10\.198/);
assert.match(pnBiasRendererSource, /5\.657/);
assert.doesNotMatch(pnBiasRendererSource, /RGB\(/);
const pnBiasCalls = run(pnBiasRendererSource, ['I|I|', 'Vbi+VR', '|I|I', 'Vbi-Va']);
assert.equal(pnBiasCalls.filter((call) => call[0] === 'fillRect').length, 4);

for (const id of ['drawing-22-0', 'drawing-33-0', 'drawing-34-0']) {
  const source = requireDevicesCanvasRendererSource(id);
  assert.match(source, /^function render/, `${id} must load its production renderer from the complete capture`);
  assertSandboxRendererSyntax(source);
}
assert.throws(
  () => requireDevicesCanvasRendererSource('drawing-22-0', path.resolve('tools/autosmt-2026/reports/no-runtime-response-capture.json')),
  (error) => error?.code === 'DEVICES_CANVAS_EVIDENCE_MISSING',
  'a missing capture file path must hard-stop',
);

assert.throws(
  () => requireDevicesCanvasRendererSource('drawing-unknown'),
  (error) => error?.code === 'DEVICES_CANVAS_UNKNOWN',
  'unknown drawing ids must hard-stop',
);

console.log('devices-canvas-renderers: runtime response validation and renderers ok');
