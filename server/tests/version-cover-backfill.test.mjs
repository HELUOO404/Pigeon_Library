import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { backfillVersionCoverText } from '../lib/version-cover-backfill.js';

test('backfills each legacy version once, including no-text, missing, and invalid packages', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pigeon-cover-backfill-'));
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE course_versions (
    id INTEGER PRIMARY KEY,
    file_path TEXT NOT NULL,
    cover_text TEXT,
    cover_text_checked INTEGER NOT NULL DEFAULT 0
  )`);
  const valid = path.join(dir, 'valid.pigeon');
  fs.writeFileSync(valid, Buffer.from(zipSync({
    'manifest.json': strToU8(JSON.stringify({
      id: 'backfill', title: 'Backfill', coverText: '补齐封面',
      chapters: [{ id: '1', title: 'Chapter', sections: [] }],
    })),
  })));
  const invalid = path.join(dir, 'invalid.pigeon');
  fs.writeFileSync(invalid, Buffer.from('not-a-zip'));
  const noText = path.join(dir, 'no-text.pigeon');
  fs.writeFileSync(noText, Buffer.from(zipSync({
    'manifest.json': strToU8(JSON.stringify({
      id: 'no-text', title: 'No text', chapters: [{ id: '1', title: 'Chapter', sections: [] }],
    })),
  })));
  const tooManyEntries = { 'manifest.json': strToU8(JSON.stringify({
    id: 'bounded', title: 'Bounded', chapters: [{ id: '1', title: 'Chapter', sections: [] }],
  })) };
  for (let index = 0; index < 2048; index += 1) tooManyEntries[`assets/${index}.txt`] = new Uint8Array();
  const bounded = path.join(dir, 'bounded.pigeon');
  fs.writeFileSync(bounded, Buffer.from(zipSync(tooManyEntries)));
  const insert = db.prepare('INSERT INTO course_versions(id,file_path,cover_text) VALUES(?,?,NULL)');
  insert.run(1, valid);
  insert.run(2, noText);
  insert.run(3, invalid);
  insert.run(4, path.join(dir, 'missing.pigeon'));
  insert.run(5, bounded);

  try {
    const result = backfillVersionCoverText(db);
    assert.deepEqual(result, { scanned: 5, updated: 1, skipped: 4 });
    assert.equal(db.prepare('SELECT cover_text FROM course_versions WHERE id=1').get().cover_text, '补齐封面');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM course_versions WHERE cover_text_checked=1').get().n, 5);
    assert.deepEqual(backfillVersionCoverText(db), { scanned: 0, updated: 0, skipped: 0 });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
