#!/usr/bin/env node
// build-oxidation-golden.mjs — 从只读 0-1 抓取证据生成隔离的氧化黄金样板。
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORTS = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const CAPTURE = path.join(REPORTS, 'source-capture');
const SECTION_DIR = path.join(CAPTURE, 'sections', '0-1');
const ACTIVITY_DIR = path.join(REPORTS, 'activity-details');
const COURSE_DIR = path.join(ROOT, 'courses', 'autosmt-previews', 'autosmt-oxidation-golden');
const MODEL_SOURCE = path.join(ROOT, 'tools', 'autosmt-2026', 'lib', 'oxidation-temperature-curve-model.js');
const HOMEWORK_FILE = path.join(SECTION_DIR, 'homework.html');
const SCORE_FILE = path.join(REPORTS, 'final-score-before-capture.json');
const CANDIDATE_SCORE_FILE = path.join(REPORTS, 'score-after-all-homework-candidates.json');
const CANDIDATE_FILE = path.join(REPORTS, 'candidate-answers.json');
const THEORY_FILES = {
  '介质薄膜': path.join(CAPTURE, 'resources', '5e374a19868f7f1d0c0e8ef95e253f5e92523583096550df643bb2557f815ea1.html'),
  '二氧化硅膜': path.join(CAPTURE, 'resources', '5ced2f3c5f05eac6860ba6ede5410c0ec585eca8578a8eacc8149bb6928551a0.html'),
  '氧化工艺': path.join(CAPTURE, 'resources', 'dd8f88bcf157d7ae2b50c664bd565894ba51c09282b6c2817c85e7723ad5629f.html'),
};
const CROSS_SECTION_THEORY = path.join(
  CAPTURE,
  'resources',
  'dac031f11abd66c097c32bba44540bd670c3f1b5254422f89d55635355231a53.html',
);

const require = createRequire(import.meta.url);
const { parse } = require(path.join(ROOT, 'app', 'node_modules', 'node-html-parser'));
const curveModel = require(MODEL_SOURCE);

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const gb18030 = new TextDecoder('gb18030');

// ==== 源读取与硬停止定位 ====

function repoPath(file) {
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function loadMixedText(file) {
  if (!existsSync(file)) throw new Error(`[HARD STOP] 源文件不存在: ${repoPath(file)}`);
  const bytes = readFileSync(file);
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return gb18030.decode(bytes);
  }
}

function loadJson(file) {
  if (!existsSync(file)) throw new Error(`[HARD STOP] 证据文件不存在: ${repoPath(file)}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagName(node) {
  return node?.tagName ? node.tagName.toLowerCase() : '';
}

function elementChildren(node) {
  return (node?.childNodes || []).filter((child) => Boolean(child?.tagName));
}

function domPath(node) {
  const parts = [];
  let cursor = node;
  while (cursor?.parentNode) {
    const tag = tagName(cursor);
    if (tag) {
      const siblings = elementChildren(cursor.parentNode).filter((sibling) => tagName(sibling) === tag);
      const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(cursor) + 1})` : '';
      parts.unshift(`${tag}${suffix}`);
    }
    cursor = cursor.parentNode;
  }
  return parts.join(' > ') || '(document)';
}

function snippet(nodeOrText) {
  const value = typeof nodeOrText === 'string'
    ? nodeOrText
    : nodeOrText?.outerHTML || nodeOrText?.textContent || '';
  return normalizeText(value).slice(0, 280);
}

function hardStop(sourceFile, node, message, rawFragment) {
  const location = node ? domPath(node) : '(source)';
  const fragment = snippet(rawFragment ?? node);
  throw new Error(
    `[HARD STOP] ${message}\n源文件: ${repoPath(sourceFile)}\nDOM路径: ${location}\n原始片段: ${fragment || '(empty)'}`,
  );
}

function expect(condition, sourceFile, node, message, rawFragment) {
  if (!condition) hardStop(sourceFile, node, message, rawFragment);
}

function parseSource(file) {
  return parse(loadMixedText(file), {
    lowerCaseTagName: true,
    comment: false,
    blockTextElements: { script: true, style: true, pre: true },
  });
}

function queryOne(root, selector, sourceFile, message) {
  const matches = root.querySelectorAll(selector);
  expect(matches.length === 1, sourceFile, root, `${message}，实际匹配 ${matches.length} 个`, selector);
  return matches[0];
}

function assertDirectTags(root, expectedTags, sourceFile) {
  const children = elementChildren(root);
  const actual = children.map(tagName);
  expect(
    JSON.stringify(actual) === JSON.stringify(expectedTags),
    sourceFile,
    root,
    `未知或变化的顶层 DOM 结构，期望 ${expectedTags.join(' > ')}，实际 ${actual.join(' > ')}`,
  );
  return children;
}

