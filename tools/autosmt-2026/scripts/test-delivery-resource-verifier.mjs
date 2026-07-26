#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const verifier = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'verify-delivery-resources.mjs');
const fixture = path.join(ROOT, 'tools', 'autosmt-2026', '.delivery-resource-test');

function box(type, payload = Buffer.alloc(0)) {
  const output = Buffer.alloc(8 + payload.length);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, 'ascii');
  payload.copy(output, 8);
  return output;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

assert.equal(existsSync(verifier), true, 'delivery resource verifier must exist');
assert.equal(existsSync(fixture), false, `Refusing existing fixture directory: ${fixture}`);

try {
  const mediaDir = path.join(fixture, 'assets', 'media');
  mkdirSync(mediaDir, { recursive: true });
  const archive = Buffer.from('pigeon-fixture');
  const media = Buffer.concat([box('ftyp', Buffer.from('isom')), box('moov'), box('mdat')]);
  writeFileSync(path.join(fixture, 'fixture.pigeon'), archive);
  writeFileSync(path.join(mediaDir, 'demo.mp4'), media);
  writeFileSync(path.join(fixture, 'delivery-manifest.json'), `${JSON.stringify({
    schemaVersion: 2,
    courseId: 'fixture',
    deployment: {
      package: 'tools/autosmt-2026/.delivery-resource-test/fixture.pigeon',
      bytes: archive.length,
      sha256: sha256(archive),
      assetBase: '/courses/fixture/',
      externalAssets: [{ path: 'assets/media/demo.mp4', bytes: media.length, sha256: sha256(media) }],
    },
  }, null, 2)}\n`);

  const passed = spawnSync(process.execPath, [verifier, fixture], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(passed.status, 0, `${passed.stdout}\n${passed.stderr}`);

  writeFileSync(path.join(mediaDir, 'demo.mp4'), Buffer.concat([media, Buffer.from('tampered')]));
  const failed = spawnSync(process.execPath, [verifier, fixture], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(failed.status, 1, `${failed.stdout}\n${failed.stderr}`);
  assert.match(failed.stderr, /byte count|SHA-256/);
  console.log('delivery-resource-verifier: ok');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
