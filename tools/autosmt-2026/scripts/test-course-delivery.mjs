import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { unzipSync, strFromU8 } = require('../../../app/node_modules/fflate');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const courseId = 'delivery-test';
const source = path.join(ROOT, 'courses', courseId);
const output = path.join(ROOT, 'dist-courses', courseId);
const full = path.join(ROOT, 'dist-courses', `${courseId}.full.pigeon`);
const builder = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'build-course-delivery.mjs');
const registrySource = readFileSync(path.join(ROOT, 'app', 'src', 'core', 'course-registry.js'), 'utf8');
for (const id of ['2026-ic-manufacturing', '2026-ic-devices', '2026-ic-packaging']) {
  assert.match(registrySource, new RegExp(`id:\\s*['"]${id}['"]`), `${id} must be registered as a built-in course`);
}

assert.equal(existsSync(source), false, `Refusing to overwrite existing fixture path: ${source}`);
assert.equal(existsSync(output), false, `Refusing to overwrite existing fixture output: ${output}`);

try {
  mkdirSync(path.join(source, 'assets', 'media'), { recursive: true });
  mkdirSync(path.join(source, 'assets', 'images'), { recursive: true });
  mkdirSync(path.join(source, 'assets', 'simulations', 'demo'), { recursive: true });
  writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({
    schemaVersion: 1,
    id: courseId,
    title: 'Delivery Test',
    chapters: [{ id: '1', title: 'Chapter', sections: [{ id: '1.1', title: 'Section', knowledgePoints: [{ id: '1-1-1', title: 'Point' }] }] }],
  }));
  writeFileSync(path.join(source, 'content.json'), JSON.stringify({
    overviews: {},
    knowledgePoints: {
      '1-1-1': {
        title: 'Point',
        blocks: [
          { type: 'video', src: 'assets/media/a.php' },
          { type: 'image', src: 'assets/images/figure.png', alt: 'Figure' },
          { type: 'sandbox', html: '<script src="assets/simulations/demo/runtime.js"></script>', dependencies: ['assets/simulations/demo/data.json'] },
        ],
      },
    },
  }));
  writeFileSync(path.join(source, 'assets', 'media', 'a.php'), new Uint8Array([0, 1, 2, 3]));
  writeFileSync(path.join(source, 'assets', 'images', 'figure.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  writeFileSync(path.join(source, 'assets', 'simulations', 'demo', 'runtime.js'), 'fetch("./data.json")');
  writeFileSync(path.join(source, 'assets', 'simulations', 'demo', 'data.json'), '{"ok":true}');

  const result = spawnSync(process.execPath, [builder, courseId], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const deploymentPath = path.join(output, `${courseId}.pigeon`);
  const webDeploymentPath = path.join(output, `${courseId}.web.pigeon.zip`);
  const deployment = unzipSync(new Uint8Array(readFileSync(deploymentPath)));
  const backup = unzipSync(new Uint8Array(readFileSync(full)));
  const manifest = JSON.parse(strFromU8(deployment['manifest.json']));
  assert.equal(manifest.assetBase, `/courses/${courseId}/`);
  assert.deepEqual(readFileSync(webDeploymentPath), readFileSync(deploymentPath));
  assert.equal(deployment['assets/media/a.php'], undefined);
  assert.equal(deployment['assets/images/figure.png'], undefined);
  assert.equal(deployment['assets/simulations/demo/runtime.js'], undefined);
  assert.ok(backup['assets/media/a.php']);
  assert.ok(backup['assets/images/figure.png']);
  assert.ok(backup['assets/generated/images/figure.png.webp']);
  assert.ok(backup['assets/simulations/demo/runtime.js']);
  assert.ok(existsSync(path.join(output, 'assets', 'media', 'a.php')));
  assert.ok(existsSync(path.join(output, 'assets', 'images', 'figure.png')));
  assert.ok(existsSync(path.join(output, 'assets', 'generated', 'images', 'figure.png.webp')));
  assert.ok(existsSync(path.join(output, 'assets', 'simulations', 'demo', 'data.json')));
  const report = JSON.parse(readFileSync(path.join(output, 'delivery-manifest.json'), 'utf8'));
  assert.equal(report.resourceClosure.missing.length, 0);
  assert.equal(report.resourceClosure.external.length, 0);
  assert.equal(report.deployment.externalAssets.length, 5);
  const generatedAsset = report.deployment.externalAssets.find((asset) => asset.path === 'assets/generated/images/figure.png.webp');
  assert.ok(generatedAsset);
  const generatedBytes = readFileSync(path.join(output, generatedAsset.path));
  assert.equal(generatedAsset.bytes, generatedBytes.length);
  assert.equal(generatedAsset.sha256, createHash('sha256').update(generatedBytes).digest('hex'));
  assert.match(report.deployment.sha256, /^[a-f0-9]{64}$/);
  console.log('course-delivery: ok');
} finally {
  rmSync(source, { recursive: true, force: true });
  rmSync(output, { recursive: true, force: true });
  rmSync(full, { force: true });
}
