import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { temperatureDrawingRendererSource } from '../lib/temperature-drawing-renderers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ids = ['drawing-3-2', 'drawing-7-1', 'drawing-15-1', 'drawing-15-2', 'drawing-16-1', 'drawing-16-2'];

function contextRecorder() {
  const calls = [];
  const ctx = {
    calls,
    beginPath: () => calls.push(['beginPath']),
    moveTo: (...args) => calls.push(['moveTo', ...args]),
    lineTo: (...args) => calls.push(['lineTo', ...args]),
    fillRect: (...args) => calls.push(['fillRect', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    setLineDash: (...args) => calls.push(['setLineDash', ...args]),
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
  const source = temperatureDrawingRendererSource(id);
  assert.equal(typeof source, 'string', `${id} must produce a renderer source string`);
  assert.match(source, /function renderTemperature\(ctx, values, token\)/, `${id} signature`);
  assert.doesNotMatch(source, /rgb\(|#[0-9a-f]/i, `${id} must not hard-code a color`);
  assert.match(source, /token\('--ink'\)/, `${id} maps axes and text to the ink token`);
  assert.match(source, /token\('--seal'\)/, `${id} maps curves to the golden seal token`);
  assert.match(source, /token\('--sans'\)/, `${id} maps the canvas font family to the site token`);
  assert.doesNotMatch(source, /Microsoft YaHei|token\('(?!--)/, `${id} must not hard-code a font or use a non-CSS token name`);
  return Function(`return (${source});`)();
}

for (const id of ids) {
  const source = temperatureDrawingRendererSource(id);
  assert.match(source, /700/, `${id} records the 700px logical canvas`);
  assert.match(source, /token\('--(?:ink|text-soft|gold|gold-deep|seal|correct-bg|wrong-bg|hover|card)'\)/, `${id} maps source colors to site tokens`);
  assert.match(source, /fillText\([^,]+,[^,]+,[^)]+\)/, `${id} keeps source labels`);
}

const pecvdSource = temperatureDrawingRendererSource('drawing-3-2');
assert.match(pecvdSource, /const nxMax = 8;/, 'drawing-3-2 preserves the source x-axis stage count');
assert.match(pecvdSource, /const nyMax = 8;/, 'drawing-3-2 preserves the source y-axis stage count');
assert.match(pecvdSource, /const scale = \[6\.5, 0\.5\];/, 'drawing-3-2 preserves source scale');
assert.match(pecvdSource, /const origin = \[60, 600\];/, 'drawing-3-2 preserves source origin');
assert.match(pecvdSource, /heatMinutes \+ depositionMinutes \+ 15/, 'drawing-3-2 preserves the final 15-minute stage');
assert.match(pecvdSource, /PECVD\\u6e29\\u5ea6\\u66f2\\u7ebf/, 'drawing-3-2 preserves its source title');

const siliconSource = temperatureDrawingRendererSource('drawing-15-1');
const phosphorusSource = temperatureDrawingRendererSource('drawing-15-2');
for (const [id, source] of [['drawing-15-1', siliconSource], ['drawing-15-2', phosphorusSource]]) {
  assert.match(source, /const nxMax = 23;/, `${id} preserves the source x-axis stage count`);
  assert.match(source, /const nyMax = 14;/, `${id} preserves the source y-axis stage count`);
  assert.match(source, /const scale = \[2\.5, 0\.3\];/, `${id} preserves source scale`);
  assert.match(source, /\[60, -950\]/, `${id} preserves the 950-degree preheat stage`);
  assert.match(source, /170 \+ sourceMinutes \+ dryOxidationMinutes/, `${id} preserves the final cool-down coordinate`);
}
assert.match(siliconSource, /液态硼扩散/, 'drawing-15-1 preserves the liquid-boron title');
assert.doesNotMatch(siliconSource, /液态硅扩散/, 'drawing-15-1 must not substitute silicon for boron');
assert.match(phosphorusSource, /液态磷扩散/, 'drawing-15-2 preserves the liquid-phosphorus title');

assert.throws(
  () => temperatureDrawingRendererSource('drawing-missing'),
  /Unsupported temperature drawing: drawing-missing/,
  'unknown drawings hard-stop',
);

const pecvd = rendererFor('drawing-3-2');
const pecvdContext = contextRecorder();
pecvd(pecvdContext, [300, 10, 850, 20], (name) => `var(--${name})`);
assert.deepEqual(
  pecvdContext.calls.filter((call) => call[0] === 'lineTo').slice(-3),
  [
    ['lineTo', 125, 450],
    ['lineTo', 255, 175],
    ['lineTo', 352.5, 587.5],
  ],
  'drawing-3-2 preserves [6.5, 0.5], [60,600], and its three source nodes',
);
assert.ok(pecvdContext.calls.some((call) => call[0] === 'fillText' && call[1] === 'min'), 'drawing-3-2 has the min axis label');
assert.ok(pecvdContext.calls.some((call) => call[0] === 'fillText' && call[1] === '℃'), 'drawing-3-2 has the temperature axis label');

for (const id of ['drawing-15-1', 'drawing-15-2']) {
  const renderer = rendererFor(id);
  const first = contextRecorder();
  const second = contextRecorder();
  renderer(first, [800, 20, 1050, 1150, 30], (name) => `var(--${name})`);
  renderer(second, [950, 60, 1180, 1350, 50], (name) => `var(--${name})`);
  const firstNodes = first.calls.filter((call) => call[0] === 'lineTo').slice(-7);
  const secondNodes = second.calls.filter((call) => call[0] === 'lineTo').slice(-7);
  assert.deepEqual(firstNodes, [
    ['lineTo', 210, 315], ['lineTo', 260, 360], ['lineTo', 310, 285], ['lineTo', 385, 255],
    ['lineTo', 460, 255], ['lineTo', 535, 255], ['lineTo', 610, 592.5],
  ], `${id} keeps the seven-stage source coordinate formula`);
  assert.notDeepEqual(firstNodes, secondNodes, `${id} follows changed input values`);
  assert.ok(first.calls.some((call) => call[0] === 'fillText' && call[1] === 'min'), `${id} has the min axis label`);
  assert.ok(first.calls.some((call) => call[0] === 'fillText' && call[1] === '℃'), `${id} has the temperature axis label`);
}

const runtimeCapture = JSON.parse(readFileSync(path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'runtime-response-capture-v1.json'), 'utf8'));
const runtimeCases = [
  { id: 'drawing-7-1', scoreNumber: 7, subIndex: 1, evidence: 'ui-state-experiment-7-strict-audit.json', scaleX: 6 },
  { id: 'drawing-16-1', scoreNumber: 16, subIndex: 1, evidence: 'ui-state-experiment-16-after-v2.json', scaleX: 8 },
  { id: 'drawing-16-2', scoreNumber: 16, subIndex: 2, evidence: 'ui-state-experiment-16-after-v2.json', scaleX: 8 },
];
for (const runtimeCase of runtimeCases) {
  const response = runtimeCapture.temperatureCurves.filter((record) => (
    record.activity.scoreNumber === runtimeCase.scoreNumber && record.activity.subIndex === runtimeCase.subIndex
  ));
  assert.equal(response.length, 1, `${runtimeCase.id} has one captured runtime curve`);
  const uiState = JSON.parse(readFileSync(path.join(ROOT, 'tools', 'autosmt-2026', 'reports', runtimeCase.evidence), 'utf8'));
  const answers = uiState.tabs.find((tab) => tab.subIndex === runtimeCase.subIndex)?.selectedValues;
  assert.ok(Array.isArray(answers) && answers.length > 0, `${runtimeCase.id} has full-score parameter evidence`);
  const renderer = rendererFor(runtimeCase.id);
  const context = contextRecorder();
  renderer(context, answers, (name) => `var(${name})`);
  const points = response[0].response.numericValue;
  assert.deepEqual(
    context.calls.filter((call) => call[0] === 'lineTo').slice(-points.length),
    points.map(([x, y]) => ['lineTo', 60 + x * runtimeCase.scaleX, 600 - y * 0.3]),
    `${runtimeCase.id} renders every captured full-score curve point`,
  );
}

console.log('temperature-drawing-renderers: ok');
