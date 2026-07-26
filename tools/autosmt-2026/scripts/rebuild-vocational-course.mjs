#!/usr/bin/env node
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDrawingSandbox } from '../lib/drawing-sandbox-shell.mjs';
import { deviceOutputDrawingRendererSource } from '../lib/device-output-drawing-renderers.mjs';
import { temperatureDrawingRendererSource } from '../lib/temperature-drawing-renderers.mjs';
import { convertFlatProcess } from '../lib/flat-process-converter.mjs';
import { convertProcessGnq } from '../lib/process-gnq-converter.mjs';
import { convertEngineeringParams } from '../lib/engineering-param-converter.mjs';
import {
  requireDevicesCanvasColorTokenNames,
  requireDevicesCanvasRendererSource,
} from '../lib/devices-canvas-renderers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPORTS = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const CAPTURE = path.join(REPORTS, 'source-capture');
const SECTIONS = path.join(CAPTURE, 'sections');
const ACTIVITIES = path.join(REPORTS, 'activity-details');
const require = createRequire(import.meta.url);
const { parse } = require(path.join(ROOT, 'app', 'node_modules', 'node-html-parser'));
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const gb18030 = new TextDecoder('gb18030');

const COURSE_CONFIG = {
  manufacturing: {
    id: '2026-ic-manufacturing',
    title: '2026职业赛道初赛IC制造',
    subtitle: '2026 职业赛道初赛',
    description: '2026职业赛道初赛IC制造，由 AutoSMT 2026 满分审计内容逐字转化。',
    coverText: '制造',
    chapterIndexes: [0],
    homeworkByChapter: { 1: [1, 9] },
    expectedQuestions: 71,
  },
  devices: {
    id: '2026-ic-devices',
    title: '2026职业赛道初赛IC器件',
    subtitle: '2026 职业赛道初赛',
    description: '2026职业赛道初赛IC器件，由 AutoSMT 2026 满分审计内容逐字转化。',
    coverText: '器件',
    chapterIndexes: [1, 2],
    homeworkByChapter: { 2: [11, 17], 3: [18, 19] },
    expectedQuestions: 85,
  },
  packaging: {
    id: '2026-ic-packaging',
    title: '2026职业赛道初赛IC封装',
    subtitle: '2026 职业赛道初赛',
    description: '2026职业赛道初赛IC封装，由 AutoSMT 2026 满分审计内容逐字转化。',
    coverText: '封装',
    chapterIndexes: [3, 4, 5],
    homeworkByChapter: { 4: [20, 22], 5: [23, 27], 6: [28, 29] },
    expectedQuestions: 101,
  },
};

const QUESTION_MAPPING_OVERRIDES = {
  '12-2': {
    kind: 'manual-anchor',
    topic: 'LED制造工艺',
    stemPhrases: ['LED普通亮度发光强度'],
    answerPhrases: ['<10mcd'],
    evidenceGap: '满分正确项在理论正文中没有可逐字命中的答案短语；仅以题干主题锚定 LED 制造工艺卡。',
    manualUserDecision: 'batch-handle-similar-issues',
  },
  '12-3': {
    kind: 'manual-anchor',
    topic: 'LED制造工艺',
    stemPhrases: ['LED高亮度发光强度'],
    answerPhrases: ['10～100mcd'],
    evidenceGap: '满分正确项在理论正文中没有可逐字命中的答案短语；仅以题干主题锚定 LED 制造工艺卡。',
    manualUserDecision: 'batch-handle-similar-issues',
  },
  '14-7': {
    kind: 'section-synthesis',
    topic: 'NMOS触发器工艺流程',
    relatedTopics: ['CMOS非门工艺流程', 'NMOS触发器工艺流程'],
    stemPhrases: ['微处理器'],
    answerPhrases: ['组合逻辑电路', '时序逻辑电路'],
    theoryPhrasesByTopic: {
      'CMOS非门工艺流程': ['CMOS非门'],
      'NMOS触发器工艺流程': ['NMOS触发器'],
    },
    placement: 'after-related-section-theory',
    manualUserDecision: 'continue-until-all-courses-delivered',
  },
  '17-12': {
    kind: 'manual-section-placement',
    topic: 'CMOS版图设计规则',
    stemPhrases: ['Active有源区制造工艺流程'],
    answerPhrases: ['氧化→光刻→刻蚀+除胶→掺杂扩散+除氧化膜'],
    evidenceGap: '自动语义证据在 NPN版图设计规则 与 CMOS版图设计规则 两张卡之间同分；放在该小节末张相关理论卡后。',
    manualUserDecision: 'batch-handle-similar-issues',
  },
  '17-14': {
    kind: 'manual-section-placement',
    topic: 'CMOS版图设计规则',
    stemPhrases: ['接触孔和介子层制造工艺流程'],
    answerPhrases: ['CVD介质淀积→光刻→刻蚀+除胶'],
    evidenceGap: '自动语义证据在 NPN版图设计规则 与 CMOS版图设计规则 两张卡之间同分；放在该小节末张相关理论卡后。',
    manualUserDecision: 'batch-handle-similar-issues',
  },
  '19-6': {
    kind: 'manual-anchor',
    topic: 'IC生产工厂',
    stemPhrases: ['IC生产VR虚拟工厂设备上下料'],
    answerPhrases: ['机械手'],
    evidenceGap: '满分正确项在理论正文中没有可逐字命中的答案短语；仅以题干主题锚定 IC生产工厂卡。',
    manualUserDecision: 'batch-handle-similar-issues',
  },
  '20-8': {
    topic: '芯片测试',
    stemPhrases: ['视觉检测'],
    answerPhrases: ['光学显微镜', '电子显微镜'],
    theoryPhrases: ['质量检测', '封装厂会对其产品进行质量和可靠性两方面的检测'],
  },
  '24-5': {
    topic: 'SOP封装工艺',
    stemPhrases: ['邦定丝焊'],
    answerPhrases: ['SOP'],
    theoryPhrases: ['键合', '金丝球焊机', '金线或铝线将晶粒焊盘连接到导脚架的内引脚'],
  },
};

const TEMPERATURE_DRAWING_IDS = new Set(['drawing-3-2', 'drawing-15-1', 'drawing-15-2']);
const RUNTIME_TEMPERATURE_IDS = new Set(['drawing-7-1', 'drawing-16-1', 'drawing-16-2']);

const courseKey = process.argv[2];
const scoreAuthorityCommand = ['--score-authority', '--authority-evidence'].includes(courseKey);
const parameterLabelsCommand = courseKey === '--parameter-labels';
if (courseKey === '--parse-homework-cell' && process.argv.length === 3) {
  const root = parse(readFileSync(0, 'utf8'));
  const cell = root.querySelectorAll('td')[1] || root;
  const { stem, options, keys } = parseHomeworkCell(cell, root.querySelector('select'));
  process.stdout.write(`${JSON.stringify({ stem, options, keys })}\n`);
  process.exit(0);
}
if (parameterLabelsCommand && process.argv.length === 4) {
  const file = path.resolve(ROOT, process.argv[3]);
  if (!file.startsWith(`${ROOT}${path.sep}`) || !existsSync(file)) throw new Error('[HARD STOP] parameter source file is outside the repository or missing');
  process.stdout.write(`${JSON.stringify(parameterLabels(parseParameterHtml(file), file))}\n`);
  process.exit(0);
}
const config = COURSE_CONFIG[courseKey];
if ((!config && !scoreAuthorityCommand) || (!scoreAuthorityCommand && process.argv.length !== 3)) {
  throw new Error('Usage: node tools/autosmt-2026/scripts/rebuild-vocational-course.mjs manufacturing|devices|packaging');
}

const COURSE_DIR = config ? path.join(ROOT, 'courses', '2026-vocational-preliminary', config.id) : null;
const theoryMap = readJson(path.join(REPORTS, 'resource-capture-theory-v1.json')).captured;
const staticMap = readJson(path.join(REPORTS, 'resource-capture-static-v1.json')).captured;
const videoMap = readJson(path.join(REPORTS, 'resource-capture-video-v1.json')).captured;
const processVideoMap = readJson(path.join(REPORTS, 'process-step-video-capture-v1.json')).steps;
const engineeringSimulationMap = readJson(path.join(REPORTS, 'engineering-simulation-capture-v1.json')).steps;
const PECVD_RESULT_CAPTURE = path.join(REPORTS, 'pecvd-result-capture-v1.json');
const pecvdResultMap = readJson(PECVD_RESULT_CAPTURE).simulations;
const candidateAnswers = readJson(path.join(REPORTS, 'candidate-answers.json'));
const activityIndex = readJson(path.join(REPORTS, 'section-activity-index.json')).sections;
const FINAL_SCORE_EVIDENCE = path.join(REPORTS, 'final-score-before-capture.json');
const scoreEvidence = readJson(FINAL_SCORE_EVIDENCE);

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readText(file) {
  const bytes = readFileSync(file);
  try { return utf8Strict.decode(bytes); } catch { return gb18030.decode(bytes); }
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(file) {
  return sha256Bytes(readFileSync(file));
}

function targetHash(value) {
  return sha256Bytes(typeof value === 'string' ? value : JSON.stringify(value));
}

function repoPath(file) {
  return path.relative(ROOT, file).replaceAll('\\', '/');
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/<!\[(?:if\s+[^\]]+|endif)\]>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/\u00a0|\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticKeywords(text) {
  const generic = new Set(['集成电路', '下列', '分为', '包括', '属于', '方法', '工艺', '主要', '一般', '采用']);
  const output = new Set();
  for (const run of String(text).match(/\p{Script=Han}+/gu) || []) {
    const chars = [...run];
    for (let size = Math.min(4, chars.length); size >= 2; size -= 1) {
      for (let index = 0; index + size <= chars.length; index += 1) {
        const value = chars.slice(index, index + size).join('');
        if (!generic.has(value)) output.add(value);
      }
    }
  }
  for (const token of String(text).match(/[A-Za-z][A-Za-z0-9()+/-]{1,}|\d+(?:\.\d+)?/g) || []) {
    output.add(token);
    for (const part of token.match(/[A-Z]{2,}|[A-Z][a-z]+|\d+(?:\.\d+)?/g) || []) output.add(part);
  }
  return [...output];
}

function elementChildren(node) {
  return (node?.childNodes || []).filter((child) => Boolean(child?.tagName));
}

function tagName(node) {
  return node?.tagName?.toLowerCase() || '';
}

function sourcePage(file) {
  return repoPath(file).replace('tools/autosmt-2026/reports/', '');
}

function hardStop(file, node, message) {
  const fragment = normalizeText(node?.outerHTML || node?.textContent || '').slice(0, 320);
  throw new Error(`[HARD STOP] ${message}\nsource=${repoPath(file)}\nfragment=${fragment}`);
}

function finalScoreKey(scoreType) {
  if (Array.isArray(scoreEvidence?.scores?.[scoreType])) return scoreType;
  if (['project', 'projects'].includes(scoreType) && Array.isArray(scoreEvidence?.scores?.engineering)) return 'engineering';
  hardStop(FINAL_SCORE_EVIDENCE, null, `final score collection is unavailable for ${scoreType}`);
}

function finalFullScoreEvidence(scoreType, scoreNumber) {
  const number = Number(scoreNumber);
  if (!Number.isInteger(number) || number <= 0) {
    hardStop(FINAL_SCORE_EVIDENCE, null, `invalid final score number for ${scoreType}: ${scoreNumber}`);
  }
  const key = finalScoreKey(scoreType);
  const matches = scoreEvidence.scores[key]
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => Number(record?.number) === number);
  if (matches.length !== 1) {
    hardStop(FINAL_SCORE_EVIDENCE, null, `final score record must be unique for ${key} ${number}; found ${matches.length}`);
  }
  const { record, index } = matches[0];
  if (record.score !== '100.00') {
    hardStop(FINAL_SCORE_EVIDENCE, null, `final score record is not exactly 100.00 for ${key} ${number}`);
  }
  return {
    sourceFile: repoPath(FINAL_SCORE_EVIDENCE),
    sourceLocation: `/scores/${key}/${index}`,
    sourceSha256: sha256File(FINAL_SCORE_EVIDENCE),
    scoreType: key,
    scoreNumber: number,
    observedScore: record.score,
  };
}

