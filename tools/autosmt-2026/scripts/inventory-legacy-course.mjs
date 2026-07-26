import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE = path.join(ROOT, 'courses', 'ic-packaging');
const OUTPUT = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'legacy-packaging-inventory.json');

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (current === '\n') { lineComment = false; out += current; }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (inString) {
      out += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') { inString = true; out += current; continue; }
    if (current === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (current === '/' && next === '*') { blockComment = true; index += 1; continue; }
    out += current;
  }
  return out;
}

function readJsonc(name) {
  return JSON.parse(stripJsonComments(readFileSync(path.join(SOURCE, name), 'utf8')));
}

const manifest = readJsonc('manifest.json');
const content = readJsonc('content.json');
const quiz = readJsonc('quiz.json');
const blockTypes = {};
const imagePaths = new Set();
for (const section of [...Object.values(content.overviews || {}), ...Object.values(content.knowledgePoints || {})]) {
  for (const block of section.blocks || []) {
    blockTypes[block.type] = (blockTypes[block.type] || 0) + 1;
    if (block.type === 'image' && block.src) imagePaths.add(block.src);
  }
}
const questionTypes = {};
for (const question of Object.values(quiz.questionBank || {})) {
  questionTypes[question.type] = (questionTypes[question.type] || 0) + 1;
}

const report = {
  schemaVersion: 1,
  candidateOnly: true,
  source: 'courses/ic-packaging',
  purpose: 'Legacy packaging course structure and media inventory for 2026 website snapshot comparison.',
  chapters: manifest.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    sections: chapter.sections.map((section) => ({ id: section.id, title: section.title, knowledgePointCount: section.knowledgePoints.length })),
  })),
  content: {
    overviewCount: Object.keys(content.overviews || {}).length,
    knowledgePointCount: Object.keys(content.knowledgePoints || {}).length,
    blockTypes,
    imageCount: imagePaths.size,
  },
  quiz: { questionCount: Object.keys(quiz.questionBank || {}).length, questionTypes },
  knownGaps: ['lecture video', '2026 experiment source pages', '2026 engineering source pages', '2026 score-verified answers'],
  verificationRule: 'Do not copy legacy text or answers into 2026 courses without matching it against the authoritative website snapshot.',
};

writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ chapters: report.chapters.length, ...report.content, ...report.quiz }));
