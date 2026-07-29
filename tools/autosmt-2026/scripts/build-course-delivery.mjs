import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { portableBackupPlan, usesStoredCompression } from '../lib/delivery-size-policy.mjs';

const require = createRequire(import.meta.url);
const { zipSync } = require('../../../app/node_modules/fflate');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_COLLECTION = '2026-vocational-preliminary';
const MAX_PORTABLE_BYTES = 1024 * 1024 * 1024;

function parseArgs(values) {
  const result = { courseId: '', collection: '' };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--collection') result.collection = values[++index] || '';
    else if (!result.courseId) result.courseId = value;
    else throw new Error(`Unexpected argument: ${value}`);
  }
  return result;
}

function safeSegment(value, label) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || '')) {
    throw new Error(`${label} must use lowercase ASCII letters, digits, and single hyphens.`);
  }
  return value;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function stripJsonComments(text) {
  let out = '';
  let inString = false, escaped = false, inLine = false, inBlock = false;
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index], next = text[index + 1];
    if (inLine) { if (current === '\n') { inLine = false; out += current; } continue; }
    if (inBlock) { if (current === '*' && next === '/') { inBlock = false; index += 1; } continue; }
    if (inString) {
      out += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') { inString = true; out += current; continue; }
    if (current === '/' && next === '/') { inLine = true; index += 1; continue; }
    if (current === '/' && next === '*') { inBlock = true; index += 1; continue; }
    out += current;
  }
  return out;
}

function stripTrailingCommas(text) {
  let out = '';
  let inString = false, escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    if (inString) {
      out += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') { inString = true; out += current; continue; }
    if (current === ',') {
      let next = index + 1;
      while (next < text.length && /\s/.test(text[next])) next += 1;
      if (text[next] === '}' || text[next] === ']') continue;
    }
    out += current;
  }
  return out;
}

function parseJson(file) {
  return JSON.parse(stripTrailingCommas(stripJsonComments(readFileSync(file, 'utf8'))));
}

