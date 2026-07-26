import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { parsePigeonBuffer, PigeonError } from '../lib/pigeon-server.js';

function manifest(extra = {}) {
  return strToU8(JSON.stringify({
    id: 'bounded-course',
    title: 'Bounded course',
    chapters: [{ id: '1', title: 'Chapter', sections: [] }],
    ...extra,
  }));
}

function patchCentralEntry(bytes, entryName, patch) {
  const result = Buffer.from(bytes);
  for (let offset = 0; offset + 46 <= result.length; offset += 1) {
    if (result.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = result.readUInt16LE(offset + 28);
    const name = result.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name === entryName) {
      patch(result, offset);
      return result;
    }
  }
  throw new Error(`Missing central-directory entry: ${entryName}`);
}

test('rejects archives with more than 2048 file entries before extraction', () => {
  const entries = { 'manifest.json': manifest() };
  for (let index = 0; index < 2048; index += 1) entries[`assets/${index}.txt`] = new Uint8Array();
  assert.throws(
    () => parsePigeonBuffer(Buffer.from(zipSync(entries))),
    (error) => error instanceof PigeonError && error.code === 'pigeon_entry_limit',
  );
});

test('rejects archives whose expanded files exceed 64 MiB', () => {
  const bytes = Buffer.from(zipSync({
    'manifest.json': manifest(),
    'assets/expanded.bin': new Uint8Array(64 * 1024 * 1024 + 1),
  }, { level: 1 }));
  assert.throws(
    () => parsePigeonBuffer(bytes),
    (error) => error instanceof PigeonError && error.code === 'pigeon_expanded_limit',
  );
});

test('rejects actual output over 64 MiB when the central-directory size is forged smaller', () => {
  const normal = zipSync({
    'manifest.json': manifest(),
    'assets/expanded.bin': new Uint8Array(64 * 1024 * 1024 + 1),
  }, { level: 1 });
  const crafted = patchCentralEntry(normal, 'assets/expanded.bin', (bytes, offset) => {
    bytes.writeUInt32LE(1, offset + 24);
  });
  assert.throws(
    () => parsePigeonBuffer(crafted),
    (error) => error instanceof PigeonError && error.code === 'pigeon_expanded_limit',
  );
});

test('rejects a central-directory CRC that does not match decompressed bytes', () => {
  const normal = zipSync({ 'manifest.json': manifest() });
  const crafted = patchCentralEntry(normal, 'manifest.json', (bytes, offset) => {
    bytes.writeUInt32LE((bytes.readUInt32LE(offset + 16) ^ 0xffffffff) >>> 0, offset + 16);
  });
  assert.throws(
    () => parsePigeonBuffer(crafted),
    (error) => error instanceof PigeonError && error.code === 'bad_pigeon',
  );
});

test('rejects a ZIP64 locator before extraction', () => {
  const normal = Buffer.from(zipSync({ 'manifest.json': manifest() }));
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  const crafted = Buffer.concat([normal.subarray(0, -22), locator, normal.subarray(-22)]);
  assert.throws(
    () => parsePigeonBuffer(crafted),
    (error) => error instanceof PigeonError && error.code === 'pigeon_zip64_unsupported',
  );
});

test('returns a text-only manifest cover', () => {
  const parsed = parsePigeonBuffer(Buffer.from(zipSync({
    'manifest.json': manifest({ coverText: '文本封面' }),
  })));
  assert.equal(parsed.coverBase64, null);
  assert.equal(parsed.coverText, '文本封面');
});
