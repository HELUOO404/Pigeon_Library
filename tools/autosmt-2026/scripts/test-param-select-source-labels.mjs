#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rebuildScript = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'rebuild-vocational-course.mjs');

function sourceLabels(relativeFile) {
  const result = spawnSync(process.execPath, [rebuildScript, '--parameter-labels', relativeFile], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

assert.deepEqual(
  sourceLabels('tools/autosmt-2026/reports/activity-details/0-8-experiment-18-tab-1.html'),
  ['抛光转速(转/min)', '抛光压强(kg/mm2)', '抛光时间(min)', '抛光液PH值'],
);

const activityDir = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'activity-details');
const genericSelectActivities = readdirSync(activityDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(path.join(activityDir, name), 'utf8')))
  .filter((meta) => meta.kind === 'select' && meta.scoreType !== 'engineering')
  .filter((meta) => /<th>序号<\/th>\s*<th>项目<\/th>\s*<th>选择<\/th>/i.test(
    readFileSync(path.join(activityDir, meta.rawHtmlFile), 'utf8'),
  ));

assert.equal(genericSelectActivities.length, 31, 'all standard 序号|项目|选择 tables across three courses must be audited');

for (const meta of genericSelectActivities) {
  const relativeFile = path.join('tools', 'autosmt-2026', 'reports', 'activity-details', meta.rawHtmlFile);
  const labels = sourceLabels(relativeFile);
  assert.equal(labels.length, meta.selectCount, `${meta.activity}/${meta.label} label count`);
  assert.ok(labels.every((label) => label && !/^\d+$/.test(label) && !/^参数\d+$/.test(label)), `${meta.activity}/${meta.label} has a serial/fallback label`);
}

console.log(`param-select-source-labels: ${genericSelectActivities.length} source tables align with their selects`);
