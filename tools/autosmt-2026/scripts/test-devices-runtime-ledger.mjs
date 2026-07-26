import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireDevicesCanvasRendererSource } from '../lib/devices-canvas-renderers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const capturePath = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'runtime-response-capture-v1.json');
const verifier = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'verify-devices-runtime-ledger.mjs');
const fixture = path.join(ROOT, 'courses', 'runtime-ledger-test');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const targetHash = (value) => sha256(typeof value === 'string' ? value : JSON.stringify(value));
const capture = JSON.parse(readFileSync(capturePath, 'utf8'));

assert.equal(existsSync(fixture), false, 'Refusing to overwrite an existing runtime ledger test fixture.');

function responseEntries(sourcePointer, records, startIndex = 0) {
  return records.map((record, index) => ({
    sourcePointer: `${sourcePointer}/${startIndex + index}`,
    sourceValueSha256: targetHash(record),
    responseSha256: record.response.sha256,
  }));
}

function sandbox(id) {
  return `<main data-drawing-id="${id}"><script>${requireDevicesCanvasRendererSource(id)}</script></main>`;
}

try {
  const html22 = sandbox('drawing-22-0');
  const html33 = sandbox('drawing-33-0');
  const html34 = sandbox('drawing-34-0');
  const content = { knowledgePoints: { fixture: { blocks: [
    { type: 'sandbox', id: 'drawing-22-0', html: html22 },
    { type: 'sandbox', id: 'drawing-33-0', html: html33 },
    { type: 'sandbox', id: 'drawing-34-0', html: html34 },
  ] } } };
  const sourceFile = 'tools/autosmt-2026/reports/runtime-response-capture-v1.json';
  const sourceSha256 = sha256(readFileSync(capturePath));
  const ledger = { entries: [
    {
      target: 'content.json#/knowledgePoints/fixture/blocks/0/html', kind: 'runtime-response-sandbox',
      sourceFile, sourceLocation: '/czndjs', sourceSha256, targetValueSha256: targetHash(html22), status: 'verified',
      embeddedEvidence: responseEntries('/czndjs', capture.czndjs),
    },
    {
      target: 'content.json#/knowledgePoints/fixture/blocks/1/html', kind: 'runtime-response-sandbox',
      sourceFile, sourceLocation: '/drawings/0', sourceSha256, targetValueSha256: targetHash(html33), status: 'verified',
      embeddedEvidence: responseEntries('/drawings', [capture.drawings[0]]),
    },
    {
      target: 'content.json#/knowledgePoints/fixture/blocks/2/html', kind: 'runtime-response-sandbox',
      sourceFile, sourceLocation: '/drawings/1', sourceSha256, targetValueSha256: targetHash(html34), status: 'verified',
      embeddedEvidence: responseEntries('/drawings', [capture.drawings[1]], 1),
    },
  ] };
  mkdirSync(fixture, { recursive: true });
  writeFileSync(path.join(fixture, 'content.json'), `${JSON.stringify(content, null, 2)}\n`);
  writeFileSync(path.join(fixture, 'source-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);

  let result = spawnSync(process.execPath, [verifier, fixture], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /runtime response ledger verification passed: 3 sandboxes, 83 response records/i);

  ledger.entries[0].embeddedEvidence[0].sourcePointer = '/czndjs/999';
  writeFileSync(path.join(fixture, 'source-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  result = spawnSync(process.execPath, [verifier, fixture], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 1, 'an unresolvable runtime response pointer must hard-stop');
  assert.match(result.stderr, /sourcePointer/i);
  console.log('devices-runtime-ledger: ok');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
