import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { zipSync } = require('../app/node_modules/fflate');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const courseId = process.argv[2];

if (!courseId) {
  console.error('Usage: node tools/build-pigeon.mjs <courseId>');
  process.exit(1);
}

const courseDir = path.join(ROOT, 'courses', courseId);
const distDir = path.join(ROOT, 'dist-courses');
const outFile = path.join(distDir, `${courseId}.pigeon`);

function toZipPath(absPath) {
  return path.relative(courseDir, absPath).replace(/\\/g, '/');
}

function addFiles(dir, entries) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      addFiles(full, entries);
      continue;
    }
    entries[toZipPath(full)] = new Uint8Array(readFileSync(full));
  }
}

if (!statSync(courseDir, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`Course directory not found: ${path.relative(ROOT, courseDir)}`);
  process.exit(1);
}

const entries = {};
addFiles(courseDir, entries);

for (const required of ['manifest.json', 'content.json']) {
  if (!entries[required]) {
    console.error(`Missing required course file: ${required}`);
    process.exit(1);
  }
}

mkdirSync(distDir, { recursive: true });
const zipped = zipSync(entries, { level: 9 });
writeFileSync(outFile, zipped);

const rawBytes = Object.values(entries).reduce((sum, bytes) => sum + bytes.byteLength, 0);
console.log(`built: ${path.relative(ROOT, outFile).replace(/\\/g, '/')}`);
console.log(`packageFiles: ${Object.keys(entries).length}`);
console.log(`rawBytes: ${rawBytes}`);
console.log(`pigeonBytes: ${zipped.byteLength}`);