function assertAllowedDescendants(root, allowedTags, sourceFile) {
  const allowed = new Set(allowedTags);
  const pending = [...elementChildren(root)];
  while (pending.length) {
    const node = pending.shift();
    expect(allowed.has(tagName(node)), sourceFile, node, `不支持的 <${tagName(node)}> 结构`);
    pending.push(...elementChildren(node));
  }
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

function sourcePlainText(file) {
  return normalizeText(htmlToText(loadMixedText(file)
    .replace(/<style\b[^>]*>[^]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[^]*?<\/script>/gi, ' ')));
}

function paragraphLines(node, sourceFile) {
  const lines = [''];
  function visit(child) {
    if (child.nodeType === 3) {
      lines[lines.length - 1] += child.textContent;
      return;
    }
    const tag = tagName(child);
    if (tag === 'br') {
      lines.push('');
      return;
    }
    if (tag === 'img') hardStop(sourceFile, child, '段落拆行时遇到内联图片，必须由图片转换分支处理');
    expect(['span', 'font', 'b', 'strong', 'o:p', 'i', 'em'].includes(tag), sourceFile, child, `不支持的段落内联标签 <${tag}>`);
    for (const nested of child.childNodes || []) visit(nested);
  }
  for (const child of node.childNodes || []) visit(child);
  return lines.map(normalizeText).filter(Boolean);
}

function extractScriptString(root, name, sourceFile) {
  const scripts = root.querySelectorAll('script').map((script) => script.textContent).join('\n');
  const match = scripts.match(new RegExp(`var\\s+${name}\\s*=\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`, 's'));
  expect(Boolean(match), sourceFile, root, `脚本变量 ${name} 缺失`);
  return match[2].replace(/\\\//g, '/');
}

// ==== 离线资源闭包 ====

const staticMap = loadJson(path.join(REPORTS, 'resource-capture-static-v1.json')).captured;
const theoryMap = loadJson(path.join(REPORTS, 'resource-capture-theory-v1.json')).captured;
const videoMap = loadJson(path.join(REPORTS, 'resource-capture-video-v1.json')).captured;
const pendingCopies = [];
const copiedSources = new Map();
const sourceHashes = new Map();

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function sourceHash(file) {
  if (!sourceHashes.has(file)) sourceHashes.set(file, sha256File(file));
  return sourceHashes.get(file);
}

function captureAbsolute(entry, context) {
  expect(Boolean(entry?.file), path.join(REPORTS, context), null, `资源映射缺少 file: ${context}`, JSON.stringify(entry));
  const source = path.join(CAPTURE, entry.file);
  expect(existsSync(source), source, null, `抓取资源不存在: ${context}`);
  if (entry.bytes != null) {
    expect(statSync(source).size === entry.bytes, source, null, `抓取资源大小与映射不一致: ${context}`);
  }
  if (entry.sha256) {
    expect(sourceHash(source) === entry.sha256, source, null, `抓取资源 SHA-256 与映射不一致: ${context}`);
  }
  return source;
}

function copyFileToCourse(source, targetRelative) {
  const normalizedTarget = targetRelative.replace(/\\/g, '/');
  expect(normalizedTarget.startsWith('assets/'), source, null, `目标资源必须位于 assets/: ${normalizedTarget}`);
  if (copiedSources.has(source)) return copiedSources.get(source);
  const target = path.join(COURSE_DIR, normalizedTarget);
  mkdirSync(path.dirname(target), { recursive: true });
  const sourceSize = statSync(source).size;
  const expectedHash = sourceHash(source);
  const targetIsCurrent = existsSync(target)
    && statSync(target).size === sourceSize
    && sha256File(target) === expectedHash;
  if (!targetIsCurrent) {
    if (sourceSize > 64 * 1024 * 1024) {
      pendingCopies.push(pipeline(createReadStream(source), createWriteStream(target)).then(() => {
        expect(sha256File(target) === expectedHash, source, null, `课程资源复制后 SHA-256 不一致: ${normalizedTarget}`);
      }));
    } else {
      copyFileSync(source, target);
      expect(sha256File(target) === expectedHash, source, null, `课程资源复制后 SHA-256 不一致: ${normalizedTarget}`);
    }
  }
  copiedSources.set(source, normalizedTarget);
  return normalizedTarget;
}

function staticEntryFor(rawSource, sourcePage, sourceFile, node) {
  const normalizedRaw = decodeURIComponent(rawSource).replace(/\\/g, '/').replace(/^\.\.\//, '');
  const matches = Object.entries(staticMap).filter(([key, entry]) => {
    const decodedKey = decodeURIComponent(key).replace(/\\/g, '/');
    const fromPage = Array.isArray(entry.sourcePages) && entry.sourcePages.includes(sourcePage);
    return fromPage && (key === rawSource || decodedKey.endsWith(`/${normalizedRaw}`));
  });
  expect(matches.length === 1, sourceFile, node, `图片映射必须唯一: ${rawSource}，实际 ${matches.length} 条`);
  return matches[0][1];
}

function copyStaticImage(rawSource, sourcePage, sourceFile, node) {
  const entry = staticEntryFor(rawSource, sourcePage, sourceFile, node);
  const source = captureAbsolute(entry, rawSource);
  return copyFileToCourse(source, `assets/images/${path.basename(entry.file)}`);
}

function copyVideo(rawSource, sourceFile, node) {
  const entry = videoMap[rawSource];
  expect(Boolean(entry), sourceFile, node, `视频未在抓取映射中找到: ${rawSource}`);
  expect(entry.contentType === 'video/mp4', sourceFile, node, `视频 contentType 不是 video/mp4: ${rawSource}`);
  const source = captureAbsolute(entry, rawSource);
  return copyFileToCourse(source, `assets/media/${entry.sha256}.mp4`);
}

function cellObject(cell, isHeader, resolveImage, sourceFile) {
  const images = cell.querySelectorAll('img');
  const text = normalizeText(cell.textContent);
  const result = {};
  if (text) result.text = text;
  if (images.length === 1) {
    expect(typeof resolveImage === 'function', sourceFile, images[0], '表内图片缺少资源解析器');
    result.image = {
      src: resolveImage(images[0]),
      alt: images[0].getAttribute('alt') || '',
    };
  } else if (images.length > 1) {
    expect(typeof resolveImage === 'function', sourceFile, images[0], '表内图片缺少资源解析器');
    result.images = images.map((image) => ({
      src: resolveImage(image),
      alt: image.getAttribute('alt') || '',
    }));
  }
  const rowspan = Number(cell.getAttribute('rowspan') || 1);
  const colspan = Number(cell.getAttribute('colspan') || 1);
  expect(Number.isInteger(rowspan) && rowspan > 0, sourceFile, cell, `非法 rowspan: ${cell.getAttribute('rowspan')}`);
  expect(Number.isInteger(colspan) && colspan > 0, sourceFile, cell, `非法 colspan: ${cell.getAttribute('colspan')}`);
  if (rowspan > 1) result.rowspan = rowspan;
  if (colspan > 1) result.colspan = colspan;
  if (isHeader || tagName(cell) === 'th') {
    result.header = true;
    result.scope = 'col';
  }
  if (!Object.keys(result).length) return '';
  if (Object.keys(result).length === 1 && 'text' in result) return result.text;
  return result;
}

function convertTable(table, sourceFile, resolveImage) {
  assertAllowedDescendants(table, ['tr', 'th', 'td', 'p', 'span', 'font', 'b', 'strong', 'o:p', 'img', 'br'], sourceFile);
  const rows = table.querySelectorAll('tr').map((row) => elementChildren(row).filter((cell) => ['th', 'td'].includes(tagName(cell))));
  expect(rows.length >= 2, sourceFile, table, '静态表格至少需要表头和一行数据');
  expect(rows.every((row) => row.length > 0), sourceFile, table, '静态表格存在空行');
  let caption = '';
  let headerIndex = 0;
  if (rows[0].length === 1 && Number(rows[0][0].getAttribute('colspan') || 1) > 1) {
    caption = normalizeText(rows[0][0].textContent);
    headerIndex = 1;
  }
  expect(rows[headerIndex + 1], sourceFile, table, '表格标题后缺少数据行');
  const headers = rows[headerIndex].map((cell) => cellObject(cell, true, resolveImage, sourceFile));
  const bodyRows = rows.slice(headerIndex + 1).map((row) => row.map((cell) => cellObject(cell, false, resolveImage, sourceFile)));
  return {
    caption,
    block: { type: 'paramsTable', headers, rows: bodyRows },
  };
}

function imageBlocks(images, sourcePage, sourceFile) {
  const converted = images.map((image) => ({
    src: copyStaticImage(image.getAttribute('src'), sourcePage, sourceFile, image),
    alt: image.getAttribute('alt') || '',
  }));
  if (converted.length === 1) return [{ type: 'image', ...converted[0] }];
  return [{ type: 'imageGroup', images: converted }];
}

function isCentered(node) {
  return /text-align\s*:\s*center/i.test(node.getAttribute('style') || '');
}

// ==== 理论、概述与讲解视频原生化 ====

function convertTheoryPage(title, sourceFile) {
  const root = parseSource(sourceFile);
  const body = queryOne(root, 'body', sourceFile, '理论页缺少唯一 body');
  const section = queryOne(body, 'div.Section0', sourceFile, '理论页缺少唯一 Section0');
  assertAllowedDescendants(section, ['p', 'div', 'table', 'tr', 'td', 'th', 'span', 'font', 'b', 'strong', 'o:p', 'img', 'br'], sourceFile);
  const children = elementChildren(section);
  expect(children.length > 1, sourceFile, section, '理论页正文为空');
  expect(tagName(children[0]) === 'p', sourceFile, children[0], '理论页首节点必须是重复主题标题');
  expect(normalizeText(children[0].textContent) === title, sourceFile, children[0], `理论页标题应为 ${title}`);
  const sourcePage = `source-capture/resources/${path.basename(sourceFile)}`;
  const blocks = [];

  for (let index = 1; index < children.length; index += 1) {
    const node = children[index];
    const tag = tagName(node);
    if (tag === 'div') {
      const tables = node.querySelectorAll('table');
      expect(tables.length === 1 && elementChildren(node).length === 1, sourceFile, node, '理论页 div 不是单一静态表格容器');
      const converted = convertTable(tables[0], sourceFile, (image) => copyStaticImage(
        image.getAttribute('src'), sourcePage, sourceFile, image,
      ));
      if (converted.caption) blocks.push({ type: 'boldCaption', text: converted.caption });
      blocks.push(converted.block);
      continue;
    }

    expect(tag === 'p', sourceFile, node, `理论页顶层不支持 <${tag}>`);
    const images = node.querySelectorAll('img');
    const text = normalizeText(node.textContent);
    if (images.length) {
      if (text) {
        blocks.push(text.length <= 30
          ? { type: 'boldCaption', text }
          : { type: 'paragraph', spans: [{ t: text }] });
      }
      blocks.push(...imageBlocks(images, sourcePage, sourceFile));
      continue;
    }
    if (!text) continue;
    expect(text !== title, sourceFile, node, `重复的蓝色大标题未删除: ${title}`);

    const listMatch = text.match(/^(\d+）)\s*(.*)$/s);
    if (listMatch) {
      const items = [];
      let cursor = index;
      while (cursor < children.length && tagName(children[cursor]) === 'p') {
        const itemText = normalizeText(children[cursor].textContent);
        const itemMatch = itemText.match(/^(\d+）)\s*(.*)$/s);
        if (!itemMatch) break;
        expect(Boolean(itemMatch[2]), sourceFile, children[cursor], '编号列表项正文为空');
        items.push([{ t: itemMatch[2] }]);
        cursor += 1;
      }
      blocks.push({ type: 'list', ordered: true, items });
      index = cursor - 1;
      continue;
    }

    if (/^\d+\s*\./.test(text)) {
      blocks.push({ type: 'numTitle', text });
      continue;
    }
    const next = children[index + 1];
    const nextHasImage = tagName(next) === 'p' && next.querySelectorAll('img').length > 0;
    if ((isCentered(node) && text.length <= 30) || (nextHasImage && text.length <= 30)) {
      blocks.push({ type: 'boldCaption', text });
      continue;
    }
    blocks.push({ type: 'paragraph', spans: [{ t: text }] });
  }

  const shapes = {
    '介质薄膜': { tables: 2, images: 1, lists: [] },
    '二氧化硅膜': { tables: 1, images: 1, lists: [5, 5] },
    '氧化工艺': { tables: 2, images: 4, lists: [2] },
  };
  const expected = shapes[title];
  const tables = blocks.filter((block) => block.type === 'paramsTable').length;
  const images = blocks.reduce((total, block) => total
    + (block.type === 'image' ? 1 : 0)
    + (block.type === 'imageGroup' ? block.images.length : 0), 0);
  const lists = blocks.filter((block) => block.type === 'list').map((block) => block.items.length);
  expect(tables === expected.tables, sourceFile, section, `${title} 静态表格数量异常: ${tables}`);
  expect(images === expected.images, sourceFile, section, `${title} 图片数量异常: ${images}`);
  expect(JSON.stringify(lists) === JSON.stringify(expected.lists), sourceFile, section, `${title} 列表形状异常: ${JSON.stringify(lists)}`);
  return blocks;
}

function convertOverview() {
  const sourceFile = path.join(SECTION_DIR, 'overview.html');
  const root = parseSource(sourceFile);
  const article = queryOne(root, '.ax-article', sourceFile, '概述缺少唯一 ax-article');
  const children = assertDirectTags(article, ['p', 'img'], sourceFile);
  const lines = paragraphLines(children[0], sourceFile);
  expect(lines.length === 1, sourceFile, children[0], `概述应为一个段落，实际 ${lines.length}`);
  const image = children[1];
  return [
    { type: 'paragraph', spans: [{ t: lines[0] }] },
    {
      type: 'image',
      src: copyStaticImage(
        image.getAttribute('src'),
        'source-capture/sections/0-1/overview.html',
        sourceFile,
        image,
      ),
      alt: image.getAttribute('alt') || '',
    },
  ];
}

function convertLecture() {
  const sourceFile = path.join(SECTION_DIR, 'lecture-video.html');
  const root = parseSource(sourceFile);
  const names = extractScriptString(root, 'strvideoname', sourceFile).split('|').filter(Boolean);
  const numbers = extractScriptString(root, 'strvideonum', sourceFile).split('|').filter(Boolean);
  expect(names.length === 1 && numbers.length === 1, sourceFile, root, '氧化讲课视频应恰有一项');
  expect(names[0] === '讲课视频-氧化' && numbers[0] === '2', sourceFile, root, '氧化讲课视频标题或编号变化');
  return {
    type: 'video',
    title: names[0],
    src: copyVideo(`PlayVideo.php?videoId=${numbers[0]}`, sourceFile, root),
  };
}

function validateMenu() {
  const sourceFile = path.join(SECTION_DIR, 'menu.html');
  const root = parseSource(sourceFile);
  const heading = queryOne(root, 'h2', sourceFile, '菜单缺少唯一章节标题');
  const headingText = normalizeText(heading.textContent);
  expect(headingText.includes('第1章 IC制造工艺'), sourceFile, heading, '菜单章标题变化');
  expect(headingText.includes('第1.2节 氧化'), sourceFile, heading, '菜单节标题变化');
  const labels = root.querySelectorAll('.ax-name').map((node) => normalizeText(node.textContent));
  expect(
    JSON.stringify(labels) === JSON.stringify(['概述', '理论知识', '讲课视频', '作业', '实验1:热氧化工艺']),
    sourceFile,
    root,
    `菜单组件变化: ${JSON.stringify(labels)}`,
  );
}

function validateTheoryIndex() {
  const sourceFile = path.join(SECTION_DIR, 'theory.html');
  const root = parseSource(sourceFile);
  const titles = extractScriptString(root, 'strllzs', sourceFile).split('|').filter(Boolean);
  expect(
    JSON.stringify(titles) === JSON.stringify(Object.keys(THEORY_FILES)),
    sourceFile,
    root,
    `理论主题名称或顺序变化: ${JSON.stringify(titles)}`,
  );
  for (const title of titles) {
    const entry = theoryMap[`../Html/${title}.html`];
    expect(Boolean(entry), sourceFile, root, `理论主题缺少抓取映射: ${title}`);
    const mappedFile = path.resolve(CAPTURE, entry.file);
    expect(mappedFile === THEORY_FILES[title], sourceFile, root, `理论主题哈希页变化: ${title} -> ${repoPath(mappedFile)}`);
    expect(entry.sourcePages?.includes('source-capture/sections/0-1/theory.html'), sourceFile, root, `理论主题来源页映射错误: ${title}`);
  }
}

// ==== 作业题面与满分答案 ====

function parseHomework() {
  const root = parseSource(HOMEWORK_FILE);
  const candidates = loadJson(CANDIDATE_FILE)['2'];
  expect(Array.isArray(candidates) && candidates.length === 10, CANDIDATE_FILE, null, '作业2满分候选答案必须恰有10项');
  const candidateScore = loadJson(CANDIDATE_SCORE_FILE).scores?.homework?.find((entry) => entry.number === 2);
  expect(candidateScore?.score === '100.00', CANDIDATE_SCORE_FILE, null, '作业2候选答案提交后缺少100.00分证据');
  const score = loadJson(SCORE_FILE).scores?.homework?.find((entry) => entry.number === 2);
  expect(score?.score === '100.00', SCORE_FILE, null, '作业2 缺少 100.00 分审计');
  const questions = [];
  for (const row of root.querySelectorAll('tr')) {
    const cells = elementChildren(row).filter((cell) => tagName(cell) === 'td');
    if (cells.length < 3) continue;
    const sourceQuestionId = normalizeText(cells[0].textContent);
    if (!/^2-\d+$/.test(sourceQuestionId)) continue;
    const letters = cells[2].querySelectorAll('option')
      .map((option) => option.getAttribute('value'))
      .filter((letter) => /^[A-Z]$/.test(letter || ''));
    const questionText = paragraphLines(cells[1], HOMEWORK_FILE).join('\n');
    const positions = letters.map((letter) => questionText.indexOf(`${letter}.`));
    positions.forEach((position, index) => expect(
      position >= 0,
      HOMEWORK_FILE,
      cells[1],
      `${sourceQuestionId} 缺少选项正文 ${letters[index]}.`,
    ));
    const stem = normalizeText(questionText.slice(0, positions[0]));
    const options = letters.map((letter, index) => {
      const start = positions[index] + 2;
      const end = positions[index + 1] ?? questionText.length;
      return `${letter}. ${normalizeText(questionText.slice(start, end))}`;
    });
    const candidateIndex = questions.length;
    const answer = candidates[candidateIndex];
    expect(options.some((option) => option.startsWith(`${answer}. `)), HOMEWORK_FILE, cells[2], `${sourceQuestionId} 答案 ${answer} 不在完整选项中`);
    questions.push({
      questionId: `1-${String(questions.length + 1).padStart(3, '0')}`,
      sourceQuestionId,
      sourceDomPath: domPath(row),
      stem,
      options,
      answer,
      candidateIndex,
    });
  }
  expect(questions.length === 10, HOMEWORK_FILE, root, `作业2 应有10题，实际 ${questions.length}`);
  return questions;
}

function activityTab(subIndex) {
  const metadataFile = path.join(ACTIVITY_DIR, `0-1-experiment-1-tab-${subIndex}.json`);
  const metadata = loadJson(metadataFile);
  const sourceFile = path.join(ACTIVITY_DIR, metadata.rawHtmlFile || '');
  expect(metadata.subIndex === subIndex, metadataFile, null, `实验 tab subIndex 应为 ${subIndex}`);
  expect(metadata.activity === '实验1:热氧化工艺', metadataFile, null, '实验活动名称变化');
  return { metadata, metadataFile, sourceFile, root: parseSource(sourceFile) };
}

function paragraphBlocks(lines) {
  return lines.map((text) => ({ type: 'paragraph', spans: [{ t: text }] }));
}

// ==== 实验 1 四个 tab 与 Canvas ====

function convertPrincipleTab(tab) {
  const article = queryOne(tab.root, '.my-article', tab.sourceFile, '热氧化原理缺少唯一正文');
  const nodes = assertDirectTags(article, ['div', 'p', 'table', 'img', 'div', 'video', 'div'], tab.sourceFile);
  expect(normalizeText(nodes[0].textContent) === '氧化基本原理', tab.sourceFile, nodes[0], '热氧化原理标题变化');
  expect(normalizeText(nodes[4].textContent) === '视频:热氧化原理', tab.sourceFile, nodes[4], '热氧化原理视频标题变化');
  const table = convertTable(nodes[2], tab.sourceFile);
  expect(!table.caption, tab.sourceFile, nodes[2], '热氧化比较表不应产生额外标题行');
  return [
    { type: 'boldCaption', text: '氧化基本原理' },
    ...paragraphBlocks(paragraphLines(nodes[1], tab.sourceFile)),
    table.block,
    {
      type: 'image',
      src: copyStaticImage(
        nodes[3].getAttribute('src'),
        'activity-details/0-1-experiment-1-tab-0.html',
        tab.sourceFile,
        nodes[3],
      ),
      alt: nodes[3].getAttribute('alt') || '',
    },
    {
      type: 'video',
      title: normalizeText(nodes[4].textContent),
      src: copyVideo(nodes[5].getAttribute('src'), tab.sourceFile, nodes[5]),
    },
  ];
}

function convertQualityTab(tab, audit) {
  const article = queryOne(tab.root, '.my-article', tab.sourceFile, '质量检验缺少唯一正文');
  const nodes = assertDirectTags(article, ['div', 'p', 'div', 'video', 'div', 'div', 'table', 'div', 'script'], tab.sourceFile);
  expect(normalizeText(nodes[0].textContent) === '质量检验', tab.sourceFile, nodes[0], '质量检验标题变化');
  expect(normalizeText(nodes[2].textContent) === '视频:热氧化炉生产操作', tab.sourceFile, nodes[2], '质量检验视频标题变化');
  expect(normalizeText(nodes[5].textContent) === '参数设置', tab.sourceFile, nodes[5], '质量检验参数标题变化');
  const rows = nodes[6].querySelectorAll('tr');
  const headers = elementChildren(rows[0]).map((cell) => normalizeText(cell.textContent));
  expect(JSON.stringify(headers) === JSON.stringify(['序号', '项目', '选择']), tab.sourceFile, rows[0], '质量检验表头变化');
  const labels = rows.slice(1).map((row) => {
    const cells = elementChildren(row).filter((cell) => tagName(cell) === 'td');
    expect(cells.length === 3 && cells[2].querySelectorAll('select').length === 1, tab.sourceFile, row, '质量检验参数行结构变化');
    return normalizeText(cells[1].textContent);
  });
  const optionSets = JSON.parse(tab.metadata.variables.jsonstr_xx).map((set) => set.split(';').filter(Boolean));
  const auditValues = audit.tabs.find((item) => item.subIndex === 2)?.selectedValues;
  expect(Array.isArray(auditValues) && auditValues.length === labels.length, tab.sourceFile, nodes[6], '质量检验满分答案数量不符');
  const params = labels.map((label, index) => {
    const answerIndex = optionSets[index].indexOf(auditValues[index]) + 1;
    expect(answerIndex > 0, tab.sourceFile, rows[index + 1], `${label} 满分值不在原选项中`);
    return { label, options: optionSets[index], answerIndex };
  });
  const textBlocks = paragraphLines(nodes[1], tab.sourceFile).map((text) => (
    text === '缺陷产生原因:' || text === '解决方法:'
      ? { type: 'boldCaption', text }
      : { type: 'paragraph', spans: [{ t: text }] }
  ));
  return [
    { type: 'boldCaption', text: '质量检验' },
    ...textBlocks,
    {
      type: 'video',
      title: normalizeText(nodes[2].textContent),
      src: copyVideo(nodes[3].getAttribute('src'), tab.sourceFile, nodes[3]),
    },
    { type: 'boldCaption', text: '参数设置' },
    {
      type: 'paramSelect',
      id: 'experiment-1-quality-inspection',
      title: '参数设置',
      headers,
      groups: [{ params }],
    },
  ];
}

function convertDepositionTab(tab) {
  const article = queryOne(tab.root, '.my-article', tab.sourceFile, '热分解淀积缺少唯一正文');
  const nodes = assertDirectTags(article, ['div', 'p', 'img', 'div', 'video', 'div'], tab.sourceFile);
  expect(normalizeText(nodes[0].textContent) === '热分解淀积基本原理', tab.sourceFile, nodes[0], '热分解淀积标题变化');
  expect(normalizeText(nodes[3].textContent) === '视频:热分解淀积原理', tab.sourceFile, nodes[3], '热分解淀积视频标题变化');
  return [
    { type: 'boldCaption', text: '热分解淀积基本原理' },
    ...paragraphBlocks(paragraphLines(nodes[1], tab.sourceFile)),
    {
      type: 'image',
      src: copyStaticImage(
        nodes[2].getAttribute('src'),
        'activity-details/0-1-experiment-1-tab-3.html',
        tab.sourceFile,
        nodes[2],
      ),
      alt: nodes[2].getAttribute('alt') || '',
    },
    {
      type: 'video',
      title: normalizeText(nodes[3].textContent),
      src: copyVideo(nodes[4].getAttribute('src'), tab.sourceFile, nodes[4]),
    },
  ];
}

function simulationHtml(modelAsset) {
  const inlineModel = loadMixedText(MODEL_SOURCE);
  expect(!/<\/script/i.test(inlineModel), MODEL_SOURCE, null, '共享模型不能包含未转义的 script 结束标签');
  return `<style>
html,body{overflow:hidden}
.oxidation-simulation{max-width:100%;overflow:hidden;color:var(--text);font-family:var(--sans)}
.oxidation-simulation h3{margin-block-start:0;color:var(--ink);font-family:var(--serif)}
.oxidation-layout{display:grid;grid-template-columns:minmax(0,18rem) minmax(0,1fr);gap:1rem;align-items:start;max-width:100%}
.oxidation-fields,.oxidation-canvas-wrap{min-width:0}
.oxidation-stage{padding:.75rem 0;border-bottom:1px solid var(--line)}
.oxidation-stage:first-child{padding-top:0}
.oxidation-stage p{margin:.375rem 0;color:var(--text-soft)}
.oxidation-stage label{display:grid;grid-template-columns:minmax(0,1fr) minmax(7rem,auto);gap:.5rem;align-items:center}
.oxidation-simulation select,.oxidation-simulation button{max-width:100%;font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:.5rem .625rem}
.oxidation-simulation select{font-size:.8125rem;line-height:1.7;padding:.4375rem .75rem}
.oxidation-simulation button{cursor:pointer}
.oxidation-actions{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:.5rem;margin-top:.75rem}
.oxidation-actions button{width:100%;margin-top:0}
.oxidation-primary-button{background:var(--ink)!important;color:var(--paper)!important;border-color:var(--ink)!important;font-weight:700}
.oxidation-secondary-button{background:var(--card);color:var(--ink)}
.oxidation-secondary-button:disabled,.oxidation-primary-button:disabled{opacity:.55;cursor:not-allowed}
.oxidation-status{min-height:1.5em;margin:.5rem 0 0;color:var(--seal)}
.oxidation-canvas{display:block;width:100%;height:auto;max-width:100%;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}
@media (max-width:48rem){.oxidation-layout{grid-template-columns:minmax(0,1fr)}.oxidation-stage label{grid-template-columns:minmax(0,1fr)}}
</style>
<div class="oxidation-simulation" data-oxidation-simulation data-model-dependency="${modelAsset}">
  <h3>氧化温度曲线参数设置及仿真</h3>
  <div class="oxidation-layout">
    <div class="oxidation-fields">
      <section class="oxidation-stage"><strong>炉子预热阶段</strong><label>温度℃:<select data-parameter="preheat"><option value="">请选择..</option></select></label><p>时间:60min　氮气流量:3L/min</p></section>
      <section class="oxidation-stage"><strong>炉子保温阶段</strong><label>温度℃:<select data-parameter="hold"><option value="">请选择..</option></select></label><p>时间:10min　氮气流量:3L/min</p></section>
      <section class="oxidation-stage"><strong>氧化加温阶段</strong><label>温度℃:<select data-parameter="oxidation"><option value="">请选择..</option></select></label><label>干氧氧化时间min:<select data-parameter="dry"><option value="">请选择..</option></select></label><p>流量:3L/min</p><label>湿氧氧化时间min:<select data-parameter="wet"><option value="">请选择..</option></select></label><p>流量:3L/min</p></section>
      <section class="oxidation-stage"><strong>炉子降温阶段</strong><p>温度:25℃　时间:30min</p></section>
      <div class="oxidation-actions" role="group" aria-label="仿真控制">
        <button type="button" class="oxidation-primary-button" data-draw-oxidation>温度曲线仿真</button>
        <button type="button" class="oxidation-secondary-button" data-clear-oxidation>清空</button>
      </div>
      <p class="oxidation-status" data-oxidation-status role="status"></p>
    </div>
    <div class="oxidation-canvas-wrap"><canvas class="oxidation-canvas" width="700" height="700" aria-label="氧化炉温度曲线">A Drawing of something</canvas></div>
  </div>
</div>
<script>${inlineModel}</script>
<script>
(function(){
  const root=document.querySelector('[data-oxidation-simulation]');
  const model=globalThis.OxidationCurveModel;
  const spec=model.oxidationCurveSpec;
  const selects=Array.from(root.querySelectorAll('select'));
  const messages=['请选择预热温度!','请选择保温温度!','请选择加温温度!','请选择干氧氧化时间!','请选择湿氧氧化时间!'];
  const status=root.querySelector('[data-oxidation-status]');
  const canvas=root.querySelector('canvas');
  const ctx=canvas.getContext('2d');
  const token=(name)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const drawButton=root.querySelector('[data-draw-oxidation]');
  const clearButton=root.querySelector('[data-clear-oxidation]');
  let answerMode=false;
  let practiceValues=[];
  spec.optionSets.forEach(function(options,index){
    options.forEach(function(value){const option=document.createElement('option');option.value=String(value);option.textContent=String(value);selects[index].appendChild(option)});
  });
  function drawCurve(origin,points){
    const fills=[token('--gold'),token('--correct-bg'),token('--hover'),token('--wrong-bg'),token('--card')];
    points.forEach(function(point,index){const start=index===0?0:points[index-1][0];ctx.fillStyle=fills[index];ctx.fillRect(origin[0]+start,origin[1]+point[1],point[0]-start,-point[1])});
    ctx.lineWidth=2;ctx.setLineDash([3]);ctx.strokeStyle=token('--text-soft');ctx.fillStyle=token('--ink');
    points.forEach(function(point){ctx.beginPath();ctx.moveTo(origin[0],origin[1]+point[1]);ctx.lineTo(origin[0]+point[0],origin[1]+point[1]);ctx.lineTo(origin[0]+point[0],origin[1]);ctx.stroke()});
    ctx.setLineDash([]);
    const top=[origin[0],origin[1]-spec.axes.yDegrees/5];
    const right=[origin[0]+spec.axes.xMinutes*spec.dw[0],origin[1]];
    ctx.beginPath();ctx.moveTo(top[0],top[1]);ctx.lineTo(origin[0],origin[1]);ctx.lineTo(right[0],right[1]);ctx.stroke();
    const arrow=10;
    ctx.beginPath();ctx.moveTo(top[0]-arrow/2,top[1]+arrow);ctx.lineTo(top[0],top[1]);ctx.lineTo(top[0]+arrow/2,top[1]+arrow);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(right[0]-arrow,right[1]-arrow/2);ctx.lineTo(right[0],right[1]);ctx.lineTo(right[0]-arrow,right[1]+arrow/2);ctx.fill();ctx.stroke();
    ctx.font='13px '+token('--sans');
    for(let value=spec.axes.yTickDegrees;value<spec.axes.yDegrees;value+=spec.axes.yTickDegrees){const y=origin[1]-value/5;ctx.beginPath();ctx.moveTo(origin[0]-5,y);ctx.lineTo(origin[0],y);ctx.stroke();ctx.fillText(String(value),origin[0]-40,y+5)}
    ctx.fillText(spec.axes.yUnit,top[0]-5,top[1]-5);
    for(let value=spec.axes.xTickMinutes;value<spec.axes.xMinutes;value+=spec.axes.xTickMinutes){const x=origin[0]+value*spec.dw[0];ctx.beginPath();ctx.moveTo(x,origin[1]);ctx.lineTo(x,origin[1]+5);ctx.stroke();ctx.fillText(String(value),x-10,origin[1]+20)}
    ctx.fillText('0',origin[0]-10,origin[1]+15);ctx.fillText(spec.axes.xUnit,right[0]+5,right[1]+3);
    ctx.beginPath();ctx.lineWidth=3;ctx.strokeStyle=token('--seal');ctx.moveTo(origin[0],origin[1]-2.5*spec.dw[1]);points.forEach(function(point){ctx.lineTo(origin[0]+point[0],origin[1]+point[1])});ctx.stroke();
  }
  function clearCanvas(){ctx.clearRect(0,0,canvas.width,canvas.height);}
  function clearScore(){parent.postMessage({type:'pigeon-score-clear'},'*');}
  function notifyMode(mode){parent.postMessage({type:'pigeon-sandbox-mode',mode:mode},'*');}
  function reportHeight(){
    const htmlStyle=getComputedStyle(document.documentElement);
    const height=Math.max(760,document.body.getBoundingClientRect().height+parseFloat(htmlStyle.paddingTop)+parseFloat(htmlStyle.paddingBottom));
    parent.postMessage({pigeonHeight:Math.ceil(height)},'*');
  }
  function setPracticeMode(reset){
    if(!answerMode&&!reset){notifyMode('practice');return}
    clearScore();
    answerMode=false;
    root.classList.remove('answer-mode');
    const values=reset ? selects.map(function(){return ''}) : practiceValues;
    selects.forEach(function(select,index){select.disabled=false;select.value=values[index] || '';});
    if(reset)practiceValues=[];
    drawButton.disabled=false;
    status.textContent='';
    clearCanvas();
    notifyMode('practice');
  }
  function setAnswerMode(){
    if(answerMode){notifyMode('answer');return}
    clearScore();
    practiceValues=selects.map(function(select){return select.value});
    answerMode=true;
    root.classList.add('answer-mode');
    selects.forEach(function(select,index){select.disabled=true;select.value=String(spec.correctValues[index]);});
    drawButton.disabled=true;
    status.textContent='参考答案已显示';
    drawCurves(spec.correctValues,true);
    notifyMode('answer');
  }
  drawButton.addEventListener('click',function(){
    if(answerMode)return;
    const raw=selects.map(function(select){return select.value});
    const missing=raw.findIndex(function(value){return value==='' });
    if(missing>=0){status.textContent=messages[missing];selects[missing].focus();return}
    status.textContent='';
    const values=raw.map(Number);
    drawCurves(values,false);
  });
  clearButton.addEventListener('click',function(){setPracticeMode(true);});
  addEventListener('message',function(event){
    if(event.source!==parent||!event.data)return;
    if(event.data.type==='pigeon-sandbox-layout'){setTimeout(reportHeight,0);return}
    if(event.data.type!=='pigeon-sandbox-mode')return;
    if(event.data.mode==='answer')setAnswerMode();
    else if(event.data.mode==='practice')setPracticeMode();
    setTimeout(reportHeight,0);
  });
  addEventListener('load',reportHeight);
  setTimeout(reportHeight,0);
  if(window.ResizeObserver){root._heightObserver=new ResizeObserver(reportHeight);root._heightObserver.observe(root)}
  if(window.IntersectionObserver){
    root._heightVisibility=new IntersectionObserver(function(entries){
      if(entries.some(function(entry){return entry.isIntersecting}))requestAnimationFrame(reportHeight);
    });
    root._heightVisibility.observe(root);
  }
  function drawCurves(values,reference){
    const result=model.computeOxidationCurves(values);
    clearCanvas();ctx.fillStyle=token('--ink');ctx.strokeStyle=token('--ink');ctx.font='20px '+token('--sans');ctx.fillText('干氧氧化炉温度曲线',250,40);ctx.fillText('湿氧氧化炉温度曲线',250,380);
    drawCurve(spec.origins.dry,result.relativePoints.dry);drawCurve(spec.origins.wet,result.relativePoints.wet);
    if(!reference){
      const score=values.reduce(function(total,value,index){return total+(value===spec.correctValues[index]?1:0)},0);
      parent.postMessage({type:'pigeon-score',score:score,total:spec.correctValues.length},'*');
    }
  }
}());
</script>`;
}

function convertSimulationTab(tab, audit, modelAsset) {
  const article = queryOne(tab.root, '.my-article', tab.sourceFile, '温度曲线仿真缺少唯一正文');
  const nodes = assertDirectTags(article, ['div', 'div', 'script', 'script'], tab.sourceFile);
  expect(normalizeText(nodes[0].textContent) === '氧化温度曲线参数设置及仿真', tab.sourceFile, nodes[0], '温度曲线题名变化');
  const selects = nodes[1].querySelectorAll('select');
  const canvas = queryOne(nodes[1], 'canvas', tab.sourceFile, '温度曲线缺少唯一 Canvas');
  expect(selects.length === 5, tab.sourceFile, nodes[1], `温度曲线应有5个下拉，实际 ${selects.length}`);
  expect(canvas.getAttribute('width') === '700' && canvas.getAttribute('height') === '700', tab.sourceFile, canvas, 'Canvas 原始尺寸变化');
  const optionSets = JSON.parse(tab.metadata.variables.jsonstr_xx).map((set) => set.split(';').filter(Boolean).map(Number));
  const sourceCorrect = JSON.parse(tab.metadata.variables.jsonstr_stdasr).map(Number);
  const auditCorrect = audit.tabs.find((item) => item.subIndex === 1)?.selectedValues?.map(Number);
  expect(JSON.stringify(optionSets) === JSON.stringify(curveModel.oxidationCurveSpec.optionSets), tab.metadataFile, null, '五个下拉原始选项与模型不一致');
  expect(JSON.stringify(sourceCorrect) === JSON.stringify(curveModel.oxidationCurveSpec.correctValues), tab.metadataFile, null, '页面标准答案与模型不一致');
  expect(JSON.stringify(auditCorrect) === JSON.stringify(sourceCorrect), tab.metadataFile, null, '100分审计答案与页面标准答案不一致');
  const compactScript = tab.root.querySelectorAll('script').map((script) => script.textContent).join('').replace(/\s+/g, '');
  for (const sourceFormula of [
    'vardw=[3,2]',
    'pto=[60,330]',
    'pto=[60,670]',
    'ptsd=[[60*dw[0],-oslt[0]/5],[70*dw[0],-oslt[1]/5],[90*dw[0],-oslt[2]/5],[90*dw[0]+oslt[3]*3,-oslt[2]/5],[120*dw[0]+oslt[3]*3,-2.5*dw[1]]]',
    'ptsd=[[60*dw[0],-oslt[0]/5],[70*dw[0],-oslt[1]/5],[90*dw[0],-oslt[2]/5],[90*dw[0]+oslt[4]*3,-oslt[2]/5],[120*dw[0]+oslt[4]*3,-2.5*dw[1]]]',
  ]) expect(compactScript.includes(sourceFormula), tab.sourceFile, nodes[2], `温度曲线原始公式变化: ${sourceFormula}`);
  return [{
    type: 'sandbox',
    id: 'experiment-1-oxidation-temperature-curve',
    html: simulationHtml(modelAsset),
    height: 760,
    modeSwitch: true,
    dependencies: [modelAsset],
  }];
}

function convertExperiment() {
  const tabs = [0, 1, 2, 3].map(activityTab);
  const expectedLabels = ['热氧化原理', '温度曲线参数设置及仿真', '生产操作质量检验', '热分解淀积'];
  expect(
    JSON.stringify(tabs.map((tab) => tab.metadata.label)) === JSON.stringify(expectedLabels),
    tabs[0].metadataFile,
    null,
    `实验1 tab 名称或顺序变化: ${JSON.stringify(tabs.map((tab) => tab.metadata.label))}`,
  );
  const auditFile = path.join(REPORTS, 'ui-state-experiment-1-after-v2.json');
  const audit = loadJson(auditFile);
  const verification = loadJson(path.join(REPORTS, 'verify-candidate-experiment-1-v2.json'));
  expect(audit.score === 100 && verification.finalScore === 100 && verification.verified === true, auditFile, null, '实验1缺少满分审计');
  const modelAsset = copyFileToCourse(
    MODEL_SOURCE,
    'assets/simulations/oxidation-temperature-curve/oxidation-temperature-curve-model.js',
  );
  const blocksByTab = [
    convertPrincipleTab(tabs[0]),
    convertSimulationTab(tabs[1], audit, modelAsset),
    convertQualityTab(tabs[2], audit),
    convertDepositionTab(tabs[3]),
  ];
  return [{
    type: 'tabSet',
    id: 'experiment-1-thermal-oxidation',
    tabs: expectedLabels.map((label, index) => ({
      id: `tab-${index + 1}`,
      label,
      blocks: blocksByTab[index],
    })),
  }];
}

function evidence(sourceFile, quote) {
  const normalizedQuote = normalizeText(quote);
  expect(sourcePlainText(sourceFile).includes(normalizedQuote), sourceFile, null, `证据引文未逐字出现在源文件: ${normalizedQuote}`);
  return { sourceFile: repoPath(sourceFile), quote };
}

function buildKnowledgeMap(questions) {
  const evidenceBySourceQuestion = {
    '2-1': [
      evidence(THEORY_FILES['氧化工艺'], '热氧化又可分为干氧氧化、湿氧氧化、水汽氧化及掺氛氧化、氢氧合成等。'),
      evidence(THEORY_FILES['氧化工艺'], '热分解淀积氧化膜工艺，是利用含硅的化合物（烷氧基硅烷和硅烷）经过热分解，在硅片表面淀积一层二氧化硅膜。'),
    ],
    '2-2': [
      evidence(THEORY_FILES['二氧化硅膜'], '2）不溶于水；'),
      evidence(THEORY_FILES['二氧化硅膜'], '硼、磷、砷、锑等三、五价化学元素'),
    ],
    '2-3': [
      evidence(THEORY_FILES['二氧化硅膜'], '1）杂质扩散掩蔽膜；'),
      evidence(THEORY_FILES['二氧化硅膜'], '2）器件表面保护或钝化膜；'),
      evidence(THEORY_FILES['二氧化硅膜'], '3）电路隔离介质或绝缘介质；'),
      evidence(THEORY_FILES['二氧化硅膜'], '4）电容介质材料；'),
      evidence(THEORY_FILES['二氧化硅膜'], '5）MOS 管的绝缘栅材料等。'),
    ],
    '2-4': [evidence(THEORY_FILES['介质薄膜'], 'MOS器件的栅极')],
    '2-5': [evidence(THEORY_FILES['介质薄膜'], '钝化膜，绝缘介质膜扩散掺杂的掩蔽膜')],
    '2-6': [evidence(THEORY_FILES['二氧化硅膜'], '灰100')],
    '2-7': [evidence(THEORY_FILES['氧化工艺'], '干氧干燥、纯净的氧气慢好致密好')],
    '2-8': [evidence(THEORY_FILES['氧化工艺'], '热分解淀积氧化膜工艺，是利用含硅的化合物（烷氧基硅烷和硅烷）经过热分解，在硅片表面淀积一层二氧化硅膜。')],
    '2-9': [
      evidence(THEORY_FILES['氧化工艺'], '热氧化又可分为干氧氧化、湿氧氧化、水汽氧化及掺氛氧化、氢氧合成等。'),
      evidence(THEORY_FILES['氧化工艺'], '热分解淀积氧化膜工艺，是利用含硅的化合物（烷氧基硅烷和硅烷）经过热分解，在硅片表面淀积一层二氧化硅膜。'),
      evidence(path.join(ACTIVITY_DIR, '0-1-experiment-1-tab-0.html'), '把衬底片置于1000℃以上的高温下'),
      evidence(path.join(ACTIVITY_DIR, '0-1-experiment-1-tab-3.html'), '基片可以是硅片，也可以是金属片、陶瓷等'),
    ],
    '2-10': [
      evidence(CROSS_SECTION_THEORY, '在真空蒸发淀积时，固体蒸发源材料'),
      evidence(CROSS_SECTION_THEORY, '以及如AL2O3、SiO2等非金属材料'),
    ],
  };
  const resolved = {
    '2-1': { knowledgePointId: '1-2-3', reason: '题干询问氧化方法，氧化工艺页直接列出热氧化分类和热分解淀积。' },
    '2-2': { knowledgePointId: '1-2-2', reason: '题干直接询问二氧化硅膜特点；答案按作业2满分审计结果 C 保留。' },
    '2-3': { knowledgePointId: '1-2-2', reason: '二氧化硅膜页逐项列出与正确选项一致的五类用途。' },
    '2-4': { knowledgePointId: '1-2-1', reason: '题干询问多晶硅膜用途，介质薄膜材料表包含多晶硅用途。' },
    '2-5': { knowledgePointId: '1-2-1', reason: '题干询问氮化硅膜用途，介质薄膜材料表包含氮化硅用途。' },
    '2-6': { knowledgePointId: '1-2-2', reason: '二氧化硅膜颜色厚度表直接给出灰色对应100埃。' },
    '2-7': { knowledgePointId: '1-2-3', reason: '氧化工艺比较表直接给出干氧气氛、速度和膜结构。' },
    '2-8': { knowledgePointId: '1-2-3', reason: '氧化工艺页直接定义热分解淀积氧化膜的形成方式。' },
    '2-9': { knowledgePointId: '1-2-3', reason: '题干比较热氧化与热分解淀积，二者都属于氧化工艺主题；答案按满分审计保留。' },
    '2-10': {
      knowledgePointId: '1-4-1',
      targetSectionId: '1.4',
      futureTarget: '第1.4节 物理气相淀积',
      reason: '题干询问真空蒸发薄膜淀积，应跨节归入第1.4节物理气相淀积。',
    },
  };
  return {
    schemaVersion: 1,
    status: 'ready',
    releaseReady: true,
    answerAuthority: 'full-score-audit',
    courseId: 'autosmt-oxidation-golden',
    sourceSection: '0-1',
    summary: { resolved: 10, local: 9, crossSection: 1 },
    mappings: questions.map((question) => {
      const base = {
        questionId: question.questionId,
        sourceQuestionId: question.sourceQuestionId,
        sourceHomework: '作业2',
        sourceFile: repoPath(HOMEWORK_FILE),
        sourceDomPath: question.sourceDomPath,
        stemKeywords: [question.stem.slice(0, Math.min(12, question.stem.length))],
        answerEvidence: {
          answer: question.answer,
          sourceFile: repoPath(CANDIDATE_FILE),
          sourcePointer: `/2/${question.candidateIndex}`,
          candidateSubmissionScoreFile: repoPath(CANDIDATE_SCORE_FILE),
          fullScoreEvidenceFile: repoPath(SCORE_FILE),
          authority: 'full-score-audit',
        },
        theoryEvidence: evidenceBySourceQuestion[question.sourceQuestionId],
      };
      const mapping = resolved[question.sourceQuestionId];
      expect(Boolean(mapping), HOMEWORK_FILE, null, `题目缺少知识点归属: ${question.sourceQuestionId}`);
      return {
        ...base,
        status: 'resolved',
        knowledgePointId: mapping.knowledgePointId,
        matchReason: mapping.reason,
        ...(mapping.targetSectionId ? {
          targetSectionId: mapping.targetSectionId,
          futureTarget: mapping.futureTarget,
        } : {}),
      };
    }),
  };
}

function writeJson(name, value) {
  writeFileSync(path.join(COURSE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function pointerPart(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function jsonPointer(parts) {
  return `/${parts.map(pointerPart).join('/')}`;
}

function jsonValueHash(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');
}

function fullScoreEvidence(sourceFile, scoreType, scoreNumber, sourceLocation) {
  const evidence = loadJson(sourceFile);
  let score = null;
  const scoreRows = evidence.scores?.[scoreType];
  if (Array.isArray(scoreRows)) {
    score = scoreRows.find((entry) => Number(entry.number) === scoreNumber)?.score ?? null;
  } else if (evidence.scoreType === scoreType && Number(evidence.scoreNumber) === scoreNumber) {
    score = evidence.score;
  }
  expect(Number(score) === 100, sourceFile, null, `${scoreType}:${scoreNumber} 满分权威证据不是100分`);
  return {
    sourceFile: repoPath(sourceFile),
    sourceLocation,
    sourceSha256: sourceHash(sourceFile),
    scoreType,
    scoreNumber,
    observedScore: String(score),
  };
}

function contentSource(parts, block) {
  if (parts[0] === 'overviews') {
    return {
      file: path.join(SECTION_DIR, 'overview.html'),
      location: `section=0-1; component=overview; .ax-article; target=${jsonPointer(parts)}`,
      summary: '概述块逐项由当前抓取页转换，并以源文件与目标值 SHA-256 校验。',
    };
  }

  const pointId = parts[1];
  if (block?.type === 'sectionQuiz') {
    return {
      file: HOMEWORK_FILE,
      location: `section=0-1; homework=2; knowledgePoint=${pointId}; target=${jsonPointer(parts)}`,
      summary: '小测引用由作业2题面与已审计的知识点语义归属生成。',
    };
  }

  const tabPosition = parts.indexOf('tabs');
  const tabIndex = tabPosition >= 0 ? Number(parts[tabPosition + 1]) : null;
  if (pointId === '1-2-1' || pointId === '1-2-2') {
    const title = pointId === '1-2-1' ? '介质薄膜' : '二氧化硅膜';
    return {
      file: THEORY_FILES[title],
      location: `section=0-1; theory=${title}; div.Section0; target=${jsonPointer(parts)}`,
      summary: `${title}原站正文已转换为同构原生块，源文件与目标值均做SHA-256校验。`,
    };
  }
  if (pointId === '1-2-3') {
    if (tabIndex === 1) {
      return {
        file: path.join(SECTION_DIR, 'lecture-video.html'),
        location: `section=0-1; component=lecture-video; video=2; target=${jsonPointer(parts)}`,
        summary: '讲解视频标题与编号来自当前抓取页，资源引用已闭包。',
      };
    }
    if (tabIndex === null && block?.type === 'tabSet') {
      return {
        file: path.join(SECTION_DIR, 'menu.html'),
        location: `section=0-1; components=理论知识,讲课视频; target=${jsonPointer(parts)}`,
        summary: '理论与讲解视频的标签组织与当前章节组件清单一致。',
      };
    }
    return {
      file: THEORY_FILES['氧化工艺'],
      location: `section=0-1; theory=氧化工艺; div.Section0; target=${jsonPointer(parts)}`,
      summary: '氧化工艺正文已转换为同构原生块，源文件与目标值均做SHA-256校验。',
    };
  }
  if (pointId === '1-2-4') {
    const labels = ['热氧化原理', '温度曲线参数设置及仿真', '生产操作质量检验', '热分解淀积'];
    const resolvedTab = tabIndex ?? 0;
    const metadataFile = path.join(ACTIVITY_DIR, `0-1-experiment-1-tab-${resolvedTab}.json`);
    const metadata = loadJson(metadataFile);
    const sourceFile = path.join(ACTIVITY_DIR, metadata.rawHtmlFile);
    const result = {
      file: tabIndex === null && block?.type === 'tabSet' ? metadataFile : sourceFile,
      location: `section=0-1; activity=实验1:热氧化工艺; tab=${resolvedTab}; label=${labels[resolvedTab]}; target=${jsonPointer(parts)}`,
      summary: '实验块保持当前活动的tab分栏、题面、参数与媒体信息。',
    };
    if (block?.type === 'sandbox') {
      result.authorityEvidence = [
        fullScoreEvidence(path.join(REPORTS, 'ui-state-experiment-1-after-v2.json'), 'experiment', 1, 'tabs[subIndex=1].selectedValues; score'),
        fullScoreEvidence(SCORE_FILE, 'experiment', 1, 'scores.experiment[number=1].score'),
      ];
      result.summary = '绘图仿真结构与参数来自实验1 tab1，正确值只由实验1满分审计授权。';
    }
    return result;
  }
  throw new Error(`[HARD STOP] source ledger 无法定位内容目标: ${jsonPointer(parts)}`);
}

function sandboxInputs(html) {
  const inputs = [];
  const pattern = /<(select|input|textarea)\b[^>]*>(?:[\s\S]*?<\/\1\s*>)?/gi;
  for (const match of html.matchAll(pattern)) inputs.push(match[0]);
  return inputs;
}

function buildSourceLedger(content, quiz, questions) {
  const entries = new Map();
  const add = (fileName, parts, value, kind, descriptor) => {
    const target = `${fileName}#${jsonPointer(parts)}`;
    const sourceFile = descriptor.file;
    expect(sourceFile.startsWith(`${REPORTS}${path.sep}`), sourceFile, null, `source ledger 源必须位于 reports/: ${target}`);
    const entry = {
      target,
      kind,
      sourceFile: repoPath(sourceFile),
      sourceLocation: descriptor.location,
      sourceSha256: sourceHash(sourceFile),
      targetValueSha256: jsonValueHash(value),
      checkSummary: descriptor.summary,
      status: 'verified',
    };
    if (descriptor.authorityEvidence) {
      entry.answerAuthority = 'full-score-audit';
      entry.authorityEvidence = descriptor.authorityEvidence;
    }
    entries.set(target, entry);
  };

  const addMedia = (fileName, value, parts, descriptor) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => addMedia(fileName, item, [...parts, index], descriptor));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const childParts = [...parts, key];
      if (['src', 'poster', 'captions', 'clip'].includes(key) && typeof child === 'string') {
        add(fileName, childParts, child, 'media-reference', descriptor);
      }
      if (key === 'dependencies' && Array.isArray(child)) {
        child.forEach((dependency, index) => {
          if (typeof dependency === 'string') add(fileName, [...childParts, index], dependency, 'sandbox-dependency', descriptor);
        });
      }
      addMedia(fileName, child, childParts, descriptor);
    }
  };

  const collectBlocks = (blocks, fileName, baseParts) => {
    (blocks || []).forEach((block, index) => {
      const parts = [...baseParts, index];
      const descriptor = contentSource(parts, block);
      add(fileName, parts, block, `content-block:${block.type}`, descriptor);
      addMedia(fileName, block, parts, descriptor);
      if (block.type === 'tabSet') {
        (block.tabs || []).forEach((tab, tabIndex) => {
          collectBlocks(tab.blocks, fileName, [...parts, 'tabs', tabIndex, 'blocks']);
        });
      }
      if (block.type === 'paramSelect') {
        (block.headers || []).forEach((header, headerIndex) => {
          add(fileName, [...parts, 'headers', headerIndex], header, 'interactive-header', descriptor);
        });
        (block.groups || []).forEach((group, groupIndex) => {
          (group.params || []).forEach((param, paramIndex) => {
            const paramParts = [...parts, 'groups', groupIndex, 'params', paramIndex];
            add(fileName, [...paramParts, 'label'], param.label, 'interactive-label', descriptor);
            (param.options || []).forEach((option, optionIndex) => {
              add(fileName, [...paramParts, 'options', optionIndex], option, 'interactive-option', descriptor);
            });
            const auditFile = path.join(REPORTS, 'ui-state-experiment-1-after-v2.json');
            add(fileName, [...paramParts, 'answerIndex'], param.answerIndex, 'interactive-answer', {
              file: auditFile,
              location: `activity=实验1:热氧化工艺; tab=2; selectedValues[${paramIndex}]; score=100`,
              summary: '参数正确项由实验1满分审计的tab2已选值换算，并校验仍在原选项内。',
              authorityEvidence: [
                fullScoreEvidence(auditFile, 'experiment', 1, 'tabs[subIndex=2].selectedValues; score'),
                fullScoreEvidence(SCORE_FILE, 'experiment', 1, 'scores.experiment[number=1].score'),
              ],
            });
          });
        });
      }
      if (block.type === 'sandbox') {
        sandboxInputs(block.html).forEach((input, inputIndex) => {
          add(fileName, [...parts, 'sandbox-input', inputIndex], input, 'sandbox-input', descriptor);
        });
      }
    });
  };

  for (const [sectionId, overview] of Object.entries(content.overviews || {})) {
    collectBlocks(overview.blocks, 'content.json', ['overviews', sectionId, 'blocks']);
  }
  for (const [pointId, point] of Object.entries(content.knowledgePoints || {})) {
    collectBlocks(point.blocks, 'content.json', ['knowledgePoints', pointId, 'blocks']);
  }

  const byQuestionId = new Map(questions.map((question) => [question.questionId, question]));
  for (const [questionId, question] of Object.entries(quiz.questionBank || {})) {
    const source = byQuestionId.get(questionId);
    expect(Boolean(source), HOMEWORK_FILE, null, `source ledger 找不到题目来源: ${questionId}`);
    const base = ['questionBank', questionId];
    const sourceDescriptor = {
      file: HOMEWORK_FILE,
      location: `section=0-1; homework=2; question=${source.sourceQuestionId}; ${source.sourceDomPath}`,
      summary: '题干和完整选项逐字取自当前抓取题面，并校验目标值与源文件哈希。',
    };
    add('quiz.json', [...base, 'stem'], question.stem, 'question-stem', sourceDescriptor);
    question.options.forEach((option, optionIndex) => {
      add('quiz.json', [...base, 'options', optionIndex], option, 'question-option', {
        ...sourceDescriptor,
        location: `${sourceDescriptor.location}; option=${String.fromCharCode(65 + optionIndex)}`,
      });
    });
    add('quiz.json', [...base, 'answer'], question.answer, 'question-answer', {
      file: CANDIDATE_FILE,
      location: `/2/${source.candidateIndex}`,
      summary: '正确答案来自已提交并取得100.00分的2026候选答案，且最终成绩快照仍为100.00分。',
      authorityEvidence: [
        fullScoreEvidence(CANDIDATE_SCORE_FILE, 'homework', 2, 'scores.homework[number=2].score'),
        fullScoreEvidence(SCORE_FILE, 'homework', 2, 'scores.homework[number=2].score'),
      ],
    });
  }

  const values = [...entries.values()].sort((left, right) => left.target.localeCompare(right.target));
  return {
    schemaVersion: 1,
    courseId: 'autosmt-oxidation-golden',
    answerAuthority: 'full-score-audit',
    stats: {
      entries: values.length,
      contentBlocks: values.filter((entry) => entry.kind.startsWith('content-block:')).length,
      questions: Object.keys(quiz.questionBank || {}).length,
    },
    entries: values,
  };
}

// ==== 隔离样板组装 ====

async function build() {
  validateMenu();
  validateTheoryIndex();
  mkdirSync(COURSE_DIR, { recursive: true });

  const overviewBlocks = convertOverview();
  const dielectricBlocks = convertTheoryPage('介质薄膜', THEORY_FILES['介质薄膜']);
  const siliconDioxideBlocks = convertTheoryPage('二氧化硅膜', THEORY_FILES['二氧化硅膜']);
  const oxidationBlocks = convertTheoryPage('氧化工艺', THEORY_FILES['氧化工艺']);
  const lecture = convertLecture();
  const experimentBlocks = convertExperiment();
  const questions = parseHomework();
  const knowledgeMap = buildKnowledgeMap(questions);

  const manifest = {
    schemaVersion: 1,
    id: 'autosmt-oxidation-golden',
    title: 'AutoSMT 氧化黄金样板',
    subtitle: '人工验收基线 · 非正式课程',
    description: '第1.2节“氧化”的隔离重建样板，用于验证理论原生化、实验标签页、绘图仿真和题目归属。',
    author: 'AutoSMT 2026 / PigeonLib',
    version: '0.2.0-golden',
    coverText: '氧化',
    stats: { chapters: 1, knowledgePoints: 4, questions: 10 },
    chapters: [{
      id: '1',
      title: '第1章 IC制造工艺',
      tabLabel: '第1章',
      sections: [{
        id: '1.2',
        title: '第1.2节 氧化',
        knowledgePoints: [
          { id: '1-2-1', title: '介质薄膜' },
          { id: '1-2-2', title: '二氧化硅膜' },
          { id: '1-2-3', title: '氧化工艺' },
          { id: '1-2-4', title: '实验1:热氧化工艺' },
        ],
      }],
    }],
  };

  const content = {
    overviews: {
      '1.2': { title: '第1.2节 氧化', blocks: overviewBlocks },
    },
    knowledgePoints: {
      '1-2-1': {
        title: '介质薄膜',
        blocks: [...dielectricBlocks, { type: 'sectionQuiz', quizRef: '1-2-1' }],
      },
      '1-2-2': {
        title: '二氧化硅膜',
        blocks: [...siliconDioxideBlocks, { type: 'sectionQuiz', quizRef: '1-2-2' }],
      },
      '1-2-3': {
        title: '氧化工艺',
        blocks: [{
          type: 'tabSet',
          id: 'oxidation-process-content',
          tabs: [
            { id: 'theory', label: '知识正文', blocks: oxidationBlocks },
            { id: 'video', label: '讲解视频', blocks: [lecture] },
          ],
        }, { type: 'sectionQuiz', quizRef: '1-2-3' }],
      },
      '1-2-4': {
        title: '实验1:热氧化工艺',
        blocks: experimentBlocks,
      },
    },
  };

  const questionBank = Object.fromEntries(questions.map((question) => [question.questionId, {
    type: 'single',
    stem: question.stem,
    options: question.options,
    answer: question.answer,
  }]));
  const bySource = Object.fromEntries(questions.map((question) => [question.sourceQuestionId, question.questionId]));
  const quiz = {
    questionBank,
    sectionQuizzes: {
      '1-2-1': [bySource['2-4'], bySource['2-5']],
      '1-2-2': [bySource['2-2'], bySource['2-3'], bySource['2-6']],
      '1-2-3': [bySource['2-1'], bySource['2-7'], bySource['2-8'], bySource['2-9']],
    },
    examQuestions: {
      '1': questions.map((question) => question.questionId),
    },
  };
  const sourceLedger = buildSourceLedger(content, quiz, questions);

  await Promise.all(pendingCopies);
  writeJson('manifest.json', manifest);
  writeJson('content.json', content);
  writeJson('quiz.json', quiz);
  writeJson('question-knowledge-map.json', knowledgeMap);
  writeJson('glossary.json', []);
  writeJson('source-ledger.json', sourceLedger);
  console.log(JSON.stringify({
    output: repoPath(COURSE_DIR),
    knowledgePoints: 4,
    questions: 10,
    resolvedMappings: 10,
    releaseReady: true,
  }));
}

await build();