function extractScriptValue(root, name, file) {
  const script = root.querySelectorAll('script').map((item) => item.textContent).join('\n');
  const match = script.match(new RegExp(`var\\s+${name}\\s*=\\s*(["'])((?:\\\\.|(?!\\1).)*)\\1`, 's'));
  if (!match) hardStop(file, root, `missing script variable ${name}`);
  return match[2].replace(/\\\//g, '/');
}

function copyCaptured(entry, folder, forcedExtension = '', sourceRoot = CAPTURE) {
  if (!entry?.file || !entry.sha256) throw new Error(`[HARD STOP] invalid resource map entry for ${folder}`);
  const source = path.join(sourceRoot, entry.file);
  if (!existsSync(source) || readFileSync(source).byteLength === 0) throw new Error(`[HARD STOP] captured resource missing: ${entry.file}`);
  if (entry.bytes != null && readFileSync(source).byteLength !== entry.bytes) throw new Error(`[HARD STOP] captured resource byte mismatch: ${entry.file}`);
  if (sha256File(source) !== entry.sha256) throw new Error(`[HARD STOP] captured resource hash mismatch: ${entry.file}`);
  const extension = forcedExtension || path.extname(entry.file) || '.bin';
  const relative = `assets/${folder}/${entry.sha256}${extension}`;
  const target = path.join(COURSE_DIR, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  if (!existsSync(target)) copyFileSync(source, target);
  if (sha256File(target) !== entry.sha256) throw new Error(`[HARD STOP] copied resource hash mismatch: ${relative}`);
  return relative;
}

function copyEngineeringImage(entry) {
  const allowedRoots = [CAPTURE, path.join(REPORTS, 'engineering-simulations')];
  const matches = allowedRoots.filter((root) => existsSync(path.join(root, entry.file)));
  if (matches.length !== 1) {
    throw new Error(`[HARD STOP] engineering image must resolve in exactly one audited root: ${entry.file}; found ${matches.length}`);
  }
  return copyCaptured(entry, 'images', '', matches[0]);
}

function copyRuntimeResultImage(entry) {
  if (!entry?.file || !entry?.target || entry.contentType !== 'image/jpeg') {
    throw new Error('[HARD STOP] invalid runtime result image evidence');
  }
  if (path.basename(entry.target) !== entry.target || path.extname(entry.target).toLowerCase() !== '.jpg') {
    throw new Error(`[HARD STOP] invalid runtime result target: ${entry.target}`);
  }
  if (!Number.isInteger(entry.decoded?.width) || entry.decoded.width <= 0
    || !Number.isInteger(entry.decoded?.height) || entry.decoded.height <= 0) {
    throw new Error(`[HARD STOP] runtime result lacks decode evidence: ${entry.file}`);
  }
  const source = path.join(CAPTURE, entry.file);
  if (!source.startsWith(`${CAPTURE}${path.sep}`) || !existsSync(source) || readFileSync(source).byteLength === 0) {
    throw new Error(`[HARD STOP] runtime result image missing: ${entry.file}`);
  }
  if (readFileSync(source).byteLength !== entry.bytes || sha256File(source) !== entry.sha256) {
    throw new Error(`[HARD STOP] runtime result image evidence mismatch: ${entry.file}`);
  }
  const relative = `assets/images/${entry.target}`;
  const target = path.join(COURSE_DIR, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  if (sha256File(target) !== entry.sha256) throw new Error(`[HARD STOP] copied runtime result hash mismatch: ${relative}`);
  return relative;
}

function parameterSimulations(id) {
  return (pecvdResultMap[id] || []).map((simulation) => {
    if (!simulation.label || !Array.isArray(simulation.paramRange) || simulation.paramRange.length !== 2) {
      throw new Error(`[HARD STOP] invalid parameter simulation evidence: ${id}`);
    }
    const images = (simulation.images || []).map((image) => ({
      src: copyRuntimeResultImage(image),
      alt: image.alt,
      caption: image.caption,
    }));
    if (!images.length || images.some((image) => !image.alt || !image.caption)) {
      throw new Error(`[HARD STOP] incomplete parameter simulation images: ${id}`);
    }
    return { label: simulation.label, paramRange: simulation.paramRange, images };
  });
}

function resolveStatic(raw, page, file, node) {
  const normalizedRaw = decodeURIComponent(raw).replaceAll('\\', '/').replace(/^\.\.\//, '');
  const matches = Object.entries(staticMap).filter(([key, entry]) => {
    const normalizedKey = decodeURIComponent(key).replaceAll('\\', '/');
    return (entry.sourcePages || []).includes(page)
      && (key === raw || normalizedKey.endsWith(`/${normalizedRaw}`));
  });
  if (matches.length !== 1) hardStop(file, node, `static resource mapping must be unique for ${raw}; found ${matches.length}`);
  return copyCaptured(matches[0][1], 'images');
}

function resolveVideo(endpoint, file, node) {
  const entry = videoMap[endpoint];
  if (!entry || entry.contentType !== 'video/mp4') hardStop(file, node, `video mapping missing for ${endpoint}`);
  return copyCaptured(entry, 'media', '.mp4');
}

function textLines(node) {
  return String(node?.innerHTML || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(Boolean);
}

function richText(node, file) {
  const spans = [];
  function append(text, flags = {}) {
    const value = normalizeText(text);
    if (value) spans.push({ t: value, ...flags });
  }
  function visit(child, flags = {}) {
    if (child.nodeType === 3) { append(child.textContent, flags); return; }
    const tag = tagName(child);
    if (tag === 'br') { append('\n', flags); return; }
    if (['span', 'font', 'o:p', 'i', 'em'].includes(tag)) {
      for (const nested of child.childNodes || []) visit(nested, flags);
      return;
    }
    if (['b', 'strong'].includes(tag)) {
      for (const nested of child.childNodes || []) visit(nested, { ...flags, b: true });
      return;
    }
    hardStop(file, child, `unsupported inline tag <${tag}>`);
  }
  for (const child of node.childNodes || []) visit(child);
  return spans;
}

function tableCell(cell, isHeader, page, file) {
  const images = cell.querySelectorAll('img');
  const result = {};
  const text = normalizeText(cell.textContent);
  if (text) result.text = text;
  if (images.length === 1) {
    result.image = {
      src: resolveStatic(images[0].getAttribute('src'), page, file, images[0]),
      alt: images[0].getAttribute('alt') || '',
    };
  } else if (images.length > 1) {
    result.images = images.map((image) => ({
      src: resolveStatic(image.getAttribute('src'), page, file, image),
      alt: image.getAttribute('alt') || '',
    }));
  }
  const rowspan = Number(cell.getAttribute('rowspan') || 1);
  const colspan = Number(cell.getAttribute('colspan') || 1);
  if (!Number.isInteger(rowspan) || rowspan < 1 || !Number.isInteger(colspan) || colspan < 1) hardStop(file, cell, 'invalid table span');
  if (rowspan > 1) result.rowspan = rowspan;
  if (colspan > 1) result.colspan = colspan;
  if (isHeader || tagName(cell) === 'th') { result.header = true; result.scope = 'col'; }
  if (!Object.keys(result).length) return '';
  if (Object.keys(result).length === 1 && Object.hasOwn(result, 'text')) return result.text;
  return result;
}

function staticTable(table, page, file) {
  const rows = table.querySelectorAll('tr').map((row) => elementChildren(row).filter((cell) => ['th', 'td'].includes(tagName(cell))));
  if (rows.length < 2 || rows.some((row) => row.length === 0)) hardStop(file, table, 'static table shape is incomplete');
  return {
    type: 'paramsTable',
    headers: rows[0].map((cell) => tableCell(cell, true, page, file)),
    rows: rows.slice(1).map((row) => row.map((cell) => tableCell(cell, false, page, file))),
  };
}

function convertTheorySection(section, topic, file, page) {
  const children = elementChildren(section);
  if (!children.length) hardStop(file, section, `empty theory topic ${topic}`);
  const blocks = [];
  let start = 0;
  if (tagName(children[0]) === 'p' && normalizeText(children[0].textContent) === topic) start = 1;
  for (let index = start; index < children.length; index += 1) {
    const node = children[index];
    const tag = tagName(node);
    if (tag === 'table') { blocks.push(staticTable(node, page, file)); continue; }
    if (!['p', 'div'].includes(tag)) hardStop(file, node, `unsupported theory top-level tag <${tag}>`);
    const tables = node.querySelectorAll('table');
    if (tables.length) {
      const nonTable = elementChildren(node).filter((child) => tagName(child) !== 'table');
      if (nonTable.length) hardStop(file, node, 'mixed table container cannot be converted losslessly');
      tables.forEach((table) => blocks.push(staticTable(table, page, file)));
      continue;
    }
    const images = node.querySelectorAll('img');
    const text = normalizeText(node.textContent);
    if (text) {
      if (text === topic && blocks.length === 0) continue;
      const listMatch = text.match(/^(\d+）)\s*(.*)$/s);
      if (listMatch) {
        const items = [];
        let cursor = index;
        while (cursor < children.length && tagName(children[cursor]) === 'p') {
          const item = normalizeText(children[cursor].textContent).match(/^(\d+）)\s*(.*)$/s);
          if (!item) break;
          if (!item[2]) hardStop(file, children[cursor], 'empty ordered list item');
          items.push([{ t: item[2] }]);
          cursor += 1;
        }
        blocks.push({ type: 'list', ordered: true, items });
        index = cursor - 1;
      } else if (/^\d+\s*\./.test(text)) blocks.push({ type: 'numTitle', text });
      else if (text.length <= 30 && (/text-align\s*:\s*center/i.test(node.getAttribute('style') || '') || images.length)) blocks.push({ type: 'boldCaption', text });
      else {
        const spans = richText(node, file).filter((span) => span.t !== '\n');
        blocks.push({ type: 'paragraph', spans: spans.length ? spans : [{ t: text }] });
      }
    }
    if (images.length) {
      const converted = images.map((image) => ({
        src: resolveStatic(image.getAttribute('src'), page, file, image),
        alt: image.getAttribute('alt') || '',
      }));
      blocks.push(converted.length === 1 ? { type: 'image', ...converted[0] } : { type: 'imageGroup', images: converted });
    }
  }
  if (!blocks.length) hardStop(file, section, `theory topic produced no blocks: ${topic}`);
  return blocks;
}

function theoryTopics(sectionKey) {
  const indexFile = path.join(SECTIONS, sectionKey, 'theory.html');
  const root = parse(readText(indexFile));
  const names = extractScriptValue(root, 'strllzs', indexFile).split('|').filter(Boolean);
  if (!names.length) hardStop(indexFile, root, 'theory topic list is empty');
  return names.map((topic) => {
    const key = `../Html/${topic}.html`;
    const entry = theoryMap[key];
    if (!entry || !(entry.sourcePages || []).includes(`source-capture/sections/${sectionKey}/theory.html`)) {
      hardStop(indexFile, root, `theory resource mapping missing for ${topic}`);
    }
    const file = path.join(CAPTURE, entry.file);
    if (sha256File(file) !== entry.sha256) throw new Error(`[HARD STOP] theory source hash mismatch: ${entry.file}`);
    const sourceRoot = parse(readText(file));
    const section = sourceRoot.querySelector('div.Section0') || sourceRoot.querySelector('.Section0');
    if (!section) hardStop(file, sourceRoot, `theory Section0 missing for ${topic}`);
    const blocks = convertTheorySection(section, topic, file, sourcePage(file));
    const sourceText = normalizeText(readText(file).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' '));
    return { topic, file, blocks, sourceText };
  });
}

function overview(sectionKey) {
  const file = path.join(SECTIONS, sectionKey, 'overview.html');
  const root = parse(readText(file));
  const article = root.querySelector('.ax-article');
  if (!article) hardStop(file, root, 'overview article missing');
  const blocks = [];
  for (const child of elementChildren(article)) {
    if (tagName(child) === 'p') {
      for (const line of textLines(child)) blocks.push({ type: 'paragraph', spans: [{ t: line }] });
    } else if (tagName(child) === 'img') {
      blocks.push({ type: 'image', src: resolveStatic(child.getAttribute('src'), sourcePage(file), file, child), alt: child.getAttribute('alt') || '' });
    } else hardStop(file, child, `unsupported overview tag <${tagName(child)}>`);
  }
  if (!blocks.length) hardStop(file, article, 'overview is empty');
  return { file, blocks };
}

function lectureVideos(sectionKey) {
  const file = path.join(SECTIONS, sectionKey, 'lecture-video.html');
  const root = parse(readText(file));
  const names = extractScriptValue(root, 'strvideoname', file).split('|').filter(Boolean);
  const numbers = extractScriptValue(root, 'strvideonum', file).split('|').filter(Boolean);
  if (!names.length || names.length !== numbers.length) hardStop(file, root, 'lecture video title/id mismatch');
  return names.map((title, index) => ({ title, sourceFile: file, block: { type: 'video', title, src: resolveVideo(`PlayVideo.php?videoId=${numbers[index]}`, file, root) } }));
}

function parseHomework(sectionKey, homeworkNumber) {
  const file = path.join(SECTIONS, sectionKey, 'homework.html');
  const root = parse(readText(file));
  const rows = root.querySelectorAll('tr').filter((row) => row.querySelectorAll('select').length === 1);
  const answerSource = [3, 13, 16, 17, 18, 19].includes(homeworkNumber)
    ? path.join(REPORTS, `solve-work-${homeworkNumber}.json`)
    : path.join(REPORTS, 'candidate-answers.json');
  const answers = answerSource.endsWith('candidate-answers.json')
    ? candidateAnswers[String(homeworkNumber)]
    : readJson(answerSource).answers;
  if (!Array.isArray(answers) || answers.length !== rows.length) hardStop(file, root, `homework ${homeworkNumber} answer count mismatch`);
  const finalScoreEvidence = finalFullScoreEvidence('homework', homeworkNumber);
  return rows.map((row, index) => {
    const cells = elementChildren(row).filter((cell) => ['td', 'th'].includes(tagName(cell)));
    const sourceId = normalizeText(cells[0]?.textContent);
    const parsed = parseHomeworkCell(cells[1], row.querySelector('select'));
    if (!sourceId || !parsed.stem) hardStop(file, row, `question ${index + 1} is malformed`);
    const { stem, options, keys, validOptionOrder } = parsed;
    if (!validOptionOrder) hardStop(file, row, `question ${sourceId} option count/order mismatch`);
    const answer = answers[index];
    if (!keys.includes(answer)) hardStop(file, row, `question ${sourceId} answer does not identify an option`);
    return {
      sourceId,
      sourceFile: file,
      answerSource,
      answerIndex: index,
      finalScoreEvidence,
      question: { type: 'single', stem, options, answer },
    };
  });
}

function parseHomeworkCell(cell, select) {
  const raw = normalizeText(cell?.textContent);
  const optionStart = raw.search(/(?:^|\s)[A-Z]\./);
  if (optionStart < 1) return { stem: '', options: [], keys: [], validOptionOrder: false };
  const stem = raw.slice(0, optionStart).trim();
  const optionText = raw.slice(optionStart).trim();
  const matches = [...optionText.matchAll(/([A-Z])\.\s*([\s\S]*?)(?=[A-Z]\.|$)/g)];
  const keys = select?.querySelectorAll('option').map((option) => option.getAttribute('value')).filter(Boolean) || [];
  const options = matches.map((match) => `${match[1]}. ${match[2].trim()}`);
  return {
    stem,
    options,
    keys,
    validOptionOrder: matches.length === keys.length && matches.every((match, index) => match[1] === keys[index]),
  };
}

function activityCards(sectionKey) {
  const section = activityIndex.find((item) => `${item.chapterIndex}-${item.sectionIndex}` === sectionKey);
  if (!section) throw new Error(`[HARD STOP] section activity index missing: ${sectionKey}`);
  const expectedNames = [...section.experiments, ...section.engineering];
  return expectedNames.map((activityName) => {
    const files = readdirSync(ACTIVITIES).filter((name) => name.endsWith('.json')).map((name) => ({ name, data: readJson(path.join(ACTIVITIES, name)) }))
      .filter(({ data }) => data.activity === activityName && `${data.chapterIndex}-${data.sectionIndex}` === sectionKey)
      .sort((left, right) => left.data.subIndex - right.data.subIndex);
    if (!files.length) throw new Error(`[HARD STOP] activity detail missing: ${activityName}`);
    return {
      title: activityName,
      tabs: files.map(({ data }) => ({
        label: data.label,
        meta: data,
        file: path.join(ACTIVITIES, data.rawHtmlFile),
      })),
    };
  });
}

function sanitizeActivityStatic(html, file) {
  const root = parse(html);
  root.querySelectorAll('script').forEach((node) => node.remove());
  const blocks = [];
  const article = root.querySelector('.my-article') || root;
  for (const child of elementChildren(article)) {
    const tag = tagName(child);
    if (child.querySelectorAll('select, canvas, input, textarea, button').length) continue;
    if (tag === 'div' && child.querySelector('h3')) {
      const text = normalizeText(child.textContent);
      if (text) blocks.push({ type: 'heading', text });
      continue;
    }
    if (tag === 'p') {
      for (const line of textLines(child)) blocks.push({ type: 'paragraph', spans: [{ t: line }] });
      continue;
    }
    if (tag === 'table') { blocks.push(staticTable(child, sourcePage(file), file)); continue; }
    if (tag === 'img') {
      blocks.push({ type: 'image', src: resolveStatic(child.getAttribute('src'), sourcePage(file), file, child), alt: child.getAttribute('alt') || '' });
      continue;
    }
    if (tag === 'video') {
      blocks.push({ type: 'video', title: child.getAttribute('title') || '', src: resolveVideo(child.getAttribute('src'), file, child) });
      continue;
    }
    if (tag === 'div') {
      const images = child.querySelectorAll('img');
      const paragraphs = child.querySelectorAll('p');
      paragraphs.forEach((paragraph) => textLines(paragraph).forEach((line) => blocks.push({ type: 'paragraph', spans: [{ t: line }] })));
      if (images.length) {
        const converted = images.filter((image) => Boolean(image.getAttribute('src'))).map((image) => ({ src: resolveStatic(image.getAttribute('src'), sourcePage(file), file, image), alt: image.getAttribute('alt') || '' }));
        if (converted.length) blocks.push(converted.length === 1 ? { type: 'image', ...converted[0] } : { type: 'imageGroup', images: converted });
      }
    }
  }
  return blocks;
}

function matrixCellContent(cell, headers, cellIndex, options, answers, state, file) {
  const parts = [];
  const label = normalizeText(cell.textContent) || headers[cellIndex] || '';
  const visit = (node) => {
    if (!node?.tagName) {
      const text = String(node?.textContent ?? node?.rawText ?? '');
      if (text.trim()) parts.push({ type: 'text', text });
      return;
    }
    if (tagName(node) === 'select') {
      const optionList = options[state.controlIndex];
      const answerIndex = optionList?.indexOf(String(answers[state.controlIndex])) + 1;
      if (!label || !Array.isArray(optionList) || optionList.length === 0 || answerIndex < 1) {
        hardStop(file, cell, `parameter matrix control is incomplete at index ${state.controlIndex}`);
      }
      parts.push({ type: 'control', label, options: optionList, answerIndex });
      state.controlIndex += 1;
      return;
    }
    (node.childNodes || []).forEach(visit);
  };
  (cell.childNodes || []).forEach(visit);
  return parts;
}

function matrixParameterRows(root, options, answers, file) {
  const candidates = root.querySelectorAll('table').filter((table) => table.querySelectorAll('select').length === options.length);
  if (candidates.length !== 1) return null;
  const sourceRows = candidates[0].querySelectorAll('tr');
  const rowsWithControls = sourceRows.filter((row) => row.querySelectorAll('select').length > 0);
  const rows = sourceRows;
  if (!rowsWithControls.length) return null;
  if (!rowsWithControls.some((row) => row.querySelectorAll('select').length > 1)) return null;
  const firstCells = rows[0]?.querySelectorAll('th,td') || [];
  const hasColumnHeader = firstCells.length > 0
    && rows[0].querySelectorAll('select').length === 0
    && firstCells.every((cell) => tagName(cell) === 'th');
  const headers = hasColumnHeader ? firstCells.map((cell) => normalizeText(cell.textContent)) : [];
  if (headers.some((header) => !header)) hardStop(file, rows[0], 'parameter matrix contains an empty column header');
  const state = { controlIndex: 0 };
  const matrixRows = rows.map((row, rowIndex) => {
    const cells = row.querySelectorAll('th,td');
    return {
      cells: cells.map((cell, cellIndex) => {
        const tag = tagName(cell);
        const rowspan = Number(cell.getAttribute('rowspan') || 1);
        const colspan = Number(cell.getAttribute('colspan') || 1);
        const scope = cell.getAttribute('scope') || (tag === 'th' ? (hasColumnHeader && rowIndex === 0 ? 'col' : 'row') : '');
        return {
          tag,
          ...(scope ? { scope } : {}),
          ...(rowspan > 1 ? { rowspan } : {}),
          ...(colspan > 1 ? { colspan } : {}),
          content: matrixCellContent(cell, headers, cellIndex, options, answers, state, file),
        };
      }),
    };
  });
  if (state.controlIndex !== options.length) hardStop(file, candidates[0], `parameter matrix consumed ${state.controlIndex} controls; expected ${options.length}`);
  return { matrixRows };
}

function parameterBlock(tab) {
  const root = parseParameterHtml(tab.file);
  const options = JSON.parse(extractScriptValue(root, 'jsonstr_xx', tab.file)).map((row) => String(row).split(';').filter(Boolean));
  const selects = root.querySelectorAll('select');
  const evidence = fullScoreActivityEvidence(tab.meta.scoreType, tab.meta.scoreNumber, tab.meta.subIndex);
  if (!evidence) hardStop(tab.file, root, `${tab.meta.activity}/${tab.label} lacks full-score parameter evidence`);
  const answers = evidence.values;
  const controlCount = tab.meta.selectCount;
  if (controlCount !== options.length || selects.length !== controlCount || answers.length !== controlCount || answers.some((answer) => !answer)) hardStop(tab.file, root, `${tab.meta.activity}/${tab.label} lacks a full-score parameter answer`);
  const matrix = matrixParameterRows(root, options, answers, tab.file);
  const id = `${tab.meta.scoreType}-${tab.meta.scoreNumber}-${tab.meta.subIndex}`;
  const simulations = parameterSimulations(id);
  if (matrix) {
    return { type: 'paramSelect', id, title: tab.label, ...matrix, ...(simulations.length ? { simulations } : {}) };
  }
  const table = root.querySelector('table');
  const headers = table?.querySelectorAll('tr')[0]?.querySelectorAll('th,td').map((cell) => normalizeText(cell.textContent)) || [];
  if (headers.some((header) => !header)) hardStop(tab.file, table || root, 'parameter table contains an empty header');
  const labels = parameterLabels(root, tab.file);
  const params = options.map((optionList, index) => {
    const select = selects[index];
    const label = labels[index];
    const answerIndex = optionList.indexOf(String(answers[index])) + 1;
    if (answerIndex < 1) hardStop(tab.file, select || root, `parameter answer is not in options at index ${index}`);
    return { label, options: optionList, answerIndex };
  });
  return { type: 'paramSelect', id, title: tab.label, ...(headers.length ? { headers } : {}), groups: [{ params }], ...(simulations.length ? { simulations } : {}) };
}

function runtimeTemperatureCurve(id, values) {
  const numbers = values.map(Number);
  if (id === 'drawing-7-1') {
    const [heatTemperature, substrateTemperature, substrateMinutes, purgeTemperature, purgeMinutes, growthTemperature, growthMinutes, holdTemperature, holdMinutes, coolTemperature] = numbers;
    return [
      [0, 25],
      [60, heatTemperature],
      [60 + substrateMinutes, substrateTemperature],
      [60 + substrateMinutes + 3, purgeTemperature],
      [60 + substrateMinutes + 3 + purgeMinutes, purgeTemperature],
      [60 + substrateMinutes + 3 + purgeMinutes + growthMinutes, growthTemperature],
      [60 + substrateMinutes + 3 + purgeMinutes + growthMinutes + 10, growthTemperature],
      [60 + substrateMinutes + 3 + purgeMinutes + growthMinutes + 10 + holdMinutes, holdTemperature],
      [60 + substrateMinutes + 3 + purgeMinutes + growthMinutes + 10 + holdMinutes + 30, coolTemperature],
    ];
  }
  const [preheatTemperature, sourceTemperature, sourceMinutes] = numbers;
  return [[0, 25], [60, preheatTemperature], [60 + sourceMinutes, sourceTemperature], [100, 25]];
}

function runtimeTemperatureEvidence(id, answers, file) {
  const descriptor = {
    'drawing-7-1': { scoreNumber: 7, subIndex: 1 },
    'drawing-16-1': { scoreNumber: 16, subIndex: 1 },
    'drawing-16-2': { scoreNumber: 16, subIndex: 2 },
  }[id];
  if (!descriptor) return null;
  const captureFile = path.join(REPORTS, 'runtime-response-capture-v1.json');
  const capture = readJson(captureFile);
  const records = (capture.temperatureCurves || []).filter((record) => (
    Number(record?.activity?.scoreNumber) === descriptor.scoreNumber
    && Number(record?.activity?.subIndex) === descriptor.subIndex
  ));
  if (records.length !== 1) hardStop(file, null, `${id} runtime temperature response count is ${records.length}, expected 1`);
  const record = records[0];
  const expected = runtimeTemperatureCurve(id, answers);
  if (JSON.stringify(record.response?.numericValue) !== JSON.stringify(expected)) {
    hardStop(file, null, `${id} full-score curve differs from captured runtime response`);
  }
  const sourceIndex = capture.temperatureCurves.indexOf(record);
  if (sourceIndex < 0 || !record.response?.raw || !record.response?.sha256) hardStop(file, null, `${id} runtime temperature response is incomplete`);
  return {
    sourceFile: repoPath(captureFile),
    sourceLocation: `/temperatureCurves/${sourceIndex}`,
    sourceValueSha256: targetHash(record),
    responseSha256: record.response.sha256,
  };
}

function runtimeTemperatureBlocks(tab) {
  const id = `drawing-${tab.meta.scoreNumber}-${tab.meta.subIndex}`;
  const root = parseParameterHtml(tab.file);
  const options = JSON.parse(extractScriptValue(root, 'jsonstr_xx', tab.file)).map((row) => String(row).split(';').filter(Boolean));
  const selects = root.querySelectorAll('select');
  const evidence = fullScoreActivityEvidence(tab.meta.scoreType, tab.meta.scoreNumber, tab.meta.subIndex);
  if (!evidence || selects.length !== options.length || evidence.values.length !== options.length) hardStop(tab.file, root, `${tab.meta.activity}/${tab.label} lacks complete temperature curve parameters`);
  const answers = evidence.values.map(String);
  const table = drawingTable(root, options, tab.file, id, null);
  const labels = table.sourceTable.querySelectorAll('select').map((select) => normalizeText(select.closest('p')?.textContent || '') || normalizeText(select.closest('td')?.textContent || ''));
  const curveEvidence = runtimeTemperatureEvidence(id, answers, tab.file);
  const actionLabel = normalizeText(root.querySelector('#btn_wdqxfz')?.textContent || '');
  if (!actionLabel) hardStop(tab.file, root, `${id} source action label is missing`);
  const sandbox = buildDrawingSandbox({
    id,
    title: normalizeText(root.querySelector('h3')?.textContent || tab.label),
    tableHtml: table.html,
    options,
    answers,
    labels,
    actions: [actionLabel],
    rendererSource: temperatureDrawingRendererSource(id),
  });
  return {
    blocks: [sandbox],
    evidence,
    sourceLedger: [{
      target: 'sandbox/html',
      kind: 'runtime-temperature-sandbox',
      sourceFile: curveEvidence.sourceFile,
      sourceLocation: curveEvidence.sourceLocation,
      embeddedEvidence: [{
        sourcePointer: curveEvidence.sourceLocation,
        sourceValueSha256: curveEvidence.sourceValueSha256,
        responseSha256: curveEvidence.responseSha256,
      }],
    }],
  };
}

function parseParameterHtml(file) {
  const html = readText(file).replace(/(<select\b[^>]*>)(?=\s*<\/td>)/gi, '$1</select>');
  return parse(html);
}

function parameterLabels(root, file) {
  return root.querySelectorAll('select').map((select, index) => {
    const paragraph = select.closest('p');
    let label = normalizeText(paragraph?.textContent || '').replace(/请选择\.\./g, '').replace(/[:：]\s*$/, '');
    if (!label) {
      const cell = select.closest('td') || select.closest('th');
      const row = cell?.closest('tr');
      const cells = row?.querySelectorAll('th,td') || [];
      const cellIndex = cells.indexOf(cell);
      if (row?.querySelectorAll('select').length > 1) {
        const table = row.closest('table');
        const headerCells = table?.querySelectorAll('tr')[0]?.querySelectorAll('th,td') || [];
        label = normalizeText(headerCells[cellIndex]?.textContent || '');
      } else {
        label = cells.slice(0, cellIndex).reverse()
          .map((candidate) => normalizeText(candidate.textContent))
          .find((candidate) => candidate && !/^\d+$/.test(candidate)) || '';
      }
    }
    if (!label) hardStop(file, select, `parameter label is missing at select index ${index}`);
    return label;
  });
}

const PN_BIAS_DRAWING_ACTIONS = [
  '不加偏置电压仿真',
  '外加正向偏压仿真',
  '外加反向偏压仿真',
];
const PN_VI_DRAWING_ACTIONS = ['温度曲线仿真'];

function drawingTable(root, optionLists, file, id, actions) {
  const candidates = root.querySelectorAll('table')
    .filter((table) => table.querySelectorAll('select').length === optionLists.length);
  if (candidates.length !== 1) hardStop(file, root, `drawing parameter table must be unique; found ${candidates.length}`);
  const sourceTable = candidates[0];
  const clone = parse(sourceTable.outerHTML).querySelector('table');
  const links = clone.querySelectorAll('a');
  const expectedActions = id === 'drawing-22-1'
    ? PN_BIAS_DRAWING_ACTIONS
    : id === 'drawing-22-2'
      ? PN_VI_DRAWING_ACTIONS
      : null;
  if (expectedActions) {
    const configuredActions = Array.isArray(actions)
      && actions.length === expectedActions.length
      && actions.every((action, index) => action === expectedActions[index]);
    const actionRows = links.map((link) => link.closest('tr'));
    const actionRowsMatch = configuredActions
      && links.length === actions.length
      && links.every((link, index) => normalizeText(link.textContent) === actions[index])
      && actionRows.every((row, index) => {
        const cell = links[index].closest('td');
        return row
          && cell
          && cell.parentNode === row
          && row.querySelectorAll('th,td').length === 1
          && cell.querySelectorAll('*').length === 1
          && links[index].parentNode === cell
          && normalizeText(row.textContent) === actions[index];
      })
      && new Set(actionRows).size === actionRows.length;
    if (!actionRowsMatch) hardStop(file, sourceTable, 'drawing-22-1 action rows do not exactly match the configured source actions');
    actionRows.forEach((row) => row.remove());
  } else if (links.length) {
    hardStop(file, sourceTable, 'drawing table links are not allowlisted');
  }
  const sourceMarks = clone.querySelectorAll('div.mark');
  if (sourceMarks.length) {
    if (!['drawing-33-0', 'drawing-34-0'].includes(id)) hardStop(file, sourceTable, 'drawing legend marks are not allowlisted');
    const sourceColors = sourceMarks.map((mark) => {
      const attributes = Object.keys(mark.rawAttributes || {}).map((attribute) => attribute.toLowerCase()).sort();
      const color = mark.getAttribute('style')?.match(/^\s*background-color\s*:\s*(rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))\s*;?\s*$/i)?.[1];
      if (attributes.join(',') !== 'class,style' || mark.getAttribute('class') !== 'mark'
        || normalizeText(mark.textContent) || elementChildren(mark).length || !color) {
        hardStop(file, mark, 'drawing legend mark structure is not supported');
      }
      return color;
    });
    const markTokens = requireDevicesCanvasColorTokenNames(id, sourceColors);
    sourceMarks.forEach((mark, index) => mark.replaceWith(`<span data-drawing-mark-token="${markTokens[index]}"></span>`));
  }
  const allowed = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'p', 'br', 'span', 'b', 'strong', 'em', 'h4', 'select']);
  const elements = [clone, ...clone.querySelectorAll('*')];
  let controlIndex = 0;
  for (const element of elements) {
    const tag = tagName(element);
    if (!allowed.has(tag)) hardStop(file, sourceTable, `unsupported drawing table tag <${tag}>`);
    const preserved = ['th', 'td'].includes(tag)
      ? new Set(['rowspan', 'colspan', 'scope'])
      : tag === 'span' && element.getAttribute('data-drawing-mark-token')
        ? new Set(['data-drawing-mark-token'])
        : new Set();
    for (const attribute of Object.keys(element.rawAttributes || {})) {
      if (!preserved.has(attribute.toLowerCase())) element.removeAttribute(attribute);
    }
    if (tag === 'select') {
      element.set_content('');
      element.setAttribute('data-control-index', String(controlIndex));
      controlIndex += 1;
    }
  }
  if (controlIndex !== optionLists.length) hardStop(file, sourceTable, 'drawing control count changed while sanitizing source table');
  return { html: clone.outerHTML, sourceTable };
}

function drawingBlocks(tab) {
  const root = parse(readText(tab.file));
  const optionLists = JSON.parse(extractScriptValue(root, 'jsonstr_xx', tab.file))
    .map((row) => String(row).split(';').filter(Boolean));
  const evidence = fullScoreActivityEvidence(tab.meta.scoreType, tab.meta.scoreNumber, tab.meta.subIndex);
  const answers = evidence?.values?.map(String);
  if (!answers || answers.length !== optionLists.length) hardStop(tab.file, root, `${tab.meta.activity}/${tab.label} lacks full-score drawing answers`);
  answers.forEach((answer, index) => {
    if (!optionLists[index].includes(answer)) hardStop(tab.file, root, `${tab.meta.activity}/${tab.label} answer is not in drawing options at index ${index}`);
  });

  const id = `drawing-${tab.meta.scoreNumber}-${tab.meta.subIndex}`;
  const title = normalizeText(root.querySelector('h3')?.textContent || '');
  if (!title) hardStop(tab.file, root, `${tab.meta.activity}/${tab.label} drawing title missing`);
  const drawingActions = id === 'drawing-22-1'
    ? PN_BIAS_DRAWING_ACTIONS
    : id === 'drawing-22-2'
      ? PN_VI_DRAWING_ACTIONS
      : null;
  const table = drawingTable(root, optionLists, tab.file, id, drawingActions);
  const pnViLabel = id === 'drawing-22-2'
    ? normalizeText(table.sourceTable.querySelectorAll('th').find((cell) => normalizeText(cell.textContent).includes('Ube'))?.textContent || '')
    : '';
  const fallbackLabel = pnViLabel || normalizeText(table.sourceTable.querySelectorAll('th').at(-1)?.textContent || title);
  const labels = table.sourceTable.querySelectorAll('select').map((select) => (
    normalizeText(select.closest('p')?.textContent || '') || fallbackLabel
  ));
  const rendererSource = deviceOutputDrawingRendererSource(id)
    || (TEMPERATURE_DRAWING_IDS.has(id) ? temperatureDrawingRendererSource(id) : null)
    || (courseKey === 'devices' ? requireDevicesCanvasRendererSource(id) : null);
  if (!rendererSource) hardStop(tab.file, root, `${tab.meta.activity}/${tab.label} drawing renderer is not implemented`);
  const sandbox = buildDrawingSandbox({
    id,
    title,
    tableHtml: table.html,
    options: optionLists,
    answers,
    labels,
    initialValues: id.startsWith('drawing-19-') ? Array(optionLists.length).fill(0) : null,
    actions: drawingActions,
    canvasWidth: id === 'drawing-33-0' || id === 'drawing-34-0' ? 1000 : undefined,
    canvasHeight: id === 'drawing-33-0' || id === 'drawing-34-0' ? 600 : undefined,
    rendererSource,
  });
  const blocks = [];
  const images = root.querySelectorAll('img').filter((image) => Boolean(image.getAttribute('src'))).map((image) => ({
    src: resolveStatic(image.getAttribute('src'), sourcePage(tab.file), tab.file, image),
    alt: image.getAttribute('alt') || '',
  }));
  if (images.length) blocks.push(images.length === 1 ? { type: 'image', ...images[0] } : { type: 'imageGroup', images });
  const subtitle = normalizeText(root.querySelector('h4')?.textContent || '');
  if (subtitle) blocks.push({ type: 'heading', text: subtitle });
  blocks.push(sandbox);
  return { blocks, sourceLedger: runtimeResponseSandboxLedger(id) };
}

function runtimeResponseSandboxLedger(id) {
  const locations = {
    'drawing-22-0': { collection: 'czndjs', scoreNumber: 22, sourceLocation: '/czndjs', expected: 81 },
    'drawing-33-0': { collection: 'drawings', scoreNumber: 33, sourceLocation: '/drawings/0', expected: 1 },
    'drawing-34-0': { collection: 'drawings', scoreNumber: 34, sourceLocation: '/drawings/1', expected: 1 },
  };
  const descriptor = locations[id];
  if (!descriptor) return [];
  const sourceFile = path.join(REPORTS, 'runtime-response-capture-v1.json');
  const capture = readJson(sourceFile);
  const records = (capture[descriptor.collection] || []).filter((record) => Number(record?.activity?.scoreNumber) === descriptor.scoreNumber);
  if (records.length !== descriptor.expected) {
    throw new Error(`[HARD STOP] ${id} runtime response capture count is ${records.length}, expected ${descriptor.expected}`);
  }
  const embeddedEvidence = records.map((record) => {
    const sourceIndex = capture[descriptor.collection].indexOf(record);
    if (sourceIndex < 0 || !record?.response?.raw || !record?.response?.sha256) {
      throw new Error(`[HARD STOP] ${id} runtime response capture record is incomplete`);
    }
    return {
      sourcePointer: `/${descriptor.collection}/${sourceIndex}`,
      sourceValueSha256: targetHash(record),
      responseSha256: record.response.sha256,
    };
  });
  return [{
    target: 'sandbox/html',
    kind: 'runtime-response-sandbox',
    sourceFile: repoPath(sourceFile),
    sourceLocation: descriptor.sourceLocation,
    embeddedEvidence,
  }];
}

const activityEvidenceCache = new Map();
function fullScoreActivityEvidence(scoreType, scoreNumber, subIndex) {
  const normalizedType = scoreType === 'project' || scoreType === 'projects' ? 'engineering' : scoreType;
  const key = `${normalizedType}:${scoreNumber}:${subIndex}`;
  if (activityEvidenceCache.has(key)) return activityEvidenceCache.get(key);
  const matches = [];
  for (const name of readdirSync(REPORTS)) {
    if (!name.startsWith(`ui-state-${normalizedType}-`) || !name.endsWith('.json')) continue;
    const file = path.join(REPORTS, name);
    let data;
    try { data = readJson(file); } catch { continue; }
    const dataType = data.scoreType === 'project' || data.scoreType === 'projects' ? 'engineering' : data.scoreType;
    if (dataType !== normalizedType || Number(data.scoreNumber) !== Number(scoreNumber) || Number(data.score) !== 100) continue;
    for (const tab of data.tabs || []) {
      if (Number(tab.subIndex) !== Number(subIndex) || !Array.isArray(tab.selectedValues) || tab.selectedValues.some((value) => !value)) continue;
      matches.push({
        file,
        values: tab.selectedValues.map(String),
        scoreType: normalizedType,
        scoreNumber: Number(scoreNumber),
        subIndex: Number(subIndex),
        sourceLocation: `/tabs/${tab.subIndex}/selectedValues`,
      });
    }
  }
  if (!matches.length) {
    activityEvidenceCache.set(key, null);
    return null;
  }
  const unique = new Set(matches.map((match) => JSON.stringify(match.values)));
  if (unique.size !== 1) {
    throw new Error(`[HARD STOP] multiple conflicting full-score parameter answers for ${normalizedType} ${scoreNumber} tab ${subIndex}`);
  }
  const evidence = matches[0];
  activityEvidenceCache.set(key, evidence);
  return evidence;
}

function processVideoEntries(tab) {
  const matches = Object.values(processVideoMap)
    .filter((entry) => entry?.target?.scoreType === tab.meta.scoreType
      && Number(entry.target.scoreNumber) === Number(tab.meta.scoreNumber)
      && Number(entry.target.subIndex) === Number(tab.meta.subIndex))
    .sort((left, right) => left.step - right.step);
  if (!matches.length) return [];
  matches.forEach((entry, index) => {
    if (entry.step !== index || entry.status !== 'captured' || entry.contentType !== 'video/mp4') {
      hardStop(tab.file, null, `process clip evidence is incomplete at step ${index + 1}`);
    }
  });
  return matches;
}

function fullScoreProcessEvidence(tab) {
  const matches = [];
  for (const name of readdirSync(REPORTS)) {
    if (!name.startsWith(`ui-state-${tab.meta.scoreType}-${tab.meta.scoreNumber}`) || !name.endsWith('.json')) continue;
    const file = path.join(REPORTS, name);
    let data;
    try { data = readJson(file); } catch { continue; }
    if (Number(data.score) !== 100 || Number(data.scoreNumber) !== Number(tab.meta.scoreNumber)) continue;
    const state = (data.tabs || []).find((item) => Number(item.subIndex) === Number(tab.meta.subIndex));
    if (!state || !Array.isArray(state.selectedValues) || state.selectedValues.some((value) => !value)) continue;
    matches.push({
      file,
      values: state.selectedValues.map(String),
      sourceLocation: `/tabs/${state.subIndex}/selectedValues`,
    });
  }
  if (!matches.length) hardStop(tab.file, null, `${tab.meta.activity}/${tab.label} lacks a 100-point process UI-state`);
  const unique = new Set(matches.map((match) => JSON.stringify(match.values)));
  if (unique.size !== 1) hardStop(tab.file, null, `${tab.meta.activity}/${tab.label} has conflicting 100-point process UI-states`);
  return { ...matches[0], scoreType: tab.meta.scoreType, scoreNumber: Number(tab.meta.scoreNumber), subIndex: Number(tab.meta.subIndex) };
}

function verifiedCandidateEvidence(tab) {
  const matches = [];
  for (const name of readdirSync(REPORTS)) {
    if (!name.startsWith(`verify-candidate-${tab.meta.scoreType}-${tab.meta.scoreNumber}`) || !name.endsWith('.json')) continue;
    const file = path.join(REPORTS, name);
    let data;
    try { data = readJson(file); } catch { continue; }
    if (data.activityKey !== `${tab.meta.scoreType}:${tab.meta.scoreNumber}` || data.verified !== true || Number(data.finalScore) !== 100) continue;
    const submitted = (data.submittedTabs || []).find((item) => Number(item.subIndex) === Number(tab.meta.subIndex));
    if (!submitted || !Array.isArray(submitted.selected) || submitted.selected.some((item) => !item.value)) continue;
    matches.push({ file, data });
  }
  if (!matches.length) hardStop(tab.file, null, `${tab.meta.activity}/${tab.label} lacks verified 100-point candidate evidence`);
  const answers = new Set(matches.map(({ data }) => JSON.stringify(data.submittedTabs.find((item) => Number(item.subIndex) === Number(tab.meta.subIndex)).selected)));
  if (answers.size !== 1) hardStop(tab.file, null, `${tab.meta.activity}/${tab.label} has conflicting verified candidate evidence`);
  return matches[0];
}

function processGnqBlocks(tab) {
  const html = readText(tab.file);
  const evidence = fullScoreProcessEvidence(tab);
  const root = parse(html);
  const optionSets = JSON.parse(extractScriptValue(root, 'jsonstr_select', tab.file));
  if (!Array.isArray(optionSets) || optionSets.length !== 2 || evidence.values.length % 2 !== 0) {
    hardStop(tab.file, root, `${tab.meta.activity}/${tab.label} process option/answer shape is invalid`);
  }
  const selected = evidence.values.map((value, index) => {
    const options = optionSets[index % 2];
    const answerIndex = options.indexOf(value) + 1;
    if (answerIndex < 1) hardStop(tab.file, root, `${tab.meta.activity}/${tab.label} process answer is not in options at field ${index + 1}`);
    return { field: index + 1, answerIndex, value };
  });
  const media = processVideoEntries(tab).map((entry) => ({
    step: entry.step + 1,
    clip: copyCaptured(entry, 'media', '.mp4'),
  }));
  const simulation = convertProcessGnq({
    id: `experiment-${tab.meta.scoreNumber}-${tab.meta.subIndex}-process`,
    title: tab.label,
    html,
    verified: { finalScore: 100, verified: true, selected },
    source: repoPath(tab.file),
    media,
  });
  return { blocks: [...sanitizeActivityStatic(html, tab.file), simulation], evidence };
}

function flatProcessBlocks(tab) {
  const html = readText(tab.file);
  const candidate = verifiedCandidateEvidence(tab);
  const evidence = fullScoreActivityEvidence(tab.meta.scoreType, tab.meta.scoreNumber, tab.meta.subIndex);
  if (!evidence) hardStop(tab.file, null, `${tab.meta.activity}/${tab.label} lacks a 100-point process UI-state`);
  const candidateValues = candidate.data.submittedTabs
    .find((item) => Number(item.subIndex) === Number(tab.meta.subIndex))
    .selected.map((item) => String(item.value));
  if (JSON.stringify(candidateValues) !== JSON.stringify(evidence.values)) {
    hardStop(tab.file, null, `${tab.meta.activity}/${tab.label} candidate structure conflicts with the 100-point UI-state`);
  }
  const result = convertFlatProcess({
    activity: tab.meta,
    html,
    evidence: candidate.data,
    stepVideos: processVideoMap,
    sourceFile: tab.meta.rawHtmlFile,
    evidenceFile: path.basename(candidate.file),
    videoEvidenceFile: 'process-step-video-capture-v1.json',
    resolveClip: (entry) => copyCaptured(entry, 'media', '.mp4'),
  });
  return {
    blocks: result.blocks,
    evidence,
    id: result.id,
    sourceLedger: result.sourceLedger,
    audit: result.audit,
  };
}

function engineeringParamBlocks(tab) {
  const html = readText(tab.file);
  const evidence = fullScoreActivityEvidence(tab.meta.scoreType, tab.meta.scoreNumber, tab.meta.subIndex);
  if (!evidence) hardStop(tab.file, null, `${tab.meta.activity}/${tab.label} lacks a 100-point engineering UI-state`);
  const evidenceData = readJson(evidence.file);
  const result = convertEngineeringParams({
    activity: tab.meta,
    html,
    evidence: evidenceData,
    simulationCapture: engineeringSimulationMap,
    staticCapture: staticMap,
    sourceFile: tab.meta.rawHtmlFile,
    evidenceFile: path.basename(evidence.file),
    simulationEvidenceFile: 'engineering-simulation-capture-v1.json',
    staticEvidenceFile: 'resource-capture-static-v1.json',
    resolveImage: (entry) => copyEngineeringImage(entry),
  });
  return {
    blocks: result.blocks,
    evidence,
    id: result.id,
    sourceLedger: result.sourceLedger,
    audit: result.audit,
  };
}

function activityTabResult(tab) {
  const html = readText(tab.file);
  if (tab.meta.scoreType === 'engineering' && tab.meta.kind === 'select') return engineeringParamBlocks(tab);
  if (tab.meta.kind === 'process-gnq') return processGnqBlocks(tab);
  if (tab.meta.scoreType === 'experiment' && RUNTIME_TEMPERATURE_IDS.has(`drawing-${tab.meta.scoreNumber}-${tab.meta.subIndex}`)) {
    return runtimeTemperatureBlocks(tab);
  }
  if (tab.meta.kind === 'select' && processVideoEntries(tab).length > 0 && !/<canvas\b/i.test(html)) {
    return flatProcessBlocks(tab);
  }
  if (tab.meta.kind === 'select') {
    const evidence = fullScoreActivityEvidence(tab.meta.scoreType, tab.meta.scoreNumber, tab.meta.subIndex);
    if (!evidence) hardStop(tab.file, null, `${tab.meta.activity}/${tab.label} lacks a 100-point UI-state`);
    const drawingWithoutCanvas = tab.meta.scoreType === 'experiment'
      && tab.meta.scoreNumber === 22 && tab.meta.subIndex === 2;
    if (/<canvas\b/i.test(html) || drawingWithoutCanvas) {
      if (tab.meta.scoreNumber === 1 && tab.meta.subIndex === 1) {
        const golden = readJson(path.join(ROOT, 'courses', 'autosmt-previews', 'autosmt-oxidation-golden', 'content.json'));
        for (const point of Object.values(golden.knowledgePoints)) {
          for (const block of point.blocks || []) {
            if (block.type !== 'tabSet') continue;
            for (const goldenTab of block.tabs || []) {
              const sandbox = (goldenTab.blocks || []).find((candidate) => candidate.type === 'sandbox' && candidate.id === 'experiment-1-oxidation-temperature-curve');
              if (sandbox) {
                const dependency = sandbox.dependencies[0];
                const source = path.join(ROOT, 'courses', 'autosmt-previews', 'autosmt-oxidation-golden', dependency);
                const target = path.join(COURSE_DIR, dependency);
                mkdirSync(path.dirname(target), { recursive: true });
                copyFileSync(source, target);
                return { blocks: [sandbox], evidence };
              }
            }
          }
        }
        hardStop(tab.file, null, 'approved oxidation sandbox is missing');
      }
      const drawing = drawingBlocks(tab);
      return { blocks: drawing.blocks, sourceLedger: drawing.sourceLedger, evidence };
    }
    return { blocks: [...sanitizeActivityStatic(html, tab.file), parameterBlock(tab)], evidence };
  }
  const blocks = sanitizeActivityStatic(html, tab.file);
  if (!blocks.length) hardStop(tab.file, null, `activity tab cannot be represented losslessly: ${tab.meta.activity}/${tab.label}`);
  return { blocks, evidence: null };
}

const chapters = [];
const content = { overviews: {}, knowledgePoints: {} };
const quiz = { questionBank: {}, sectionQuizzes: {}, examQuestions: {} };
const mapEntries = [];
const ledgerEntries = [];
const activityAuthorityByTarget = new Map();

function addLedger(target, kind, sourceFile, sourceLocation, value, extra = {}) {
  ledgerEntries.push({
    target,
    kind,
    sourceFile: repoPath(sourceFile),
    sourceLocation,
    sourceSha256: sha256File(sourceFile),
    targetValueSha256: targetHash(value),
    checkSummary: '目标字段逐项映射到 2026 捕获证据，并校验源文件与目标值 SHA-256。',
    status: 'verified',
    ...extra,
  });
}

function resolveReportSource(sourceFile) {
  const candidates = [
    sourceFile,
    path.join(ROOT, sourceFile),
    path.join(REPORTS, sourceFile),
    path.join(ACTIVITIES, sourceFile),
    path.join(CAPTURE, sourceFile),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate) && path.extname(candidate));
  if (!resolved) throw new Error(`[HARD STOP] ledger source file is missing: ${sourceFile}`);
  return resolved;
}

