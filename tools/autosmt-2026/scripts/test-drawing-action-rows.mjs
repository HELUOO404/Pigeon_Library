#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { parse } = require(path.join(ROOT, 'app', 'node_modules', 'node-html-parser'));
const rebuildSource = readFileSync(path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'rebuild-vocational-course.mjs'), 'utf8');
const drawingTableSource = rebuildSource.slice(
  rebuildSource.indexOf('const PN_BIAS_DRAWING_ACTIONS = ['),
  rebuildSource.indexOf('\nfunction drawingBlocks(', rebuildSource.indexOf('const PN_BIAS_DRAWING_ACTIONS = [')),
);

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hardStop(_file, _node, message) {
  throw new Error(`[HARD STOP] ${message}`);
}

const drawingTable = new Function('parse', 'tagName', 'normalizeText', 'hardStop', `${drawingTableSource}\nreturn drawingTable;`)(
  parse,
  (node) => node?.tagName?.toLowerCase() || '',
  normalizeText,
  hardStop,
);
const actions = [
  '\u4e0d\u52a0\u504f\u7f6e\u7535\u538b\u4eff\u771f',
  '\u5916\u52a0\u6b63\u5411\u504f\u538b\u4eff\u771f',
  '\u5916\u52a0\u53cd\u5411\u504f\u538b\u4eff\u771f',
];
const sourceTable = `<table>
  <tr><th>\u53c2\u6570</th><th>\u503c</th></tr>
  <tr><td>0.684</td><td><select></select></td></tr>
  <tr><td>8.269</td><td><select></select></td></tr>
  <tr><td>10.198</td><td><select></select></td></tr>
  <tr><td>5.657</td><td><select></select></td></tr>
  <tr><td colspan="2"><a>${actions[0]}</a></td></tr>
  <tr><td colspan="2"><a>${actions[1]}</a></td></tr>
  <tr><td colspan="2"><a>${actions[2]}</a></td></tr>
</table>`;

test('PN-bias action rows move only the exact three standalone source links into native sandbox actions', async () => {
  const result = drawingTable(parse(sourceTable), [['A'], ['B'], ['C'], ['D']], 'fixture.html', 'drawing-22-1', actions);
  for (const action of actions) assert.doesNotMatch(result.html, new RegExp(action));
  assert.equal((result.html.match(/data-control-index=/g) || []).length, 4);
  for (const value of ['0.684', '8.269', '10.198', '5.657']) assert.match(result.html, new RegExp(value));

  const { buildDrawingSandbox } = await import(pathToFileURL(path.join(ROOT, 'tools', 'autosmt-2026', 'lib', 'drawing-sandbox-shell.mjs')));
  const block = buildDrawingSandbox({
    id: 'drawing-22-1', title: 'fixture', tableHtml: result.html,
    options: [['A'], ['B'], ['C'], ['D']], answers: ['A', 'B', 'C', 'D'], actions,
    rendererSource: 'function renderFixture() {}',
  });
  for (const action of actions) {
    assert.equal((block.html.match(new RegExp(`data-drawing-action[^>]*>${escapeRegExp(action)}<`, 'g')) || []).length, 1);
  }
});

test('drawing table rejects non-allowlisted, reordered, incomplete, or non-standalone links', () => {
  assert.throws(() => drawingTable(parse(sourceTable), [['A'], ['B'], ['C'], ['D']], 'fixture.html', 'drawing-22-0', actions), /HARD STOP/);
  assert.throws(() => drawingTable(parse(sourceTable.replace(actions[0], actions[1])), [['A'], ['B'], ['C'], ['D']], 'fixture.html', 'drawing-22-1', actions), /HARD STOP/);
  assert.throws(() => drawingTable(parse(sourceTable.replace(`<a>${actions[2]}</a>`, `<a>${actions[2]}</a>\u8bf4\u660e`)), [['A'], ['B'], ['C'], ['D']], 'fixture.html', 'drawing-22-1', actions), /HARD STOP/);
  assert.throws(() => drawingTable(parse(sourceTable.replace(`<a>${actions[2]}</a>`, `<a>${actions[2]}</a><img src="extra.png">`)), [['A'], ['B'], ['C'], ['D']], 'fixture.html', 'drawing-22-1', actions), /HARD STOP/);
  assert.throws(() => drawingTable(parse(sourceTable.replace(actions[2], '\u672a\u77e5\u64cd\u4f5c')), [['A'], ['B'], ['C'], ['D']], 'fixture.html', 'drawing-22-1', actions), /HARD STOP/);
});

test('PN VI source action moves into the sandbox action group without remaining in the table', () => {
  const action = '\u6e29\u5ea6\u66f2\u7ebf\u4eff\u771f';
  const table = `<table><tr><th>Ube</th><th>Ib</th></tr><tr><td><select></select></td><td>20</td></tr><tr><td colspan="2"><a>${action}</a></td></tr></table>`;
  const result = drawingTable(parse(table), [['0.3']], 'fixture.html', 'drawing-22-2', [action]);
  assert.doesNotMatch(result.html, new RegExp(action));
  assert.equal((result.html.match(/data-control-index=/g) || []).length, 1);
});
