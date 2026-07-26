#!/usr/bin/env node
// verify-course-fidelity.mjs — 三门 2026 课程的忠实度门禁。
//
// 校验「生成课程 JSON 的每段文本」在对应原始抓取(GB18030/UTF-8 HTML)中逐字存在(去空白比对):
//   · content.json:paragraph.spans、heading、paramSelect(merged/label/options)、stepSimulation(options)
//   · quiz.json:每题 stem
// html 块(理论页/非标 tab)是整段字节级嵌入,校验其去标签文本同样命中源。
// 任何一处未命中 → 硬停(退出码 1)。
// 用法: node tools/autosmt-2026/scripts/verify-course-fidelity.mjs [courseId]
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORTS = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const OUT_BASE = path.join(ROOT, 'courses', '2026-vocational-preliminary');
const require = createRequire(import.meta.url);
const { decode: decodeHtmlEntities } = require(path.join(ROOT, 'app', 'node_modules', 'he'));

const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const gb = new TextDecoder('gb18030');
function loadAny(file) {
  const bytes = readFileSync(file);
  try { return utf8Strict.decode(bytes); } catch { return gb.decode(bytes); }
}
const squash = (s) => String(s || '').replace(/\s+/g, '');
// 源池归一化:JS 字符串转义斜杠 \/ → /(选项文本存于 <script> 字面量,JSON.parse 后是 /)。
// 去标签正则只认 字母 / '/' / '!' 开头的真标签,保住 "<3000" 这类以 < 开头的正文。
const strip = (s) => squash(decodeHtmlEntities(String(s || '')
  .replace(/<\/?[a-zA-Z!][^>]*>/g, '')
  .replace(/\\\//g, '/')));

// ---- 源文本池:全部抓取 HTML 的去标签压缩文本(理论页 + 小节页 + 活动页) ----
console.error('building source pool...');
let pool = '';
for (const dir of ['activity-details']) {
  for (const f of readdirSync(path.join(REPORTS, dir))) {
    if (f.endsWith('.html')) pool += strip(loadAny(path.join(REPORTS, dir, f)));
    // tab 标签(heading 的源)在抓取元数据 label/activity 字段,不在 HTML 正文
    if (f.endsWith('.json')) {
      const meta = JSON.parse(readFileSync(path.join(REPORTS, dir, f), 'utf8'));
      pool += squash(meta.label || '') + squash(meta.activity || '');
    }
  }
}
const sectionsRoot = path.join(REPORTS, 'source-capture', 'sections');
for (const sec of readdirSync(sectionsRoot)) {
  for (const f of readdirSync(path.join(sectionsRoot, sec))) {
    if (f.endsWith('.html')) pool += strip(loadAny(path.join(sectionsRoot, sec, f)));
  }
}
// 理论页正文(resources 里的 .html)
const theoryMap = JSON.parse(readFileSync(path.join(REPORTS, 'resource-capture-theory-v1.json'), 'utf8')).captured;
for (const entry of Object.values(theoryMap)) {
  pool += strip(loadAny(path.join(REPORTS, 'source-capture', entry.file)));
}
console.error(`pool size: ${(pool.length / 1e6).toFixed(1)}M chars`);

let checked = 0;
let failed = 0;
function expect(text, where) {
  const t = squash(text);
  if (!t) return;
  checked += 1;
  if (!pool.includes(t)) {
    failed += 1;
    console.error(`[MISS] ${where}: ${String(text).slice(0, 80)}`);
  }
}

function walkBlocks(blocks, where) {
  for (const b of blocks || []) {
    if (b.type === 'paragraph') {
      // 流水线自注段(占位说明)以「注:」开头,属结构说明而非源正文,跳过
      const t = (b.spans || []).map((s) => s.t).join('');
      if (!t.startsWith('注:')) expect(t, `${where}/paragraph`);
    } else if (b.type === 'heading') expect(b.text, `${where}/heading`);
    else if (b.type === 'html') expect(strip(b.html).slice(0, 4000), `${where}/html`);
    else if (b.type === 'paramSelect') {
      for (const header of b.headers || []) expect(header, `${where}/header`);
      for (const g of b.groups || []) {
        for (const v of g.merged || []) if (typeof v === 'string') expect(v, `${where}/merged`);
        for (const p of g.params || []) {
          expect(p.label, `${where}/param.label`);
          for (const o of p.options || []) expect(o, `${where}/param.option`);
        }
      }
      for (const row of b.matrixRows || []) {
        for (const cell of row.cells || []) {
          for (const part of cell.content || []) {
            if (part.type === 'text') expect(part.text, `${where}/matrix.text`);
            if (part.type !== 'control') continue;
            expect(part.label, `${where}/matrix.control.label`);
            for (const o of part.options || []) expect(o, `${where}/matrix.control.option`);
          }
        }
      }
      for (const s of b.simulations || []) expect(s.label, `${where}/simulation.label`);
    } else if (b.type === 'stepSimulation') {
      const groups = b.groups || [{ steps: b.steps || [] }];
      for (const g of groups) {
        for (const o of g.options || []) expect(o, `${where}/sim.groupOption`);
        for (const s of g.steps || []) {
          expect(s.prompt, `${where}/sim.prompt`);
          for (const o of s.options || []) expect(o, `${where}/sim.option`);
        }
      }
    }
  }
}

const only = process.argv[2];
for (const id of readdirSync(OUT_BASE)) {
  if (only && id !== only) continue;
  const dir = path.join(OUT_BASE, id);
  const content = JSON.parse(readFileSync(path.join(dir, 'content.json'), 'utf8'));
  const quiz = JSON.parse(readFileSync(path.join(dir, 'quiz.json'), 'utf8'));
  for (const [kpId, kp] of Object.entries(content.knowledgePoints)) walkBlocks(kp.blocks, `${id}/${kpId}`);
  for (const [secId, ov] of Object.entries(content.overviews || {})) walkBlocks(ov.blocks, `${id}/ov-${secId}`);
  for (const [qid, q] of Object.entries(quiz.questionBank)) expect(q.stem, `${id}/quiz-${qid}`);
  console.log(`${id}: checked so far ${checked}, failed ${failed}`);
}
console.log(failed === 0 ? `fidelity: ok (${checked} texts)` : `fidelity: ${failed}/${checked} FAILED`);
process.exit(failed === 0 ? 0 : 1);