function mapActivityLedgerTarget(kpId, tabIndex, result, rawTarget) {
  let relative = String(rawTarget || '');
  if (result.id && relative.startsWith(`${result.id}/`)) relative = relative.slice(result.id.length + 1);
  const parts = relative.split('/').filter(Boolean);
  let blockIndex;
  let rest;
  if (parts[0] === 'blocks') {
    blockIndex = Number(parts[1]);
    rest = parts.slice(2);
  } else if (parts[0] === 'steps' || parts[0] === 'groups') {
    blockIndex = (result.blocks || []).findIndex((block) => block.type === 'stepSimulation');
    rest = parts;
  } else {
    blockIndex = (result.blocks || []).findIndex((block) => block.type === parts[0]);
    rest = parts.slice(1);
  }
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= (result.blocks || []).length) {
    throw new Error(`[HARD STOP] activity ledger target cannot map: ${rawTarget}`);
  }
  const pointerParts = ['knowledgePoints', kpId, 'blocks', 0, 'tabs', tabIndex, 'blocks', blockIndex, ...rest];
  let value = content;
  for (const part of pointerParts) {
    if (value === null || value === undefined || !Object.hasOwn(value, part)) {
      throw new Error(`[HARD STOP] mapped activity ledger target does not resolve: ${rawTarget}`);
    }
    value = value[part];
  }
  return { target: `content.json#${pointer(pointerParts)}`, value };
}

