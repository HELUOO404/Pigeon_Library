import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE = path.join(ROOT, '奥施特资料');
const OUTPUT = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'reference-image-index.json');

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function infer(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const file = path.basename(normalized);
  const experiment = normalized.match(/实验(?:22-34)?\/(\d+)(?:[.-]|\.png$)/u)
    || normalized.match(/实验一\/(\d+)/u);
  if (experiment) return { targetType: 'experiment', targetNumber: Number(experiment[1]), confidence: 'high' };

  const project = normalized.match(/工程1-2\/(\d+)(?:[.-]|\.png$)/u);
  if (project) return { targetType: 'engineering', targetNumber: Number(project[1]), confidence: 'high' };

  if (/封装\/实验\//u.test(normalized)) {
    const number = file.match(/^(\d+)-/u);
    if (number) return { targetType: 'experiment', targetNumber: Number(number[1]), confidence: 'high' };
  }
  return null;
}

const entries = walk(SOURCE)
  .filter((file) => /\.(png|jpe?g)$/iu.test(file))
  .map((file) => path.relative(SOURCE, file))
  .sort()
  .map((relativePath) => ({ path: relativePath.replaceAll('\\', '/'), ...infer(relativePath) }));

const mapped = entries.filter((entry) => entry.targetType);
const report = {
  schemaVersion: 1,
  candidateOnly: true,
  generatedAt: new Date().toISOString(),
  sourceRoot: '奥施特资料',
  summary: { imageCount: entries.length, mappedCount: mapped.length, unmatchedCount: entries.length - mapped.length },
  mappings: mapped,
  unmatchedPaths: entries.filter((entry) => !entry.targetType).map((entry) => entry.path),
  verificationRule: 'Website score verification is authoritative; this index only prioritizes candidate parameters and screenshots.',
};

writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report.summary));
