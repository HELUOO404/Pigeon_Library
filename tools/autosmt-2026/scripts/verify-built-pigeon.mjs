#!/usr/bin/env node
// Re-validates a built .pigeon archive, including the source ledger, before release.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '../../..');
const require = createRequire(import.meta.url);
const { unzipSync } = require(join(root, 'app', 'node_modules', 'fflate'));
const utf8 = new TextDecoder('utf-8', { fatal: true });
const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function within(base, candidate) {
  const delta = relative(base, candidate);
  return delta === '' || (!delta.startsWith(`..${sep}`) && delta !== '..' && !isAbsolute(delta));
}

function u16(bytes, offset) {
  return bytes.readUInt16LE(offset);
}

function u32(bytes, offset) {
  return bytes.readUInt32LE(offset);
}

function zipEntryName(raw) {
  let name;
  try {
    name = utf8.decode(raw);
  } catch {
    fail('ZIP entry name is not valid UTF-8');
  }
  if (!name || name.includes('\0') || name.includes('\\')) fail(`unsafe ZIP entry path: ${JSON.stringify(name)}`);
  const directory = name.endsWith('/');
  const bare = directory ? name.slice(0, -1) : name;
  if (!bare || bare.startsWith('/') || /^[A-Za-z]:/.test(bare)) fail(`unsafe ZIP entry path: ${JSON.stringify(name)}`);
  const parts = bare.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail(`unsafe ZIP entry path: ${JSON.stringify(name)}`);
  return { name, normalized: bare, directory };
}

// Inspect the central directory before passing data to the unzip library. unzipSync's
// object result cannot expose duplicate entries after one has overwritten another.
function inspectZip(bytes) {
  if (bytes.length < 22) fail('not a ZIP archive: missing end-of-central-directory record');
  const minimum = Math.max(0, bytes.length - 0xffff - 22);
  let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (u32(bytes, offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) fail('not a ZIP archive: end-of-central-directory record not found');
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) fail('multi-disk ZIP archives are not supported');
  const count = u16(bytes, eocd + 10);
  const centralSize = u32(bytes, eocd + 12);
  const centralOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('ZIP64 archives are not supported');
  if (centralOffset + centralSize > bytes.length) fail('ZIP central directory is outside the archive');

  let cursor = centralOffset;
  let unpackedBytes = 0;
  const entries = [];
  const exact = new Set();
  const windowsSafe = new Set();
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > centralOffset + centralSize || u32(bytes, cursor) !== 0x02014b50) fail(`invalid central-directory entry ${index}`);
    const flags = u16(bytes, cursor + 8);
    const uncompressedSize = u32(bytes, cursor + 24);
    const nameLength = u16(bytes, cursor + 28);
    const extraLength = u16(bytes, cursor + 30);
    const commentLength = u16(bytes, cursor + 32);
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > centralOffset + centralSize) fail(`truncated central-directory entry ${index}`);
    if (flags & 1) fail(`encrypted ZIP entry is not allowed: entry ${index}`);
    const entry = zipEntryName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (exact.has(entry.name) || windowsSafe.has(entry.normalized.toLowerCase())) fail(`duplicate ZIP entry: ${entry.name}`);
    exact.add(entry.name);
    windowsSafe.add(entry.normalized.toLowerCase());
    if (!entry.directory) {
      unpackedBytes += uncompressedSize;
      if (unpackedBytes > MAX_UNCOMPRESSED_BYTES) fail('ZIP uncompressed size exceeds 1 GiB limit');
    }
    entries.push(entry);
    cursor = entryEnd;
  }
  if (cursor !== centralOffset + centralSize) fail('ZIP central directory has trailing or unaccounted bytes');
  return entries;
}

