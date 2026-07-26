#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const modulePath = path.join(ROOT, 'tools', 'autosmt-2026', 'lib', 'drawing-sandbox-shell.mjs');

test('drawing sandbox shell preserves source controls and platform interaction contract', async () => {
  assert.equal(existsSync(modulePath), true, 'drawing sandbox shell module must exist');
  const { buildDrawingSandbox } = await import(pathToFileURL(modulePath));
  const block = buildDrawingSandbox({
    id: 'drawing-test-1',
    title: '源活动标题',
    tableHtml: '<table><tr><th>阶段</th></tr><tr><td><select data-control-index="0"></select><select data-control-index="1"></select></td></tr></table>',
    options: [['1', '2'], ['3', '4']],
    answers: ['2', '3'],
    initialValues: [0, 0],
    rendererSource: 'function renderTest(ctx,values,token){ctx.strokeStyle=token("--seal");ctx.lineTo(values[0],values[1])}',
  });

  assert.equal(block.type, 'sandbox');
  assert.equal(block.id, 'drawing-test-1');
  assert.equal(block.modeSwitch, true);
  assert.ok(block.height >= 700);
  assert.ok(block.html.includes('data-drawing-simulation'));
  assert.ok(block.html.includes('源活动标题'));
  assert.ok(block.html.includes('<table>'));
  assert.equal((block.html.match(/data-control-index=/g) || []).length, 2);
  assert.ok(block.html.includes('function renderTest'));
  assert.ok(block.html.includes("type:'pigeon-score'"));
  assert.ok(block.html.includes("type:'pigeon-score-clear'"));
  assert.ok(block.html.includes("type==='pigeon-sandbox-restore'"));
  assert.ok(block.html.includes("type==='pigeon-theme'"));
  assert.ok(block.html.includes('"initialValues":[0,0]'));
  assert.ok(block.html.includes('drawValues(spec.initialValues,false)'));
  assert.ok(block.html.includes('生成曲线'));
  assert.ok(block.html.includes('data-drawing-draw'));
  assert.ok(block.html.includes('清空'));
  assert.doesNotMatch(block.html, /#[0-9a-f]{3,8}\b/i);
});

test('drawing sandbox shell preserves non-numeric select state for renderers', async () => {
  const { buildDrawingSandbox } = await import(pathToFileURL(modulePath));
  const block = buildDrawingSandbox({
    id: 'drawing-test-string-state',
    title: '字符串状态绘图题',
    tableHtml: '<table><tr><td><select data-control-index="0"></select></td></tr></table>',
    options: [['PNP', 'NPN']],
    answers: ['NPN'],
    rendererSource: 'function renderStringState(ctx,values,token){ctx.fillText(values[0],0,0)}',
  });

  assert.ok(block.html.includes("const numeric=Number(value);return Number.isFinite(numeric)?numeric:value"));
});

test('drawing sandbox shell supports validated intrinsic canvas dimensions without forcing a square', async () => {
  const { buildDrawingSandbox } = await import(pathToFileURL(modulePath));
  const block = buildDrawingSandbox({
    id: 'drawing-test-canvas-dimensions',
    title: '画布尺寸测试',
    tableHtml: '<table><tr><td><select data-control-index="0"></select></td></tr></table>',
    options: [['1']],
    answers: ['1'],
    canvasWidth: 1000,
    canvasHeight: 600,
    rendererSource: 'function renderCanvasDimensions(ctx,values,token){ctx.fillText(values[0],0,0)}',
  });

  assert.match(block.html, /<canvas class="drawing-canvas" width="1000" height="600"/);
  assert.match(block.html, /\.drawing-canvas\{[^}]*width:100%;height:auto;/);
  assert.doesNotMatch(block.html, /\.drawing-canvas\{[^}]*aspect-ratio:/);

  const defaults = buildDrawingSandbox({
    id: 'drawing-test-default-dimensions',
    title: '默认画布尺寸测试',
    tableHtml: '<table><tr><td><select data-control-index="0"></select></td></tr></table>',
    options: [['1']],
    answers: ['1'],
    rendererSource: 'function renderDefaultCanvasDimensions(){ }',
  });
  assert.match(defaults.html, /<canvas class="drawing-canvas" width="700" height="700"/);
  assert.throws(() => buildDrawingSandbox({
    id: 'drawing-test-invalid-width',
    title: '非法画布宽度测试',
    tableHtml: '<table><tr><td><select data-control-index="0"></select></td></tr></table>',
    options: [['1']],
    answers: ['1'],
    canvasWidth: 0,
    rendererSource: 'function renderInvalidCanvasDimensions(){ }',
  }), /canvasWidth must be a positive integer/);
});

test('drawing sandbox shell renders source actions and passes their identity to renderers', async () => {
  const { buildDrawingSandbox } = await import(pathToFileURL(modulePath));
  const actions = ['不加偏置电压仿真', '外加正向偏压仿真', '外加反向偏压仿真'];
  const block = buildDrawingSandbox({
    id: 'drawing-test-actions',
    title: 'PN结偏置电压仿真',
    tableHtml: '<table><tr><td><select data-control-index="0"></select></td></tr></table>',
    options: [['I|I|', '|I|I']],
    answers: ['I|I|'],
    actions,
    rendererSource: 'function renderActions(ctx,values,token,actionIndex,actionLabel){ctx.fillText(actionLabel,actionIndex,0)}',
  });

  assert.equal((block.html.match(/data-drawing-action=/g) || []).length, actions.length);
  for (const action of actions) assert.ok(block.html.includes(action));
  assert.ok(block.html.includes('renderDrawing(ctx,values.map(function(value){const numeric=Number(value);return Number.isFinite(numeric)?numeric:value}),token,activeAction,spec.actions[activeAction])'));
  assert.ok(block.html.includes("type:'pigeon-score-clear'"));
  assert.ok(block.html.includes("type==='pigeon-sandbox-restore'"));
  assert.ok(block.html.includes("type==='pigeon-sandbox-mode'"));
});
