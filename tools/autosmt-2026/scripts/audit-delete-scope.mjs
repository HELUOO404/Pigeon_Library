import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const targetIds = [
  '2026-ic-manufacturing',
  '2026-ic-devices',
  '2026-ic-packaging',
];
const targetRoots = [
  path.join('courses', '2026-vocational-preliminary'),
  path.join('dist-courses', '2026-vocational-preliminary'),
  path.join('app', 'dist', 'courses', '2026-vocational-preliminary'),
];
const allowedRoots = targetRoots.map((relative) => path.resolve(repoRoot, relative));
const reportPath = path.resolve(repoRoot, 'tools/autosmt-2026/reports/delete-scope-audit.json');

function assertInside(target, root) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error(`target escapes allowed root: ${target}`);
  }
}

function treeHash(directory) {
  const rows = [];
  const visit = (current, relativeBase) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      const relative = path.join(relativeBase, entry.name).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        visit(absolute, relative);
      } else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        rows.push(`${relative}\t${bytes.byteLength}\t${crypto.createHash('sha256').update(bytes).digest('hex')}`);
      } else {
        throw new Error(`unsupported filesystem entry: ${absolute}`);
      }
    }
  };
  visit(directory, '');
  return {
    files: rows.length,
    sha256: crypto.createHash('sha256').update(rows.join('\n')).digest('hex'),
  };
}

const targets = [];
for (const rootRelative of targetRoots) {
  const root = path.resolve(repoRoot, rootRelative);
  for (const id of targetIds) {
    const requested = path.resolve(root, id);
    assertInside(requested, root);
    const exists = fs.existsSync(requested);
    let realpath = null;
    let hash = null;
    if (exists) {
      const stat = fs.lstatSync(requested);
      if (!stat.isDirectory()) throw new Error(`target is not a directory: ${requested}`);
      realpath = fs.realpathSync.native(requested);
      assertInside(realpath, root);
      hash = treeHash(requested);
    }
    targets.push({
      id,
      rootRelative,
      requested,
      realpath,
      parent: path.dirname(requested),
      exists,
      tree: hash,
    });
  }
}

const report = {
  schemaVersion: 1,
  auditedAt: new Date().toISOString(),
  repoRoot,
  allowedRoots,
  targets,
  exclusions: [
    path.resolve(repoRoot, '奥施特资料'),
    path.resolve(repoRoot, 'tools/autosmt-2026/reports/source-capture'),
    path.resolve(repoRoot, 'courses/ic-packaging'),
    path.resolve(repoRoot, 'dist-courses/ic-packaging.pigeon'),
    path.resolve(repoRoot, 'app/src'),
  ],
};

fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
for (const target of targets) {
  console.log(JSON.stringify(target));
}
console.log(`report=${reportPath}`);
