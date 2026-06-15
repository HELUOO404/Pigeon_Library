import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('../app/node_modules/node-html-parser');

const ROOT = process.cwd();
const SOURCE_HTML = path.join(ROOT, '参考项目', 'index.html');
const COURSE_ID = 'ic-packaging';
const COURSE_DIR = path.join(ROOT, 'courses', COURSE_ID);
const IMAGE_DIR = path.join(COURSE_DIR, 'assets', 'images');
const OUT_FILES = {
  manifest: path.join(COURSE_DIR, 'manifest.json'),
  content: path.join(COURSE_DIR, 'content.json'),
  quiz: path.join(COURSE_DIR, 'quiz.json'),
  glossary: path.join(COURSE_DIR, 'glossary.json'),
};

const html = readFileSync(SOURCE_HTML, 'utf8');
const root = parse(html, { comment: false });
const blockCounts = {};
const referencedImages = new Set();
const sourceWarnings = [];

function fail(message, node = null) {
  if (!node) throw new Error(message);
  const source = node.toString().trim();
  const needle = source.slice(0, Math.min(source.length, 160));
  const index = html.indexOf(needle);
  const line = index >= 0 ? html.slice(0, index).split(/\r?\n/).length : 'unknown';
  const context = source.replace(/\s+/g, ' ').slice(0, 220);
  throw new Error(`${message}\nline: ${line}\ncontext: ${context}`);
}

function hasClass(node, className) {
  return (node.getAttribute?.('class') || '').split(/\s+/).includes(className);
}

function textOf(node) {
  return (node?.text || '').trim();
}

