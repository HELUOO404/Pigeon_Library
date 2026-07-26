#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const script = path.join(root, 'tools', 'autosmt-2026', 'scripts', 'autosmt-score-gate.mjs');
const result = spawnSync(process.execPath, [script, 'selftest'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 30_000,
});
assert.equal(result.status, 0,
  `runtime capture selftest must validate target discovery, actions, parsers and result counts.\n${result.stderr}`);
assert.match(result.stdout, /selftest: ok/);

console.log('runtime-temperature-targets: capture contract present');
