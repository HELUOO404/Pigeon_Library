import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../..');
const reportsRoot = resolve(repoRoot, 'tools/autosmt-2026/reports');
const utf8 = new TextDecoder('utf-8', { fatal: true });

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot);
}

function pointerPart(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointer(parts) {
  return `/${parts.map(pointerPart).join('/')}`;
}

function jsonValueHash(value) {
  return sha256(typeof value === 'string' ? value : JSON.stringify(value));
}

function readJson(file, errors, label) {
  let buffer;
  try {
    buffer = readFileSync(file);
  } catch (error) {
    errors.push(`${label}: cannot read (${error.message})`);
    return null;
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    errors.push(`${label}: UTF-8 BOM is not allowed`);
    return null;
  }
  let text;
  try {
    text = utf8.decode(buffer);
  } catch {
    errors.push(`${label}: must be valid UTF-8`);
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push(`${label}: invalid JSON (${error.message})`);
    return null;
  }
}

function addRequired(required, file, parts, value) {
  required.set(`${file}#${pointer(parts)}`, value);
}

function addMediaTargets(required, file, value, parts = []) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => addMediaTargets(required, file, item, [...parts, index]));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childParts = [...parts, key];
    if (['src', 'poster', 'captions', 'clip'].includes(key) && typeof child === 'string') {
      addRequired(required, file, childParts, child);
    }
    if (key === 'dependencies' && Array.isArray(child)) {
      child.forEach((dependency, index) => {
        if (typeof dependency === 'string') addRequired(required, file, [...childParts, index], dependency);
      });
    }
    addMediaTargets(required, file, child, childParts);
  }
}

function sandboxInputs(html) {
  const inputs = [];
  const pattern = /<(select|input|textarea)\b[^>]*>(?:[\s\S]*?<\/\1\s*>)?/gi;
  for (const match of html.matchAll(pattern)) inputs.push(match[0]);
  return inputs;
}

function addParamSelectTargets(required, block, file, blockParts) {
  (block.headers ?? []).forEach((header, index) => addRequired(required, file, [...blockParts, 'headers', index], header));
  for (const [groupIndex, group] of (block.groups ?? []).entries()) {
    for (const [paramIndex, param] of (group.params ?? []).entries()) {
      const paramParts = [...blockParts, 'groups', groupIndex, 'params', paramIndex];
      for (const key of ['label', 'answerIndex']) {
        if (Object.hasOwn(param, key)) addRequired(required, file, [...paramParts, key], param[key]);
      }
      (param.options ?? []).forEach((option, index) => addRequired(required, file, [...paramParts, 'options', index], option));
    }
  }
  for (const [rowIndex, row] of (block.matrixRows ?? []).entries()) {
    for (const [cellIndex, cell] of (row.cells ?? []).entries()) {
      const cellParts = [...blockParts, 'matrixRows', rowIndex, 'cells', cellIndex];
      for (const [partIndex, part] of (cell.content ?? []).entries()) {
        const partParts = [...cellParts, 'content', partIndex];
        if (part.type === 'text') {
          addRequired(required, file, [...partParts, 'text'], part.text);
          continue;
        }
        if (part.type !== 'control') continue;
        for (const key of ['label', 'answerIndex']) {
          if (Object.hasOwn(part, key)) addRequired(required, file, [...partParts, key], part[key]);
        }
        (part.options ?? []).forEach((option, index) => addRequired(required, file, [...partParts, 'options', index], option));
      }
    }
  }
}

function addStepTargets(required, steps, file, parts) {
  for (const [index, step] of (steps ?? []).entries()) {
    const stepParts = [...parts, index];
    for (const key of ['prompt', 'answerIndex']) {
      if (Object.hasOwn(step, key)) addRequired(required, file, [...stepParts, key], step[key]);
    }
    (step.options ?? []).forEach((option, optionIndex) => addRequired(required, file, [...stepParts, 'options', optionIndex], option));
  }
}

