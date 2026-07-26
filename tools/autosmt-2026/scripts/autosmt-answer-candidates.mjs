// autosmt-answer-candidates.mjs — 从去年资料提取作业候选答案，并强制校验题数完整性。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from '../../../app/node_modules/fflate/esm/browser.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const EXPECTED_COUNTS = {
  1: 8, 2: 10, 3: 5, 4: 7, 5: 4, 6: 10, 7: 7, 8: 11, 9: 9,
  11: 6, 12: 13, 13: 13, 14: 8, 15: 8, 16: 8, 17: 14, 18: 5, 19: 10,
  20: 13, 21: 12, 22: 24, 23: 10, 24: 9, 25: 10, 26: 6, 27: 5, 28: 5, 29: 7,
};

const SOURCES = [
  ['markdown', '奥施特资料/工艺制造/第1章_IC制造_作业.md'],
  ['docx', '奥施特资料/器件327(1)/器件327/作业11-19.docx'],
  ['markdown', '奥施特资料/封装/第4章_微电子IC封装技术_作业.md'],
  ['markdown', '奥施特资料/封装/第5章_IC器件封装工艺设计_作业.md'],
  ['markdown', '奥施特资料/封装/第6章_集成电路封装工厂_作业.md'],
];

function fail(message) {
  throw new Error(message);
}

function answerFromQuestion(text) {
  const matches = [
    /\(\s*\)[ \t]*([A-Z])\b/,
    /\(\s*([A-Z])\s*\)/,
    /[:：]\s*([A-Z])\s*\(\s*\)/,
  ].map((pattern) => text.match(pattern)?.[1]).filter(Boolean);
  return matches.length === 1 ? matches[0] : null;
}

function addAnswer(works, work, question, answer, source) {
  if (!Object.hasOwn(EXPECTED_COUNTS, work)) return;
  if (!answer) fail(`work ${work}: answer cannot be determined for question ${question} (${source})`);
  const answers = works.get(work) || new Map();
  if (answers.has(question)) fail(`work ${work}: duplicate question ${question} (${source})`);
  answers.set(question, answer);
  works.set(work, answers);
}

function parseMarkdown(text, source, works) {
  const questions = [...text.matchAll(/^\*\*(\d+)-(\d+)\.\*\*/gm)];
  for (let index = 0; index < questions.length; index += 1) {
    const match = questions[index];
    const end = questions[index + 1]?.index ?? text.length;
    const answer = text.slice(match.index, end).match(/答案\s*[：:]\s*([A-Z])\b/)?.[1];
    addAnswer(works, Number(match[1]), Number(match[2]), answer, source);
  }
}

function decodeXml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function docxParagraphs(file) {
  const entries = unzipSync(readFileSync(file));
  const document = entries['word/document.xml'];
  if (!document) fail(`DOCX has no word/document.xml: ${file}`);
  const xml = strFromU8(document);
  return [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)]
    .map((match) => decodeXml(match[1]
      .replace(/<w:tab\s*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<w:t[^>]*>/g, '')
      .replace(/<\/w:t>/g, '')
      .replace(/<[^>]+>/g, '')))
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function parseDocx(file, source, works) {
  const paragraphs = docxParagraphs(file);
  for (let index = 0; index < paragraphs.length; index += 1) {
    const match = paragraphs[index].match(/^(\d+)-(\d+)(?=\D|$)/);
    if (!match) continue;
    let end = index + 1;
    while (end < paragraphs.length && !/^\d+-\d+(?=\D|$)/.test(paragraphs[end])) end += 1;
    let promptEnd = index + 1;
    while (promptEnd < end && !/^[A-Z]\./.test(paragraphs[promptEnd])) promptEnd += 1;
    addAnswer(works, Number(match[1]), Number(match[2]), answerFromQuestion(paragraphs.slice(index, promptEnd).join('\n')), source);
  }
}

function validate(works) {
  const result = {};
  for (const [workText, expected] of Object.entries(EXPECTED_COUNTS)) {
    const work = Number(workText);
    const answers = works.get(work);
    if (!answers) fail(`work ${work}: no questions found`);
    if (answers.size !== expected) fail(`work ${work}: expected ${expected} questions, found ${answers.size}`);
    const ordered = [];
    for (let question = 1; question <= expected; question += 1) {
      const answer = answers.get(question);
      if (!answer) fail(`work ${work}: answer cannot be determined for question ${question}`);
      ordered.push(answer);
    }
    result[work] = ordered;
  }
  return result;
}

function candidates() {
  const works = new Map();
  for (const [kind, relativePath] of SOURCES) {
    const file = path.join(ROOT, relativePath);
    if (kind === 'markdown') parseMarkdown(readFileSync(file, 'utf8'), relativePath, works);
    else parseDocx(file, relativePath, works);
  }
  return validate(works);
}

function selftest() {
  const samples = ['11-1 title:()A', '11-2 title:(B)', '11-3 title:C()', '11-4 title:() D'];
  const expected = ['A', 'B', 'C', 'D'];
  for (let index = 0; index < samples.length; index += 1) {
    if (answerFromQuestion(samples[index]) !== expected[index]) fail(`selftest answer pattern ${index + 1} failed`);
  }
  const markdownWorks = new Map();
  parseMarkdown('**1-1.** question\n\n> **答案： A**', 'selftest', markdownWorks);
  if (markdownWorks.get(1)?.get(1) !== 'A') fail('selftest markdown parsing failed');
  const result = candidates();
  for (const [work, expectedCount] of Object.entries(EXPECTED_COUNTS)) {
    if (result[work]?.length !== expectedCount) fail(`selftest work ${work} count failed`);
  }
}

function parseArgs(argv) {
  if (argv[0] === 'selftest' && argv.length === 1) return { selftest: true };
  if (argv.length === 0) return {};
  if (argv.length === 2 && argv[0] === '--out' && argv[1]) return { out: argv[1] };
  fail('usage: node tools/autosmt-answer-candidates.mjs [--out PATH|selftest]');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selftest) {
    selftest();
    console.log('selftest: ok');
    return;
  }
  const output = JSON.stringify(candidates());
  if (options.out) writeFileSync(path.resolve(options.out), `${output}\n`, 'utf8');
  else console.log(output);
}

try {
  main();
} catch (error) {
  console.error(`autosmt-answer-candidates: ${error.message}`);
  process.exitCode = 1;
}