function duplicateJsonKeys(text, name, errors) {
  let cursor = 0;
  const whitespace = /\s/;
  function skip() { while (whitespace.test(text[cursor] || '')) cursor += 1; }
  function string() {
    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < text.length) {
      const char = text[cursor++];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') return JSON.parse(text.slice(start, cursor));
      if (char < ' ') fail(`${name}: invalid control character in JSON string`);
    }
    fail(`${name}: unterminated JSON string`);
  }
  function value() {
    skip();
    if (text[cursor] === '{') {
      cursor += 1;
      skip();
      const keys = new Set();
      if (text[cursor] === '}') { cursor += 1; return; }
      while (true) {
        skip();
        if (text[cursor] !== '"') fail(`${name}: invalid JSON object key`);
        const key = string();
        if (keys.has(key)) errors.push(`${name}: duplicate JSON object key ${JSON.stringify(key)}`);
        keys.add(key);
        skip();
        if (text[cursor++] !== ':') fail(`${name}: invalid JSON object separator`);
        value();
        skip();
        if (text[cursor] === '}') { cursor += 1; return; }
        if (text[cursor++] !== ',') fail(`${name}: invalid JSON object separator`);
      }
    }
    if (text[cursor] === '[') {
      cursor += 1;
      skip();
      if (text[cursor] === ']') { cursor += 1; return; }
      while (true) {
        value();
        skip();
        if (text[cursor] === ']') { cursor += 1; return; }
        if (text[cursor++] !== ',') fail(`${name}: invalid JSON array separator`);
      }
    }
    if (text[cursor] === '"') { string(); return; }
    const start = cursor;
    while (cursor < text.length && !/[\s,\]\}]/.test(text[cursor])) cursor += 1;
    JSON.parse(text.slice(start, cursor));
  }
  value();
  skip();
  if (cursor !== text.length) fail(`${name}: trailing JSON data`);
}

function readJson(courseDir, name, errors) {
  const path = join(courseDir, name);
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch {
    errors.push(`missing required ${name}`);
    return null;
  }
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    errors.push(`${name}: UTF-8 BOM is not allowed`);
    return null;
  }
  let text;
  try {
    text = utf8.decode(bytes);
  } catch {
    errors.push(`${name}: must be valid UTF-8`);
    return null;
  }
  try {
    duplicateJsonKeys(text, name, errors);
    return JSON.parse(text);
  } catch (error) {
    errors.push(`${name}: invalid JSON (${error.message})`);
    return null;
  }
}

function object(value, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label}: expected an object`);
    return false;
  }
  return true;
}

function nonEmptyString(value, label, errors) {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${label}: expected a non-empty string`);
    return false;
  }
  return true;
}

function uniqueId(set, id, label, errors) {
  if (!nonEmptyString(id, label, errors)) return;
  if (set.has(id)) errors.push(`${label}: duplicate ID ${id}`);
  set.add(id);
}

