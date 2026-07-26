import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKBENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(WORKBENCH, 'reports');
const DETAILS = path.join(REPORTS, 'activity-details');
const OUTPUT = path.join(REPORTS, 'activity-resource-inventory.json');

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function usableReference(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed || /^(?:#|javascript:|mailto:|tel:)/i.test(trimmed)) return '';
  return trimmed;
}

function inspect(html) {
  const tags = [...html.matchAll(/<[^>]+>/g)].map((match) => match[0]);
  const attributes = tags.flatMap((tag) => [...tag.matchAll(/\b(?:src|href|poster|data)=(["'])(.*?)\1/gi)])
    .map((match) => usableReference(match[2]));
  const srcsets = tags.flatMap((tag) => [...tag.matchAll(/\bsrcset=(["'])(.*?)\1/gi)])
    .flatMap((match) => match[2].split(',').map((candidate) => usableReference(candidate.trim().split(/\s+/)[0])));
  const cssUrls = [...html.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)]
    .map((match) => usableReference(match[2]));
  const dynamicEndpoints = [...html.matchAll(/["']([^"']+\.php(?:\?[^"']*)?)["']/gi)]
    .map((match) => usableReference(match[1]));
  const resources = unique([...attributes, ...srcsets, ...cssUrls]);
  const media = resources.filter((value) => /\.(?:mp4|m4v|mov|webm|ogg|vtt)(?:\?|$)/i.test(value));
  const dynamicMedia = unique(dynamicEndpoints.filter((value) => /(?:PlayVideo|videoId)/i.test(value)));
  return {
    resources,
    media,
    dynamicEndpoints: unique(dynamicEndpoints),
    dynamicMedia,
    requiresDynamicMediaCapture: dynamicMedia.length > 0,
  };
}

const pages = readdirSync(DETAILS)
  .filter((name) => name.endsWith('.json'))
  .sort((a, b) => a.localeCompare(b, 'en'))
  .map((metadataFile) => {
    const metadata = JSON.parse(readFileSync(path.join(DETAILS, metadataFile), 'utf8'));
    const htmlFile = metadata.rawHtmlFile;
    const htmlPath = path.join(DETAILS, htmlFile || '');
    const htmlBytes = htmlFile && statSync(htmlPath, { throwIfNoEntry: false })?.size;
    if (!htmlBytes) throw new Error(`Missing or empty raw HTML for ${metadataFile}: ${htmlFile || '(none)'}`);
    const resourceState = inspect(readFileSync(htmlPath, 'utf8'));
    return {
      key: `${metadata.scoreType}:${metadata.scoreNumber}:${metadata.subIndex}`,
      activity: metadata.activity,
      label: metadata.label,
      chapterIndex: metadata.chapterIndex,
      sectionIndex: metadata.sectionIndex,
      scoreType: metadata.scoreType,
      scoreNumber: metadata.scoreNumber,
      subIndex: metadata.subIndex,
      metadataFile,
      htmlFile,
      htmlBytes,
      ...resourceState,
    };
  });

const report = {
  schemaVersion: 1,
  source: 'reports/activity-details raw HTML snapshots',
  pageCount: pages.length,
  activityCount: new Set(pages.map((page) => `${page.scoreType}:${page.scoreNumber}`)).size,
  resourceReferenceCount: pages.reduce((sum, page) => sum + page.resources.length, 0),
  directMediaReferenceCount: pages.reduce((sum, page) => sum + page.media.length, 0),
  dynamicMediaPageCount: pages.filter((page) => page.requiresDynamicMediaCapture).length,
  pages,
};

writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  output: path.relative(WORKBENCH, OUTPUT).replace(/\\/g, '/'),
  pages: report.pageCount,
  activities: report.activityCount,
  resourceReferences: report.resourceReferenceCount,
  directMediaReferences: report.directMediaReferenceCount,
  dynamicMediaPages: report.dynamicMediaPageCount,
}));