function addActivitySourceLedger(kpId, tabIndex, result) {
  for (const entry of result.sourceLedger || []) {
    const { target, value } = mapActivityLedgerTarget(kpId, tabIndex, result, entry.target);
    if (ledgerEntries.some((existing) => existing.target === target)) {
      throw new Error(`[HARD STOP] duplicate activity ledger target: ${target}`);
    }
    const sourceFile = resolveReportSource(entry.sourceFile);
    const answerBearing = entry.kind === 'parameter-answer' || entry.kind === 'process-answer';
    const extra = answerBearing ? {
      answerAuthority: 'full-score-audit',
      authorityEvidence: authorityEvidence(result.evidence),
    } : {};
    if (entry.embeddedEvidence) extra.embeddedEvidence = entry.embeddedEvidence;
    addLedger(target, answerBearing ? 'interactive-answer' : entry.kind, sourceFile, entry.sourceLocation, value, extra);
  }
}

function addRuntimeResultLedger(kpId, tabIndex, result) {
  for (const [blockIndex, block] of (result.blocks || []).entries()) {
    const captured = pecvdResultMap[block.id];
    if (!captured) continue;
    const expected = captured.map((simulation) => ({
      label: simulation.label,
      paramRange: simulation.paramRange,
      images: simulation.images.map((image) => ({
        src: `assets/images/${image.target}`,
        alt: image.alt,
        caption: image.caption,
      })),
    }));
    if (JSON.stringify(block.simulations) !== JSON.stringify(expected)) {
      throw new Error(`[HARD STOP] runtime result content differs from capture evidence: ${block.id}`);
    }
    for (const [simulationIndex, simulation] of block.simulations.entries()) {
      const target = `content.json#/knowledgePoints/${kpId}/blocks/0/tabs/${tabIndex}/blocks/${blockIndex}/simulations/${simulationIndex}`;
      addLedger(
        target,
        'interactive-simulation-result',
        PECVD_RESULT_CAPTURE,
        `/simulations/${block.id}/${simulationIndex}`,
        simulation,
      );
    }
  }
}

