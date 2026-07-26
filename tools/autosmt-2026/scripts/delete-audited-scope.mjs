import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const reportPath = path.resolve(repoRoot, 'tools/autosmt-2026/reports/delete-scope-audit.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

function treeHash(directory) {
  const rows = [];
  const visit = (current, relativeBase) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.join(relativeBase, entry.name).replaceAll('\\', '/');
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        rows.push(`${relative}\t${bytes.byteLength}\t${crypto.createHash('sha256').update(bytes).digest('hex')}`);
      } else throw new Error(`unsupported filesystem entry: ${absolute}`);
    }
  };
  visit(directory, '');
  return { files: rows.length, sha256: crypto.createHash('sha256').update(rows.join('\n')).digest('hex') };
}

for (const target of report.targets) {
  if (!target.exists) throw new Error(`audited target disappeared: ${target.requested}`);
  const requested = path.resolve(target.requested);
  const realpath = fs.realpathSync.native(requested);
  if (realpath !== target.realpath) throw new Error(`realpath changed: ${requested}`);
  const currentTree = treeHash(requested);
  if (JSON.stringify(currentTree) !== JSON.stringify(target.tree)) {
    throw new Error(`tree changed since audit: ${requested}`);
  }
}

for (const target of report.targets) {
  fs.rmSync(path.resolve(target.requested), { recursive: true, force: true });
  console.log(`deleted=${target.requested}`);
}
