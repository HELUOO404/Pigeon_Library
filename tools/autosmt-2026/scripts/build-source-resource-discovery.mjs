import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKBENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(WORKBENCH, 'reports');
const ROOTS = [
  path.join(REPORTS, 'source-capture', 'sections'),
  path.join(REPORTS, 'source-capture', 'resources'),
  path.join(REPORTS, 'activity-details'),
];
const OUTPUT = path.join(REPORTS, 'source-capture', 'resource-discovery.json');

if (process.argv.includes('--selftest')) {
  assert.equal(decodeHtmlBytes(Buffer.from('<meta charset="gb2312">\xd6\xd0', 'binary')), '<meta charset="gb2312">中');
  assert.equal(resolveResourceUrl('lesson.files/image.png', '../Html/lesson.html'), '/AUTOCE_V152ZY/Html/lesson.files/image.png');
  assert.equal(resolveResourceUrl('other.html', '../Html/lesson.html'), '../Html/other.html');
  console.log('source-resource-discovery: ok');
  process.exit(0);
}

function walk(directory) {
  const stat = statSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function usable(value) {
  const result = String(value || '').trim();
  return result && !/^(?:#|javascript:|data:|blob:|mailto:|tel:)/i.test(result) ? result : '';
}

function decodeHtmlBytes(bytes) {
  const declaration = Buffer.from(bytes).subarray(0, 2048).toString('latin1');
  const charset = declaration.match(/charset\s*=\s*["']?\s*([a-z0-9._-]+)/i)?.[1]?.toLowerCase();
  return new TextDecoder(/^(?:gb2312|gbk|gb18030)$/.test(charset || '') ? 'gb18030' : 'utf-8').decode(bytes);
}

function resolveResourceUrl(ref, baseUrl) {
  if (!baseUrl || /^(?:https?:|\/\/|\/)/i.test(ref)) return ref;
  const resolved = new URL(ref, new URL(baseUrl, 'http://autosmt.local/AUTOCE_V152ZY/php/Submission.php'));
  const theory = /^\/AUTOCE_V152ZY\/Html\/([^/?]+\.html)$/i.exec(resolved.pathname);
  if (theory) {
    try {
      return `../Html/${decodeURIComponent(theory[1])}${resolved.search}`;
    } catch {
      return `../Html/${theory[1]}${resolved.search}`;
    }
  }
  return `${resolved.pathname}${resolved.search}`;
}

function theorySourceUrls() {
  const sources = new Map();
  for (const name of readdirSync(REPORTS).filter((file) => /^resource-capture-theory(?:[-.].*)?\.json$/i.test(file))) {
    const captured = JSON.parse(readFileSync(path.join(REPORTS, name), 'utf8')).captured || {};
    for (const [url, entry] of Object.entries(captured)) {
      if (typeof entry?.file === 'string') sources.set(`source-capture/${entry.file.replace(/\\/g, '/')}`, url);
    }
  }
  return sources;
}

function refs(html, baseUrl) {
  const tags = [...String(html).matchAll(/<[^>]+>/g)].map((match) => match[0]);
  const attributes = tags.flatMap((tag) => [...tag.matchAll(/\b(?:src|href|poster|data)=(['"])(.*?)\1/gi)])
    .map((match) => usable(match[2]));
  const srcsets = tags.flatMap((tag) => [...tag.matchAll(/\bsrcset=(['"])(.*?)\1/gi)])
    .flatMap((match) => match[2].split(',').map((item) => usable(item.trim().split(/\s+/)[0])));
  const css = [...String(html).matchAll(/url\(\s*(['"]?)([^"')]+)\1\s*\)/gi)].map((match) => usable(match[2]));
  const dynamic = [...String(html).matchAll(/(?:src|data)\s*=\s*['"]([^'"]*PlayVideo\.php\?videoId=[^'"]+)['"]/gi)].map((match) => usable(match[1]));
  const scripts = [...String(html).matchAll(/(?:src|data)\s*=\s*['"]([^'"]+\.php\?[^'"]+)['"]/gi)].map((match) => usable(match[1]));
  const theory = [...String(html).matchAll(/var\s+strllzs\s*=\s*['"]([^'"]*)['"]/gi)]
    .flatMap((match) => match[1].split('|').map((name) => name.trim()).filter(Boolean).map((name) => `../Html/${name}.html`));
  const lectureVideos = [...String(html).matchAll(/var\s+strvideonum\s*=\s*['"]([^'"]*)['"]/gi)]
    .flatMap((match) => match[1].split('|').map((id) => id.trim()).filter(Boolean).map((id) => `PlayVideo.php?videoId=${id}`));
  const safeAttributes = attributes.filter((item) => !/["']?\+\s*array/i.test(item));
  return [...new Set([...safeAttributes, ...srcsets, ...css, ...dynamic, ...scripts, ...theory, ...lectureVideos]
    .filter(Boolean)
    .map((ref) => resolveResourceUrl(ref, baseUrl)))].sort();
}

const pages = ROOTS.flatMap(walk).filter((file) => /\.html$/i.test(file));
const referers = new Map();
const theorySources = theorySourceUrls();
for (const file of pages) {
  const relative = path.relative(REPORTS, file).replace(/\\/g, '/');
  for (const ref of refs(decodeHtmlBytes(readFileSync(file)), theorySources.get(relative))) {
    const items = referers.get(ref) || [];
    items.push(relative);
    referers.set(ref, items);
  }
}
const resources = [...referers.entries()].map(([url, sourcePages]) => ({ url, sourcePages: [...new Set(sourcePages)].sort() }))
  .sort((left, right) => left.url.localeCompare(right.url));
const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  pageCount: pages.length,
  resourceCount: resources.length,
  dynamicVideoCount: resources.filter((item) => /PlayVideo\.php\?videoId=/i.test(item.url)).length,
  resources,
};
writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: path.relative(WORKBENCH, OUTPUT).replace(/\\/g, '/'), pageCount: report.pageCount, resourceCount: report.resourceCount, dynamicVideoCount: report.dynamicVideoCount }));
