// test-oxidation-golden.mjs — 隔离构建并门禁氧化黄金样板的结构、证据、资源与公式。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);
const { parse } = require(path.join(ROOT, 'app', 'node_modules', 'node-html-parser'));
const BUILD_SCRIPT = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'build-oxidation-golden.mjs');
const FINAL_SCORE_GATE = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'verify-final-score-authority.mjs');
const SOURCE_LEDGER_GATE = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'verify-source-ledger.mjs');
const MAIN_LEARN_SOURCE = path.join(ROOT, 'app', 'src', 'main-learn.js');
const CONTENT_RENDERER_SOURCE = path.join(ROOT, 'app', 'src', 'render', 'content-renderer.js');
const MODEL_SOURCE = path.join(ROOT, 'tools', 'autosmt-2026', 'lib', 'oxidation-temperature-curve-model.js');
const COURSE_DIR = path.join(ROOT, 'courses', 'autosmt-previews', 'autosmt-oxidation-golden');
const SOURCE_SECTION = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'source-capture', 'sections', '0-1');
const ACTIVITY_DIR = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'activity-details');
const CANDIDATE_FILE = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'candidate-answers.json');
const CANDIDATE_SCORE_FILE = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'score-after-all-homework-candidates.json');
const FINAL_SCORE_FILE = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'final-score-before-capture.json');
const FORMAL_COURSE_DIRS = ['2026-ic-manufacturing', '2026-ic-devices', '2026-ic-packaging']
  .flatMap((courseId) => [
    path.join(ROOT, 'courses', '2026-vocational-preliminary', courseId),
    path.join(ROOT, 'dist-courses', '2026-vocational-preliminary', courseId),
  ]);
const THEORY_SOURCES = new Map([
  ['介质薄膜', path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'source-capture', 'resources', '5e374a19868f7f1d0c0e8ef95e253f5e92523583096550df643bb2557f815ea1.html')],
  ['二氧化硅膜', path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'source-capture', 'resources', '5ced2f3c5f05eac6860ba6ede5410c0ec585eca8578a8eacc8149bb6928551a0.html')],
  ['氧化工艺', path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'source-capture', 'resources', 'dd8f88bcf157d7ae2b50c664bd565894ba51c09282b6c2817c85e7723ad5629f.html')],
]);
const CROSS_SECTION_THEORY = path.join(
  ROOT,
  'tools', 'autosmt-2026', 'reports', 'source-capture', 'resources',
  'dac031f11abd66c097c32bba44540bd670c3f1b5254422f89d55635355231a53.html',
);

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (char === '\n') { inLineComment = false; out += char; }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') { inBlockComment = false; i += 1; }
      continue;
    }
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === '/' && next === '/') { inLineComment = true; i += 1; continue; }
    if (char === '/' && next === '*') { inBlockComment = true; i += 1; continue; }
    out += char;
  }
  return out;
}

function stripTrailingCommas(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; out += char; continue; }
    if (char === ',') {
      let cursor = i + 1;
      while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
      if (text[cursor] === '}' || text[cursor] === ']') continue;
    }
    out += char;
  }
  return out;
}

function loadJsonc(file) {
  assert.ok(existsSync(file), `黄金样板缺少 ${path.relative(ROOT, file)}`);
  return JSON.parse(stripTrailingCommas(stripJsonComments(readFileSync(file, 'utf8'))));
}

function normalizeText(value) {
  return String(value ?? '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
}

function htmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"');
}

function loadMixedText(file) {
  const bytes = readFileSync(file);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('gb18030').decode(bytes); }
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function sourcePlainText(file) {
  return normalizeText(htmlToText(loadMixedText(file)
    .replace(/<style\b[^>]*>[^]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[^]*?<\/script>/gi, ' ')));
}

function* walkBlocks(blocks) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    yield block;
    if (block?.type === 'tabSet') {
      for (const tab of block.tabs || []) yield* walkBlocks(tab.blocks);
    }
  }
}

function blocksOfType(blocks, type) {
  return [...walkBlocks(blocks)].filter((block) => block?.type === type);
}

function cellText(cell) {
  if (typeof cell === 'string') return normalizeText(cell);
  if (!cell || typeof cell !== 'object') return '';
  if (Array.isArray(cell.spans)) return normalizeText(cell.spans.map((span) => span?.t || '').join(''));
  return normalizeText(cell.text ?? '');
}

function blockText(block) {
  if (!block || typeof block !== 'object') return '';
  if (typeof block.text === 'string') return normalizeText(block.text);
  if (Array.isArray(block.spans)) return normalizeText(block.spans.map((span) => span?.t || '').join(''));
  return '';
}

function nativeContentText(blocks) {
  const parts = [];
  for (const block of walkBlocks(blocks)) {
    const ownText = blockText(block);
    if (ownText) parts.push(ownText);
    if (block?.type === 'video' && block.title) parts.push(block.title);
    if (block?.type === 'paramsTable') {
      parts.push(...(block.headers || []).map(cellText));
      parts.push(...(block.rows || []).flat().map(cellText));
    }
    if (block?.type === 'paramSelect') {
      for (const param of flattenParamSelect(block)) parts.push(param.label, ...(param.options || []));
    }
  }
  return normalizeText(parts.join(' '));
}

function countNativeImages(blocks) {
  let count = 0;
  for (const block of walkBlocks(blocks)) {
    if (block?.type === 'image') count += 1;
    if (block?.type === 'imageGroup') count += Array.isArray(block.images) ? block.images.length : 0;
    if (block?.type === 'paramsTable') {
      const cells = [...(block.headers || []), ...(block.rows || []).flat()];
      count += cells.filter((cell) => cell && typeof cell === 'object' && cell.image?.src).length;
    }
  }
  return count;
}

function directElements(node, allowedTags) {
  return (node?.childNodes || []).filter((child) => {
    if (!child?.tagName) return false;
    const tag = child.tagName.toLowerCase();
    assert.ok(allowedTags.includes(tag), `源理论出现不支持的顶层 <${tag}>: ${normalizeText(child.outerHTML).slice(0, 180)}`);
    return true;
  });
}

function theorySourceRoot(sourceFile) {
  const root = parse(loadMixedText(sourceFile), { lowerCaseTagName: true, comment: false });
  const sections = root.querySelectorAll('body > div.Section0');
  assert.equal(sections.length, 1, `理论源必须有唯一 Section0: ${path.relative(ROOT, sourceFile)}`);
  return sections[0];
}

function sourceTableRows(table) {
  return table.querySelectorAll('tr').map((row) => directElements(row, ['th', 'td']));
}

function sourceTheoryText(section) {
  const nodes = directElements(section, ['p', 'div']);
  assert.ok(nodes.length > 1 && nodes[0].tagName.toLowerCase() === 'p', '理论源首节点必须是重复卡片标题');
  return nodes.slice(1).map((node) => {
    const tables = node.querySelectorAll('table');
    if (!tables.length) return normalizeText(node.textContent);
    assert.equal(tables.length, 1, '理论表格容器只能包含一个 table');
    return sourceTableRows(tables[0]).flat().map((cell) => normalizeText(cell.textContent)).join('');
  }).join('');
}

