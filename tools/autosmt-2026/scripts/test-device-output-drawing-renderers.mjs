import assert from 'node:assert/strict';
import { deviceOutputDrawingRendererSource } from '../lib/device-output-drawing-renderers.mjs';

const ids = ['drawing-19-1', 'drawing-19-2', 'drawing-22-2', 'drawing-38-1', 'drawing-38-2'];

function contextRecorder() {
  const calls = [];
  const ctx = {
    calls,
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    quadraticCurveTo: (...args) => calls.push(['quadraticCurveTo', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    stroke: () => calls.push(['stroke']),
    fill: () => calls.push(['fill']),
    set font(value) { calls.push(['font', value]); },
    set lineWidth(value) { calls.push(['lineWidth', value]); },
    set fillStyle(value) { calls.push(['fillStyle', value]); },
    set strokeStyle(value) { calls.push(['strokeStyle', value]); },
  };
  return ctx;
}

function rendererFor(id) {
  const source = deviceOutputDrawingRendererSource(id);
  assert.equal(typeof source, 'string', `${id} must produce a renderer source string`);
  assert.match(source, /function renderDeviceOutput\(ctx, values, token\)/, `${id} signature`);
  assert.match(source, /700/, `${id} records the 700px logical canvas`);
  assert.match(source, /token\('--ink'\)/, `${id} maps axes and text to the ink token`);
  assert.match(source, /token\('--seal'\)/, `${id} maps curves to the golden seal token`);
  assert.match(source, /token\('--sans'\)/, `${id} maps the canvas font family to the site token`);
  assert.doesNotMatch(source, /(?:#[0-9a-f]{3,8}|rgb\(|\bblue\b)/i, `${id} must not hard-code a color`);
  assert.doesNotMatch(source, /Microsoft YaHei|token\('(?!--)/, `${id} must not hard-code a font or use a non-CSS token name`);
  return Function(`return (${source});`)();
}

assert.equal(deviceOutputDrawingRendererSource('drawing-missing'), null, 'unknown drawings hard-stop at caller boundary');

for (const id of ids) rendererFor(id);

const npnSource = deviceOutputDrawingRendererSource('drawing-19-1');
assert.match(npnSource, /const nxMax = 9, nyMax = 6;/, 'drawing-19-1 source axis limits');
assert.match(npnSource, /const dw = \[60, 80\];/, 'drawing-19-1 source scale');
assert.match(npnSource, /const pto = \[50, 650\];/, 'drawing-19-1 source origin');
assert.match(npnSource, /const array_ptx = \[0\.3, 4, 8, 0\.3, 4, 8, 0\.3, 4, 8\];/, 'drawing-19-1 source x data');

const nmosSource = deviceOutputDrawingRendererSource('drawing-19-2');
assert.match(nmosSource, /const nxMax = 21, nyMax = 6;/, 'drawing-19-2 source axis limits');
assert.match(nmosSource, /const dw = \[27, 80\];/, 'drawing-19-2 source scale');
assert.match(nmosSource, /const pto = \[50, 650\];/, 'drawing-19-2 source origin');
assert.match(nmosSource, /const array_ptx = \[0\.3, 10, 20, 0\.3, 10, 20, 0\.3, 10, 20\];/, 'drawing-19-2 source x data');

const capturedNpnSource = deviceOutputDrawingRendererSource('drawing-38-1');
assert.match(capturedNpnSource, /const nxMax = 9, nyMax = 6;/, 'drawing-38-1 source axis limits');
assert.match(capturedNpnSource, /const dw = \[60, 80\];/, 'drawing-38-1 source scale');
assert.match(capturedNpnSource, /const array_ptx = \[0\.3, 4, 8, 0\.3, 4, 8, 0\.3, 4, 8\];/, 'drawing-38-1 source x data');

const capturedNmosSource = deviceOutputDrawingRendererSource('drawing-38-2');
assert.match(capturedNmosSource, /const nxMax = 21, nyMax = 6;/, 'drawing-38-2 source axis limits');
assert.match(capturedNmosSource, /const dw = \[27, 80\];/, 'drawing-38-2 source scale');
assert.match(capturedNmosSource, /const array_ptx = \[0\.3, 10, 20, 0\.3, 10, 20, 0\.3, 10, 20\];/, 'drawing-38-2 source x data');

const pnViSource = deviceOutputDrawingRendererSource('drawing-22-2');
assert.match(pnViSource, /PN节VI特性曲线仿真/, 'drawing-22-2 preserves the source chart title');
assert.match(pnViSource, /\[0, 1, 20, 40, 60, 80\]/, 'drawing-22-2 preserves the 25℃ Ib rows');
assert.match(pnViSource, /\[0\.5, 1, 20, 40, 60, 80\]/, 'drawing-22-2 preserves the 100℃ Ib rows');
const pnVi = rendererFor('drawing-22-2');
const pnViContext = contextRecorder();
pnVi(pnViContext, [0.3, 0.335, 0.435, 0.485, 0.5, 0.535, 0.3, 0.335, 0.435, 0.485, 0.5, 0.535], (name) => `var(${name})`);
assert.ok(pnViContext.calls.some((call) => call[0] === 'fillText' && call[1] === '25℃'), 'drawing-22-2 first series label');
assert.ok(pnViContext.calls.some((call) => call[0] === 'fillText' && call[1] === '100℃'), 'drawing-22-2 second series label');

const npn = rendererFor('drawing-19-1');
const npnContext = contextRecorder();
npn(npnContext, [0.2, 2, 4, 0.2, 2, 4, 0.2, 2, 4], (name) => `var(--${name})`);
assert.deepEqual(
  npnContext.calls.filter((call) => call[0] === 'quadraticCurveTo'),
  [
    ['quadraticCurveTo', 68, 634, 230, 330],
    ['quadraticCurveTo', 68, 634, 230, 330],
    ['quadraticCurveTo', 68, 634, 230, 330],
  ],
  'drawing-19-1 preserves the source NPN origin, dw, and quadratic formula',
);
assert.ok(npnContext.calls.some((call) => call[0] === 'fillText' && call[1] === 'NPN_VI特性曲线'), 'drawing-19-1 title');
assert.ok(npnContext.calls.some((call) => call[0] === 'fillText' && call[1] === 'Ic/mA'), 'drawing-19-1 y-axis');
assert.ok(npnContext.calls.some((call) => call[0] === 'fillText' && call[1] === 'Uce/V'), 'drawing-19-1 x-axis');
assert.ok(npnContext.calls.some((call) => call[0] === 'fillText' && call[1] === 'IB=80uA'), 'drawing-19-1 curve labels');

const nmos = rendererFor('drawing-19-2');
const nmosContext = contextRecorder();
nmos(nmosContext, [0.2, 1, 4, 0.2, 1, 4, 0.2, 1, 4], (name) => `var(--${name})`);
assert.deepEqual(
  nmosContext.calls.filter((call) => call[0] === 'quadraticCurveTo'),
  [
    ['quadraticCurveTo', 58.1, 634, 189.05, 602],
    ['quadraticCurveTo', 320, 570, 455, 450],
    ['quadraticCurveTo', 58.1, 634, 189.05, 602],
    ['quadraticCurveTo', 320, 570, 455, 450],
    ['quadraticCurveTo', 58.1, 634, 189.05, 602],
    ['quadraticCurveTo', 320, 570, 455, 450],
  ],
  'drawing-19-2 preserves the source NMOS origin, dw, and midpoint quadratic formulas',
);
assert.ok(nmosContext.calls.some((call) => call[0] === 'fillText' && call[1] === 'NMOS_VI特性曲线'), 'drawing-19-2 title');
assert.ok(nmosContext.calls.some((call) => call[0] === 'fillText' && call[1] === 'ID/mA'), 'drawing-19-2 y-axis');
assert.ok(nmosContext.calls.some((call) => call[0] === 'fillText' && call[1] === 'Uds/V'), 'drawing-19-2 x-axis');
assert.ok(nmosContext.calls.some((call) => call[0] === 'fillText' && call[1] === 'Ugs=6V'), 'drawing-19-2 curve labels');

console.log('device-output-drawing-renderers: ok');