function validateManifest(manifest, errors) {
  if (!object(manifest, 'manifest.json', errors)) return { chapters: new Set(), sections: new Set(), knowledgePoints: new Set(), interactionIds: new Set() };
  if (manifest.schemaVersion !== 1) errors.push('manifest.json: schemaVersion must be 1');
  nonEmptyString(manifest.id, 'manifest.json.id', errors);
  nonEmptyString(manifest.title, 'manifest.json.title', errors);
  if (!Array.isArray(manifest.chapters) || manifest.chapters.length === 0) errors.push('manifest.json.chapters: expected a non-empty array');
  const chapters = new Set();
  const sections = new Set();
  const knowledgePoints = new Set();
  for (const [chapterIndex, chapter] of (manifest.chapters || []).entries()) {
    const chapterLabel = `manifest.json.chapters[${chapterIndex}]`;
    if (!object(chapter, chapterLabel, errors)) continue;
    uniqueId(chapters, chapter.id, `${chapterLabel}.id`, errors);
    nonEmptyString(chapter.title, `${chapterLabel}.title`, errors);
    if (!Array.isArray(chapter.sections)) { errors.push(`${chapterLabel}.sections: expected an array`); continue; }
    for (const [sectionIndex, section] of chapter.sections.entries()) {
      const sectionLabel = `${chapterLabel}.sections[${sectionIndex}]`;
      if (!object(section, sectionLabel, errors)) continue;
      uniqueId(sections, section.id, `${sectionLabel}.id`, errors);
      nonEmptyString(section.title, `${sectionLabel}.title`, errors);
      if (!Array.isArray(section.knowledgePoints)) { errors.push(`${sectionLabel}.knowledgePoints: expected an array`); continue; }
      for (const [pointIndex, point] of section.knowledgePoints.entries()) {
        const pointLabel = `${sectionLabel}.knowledgePoints[${pointIndex}]`;
        if (!object(point, pointLabel, errors)) continue;
        uniqueId(knowledgePoints, point.id, `${pointLabel}.id`, errors);
        nonEmptyString(point.title, `${pointLabel}.title`, errors);
      }
    }
  }
  if (manifest.stats !== undefined) {
    if (!object(manifest.stats, 'manifest.json.stats', errors)) return { chapters, sections, knowledgePoints, interactionIds: new Set() };
    for (const [field, actual] of [['chapters', chapters.size], ['knowledgePoints', knowledgePoints.size]]) {
      if (manifest.stats[field] !== undefined && manifest.stats[field] !== actual) errors.push(`manifest.json.stats.${field}: expected ${actual}`);
    }
  }
  return { chapters, sections, knowledgePoints, interactionIds: new Set() };
}

function validateTableCell(cell, label, errors) {
  if (typeof cell === 'string' || typeof cell === 'number') return;
  if (!object(cell, label, errors)) return;
  if (Object.hasOwn(cell, 'image') && Object.hasOwn(cell, 'images')) {
    errors.push(`${label}: image and images cannot be used together`);
  }
  if (Object.hasOwn(cell, 'image')) {
    if (!object(cell.image, `${label}.image`, errors)) return;
    nonEmptyString(cell.image.src, `${label}.image.src`, errors);
    if (cell.image.alt !== undefined && typeof cell.image.alt !== 'string') errors.push(`${label}.image.alt: expected a string`);
  }
  if (Object.hasOwn(cell, 'images')) {
    if (!Array.isArray(cell.images) || cell.images.length === 0) {
      errors.push(`${label}.images: expected a non-empty array`);
    } else {
      cell.images.forEach((image, index) => {
        const imageLabel = `${label}.images[${index}]`;
        if (!object(image, imageLabel, errors)) return;
        nonEmptyString(image.src, `${imageLabel}.src`, errors);
        if (image.alt !== undefined && typeof image.alt !== 'string') errors.push(`${imageLabel}.alt: expected a string`);
      });
    }
  }
  for (const key of ['rowspan', 'colspan']) {
    if (cell[key] !== undefined && (!Number.isInteger(cell[key]) || cell[key] < 1)) errors.push(`${label}.${key}: expected a positive integer`);
  }
}

function validateParamsTable(block, label, errors) {
  if (!Array.isArray(block.headers)) errors.push(`${label}.headers: expected an array`);
  else block.headers.forEach((cell, index) => validateTableCell(cell, `${label}.headers[${index}]`, errors));
  if (!Array.isArray(block.rows)) errors.push(`${label}.rows: expected an array`);
  else block.rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) { errors.push(`${label}.rows[${rowIndex}]: expected an array`); return; }
    row.forEach((cell, cellIndex) => validateTableCell(cell, `${label}.rows[${rowIndex}][${cellIndex}]`, errors));
  });
}

function validateParam(block, label, errors) {
  if (!object(block, label, errors)) return;
  nonEmptyString(block.label, `${label}.label`, errors);
  if (!Array.isArray(block.options) || block.options.length === 0 || block.options.some((option) => typeof option !== 'string' || !option.trim())) {
    errors.push(`${label}.options: expected a non-empty string array`);
  }
  if (!Number.isInteger(block.answerIndex) || block.answerIndex < 1 || block.answerIndex > (block.options?.length || 0)) {
    errors.push(`${label}.answerIndex: expected a 1-based option index`);
  }
}