function cleanImageSrc(src) {
  return src.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function recordBlock(block) {
  blockCounts[block.type] = (blockCounts[block.type] || 0) + 1;
  if (block.type === 'image') referencedImages.add(block.src);
  return block;
}

function parseInlineSpans(node) {
  const spans = [];
  for (const child of node.childNodes) {
    if (!child.rawTagName) {
      const t = (child.text || '').trim();
      if (t) spans.push({ t });
      continue;
    }

    const tag = child.rawTagName.toLowerCase();
    if (tag === 'strong' && !hasClass(child, 'num-title')) {
      const t = textOf(child);
      if (t) spans.push({ t, b: true });
      continue;
    }
    if (tag === 'span' && hasClass(child, 'sub-title')) {
      const t = textOf(child);
      if (t) spans.push({ t, sub: true });
      continue;
    }
    fail(`Unsupported inline tag in text span: <${tag}>`, child);
  }
  return spans;
}

function parseParagraph(node) {
  const children = node.childNodes.filter((child) => child.rawTagName || textOf(child));
  if (
    children.length === 1 &&
    children[0].rawTagName?.toLowerCase() === 'strong' &&
    hasClass(children[0], 'num-title')
  ) {
    return recordBlock({ type: 'numTitle', text: textOf(children[0]) });
  }
  if (
    children.length === 1 &&
    children[0].rawTagName?.toLowerCase() === 'strong' &&
    !hasClass(children[0], 'num-title')
  ) {
    return recordBlock({ type: 'boldCaption', text: textOf(children[0]) });
  }
  return recordBlock({ type: 'paragraph', spans: parseInlineSpans(node) });
}

function parseParamsTable(node) {
  const embeddedImages = node.querySelectorAll('img');
  if (embeddedImages.length > 0) {
    for (const img of embeddedImages) {
      const src = cleanImageSrc(img.getAttribute('src') || '');
      if (src) referencedImages.add(src);
    }
    sourceWarnings.push(`table with ${embeddedImages.length} embedded images preserved as html`);
    return recordBlock({
      type: 'html',
      html: node.toString().replace(/src="\.\//g, 'src="'),
    });
  }
  const headers = node.querySelectorAll('thead th').map(textOf);
  const rows = node.querySelectorAll('tbody tr').map((tr) => tr.querySelectorAll('td').map(textOf));
  if (headers.length === 0 || rows.length === 0) fail('paramsTable must have headers and rows', node);
  return recordBlock({ type: 'paramsTable', headers, rows });
}

function parseSummaryBox(node) {
  const title = textOf(node.querySelector('h4'));
  const items = node.querySelectorAll('li').map(parseInlineSpans);
  if (!title || items.length === 0) fail('summaryBox must have title and items', node);
  return recordBlock({ type: 'summaryBox', title, items });
}

function parseCompareBox(node) {
  const title = textOf(node.querySelector('h4'));
  const headers = node.querySelectorAll('thead th').map(textOf);
  const rows = node.querySelectorAll('tbody tr').map((tr) => {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 2) fail('compareBox row must have label and cells', tr);
    return {
      label: textOf(cells[0]),
      cells: cells.slice(1).map(textOf),
    };
  });
  if (!title || headers.length < 2 || rows.length === 0) fail('compareBox must have title, headers and rows', node);
  return recordBlock({ type: 'compareBox', title, headers, rows });
}

function parseImage(node) {
  const src = cleanImageSrc(node.getAttribute('src') || '');
  if (!src) fail('image block missing src', node);
  return recordBlock({
    type: 'image',
    src,
    ...(node.getAttribute('alt') ? { alt: node.getAttribute('alt') } : {}),
  });
}

function parseBlock(node, ownerId, options = {}) {
  const tag = node.rawTagName?.toLowerCase();
  if (!tag) {
    const t = textOf(node);
    if (t) {
      const preview = t.length > 36 ? `${t.slice(0, 36)}...` : t;
      sourceWarnings.push(`${ownerId || 'overview'}: direct text node normalized to paragraph "${preview}"`);
      return recordBlock({ type: 'paragraph', spans: [{ t }] });
    }
    return null;
  }
  if (options.skipHeading && tag === 'h2') return null;
  if (tag === 'p') return parseParagraph(node);
  if (tag === 'img') return parseImage(node);
  if (tag === 'strong' && hasClass(node, 'num-title')) {
    return recordBlock({ type: 'numTitle', text: textOf(node) });
  }
  if (tag === 'h4') return recordBlock({ type: 'heading', text: textOf(node) });
  if (tag === 'table' && hasClass(node, 'params-table')) return parseParamsTable(node);
  if (tag === 'div' && hasClass(node, 'summary-box')) return parseSummaryBox(node);
  if (tag === 'div' && hasClass(node, 'compare-box')) return parseCompareBox(node);
  if (tag === 'div' && hasClass(node, 'section-quiz')) {
    if (!ownerId) fail('sectionQuiz block requires a knowledge point owner', node);
    return recordBlock({ type: 'sectionQuiz', quizRef: ownerId });
  }
  if (tag === 'button' && hasClass(node, 'mastery-btn')) return null;
  fail(`Unsupported content block: <${tag}>`, node);
}

function parseBlocks(container, ownerId, options = {}) {
  const blocks = [];
  for (const child of container.childNodes) {
    const block = parseBlock(child, ownerId, options);
    if (block) blocks.push(block);
  }
  return blocks;
}

function parseManifest() {
  const chapters = root.querySelectorAll('.tree-section').map((chapterNode) => {
    const id = chapterNode.getAttribute('data-ch');
    const title = textOf(chapterNode.querySelector('.tree-title')).replace(/^▼/, '');
    const sections = chapterNode.querySelectorAll('.tree-items').map((sectionNode) => {
      const sectionItem = sectionNode.querySelector('.tree-item');
      const statusId = sectionItem.querySelector('.status-dot')?.getAttribute('id') || '';
      const sectionId = statusId.replace(/^status-/, '').replace('-', '.');
      const knowledgePoints = sectionNode.querySelectorAll('.tree-item').slice(1).map((item) => {
        const dotId = item.querySelector('.status-dot')?.getAttribute('id') || '';
        const kpId = dotId.replace(/^dot-/, '');
        return { id: kpId, title: textOf(item) };
      });
      if (!sectionId || knowledgePoints.length === 0) fail('Invalid section tree item', sectionNode);
      return { id: sectionId, title: textOf(sectionItem), knowledgePoints };
    });
    return { id, title, tabLabel: `第${id}章`, sections };
  });

  const knowledgePointCount = chapters.flatMap((c) => c.sections.flatMap((s) => s.knowledgePoints)).length;
  return {
    schemaVersion: 1,
    id: COURSE_ID,
    title: 'IC封装技术',
    subtitle: '集创赛备考 · 微电子封装工艺',
    author: 'PigeonLib',
    version: '1.0',
    stats: {
      chapters: chapters.length,
      knowledgePoints: knowledgePointCount,
      questions: 0,
    },
    chapters,
  };
}

function parseContent() {
  const overviews = {};
  for (const overview of root.querySelectorAll('.chapter-content .overview-card')) {
    const id = overview.id.replace(/^overview-/, '').replace('-', '.');
    overviews[id] = {
      title: textOf(overview.querySelector('h2')),
      blocks: parseBlocks(overview, null, { skipHeading: true }),
    };
  }

  const knowledgePoints = {};
  for (const card of root.querySelectorAll('.knowledge-card')) {
    const id = card.id.replace(/^kp-/, '');
    const body = card.querySelector('.card-body');
    if (!body) fail(`Knowledge point ${id} missing .card-body`, card);
    knowledgePoints[id] = {
      title: textOf(card.querySelector('.card-title')),
      blocks: parseBlocks(body, id),
    };
  }
  return { overviews, knowledgePoints };
}

function extractLiteral(source, name) {
  const marker = `var ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing JS data variable: ${name}`);
  const eq = source.indexOf('=', start);
  let i = eq + 1;
  while (/\s/.test(source[i])) i++;
  const open = source[i];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) throw new Error(`Unexpected JS literal start for ${name}: ${open}`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return source.slice(eq + 1, i + 1);
    }
  }
  throw new Error(`Unclosed JS literal: ${name}`);
}

