#!/usr/bin/env node
// verify-fidelity.mjs — 忠实度硬门禁(skill 流水线 P2)。
//
// 作用:把「生成的课程 JSON」里的每一段正文/题目文本,逐块拿去和「原始课件」做归一化(去空白)比对;
//       凡是在原文里找不到「逐字子串」的块,即视为疑似被改动(改字 / 漏字 / 多字 / 换标点),硬性报出。
//       目标是守住「正文与题目 100% 不被改动」—— 连错别字也不在抽取阶段被「顺手修正」。
//
// 不参与比对(按设计跳过):
//   · 解析 explain、术语表、对比记忆卡等「增强内容」(P3 新增,本就不在原文里)
//   · image.alt / html / sandbox(结构或作者自管,非源正文)
//   · 选项前缀 "A. "、判断题答案、排序/匹配的正确顺序(结构,非文字本身)
//
// 用法:
//   node verify-fidelity.mjs <源:文件或目录> <生成课程目录(含 content.json[, quiz.json])>
// 退出码:0 = 全部命中(放行);1 = 有疑似改动(硬停,需人工核对);2 = 用法/读取错误。
//
// 注意:比对是「子串包含 + 去空白」。它能抓住改字/漏字/换词/换标点;容忍重排、分块、空格差异。
//       源用 Markdown/HTML 装饰(**粗体**、<tag>)不影响 —— 纯文本块仍是其子串。
//       但若源是 HTML 且把题目放在 <script> JS 字面量里:本工具按设计剥离 <script>,题目文本不在比对池,
//       会把题目整片误报(实测正文 0 误报、题目因此被报)。此时把题目源单独导出为文本再校验,或只以「正文源」为准、单独核题。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

// ---- JSONC 解析(字符串感知,与 app/src/core/pigeon-loader.js 同款)----
function stripJsonComments(text) {
  let out = '', s = false, e = false, l = false, b = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (l) { if (c === '\n') { l = false; out += c; } continue; }
    if (b) { if (c === '*' && n === '/') { b = false; i++; } continue; }
    if (s) { out += c; if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
    if (c === '"') { s = true; out += c; continue; }
    if (c === '/' && n === '/') { l = true; i++; continue; }
    if (c === '/' && n === '*') { b = true; i++; continue; }
    out += c;
  }
  return out;
}
function stripTrailingCommas(text) {
  let out = '', s = false, e = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (s) { out += c; if (e) e = false; else if (c === '\\') e = true; else if (c === '"') s = false; continue; }
    if (c === '"') { s = true; out += c; continue; }
    if (c === ',') { let j = i + 1; while (j < text.length && /\s/.test(text[j])) j++; if (text[j] === '}' || text[j] === ']') continue; }
    out += c;
  }
  return out;
}
function parseJsonc(text) { return JSON.parse(stripTrailingCommas(stripJsonComments(text))); }

// ---- 归一化:仅去空白与零宽字符(不动标点/全半角,以便暴露真实差异)----
function norm(v) { return String(v == null ? '' : v).replace(/[\s​‌‍﻿]+/g, ''); }

// ---- 源材料 → 纯文本(目录递归;HTML 去标签)----
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.json', '.jsonc', '.csv', '.tsv', '.html', '.htm']);
function readSourceText(p) {
  const st = statSync(p);
  if (st.isDirectory()) return readdirSync(p).map((e) => readSourceText(path.join(p, e))).join('\n');
  const ext = path.extname(p).toLowerCase();
  if (!TEXT_EXT.has(ext)) return '';
  let t = readFileSync(p, 'utf8');
  if (ext === '.html' || ext === '.htm') {
    t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  }
  return t;
}

// ---- 抽取生成 JSON 的待校验文本块 ----
function textFromSpans(spans) { return (spans || []).map((s) => (s && s.t) || '').join(''); }