function authorityEvidence(evidence) {
  return [{
    sourceFile: repoPath(evidence.file),
    sourceLocation: evidence.sourceLocation || `/tabs/${evidence.subIndex}/selectedValues`,
    sourceSha256: sha256File(evidence.file),
    scoreType: evidence.scoreType,
    scoreNumber: evidence.scoreNumber,
    observedScore: 100,
  }, finalFullScoreEvidence(evidence.scoreType, evidence.scoreNumber)];
}

if (courseKey === '--score-authority') {
  if (process.argv.length !== 5) throw new Error('Usage: --score-authority <scoreType> <scoreNumber>');
  process.stdout.write(`${JSON.stringify(finalFullScoreEvidence(process.argv[3], process.argv[4]))}\n`);
  process.exit(0);
}

if (courseKey === '--authority-evidence') {
  if (process.argv.length !== 7) throw new Error('Usage: --authority-evidence <scoreType> <scoreNumber> <uiStateFile> <subIndex>');
  const [scoreType, scoreNumber, uiStateName, subIndex] = process.argv.slice(3);
  if (path.basename(uiStateName) !== uiStateName) throw new Error('[HARD STOP] ui-state evidence filename must be a report basename');
  const file = path.join(REPORTS, uiStateName);
  const data = readJson(file);
  const actualType = data.scoreType === 'project' || data.scoreType === 'projects' ? 'engineering' : data.scoreType;
  const actualNumber = Number(data.scoreNumber);
  if (actualType !== finalScoreKey(scoreType) || actualNumber !== Number(scoreNumber) || Number(data.score) !== 100) {
    hardStop(file, null, `UI-state evidence does not match a 100-point ${scoreType} ${scoreNumber} record`);
  }
  const tab = (data.tabs || []).find((item) => Number(item.subIndex) === Number(subIndex));
  if (!tab || !Array.isArray(tab.selectedValues) || tab.selectedValues.some((value) => !value)) {
    hardStop(file, null, `UI-state evidence tab ${subIndex} lacks selected values`);
  }
  process.stdout.write(`${JSON.stringify(authorityEvidence({
    file,
    scoreType: actualType,
    scoreNumber: actualNumber,
    subIndex: Number(subIndex),
    sourceLocation: `/tabs/${tab.subIndex}/selectedValues`,
  }))}\n`);
  process.exit(0);
}

