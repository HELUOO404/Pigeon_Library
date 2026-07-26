#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rebuildScript = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'rebuild-vocational-course.mjs');
const courseDir = path.join(ROOT, 'courses', '2026-vocational-preliminary', '2026-ic-manufacturing');

const result = spawnSync(process.execPath, [rebuildScript, 'manufacturing'], {
  cwd: ROOT,
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
assert.equal(result.status, 0, result.stderr || result.stdout);

const content = JSON.parse(readFileSync(path.join(courseDir, 'content.json'), 'utf8'));
const ledger = JSON.parse(readFileSync(path.join(courseDir, 'source-ledger.json'), 'utf8'));
const ledgerTargets = new Set(ledger.entries.map((entry) => entry.target));
const blocks = Object.values(content.knowledgePoints).flatMap((point) => point.blocks || []);
const tabs = blocks.flatMap((block) => block.type === 'tabSet' ? block.tabs : []);
const paramSelects = new Map(tabs.flatMap((tab) => tab.blocks || [])
  .filter((block) => block.type === 'paramSelect')
  .map((block) => [block.id, block]));
const matrix = paramSelects.get('experiment-3-1');

assert.ok(matrix, 'experiment-3-1 paramSelect must exist');
assert.equal(matrix.headers, undefined, 'matrix headers must remain source th cells');
assert.equal(matrix.groups, undefined, 'matrix variant must not flatten into groups');
assert.equal(matrix.matrixRows.length, 3);
assert.deepEqual(matrix.matrixRows[0].cells.map((cell) => [cell.tag, cell.scope, cell.content[0].text]), [
  ['th', 'col', '工艺名称'],
  ['th', 'col', '步骤名称Step Name'],
  ['th', 'col', '工艺气体'],
  ['th', 'col', '射频功率Pole Power(w)'],
  ['th', 'col', '流量(SCCM)'],
  ['th', 'col', '工艺时间Process Time(s)'],
  ['th', 'col', '电极位置Electrode POS(mm)'],
  ['th', 'col', '备注Remark'],
]);

const controls = (block) => block.matrixRows.flatMap((row) => row.cells)
  .flatMap((cell) => cell.content || [])
  .filter((part) => part.type === 'control');
const params = controls(matrix);
assert.equal(params.length, 12);
assert.deepEqual(params[0].options, ['CMOS_SiO2', 'CMOS_Si3N4']);
assert.equal(params[0].answerIndex, 1);
assert.equal(params[6].answerIndex, 2);
assert.ok(params.every((param) => param.options.length > 0 && param.answerIndex > 0));
assert.ok(params.every((param) => !/^参数\d+$/.test(param.label || '')), 'matrix must not contain fallback labels');

assert.deepEqual(matrix.matrixRows[1].cells[0], {
  tag: 'td',
  content: [{
    type: 'control',
    label: '工艺名称',
    options: ['CMOS_SiO2', 'CMOS_Si3N4'],
    answerIndex: 1,
  }],
});
assert.deepEqual(matrix.matrixRows[1].cells[1], {
  tag: 'td',
  content: [{ type: 'text', text: 'CMOS1' }],
});
assert.deepEqual(matrix.simulations, [{
  label: '淀积厚度仿真',
  paramRange: [1, 12],
  images: [
    { src: 'assets/images/experiment-3-pecvd-1-1.jpg', alt: 'CMOS1淀积厚度仿真', caption: 'CMOS1淀积厚度仿真' },
    { src: 'assets/images/experiment-3-pecvd-2-11.jpg', alt: 'CMOS2淀积厚度仿真', caption: 'CMOS2淀积厚度仿真' },
  ],
}]);
for (const [name, hash] of [
  ['experiment-3-pecvd-1-1.jpg', '0e3c743d7ed41f19e9c4667bb42d6108961253d76d173ddfde89abf5956844fa'],
  ['experiment-3-pecvd-2-11.jpg', 'dd3e9883bc1b6f6b40f3a1e605e10ffcb0246bbb0feabfa3d698c3a37caa690b'],
]) {
  const bytes = readFileSync(path.join(courseDir, 'assets', 'images', name));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash);
}

const epitaxy = paramSelects.get('experiment-7-1');
assert.ok(epitaxy, 'experiment-7-1 paramSelect must exist');
assert.equal(epitaxy.headers, undefined, 'row-header matrix must not invent a column-header row');
assert.equal(epitaxy.matrixRows.length, 6);
assert.deepEqual(epitaxy.matrixRows[0].cells[0], {
  tag: 'th',
  scope: 'row',
  content: [{ type: 'text', text: '加热' }],
});
assert.deepEqual(epitaxy.matrixRows[0].cells[1].content.map(({ type, text, label }) => ({ type, text, label })), [
  { type: 'text', text: '温度:　', label: undefined },
  { type: 'control', text: undefined, label: '温度: ℃' },
  { type: 'text', text: '　℃', label: undefined },
]);
assert.deepEqual(epitaxy.matrixRows[5].cells[3], { tag: 'td', content: [] });
assert.deepEqual(epitaxy.matrixRows[5].cells[4], { tag: 'td', content: [] });
assert.equal(controls(epitaxy).length, 10);
assert.deepEqual(controls(epitaxy).map((control) => control.answerIndex), [2, 2, 1, 2, 4, 3, 3, 2, 2, 1]);
assert.ok([...ledgerTargets].some((target) => target.endsWith('/matrixRows/0/cells/1/content/0/text')),
  'matrix fixed text must have a field-level source-ledger entry');
assert.ok([...ledgerTargets].some((target) => target.endsWith('/matrixRows/0/cells/1/content/1/answerIndex')),
  'matrix control answers must have full-score field-level source-ledger entries');

for (const [id, expectedAnswers] of [
  ['experiment-16-1', [4, 4, 2]],
  ['experiment-16-2', [5, 5, 2]],
]) {
  const diffusion = paramSelects.get(id);
  assert.ok(diffusion, `${id} paramSelect must exist`);
  assert.equal(diffusion.headers, undefined);
  assert.equal(diffusion.matrixRows.length, 5);
  assert.deepEqual(diffusion.matrixRows.map((row) => row.cells.length), [3, 3, 4, 3, 3]);
  assert.equal(diffusion.matrixRows[0].cells[0].tag, 'th');
  assert.equal(diffusion.matrixRows[2].cells[3].content[0].text, '氮气流量:400mL/min');
  assert.deepEqual(controls(diffusion).map((control) => control.answerIndex), expectedAnswers);
}

globalThis.document = {
  createElement() {
    return {
      textContent: '',
      appendChild(node) { this.textContent = node.textContent; },
      get innerHTML() { return this.textContent; },
    };
  },
  createTextNode(value) { return { textContent: String(value) }; },
};
const { renderParamSelect } = await import('../../../app/src/render/param-select.js');
const html = renderParamSelect(matrix, { resolveAsset: (src) => src });
assert.equal((html.match(/data-action="param-select"/g) || []).length, 24, 'desktop and mobile must share 12 controls');
assert.match(html, /<td>CMOS1<\/td>/);
assert.match(html, /<td>淀积氧化硅<\/td>/);
assert.match(html, /param-select-mobile-field-label">步骤名称Step Name/);
assert.match(html, /param-select-mobile-field-content">CMOS2/);
const answeredHtml = renderParamSelect(matrix, { resolveAsset: (src) => src });
assert.doesNotMatch(answeredHtml, /CMOS1淀积厚度仿真<\/figcaption>/, 'simulation results stay hidden until parameters are filled');

const epitaxyHtml = renderParamSelect(epitaxy, { resolveAsset: (src) => src });
assert.equal((epitaxyHtml.match(/data-action="param-select"/g) || []).length, 20);
assert.match(epitaxyHtml, /<th scope="row">加热<\/th>/);
assert.match(epitaxyHtml, /温度:[\s\S]*data-action="param-select"[\s\S]*℃/);
assert.match(epitaxyHtml, /<td><\/td>/, 'legal empty fixed cells remain empty');
assert.match(epitaxyHtml, /param-select-matrix-mobile-heading">加热/);

const learnCss = readFileSync(path.join(ROOT, 'app', 'src', 'styles', 'learn.css'), 'utf8');
assert.match(learnCss, /\.param-select-matrix-source-row[^{}]*\{[^}]*min-width\s*:\s*0/);
assert.match(learnCss, /\.param-select-matrix-mobile-heading[^{}]*\{[^}]*font-family\s*:\s*var\(--serif\)/);

console.log('param-select-matrix: source structure, answers and responsive renderer align');
