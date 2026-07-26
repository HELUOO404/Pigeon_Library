#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const { parse } = require(path.join(ROOT, 'app', 'node_modules', 'node-html-parser'));
const script = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'rebuild-vocational-course.mjs');
const homeworkFile = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'source-capture', 'sections', '1-1', 'homework.html');
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const gb18030 = new TextDecoder('gb18030');

function readSource(file) {
  const bytes = readFileSync(file);
  try { return utf8Strict.decode(bytes); } catch { return gb18030.decode(bytes); }
}

function sourceRow(questionId) {
  const row = parse(readSource(homeworkFile)).querySelectorAll('tr').find((candidate) => candidate.querySelectorAll('td')[0]?.textContent.trim() === questionId);
  assert.ok(row, `source row ${questionId} must exist`);
  return `<table>${row.outerHTML}</table>`;
}

function parseCell(cellHtml) {
  const result = spawnSync(process.execPath, [script, '--parse-homework-cell'], {
    cwd: ROOT,
    encoding: 'utf8',
    input: cellHtml,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

for (const questionId of ['12-2', '12-3']) {
  test(`homework parser preserves the literal comparison signs in source ${questionId}`, () => {
    assert.deepEqual(parseCell(sourceRow(questionId)), {
      stem: questionId === '12-2' ? 'LED普通亮度发光强度是:()' : 'LED高亮度发光强度是:()',
      options: ['A. <10mcd；', 'B. 10～100mcd；', 'C. >100mcd.'],
      keys: ['A', 'B', 'C'],
    });
  });
}

test('homework parser continues to parse a normal multi-option source cell', () => {
  const parsed = parseCell(sourceRow('12-1'));
  assert.equal(parsed.stem, '发光二极管是:()');
  assert.deepEqual(parsed.keys, ['A', 'B']);
  assert.deepEqual(parsed.options, [
    'A. 由Ⅲ-Ⅴ族化合物，如GaAs（砷化镓）、GaP（磷化镓）、GaAsP（磷砷化镓）、AlGaInP（磷化铝镓铟）等半导体制成；',
    'B. 由Ⅱ-Ⅳ族化合物，如GaAs（砷化镓）、GaP（磷化镓）、GaAsP（磷砷化镓）、AlGaInP（磷化铝镓铟）等半导体制成.',
  ]);
});
