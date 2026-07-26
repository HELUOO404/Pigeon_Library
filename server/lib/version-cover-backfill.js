// version-cover-backfill.js - Best-effort migration for package cover text.
import fs from 'node:fs';
import { parsePigeonBuffer } from './pigeon-server.js';

export function backfillVersionCoverText(db) {
  const rows = db.prepare(
    'SELECT id, file_path FROM course_versions WHERE cover_text_checked=0',
  ).all();
  const update = db.prepare(
    'UPDATE course_versions SET cover_text=?, cover_text_checked=1 WHERE id=? AND cover_text_checked=0',
  );
  const markChecked = db.prepare(
    'UPDATE course_versions SET cover_text_checked=1 WHERE id=? AND cover_text_checked=0',
  );
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const meta = parsePigeonBuffer(fs.readFileSync(row.file_path));
      if (typeof meta.coverText !== 'string') {
        markChecked.run(row.id);
        skipped += 1;
        continue;
      }
      updated += update.run(meta.coverText, row.id).changes;
    } catch {
      markChecked.run(row.id);
      skipped += 1;
    }
  }

  return { scanned: rows.length, updated, skipped };
}
