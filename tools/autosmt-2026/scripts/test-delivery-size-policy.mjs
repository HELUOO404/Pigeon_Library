#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const policyPath = path.join(ROOT, 'tools', 'autosmt-2026', 'lib', 'delivery-size-policy.mjs');

test('portable backup is skipped when stored-file lower bound exceeds loader limit', async () => {
  assert.equal(existsSync(policyPath), true, 'delivery size policy module must exist');
  const { portableBackupPlan } = await import(pathToFileURL(policyPath));
  const plan = portableBackupPlan([
    { relative: 'assets/media/a.mp4', size: 700 },
    { relative: 'assets/images/b.png', size: 400 },
    { relative: 'content.json', size: 5000 },
  ], 1000);
  assert.deepEqual(plan, { skip: true, storedLowerBoundBytes: 1100 });
});

test('portable backup remains eligible when stored-file lower bound fits', async () => {
  assert.equal(existsSync(policyPath), true, 'delivery size policy module must exist');
  const { portableBackupPlan } = await import(pathToFileURL(policyPath));
  const plan = portableBackupPlan([
    { relative: 'assets/media/a.mp4', size: 700 },
    { relative: 'content.json', size: 5000 },
  ], 1000);
  assert.deepEqual(plan, { skip: false, storedLowerBoundBytes: 700 });
});