function collectBlocks(required, blocks, file, baseParts) {
  for (const [index, block] of (blocks ?? []).entries()) {
    const blockParts = [...baseParts, index];
    addRequired(required, file, blockParts, block);
    addMediaTargets(required, file, block, blockParts);
    if (block.type === 'tabSet') {
      for (const [tabIndex, tab] of (block.tabs ?? []).entries()) {
        collectBlocks(required, tab.blocks, file, [...blockParts, 'tabs', tabIndex, 'blocks']);
      }
    }
    if (block.type === 'paramSelect') addParamSelectTargets(required, block, file, blockParts);
    if (block.type === 'stepSimulation') {
      addStepTargets(required, block.steps, file, [...blockParts, 'steps']);
      for (const [groupIndex, group] of (block.groups ?? []).entries()) {
        const groupParts = [...blockParts, 'groups', groupIndex];
        for (const key of ['prompt', 'answerIndex']) {
          if (Object.hasOwn(group, key)) addRequired(required, file, [...groupParts, key], group[key]);
        }
        (group.options ?? []).forEach((option, optionIndex) => addRequired(required, file, [...groupParts, 'options', optionIndex], option));
        addStepTargets(required, group.steps, file, [...groupParts, 'steps']);
      }
    }
    if (block.type === 'sandbox' && typeof block.html === 'string') {
      sandboxInputs(block.html).forEach((input, inputIndex) => {
        addRequired(required, file, [...blockParts, 'sandbox-input', inputIndex], input);
      });
    }
  }
}

function collectRequiredTargets(content, quiz, errors) {
  const required = new Map();
  if (!content || typeof content !== 'object') {
    errors.push('content.json: expected an object');
    return required;
  }
  for (const [sectionId, overview] of Object.entries(content.overviews ?? {})) {
    collectBlocks(required, overview?.blocks, 'content.json', ['overviews', sectionId, 'blocks']);
  }
  for (const [knowledgePointId, knowledgePoint] of Object.entries(content.knowledgePoints ?? {})) {
    collectBlocks(required, knowledgePoint?.blocks, 'content.json', ['knowledgePoints', knowledgePointId, 'blocks']);
  }
  if (!quiz) return required;
  if (!quiz.questionBank || typeof quiz.questionBank !== 'object') {
    errors.push('quiz.json: questionBank is required');
    return required;
  }
  for (const [questionId, question] of Object.entries(quiz.questionBank)) {
    const questionParts = ['questionBank', questionId];
    if (!Object.hasOwn(question, 'stem')) errors.push(`quiz.json#${pointer(questionParts)}: missing stem`);
    else addRequired(required, 'quiz.json', [...questionParts, 'stem'], question.stem);
    const choices = Array.isArray(question.options) ? ['options', question.options] : ['items', question.items];
    if (Array.isArray(choices[1])) {
      choices[1].forEach((choice, index) => addRequired(required, 'quiz.json', [...questionParts, choices[0], index], choice));
    }
    if (!Object.hasOwn(question, 'answer')) errors.push(`quiz.json#${pointer(questionParts)}: missing answer`);
    else addRequired(required, 'quiz.json', [...questionParts, 'answer'], question.answer);
  }
  return required;
}

