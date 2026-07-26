#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { requireDevicesCanvasRendererSource } from '../lib/devices-canvas-renderers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const captureRelative = 'tools/autosmt-2026/reports/runtime-response-capture-v1.json';
const capturePath = path.join(ROOT, captureRelative);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const valueHash = (value) => sha256(typeof value === 'string' ? value : JSON.stringify(value));
const expected = {
  'drawing-22-0': { collection: 'czndjs', scoreNumber: 22, sourceLocation: '/czndjs', count: 81, chapterIndex: 1, sectionIndex: 0, rawHtmlFile: '1-0-experiment-22-tab-0.html', action: 'CZNDJS' },
  'drawing-33-0': { collection: 'drawings', scoreNumber: 33, sourceLocation: '/drawings/0', count: 1, chapterIndex: 1, sectionIndex: 6, rawHtmlFile: '1-6-experiment-33-tab-0.html', action: 'LD' },
  'drawing-34-0': { collection: 'drawings', scoreNumber: 34, sourceLocation: '/drawings/1', count: 1, chapterIndex: 1, sectionIndex: 6, rawHtmlFile: '1-6-experiment-34-tab-0.html', action: 'LD' },
};

function pointerValue(value, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error(`sourcePointer is not a JSON pointer: ${pointer}`);
  let current = value;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || current === undefined || !Object.hasOwn(current, key)) throw new Error(`sourcePointer does not resolve: ${pointer}`);
    current = current[key];
  }
  return current;
}

function targetValue(content, target) {
  const prefix = 'content.json#';
  if (typeof target !== 'string' || !target.startsWith(prefix)) throw new Error(`runtime ledger target is not a content JSON pointer: ${target}`);
  return pointerValue(content, target.slice(prefix.length));
}

function sandboxTargets(content) {
  const found = new Map(Object.keys(expected).map((id) => [id, []]));
  function visit(value, parts) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'sandbox' && found.has(value.id) && typeof value.html === 'string') {
      found.get(value.id).push({ target: `content.json#/${[...parts, 'html'].join('/')}`, html: value.html });
    }
    for (const [key, child] of Object.entries(value)) visit(child, [...parts, key]);
  }
  visit(content, []);
  return found;
}

function validateLocation(record, descriptor, id, errors) {
  const activity = record?.activity;
  if (!activity || activity.scoreType !== 'experiment' || Number(activity.scoreNumber) !== descriptor.scoreNumber || Number(activity.chapterIndex) !== descriptor.chapterIndex || Number(activity.sectionIndex) !== descriptor.sectionIndex || Number(activity.subIndex) !== 0 || activity.rawHtmlFile !== descriptor.rawHtmlFile) {
    errors.push(`${id}: capture activity location is not the expected score context`);
  }
  if (record?.request?.flag !== descriptor.action) errors.push(`${id}: capture action is not ${descriptor.action}`);
}

function validateResponse(record, descriptor, id, errors) {
  const response = record?.response;
  if (!response || typeof response.raw !== 'string' || typeof response.sha256 !== 'string') {
    errors.push(`${id}: capture response is incomplete`);
    return;
  }
  if (sha256(response.raw) !== response.sha256) errors.push(`${id}: response SHA-256 does not match raw response`);
  let parsed;
  try { parsed = JSON.parse(response.raw); } catch { errors.push(`${id}: response raw is not JSON`); return; }
  if (!isDeepStrictEqual(parsed, response.value)) errors.push(`${id}: response JSON does not match captured value`);
  if (descriptor.action === 'CZNDJS') {
    if (!Array.isArray(parsed) || parsed.length !== 4 || !Array.isArray(response.numericValue) || response.numericValue.length !== 4) {
      errors.push(`${id}: CZNDJS response must have four values`);
    } else {
      parsed.forEach((value, index) => {
        if (!Number.isFinite(Number(value)) || response.numericValue[index] !== Number(value)) errors.push(`${id}: CZNDJS numericValue mismatch at ${index}`);
      });
    }
  } else if (!Array.isArray(parsed) || !parsed.length) {
    errors.push(`${id}: LD response must be a non-empty rectangle array`);
  } else {
    for (const rectangle of parsed) {
      if (!Array.isArray(rectangle) || rectangle.length !== 5 || typeof rectangle[0] !== 'string' || !rectangle[0].trim() || !rectangle.slice(1).every((item) => typeof item === 'number' && Number.isFinite(item)) || rectangle[3] <= 0 || rectangle[4] <= 0) {
        errors.push(`${id}: LD response contains an invalid rectangle`);
        break;
      }
    }
  }
}