function generatedTheoryText(blocks) {
  const parts = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block?.type === 'paragraph') parts.push(normalizeText((block.spans || []).map((span) => span?.t || '').join('')));
    else if (['numTitle', 'boldCaption', 'heading'].includes(block?.type)) parts.push(normalizeText(block.text));
    else if (block?.type === 'list') {
      parts.push((block.items || []).map((item, index) => `${index + 1}）${normalizeText((item || []).map((span) => span?.t || '').join(''))}`).join(''));
    } else if (block?.type === 'paramsTable') {
      parts.push([...(block.headers || []), ...(block.rows || []).flat()].map(cellText).join(''));
    } else if (block?.type === 'tabSet') {
      const theoryTab = (block.tabs || []).find((tab) => tab.id === 'theory' || tab.label === '知识正文');
      if (theoryTab) parts.push(generatedTheoryText(theoryTab.blocks));
    }
  }
  return parts.join('');
}

function sourceCellSignature(cell) {
  return {
    text: normalizeText(cell.textContent),
    rowspan: Number(cell.getAttribute('rowspan') || 1),
    colspan: Number(cell.getAttribute('colspan') || 1),
  };
}

function generatedCellSignature(cell) {
  return {
    text: cellText(cell),
    rowspan: Number((cell && typeof cell === 'object' && cell.rowspan) || 1),
    colspan: Number((cell && typeof cell === 'object' && cell.colspan) || 1),
  };
}

function sourceTableSignatures(section) {
  return section.querySelectorAll('table').map((table) => {
    const rows = sourceTableRows(table);
    const hasCaptionRow = rows[0].length === 1 && Number(rows[0][0].getAttribute('colspan') || 1) > 1;
    const headerIndex = hasCaptionRow ? 1 : 0;
    return {
      caption: hasCaptionRow ? normalizeText(rows[0][0].textContent) : '',
      captionColspan: hasCaptionRow ? Number(rows[0][0].getAttribute('colspan')) : 1,
      headers: rows[headerIndex].map(sourceCellSignature),
      rows: rows.slice(headerIndex + 1).map((row) => row.map(sourceCellSignature)),
    };
  });
}

function generatedTableSignatures(blocks) {
  return blocksOfType(blocks, 'paramsTable').map((table) => ({
    headers: (table.headers || []).map(generatedCellSignature),
    rows: (table.rows || []).map((row) => row.map(generatedCellSignature)),
  }));
}

function generatedTheoryImages(blocks) {
  const images = [];
  for (const block of walkBlocks(blocks)) {
    if (block?.type === 'image') images.push({ src: block.src, alt: block.alt || '' });
    if (block?.type === 'imageGroup') {
      images.push(...(block.images || []).map((image) => ({ src: image.src, alt: image.alt || '' })));
    }
    if (block?.type === 'paramsTable') {
      for (const cell of [...(block.headers || []), ...(block.rows || []).flat()]) {
        if (cell && typeof cell === 'object' && cell.image?.src) images.push({ src: cell.image.src, alt: cell.image.alt || '' });
      }
    }
  }
  return images;
}

const staticCapture = JSON.parse(readFileSync(path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'resource-capture-static-v1.json'), 'utf8')).captured;