function pointer(parts) {
  return `/${parts.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;
}

function addRequired(required, file, parts, value, kind) {
  const target = `${file}#${pointer(parts)}`;
  if (!required.has(target)) required.set(target, { target, value, kind });
}

function collectMediaTargets(required, file, value, parts) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectMediaTargets(required, file, item, [...parts, index]));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childParts = [...parts, key];
    if (['src', 'poster', 'captions', 'clip'].includes(key) && typeof child === 'string') {
      addRequired(required, file, childParts, child, `content-resource:${key}`);
    }
    if (key === 'dependencies' && Array.isArray(child)) {
      child.forEach((dependency, index) => {
        if (typeof dependency === 'string') addRequired(required, file, [...childParts, index], dependency, 'content-resource:dependency');
      });
    }
    collectMediaTargets(required, file, child, childParts);
  }
}

function sandboxInputs(html) {
  const inputs = [];
  const pattern = /<(select|input|textarea)\b[^>]*>(?:[\s\S]*?<\/\1\s*>)?/gi;
  for (const match of String(html || '').matchAll(pattern)) inputs.push(match[0]);
  return inputs;
}

function collectStepTargets(required, file, steps, parts) {
  for (const [index, step] of (steps || []).entries()) {
    const stepParts = [...parts, index];
    for (const key of ['prompt', 'answerIndex']) {
      if (Object.hasOwn(step, key)) addRequired(required, file, [...stepParts, key], step[key], key === 'answerIndex' ? 'interactive-answer' : 'interactive-prompt');
    }
    (step.options || []).forEach((option, optionIndex) => addRequired(required, file, [...stepParts, 'options', optionIndex], option, 'interactive-option'));
  }
}

function collectContentBlocks(required, blocks, file, baseParts) {
  for (const [index, block] of (blocks || []).entries()) {
    const blockParts = [...baseParts, index];
    addRequired(required, file, blockParts, block, `content-block:${block.type}`);
    collectMediaTargets(required, file, block, blockParts);
    if (block.type === 'tabSet') {
      for (const [tabIndex, tab] of (block.tabs || []).entries()) {
        collectContentBlocks(required, tab.blocks, file, [...blockParts, 'tabs', tabIndex, 'blocks']);
      }
    }
    if (block.type === 'paramSelect') {
      (block.headers || []).forEach((header, headerIndex) => addRequired(required, file, [...blockParts, 'headers', headerIndex], header, 'interactive-header'));
      for (const [groupIndex, group] of (block.groups || []).entries()) {
        for (const [paramIndex, param] of (group.params || []).entries()) {
          const paramParts = [...blockParts, 'groups', groupIndex, 'params', paramIndex];
          for (const key of ['label', 'answerIndex']) {
            if (Object.hasOwn(param, key)) addRequired(required, file, [...paramParts, key], param[key], key === 'answerIndex' ? 'interactive-answer' : 'interactive-label');
          }
          (param.options || []).forEach((option, optionIndex) => addRequired(required, file, [...paramParts, 'options', optionIndex], option, 'interactive-option'));
        }
      }
      for (const [rowIndex, row] of (block.matrixRows || []).entries()) {
        for (const [cellIndex, cell] of (row.cells || []).entries()) {
          const cellParts = [...blockParts, 'matrixRows', rowIndex, 'cells', cellIndex];
          for (const [partIndex, part] of (cell.content || []).entries()) {
            const partParts = [...cellParts, 'content', partIndex];
            if (part.type === 'text') {
              addRequired(required, file, [...partParts, 'text'], part.text, 'interactive-fixed-cell');
              continue;
            }
            if (part.type !== 'control') continue;
            for (const key of ['label', 'answerIndex']) {
              if (Object.hasOwn(part, key)) addRequired(required, file, [...partParts, key], part[key], key === 'answerIndex' ? 'interactive-answer' : 'interactive-label');
            }
            (part.options || []).forEach((option, optionIndex) => addRequired(required, file, [...partParts, 'options', optionIndex], option, 'interactive-option'));
          }
        }
      }
      for (const [simulationIndex, simulation] of (block.simulations || []).entries()) {
        const simulationParts = [...blockParts, 'simulations', simulationIndex];
        addRequired(required, file, [...simulationParts, 'label'], simulation.label, 'interactive-simulation-label');
        (simulation.paramRange || []).forEach((value, rangeIndex) => addRequired(required, file, [...simulationParts, 'paramRange', rangeIndex], value, 'interactive-simulation-range'));
        for (const [imageIndex, image] of (simulation.images || []).entries()) {
          for (const key of ['src', 'alt', 'caption']) {
            if (Object.hasOwn(image, key)) addRequired(required, file, [...simulationParts, 'images', imageIndex, key], image[key], `interactive-simulation-image:${key}`);
          }
        }
      }
    }
    if (block.type === 'stepSimulation') {
      collectStepTargets(required, file, block.steps, [...blockParts, 'steps']);
      for (const [groupIndex, group] of (block.groups || []).entries()) {
        const groupParts = [...blockParts, 'groups', groupIndex];
        for (const key of ['prompt', 'answerIndex']) {
          if (Object.hasOwn(group, key)) addRequired(required, file, [...groupParts, key], group[key], key === 'answerIndex' ? 'interactive-answer' : 'interactive-prompt');
        }
        (group.options || []).forEach((option, optionIndex) => addRequired(required, file, [...groupParts, 'options', optionIndex], option, 'interactive-option'));
        collectStepTargets(required, file, group.steps, [...groupParts, 'steps']);
      }
    }
    if (block.type === 'sandbox' && typeof block.html === 'string') {
      sandboxInputs(block.html).forEach((input, inputIndex) => addRequired(required, file, [...blockParts, 'sandbox-input', inputIndex], input, 'interactive-input'));
    }
  }
}

function requiredLedgerTargets() {
  const required = new Map();
  for (const [sectionId, item] of Object.entries(content.overviews)) collectContentBlocks(required, item.blocks, 'content.json', ['overviews', sectionId, 'blocks']);
  for (const [pointId, item] of Object.entries(content.knowledgePoints)) collectContentBlocks(required, item.blocks, 'content.json', ['knowledgePoints', pointId, 'blocks']);
  for (const [questionId, question] of Object.entries(quiz.questionBank)) {
    const parts = ['questionBank', questionId];
    addRequired(required, 'quiz.json', parts, question, 'question');
    addRequired(required, 'quiz.json', [...parts, 'stem'], question.stem, 'question-stem');
    const choices = Array.isArray(question.options) ? ['options', question.options] : ['items', question.items];
    (choices[1] || []).forEach((choice, index) => addRequired(required, 'quiz.json', [...parts, choices[0], index], choice, 'question-option'));
    addRequired(required, 'quiz.json', [...parts, 'answer'], question.answer, 'question-answer');
  }
  return required;
}

function fillRequiredLedgerEntries() {
  const required = requiredLedgerTargets();
  const existing = new Map(ledgerEntries.map((entry) => [entry.target, entry]));
  for (const record of required.values()) {
    if (existing.has(record.target)) continue;
    const ancestor = [...existing.values()]
      .filter((entry) => record.target.startsWith(`${entry.target}/`))
      .sort((left, right) => right.target.length - left.target.length)[0];
    if (!ancestor) throw new Error(`[HARD STOP] source ledger has no ancestor for ${record.target}`);
    const extra = {};
    if (record.kind === 'interactive-answer') {
      const authority = [...activityAuthorityByTarget.entries()]
        .filter(([target]) => record.target.startsWith(`${target}/`))
        .sort((left, right) => right[0].length - left[0].length)[0]?.[1];
      if (!authority) throw new Error(`[HARD STOP] interactive answer lacks full-score authority: ${record.target}`);
      extra.answerAuthority = 'full-score-audit';
      extra.authorityEvidence = authorityEvidence(authority);
    }
    const sourceFile = path.join(ROOT, ancestor.sourceFile);
    addLedger(record.target, record.kind, sourceFile, `${ancestor.sourceLocation}; target=${record.target}`, record.value, extra);
    existing.set(record.target, ledgerEntries.at(-1));
  }
}

function comparisonSources(targets) {
  const prefixes = Array.isArray(targets) ? targets : [targets];
  return [...new Set(ledgerEntries
    .filter((entry) => prefixes.some((target) => entry.target === target || entry.target.startsWith(`${target}/`)))
    .map((entry) => entry.sourceFile))].sort();
}

