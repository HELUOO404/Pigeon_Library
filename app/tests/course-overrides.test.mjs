import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as courseOverrides from '../src/core/course-overrides.js';

const { applyBuiltinOverrides, resolveCourseCover } = courseOverrides;

const defaults = [
  {
    id: 'alpha', title: 'Alpha', subtitle: 'Default subtitle', description: 'Default description',
    author: 'Default author', url: 'courses/alpha.pigeon', coverUrl: '/base.png', coverText: 'Base cover', stats: { chapters: 2 },
  },
  { id: 'beta', title: 'Beta', author: 'Beta author', url: 'courses/beta.pigeon' },
];

test('applies online metadata without replacing bundled package fields', () => {
  const result = applyBuiltinOverrides(defaults, [{
    course_key: 'alpha', title: 'Edited', subtitle: 'Edited subtitle', description: 'Edited description',
    author: 'Edited author', publisher_name: 'Edited publisher', category: '其他', hidden: 0, visible: 0,
    cover_mode: 'text', cover_image: 'data:image/png;base64,AA==', cover_text: 'Override cover', updated_at: 42,
  }], { includeInvisible: true });

  assert.equal(result[0].title, 'Edited');
  assert.equal(result[0].publisherName, 'Edited publisher');
  assert.equal(result[0].category, '其他');
  assert.equal(result[0].url, 'courses/alpha.pigeon');
  assert.deepEqual(result[0].stats, { chapters: 2 });
  assert.equal(result[0].updatedAt, 42);
  assert.equal(result[0].visible, false);
  assert.equal(result[0].coverMode, 'text');
  assert.equal(result[0].coverImageOverride, 'data:image/png;base64,AA==');
  assert.equal(result[0].coverTextOverride, 'Override cover');
  assert.equal(result[0].baseCoverUrl, '/base.png');
  assert.equal(result[0].baseCoverText, 'Base cover');
});

test('filters built-ins with a server tombstone', () => {
  const result = applyBuiltinOverrides(defaults, [{ course_key: 'beta', hidden: 1 }]);
  assert.deepEqual(result.map((course) => course.id), ['alpha']);
});

test('a tombstone wins even when the same public control row is invisible', () => {
  const result = applyBuiltinOverrides(defaults, [{ course_key: 'beta', hidden: 1, visible: 0 }], { includeInvisible: true });
  assert.deepEqual(result.map((course) => course.id), ['alpha']);
});

test('filters built-ins disabled by an administrative visibility override', () => {
  const overrides = [{ course_key: 'beta', hidden: 0, visible: 0 }];
  const result = applyBuiltinOverrides(defaults, overrides);
  assert.deepEqual(result.map((course) => course.id), ['alpha']);
  const adminResult = applyBuiltinOverrides(defaults, overrides, { includeInvisible: true });
  assert.deepEqual(adminResult.map((course) => course.id), ['alpha', 'beta']);
});

test('resolves image, text, and default covers without mutating the base course', () => {
  assert.deepEqual(resolveCourseCover({
    title: 'Course', baseImage: '/base.png', baseText: 'Base cover', mode: 'image', image: 'data:image/png;base64,AA==',
  }), { coverUrl: 'data:image/png;base64,AA==', coverText: '' });
  assert.deepEqual(resolveCourseCover({
    title: 'Course', baseImage: '/base.png', baseText: 'Base cover', mode: 'text', text: 'New cover',
  }), { coverUrl: '', coverText: 'New cover' });
  assert.deepEqual(resolveCourseCover({
    title: 'Course', baseImage: '/base.png', baseText: 'Base cover', mode: 'default',
  }), { coverUrl: '/base.png', coverText: 'Base cover' });
});

test('preserves bundled defaults when no backend overrides exist', () => {
  const result = applyBuiltinOverrides(defaults, []);
  assert.equal(result[0].title, 'Alpha');
  assert.equal(result[0].publisherName, 'Default author');
  assert.notEqual(result[0], defaults[0]);
});

test('uses a full Unicode code point for the title fallback', () => {
  assert.equal(typeof courseOverrides.firstCodePoint, 'function');
  assert.equal(courseOverrides.firstCodePoint('🧪课程'), '🧪');
  assert.deepEqual(resolveCourseCover({ title: '🧪课程' }), { coverUrl: '', coverText: '🧪' });

  for (const file of ['src/main-home.js', 'src/core/course-modal.js']) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /firstCodePoint/);
    assert.doesNotMatch(source, /\.slice\(0,\s*1\)/);
  }
});