function sourceTheoryImages(section, sourceFile) {
  const sourcePage = `source-capture/resources/${path.basename(sourceFile)}`;
  return section.querySelectorAll('img').map((image) => {
    const rawSource = image.getAttribute('src');
    const normalizedRaw = decodeURIComponent(rawSource).replace(/\\/g, '/').replace(/^\.\.\//, '');
    const matches = Object.entries(staticCapture).filter(([key, entry]) => {
      const decodedKey = decodeURIComponent(key).replace(/\\/g, '/');
      return entry.sourcePages?.includes(sourcePage) && (key === rawSource || decodedKey.endsWith(`/${normalizedRaw}`));
    });
    assert.equal(matches.length, 1, `理论图片必须有唯一抓取映射: ${rawSource}`);
    return { src: `assets/images/${path.basename(matches[0][1].file)}`, alt: image.getAttribute('alt') || '' };
  });
}

function flattenParamSelect(block) {
  return (block?.groups || []).flatMap((group) => group?.params || []);
}

function structuredQuestionText(cell, sourceFile) {
  const lines = [''];
  function visit(node) {
    if (node.nodeType === 3) {
      lines[lines.length - 1] += node.textContent;
      return;
    }
    const tag = node.tagName?.toLowerCase();
    if (tag === 'br') {
      lines.push('');
      return;
    }
    assert.ok(
      ['span', 'font', 'b', 'strong', 'o:p', 'i', 'em'].includes(tag),
      `源题面出现不支持的 <${tag}>；源文件 ${path.relative(ROOT, sourceFile)}；片段 ${normalizeText(node.outerHTML).slice(0, 180)}`,
    );
    for (const child of node.childNodes || []) visit(child);
  }
  for (const child of cell.childNodes || []) visit(child);
  return lines.map(normalizeText).filter(Boolean).join('\n');
}

function parseHomeworkSource() {
  const sourceFile = path.join(SOURCE_SECTION, 'homework.html');
  const html = loadMixedText(sourceFile);
  const answers = loadJsonc(CANDIDATE_FILE)['2'];
  assert.equal(answers?.length, 10, '作业 2 满分候选答案必须恰有 10 项');
  const candidateScore = loadJsonc(CANDIDATE_SCORE_FILE).scores?.homework?.find((entry) => entry.number === 2);
  const finalScore = loadJsonc(FINAL_SCORE_FILE).scores?.homework?.find((entry) => entry.number === 2);
  assert.equal(candidateScore?.score, '100.00', '作业 2 候选答案提交结果必须为 100.00');
  assert.equal(finalScore?.score, '100.00', '作业 2 最终审计结果必须为 100.00');
  const root = parse(html, { lowerCaseTagName: true, comment: false });
  const questions = [];
  for (const row of root.querySelectorAll('tr')) {
    const cells = (row.childNodes || []).filter((node) => node.tagName?.toLowerCase() === 'td');
    if (cells.length < 3) continue;
    const sourceQuestionId = normalizeText(cells[0].textContent);
    if (!/^2-\d+$/.test(sourceQuestionId)) continue;
    const letters = cells[2].querySelectorAll('option')
      .map((option) => option.getAttribute('value'))
      .filter((letter) => /^[A-Z]$/.test(letter || ''));
    const questionText = structuredQuestionText(cells[1], sourceFile);
    const positions = letters.map((letter) => {
      const marker = `${letter}.`;
      const index = questionText.indexOf(marker);
      assert.ok(index >= 0, `源题 ${sourceQuestionId} 缺少选项正文 ${marker}`);
      return index;
    });
    const stem = normalizeText(questionText.slice(0, positions[0]));
    const options = letters.map((letter, index) => {
      const start = positions[index] + 2;
      const end = positions[index + 1] ?? questionText.length;
      return `${letter}. ${normalizeText(questionText.slice(start, end))}`;
    });
    questions.push({ sourceQuestionId, stem, options, answer: answers[questions.length] });
  }
  assert.equal(questions.length, 10, '源作业 2 应恰有 10 题');
  return questions;
}

function resolveEvidenceFile(value) {
  assert.equal(typeof value, 'string', '证据 sourceFile 必须是字符串');
  const normalized = value.replace(/\\/g, '/');
  if (path.isAbsolute(value)) return path.normalize(value);
  if (normalized.startsWith('tools/')) return path.join(ROOT, normalized);
  if (normalized.startsWith('reports/')) return path.join(ROOT, 'tools', 'autosmt-2026', normalized);
  if (normalized.startsWith('source-capture/') || normalized.startsWith('activity-details/')) {
    return path.join(ROOT, 'tools', 'autosmt-2026', 'reports', normalized);
  }
  return path.join(COURSE_DIR, normalized);
}

function assertLocalAsset(assetPath, context) {
  assert.equal(typeof assetPath, 'string', `${context} 资源路径必须是字符串`);
  assert.match(assetPath, /^assets\//, `${context} 必须引用包内 assets/，实际为 ${assetPath}`);
  assert.doesNotMatch(assetPath, /(?:^|\/)\.\.(?:\/|$)/, `${context} 不得越界: ${assetPath}`);
  const absolute = path.resolve(COURSE_DIR, assetPath);
  assert.ok(absolute.startsWith(`${path.resolve(COURSE_DIR)}${path.sep}`), `${context} 资源越出课程目录: ${assetPath}`);
  assert.ok(existsSync(absolute), `${context} 引用的资源不存在: ${assetPath}`);
  assert.ok(statSync(absolute).isFile(), `${context} 引用的资源不是文件: ${assetPath}`);
}

function scanCourseResources(value, trail = 'course') {
  if (typeof value === 'string') {
    assert.doesNotMatch(value, /(?:https?:)?\/\//i, `${trail} 残留外链: ${value}`);
    assert.doesNotMatch(value, /\.php(?:\?|\b)/i, `${trail} 残留 PHP 依赖: ${value}`);
    for (const match of value.matchAll(/assets\/[A-Za-z0-9_./-]+/g)) assertLocalAsset(match[0], trail);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanCourseResources(item, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const nextTrail = `${trail}.${key}`;
    if (['src', 'poster', 'captions', 'clip'].includes(key) && typeof item === 'string') assertLocalAsset(item, nextTrail);
    scanCourseResources(item, nextTrail);
  }
}

function snapshotTree(root) {
  if (!existsSync(root)) return null;
  const snapshot = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const name of readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const stats = statSync(file);
      const relative = path.relative(root, file).replace(/\\/g, '/');
      if (stats.isDirectory()) {
        snapshot.push(['directory', relative]);
        pending.push(file);
      } else {
        snapshot.push(['file', relative, stats.size, stats.mtimeMs]);
      }
    }
  }
  return snapshot.sort((a, b) => a[1].localeCompare(b[1]));
}

assert.ok(
  existsSync(BUILD_SCRIPT),
  `黄金样板构建脚本尚未实现: ${path.relative(ROOT, BUILD_SCRIPT)}。请先实现隔离的 0-1 氧化构建器，再运行本门禁。`,
);

const formalCoursesBeforeBuild = new Map(FORMAL_COURSE_DIRS.map((directory) => [directory, snapshotTree(directory)]));
const build = spawnSync(process.execPath, [BUILD_SCRIPT], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 180_000,
  maxBuffer: 16 * 1024 * 1024,
});
assert.equal(
  build.status,
  0,
  `氧化黄金样板构建失败。\nstdout:\n${build.stdout || '(empty)'}\nstderr:\n${build.stderr || '(empty)'}`,
);
assert.ok(existsSync(COURSE_DIR), `构建成功但未生成隔离输出目录: ${path.relative(ROOT, COURSE_DIR)}`);
for (const directory of FORMAL_COURSE_DIRS) {
  assert.deepEqual(
    snapshotTree(directory),
    formalCoursesBeforeBuild.get(directory),
    `草稿样板构建器不得生成或覆盖正式课程目录: ${path.relative(ROOT, directory)}`,
  );
}

for (const [label, script, args] of [
  ['满分答案权威', FINAL_SCORE_GATE, ['--course', 'manufacturing']],
  ['逐字段来源账本', SOURCE_LEDGER_GATE, [COURSE_DIR]],
]) {
  const gate = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(
    gate.status,
    0,
    `${label}门禁失败。\nstdout:\n${gate.stdout || '(empty)'}\nstderr:\n${gate.stderr || '(empty)'}`,
  );
}

const manifest = loadJsonc(path.join(COURSE_DIR, 'manifest.json'));
const content = loadJsonc(path.join(COURSE_DIR, 'content.json'));
const quiz = loadJsonc(path.join(COURSE_DIR, 'quiz.json'));
const knowledgeMap = loadJsonc(path.join(COURSE_DIR, 'question-knowledge-map.json'));

assert.equal(manifest.id, 'autosmt-oxidation-golden');
assert.equal(manifest.schemaVersion, 1);
assert.match(
  [manifest.title, manifest.subtitle, manifest.description].filter(Boolean).join(' '),
  /人工验收基线|非正式课程/i,
  '课程页面可见标题/副标题/简介中必须明确显示黄金样板而非正式课程',
);
assert.equal(manifest.assetBase ?? '', '', '黄金样板必须完全离线，不得使用 assetBase');
assert.equal(manifest.chapters?.length, 1, '黄金样板只能包含一章');
const chapter = manifest.chapters[0];
assert.equal(chapter.id, '1');
assert.equal(chapter.title, '第1章 IC制造工艺');
assert.equal(chapter.tabLabel, '第1章');
assert.equal(chapter.sections?.length, 1, '黄金样板只能包含氧化一节');
const section = chapter.sections[0];
assert.equal(section.id, '1.2');
assert.equal(section.title, '第1.2节 氧化');
assert.deepEqual(
  section.knowledgePoints?.map((point) => point.title),
  ['介质薄膜', '二氧化硅膜', '氧化工艺', '实验1:热氧化工艺'],
  '知识卡必须按三张理论卡 + 原名实验 1 卡排列',
);
assert.equal(new Set(section.knowledgePoints.map((point) => point.id)).size, 4, '知识卡 ID 必须唯一');
section.knowledgePoints.forEach((point) => assert.match(point.id, /^1-2-\d+$/, `知识卡 ID 不符合 1-2-N: ${point.id}`));
assert.equal(manifest.stats?.chapters, 1);
assert.equal(manifest.stats?.knowledgePoints, 4);
assert.equal(manifest.stats?.questions, 10);
assert.doesNotMatch(
  section.knowledgePoints.map((point) => point.title).join('|'),
  /理论知识|讲课视频|作业/,
  '不得生成“理论知识”“讲课视频”或“作业”泛化卡',
);

const overview = content.overviews?.[section.id];
assert.ok(overview, '第1.2节必须保留 overview');
assert.equal(overview.title, '第1.2节 氧化');
assert.ok(blocksOfType(overview.blocks, 'paragraph').length >= 1, 'overview 必须使用原生 paragraph');
assert.equal(countNativeImages(overview.blocks), 1, 'overview 必须保留原站 BG3 图片且只出现一次');
assert.equal(blocksOfType(overview.blocks, 'html').length, 0, 'overview 不得使用 html 兜底');

const pointEntries = section.knowledgePoints.map((point) => {
  const entry = content.knowledgePoints?.[point.id];
  assert.ok(entry, `content 缺少知识卡 ${point.id}`);
  assert.equal(entry.title, point.title, `${point.id} 的 manifest/content 标题不一致`);
  return { ...point, entry };
});
const theoryPoints = pointEntries.slice(0, 3);
const experimentPoint = pointEntries[3];
const expectedTheoryShape = {
  介质薄膜: { tables: 2, images: 1, lists: [] },
  二氧化硅膜: { tables: 1, images: 1, lists: [5, 5] },
  氧化工艺: { tables: 2, images: 4, lists: [2] },
};

for (const point of theoryPoints) {
  const blocks = point.entry.blocks || [];
  const nested = [...walkBlocks(blocks)];
  const sourceFile = THEORY_SOURCES.get(point.title);
  const sourceSection = theorySourceRoot(sourceFile);
  assert.equal(blocks.at(-1)?.type, 'sectionQuiz', `${point.title} 卡片末尾必须是 sectionQuiz`);
  assert.equal(blocks.at(-1)?.quizRef, point.id, `${point.title} sectionQuiz 必须引用自身知识点 ID`);
  assert.equal(blocksOfType(blocks, 'html').length, 0, `${point.title} 理论卡禁止 html 兜底`);
  assert.ok(blocksOfType(blocks, 'paragraph').length >= 1, `${point.title} 缺少原生 paragraph`);
  assert.equal(blocksOfType(blocks, 'paramsTable').length, expectedTheoryShape[point.title].tables, `${point.title} 原站静态表未完整转换`);
  assert.equal(countNativeImages(blocks), expectedTheoryShape[point.title].images, `${point.title} 原站图片未完整或被重复转换`);
  assert.deepEqual(blocksOfType(blocks, 'list').map((list) => list.items?.length), expectedTheoryShape[point.title].lists, `${point.title} 的编号段落未正确转换为原生 list`);
  assert.doesNotMatch(JSON.stringify(blocks), /"(?:style|class|className|color|fontSize|width)"\s*:/, `${point.title} 混入原站/硬编码视觉字段`);
  assert.doesNotMatch(JSON.stringify(blocks), /ax-|rgb\(|#[0-9a-f]{3,8}\b/i, `${point.title} 混入原站 class 或硬编码色值`);
  for (const block of nested.filter((item) => ['heading', 'numTitle', 'boldCaption'].includes(item?.type))) {
    assert.notEqual(normalizeText(block.text), point.title, `${point.title} 的蓝色大标题与卡片标题重复，必须删除`);
  }
  for (const block of nested.filter((item) => item?.type === 'paragraph')) {
    assert.notEqual(blockText(block), point.title, `${point.title} 的蓝色大标题不得降级成重复正文段落`);
  }
  assert.equal(generatedTheoryText(blocks), sourceTheoryText(sourceSection), `${point.title} 原生块未逐字、逐序保留全部理论正文`);
  const sourceTables = sourceTableSignatures(sourceSection);
  assert.deepEqual(
    generatedTableSignatures(blocks),
    sourceTables.map(({ headers, rows }) => ({ headers, rows })),
    `${point.title} 表格单元格文字或 rowspan/colspan 未逐项保留`,
  );
  for (const table of sourceTables.filter((item) => item.caption)) {
    assert.equal(table.captionColspan, table.headers.reduce((total, cell) => total + cell.colspan, 0), `${point.title} 表格标题合并列数与表头不一致`);
    assert.ok(blocksOfType(blocks, 'boldCaption').some((block) => normalizeText(block.text) === table.caption), `${point.title} 表格标题行未转换为原生 boldCaption`);
  }
  assert.deepEqual(generatedTheoryImages(blocks), sourceTheoryImages(sourceSection, sourceFile), `${point.title} 图片资源、空 alt 或原始顺序未逐项保留`);
}
assert.ok(theoryPoints.some((point) => blocksOfType(point.entry.blocks, 'imageGroup').length > 0), '三张理论卡必须包含原生 imageGroup');
assert.equal(blocksOfType(theoryPoints.find((point) => point.title === '氧化工艺').entry.blocks, 'imageGroup').length, 1, '氧化工艺的原站双图必须转换为 imageGroup');
const theoryTabSets = theoryPoints.flatMap((point) => blocksOfType(point.entry.blocks, 'tabSet'));
const lectureTabs = theoryTabSets.flatMap((tabSet) => tabSet.tabs || []).filter((tab) => tab.label === '讲解视频');
assert.equal(lectureTabs.length, 1, '讲课视频-氧化必须进入相关理论卡唯一的“讲解视频”tab');
assert.equal(
  theoryPoints.filter((point) => blocksOfType(point.entry.blocks, 'tabSet').some((tabSet) => (tabSet.tabs || []).some((tab) => tab.label === '讲解视频'))).map((point) => point.title).join(','),
  '氧化工艺',
  '讲课视频-氧化只能归入“氧化工艺”卡',
);
const lectureVideos = lectureTabs.flatMap((tab) => blocksOfType(tab.blocks, 'video'));
assert.equal(lectureVideos.length, 1, '“讲解视频”tab 必须包含一个本地 video 块');
assert.equal(lectureVideos[0].title, '讲课视频-氧化');

assert.equal(blocksOfType(experimentPoint.entry.blocks, 'html').length, 0, '实验 1 的四个 tab 也必须原生化，不得使用 html 兜底');
const experimentTabSets = blocksOfType(experimentPoint.entry.blocks, 'tabSet');
assert.equal(experimentTabSets.length, 1, '实验 1 必须用单一 tabSet 保留原站分栏');
const experimentTabs = experimentTabSets[0].tabs || [];
assert.deepEqual(
  experimentTabs.map((tab) => tab.label),
  ['热氧化原理', '温度曲线参数设置及仿真', '生产操作质量检验', '热分解淀积'],
  '实验 1 的四个原站 tab 名称和顺序必须逐项保留',
);

const principleBlocks = experimentTabs[0].blocks;
const principleText = nativeContentText(principleBlocks);
assert.match(principleText, /把衬底片置于1000℃以上的高温下/, '“热氧化原理”遗漏高温氧化原理正文');
assert.match(principleText, /实验目的：掌握热氧化工艺原理和生产操作/, '“热氧化原理”遗漏实验目的');
const principleTable = blocksOfType(principleBlocks, 'paramsTable')[0];
assert.ok(principleTable, '“热氧化原理”必须把比较表转成 paramsTable');
assert.deepEqual((principleTable.headers || []).map(cellText), ['类型', '速度', '均匀重复性', '结构', '掩蔽性']);
assert.deepEqual((principleTable.rows || []).map((row) => row.map(cellText)), [
  ['干氧', '慢', '好', '致密', '好'],
  ['湿氧', '快', '较好', '中', '中'],
  ['水汽', '较快', '差', '疏松', '差'],
]);
assert.equal(countNativeImages(principleBlocks), 1, '“热氧化原理”必须保留 EBG1 图片');
assert.deepEqual(blocksOfType(principleBlocks, 'video').map((video) => video.title), ['视频:热氧化原理']);

const qualityBlocks = experimentTabs[2].blocks;
const qualityText = nativeContentText(qualityBlocks);
assert.match(qualityText, /氧化炉管内氧气不均匀/, '“生产操作质量检验”遗漏缺陷原因 01');
assert.match(qualityText, /去离子水的电阻率在18M以上\(25℃\)\./, '“生产操作质量检验”遗漏解决方法 14');
const qualitySelects = blocksOfType(qualityBlocks, 'paramSelect');
assert.equal(qualitySelects.length, 1, '“生产操作质量检验”参数答题表必须转为 paramSelect');
const qualityParams = flattenParamSelect(qualitySelects[0]);
assert.deepEqual(qualityParams.map((param) => param.label), [
  '厚度不均匀缺陷原因', '厚度不均匀缺陷解决方法',
  '表面斑点缺陷原因', '表面斑点缺陷解决方法',
  '针孔缺陷原因', '针孔缺陷解决方法',
  '钠离子沾污缺陷原因', '钠离子沾污缺陷解决方法',
]);
assert.deepEqual(qualityParams.map((param) => param.options), [
  ['01', '02', '03', '04'], ['11', '12', '13', '14'],
  ['01', '02', '03', '04'], ['11', '12', '13', '14'],
  ['01', '02', '03', '04'], ['11', '12', '13', '14'],
  ['01', '02', '03', '04'], ['11', '12', '13', '14'],
]);
assert.deepEqual(qualityParams.map((param) => param.answerIndex), [1, 1, 2, 2, 3, 3, 4, 4], '质量检验答案必须来自实验 1 满分审计');
assert.deepEqual(blocksOfType(qualityBlocks, 'video').map((video) => video.title), ['视频:热氧化炉生产操作']);

const depositionBlocks = experimentTabs[3].blocks;
const depositionText = nativeContentText(depositionBlocks);
assert.match(depositionText, /硅片本身不参加形成氧化膜的反应/, '“热分解淀积”遗漏基本原理正文');
assert.match(depositionText, /低温淀积/, '“热分解淀积”遗漏低温工艺信息');
assert.equal(countNativeImages(depositionBlocks), 1, '“热分解淀积”必须保留 EBG2 图片');
assert.deepEqual(blocksOfType(depositionBlocks, 'video').map((video) => video.title), ['视频:热分解淀积原理']);

const simulationBlocks = experimentTabs[1].blocks;
const sandboxes = blocksOfType(simulationBlocks, 'sandbox');
assert.equal(sandboxes.length, 1, '温度曲线必须重构为一个离线 sandbox');
const sandbox = sandboxes[0];
const sandboxHtml = sandbox.html || '';
const mainLearnSource = readFileSync(MAIN_LEARN_SOURCE, 'utf8');
assert.equal((sandboxHtml.match(/<select\b/gi) || []).length, 5, '温度曲线 sandbox 必须含原站五个参数下拉');
for (const text of [
  '氧化温度曲线参数设置及仿真', '炉子预热阶段', '炉子保温阶段', '氧化加温阶段', '炉子降温阶段',
  '干氧氧化时间', '湿氧氧化时间', '60min', '10min', '3L/min', '25℃', '30min',
  '干氧氧化炉温度曲线', '湿氧氧化炉温度曲线', '请选择预热温度!', '请选择保温温度!',
  '请选择加温温度!', '请选择干氧氧化时间!', '请选择湿氧氧化时间!',
]) assert.match(sandboxHtml, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `温度曲线 sandbox 遗漏原题信息: ${text}`);
assert.match(sandboxHtml, /<canvas\b/i, '温度曲线 sandbox 必须真实绘制 Canvas');
assert.match(sandboxHtml, /var\(--(?:paper|surface|card|ink|text|line|gold|seal)/, 'sandbox 视觉必须调用站点注入的设计令牌');
assert.doesNotMatch(sandboxHtml, /(?:rgb|hsl)a?\(|#[0-9a-f]{3,8}\b|(?:fillStyle|strokeStyle)\s*=\s*['"](?:blue|black|red|white)['"]|:\s*(?:blue|black|red|white)\s*[;}]/i, 'sandbox 不得硬编码原站颜色');
assert.doesNotMatch(sandboxHtml, /\$\s*\(|jQuery|Submission\.php|PlayVideo\.php|XMLHttpRequest|fetch\s*\(|WebSocket|localStorage|document\.cookie|(?:window\.)?(?:parent|top)\.(?!postMessage\b)/i, 'sandbox 不得保留 jQuery、网络、PHP、存储或父页面 DOM 依赖');
assert.doesNotMatch(sandboxHtml, /图例|标准曲线/, '源 Canvas 没有文字图例，参数曲线也不得伪称固定“标准曲线”');
assert.match(sandboxHtml, /pigeon-score/, '实验参数正确答案与计分结果必须通过 pigeon-score 回传');
assert.match(sandboxHtml, /pigeon-score-clear/, '清空或切换参考答案必须通知主页面移除旧得分');
assert.match(
  mainLearnSource,
  /event\.data\?\.type === ['"]pigeon-score-clear['"]/,
  '主页面必须处理 pigeon-score-clear 并移除对应 sandbox 得分 chip',
);
assert.doesNotMatch(
  sandboxHtml,
  /selects\[index\]\.value\s*=\s*String\(spec\.correctValues\[index\]\)/,
  '操作练习初始不得预选满分参数，五个下拉必须保持空值',
);
assert.match(sandboxHtml, /data-clear-oxidation/, '温度曲线仿真必须提供清空按钮');
assert.equal(sandbox.id, 'experiment-1-oxidation-temperature-curve', '温度曲线 sandbox 必须使用稳定 id 保存练习状态');
assert.equal(sandbox.modeSwitch, true, '温度曲线参考答案必须使用 iframe 外的站点原生模式控件');
assert.equal(parse(sandboxHtml).querySelectorAll('button').length, 2, 'iframe 内只保留温度曲线仿真与清空按钮');
assert.doesNotMatch(sandboxHtml, /data-answer-oxidation|data-oxidation-mode/, 'iframe 内不得重复渲染答案按钮或模式标签');
assert.match(sandboxHtml, /pigeon-sandbox-mode/, 'sandbox 必须监听站点外层模式切换消息');
assert.match(mainLearnSource, /action === ['"]switch-sandbox-mode['"]/, '主页面必须处理 sandbox 外层模式按钮');
assert.match(mainLearnSource, /type:\s*['"]pigeon-sandbox-mode['"]/, '主页面必须向对应 sandbox 发送模式消息');
assert.match(
  sandboxHtml,
  /\.oxidation-primary-button\{[^}]*background:\s*var\(--ink\)[^}]*color:\s*var\(--paper\)/,
  '温度曲线仿真主按钮必须使用项目黑底白字令牌样式',
);
assert.match(
  sandboxHtml,
  /\.oxidation-simulation select\{[^}]*font-size:\s*\.8125rem[^}]*line-height:\s*1\.7[^}]*padding:\s*\.4375rem \.75rem/,
  '温度曲线下拉必须使用与外层 tab 一致的紧凑字号、行高和内边距',
);
assert.match(sandboxHtml, /html,body\{overflow:hidden\}/, '温度曲线 sandbox 必须禁用内部文档滚动');
assert.match(sandboxHtml, /setTimeout\(reportHeight,0\)/, '温度曲线 sandbox 必须在父页监听建立后补报高度');
assert.match(sandboxHtml, /Math\.max\(760,/, '温度曲线 sandbox 不得在隐藏 tab 初始化时缩短为零高度');
assert.match(sandboxHtml, /root\._heightObserver=new ResizeObserver\(reportHeight\);root\._heightObserver\.observe\(root\)/, '温度曲线 sandbox 必须持续跟随响应式内容高度');
assert.match(sandboxHtml, /event\.data\.type==='pigeon-sandbox-layout'\)\{setTimeout\(reportHeight,0\)/, '温度曲线 sandbox 必须在 tab 激活后执行离屏测高');
assert.match(sandboxHtml, /root\._heightVisibility=new IntersectionObserver/, '温度曲线 sandbox 必须在隐藏 tab 进入视口时重新测高');
assert.match(sandboxHtml, /event\.data\.type==='pigeon-sandbox-layout'/, '温度曲线 sandbox 必须响应 tab 激活后的重新测高通知');
assert.match(readFileSync(CONTENT_RENDERER_SOURCE, 'utf8'), /postMessage\(\{ type: 'pigeon-sandbox-layout' \}/, '原生 tab 激活后必须通知其中的 sandbox 重新测高');
assert.match(readFileSync(CONTENT_RENDERER_SOURCE, 'utf8'), /addEventListener\('load', \(\) => requestAnimationFrame\(notifyLayout\)\)/, '首次激活 tab 必须等 sandbox 加载完成后再通知测高');
assert.match(sandboxHtml, /parent\.postMessage\(\{pigeonHeight:Math\.ceil\(height\)\}/, '温度曲线 sandbox 必须把完整高度回传外层');
assert.match(sandboxHtml, /spec\.correctValues\[index\]/, '参考答案模式必须来源于共享模型 correctValues');
assert.match(sandboxHtml, /select(?:s\[index\])?\.disabled\s*=\s*true/, '参考答案模式必须将参数控件切换为只读');
assert.match(sandboxHtml, /ctx\.clearRect\(0,0,canvas\.width,canvas\.height\)/, '清空按钮必须清除 Canvas');
const clickHandlerIndex = sandboxHtml.indexOf("addEventListener('click'");
assert.ok(clickHandlerIndex >= 0, '温度曲线必须保留点击后仿真的原始触发边界');
const computeCalls = [...sandboxHtml.matchAll(/model\.computeOxidationCurves\s*\(/g)];
assert.equal(computeCalls.length, 1, 'sandbox 必须只通过共享模型计算一次当前参数曲线');
assert.ok(computeCalls[0].index > clickHandlerIndex, '共享模型不得在初始化阶段计算或绘制固定曲线');
const curveDrawCalls = [...sandboxHtml.matchAll(/drawCurve\s*\(\s*spec\.origins\.(?:dry|wet)/g)];
assert.equal(curveDrawCalls.length, 2, '点击后必须分别绘制干氧和湿氧两条参数曲线');
assert.ok(curveDrawCalls.every((match) => match.index > clickHandlerIndex), 'Canvas 点击前必须保持源页面的空白初始态');
assert.ok(sandboxHtml.indexOf("ctx.fillText('干氧氧化炉温度曲线'") > clickHandlerIndex, '曲线标题不得在点击前写入 Canvas');

const modelDependency = (sandbox.dependencies || []).find((item) => /(?:oxidation|temperature|curve).*(?:model|formula)|(?:model|formula).*(?:oxidation|temperature|curve)/i.test(item) && /\.m?js$/i.test(item));
assert.ok(modelDependency, 'sandbox.dependencies 必须声明可独立测试的氧化温度曲线模型模块');
assertLocalAsset(modelDependency, 'temperature curve model');
assert.match(sandboxHtml, new RegExp(modelDependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'sandbox HTML 必须实际加载其模型依赖');
assert.match(sandboxHtml, /data-model-dependency\s*=\s*["'][^"']+["']/, 'sandbox HTML 必须记录内联模型的本地依赖来源');
assert.match(sandboxHtml, /OxidationCurveModel/, 'sandbox HTML 必须内联执行共享模型源，不能依赖 opaque sandbox 的 blob 脚本加载');
assert.doesNotMatch(sandboxHtml, /<script\b[^>]*\bsrc\s*=/i, 'opaque sandbox 不得通过 blob 外部脚本加载模型');
const modelPath = path.join(COURSE_DIR, modelDependency);
const model = await import(`${pathToFileURL(modelPath).href}?golden-test=${statSync(modelPath).mtimeMs}`);
const curveSpec = model.oxidationCurveSpec || model.OXIDATION_CURVE_SPEC || model.spec;
assert.ok(curveSpec, '模型模块必须导出 oxidationCurveSpec（或 OXIDATION_CURVE_SPEC/spec）');
assert.deepEqual(curveSpec.dw || curveSpec.scale, [3, 2], '模型必须保留原脚本 dw=[3,2]');
assert.deepEqual(curveSpec.origins?.dry, [60, 330], '模型必须保留干氧曲线原点 [60,330]');
assert.deepEqual(curveSpec.origins?.wet, [60, 670], '模型必须保留湿氧曲线原点 [60,670]');
assert.equal(curveSpec.axes?.xMinutes, 200, '模型必须保留 x 轴 200min');
assert.equal(curveSpec.axes?.yDegrees, 1500, '模型必须保留 y 轴 1500℃');
assert.equal(curveSpec.axes?.xTickMinutes, 10, '模型必须保留 x 轴每 10min 一格');
assert.equal(curveSpec.axes?.yTickDegrees, 100, '模型必须保留 y 轴每 100℃ 一格');
assert.equal(curveSpec.axes?.xUnit, 'min', '模型必须保留 x 轴单位 min');
assert.equal(curveSpec.axes?.yUnit, '℃', '模型必须保留 y 轴单位 ℃');
assert.deepEqual(curveSpec.correctValues, [800, 850, 920, 20, 60], '模型必须保留满分审计的五参数正确值');
assert.deepEqual(curveSpec.optionSets, [
  [25, 500, 800, 850, 920, 1100, 1200, 1350],
  [25, 500, 800, 850, 920, 1100, 1200, 1350],
  [25, 500, 800, 850, 920, 1100, 1200, 1350],
  [5, 10, 20, 30, 40, 50, 60, 80],
  [5, 10, 20, 30, 40, 50, 60, 80],
], '模型必须逐项保留五个下拉的原始选项');
const computeCurves = model.computeOxidationCurves || model.computeTemperatureCurves;
assert.equal(typeof computeCurves, 'function', '模型必须导出 computeOxidationCurves(values) 可测试接口');
function curvePoints(result, kind) {
  const points = result?.relativePoints?.[kind] || result?.[`${kind}Points`] || result?.curves?.[kind] || result?.[kind];
  assert.ok(Array.isArray(points), `模型结果缺少 ${kind} 曲线点列`);
  return points.map((point) => Array.isArray(point) ? point : [point.x, point.y]);
}
const sourceResult = computeCurves([800, 850, 920, 20, 60]);
assert.deepEqual(curvePoints(sourceResult, 'dry'), [[180, -160], [210, -170], [270, -184], [330, -184], [420, -5]], '干氧曲线必须保留原 ptsd 公式');
assert.deepEqual(curvePoints(sourceResult, 'wet'), [[180, -160], [210, -170], [270, -184], [450, -184], [540, -5]], '湿氧曲线必须保留原 ptsd 公式');
const changedResult = computeCurves([500, 800, 1100, 5, 80]);
assert.notDeepEqual(curvePoints(changedResult, 'dry'), curvePoints(sourceResult, 'dry'), '不同输入必须产生不同干氧曲线');
assert.notDeepEqual(curvePoints(changedResult, 'wet'), curvePoints(sourceResult, 'wet'), '不同输入必须产生不同湿氧曲线');

const sourceQuestions = parseHomeworkSource();
const questionBank = quiz.questionBank || {};
assert.equal(Object.keys(questionBank).length, 10, '黄金样板 questionBank 必须只定义作业 2 的十题');
const generatedByStem = new Map();
for (const [questionId, question] of Object.entries(questionBank)) {
  const stem = normalizeText(question.stem);
  assert.ok(stem, `${questionId} stem 为空`);
  assert.ok(!generatedByStem.has(stem), `questionBank 重复定义相同题干: ${stem}`);
  generatedByStem.set(stem, { questionId, question });
  assert.equal(question.type, 'single', `${questionId} 必须是 single`);
  assert.ok(!('explain' in question) || !normalizeText(question.explain), `${questionId} 本轮不得生成题目解析`);
}
const generatedBySourceId = new Map();
for (const expected of sourceQuestions) {
  const generated = generatedByStem.get(expected.stem);
  assert.ok(generated, `questionBank 缺少源题 ${expected.sourceQuestionId}: ${expected.stem}`);
  assert.deepEqual(generated.question.options?.map(normalizeText), expected.options, `${expected.sourceQuestionId} 的完整选项正文未逐项保留`);
  assert.equal(generated.question.answer, expected.answer, `${expected.sourceQuestionId} 答案与满分候选答案不一致`);
  assert.ok(generated.question.options.some((option) => normalizeText(option).startsWith(`${generated.question.answer}. `)), `${expected.sourceQuestionId} 的答案不在选项中`);
  generatedBySourceId.set(expected.sourceQuestionId, generated.questionId);
}

const theoryIds = new Set(theoryPoints.map((point) => point.id));
assert.deepEqual(new Set(Object.keys(quiz.sectionQuizzes || {})), theoryIds, 'sectionQuizzes 必须且只能对应三张理论卡');
const sectionRefs = Object.values(quiz.sectionQuizzes || {}).flat();
const examRefs = quiz.examQuestions?.['1'] || [];
assert.equal(sectionRefs.length, 9, '本节九题必须按知识相关性进入唯一理论知识点小测');
assert.equal(new Set(sectionRefs).size, 9, '知识点小测不得重复引用题目');
assert.equal(examRefs.length, 10, '十题必须在第 1 章章节测试中各出现一次');
for (const questionId of Object.keys(questionBank)) {
  assert.equal(examRefs.filter((id) => id === questionId).length, 1, `${questionId} 必须在章节测试中恰好出现一次`);
}

assert.ok(knowledgeMap && typeof knowledgeMap === 'object' && !Array.isArray(knowledgeMap), 'question-knowledge-map.json 必须是版本化对象');
assert.ok(knowledgeMap.schemaVersion || knowledgeMap.version, 'question-knowledge-map.json 缺少版本字段');
assert.equal(knowledgeMap.releaseReady, true, '满分答案与知识相关性映射通过后样板必须可验收');
assert.equal(knowledgeMap.status, 'ready', '映射审计状态必须为 ready');
assert.equal(knowledgeMap.answerAuthority, 'full-score-audit', '正确答案必须统一以满分审计为权威');
const mappings = knowledgeMap.mappings;
assert.ok(Array.isArray(mappings), 'question-knowledge-map.json 必须包含 mappings[]');
assert.equal(mappings.length, 10, 'question-knowledge-map.json 必须恰有十条唯一映射');
assert.equal(new Set(mappings.map((entry) => entry.questionId)).size, 10, 'question-knowledge-map.json 存在重复 questionId');
assert.deepEqual(new Set(mappings.map((entry) => entry.questionId)), new Set(Object.keys(questionBank)), '题目映射与 questionBank 不一致');

const pointIdByTitle = new Map(theoryPoints.map((point) => [point.title, point.id]));
const expectedPointBySourceQuestion = {
  '2-1': '氧化工艺',
  '2-2': '二氧化硅膜',
  '2-3': '二氧化硅膜',
  '2-4': '介质薄膜',
  '2-5': '介质薄膜',
  '2-6': '二氧化硅膜',
  '2-7': '氧化工艺',
  '2-8': '氧化工艺',
  '2-9': '氧化工艺',
};
const allowedTheorySources = new Set([...THEORY_SOURCES.values()].map((file) => path.normalize(file).toLowerCase()));
for (const mapping of mappings) {
  const sourceQuestionId = mapping.sourceQuestionId || mapping.source?.questionId;
  assert.match(sourceQuestionId || '', /^2-(?:[1-9]|10)$/, `${mapping.questionId} 缺少原作业题号 sourceQuestionId`);
  assert.equal(mapping.sourceHomework, '作业2', `${mapping.questionId} 必须记录原作业“作业2”`);
  const sourceFile = resolveEvidenceFile(mapping.sourceFile || mapping.source?.file);
  assert.equal(path.normalize(sourceFile).toLowerCase(), path.normalize(path.join(SOURCE_SECTION, 'homework.html')).toLowerCase(), `${mapping.questionId} sourceFile 必须指向 0-1/homework.html`);
  assert.ok(existsSync(sourceFile), `${mapping.questionId} 题面源文件不存在`);
  assert.equal(mapping.questionId, generatedBySourceId.get(sourceQuestionId), `${sourceQuestionId} 的映射 questionId 与题库不一致`);
  assert.ok(Array.isArray(mapping.stemKeywords) && mapping.stemKeywords.length > 0, `${mapping.questionId} 缺少 stemKeywords`);
  assert.ok(mapping.stemKeywords.some((keyword) => normalizeText(questionBank[mapping.questionId].stem).includes(normalizeText(keyword))), `${mapping.questionId} 的 stemKeywords 与题干无关`);
  assert.equal(mapping.answerEvidence?.answer, questionBank[mapping.questionId].answer, `${mapping.questionId} answerEvidence 与正确答案不一致`);
  assert.equal(mapping.answerEvidence?.authority, 'full-score-audit', `${mapping.questionId} 正确答案必须标记满分审计权威`);
  const answerSource = resolveEvidenceFile(mapping.answerEvidence?.sourceFile);
  assert.equal(path.normalize(answerSource).toLowerCase(), path.normalize(CANDIDATE_FILE).toLowerCase(), `${mapping.questionId} 答案必须直接指向满分候选答案文件`);
  assert.equal(mapping.answerEvidence?.sourcePointer, `/2/${Number(sourceQuestionId.split('-')[1]) - 1}`, `${mapping.questionId} 满分候选答案 JSON Pointer 不正确`);
  assert.ok(existsSync(resolveEvidenceFile(mapping.answerEvidence?.candidateSubmissionScoreFile)), `${mapping.questionId} 候选答案满分提交证据不存在`);
  assert.ok(existsSync(resolveEvidenceFile(mapping.answerEvidence?.fullScoreEvidenceFile)), `${mapping.questionId} 满分审计文件不存在`);
  const theoryEvidence = Array.isArray(mapping.theoryEvidence) ? mapping.theoryEvidence : [mapping.theoryEvidence];
  assert.ok(theoryEvidence.length > 0 && theoryEvidence.every(Boolean), `${mapping.questionId} 缺少证据审计记录`);
  assert.equal(mapping.status, 'resolved', `${sourceQuestionId} 必须完成唯一知识归属`);
  assert.ok(normalizeText(mapping.matchReason).length >= 8, `${mapping.questionId} 缺少可审查的匹配理由`);
  for (const evidence of theoryEvidence) {
    const evidenceFile = resolveEvidenceFile(evidence.sourceFile);
    assert.ok(existsSync(evidenceFile), `${mapping.questionId} 归属证据文件不存在`);
    const quote = normalizeText(evidence.quote);
    assert.ok(quote.length >= 4, `${mapping.questionId} 归属证据 quote 过短或为空`);
    assert.ok(sourcePlainText(evidenceFile).includes(quote), `${mapping.questionId} 归属证据 quote 未在源文件中逐字找到: ${quote}`);
  }
  if (sourceQuestionId === '2-10') {
    assert.equal(mapping.knowledgePointId, '1-4-1', '2-10 必须唯一映射到第1.4节物理气相淀积知识卡');
    assert.equal(mapping.targetSectionId, '1.4', '2-10 必须记录后续目标为第1.4节物理淀积');
    assert.match(JSON.stringify(mapping), /物理气相淀积/, '2-10 必须记录 future target“物理气相淀积”');
    assert.ok(theoryEvidence.some((evidence) => path.normalize(resolveEvidenceFile(evidence.sourceFile)).toLowerCase() === path.normalize(CROSS_SECTION_THEORY).toLowerCase()), '2-10 必须附第1.4节物理气相淀积的跨节证据');
    assert.equal(sectionRefs.filter((id) => id === mapping.questionId).length, 0, '2-10 不得错误进入氧化小测');
    continue;
  }
  assert.ok(theoryIds.has(mapping.knowledgePointId), `${mapping.questionId} 必须唯一归属本节理论知识卡`);
  assert.equal(mapping.knowledgePointId, pointIdByTitle.get(expectedPointBySourceQuestion[sourceQuestionId]), `${sourceQuestionId} 未按知识相关性归入正确理论卡`);
  assert.equal(sectionRefs.filter((id) => id === mapping.questionId).length, 1, `${mapping.questionId} 必须在一个知识点小测中恰好出现一次`);
  assert.ok(theoryEvidence.some((evidence) => allowedTheorySources.has(path.normalize(resolveEvidenceFile(evidence.sourceFile)).toLowerCase())), `${mapping.questionId} 缺少本节理论主题的直接相关性证据`);
}
for (const point of theoryPoints) {
  const mappedIds = mappings.filter((entry) => entry.status === 'resolved' && entry.knowledgePointId === point.id).map((entry) => entry.questionId);
  assert.deepEqual(new Set(quiz.sectionQuizzes[point.id]), new Set(mappedIds), `${point.title} 小测引用必须完全由 question-knowledge-map.json 驱动`);
}

scanCourseResources(manifest, 'manifest');
scanCourseResources(content, 'content');
scanCourseResources(quiz, 'quiz');
scanCourseResources(knowledgeMap, 'questionKnowledgeMap');
if (manifest.cover) {
  assert.doesNotMatch(manifest.cover, /(?:^|\/)\.\.(?:\/|$)|^(?:[a-z]+:|\/|\\)/i, `manifest.cover 必须是包内相对路径: ${manifest.cover}`);
  assert.ok(existsSync(path.join(COURSE_DIR, manifest.cover)), `manifest.cover 不存在: ${manifest.cover}`);
}

const assetsRoot = path.join(COURSE_DIR, 'assets');
assert.ok(existsSync(assetsRoot), '黄金样板缺少 assets/');
const pending = [assetsRoot];
while (pending.length) {
  const directory = pending.pop();
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) { pending.push(file); continue; }
    const relativeAsset = path.relative(COURSE_DIR, file).replace(/\\/g, '/');
    if (/^assets\/(?:images|media)\//.test(relativeAsset)) {
      const expectedHash = path.basename(file, path.extname(file));
      assert.match(expectedHash, /^[a-f0-9]{64}$/, `抓取资源文件名必须是源 SHA-256: ${relativeAsset}`);
      assert.equal(sha256File(file), expectedHash, `抓取资源内容 SHA-256 与文件名不一致: ${relativeAsset}`);
    }
    if (!/\.(?:html?|css|m?js|json|txt|svg)$/i.test(name)) continue;
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /(?:https?:)?\/\//i, `离线资源残留外链: ${path.relative(COURSE_DIR, file)}`);
    assert.doesNotMatch(text, /\.php(?:\?|\b)/i, `离线资源残留 PHP 依赖: ${path.relative(COURSE_DIR, file)}`);
  }
}
assert.equal(sha256File(modelPath), sha256File(MODEL_SOURCE), '课程内 Canvas 模型必须与唯一源模型逐字节一致');

console.log('oxidation-golden: ok');
