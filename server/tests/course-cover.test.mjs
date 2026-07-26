import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_COVER_MAX_BYTES, CoverInputError, normalizeCoverSettings } from '../lib/course-cover.js';

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
const webp = Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary');

test('normalizes default, text, and image cover settings', () => {
  assert.deepEqual(normalizeCoverSettings({ mode: 'default', text: '旧值', existingImage: 'data:image/png;base64,AA==' }), {
    coverMode: 'default', coverImage: null, coverText: null,
  });
  assert.deepEqual(normalizeCoverSettings({ mode: 'text', text: '封面技术', existingImage: 'kept-image' }), {
    coverMode: 'text', coverImage: 'kept-image', coverText: '封面技术',
  });
  const image = normalizeCoverSettings({ mode: 'image', existingText: '旧文字', file: { mimetype: 'image/png', buffer: png }, existingImage: null });
  assert.equal(image.coverMode, 'image');
  assert.match(image.coverImage, /^data:image\/png;base64,/);
  assert.equal(image.coverText, '旧文字');
  assert.match(normalizeCoverSettings({ mode: 'image', file: { mimetype: 'image/jpeg', buffer: jpeg } }).coverImage, /^data:image\/jpeg;base64,/);
  assert.match(normalizeCoverSettings({ mode: 'image', file: { mimetype: 'image/webp', buffer: webp } }).coverImage, /^data:image\/webp;base64,/);
});

test('counts text by Unicode code points and enforces one through six characters', () => {
  assert.equal(normalizeCoverSettings({ mode: 'text', text: '课程封面六字' }).coverText, '课程封面六字');
  assert.throws(() => normalizeCoverSettings({ mode: 'text', text: '' }), CoverInputError);
  assert.throws(() => normalizeCoverSettings({ mode: 'text', text: '超过六个字符啊' }), CoverInputError);
});

test('rejects null and non-string text cover values', () => {
  assert.throws(() => normalizeCoverSettings({ mode: 'text', text: null }), CoverInputError);
  assert.throws(() => normalizeCoverSettings({ mode: 'text', text: 123456 }), CoverInputError);
});

test('rejects missing, oversized, mismatched, and unsupported image uploads', () => {
  assert.equal(ADMIN_COVER_MAX_BYTES, 600 * 1024);
  assert.throws(() => normalizeCoverSettings({ mode: 'image', existingImage: null }), CoverInputError);
  assert.throws(() => normalizeCoverSettings({ mode: 'image', file: { mimetype: 'image/png', buffer: Buffer.alloc(ADMIN_COVER_MAX_BYTES + 1) } }), CoverInputError);
  assert.throws(() => normalizeCoverSettings({ mode: 'image', file: { mimetype: 'image/png', buffer: Buffer.from('not png') } }), CoverInputError);
  assert.throws(() => normalizeCoverSettings({ mode: 'image', file: { mimetype: 'image/gif', buffer: Buffer.from('GIF89a') } }), CoverInputError);
});
