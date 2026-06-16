// migrate-quiz.mjs — 把旧版 quiz.json(小测/考试各自内联、id 杂乱、跨池重复)
// 迁移成"题库 + 引用"形态:每道题在 questionBank 定义一次(id = 章号-三位流水),
// 小测/考试只用 id 引用。去重 + 统一编号。用法: node tools/migrate-quiz.mjs <courseId>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const courseId = process.argv[2];
if (!courseId) { console.error('用法: node tools/migrate-quiz.mjs <courseId>'); process.exit(1); }
const file = path.join(ROOT, 'courses', courseId, 'quiz.json');

// 容忍已带注释的文件(再次运行时)。
function stripComments(t) {
  let o = '', s = false, e = false, l = false, b = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i], n = t[i + 1];
    if (l) { if (c === '\n') { l = false; o += c; } continue; }
    if (b) { if (c === '*' && n === '/') { b = false; i++; } continue; }
    if (s) { o += c; if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
    if (c === '"') { s = true; o += c; continue; }
    if (c === '/' && n === '/') { l = true; i++; continue; }
    if (c === '/' && n === '*') { b = true; i++; continue; }
    o += c;
  }
  return o;
}

const quiz = JSON.parse(stripComments(readFileSync(file, 'utf8')));
if (quiz.questionBank) { console.log(`${courseId}: 已是题库引用形态,跳过。`); process.exit(0); }

const norm = (x) => String(x ?? '').replace(/\s+/g, '').trim();
function extraKey(q) {
  if (q.type === 'single') return JSON.stringify((q.options || []).map(norm));
  if (q.type === 'sort') return JSON.stringify((q.items || []).map(norm));
  if (q.type === 'match') return JSON.stringify([(q.left || []).map(norm), (q.right || []).map(norm)]);
  return '';
}
const keyOf = (q) => `${q.type}${norm(q.stem)}${extraKey(q)}`;

// 统一成中间形态 raw:{ type, stem, options?, answer, explain, items?, left?, right?, chapter }
const rawList = [];
// 小测(全是单选)
const sectionOrder = Object.keys(quiz.sectionQuizzes || {});
for (const kp of sectionOrder) {
  for (const it of quiz.sectionQuizzes[kp]) {
    rawList.push({ pool: 'section', kp, chapter: String(kp).split('-')[0],
      q: { type: it.type || 'single', stem: it.q, options: it.options, answer: it.ans, explain: it.exp } });
  }
}
// 考试(4 题型)
for (const e of (quiz.examQuestions || [])) {
  rawList.push({ pool: 'exam', chapter: String(e.chapter),
    q: { type: e.type, stem: e.question, options: e.options, answer: e.answer, explain: e.explain,
         items: e.items, left: e.left, right: e.right } });
}

// 去重:first-seen 决定 chapter 与归并对象
const keyToId = new Map();
const uniques = []; // { key, chapter, q }
let dupCount = 0;
for (const r of rawList) {
  const k = keyOf(r.q);
  if (keyToId.has(k)) { dupCount++; continue; }
  keyToId.set(k, null);
  uniques.push({ key: k, chapter: r.chapter, q: r.q });
}

// 按章分配 章-NNN(first-seen 顺序)
const perChapter = new Map();
for (const u of uniques) {
  const n = (perChapter.get(u.chapter) || 0) + 1;
  perChapter.set(u.chapter, n);
  const id = `${u.chapter}-${String(n).padStart(3, '0')}`;
  keyToId.set(u.key, id);
  u.id = id;
}

// 构建 questionBank(去掉 undefined 字段,字段顺序统一)
const questionBank = {};
for (const u of uniques) {
  const q = u.q;
  const entry = { type: q.type, stem: q.stem };
  if (q.options !== undefined) entry.options = q.options;
  if (q.items !== undefined) entry.items = q.items;
  if (q.left !== undefined) entry.left = q.left;
  if (q.right !== undefined) entry.right = q.right;
  entry.answer = q.answer;
  entry.explain = q.explain;
  questionBank[u.id] = entry;
}

// sectionQuizzes: kp -> [题id](保持原顺序)
const sectionQuizzes = {};
for (const kp of sectionOrder) {
  sectionQuizzes[kp] = quiz.sectionQuizzes[kp].map((it) =>
    keyToId.get(keyOf({ type: it.type || 'single', stem: it.q, options: it.options, items: undefined, left: undefined, right: undefined })));
}

// examQuestions: 章 -> [题id](按原数组顺序分组)
const examQuestions = {};
for (const e of (quiz.examQuestions || [])) {
  const id = keyToId.get(keyOf({ type: e.type, stem: e.question, options: e.options, items: e.items, left: e.left, right: e.right }));
  (examQuestions[String(e.chapter)] ||= []).push(id);
}

const HEADER = `// quiz.json — 题库与引用
// 一道题在 questionBank 里定义一次,小测/考试用 id 引用,避免重复。
// questionBank: { 题id: 题对象 }   题id = 章号-三位流水(如 4-001);题型见 type
//   type     题型:single 单选 / judge 判断 / sort 排序 / match 匹配
//   stem     题干
//   options  选项数组(single;每项以 "A. " 开头)
//   answer   答案:single=字母 / judge=true|false / sort=正确顺序数组 / match={左:右}
//   explain  解析
//   items    (sort)待排序项;  left / right  (match)左右两列
// sectionQuizzes: { 知识点id: [题id...] }   小节小测:某知识点下要出的题
// examQuestions:  { 章id:    [题id...] }    章节考试:某章要出的题
`;

const body = JSON.stringify({ questionBank, sectionQuizzes, examQuestions }, null, 2);
writeFileSync(file, HEADER + body + '\n');

const examTotal = Object.values(examQuestions).reduce((s, a) => s + a.length, 0);
const sectTotal = Object.values(sectionQuizzes).reduce((s, a) => s + a.length, 0);
console.log(`${courseId}: 原始 ${rawList.length} 条 → 去重后 ${uniques.length} 题(合并 ${dupCount} 条重复)`);
console.log(`  questionBank=${uniques.length}  sectionQuizzes引用=${sectTotal}  examQuestions引用=${examTotal}`);
console.log(`  各章题数: ${[...perChapter.entries()].map(([c, n]) => `第${c}章=${n}`).join('  ')}`);