function readJsData() {
  const source = root.querySelectorAll('script').map((script) => script.text).join('\n');
  const read = (name) => new Function(`return (${extractLiteral(source, name)});`)();
  return {
    QUIZ_DATA: read('QUIZ_DATA'),
    ALL_QUESTIONS: read('ALL_QUESTIONS'),
    GLOSSARY: read('GLOSSARY'),
  };
}

function stripQuizNumber(question) {
  return question.replace(/^\d+\.\s*/, '');
}

function parseSectionQuizzes(quizData) {
  const sectionQuizzes = {};
  for (const card of root.querySelectorAll('.knowledge-card')) {
    const kpId = card.id.replace(/^kp-/, '');
    const quizItems = card.querySelectorAll('.section-quiz .quiz-item');
    if (quizItems.length === 0) continue;
    sectionQuizzes[kpId] = quizItems.map((item) => {
      const qid = item.querySelector('[data-qid]')?.getAttribute('data-qid');
      if (!qid) fail(`Quiz item in ${kpId} missing data-qid`, item);
      const answer = quizData[qid];
      if (!answer) fail(`QUIZ_DATA missing answer for ${qid}`, item);
      return {
        qid,
        q: stripQuizNumber(textOf(item.querySelector('.quiz-q'))),
        options: item.querySelectorAll('.quiz-opt span').map(textOf),
        ans: answer.ans,
        exp: answer.exp || '',
      };
    });
  }
  return sectionQuizzes;
}

function countAssetImages() {
  let count = 0;
  const stack = [IMAGE_DIR];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else count++;
    }
  }
  return count;
}

function validate(manifest, content, quiz, glossary) {
  const sections = manifest.chapters.flatMap((chapter) => chapter.sections);
  const manifestKps = sections.flatMap((section) => section.knowledgePoints.map((kp) => kp.id));
  const contentKps = Object.keys(content.knowledgePoints);
  const missingKps = manifestKps.filter((id) => !content.knowledgePoints[id]);
  if (missingKps.length) throw new Error(`content.json missing knowledge points: ${missingKps.join(', ')}`);
  if (contentKps.length !== manifestKps.length) {
    throw new Error(`knowledge point count mismatch: manifest=${manifestKps.length}, content=${contentKps.length}`);
  }
  const missingOverviews = sections.map((section) => section.id).filter((id) => !content.overviews[id]);
  if (missingOverviews.length) throw new Error(`content.json missing overviews: ${missingOverviews.join(', ')}`);
  if (!Array.isArray(glossary) || glossary.length === 0) throw new Error('glossary must be a non-empty array');
  if (!Array.isArray(quiz.examQuestions) || quiz.examQuestions.length === 0) throw new Error('examQuestions must be non-empty');
  for (const src of referencedImages) {
    const full = path.join(COURSE_DIR, src.replace(/\//g, path.sep));
    if (!existsSync(full)) throw new Error(`Referenced image does not exist under course assets: ${src}`);
  }
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

mkdirSync(COURSE_DIR, { recursive: true });

const manifest = parseManifest();
const content = parseContent();
const { QUIZ_DATA, ALL_QUESTIONS, GLOSSARY } = readJsData();
const quiz = {
  sectionQuizzes: parseSectionQuizzes(QUIZ_DATA),
  examQuestions: ALL_QUESTIONS,
};
manifest.stats.questions = quiz.examQuestions.length;

validate(manifest, content, quiz, GLOSSARY);

writeJson(OUT_FILES.manifest, manifest);
writeJson(OUT_FILES.content, content);
writeJson(OUT_FILES.quiz, quiz);
writeJson(OUT_FILES.glossary, GLOSSARY);

const chapters = manifest.chapters.length;
const sections = manifest.chapters.reduce((sum, chapter) => sum + chapter.sections.length, 0);
const knowledgePoints = Object.keys(content.knowledgePoints).length;
const sectionQuizQuestions = Object.values(quiz.sectionQuizzes).reduce((sum, items) => sum + items.length, 0);
const examByType = quiz.examQuestions.reduce((acc, q) => {
  acc[q.type] = (acc[q.type] || 0) + 1;
  return acc;
}, {});
const assetImages = countAssetImages();

console.log('Extracted IC course package source');
console.log(`chapters: ${chapters}`);
console.log(`sections: ${sections}`);
console.log(`knowledgePoints: ${knowledgePoints}`);
console.log(`blockCounts: ${JSON.stringify(blockCounts)}`);
console.log(`sectionQuizQuestions: ${sectionQuizQuestions}`);
console.log(`examQuestions: ${quiz.examQuestions.length} ${JSON.stringify(examByType)}`);
console.log(`glossaryTerms: ${GLOSSARY.length}`);
console.log(`imageBlocks: ${Array.from(referencedImages).length} unique referenced, ${assetImages} files in assets/images`);
if (sourceWarnings.length) console.log(`sourceWarnings: ${sourceWarnings.join('; ')}`);
console.log(`wrote: ${Object.values(OUT_FILES).map((file) => path.relative(ROOT, file).replace(/\\/g, '/')).join(', ')}`);