function comparisonBlockRecords(records, kpId, cardTitle, blocks, baseTarget) {
  for (const [index, block] of (blocks || []).entries()) {
    const target = `${baseTarget}/${index}`;
    const common = {
      target,
      sourceFiles: comparisonSources(target),
      organizationGolden: 'dist-courses/ic-packaging.pigeon#/manifest.json/chapters',
      presentationGolden: 'courses/autosmt-previews/autosmt-oxidation-golden/content.json#/knowledgePoints',
    };
    if (block.type === 'paramsTable') {
      records.push({
        ...common,
        objectType: 'table',
        matched: ['native paramsTable', 'source header and row order', 'rich TableCell text/images/rowspan/colspan', 'responsive native renderer'],
        differences: cardTitle.includes('工程2')
          ? [{ reason: '91 个固定值行不是可作答控件；按源顺序置于同一 tab 的原生 paramsTable，答题行保留为随后 paramSelect。' }]
          : [],
      });
    } else if (block.type === 'tabSet') {
      records.push({
        ...common,
        objectType: 'tab-set',
        matched: ['single knowledge card', 'source tab labels and order', 'platform-native tabSet', 'tab state retained while switching'],
        differences: [],
      });
      for (const [tabIndex, tab] of (block.tabs || []).entries()) {
        comparisonBlockRecords(records, kpId, cardTitle, tab.blocks, `${target}/tabs/${tabIndex}/blocks`);
      }
    } else if (block.type === 'sandbox') {
      records.push({
        ...common,
        objectType: 'drawing-sandbox',
        matched: ['initial answer empty', 'platform answer-mode control', 'clear action', 'persistent exercise state', 'auto height', 'offline dependencies'],
        differences: [{ reason: '原站局部色值和尺寸不复制；Canvas 仅使用 PigeonLib 注入设计令牌与平台交互壳。' }],
      });
    } else if (block.type === 'paramSelect') {
      records.push({
        ...common,
        objectType: 'parameter-exercise',
        matched: ['complete source options', 'answerIndex from score=100 UI state', 'source table row/column structure', 'native correct/wrong feedback', 'persistent state', 'captured local result images'],
        differences: [],
      });
    } else if (block.type === 'stepSimulation') {
      records.push({
        ...common,
        objectType: 'process-simulation',
        matched: ['complete source options', 'answerIndex from score=100 evidence', 'source step/group order', 'captured local clips', 'native clear/answer behavior and persistence'],
        differences: [],
      });
    }
  }
}

function goldenComparisonRecords(chapters) {
  const records = [];
  for (const [chapterIndex, chapter] of chapters.entries()) {
    const kpIds = chapter.sections.flatMap((section) => section.knowledgePoints.map((point) => point.id));
    const kpTargets = kpIds.map((kpId) => `content.json#/knowledgePoints/${kpId}`);
    records.push({
      target: `manifest.json#/chapters/${chapterIndex}`,
      objectType: 'chapter',
      sourceFiles: comparisonSources(kpTargets),
      organizationGolden: 'dist-courses/ic-packaging.pigeon#/manifest.json/chapters',
      presentationGolden: 'PigeonLib native sidebar and chapter tabs',
      matched: ['第N章 title', 'chapter -> section -> knowledgePoint hierarchy', 'chapter exam references questionBank IDs', 'no standalone homework chapter'],
      differences: [],
    });
    for (const section of chapter.sections) {
      for (const point of section.knowledgePoints) {
        const card = content.knowledgePoints[point.id];
        const target = `content.json#/knowledgePoints/${point.id}`;
        const isActivity = (card.blocks || []).some((block) => block.type === 'tabSet' && block.id?.endsWith('-activity'));
        records.push({
          target,
          objectType: isActivity ? 'experiment-or-engineering-card' : 'knowledge-card',
          sourceFiles: comparisonSources(target),
          organizationGolden: 'dist-courses/ic-packaging.pigeon#/manifest.json/chapters',
          presentationGolden: isActivity
            ? 'courses/autosmt-previews/autosmt-oxidation-golden/content.json#/knowledgePoints/1-2-4'
            : 'courses/autosmt-previews/autosmt-oxidation-golden/content.json#/knowledgePoints/1-2-2',
          matched: isActivity
            ? ['one source activity per card', 'all source tabs retained', 'native blocks inside tabSet', 'related interaction state retained']
            : ['one source theory topic per card', 'native heading/paragraph/list/image/imageGroup/paramsTable blocks', 'source order retained', 'related sectionQuiz follows theory'],
          differences: point.title === '补充视频'
            ? [{ reason: '视频无法以标题和正文证据唯一关联到某一理论主题；按规范置于该节末尾的补充视频卡。' }]
            : [],
        });
        comparisonBlockRecords(records, point.id, point.title, card.blocks, `${target}/blocks`);
      }
    }
    const examTarget = `quiz.json#/examQuestions/${chapter.id}`;
    records.push({
      target: examTarget,
      objectType: 'chapter-question-group',
      sourceFiles: comparisonSources((quiz.examQuestions[chapter.id] || []).map((id) => `quiz.json#/questionBank/${id}`)),
      organizationGolden: 'dist-courses/ic-packaging.pigeon#/quiz.json/examQuestions',
      presentationGolden: 'PigeonLib native chapter exam',
      matched: ['questionBank IDs only', 'all chapter questions covered once', 'no duplicated question definitions'],
      differences: [],
    });
  }
  for (const [kpId, questionIds] of Object.entries(quiz.sectionQuizzes)) {
    const overrides = mapEntries.filter((entry) => questionIds.includes(entry.questionId) && entry.mappingOverride);
    records.push({
      target: `quiz.json#/sectionQuizzes/${kpId}`,
      objectType: 'related-question-group',
      sourceFiles: comparisonSources(questionIds.map((id) => `quiz.json#/questionBank/${id}`)),
      organizationGolden: 'dist-courses/ic-packaging.pigeon#/quiz.json/sectionQuizzes',
      presentationGolden: 'courses/autosmt-previews/autosmt-oxidation-golden/quiz.json#/sectionQuizzes',
      matched: ['questionBank IDs only', 'semantic mapping to preceding theory card', 'full options and score=100 answers', 'no repeated definition'],
      differences: overrides.map((entry) => ({
        questionId: entry.questionId,
        reason: entry.mappingOverride.kind === 'section-synthesis'
          ? '题目同时覆盖同一小节的多张理论卡；作为小节综合题放在相关理论全部出现后的末张卡，并显式记录人工编排决定。'
          : ['manual-anchor', 'manual-section-placement'].includes(entry.mappingOverride.kind)
            ? `题干与满分项逐字核对且目标卡存在；理论直接证据不足或自动候选同分，按用户决定人工编排，并保留证据缺口：${entry.mappingOverride.evidenceGap}`
            : '自动语义评分存在多主题/同分候选；题干、满分项和理论正文短语全部逐字命中后使用显式归属。',
      })),
    });
  }
  return records;
}