function validateParamSelect(block, label, errors) {
  const groups = Array.isArray(block.groups) ? block.groups : [];
  const matrixRows = Array.isArray(block.matrixRows) ? block.matrixRows : [];
  if ((groups.length > 0) === (matrixRows.length > 0)) {
    errors.push(`${label}: exactly one of groups or matrixRows must be non-empty`);
    return;
  }
  if (groups.length) {
    groups.forEach((group, groupIndex) => {
      const groupLabel = `${label}.groups[${groupIndex}]`;
      if (!object(group, groupLabel, errors)) return;
      if (!Array.isArray(group.params) || group.params.length === 0) errors.push(`${groupLabel}.params: expected a non-empty array`);
      else group.params.forEach((param, paramIndex) => validateParam(param, `${groupLabel}.params[${paramIndex}]`, errors));
    });
    return;
  }
  if (block.headers !== undefined && (!Array.isArray(block.headers) || block.headers.length === 0
    || block.headers.some((header) => typeof header !== 'string' || !header.trim()))) {
    errors.push(`${label}.headers: expected a non-empty string array when present`);
  }
  let controlCount = 0;
  matrixRows.forEach((row, rowIndex) => {
    const rowLabel = `${label}.matrixRows[${rowIndex}]`;
    if (!object(row, rowLabel, errors)) return;
    if (!Array.isArray(row.cells) || row.cells.length === 0) {
      errors.push(`${rowLabel}.cells: expected a non-empty array`);
      return;
    }
    row.cells.forEach((cell, cellIndex) => {
      const cellLabel = `${rowLabel}.cells[${cellIndex}]`;
      if (!object(cell, cellLabel, errors)) return;
      if (Array.isArray(cell.content)) {
        if (!['th', 'td'].includes(cell.tag)) errors.push(`${cellLabel}.tag: expected th or td`);
        if (cell.scope !== undefined && (cell.tag !== 'th' || !['row', 'col'].includes(cell.scope))) {
          errors.push(`${cellLabel}.scope: expected row or col on a th cell`);
        }
        for (const key of ['rowspan', 'colspan']) {
          if (cell[key] !== undefined && (!Number.isInteger(cell[key]) || cell[key] < 1)) errors.push(`${cellLabel}.${key}: expected a positive integer`);
        }
        cell.content.forEach((part, partIndex) => {
          const partLabel = `${cellLabel}.content[${partIndex}]`;
          if (!object(part, partLabel, errors)) return;
          if (part.type === 'text') nonEmptyString(part.text, `${partLabel}.text`, errors);
          else if (part.type === 'control') {
            controlCount += 1;
            validateParam(part, partLabel, errors);
          } else errors.push(`${partLabel}.type: expected text or control`);
        });
        if (cell.tag === 'th' && cell.content.length === 0) errors.push(`${cellLabel}.content: th cells must not be empty`);
        return;
      }
      const hasText = Object.hasOwn(cell, 'text');
      const hasParam = Object.hasOwn(cell, 'param');
      if (hasText === hasParam) { errors.push(`${cellLabel}: exactly one of text or param is required`); return; }
      if (hasText) nonEmptyString(cell.text, `${cellLabel}.text`, errors);
      else {
        controlCount += 1;
        validateParam(cell.param, `${cellLabel}.param`, errors);
      }
    });
  });
  if (controlCount === 0) errors.push(`${label}.matrixRows: expected at least one control`);
}