function decodePointer(part) {
  return part.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveTarget(courseDir, target, cache, errors) {
  if (typeof target !== 'string' || !target.includes('#')) {
    errors.push('entry target must use <json-file>#<JSON Pointer>');
    return undefined;
  }
  const splitAt = target.indexOf('#');
  const fileName = target.slice(0, splitAt);
  const fragment = target.slice(splitAt + 1);
  const targetFile = resolve(courseDir, fileName);
  if (!isWithin(courseDir, targetFile)) {
    errors.push(`${target}: target file escapes course directory`);
    return undefined;
  }
  if (!cache.has(targetFile)) cache.set(targetFile, readJson(targetFile, errors, fileName));
  const data = cache.get(targetFile);
  if (!data || !fragment.startsWith('/')) {
    if (data) errors.push(`${target}: JSON Pointer must start with /`);
    return undefined;
  }
  const parts = fragment.slice(1).split('/').map(decodePointer);
  const sandboxIndex = parts.indexOf('sandbox-input');
  const jsonParts = sandboxIndex === -1 ? parts : parts.slice(0, sandboxIndex);
  let value = data;
  for (const part of jsonParts) {
    if (value === null || value === undefined || !Object.hasOwn(value, part)) {
      errors.push(`${target}: JSON Pointer does not resolve`);
      return undefined;
    }
    value = value[part];
  }
  if (sandboxIndex === -1) return value;
  if (parts.length !== sandboxIndex + 2 || value?.type !== 'sandbox' || typeof value.html !== 'string') {
    errors.push(`${target}: invalid sandbox-input semantic path`);
    return undefined;
  }
  const inputIndex = Number(parts[sandboxIndex + 1]);
  const inputs = sandboxInputs(value.html);
  if (!Number.isInteger(inputIndex) || inputIndex < 0 || inputIndex >= inputs.length) {
    errors.push(`${target}: sandbox input does not resolve`);
    return undefined;
  }
  return inputs[inputIndex];
}

function verifyEntry(entry, index, courseDir, cache, errors) {
  const prefix = `entries[${index}]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${prefix}: must be an object`);
    return;
  }
  for (const key of ['target', 'kind', 'sourceFile', 'sourceLocation', 'sourceSha256', 'targetValueSha256', 'checkSummary', 'status']) {
    if (!Object.hasOwn(entry, key)) errors.push(`${prefix}: missing ${key}`);
  }
  if (typeof entry.kind !== 'string' || !entry.kind.trim()) errors.push(`${prefix}: kind must be non-empty`);
  if (typeof entry.sourceLocation !== 'string' || !entry.sourceLocation.trim()) errors.push(`${prefix}: sourceLocation must be non-empty`);
  if (typeof entry.checkSummary !== 'string' || !entry.checkSummary.trim()) errors.push(`${prefix}: checkSummary must be non-empty`);
  if (entry.status !== 'verified') errors.push(`${prefix}: status must be verified`);

  const value = resolveTarget(courseDir, entry.target, cache, errors);
  if (value !== undefined && entry.targetValueSha256 !== jsonValueHash(value)) {
    errors.push(`${prefix}: targetValueSha256 does not match ${entry.target}`);
  }

  if (typeof entry.sourceFile !== 'string' || !entry.sourceFile) {
    errors.push(`${prefix}: sourceFile must be a repository-relative path`);
    return;
  }
  const sourceFile = resolve(repoRoot, entry.sourceFile);
  if (!isWithin(repoRoot, sourceFile) || !isWithin(reportsRoot, sourceFile)) {
    errors.push(`${prefix}: sourceFile must be inside tools/autosmt-2026/reports`);
    return;
  }
  if (!existsSync(sourceFile)) {
    errors.push(`${prefix}: sourceFile does not exist (${entry.sourceFile})`);
    return;
  }
  let resolvedSource;
  try {
    resolvedSource = realpathSync(sourceFile);
  } catch (error) {
    errors.push(`${prefix}: cannot resolve sourceFile (${error.message})`);
    return;
  }
  if (!isWithin(reportsRoot, resolvedSource) || !lstatSync(resolvedSource).isFile()) {
    errors.push(`${prefix}: sourceFile must resolve to a regular reports file`);
    return;
  }
  const sourceBytes = readFileSync(resolvedSource);
  if (!sourceBytes.length) errors.push(`${prefix}: sourceFile is empty`);
  if (entry.sourceSha256 !== sha256(sourceBytes)) errors.push(`${prefix}: sourceSha256 does not match ${entry.sourceFile}`);

  if (entry.sourcePointer !== undefined) {
    if (typeof entry.sourcePointer !== 'string' || !entry.sourcePointer.startsWith('/')) {
      errors.push(`${prefix}: sourcePointer must be a JSON Pointer`);
    } else {
      let sourceData;
      try {
        sourceData = JSON.parse(utf8.decode(sourceBytes));
      } catch (error) {
        errors.push(`${prefix}: sourcePointer requires a UTF-8 JSON source (${error.message})`);
        sourceData = undefined;
      }
      if (sourceData !== undefined) {
        let sourceValue = sourceData;
        for (const part of entry.sourcePointer.slice(1).split('/').map(decodePointer)) {
          if (sourceValue === null || sourceValue === undefined || !Object.hasOwn(sourceValue, part)) {
            errors.push(`${prefix}: sourcePointer does not resolve in ${entry.sourceFile}`);
            sourceValue = undefined;
            break;
          }
          sourceValue = sourceValue[part];
        }
        if (sourceValue !== undefined && entry.targetValueSha256 !== jsonValueHash(sourceValue)) {
          errors.push(`${prefix}: sourcePointer value does not match targetValueSha256`);
        }
      }
    }
  }

  const answerBearing = entry.kind === 'question-answer' || entry.kind === 'interactive-answer';
  if (answerBearing && entry.answerAuthority !== 'full-score-audit') {
    errors.push(`${prefix}: answer-bearing target must use full-score-audit authority`);
  }
  if (answerBearing && !Array.isArray(entry.authorityEvidence)) {
    errors.push(`${prefix}: answer-bearing target must include authorityEvidence`);
  }
  if (entry.authorityEvidence !== undefined) {
    verifyAuthorityEvidence(entry.authorityEvidence, prefix, errors);
  }
}