function relativeTo(base, full) {
  return path.relative(base, full).replace(/\\/g, '/');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function htmlReferences(html) {
  const tags = [...String(html || '').matchAll(/<[^>]+>/g)].map((match) => match[0]);
  const attributes = tags.flatMap((tag) => {
    const direct = [...tag.matchAll(/\b(?:src|poster|data)=(["'])(.*?)\1/gi)].map((match) => match[2]);
    const stylesheet = /^<link\b/i.test(tag)
      ? [...tag.matchAll(/\bhref=(["'])(.*?)\1/gi)].map((match) => match[2])
      : [];
    return [...direct, ...stylesheet];
  });
  const srcsets = tags.flatMap((tag) => [...tag.matchAll(/\bsrcset=(["'])(.*?)\1/gi)])
    .flatMap((match) => match[2].split(',').map((candidate) => candidate.trim().split(/\s+/)[0]));
  const css = [...String(html || '').matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)].map((match) => match[2]);
  return [...attributes, ...srcsets, ...css];
}

function contentReferences(value, key = '', output = []) {
  if (typeof value === 'string') {
    if (['src', 'poster', 'captions', 'clip'].includes(key)) output.push(value);
    if (key === 'html') output.push(...htmlReferences(value));
    return output;
  }
  if (Array.isArray(value)) {
    if (key === 'dependencies') output.push(...value.filter((item) => typeof item === 'string'));
    else value.forEach((item) => contentReferences(item, '', output));
    return output;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([childKey, child]) => contentReferences(child, childKey, output));
  }
  return output;
}

function cleanReference(value) {
  return String(value || '').trim().replace(/[?#].*$/, '').replace(/\\/g, '/').replace(/^\.\//, '');
}

const args = parseArgs(process.argv.slice(2));
const courseId = safeSegment(args.courseId, 'course-id');
let collection = args.collection ? safeSegment(args.collection, 'collection') : '';
const nestedCourse = path.join(ROOT, 'courses', DEFAULT_COLLECTION, courseId);
if (!collection && statSync(nestedCourse, { throwIfNoEntry: false })?.isDirectory()) collection = DEFAULT_COLLECTION;
const courseDir = path.join(ROOT, 'courses', ...(collection ? [collection] : []), courseId);
if (!statSync(courseDir, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error(`Course directory not found: ${relativeTo(ROOT, courseDir)}`);
}

const manifestPath = path.join(courseDir, 'manifest.json');
const contentPath = path.join(courseDir, 'content.json');
if (!existsSync(manifestPath) || !existsSync(contentPath)) throw new Error('Course source must include manifest.json and content.json.');
const manifest = parseJson(manifestPath);
let content = parseJson(contentPath);
if (manifest.id !== courseId) throw new Error(`manifest.id must equal ${courseId}.`);
if (!manifest.title || !Array.isArray(manifest.chapters) || !manifest.chapters.length) throw new Error('Manifest must include title and chapters.');

if (collection === DEFAULT_COLLECTION) {
  const plan = parseJson(path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'collection-plan.json'));
  const expected = plan.deliverables.find((item) => item.id === courseId);
  if (!expected) throw new Error(`Course ${courseId} is not declared in the 2026 collection plan.`);
  if (manifest.title !== expected.title) throw new Error(`Course title must be exactly: ${expected.title}`);
  if (manifest.title.includes('课程包')) throw new Error('Course title must not contain 课程包.');
  const chapterIds = manifest.chapters.map((chapter) => Number(chapter.id));
  if (chapterIds.join(',') !== expected.sourceChapters.join(',')) {
    throw new Error(`Course chapters must be ${expected.sourceChapters.join(',')}; found ${chapterIds.join(',')}.`);
  }
}

const derivativeRoot = mkdtempSync(path.join(tmpdir(), 'pigeon-media-'));
const cleanupDerivatives = () => rmSync(derivativeRoot, { recursive: true, force: true });
process.once('exit', cleanupDerivatives);
const derivativeContent = path.join(derivativeRoot, 'content.json');
const generated = spawnSync('python', [
  path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'generate-media-derivatives.py'),
  '--course-dir', courseDir,
  '--stage-dir', derivativeRoot,
  '--content', contentPath,
  '--output-content', derivativeContent,
], { cwd: ROOT, encoding: 'utf8' });
if (generated.status !== 0) {
  cleanupDerivatives();
  throw new Error(generated.stderr.trim() || 'Media derivative generation failed.');
}
content = JSON.parse(readFileSync(derivativeContent, 'utf8'));
const derivativeRecords = JSON.parse(generated.stdout).records || [];

const references = [...new Set([
  ...(manifest.cover ? [manifest.cover] : []),
  ...contentReferences(content),
])].filter(Boolean).sort();
const missing = [];
const external = [];
for (const reference of references) {
  if (/^(?:data:|blob:|#)/i.test(reference)) continue;
  if (/^(?:https?:|\/\/|\/)/i.test(reference)) {
    external.push(reference);
    continue;
  }
  const clean = cleanReference(reference);
  const sourceTarget = path.resolve(courseDir, clean);
  const derivedTarget = path.resolve(derivativeRoot, clean);
  const insideSource = sourceTarget.startsWith(`${courseDir}${path.sep}`) && statSync(sourceTarget, { throwIfNoEntry: false })?.isFile();
  const insideDerived = derivedTarget.startsWith(`${derivativeRoot}${path.sep}`) && statSync(derivedTarget, { throwIfNoEntry: false })?.isFile();
  if (!insideSource && !insideDerived) missing.push(reference);
}
if (external.length) throw new Error(`Offline course contains external resource references:\n${external.join('\n')}`);
if (missing.length) throw new Error(`Course resource closure is incomplete:\n${missing.join('\n')}`);

const sourceInventory = walk(courseDir).map((file) => {
  const relative = relativeTo(courseDir, file);
  return { file, relative, size: statSync(file).size };
});
sourceInventory.push(...derivativeRecords.map((record) => {
  const file = path.join(derivativeRoot, record.path);
  return { file, relative: record.path, size: statSync(file).size, derived: record.kind };
}));
const inventoryPaths = new Set();
for (const item of sourceInventory) {
  if (inventoryPaths.has(item.relative)) throw new Error(`Generated derivative path collides with a source file: ${item.relative}`);
  inventoryPaths.add(item.relative);
}
const contentEntry = sourceInventory.find((item) => item.relative === 'content.json');
if (contentEntry) {
  contentEntry.file = derivativeContent;
  contentEntry.size = statSync(derivativeContent).size;
}
const referencedAssets = new Set(references.map(cleanReference).filter((reference) => reference.startsWith('assets/')));
for (const record of derivativeRecords) if (record.kind === 'image-webp') referencedAssets.add(record.path);
const backupPlan = portableBackupPlan(sourceInventory, MAX_PORTABLE_BYTES);
const fullEntries = backupPlan.skip ? null : {};
const deploymentEntries = {};
const externalAssets = [];
for (const item of sourceInventory) {
  const bytes = readFileSync(item.file);
  item.sha256 = sha256(bytes);
  const entry = usesStoredCompression(item.relative) ? [new Uint8Array(bytes), { level: 0 }] : new Uint8Array(bytes);
  if (fullEntries) fullEntries[item.relative] = entry;
  if (item.relative.startsWith('assets/')) {
    if (referencedAssets.has(item.relative)) {
      externalAssets.push({ path: item.relative, bytes: item.size, sha256: item.sha256 });
    }
  } else {
    deploymentEntries[item.relative] = entry;
  }
}

const routePrefix = [collection, courseId].filter(Boolean).join('/');
const deploymentManifest = { ...manifest, assetBase: `/courses/${routePrefix}/` };
deploymentEntries['manifest.json'] = new TextEncoder().encode(`${JSON.stringify(deploymentManifest, null, 2)}\n`);
// full 备份是便携包,受加载器 1GB 上限约束;超限时跳过(超限包在浏览器本也无法加载),
// 分离部署包(媒体走 assetBase 外置)不受此限,仍照常交付。
const fullArchive = fullEntries ? zipSync(fullEntries, { level: 9 }) : null;
const fullTooLarge = backupPlan.skip || fullArchive.byteLength > MAX_PORTABLE_BYTES;
const deploymentArchive = zipSync(deploymentEntries, { level: 9 });

const outputRoot = path.join(ROOT, 'dist-courses', ...(collection ? [collection] : []));
const outputDir = path.join(outputRoot, courseId);
if (!outputDir.startsWith(`${outputRoot}${path.sep}`)) throw new Error('Refusing unsafe output path.');
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
const fullPath = path.join(outputRoot, `${courseId}.full.pigeon`);
const deploymentPath = path.join(outputDir, `${courseId}.pigeon`);
const webDeploymentPath = path.join(outputDir, `${courseId}.web.pigeon.zip`);
if (!fullTooLarge) writeFileSync(fullPath, fullArchive);
else rmSync(fullPath, { force: true });
writeFileSync(deploymentPath, deploymentArchive);
// Cloudflare 默认不缓存自定义 .pigeon 扩展名；同字节 .zip 别名供 web registry 使用。
writeFileSync(webDeploymentPath, deploymentArchive);

for (const asset of externalAssets) {
  const source = sourceInventory.find((item) => item.relative === asset.path)?.file;
  if (!source) throw new Error(`External asset source is missing: ${asset.path}`);
  const target = path.join(outputDir, asset.path);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { force: true });
}

const report = {
  schemaVersion: 2,
  collection: collection || null,
  courseId,
  title: manifest.title,
  source: relativeTo(ROOT, courseDir),
  sourceFiles: sourceInventory.map(({ relative, size, sha256: hash, derived }) => ({ path: relative, bytes: size, sha256: hash, ...(derived ? { derived } : {}) })),
  resourceClosure: { references: references.length, missing: [], external: [] },
  deployment: {
    package: relativeTo(ROOT, deploymentPath),
    webPackage: relativeTo(ROOT, webDeploymentPath),
    bytes: deploymentArchive.byteLength,
    sha256: sha256(deploymentArchive),
    assetBase: deploymentManifest.assetBase,
    externalAssets,
  },
  backup: fullTooLarge
    ? {
      skipped: true,
      reason: backupPlan.skip
        ? `stored-file lower bound ${backupPlan.storedLowerBoundBytes} bytes exceeds ${MAX_PORTABLE_BYTES} loader limit`
        : `full archive ${fullArchive.byteLength} bytes exceeds ${MAX_PORTABLE_BYTES} loader limit`,
      loaderLimitBytes: MAX_PORTABLE_BYTES,
    }
    : {
      package: relativeTo(ROOT, fullPath),
      bytes: fullArchive.byteLength,
      sha256: sha256(fullArchive),
      loaderLimitBytes: MAX_PORTABLE_BYTES,
    },
};
writeFileSync(path.join(outputDir, 'delivery-manifest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
cleanupDerivatives();
process.removeListener('exit', cleanupDerivatives);
console.log(JSON.stringify({
  courseId,
  collection: collection || null,
  externalAssets: externalAssets.length,
  deployment: report.deployment.package,
  backup: fullTooLarge ? 'skipped(>1GB)' : report.backup.package,
}));