let questionSerial = 0;
for (const chapterIndex of config.chapterIndexes) {
  const chapterId = String(chapterIndex + 1);
  const sectionsForChapter = activityIndex.filter((section) => section.chapterIndex === chapterIndex).sort((left, right) => left.sectionIndex - right.sectionIndex);
  const chapterTitle = chapterIndex === 0 ? '第1章 IC制造工艺'
    : chapterIndex === 1 ? '第2章 IC器件制造工艺'
      : chapterIndex === 2 ? '第3章 IC器件工厂'
        : chapterIndex === 3 ? '第4章 IC封装制程'
          : chapterIndex === 4 ? '第5章 IC封装工艺'
            : '第6章 IC封装工厂';
  const chapter = { id: chapterId, title: chapterTitle, tabLabel: `第${chapterId}章`, sections: [] };
  quiz.examQuestions[chapterId] = [];
  for (const sectionMeta of sectionsForChapter) {
    const sectionKey = `${chapterIndex}-${sectionMeta.sectionIndex}`;
    const sectionId = `${chapterId}.${sectionMeta.sectionIndex + 1}`;
    const menuFile = path.join(SECTIONS, sectionKey, 'menu.html');
    const menuText = normalizeText(parse(readText(menuFile)).querySelector('h2')?.textContent || '');
    const titleMatch = menuText.match(/第\d+\.\d+节\s*[^概述]+/);
    if (!titleMatch) hardStop(menuFile, null, 'section title missing from menu');
    const sectionTitle = titleMatch[0].trim();
    const section = { id: sectionId, title: sectionTitle, knowledgePoints: [] };
    const convertedOverview = overview(sectionKey);
    content.overviews[sectionId] = { title: sectionTitle, blocks: convertedOverview.blocks };
    convertedOverview.blocks.forEach((block, index) => addLedger(`content.json#/overviews/${sectionId}/blocks/${index}`, `content-block:${block.type}`, convertedOverview.file, `section=${sectionKey}; overview; block=${index}`, block));

    const topics = theoryTopics(sectionKey);
    const topicIds = [];
    for (const [topicIndex, topic] of topics.entries()) {
      const kpId = `${chapterId}-${sectionMeta.sectionIndex + 1}-${section.knowledgePoints.length + 1}`;
      const blocks = [...topic.blocks];
      const matchingVideos = lectureVideos(sectionKey).filter((video) => video.title.includes(topic.topic) || topic.topic.includes(video.title.replace(/^讲课视频[-:：]?/, '')));
      if (matchingVideos.length) {
        blocks.splice(0, blocks.length, {
          type: 'tabSet', id: `${kpId}-content`, tabs: [
            { id: 'theory', label: '知识正文', blocks: topic.blocks },
            { id: 'video', label: '讲解视频', blocks: matchingVideos.map((video) => video.block) },
          ],
        });
      }
      section.knowledgePoints.push({ id: kpId, title: topic.topic });
      content.knowledgePoints[kpId] = { title: topic.topic, blocks };
      blocks.forEach((block, index) => addLedger(`content.json#/knowledgePoints/${kpId}/blocks/${index}`, `content-block:${block.type}`, topic.file, `section=${sectionKey}; theory=${topic.topic}; block=${index}`, block));
      if (matchingVideos.length) {
        addLedger(`content.json#/knowledgePoints/${kpId}/blocks/0/tabs/0`, 'content-tab:theory', topic.file, `section=${sectionKey}; theory=${topic.topic}; tab=theory`, blocks[0].tabs[0]);
        addLedger(`content.json#/knowledgePoints/${kpId}/blocks/0/tabs/1`, 'content-tab:video', matchingVideos[0].sourceFile, `section=${sectionKey}; theory=${topic.topic}; tab=video`, blocks[0].tabs[1]);
      }
      topicIds.push(kpId);
    }

    const unmatchedVideos = lectureVideos(sectionKey).filter((video) => !topics.some((topic) => video.title.includes(topic.topic) || topic.topic.includes(video.title.replace(/^讲课视频[-:：]?/, ''))));
    if (unmatchedVideos.length) {
      const kpId = `${chapterId}-${sectionMeta.sectionIndex + 1}-${section.knowledgePoints.length + 1}`;
      section.knowledgePoints.push({ id: kpId, title: '补充视频' });
      const blocks = unmatchedVideos.map((video) => video.block);
      content.knowledgePoints[kpId] = { title: '补充视频', blocks };
      blocks.forEach((block, index) => addLedger(`content.json#/knowledgePoints/${kpId}/blocks/${index}`, 'content-block:video', unmatchedVideos[index].sourceFile, `section=${sectionKey}; unmatched lecture video=${index}`, block));
    }

    for (const card of activityCards(sectionKey)) {
      const kpId = `${chapterId}-${sectionMeta.sectionIndex + 1}-${section.knowledgePoints.length + 1}`;
      const convertedTabs = card.tabs.map((tab) => activityTabResult(tab));
      const tabs = card.tabs.map((tab, tabIndex) => ({ id: `tab-${tabIndex + 1}`, label: tab.label, blocks: convertedTabs[tabIndex].blocks }));
      const block = { type: 'tabSet', id: `${kpId}-activity`, tabs };
      section.knowledgePoints.push({ id: kpId, title: card.title });
      content.knowledgePoints[kpId] = { title: card.title, blocks: [block] };
      addLedger(`content.json#/knowledgePoints/${kpId}/blocks/0`, 'content-block:tabSet', card.tabs[0].file, `section=${sectionKey}; activity=${card.title}`, block);
      card.tabs.forEach((tab, tabIndex) => {
        const tabTarget = `content.json#/knowledgePoints/${kpId}/blocks/0/tabs/${tabIndex}`;
        const result = convertedTabs[tabIndex];
        const evidence = result.evidence;
        if (['select', 'process-gnq'].includes(tab.meta.kind) && !evidence) hardStop(tab.file, null, `${tab.meta.activity}/${tab.label} lacks full-score evidence`);
        if (evidence) activityAuthorityByTarget.set(tabTarget, evidence);
        addLedger(tabTarget, 'content-block:activity-tab', tab.file, `section=${sectionKey}; activity=${card.title}; tab=${tab.label}`, tabs[tabIndex], evidence ? {
          answerAuthority: 'full-score-audit',
          authorityEvidence: authorityEvidence(evidence),
        } : {});
        addActivitySourceLedger(kpId, tabIndex, result);
        addRuntimeResultLedger(kpId, tabIndex, result);
      });
    }

    const homeworkNumber = Object.values(config.homeworkByChapter).flat().length ? Object.values(config.homeworkByChapter) : null;
    const chapterRange = config.homeworkByChapter[chapterId];
    const sectionOffset = sectionsForChapter.findIndex((candidate) => candidate.sectionIndex === sectionMeta.sectionIndex);
    const homeworkId = chapterRange ? chapterRange[0] + sectionOffset : null;
    if (homeworkId == null || homeworkId > chapterRange[1]) throw new Error(`[HARD STOP] homework mapping missing for section ${sectionKey}`);
    const questions = parseHomework(sectionKey, homeworkId);
    for (const sourceQuestion of questions) {
      const questionId = `${chapterId}-${String(++questionSerial).padStart(3, '0')}`;
      const correctOption = sourceQuestion.question.options.find((option) => option.startsWith(`${sourceQuestion.question.answer}. `));
      if (!correctOption) hardStop(sourceQuestion.sourceFile, null, `question ${sourceQuestion.sourceId} correct option is missing`);
      const stemWords = semanticKeywords(normalizeText(sourceQuestion.question.stem));
      const answerWords = semanticKeywords(normalizeText(correctOption));
      const candidates = topicIds.map((kpId) => {
        const topic = topics[topicIds.indexOf(kpId)];
        const topicText = topic?.sourceText || JSON.stringify(content.knowledgePoints[kpId]);
        const stemBodyHits = stemWords.filter((word) => topicText.toLowerCase().includes(word.toLowerCase()));
        const stemTitleHits = stemWords.filter((word) => topic.topic.toLowerCase().includes(word.toLowerCase()));
        const answerBodyHits = answerWords.filter((word) => topicText.toLowerCase().includes(word.toLowerCase()));
        const answerTitleHits = answerWords.filter((word) => topic.topic.toLowerCase().includes(word.toLowerCase()));
        const stemBodyScore = stemBodyHits.reduce((score, word) => score + word.length, 0) * 4;
        const stemTitleScore = stemTitleHits.reduce((score, word) => score + word.length, 0) * 16;
        const answerBodyScore = answerBodyHits.reduce((score, word) => score + word.length, 0);
        const answerTitleScore = answerTitleHits.reduce((score, word) => score + word.length, 0) * 4;
        const bodyScore = stemBodyScore + answerBodyScore;
        const titleScore = stemTitleScore + answerTitleScore;
        return {
          kpId,
          topic: topic.topic,
          score: bodyScore + titleScore,
          bodyScore,
          titleScore,
          bodyHits: [...new Set([...stemBodyHits, ...answerBodyHits])],
          titleHits: [...new Set([...stemTitleHits, ...answerTitleHits])],
          stemBodyHits,
          stemTitleHits,
          answerBodyHits,
          answerTitleHits,
        };
      }).sort((left, right) => right.score - left.score);
      const override = QUESTION_MAPPING_OVERRIDES[sourceQuestion.sourceId];
      let selected = candidates[0];
      let overrideEvidence = null;
      let overrideTheoryEvidence = null;
      if (override) {
        const manualPlacement = ['manual-anchor', 'manual-section-placement'].includes(override.kind);
        selected = candidates.find((candidate) => candidate.topic === override.topic);
        if (!selected) hardStop(sourceQuestion.sourceFile, null, `question ${sourceQuestion.sourceId} override topic is not in the same section: ${override.topic}`);
        const missingStem = override.stemPhrases.filter((phrase) => !sourceQuestion.question.stem.includes(phrase));
        const missingAnswer = override.answerPhrases.filter((phrase) => !correctOption.includes(phrase));
        const topic = topics[topicIds.indexOf(selected.kpId)];
        const relatedTopics = override.kind === 'section-synthesis'
          ? override.relatedTopics.map((topicName) => topics.find((candidate) => candidate.topic === topicName))
          : [topic];
        const missingRelatedTopics = relatedTopics
          .map((relatedTopic, index) => (relatedTopic ? null : override.relatedTopics[index]))
          .filter(Boolean);
        const theoryPhrases = override.kind === 'section-synthesis'
          ? Object.entries(override.theoryPhrasesByTopic).flatMap(([topicName, phrases]) => {
            const relatedTopic = topics.find((candidate) => candidate.topic === topicName);
            return phrases.map((phrase) => ({ topicName, phrase, found: Boolean(relatedTopic?.sourceText.includes(phrase)) }));
          })
          : manualPlacement
            ? []
            : override.theoryPhrases.map((phrase) => ({ topicName: override.topic, phrase, found: topic.sourceText.includes(phrase) }));
        const missingTheory = theoryPhrases.filter((item) => !item.found).map(({ topicName, phrase }) => `${topicName}:${phrase}`);
        const invalidPlacement = override.kind === 'section-synthesis'
          && (override.relatedTopics.at(-1) !== override.topic || topics.at(-1)?.topic !== override.topic);
        if (missingStem.length || missingAnswer.length || missingRelatedTopics.length || missingTheory.length || invalidPlacement) {
          hardStop(sourceQuestion.sourceFile, null, `question ${sourceQuestion.sourceId} mapping override evidence is incomplete: ${JSON.stringify({ missingStem, missingAnswer, missingRelatedTopics, missingTheory, invalidPlacement })}`);
        }
        overrideTheoryEvidence = theoryPhrases.map(({ topicName, phrase }) => `${topicName}:${phrase}`);
        overrideEvidence = override.kind === 'section-synthesis'
          ? {
            kind: override.kind,
            targetTopic: override.topic,
            relatedTopics: override.relatedTopics,
            placement: override.placement,
            manualUserDecision: override.manualUserDecision,
          }
          : manualPlacement
            ? {
              kind: override.kind,
              targetTopic: override.topic,
              stemPhrases: override.stemPhrases,
              answerPhrases: override.answerPhrases,
              evidenceGap: override.evidenceGap,
              manualUserDecision: override.manualUserDecision,
            }
          : {
            topic: override.topic,
            stemPhrases: override.stemPhrases,
            answerPhrases: override.answerPhrases,
            theoryPhrases: override.theoryPhrases,
          };
      }
      if (!selected || selected.score === 0) hardStop(sourceQuestion.sourceFile, null, `question ${sourceQuestion.sourceId} has no direct theory evidence`);
      if (!override && candidates[1] && candidates[1].score === selected.score && selected.score > 0) {
        hardStop(sourceQuestion.sourceFile, null, `question ${sourceQuestion.sourceId} has ambiguous theory evidence (${selected.kpId}, ${candidates[1].kpId})`);
      }
      quiz.questionBank[questionId] = sourceQuestion.question;
      (quiz.sectionQuizzes[selected.kpId] ||= []).push(questionId);
      quiz.examQuestions[chapterId].push(questionId);
      const theorySource = topics[topicIds.indexOf(selected.kpId)].file;
      mapEntries.push({
        questionId,
        sourceHomework: homeworkId,
        sourceQuestionId: sourceQuestion.sourceId,
        sourceFile: repoPath(sourceQuestion.sourceFile),
        targetKnowledgePoint: selected.kpId,
        bodyKeywords: selected.bodyHits,
        titleKeywords: selected.titleHits,
        stemBodyKeywords: selected.stemBodyHits,
        stemTitleKeywords: selected.stemTitleHits,
        correctOptionBodyKeywords: selected.answerBodyHits,
        correctOptionTitleKeywords: selected.answerTitleHits,
        mappingScore: selected.score,
        runnerUpScore: candidates.filter((candidate) => candidate.kpId !== selected.kpId)[0]?.score || 0,
        correctOptionEvidence: correctOption,
        answerAssociation: sourceQuestion.question.answer,
        theorySourceFile: repoPath(theorySource),
        theoryEvidence: overrideTheoryEvidence || [...selected.titleHits, ...selected.bodyHits],
        ...(overrideEvidence ? { mappingOverride: overrideEvidence } : {}),
        matchReason: overrideEvidence?.kind === 'section-synthesis'
          ? '本题同时覆盖同一小节的组合逻辑与时序逻辑知识，作为小节综合题放在两张相关理论卡之后；目标为该小节末张理论卡，且人工编排决定已显式记录。'
          : ['manual-anchor', 'manual-section-placement'].includes(overrideEvidence?.kind)
            ? '题干与满分正确项已逐字核对，目标理论卡存在；因理论正文不能直接证明正确答案或自动语义出现同分，按用户批准的人工编排记录归属，证据缺口已显式保留。'
          : overrideEvidence
            ? '题目存在多主题或同分候选；显式归属仅在题干短语、满分正确项短语和目标理论正文短语全部逐字命中时放行。'
          : '题干关键词在目标理论卡标题及正文中作为主要归属证据，满分正确选项仅作辅助证据；标题命中用于区分同节知识类别，且候选限于同一小节理论主题。',
      });
      addLedger(`quiz.json#/questionBank/${questionId}`, 'question', sourceQuestion.sourceFile, `section=${sectionKey}; homework=${homeworkId}; question=${sourceQuestion.sourceId}`, sourceQuestion.question);
      for (const [optionIndex, option] of sourceQuestion.question.options.entries()) addLedger(`quiz.json#/questionBank/${questionId}/options/${optionIndex}`, 'question-option', sourceQuestion.sourceFile, `homework=${homeworkId}; question=${sourceQuestion.sourceId}; option=${optionIndex}`, option);
      addLedger(`quiz.json#/questionBank/${questionId}/answer`, 'question-answer', sourceQuestion.answerSource, `homework=${homeworkId}; answerIndex=${sourceQuestion.answerIndex}`, sourceQuestion.question.answer, {
        answerAuthority: 'full-score-audit',
        authorityEvidence: [sourceQuestion.finalScoreEvidence],
      });
    }
    for (const kpId of section.knowledgePoints.map((point) => point.id)) {
      if (!quiz.sectionQuizzes[kpId]) continue;
      const block = { type: 'sectionQuiz', quizRef: kpId };
      const blockIndex = content.knowledgePoints[kpId].blocks.push(block) - 1;
      addLedger(`content.json#/knowledgePoints/${kpId}/blocks/${blockIndex}`, 'content-block:sectionQuiz', menuFile, `section=${sectionKey}; related quiz=${kpId}`, block);
    }
    chapter.sections.push(section);
  }
  chapters.push(chapter);
}

if (Object.keys(quiz.questionBank).length !== config.expectedQuestions) throw new Error(`[HARD STOP] question count ${Object.keys(quiz.questionBank).length}, expected ${config.expectedQuestions}`);
fillRequiredLedgerEntries();
const manifest = {
  schemaVersion: 1,
  id: config.id,
  title: config.title,
  subtitle: config.subtitle,
  description: config.description,
  author: 'AutoSMT 2026 / PigeonLib',
  version: '2026.1.0',
  coverText: config.coverText,
  stats: { chapters: chapters.length, knowledgePoints: Object.keys(content.knowledgePoints).length, questions: Object.keys(quiz.questionBank).length },
  chapters,
};
const sourceLedger = {
  schemaVersion: 1,
  courseId: config.id,
  answerAuthority: 'full-score-audit',
  stats: { entries: ledgerEntries.length, contentBlocks: ledgerEntries.filter((entry) => entry.kind.startsWith('content-block:')).length, questions: Object.keys(quiz.questionBank).length },
  entries: ledgerEntries,
};
const questionMap = { schemaVersion: 1, courseId: config.id, entries: mapEntries };
const comparisonRecords = goldenComparisonRecords(chapters);

mkdirSync(COURSE_DIR, { recursive: true });
for (const [name, value] of Object.entries({ manifest, content, quiz, glossary: [], 'source-ledger': sourceLedger, 'question-knowledge-map': questionMap })) {
  writeFileSync(path.join(COURSE_DIR, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
const report = {
  schemaVersion: 1,
  courseId: config.id,
  generatedAt: new Date().toISOString(),
  status: 'generated-pending-gates',
  sourceSections: config.chapterIndexes.flatMap((chapterIndex) => activityIndex.filter((section) => section.chapterIndex === chapterIndex).map((section) => `${chapterIndex}-${section.sectionIndex}`)),
  counts: manifest.stats,
  comparison: {
    organizationGolden: 'dist-courses/ic-packaging.pigeon: 第N章 -> 小节 -> 独立理论/活动知识卡 -> 相关小测 -> 章节测试',
    interactionGolden: 'autosmt-oxidation-golden: 原生理论块、tabSet、绘图答案/清空/状态契约',
    records: comparisonRecords,
    stats: {
      total: comparisonRecords.length,
      chapters: comparisonRecords.filter((entry) => entry.objectType === 'chapter').length,
      knowledgeCards: comparisonRecords.filter((entry) => ['knowledge-card', 'experiment-or-engineering-card'].includes(entry.objectType)).length,
      tables: comparisonRecords.filter((entry) => entry.objectType === 'table').length,
      experiments: comparisonRecords.filter((entry) => ['experiment-or-engineering-card', 'drawing-sandbox', 'parameter-exercise', 'process-simulation'].includes(entry.objectType)).length,
      questionGroups: comparisonRecords.filter((entry) => entry.objectType.endsWith('question-group')).length,
      recordedDifferences: comparisonRecords.reduce((count, entry) => count + entry.differences.length, 0),
    },
  },
  unresolved: [],
};
writeFileSync(path.join(REPORTS, `rebuild-${courseKey}-report.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ courseId: config.id, ...manifest.stats, ledgerEntries: ledgerEntries.length }));