function scoreValue(data, scoreType, scoreNumber) {
  const aliases = scoreType === 'engineering' ? ['engineering', 'projects'] : [scoreType];
  for (const key of aliases) {
    const rows = data?.scores?.[key];
    if (Array.isArray(rows)) return rows.find((row) => Number(row.number) === scoreNumber)?.score ?? null;
  }
  if (aliases.includes(data?.scoreType) && Number(data?.scoreNumber) === scoreNumber) return data.score ?? null;
  return null;
}

function verifyAuthorityEvidence(records, entryPrefix, errors) {
  if (!Array.isArray(records) || records.length === 0) {
    errors.push(`${entryPrefix}: authorityEvidence must be a non-empty array`);
    return;
  }
  records.forEach((record, evidenceIndex) => {
    const prefix = `${entryPrefix}.authorityEvidence[${evidenceIndex}]`;
    for (const key of ['sourceFile', 'sourceLocation', 'sourceSha256', 'scoreType', 'scoreNumber', 'observedScore']) {
      if (!Object.hasOwn(record || {}, key)) errors.push(`${prefix}: missing ${key}`);
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) return;
    if (typeof record.sourceLocation !== 'string' || !record.sourceLocation.trim()) {
      errors.push(`${prefix}: sourceLocation must be non-empty`);
    }
    if (!['homework', 'experiment', 'engineering'].includes(record.scoreType)) {
      errors.push(`${prefix}: unsupported scoreType ${record.scoreType}`);
    }
    if (!Number.isInteger(record.scoreNumber) || record.scoreNumber <= 0) {
      errors.push(`${prefix}: scoreNumber must be a positive integer`);
    }
    const file = resolve(repoRoot, String(record.sourceFile || ''));
    if (!isWithin(repoRoot, file) || !isWithin(reportsRoot, file) || !existsSync(file)) {
      errors.push(`${prefix}: sourceFile must be an existing file inside tools/autosmt-2026/reports`);
      return;
    }
    const bytes = readFileSync(file);
    if (record.sourceSha256 !== sha256(bytes)) errors.push(`${prefix}: sourceSha256 mismatch`);
    let data;
    try {
      data = JSON.parse(utf8.decode(bytes));
    } catch (error) {
      errors.push(`${prefix}: authority source must be valid UTF-8 JSON (${error.message})`);
      return;
    }
    const actual = scoreValue(data, record.scoreType, record.scoreNumber);
    if (Number(actual) !== 100) errors.push(`${prefix}: authority source score is not 100`);
    if (Number(record.observedScore) !== 100 || Number(record.observedScore) !== Number(actual)) {
      errors.push(`${prefix}: observedScore does not match the 100-point authority source`);
    }
  });
}