function collectBlockIds(blocks, label, interactionIds, errors) {
  if (!Array.isArray(blocks)) { errors.push(`${label}: expected an array`); return; }
  for (const [index, block] of blocks.entries()) {
    const blockLabel = `${label}[${index}]`;
    if (!object(block, blockLabel, errors)) continue;
    nonEmptyString(block.type, `${blockLabel}.type`, errors);
    if (block.type === 'paramsTable') validateParamsTable(block, blockLabel, errors);
    if (block.type === 'paramSelect') validateParamSelect(block, blockLabel, errors);
    if (['tabSet', 'sandbox', 'paramSelect', 'stepSimulation'].includes(block.type)) uniqueId(interactionIds, block.id, `${blockLabel}.id`, errors);
    if (block.type === 'tabSet') {
      if (!Array.isArray(block.tabs) || block.tabs.length === 0) { errors.push(`${blockLabel}.tabs: expected a non-empty array`); continue; }
      const tabIds = new Set();
      for (const [tabIndex, tab] of block.tabs.entries()) {
        const tabLabel = `${blockLabel}.tabs[${tabIndex}]`;
        if (!object(tab, tabLabel, errors)) continue;
        uniqueId(tabIds, tab.id, `${tabLabel}.id`, errors);
        nonEmptyString(tab.label, `${tabLabel}.label`, errors);
        collectBlockIds(tab.blocks, `${tabLabel}.blocks`, interactionIds, errors);
      }
    }
  }
}

function validateContent(content, index, errors) {
  if (!object(content, 'content.json', errors)) return;
  for (const key of ['overviews', 'knowledgePoints']) {
    if (!object(content[key], `content.json.${key}`, errors)) continue;
  }
  for (const [sectionId, overview] of Object.entries(content.overviews || {})) {
    if (!index.sections.has(sectionId)) errors.push(`content.json.overviews: unknown section ID ${sectionId}`);
    if (!object(overview, `content.json.overviews.${sectionId}`, errors)) continue;
    nonEmptyString(overview.title, `content.json.overviews.${sectionId}.title`, errors);
    collectBlockIds(overview.blocks, `content.json.overviews.${sectionId}.blocks`, index.interactionIds, errors);
  }
  for (const [pointId, point] of Object.entries(content.knowledgePoints || {})) {
    if (!index.knowledgePoints.has(pointId)) errors.push(`content.json.knowledgePoints: unknown knowledge-point ID ${pointId}`);
    if (!object(point, `content.json.knowledgePoints.${pointId}`, errors)) continue;
    nonEmptyString(point.title, `content.json.knowledgePoints.${pointId}.title`, errors);
    collectBlockIds(point.blocks, `content.json.knowledgePoints.${pointId}.blocks`, index.interactionIds, errors);
  }
  for (const pointId of index.knowledgePoints) if (!Object.hasOwn(content.knowledgePoints || {}, pointId)) errors.push(`content.json.knowledgePoints: missing ${pointId}`);
}

function validateQuestion(question, label, errors) {
  if (!object(question, label, errors)) return;
  nonEmptyString(question.type, `${label}.type`, errors);
  nonEmptyString(question.stem, `${label}.stem`, errors);
  if (!Object.hasOwn(question, 'answer')) errors.push(`${label}.answer: missing`);
  if (question.type === 'single') {
    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.some((option) => typeof option !== 'string' || !option.trim())) errors.push(`${label}.options: expected at least two non-empty options`);
    if (typeof question.answer !== 'string' || !question.options?.some((option) => option.startsWith(`${question.answer}. `))) errors.push(`${label}.answer: does not identify an option`);
  } else if (question.type === 'judge') {
    if (typeof question.answer !== 'boolean') errors.push(`${label}.answer: judge answer must be boolean`);
  } else if (question.type === 'sort') {
    if (!Array.isArray(question.items) || !Array.isArray(question.answer) || question.items.length !== question.answer.length || new Set(question.items).size !== question.items.length || question.answer.some((item) => !question.items.includes(item))) errors.push(`${label}: invalid sort items/answer`);
  } else if (question.type === 'match') {
    if (!Array.isArray(question.left) || !Array.isArray(question.right) || !object(question.answer, `${label}.answer`, errors) || question.left.some((item) => !Object.hasOwn(question.answer || {}, item) || !question.right.includes(question.answer[item]))) errors.push(`${label}: invalid match left/right/answer`);
  } else {
    errors.push(`${label}.type: unsupported question type ${String(question.type)}`);
  }
}