function verify(courseArgument) {
  const errors = [];
  const courseDir = path.resolve(ROOT, courseArgument);
  const contentPath = path.join(courseDir, 'content.json');
  const ledgerPath = path.join(courseDir, 'source-ledger.json');
  if (!existsSync(contentPath) || !existsSync(ledgerPath)) return [`course is missing content.json or source-ledger.json: ${courseDir}`];
  let content; let ledger; let capture;
  try { content = JSON.parse(readFileSync(contentPath, 'utf8')); ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')); capture = JSON.parse(readFileSync(capturePath, 'utf8')); } catch (error) { return [`JSON load failed: ${error.message}`]; }
  const targets = sandboxTargets(content);
  const entries = (ledger.entries || []).filter((entry) => entry?.kind === 'runtime-response-sandbox');
  const captureSha256 = sha256(readFileSync(capturePath));
  const ldHashes = new Set();
  let evidenceCount = 0;
  for (const [id, descriptor] of Object.entries(expected)) {
    const sandboxes = targets.get(id) || [];
    if (sandboxes.length !== 1) { errors.push(`${id}: expected one sandbox HTML target, found ${sandboxes.length}`); continue; }
    const matches = entries.filter((entry) => entry.target === sandboxes[0].target);
    if (matches.length !== 1) { errors.push(`${id}: expected one runtime-response-sandbox ledger entry, found ${matches.length}`); continue; }
    const entry = matches[0];
    let actualHtml;
    try { actualHtml = targetValue(content, entry.target); } catch (error) { errors.push(`${id}: ${error.message}`); continue; }
    if (typeof actualHtml !== 'string' || actualHtml !== sandboxes[0].html) errors.push(`${id}: target does not resolve to the sandbox HTML string`);
    if (!actualHtml.includes(`data-drawing-id="${id}"`)) errors.push(`${id}: sandbox HTML is missing its data-drawing-id`);
    if (entry.sourceFile !== captureRelative || entry.sourceSha256 !== captureSha256 || entry.sourceLocation !== descriptor.sourceLocation) errors.push(`${id}: source file, hash, or location is incorrect`);
    if (entry.targetValueSha256 !== valueHash(actualHtml)) errors.push(`${id}: targetValueSha256 does not match sandbox HTML`);
    if (/lastAttempt/i.test(JSON.stringify(entry))) errors.push(`${id}: ledger entry must not use lastAttempt`);
    const embedded = entry.embeddedEvidence;
    if (!Array.isArray(embedded) || embedded.length !== descriptor.count) { errors.push(`${id}: expected ${descriptor.count} embedded evidence records`); continue; }
    const pointers = new Set();
    const combinations = new Set();
    for (const evidence of embedded) {
      evidenceCount += 1;
      if (!evidence || typeof evidence.sourcePointer !== 'string' || !evidence.sourcePointer.startsWith(`/${descriptor.collection}/`)) { errors.push(`${id}: embedded sourcePointer has the wrong collection`); continue; }
      if (pointers.has(evidence.sourcePointer)) errors.push(`${id}: embedded sourcePointer is duplicated`);
      pointers.add(evidence.sourcePointer);
      let record;
      try { record = pointerValue(capture, evidence.sourcePointer); } catch (error) { errors.push(`${id}: ${error.message}`); continue; }
      if (evidence.sourceValueSha256 !== valueHash(record)) errors.push(`${id}: embedded sourceValueSha256 does not match ${evidence.sourcePointer}`);
      if (evidence.responseSha256 !== record?.response?.sha256) errors.push(`${id}: embedded responseSha256 does not match ${evidence.sourcePointer}`);
      validateLocation(record, descriptor, id, errors);
      validateResponse(record, descriptor, id, errors);
      if (descriptor.action === 'CZNDJS') combinations.add(`${record?.request?.data1}:${record?.request?.data2}`);
      else ldHashes.add(record?.response?.sha256);
    }
    if (descriptor.action === 'CZNDJS') {
      for (let data1 = 1; data1 <= 9; data1 += 1) for (let data2 = 1; data2 <= 9; data2 += 1) {
        if (!combinations.has(`${data1}:${data2}`)) errors.push(`${id}: missing CZNDJS combination ${data1}:${data2}`);
      }
    }
    try {
      const renderer = requireDevicesCanvasRendererSource(id);
      if (!sandboxes[0].html.includes(renderer)) errors.push(`${id}: sandbox HTML does not embed the response-derived renderer`);
      const colors = descriptor.action === 'LD' ? (capture[descriptor.collection] || []).filter((record) => Number(record?.activity?.scoreNumber) === descriptor.scoreNumber).flatMap((record) => record.response.value.map((rectangle) => rectangle[0])) : [];
      if (colors.some((color) => sandboxes[0].html.includes(color)) || /(?:rgb\(|#[0-9a-f]{3,8}\b)/i.test(sandboxes[0].html)) errors.push(`${id}: sandbox HTML contains source RGB or hex colors`);
    } catch (error) { errors.push(`${id}: renderer validation failed: ${error.message}`); }
  }
  if (ldHashes.size !== 2) errors.push('LD response hashes for experiments 33 and 34 must differ');
  if (entries.length !== 3) errors.push(`expected exactly three runtime-response-sandbox ledger entries, found ${entries.length}`);
  return { errors, evidenceCount };
}

const [courseArgument] = process.argv.slice(2);
if (!courseArgument || process.argv.length !== 3) {
  console.error('Usage: node tools/autosmt-2026/scripts/verify-devices-runtime-ledger.mjs <course-dir>');
  process.exitCode = 2;
} else {
  const result = verify(courseArgument);
  if (result.errors.length) {
    console.error('Devices runtime response ledger verification failed:');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Runtime response ledger verification passed: 3 sandboxes, ${result.evidenceCount} response records.`);
  }
}