function verify(courseArgument) {
  const errors = [];
  const courseDir = resolve(process.cwd(), courseArgument);
  if (!isWithin(repoRoot, courseDir) || !existsSync(courseDir) || !lstatSync(courseDir).isDirectory()) {
    return [`course directory is invalid or outside repository: ${courseArgument}`];
  }
  const ledgerPath = resolve(courseDir, 'source-ledger.json');
  if (!existsSync(ledgerPath)) return [`missing source-ledger.json in ${courseDir}`];

  const ledger = readJson(ledgerPath, errors, 'source-ledger.json');
  const content = readJson(resolve(courseDir, 'content.json'), errors, 'content.json');
  const quizPath = resolve(courseDir, 'quiz.json');
  const quiz = existsSync(quizPath) ? readJson(quizPath, errors, 'quiz.json') : null;
  const manifestPath = resolve(courseDir, 'manifest.json');
  const manifest = existsSync(manifestPath) ? readJson(manifestPath, errors, 'manifest.json') : null;
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) return errors;
  if (ledger.schemaVersion !== 1) errors.push('source-ledger.json: schemaVersion must be 1');
  if (typeof ledger.courseId !== 'string' || !ledger.courseId) errors.push('source-ledger.json: courseId must be non-empty');
  if (manifest?.id && ledger.courseId !== manifest.id) errors.push('source-ledger.json: courseId does not match manifest.json id');
  if (ledger.answerAuthority !== 'full-score-audit') errors.push('source-ledger.json: answerAuthority must be full-score-audit');
  if (!Array.isArray(ledger.entries)) {
    errors.push('source-ledger.json: entries must be an array');
    return errors;
  }

  const required = collectRequiredTargets(content, quiz, errors);
  const targets = new Set();
  const cache = new Map([
    [resolve(courseDir, 'content.json'), content],
    [resolve(courseDir, 'quiz.json'), quiz],
  ]);
  ledger.entries.forEach((entry, index) => {
    if (entry?.target && targets.has(entry.target)) errors.push(`entries[${index}]: duplicate target ${entry.target}`);
    if (entry?.target) targets.add(entry.target);
    verifyEntry(entry, index, courseDir, cache, errors);
  });
  for (const target of required.keys()) {
    if (!targets.has(target)) errors.push(`missing ledger entry for ${target}`);
  }
  if (ledger.stats?.entries !== ledger.entries.length) errors.push('source-ledger.json: stats.entries is inconsistent');
  const contentBlockCount = ledger.entries.filter((entry) => String(entry?.kind || '').startsWith('content-block:')).length;
  if (ledger.stats?.contentBlocks !== contentBlockCount) errors.push('source-ledger.json: stats.contentBlocks is inconsistent');
  if (ledger.stats?.questions !== Object.keys(quiz?.questionBank || {}).length) errors.push('source-ledger.json: stats.questions is inconsistent');
  return errors;
}

const [courseArgument] = process.argv.slice(2);
if (!courseArgument || process.argv.length !== 3) {
  console.error('Usage: node tools/autosmt-2026/scripts/verify-source-ledger.mjs <course-dir>');
  process.exitCode = 2;
} else {
  const errors = verify(courseArgument);
  if (errors.length) {
    console.error('Source ledger verification failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log('Source ledger verification passed.');
  }
}