function validateQuiz(quiz, index, manifest, errors) {
  if (!object(quiz, 'quiz.json', errors)) return;
  if (!object(quiz.questionBank, 'quiz.json.questionBank', errors)) return;
  if (!object(quiz.sectionQuizzes, 'quiz.json.sectionQuizzes', errors)) return;
  if (!object(quiz.examQuestions, 'quiz.json.examQuestions', errors)) return;
  const questions = new Set();
  for (const [id, question] of Object.entries(quiz.questionBank)) {
    uniqueId(questions, id, `quiz.json.questionBank.${id}`, errors);
    validateQuestion(question, `quiz.json.questionBank.${id}`, errors);
  }
  const usedInExam = new Map();
  function references(record, allowed, kind) {
    if (!object(record, `quiz.json.${kind}`, errors)) return;
    for (const [owner, ids] of Object.entries(record)) {
      if (!allowed.has(owner)) errors.push(`quiz.json.${kind}: unknown owner ID ${owner}`);
      if (!Array.isArray(ids)) { errors.push(`quiz.json.${kind}.${owner}: expected an array of question IDs`); continue; }
      const unique = new Set();
      ids.forEach((id, itemIndex) => {
        if (!questions.has(id)) errors.push(`quiz.json.${kind}.${owner}[${itemIndex}]: unresolved question ID ${id}`);
        if (unique.has(id)) errors.push(`quiz.json.${kind}.${owner}: duplicate question reference ${id}`);
        unique.add(id);
        if (kind === 'examQuestions') usedInExam.set(id, (usedInExam.get(id) || 0) + 1);
      });
    }
  }
  references(quiz.sectionQuizzes, index.knowledgePoints, 'sectionQuizzes');
  references(quiz.examQuestions, index.chapters, 'examQuestions');
  for (const id of questions) if (usedInExam.get(id) !== 1) errors.push(`quiz.json.questionBank.${id}: must be referenced exactly once by a chapter exam`);
  if (manifest?.stats?.questions !== undefined && manifest.stats.questions !== questions.size) errors.push(`manifest.json.stats.questions: expected ${questions.size}`);
}

function assetPath(value, label, packagePaths, externalRoot, errors) {
  if (typeof value !== 'string' || !value.trim()) { errors.push(`${label}: resource path must be a non-empty string`); return; }
  const path = value.trim();
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) { errors.push(`${label}: network or scheme URL is forbidden (${path})`); return; }
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => !part || part === '.' || part === '..')) { errors.push(`${label}: resource path must be a safe relative path (${path})`); return; }
  if (packagePaths.has(path)) return;
  if (!externalRoot) {
    errors.push(`${label}: resource is missing from package (${path})`);
    return;
  }
  const externalFile = resolve(externalRoot, path);
  if (!within(externalRoot, externalFile) || !existsSync(externalFile) || !statSync(externalFile).isFile()) {
    errors.push(`${label}: external deployment resource is missing (${path})`);
  } else if (statSync(externalFile).size === 0) {
    errors.push(`${label}: external deployment resource is empty (${path})`);
  }
}

function scanHtmlResources(html, label, packagePaths, externalRoot, errors) {
  if (typeof html !== 'string') return;
  const values = [];
  for (const match of html.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of html.matchAll(/\burl\(\s*["']?([^"'\)\s]+)["']?\s*\)/gi)) values.push(match[1]);
  for (const value of values) assetPath(value, `${label}.html`, packagePaths, externalRoot, errors);
  if (/(?:https?:|wss?:|\/\/)/i.test(html)) errors.push(`${label}.html: network URL is forbidden`);
}

