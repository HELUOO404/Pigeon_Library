#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const ALLOWED_EXTERNAL_ROOTS = ['assets/media/', 'assets/simulations/'];

function within(base, candidate) {
  const delta = path.relative(base, candidate);
  return delta === '' || (!delta.startsWith(`..${path.sep}`) && delta !== '..' && !path.isAbsolute(delta));
}

function safeRelative(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !value.includes('\\')
    && !value.split('/').some((part) => !part || part === '.' || part === '..');
}

function readJson(file) {
  const bytes = readFileSync(file);
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error(`${file}: UTF-8 BOM is not allowed`);
  return JSON.parse(utf8.decode(bytes));
}

function sha256File(file) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

function validateIsoBmff(file) {
  const size = statSync(file).size;
  const handle = openSync(file, 'r');
  const types = new Set();
  let offset = 0;
  try {
    while (offset + 8 <= size) {
      const header = Buffer.alloc(16);
      const read = readSync(handle, header, 0, 16, offset);
      if (read < 8) throw new Error('truncated MP4 box header');
      let boxBytes = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      let headerBytes = 8;
      if (boxBytes === 1) {
        if (read < 16) throw new Error('truncated extended MP4 box header');
        const extended = header.readBigUInt64BE(8);
        if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 box exceeds safe integer range');
        boxBytes = Number(extended);
        headerBytes = 16;
      } else if (boxBytes === 0) {
        boxBytes = size - offset;
      }
      if (boxBytes < headerBytes || offset + boxBytes > size) throw new Error(`invalid MP4 box ${type}`);
      types.add(type);
      offset += boxBytes;
    }
  } finally {
    closeSync(handle);
  }
  if (offset !== size) throw new Error('MP4 has trailing bytes outside a box');
  if (!types.has('ftyp') || !types.has('mdat') || (!types.has('moov') && !types.has('moof'))) {
    throw new Error('MP4 must contain ftyp, media data, and movie metadata boxes');
  }
}

function validateExternalFormat(file) {
  const extension = path.extname(file).toLowerCase();
  if (['.mp4', '.m4v', '.mov'].includes(extension)) {
    validateIsoBmff(file);
    return;
  }
  if (extension === '.webm') {
    const bytes = readFileSync(file).subarray(0, 4);
    if (!bytes.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) throw new Error('invalid WebM EBML signature');
    return;
  }
  if (extension === '.ogg') {
    if (readFileSync(file).subarray(0, 4).toString('ascii') !== 'OggS') throw new Error('invalid Ogg signature');
    return;
  }
  if (['.js', '.mjs', '.json', '.vtt', '.css'].includes(extension)) {
    const text = utf8.decode(readFileSync(file));
    if (extension === '.json') JSON.parse(text);
    if (/(?:https?:|wss?:)\/\//i.test(text)) throw new Error('external text dependency contains a network URL');
    return;
  }
  throw new Error(`unsupported external resource format ${extension || '(none)'}`);
}

async function verify(deliveryDirectory) {
  const errors = [];
  const reportPath = path.join(deliveryDirectory, 'delivery-manifest.json');
  if (!existsSync(reportPath)) return ['delivery-manifest.json is missing'];
  let report;
  try {
    report = readJson(reportPath);
  } catch (error) {
    return [`delivery-manifest.json: ${error.message}`];
  }
  if (report.schemaVersion !== 2) errors.push('delivery-manifest.json: schemaVersion must be 2');
  const deployment = report.deployment;
  if (!deployment || typeof deployment !== 'object') return [...errors, 'delivery-manifest.json: deployment is missing'];

  const packageFile = path.resolve(ROOT, String(deployment.package || ''));
  if (!within(ROOT, packageFile) || !existsSync(packageFile) || !statSync(packageFile).isFile()) {
    errors.push('deployment package path is missing or unsafe');
  } else {
    const packageBytes = statSync(packageFile).size;
    if (deployment.bytes !== packageBytes) errors.push(`deployment package byte count mismatch: expected ${deployment.bytes}, found ${packageBytes}`);
    const packageHash = await sha256File(packageFile);
    if (deployment.sha256 !== packageHash) errors.push('deployment package SHA-256 mismatch');
  }

  const records = Array.isArray(deployment.externalAssets) ? deployment.externalAssets : [];
  const expected = new Set();
  for (const [index, record] of records.entries()) {
    const label = `externalAssets[${index}]`;
    const relative = record?.path;
    if (!safeRelative(relative) || !ALLOWED_EXTERNAL_ROOTS.some((root) => relative.startsWith(root))) {
      errors.push(`${label}: unsafe external path ${String(relative)}`);
      continue;
    }
    if (expected.has(relative)) {
      errors.push(`${label}: duplicate path ${relative}`);
      continue;
    }
    expected.add(relative);
    const file = path.resolve(deliveryDirectory, relative);
    if (!within(deliveryDirectory, file) || !existsSync(file) || !statSync(file).isFile()) {
      errors.push(`${label}: file is missing (${relative})`);
      continue;
    }
    const bytes = statSync(file).size;
    if (bytes === 0) errors.push(`${label}: file is empty (${relative})`);
    if (record.bytes !== bytes) errors.push(`${label}: byte count mismatch for ${relative}`);
    const hash = await sha256File(file);
    if (record.sha256 !== hash) errors.push(`${label}: SHA-256 mismatch for ${relative}`);
    try {
      validateExternalFormat(file);
    } catch (error) {
      errors.push(`${label}: ${relative} is not decodable (${error.message})`);
    }
  }

  const actual = new Set(ALLOWED_EXTERNAL_ROOTS.flatMap((relativeRoot) => (
    walk(path.join(deliveryDirectory, relativeRoot)).map((file) => path.relative(deliveryDirectory, file).replaceAll('\\', '/'))
  )));
  for (const file of actual) if (!expected.has(file)) errors.push(`unreported external resource: ${file}`);
  for (const file of expected) if (!actual.has(file)) errors.push(`reported external resource is absent: ${file}`);
  return errors;
}

const [argument] = process.argv.slice(2);
if (!argument || process.argv.length !== 3) {
  console.error('Usage: node tools/autosmt-2026/scripts/verify-delivery-resources.mjs <delivery-dir>');
  process.exitCode = 2;
} else {
  const deliveryDirectory = path.resolve(process.cwd(), argument);
  if (!within(ROOT, deliveryDirectory) || !existsSync(deliveryDirectory) || !statSync(deliveryDirectory).isDirectory()) {
    console.error(`Delivery resource verification failed: unsafe or missing delivery directory ${argument}`);
    process.exitCode = 1;
  } else {
    const errors = await verify(deliveryDirectory);
    if (errors.length) {
      console.error('Delivery resource verification failed:');
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else {
      console.log(`Delivery resource verification passed: ${path.relative(ROOT, deliveryDirectory).replaceAll('\\', '/')}`);
    }
  }
}
