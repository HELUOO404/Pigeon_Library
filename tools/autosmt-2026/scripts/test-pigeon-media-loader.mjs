import assert from 'node:assert/strict';
import { zipSync, strToU8 } from '../../../app/node_modules/fflate/esm/browser.js';
import { parsePigeon } from '../../../app/src/core/pigeon-loader.js';

const manifest = { schemaVersion: 1, id: 'media-test', title: 'Media test', assetBase: '/courses/media-test/', chapters: [{ id: '1', title: 'One', sections: [{ id: '1.1', title: 'One point', knowledgePoints: [{ id: '1-1-1', title: 'Point' }] }] }] };
const content = { overviews: {}, knowledgePoints: { '1-1-1': { title: 'Point', blocks: [] } } };
const archive = zipSync({
  'manifest.json': strToU8(JSON.stringify(manifest)),
  'content.json': strToU8(JSON.stringify(content)),
  'assets/media/included.mp4': new Uint8Array([0, 1, 2]),
  'assets/media/included.m4v': new Uint8Array([3, 4, 5]),
  'assets/sim/runtime.js': new Uint8Array([6, 7, 8]),
  'assets/sim/styles.css': new Uint8Array([9, 10, 11]),
});
const course = parsePigeon(archive);

assert.match(course.resolveAsset('assets/media/included.mp4'), /^blob:/);
assert.match(course.resolveAsset('assets/media/included.m4v'), /^blob:/);
assert.match(course.resolveAsset('assets/sim/runtime.js'), /^blob:/);
assert.match(course.resolveAsset('assets/sim/styles.css'), /^blob:/);
assert.match(course.resolveAsset('assets/media/included.mp4#t=1'), /^blob:.*#t=1$/);
assert.equal(course.resolveAsset('assets/media/external.mp4'), '/courses/media-test/assets/media/external.mp4');
assert.equal(course.resolveAsset('https://example.invalid/external.mp4'), 'https://example.invalid/external.mp4');
course.revoke();
console.log('pigeon-media-loader: ok');