function collectBody(content) {
  const chunks = [];
  const walk = (blocks, where) => {
    for (const blk of blocks || []) {
      switch (blk.type) {
        case 'paragraph': chunks.push({ where, text: textFromSpans(blk.spans) }); break;
        case 'numTitle': case 'boldCaption': case 'heading': chunks.push({ where, text: blk.text || '' }); break;
        case 'paramsTable':
          (blk.headers || []).forEach((h) => chunks.push({ where, text: h }));
          (blk.rows || []).forEach((row) => (row || []).forEach((c) => chunks.push({ where, text: c })));
          break;
        case 'summaryBox':
          chunks.push({ where, text: blk.title || '' });
          (blk.items || []).forEach((it) => chunks.push({ where, text: textFromSpans(it) }));
          break;
        case 'compareBox':
          chunks.push({ where, text: blk.title || '' });
          (blk.headers || []).forEach((h) => chunks.push({ where, text: h }));
          (blk.rows || []).forEach((r) => {
            chunks.push({ where, text: r.label || '' });
            (r.cells || []).forEach((c) => chunks.push({ where, text: c }));
          });
          break;
        default: break; // image / sectionQuiz / html / sandbox:跳过
      }
    }
  };
  for (const [k, v] of Object.entries(content.overviews || {})) walk(v.blocks, `概述 ${k}`);
  for (const [k, v] of Object.entries(content.knowledgePoints || {})) walk(v.blocks, `知识点 ${k}`);
  return chunks;
}

function stripOptionLabel(s) { return String(s).replace(/^\s*[A-Za-z][.．、)）]\s*/, ''); }

function collectQuiz(quiz) {
  const chunks = [];
  for (const [id, q] of Object.entries(quiz.questionBank || {})) {
    if (q.stem) chunks.push({ where: `题 ${id} 题干`, text: q.stem });
    (q.options || []).forEach((o) => chunks.push({ where: `题 ${id} 选项`, text: stripOptionLabel(o) }));
    (q.items || []).forEach((it) => chunks.push({ where: `题 ${id} 排序项`, text: it }));
    (q.left || []).forEach((l) => chunks.push({ where: `题 ${id} 左项`, text: l }));
    (q.right || []).forEach((r) => chunks.push({ where: `题 ${id} 右项`, text: r }));
    // explain / answer:跳过
  }
  return chunks;
}

// ---- 主流程 ----
function main() {
  const [srcArg, genArg] = process.argv.slice(2);
  if (!srcArg || !genArg) {
    console.error('用法:node verify-fidelity.mjs <源:文件或目录> <生成课程目录>');
    process.exit(2);
  }
  if (!existsSync(srcArg)) { console.error(`源不存在:${srcArg}`); process.exit(2); }
  const contentPath = path.join(genArg, 'content.json');
  if (!existsSync(contentPath)) { console.error(`找不到 ${contentPath}`); process.exit(2); }

  const srcNorm = norm(readSourceText(srcArg));
  if (!srcNorm) { console.error('源材料解析为空文本(检查路径/格式)。'); process.exit(2); }

  let chunks = collectBody(parseJsonc(readFileSync(contentPath, 'utf8')));
  const quizPath = path.join(genArg, 'quiz.json');
  if (existsSync(quizPath)) chunks = chunks.concat(collectQuiz(parseJsonc(readFileSync(quizPath, 'utf8'))));

  const misses = [];
  let checked = 0;
  for (const ch of chunks) {
    const n = norm(ch.text);
    if (n.length < 2) continue;             // 过短的块(单字)无意义,跳过
    checked += 1;
    if (!srcNorm.includes(n)) misses.push(ch);
  }

  console.log(`忠实度校验:共 ${chunks.length} 块,有效校验 ${checked} 块。`);
  if (misses.length === 0) {
    console.log('✓ 全部命中原文 —— 正文/题目未发现改动,放行。');
    process.exit(0);
  }
  console.log(`✗ ${misses.length} 块在原文中找不到逐字对应(疑似改字/漏字/换标点),需人工核对:\n`);
  for (const m of misses.slice(0, 60)) {
    const preview = m.text.length > 80 ? `${m.text.slice(0, 80)}…` : m.text;
    console.log(`  · [${m.where}] ${preview}`);
  }
  if (misses.length > 60) console.log(`  …另有 ${misses.length - 60} 块未列出。`);
  console.log('\n提示:确属忠实抽取却被误报,多因源用了不同标点/全半角,或源未包含该处文本;请逐条核对后再放行。');
  process.exit(1);
}

main();