function scanResources(value, label, packagePaths, externalRoot, errors) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanResources(item, `${label}[${index}]`, packagePaths, externalRoot, errors));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childLabel = `${label}.${key}`;
    if (['src', 'poster', 'captions', 'clip', 'cover', 'image'].includes(key) && typeof child === 'string') assetPath(child, childLabel, packagePaths, externalRoot, errors);
    if (key === 'dependencies' && Array.isArray(child)) child.forEach((item, index) => assetPath(item, `${childLabel}[${index}]`, packagePaths, externalRoot, errors));
    if (key === 'images' && Array.isArray(child)) child.forEach((item, index) => { if (typeof item === 'string') assetPath(item, `${childLabel}[${index}]`, packagePaths, externalRoot, errors); });
    if (key === 'html') scanHtmlResources(child, label, packagePaths, externalRoot, errors);
    scanResources(child, childLabel, packagePaths, externalRoot, errors);
  }
}

function writeArchive(bytes, entries, directory) {
  let files;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    fail(`ZIP extraction failed: ${error.message}`);
  }
  const listedFiles = entries.filter((entry) => !entry.directory).map((entry) => entry.normalized);
  if (Object.keys(files).length !== listedFiles.length || listedFiles.some((name) => !Object.hasOwn(files, name))) fail('ZIP extraction result does not match central directory');
  for (const [name, data] of Object.entries(files)) {
    const target = resolve(directory, name);
    if (!within(directory, target)) fail(`ZIP extraction escapes temporary directory: ${name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }
}

function runLedger(directory, errors) {
  const script = join(root, 'tools', 'autosmt-2026', 'scripts', 'verify-source-ledger.mjs');
  const result = spawnSync(process.execPath, [script, directory], { cwd: root, encoding: 'utf8' });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) errors.push(`verify-source-ledger could not run: ${result.error.message}`);
  else if (result.status !== 0) errors.push(`verify-source-ledger failed with exit code ${result.status}`);
}

function usage() {
  console.error('Usage: node tools/autosmt-2026/scripts/verify-built-pigeon.mjs <course.pigeon>');
  process.exitCode = 2;
}

const [argument] = process.argv.slice(2);
if (!argument || process.argv.length !== 3) {
  usage();
} else {
  let temporary = null;
  try {
    const archive = resolve(process.cwd(), argument);
    if (!within(root, archive)) fail('archive must be inside the repository');
    const bytes = readFileSync(archive);
    const entries = inspectZip(bytes);
    temporary = mkdtempSync(join(root, 'tools', 'autosmt-2026', '.verify-built-pigeon-'));
    writeArchive(bytes, entries, temporary);
    const errors = [];
    const manifest = readJson(temporary, 'manifest.json', errors);
    const content = readJson(temporary, 'content.json', errors);
    const quiz = readJson(temporary, 'quiz.json', errors);
    readJson(temporary, 'source-ledger.json', errors);
    const index = validateManifest(manifest, errors);
    validateContent(content, index, errors);
    validateQuiz(quiz, index, manifest, errors);
    const packagePaths = new Set(entries.filter((entry) => !entry.directory).map((entry) => entry.normalized));
    const allowExternal = typeof manifest?.assetBase === 'string' && manifest.assetBase.trim() !== '';
    if (manifest?.assetBase !== undefined && !allowExternal) errors.push('manifest.json.assetBase: must be a non-empty string when present');
    if (allowExternal && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(manifest.assetBase.trim())) errors.push('manifest.json.assetBase: network URL is forbidden');
    const externalRoot = allowExternal ? dirname(archive) : null;
    scanResources(manifest, 'manifest.json', packagePaths, externalRoot, errors);
    scanResources(content, 'content.json', packagePaths, externalRoot, errors);
    scanResources(quiz, 'quiz.json', packagePaths, externalRoot, errors);
    runLedger(temporary, errors);
    if (errors.length) {
      console.error('Built pigeon verification failed:');
      errors.forEach((error) => console.error(`- ${error}`));
      process.exitCode = 1;
    } else {
      console.log(`Built pigeon verification passed: ${relative(root, archive).replace(/\\/g, '/')}`);
    }
  } catch (error) {
    console.error(`Built pigeon verification failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}
