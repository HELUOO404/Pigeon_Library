#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rebuildScript = readFileSync(path.join(
  ROOT,
  'tools',
  'autosmt-2026',
  'scripts',
  'rebuild-vocational-course.mjs',
), 'utf8');

test('devices drawing activities forward their configured source action lists to the sandbox shell', () => {
  const drawingBlocksStart = rebuildScript.indexOf('function drawingBlocks(tab) {');
  assert.notEqual(drawingBlocksStart, -1, 'drawingBlocks converter must exist');
  const callStart = rebuildScript.indexOf('const sandbox = buildDrawingSandbox({', drawingBlocksStart);
  const callEnd = rebuildScript.indexOf('\n  });', callStart);
  assert.notEqual(callStart, -1, 'drawing sandbox builder call must exist');
  assert.notEqual(callEnd, -1, 'drawing sandbox builder call must close');
  const call = rebuildScript.slice(callStart, callEnd);

  const listStart = rebuildScript.indexOf('const PN_BIAS_DRAWING_ACTIONS = [');
  const listEnd = rebuildScript.indexOf('\n];', listStart);
  assert.notEqual(listStart, -1, 'PN-bias source action list must be declared once');
  assert.equal((rebuildScript.slice(listStart, listEnd).match(/'/g) || []).length, 6, 'PN-bias action list must contain exactly three labels');
  assert.match(rebuildScript, /const PN_VI_DRAWING_ACTIONS = \['温度曲线仿真'\];/);
  assert.match(rebuildScript, /const drawingActions = id === 'drawing-22-1'\s*\? PN_BIAS_DRAWING_ACTIONS\s*:\s*id === 'drawing-22-2'\s*\? PN_VI_DRAWING_ACTIONS\s*:\s*null;/);
  assert.match(call, /actions:\s*drawingActions,/);
});
