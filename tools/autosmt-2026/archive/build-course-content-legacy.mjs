#!/usr/bin/env node
// build-course-content.mjs — 2026 正式课程转化流水线(纯脚本,零 LLM)。
//
// 从已抓取的原始内容(tools/autosmt-2026/reports/)逐字生成三门课程源
// (courses/2026-vocational-preliminary/<id>/):manifest/content/quiz.json + assets。
//
// 忠实度策略:
//   · 概述/理论/作业/实验/工程文本一律逐字转录或整段 html 嵌入,不改写;
//   · 答案只取满分验证结果(ui-state-*-strict-audit / candidate-answers / indexed-gnq-map);
//   · 任何找不到答案/选项数不匹配的情况 → 断言硬停,绝不猜。
//   · 工程仿真按钮(实测返回已验证结果图,非交互页面)→ paramSelect.simulations;
//     若某活动的图片抓取报告缺失该 index → 保留占位说明,不阻断整体构建。
//
// 用法: node tools/autosmt-2026/scripts/build-course-content.mjs [courseId]
//        courseId 省略时构建 collection-plan 的全部三门。
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, createReadStream, createWriteStream, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORTS = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const CAPTURE = path.join(REPORTS, 'source-capture');
const OUT_BASE = path.join(ROOT, 'courses', '2026-vocational-preliminary');

// 抓取文件编码混杂(overview 多为 GB18030,menu/theory/homework 多为 UTF-8):
// UTF-8 严格解码(fatal)失败才回退 GB18030 —— UTF-8 自校验,不会误判。
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const gb18030 = new TextDecoder('gb18030');
function loadGb(file) {
  const bytes = readFileSync(file);
  try { return utf8Strict.decode(bytes); } catch { return gb18030.decode(bytes); }
}
function loadJson(file) { return JSON.parse(readFileSync(file, 'utf8')); }
function assert(cond, msg) { if (!cond) { console.error(`[ASSERT] ${msg}`); process.exit(1); } }

// ---- 全局索引 ----
const plan = loadJson(path.join(REPORTS, 'collection-plan.json'));
const sectionIndex = loadJson(path.join(REPORTS, 'section-activity-index.json')).sections;
const scope = loadJson(path.join(REPORTS, 'included-activity-scope.json')).included;
const staticMap = loadJson(path.join(REPORTS, 'resource-capture-static-v1.json')).captured;
const theoryMap = loadJson(path.join(REPORTS, 'resource-capture-theory-v1.json')).captured;
const videoMap = loadJson(path.join(REPORTS, 'resource-capture-video-v1.json')).captured;
const stepVideoMap = loadJson(path.join(REPORTS, 'process-step-video-capture-v1.json')).steps;
const gnqMap = loadJson(path.join(REPORTS, 'current-site-indexed-gnq-map.json')).entries;
const hwAnswers = loadJson(path.join(REPORTS, 'candidate-answers.json'));
// 工程仿真按钮实测返回的是已验证结果图(非交互页面,见 HANDOFF「工程仿真抓取」段)
const engineeringSimMap = existsSync(path.join(REPORTS, 'engineering-simulation-capture-v1.json'))
  ? loadJson(path.join(REPORTS, 'engineering-simulation-capture-v1.json')).steps
  : {};

// ui-state:满分验证的所有下拉文本值。文件名变体多(strict-audit / after-v2 / after-completion...),
// 扫描全部 ui-state-<type>-<n>-*.json,只认 score===100;优先 strict-audit(最后一次严格核对)。
const auditFiles = readdirSync(REPORTS).filter((f) => f.startsWith('ui-state-') && f.endsWith('.json'));
function auditFor(scoreType, n) {
  const mine = auditFiles.filter((f) => new RegExp(`^ui-state-${scoreType}-${n}-`).test(f));
  const ranked = mine.sort((a, b) => (b.includes('strict-audit') ? 1 : 0) - (a.includes('strict-audit') ? 1 : 0));
  for (const f of ranked) {
    const d = loadJson(path.join(REPORTS, f));
    if (d.score === 100 && Array.isArray(d.tabs)) return d;
  }
  return null;
}

// ---- 资源复制(去重;大文件用流复制,规避 Windows copyfile 对超大文件的 UNKNOWN 失败) ----
const pendingCopies = [];
function makeAssetCopier(courseDir) {
  const copied = new Map(); // 源绝对路径 → 课程内相对路径
  return function copyAsset(sourceAbs, targetRel) {
    if (copied.has(sourceAbs)) return copied.get(sourceAbs);
    const target = path.join(courseDir, targetRel);
    mkdirSync(path.dirname(target), { recursive: true });
    if (!existsSync(target) || statSync(target).size !== statSync(sourceAbs).size) {
      if (statSync(sourceAbs).size > 64 * 1024 * 1024) {
        pendingCopies.push(pipeline(createReadStream(sourceAbs), createWriteStream(target)));
      } else {
        copyFileSync(sourceAbs, target);
      }
    }
    copied.set(sourceAbs, targetRel);
    return targetRel;
  };
}

function extFor(file, contentType) {
  const known = path.extname(file).toLowerCase();
  if (contentType?.includes('mp4') || known === '.php') return '.mp4';
  return known || '.bin';
}

// url(如 ../img/BG3.BMP / PlayVideo.php?videoId=2)→ 已抓本地文件绝对路径
function resolveCaptured(url) {
  const entry = staticMap[url] || theoryMap[url] || videoMap[url];
  if (!entry) return null;
  return { abs: path.join(CAPTURE, entry.file), entry };
}

// ---- HTML 工具(轻量,不引第三方依赖) ----
function stripTags(html) {
  // 去标签只认 字母 / '/' / '!' 开头的真标签 —— 保住 "A.<10mcd；…C.>100mcd" 这类以 < 开头的正文
  return html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/?[a-zA-Z!][^>]*>/g, '').replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
}
function cells(rowHtml) {
  return [...rowHtml.matchAll(/<t([dh])\b([^>]*)>(.*?)<\/t\1>/gis)].map((m) => ({ attrs: m[2], html: m[3] }));
}
function rowsOf(tableHtml) {
  // 原站个别页把行尾 </tr> 误写成 <tr>(如实验42),严格配对会漏行;按 <tr 分割宽容解析。
  return tableHtml.split(/<tr\b[^>]*>/i).slice(1)
    .map((chunk) => chunk.replace(/<\/tr>.*$/is, ''))
    .filter((chunk) => /<t[dh]\b/i.test(chunk));
}
function firstTable(html) {
  const m = html.match(/<table\b[^>]*>(.*?)<\/table>/is);
  return m ? m[1] : null;
}
function jsVar(html, name) {
  // var name='<json>'; 单引号内的 JSON 字符串(含转义 \/)
  const m = html.match(new RegExp(`var\\s+${name}\\s*=\\s*'((?:[^'\\\\]|\\\\.)*)'`, 's'));
  if (!m) return null;
  return JSON.parse(m[1].replace(/\\\//g, '/'));
}

// ---- 概述:<p> 段 + 图片 ----
function convertOverview(sectionDir, copyAsset) {
  const html = loadGb(path.join(sectionDir, 'overview.html'));
  const blocks = [];
  for (const m of html.matchAll(/<p\b[^>]*>(.*?)<\/p>|<img\b[^>]*src=["']([^"']+)["'][^>]*>/gis)) {
    if (m[1] !== undefined) {
      const text = stripTags(m[1]);
      if (text) blocks.push({ type: 'paragraph', spans: [{ t: text }] });
    } else if (m[2]) {
      const hit = resolveCaptured(m[2]);
      assert(hit, `概述图片未抓取: ${m[2]}`);
      const rel = copyAsset(hit.abs, `assets/images/${path.basename(hit.entry.file)}`);
      blocks.push({ type: 'image', src: rel, alt: '' });
    }
  }
  return blocks;
}

// ---- 理论:strllzs 各页整段 html 嵌入(逐字保真),图片重映射 ----
function convertTheory(sectionDir, copyAsset) {
  const html = loadGb(path.join(sectionDir, 'theory.html'));
  const m = html.match(/var\s+strllzs\s*=\s*"([^"]*)"/);
  if (!m) return [];
  const names = m[1].split('|').filter(Boolean);
  const blocks = [];
  for (const name of names) {
    const url = `../Html/${name}.html`;
    const entry = theoryMap[url];
    assert(entry, `理论页未抓取: ${url}`);
    let page = loadGb(path.join(CAPTURE, entry.file));
    const body = page.match(/<body\b[^>]*>(.*?)<\/body>/is);
    let inner = body ? body[1] : page;
    // 重映射页内图片(<名>.files/xxx.png → 静态抓取)
    inner = inner.replace(/src=["']([^"']+)["']/gi, (whole, src) => {
      if (/^(?:https?:|data:)/i.test(src)) return whole;
      const decoded = decodeURIComponent(src);
      // 抓取键是绝对 URL 编码路径,按文件名匹配
      const base = path.basename(decoded);
      const key = Object.keys(staticMap).find((k) => decodeURIComponent(k).endsWith(`.files/${base}`) || decodeURIComponent(k).endsWith(`/${base}`));
      if (!key) return whole; // Word 导出常有幽灵引用,缺图不阻断(正文文字不受影响)
      const hit = staticMap[key];
      const rel = copyAsset(path.join(CAPTURE, hit.file), `assets/images/${path.basename(hit.file)}`);
      return `src="${rel}"`;
    });
    blocks.push({ type: 'heading', text: name });
    blocks.push({ type: 'html', html: inner });
  }
  return blocks;
}

// ---- 讲课视频 ----
function convertLecture(sectionDir, copyAsset) {
  const html = loadGb(path.join(sectionDir, 'lecture-video.html'));
  const names = (html.match(/strvideoname\s*=\s*"([^"]*)"/) || [])[1]?.split('|').filter(Boolean) || [];
  const nums = (html.match(/strvideonum\s*=\s*"([^"]*)"/) || [])[1]?.split('|').filter(Boolean) || [];
  assert(names.length === nums.length, `讲课视频名/编号数不一致: ${sectionDir}`);
  const blocks = [];
  names.forEach((name, i) => {
    const key = `PlayVideo.php?videoId=${nums[i]}`;
    const entry = videoMap[key];
    assert(entry, `讲课视频未抓取: ${key}`);
    // copyAsset 按源文件去重:同一源(原站多个 videoId 指向同一文件)只落盘一次,复用首个目标路径
    const rel = copyAsset(path.join(CAPTURE, entry.file), `assets/media/lecture-${nums[i]}${extFor(entry.file, entry.contentType)}`);
    blocks.push({ type: 'video', title: name, src: rel });
  });
  return blocks;
}

// ---- 作业 → quiz questionBank(答案 candidate-answers,按作业号) ----
function convertHomework(sectionDir, chapterNo, bank) {
  const html = loadGb(path.join(sectionDir, 'homework.html'));
  const table = firstTable(html);
  if (!table) return [];
  const ids = [];
  for (const row of rowsOf(table)) {
    const cs = cells(row);
    if (cs.length < 3 || /<th/i.test(`<t${row}`) || cs[0].html.includes('题号') || stripTags(cs[0].html) === '题号') continue;
    const qNo = stripTags(cs[0].html);            // 如 2-1
    if (!/^\d+-\d+$/.test(qNo)) continue;
    const [hwNo, qIdx] = qNo.split('-').map(Number);
    const stem = stripTags(cs[1].html);
    const letters = [...cs[2].html.matchAll(/<option\s+value='([A-Z])'/gi)].map((m) => m[1]);
    const answers = hwAnswers[String(hwNo)];
    assert(answers, `作业 ${hwNo} 无满分答案`);
    const answer = answers[qIdx - 1];
    assert(answer && letters.includes(answer), `作业 ${qNo} 答案 ${answer} 不在选项 ${letters}`);
    const qid = `${chapterNo}-hw${hwNo}-${String(qIdx).padStart(3, '0')}`;
    bank[qid] = { type: 'single', stem, options: letters, answer };
    ids.push(qid);
  }
  return ids;
}

// ---- select 类活动(实验/工程)→ paramSelect ----
// 通用列驱动解析:表头定总列数;逐行按「rowspan 悬挂」补位还原完整网格,
// 中间列(序号与倒数第二列之间)即 merged 组列;组边界 = 最内层 merged 列换新值。
// 仿真按钮(仿真列,ax-btn)的 rowspan 挂靠层级在不同活动里不统一(工艺级或结构级),
// 故按「原始表格行区间」而非「分组」定位:记录按钮所跨的原始行范围,
// 再映射到该范围内的全局参数序号,得到 paramRange(契约 §2.6)。
function parseSelectTable(html) {
  const table = firstTable(html);
  assert(table, 'select 活动无表格');
  const allRows = rowsOf(table);
  const headers = cells(allRows[0]).map((c) => stripTags(c.html));
  const selectCol = headers.indexOf('选择');
  assert(selectCol > 0, `select 表无「选择」列: ${JSON.stringify(headers)}`);
  const labelCol = selectCol - 1;                       // 参数名称/项目列
  const mergedCols = [];                                 // 序号(0)与 label 列之间的组列
  for (let c = 1; c < labelCol; c += 1) mergedCols.push(c);
  const simCol = headers.findIndex((h) => h.includes('仿真'));

  // rowspan 悬挂:hang[col] = { html, left } 未耗尽的跨行单元格
  const hang = {};
  const grid = [];                 // 仅保留 select 行:{ colValues, rawRow }
  const buttons = [];               // { rawStart, rawEnd, label }
  let rawRow = -1;
  for (const row of allRows.slice(1)) {
    const cs = cells(row);
    if (!cs.length) continue;
    rawRow += 1;
    const colValues = {};
    let cursor = 0;
    for (let col = 0; col < headers.length; col += 1) {
      if (hang[col] && hang[col].left > 0) {
        colValues[col] = hang[col].html;
        hang[col].left -= 1;
        continue;
      }
      const cell = cs[cursor];
      cursor += 1;
      if (!cell) break;
      colValues[col] = cell.html;
      const span = Number((cell.attrs.match(/rowspan=["']?(\d+)/i) || [])[1] || 1);
      if (span > 1) hang[col] = { html: cell.html, left: span - 1 };
      colValues[`fresh${col}`] = true;                   // 本行新开单元格(非悬挂)
      if (col === simCol && cell.html.includes('ax-btn')) {
        buttons.push({ rawStart: rawRow, rawEnd: rawRow + span - 1, label: stripTags(cell.html) });
      }
    }
    if (colValues[selectCol]?.includes('<select')) grid.push({ colValues, rawRow });
  }

  const groups = [];
  let group = null;
  grid.forEach(({ colValues: rowVals }) => {
    const innerMergedCol = mergedCols[mergedCols.length - 1];
    const isNewGroup = !group || mergedCols.length === 0 && !group
      || (innerMergedCol !== undefined && rowVals[`fresh${innerMergedCol}`]);
    if (!group || (mergedCols.length > 0 && isNewGroup)) {
      group = { mergedHtml: mergedCols.map((c) => rowVals[c] || ''), params: [] };
      groups.push(group);
    }
    group.params.push({ label: stripTags(rowVals[labelCol] || '') });
  });

  // 按钮原始行区间 → 该区间内 select 行的全局参数序号区间(1 起,含端点)
  const simulations = buttons.map((btn) => {
    const nums = grid
      .map(({ rawRow: r }, index) => (r >= btn.rawStart && r <= btn.rawEnd ? index + 1 : null))
      .filter((n) => n !== null);
    assert(nums.length, `${''}仿真按钮「${btn.label}」覆盖的行区间[${btn.rawStart},${btn.rawEnd}]内无参数题`);
    return { label: btn.label, paramRange: [nums[0], nums[nums.length - 1]] };
  });

  return { groups, simulations, headers: headers.filter((_h, i) => i !== simCol || simCol < 0) };
}

function convertSelectActivity(html, meta, tabAudit, copyAsset) {
  const options = jsVar(html, 'jsonstr_xx');
  assert(options, `select 活动无 jsonstr_xx: ${meta.rawHtmlFile}`);
  const { groups, simulations, headers } = parseSelectTable(html);
  const flat = groups.flatMap((g) => g.params);
  assert(flat.length === options.length, `${meta.rawHtmlFile}: 表格行 ${flat.length} != 选项组 ${options.length}`);
  assert(tabAudit && tabAudit.selectedValues.length === options.length, `${meta.rawHtmlFile}: 满分值数 ${tabAudit?.selectedValues?.length} != ${options.length}`);
  flat.forEach((param, index) => {
    const opts = options[index].split(';').filter(Boolean);
    const value = tabAudit.selectedValues[index];
    const at = opts.indexOf(value);
    assert(at >= 0, `${meta.rawHtmlFile} 第${index + 1}项: 满分值「${value}」不在选项 ${JSON.stringify(opts)}`);
    param.options = opts;
    param.answerIndex = at + 1;
  });
  const outGroups = groups.map((g) => {
    const out = { params: g.params };
    // merged 单元格:含 <img> → {image}(复制资源);否则纯文本
    const merged = g.mergedHtml.map((cellHtml) => {
      const img = cellHtml.match(/<img[^>]*src=["']([^"']+)["']/i);
      if (img) {
        const hit = resolveCaptured(img[1]);
        assert(hit, `merged 列图片未抓取: ${img[1]} (${meta.rawHtmlFile})`);
        const rel = copyAsset(hit.abs, `assets/images/${path.basename(hit.entry.file)}`);
        return { image: rel };
      }
      return stripTags(cellHtml);
    });
    if (merged.some((v) => v && (typeof v !== 'string' || v !== ''))) out.merged = merged;
    return out;
  });
  // 仿真按钮:实测(btn_gycsfz)提交后返回的是原站已验证结果图片路径,非交互页面(见 HANDOFF)。
  // 按钮 index(页面第几个 .ax-btn,0 起)= simulations 数组顺序;图片来自
  // engineering-simulation-capture-v1.json 的 engineering:<号>:<subIndex>:<index>。
  const outSimulations = simulations.map((sim, index) => {
    const key = `${meta.scoreType}:${meta.scoreNumber}:${meta.subIndex}:${index}`;
    const capture = engineeringSimMap[key];
    if (!capture) return null; // 该活动的仿真图片尚未抓取(见占位段落)
    assert(capture.status === 'captured' && capture.captured?.length, `仿真图片未成功抓取: ${key}`);
    const images = capture.captured.map((item, i) => copyAsset(
      path.join(REPORTS, 'engineering-simulations', item.file),
      `assets/images/eng-${meta.scoreNumber}-${meta.subIndex}-${index}-${i}${path.extname(item.file)}`,
    ));
    return { label: sim.label, paramRange: sim.paramRange, images };
  });
  const missingSimCount = outSimulations.filter((s) => s === null).length;
  return { groups: outGroups, simulations: outSimulations.filter(Boolean), missingSimCount, headers };
}

// ---- process-gnq 活动 → stepSimulation groups ----
// 满分审计 selectedValues 按「行」成对记录:[该行功能区值, 该行工序值] × 行数
// (功能区 rowspan 在审计里逐行重复);组界 json_gnqsy 是组首行的 0 基行号。
// current-site-indexed-gnq-map(29/30/31)存在时交叉验证组头序号。
function convertGnqActivity(html, meta, copyAsset, tabAudit) {
  const selectDef = jsVar(html, 'jsonstr_select');
  const boundaries = jsVar(html, 'json_gnqsy');
  assert(Array.isArray(selectDef) && Array.isArray(selectDef[0]), `gnq 选项定义异常: ${meta.rawHtmlFile}`);
  const [s1opts, s2opts] = selectDef;
  const values = tabAudit.selectedValues;
  assert(values.length % 2 === 0, `${meta.rawHtmlFile}: 满分值数 ${values.length} 非偶(应为行数×2)`);
  const stepsTotal = values.length / 2;
  assert(boundaries[boundaries.length - 1] < stepsTotal,
    `${meta.rawHtmlFile}: 组界 ${JSON.stringify(boundaries)} 超出行数 ${stepsTotal}`);
  const crossCheck = gnqMap.find((e) => e.scoreType === meta.scoreType && e.scoreNumber === meta.scoreNumber && e.subIndex === meta.subIndex);
  const groups = [];
  for (let g = 0; g < boundaries.length; g += 1) {
    const start = boundaries[g];
    const end = g + 1 < boundaries.length ? boundaries[g + 1] : stepsTotal;
    const s1val = values[2 * start];
    const s1idx = s1opts.indexOf(s1val) + 1;
    assert(s1idx > 0, `${meta.rawHtmlFile} 组${g + 1}: 组头值「${s1val}」不在选项`);
    if (crossCheck) assert(crossCheck.s1Indexes[g] === s1idx, `${meta.rawHtmlFile} 组${g + 1}: 组头序号与 gnq-map 不符(${crossCheck.s1Indexes[g]} vs ${s1idx})`);
    const steps = [];
    for (let s = start; s < end; s += 1) {
      // 组内行的功能区值必须与组头一致(rowspan 重复),不一致说明值序理解错了 → 硬停
      assert(values[2 * s] === s1val, `${meta.rawHtmlFile} 行${s + 1}: 功能区值「${values[2 * s]}」≠ 组头「${s1val}」`);
      const s2val = values[2 * s + 1];
      const s2idx = s2opts.indexOf(s2val) + 1;
      assert(s2idx > 0, `${meta.rawHtmlFile} 行${s + 1}: 工序值「${s2val}」不在选项`);
      if (crossCheck) assert(crossCheck.s2Indexes[s] === s2idx, `${meta.rawHtmlFile} 行${s + 1}: 工序序号与 gnq-map 不符`);
      const clipEntry = stepVideoMap[`${meta.scoreType}:${meta.scoreNumber}:${meta.subIndex}:${s}`];
      assert(clipEntry, `gnq 步骤短片未抓取: ${meta.scoreNumber}:${s}`);
      const rel = copyAsset(path.join(CAPTURE, clipEntry.file), `assets/media/step-${meta.scoreNumber}-${meta.subIndex}-${s}${extFor(clipEntry.file, clipEntry.contentType)}`);
      steps.push({ prompt: '工序', options: s2opts, answerIndex: s2idx, clip: rel });
    }
    groups.push({ prompt: '功能区', options: s1opts, answerIndex: s1idx, steps });
  }
  return groups;
}

// ---- 平表流程活动(实验42-47:序号|项目|选择|仿真,共用选项+每步短片)→ stepSimulation 扁平 steps ----
function convertFlowSteps(html, meta, copyAsset, tabAudit) {
  const opts = jsVar(html, 'jsonstr_select');
  assert(Array.isArray(opts) && typeof opts[0] === 'string', `flow 选项定义异常: ${meta.rawHtmlFile}`);
  const table = firstTable(html);
  const prompts = [];
  for (const row of rowsOf(table)) {
    const cs = cells(row);
    if (cs.length >= 3 && cs[2]?.html.includes('<select')) prompts.push(stripTags(cs[1].html));
  }
  const values = tabAudit.selectedValues;
  assert(prompts.length === values.length, `${meta.rawHtmlFile}: 行数 ${prompts.length} != 满分值数 ${values.length}`);
  return prompts.map((prompt, index) => {
    const at = opts.indexOf(values[index]) + 1;
    assert(at > 0, `${meta.rawHtmlFile} 第${index + 1}行: 值「${values[index]}」不在选项`);
    const clipEntry = stepVideoMap[`${meta.scoreType}:${meta.scoreNumber}:${meta.subIndex}:${index}`];
    assert(clipEntry, `flow 步骤短片未抓取: ${meta.scoreNumber}:${index}`);
    const rel = copyAsset(path.join(CAPTURE, clipEntry.file), `assets/media/step-${meta.scoreNumber}-${meta.subIndex}-${index}${extFor(clipEntry.file, clipEntry.contentType)}`);
    return { prompt, options: opts, answerIndex: at, clip: rel };
  });
}

// ---- unknown 类 tab(纯内容页)→ html 块(逐字嵌入,资源重映射) ----
function convertContentTab(html, copyAsset) {
  // 去掉 <script>(html 块本就不执行,清掉避免体积),重映射 img/video
  let inner = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  inner = inner.replace(/(src)=["']([^"']+)["']/gi, (whole, attr, src) => {
    if (/^(?:https?:|data:|assets\/)/i.test(src)) return whole;
    const hit = resolveCaptured(src) || resolveCaptured(src.replace(/^\.\.\//, '../'));
    if (!hit) return whole;
    const rel = copyAsset(hit.abs, `assets/media/${path.basename(hit.entry.file)}${hit.entry.contentType?.includes('mp4') && !hit.entry.file.endsWith('.mp4') ? '.mp4' : ''}`);
    return `${attr}="${rel}"`;
  });
  return { type: 'html', html: inner };
}

// ---- 单个活动(实验/工程)→ KP blocks ----
function convertActivity(kind, number, copyAsset) {
  const files = readdirSync(path.join(REPORTS, 'activity-details'))
    .filter((f) => f.endsWith('.json') && f.includes(`-${kind}-${number}-tab-`))
    .sort();
  assert(files.length, `活动无抓取: ${kind}-${number}`);
  const audit = auditFor(kind === 'engineering' ? 'engineering' : 'experiment', number);
  assert(audit && audit.score === 100, `活动无满分审计: ${kind}-${number}`);
  const blocks = [];
  for (const f of files) {
    const meta = loadJson(path.join(REPORTS, 'activity-details', f));
    const html = loadGb(path.join(REPORTS, 'activity-details', meta.rawHtmlFile));
    if (files.length > 1) blocks.push({ type: 'heading', text: meta.label });
    // 分派:标准 select 表(序号|…|选择)→ paramSelect;
    //       gnq 两级流程 → stepSimulation groups;平表流程(序号|项目|选择|仿真)→ stepSimulation 扁平;
    //       其余(阶段面板/矩阵/版图等非标布局)第一版以 html 块逐字保留(文字忠实,交互待迭代,见 HANDOFF)。
    const tabAudit = audit.tabs.find((t) => t.subIndex === meta.subIndex);
    const heads = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/gis)].map((m) => stripTags(m[1]));
    const hasStepClips = stepVideoMap[`${meta.scoreType}:${meta.scoreNumber}:${meta.subIndex}:0`] !== undefined;
    if (meta.kind === 'process-gnq') {
      const groups = convertGnqActivity(html, meta, copyAsset, tabAudit);
      blocks.push({ type: 'stepSimulation', id: `${kind}-${number}-flow-${meta.subIndex}`, title: meta.label, groups });
    } else if (meta.kind === 'select' && hasStepClips && heads.includes('仿真')) {
      const steps = convertFlowSteps(html, meta, copyAsset, tabAudit);
      blocks.push({ type: 'stepSimulation', id: `${kind}-${number}-flow-${meta.subIndex}`, title: meta.label, steps });
    } else if (meta.kind === 'select' && heads.includes('选择') && heads.includes('序号')) {
      const { groups, simulations, missingSimCount, headers } = convertSelectActivity(html, meta, tabAudit, copyAsset);
      const block = { type: 'paramSelect', id: `${kind}-${number}-tab-${meta.subIndex}`, title: '参数设置', headers, groups };
      if (simulations.length) block.simulations = simulations;
      blocks.push(block);
      if (missingSimCount) {
        blocks.push({ type: 'paragraph', spans: [{ t: `注:本活动原站包含 ${missingSimCount} 个工艺参数仿真按钮的结果图尚未抓取(待补抓后接入)。` }] });
      }
    } else {
      blocks.push(convertContentTab(html, copyAsset));
    }
  }
  return blocks;
}

// ---- 主流程 ----
function buildCourse(deliverable) {
  const courseDir = path.join(OUT_BASE, deliverable.id);
  mkdirSync(courseDir, { recursive: true });
  const copyAsset = makeAssetCopier(courseDir);

  const manifest = {
    schemaVersion: 1,
    id: deliverable.id,
    title: deliverable.title,
    subtitle: '2026 职业赛道初赛',
    description: `${deliverable.title} — 由 AutoSMT 原站满分验证内容逐字转化。`,
    author: 'AutoSMT 转化流水线',
    version: '1.0.0',
    coverText: deliverable.title.replace('2026职业赛道初赛', ''),
    stats: { chapters: 0, knowledgePoints: 0, questions: 0 },
    chapters: [],
  };
  const content = { knowledgePoints: {}, overviews: {} };
  const quiz = { questionBank: {}, sectionQuizzes: {}, examQuestions: {} };

  deliverable.sourceChapterIndexes.forEach((chapterIndex) => {
    // 章号沿用原站真实章号(chapterIndex+1),与 collection-plan.sourceChapters 一致;
    // delivery 门禁按此校验(如 devices 课的章为 2、3)。
    const chapterNo = chapterIndex + 1;
    const sections = sectionIndex.filter((s) => s.chapterIndex === chapterIndex);
    assert(sections.length, `章 ${chapterIndex} 无小节`);
    // 章/节标题取自 menu.html:「第N章 XXX -- 第N.M节 YYY」
    const firstMenu = loadGb(path.join(CAPTURE, 'sections', `${chapterIndex}-0`, 'menu.html'));
    const chapterTitle = (firstMenu.match(/第\s*\d+\s*章\s*([^<>-]+?)\s*(?:--|<)/) || [])[1]?.trim() || `第${chapterIndex + 1}章`;
    const chapter = { id: String(chapterNo), title: chapterTitle, tabLabel: chapterTitle.slice(0, 4), sections: [] };
    const examIds = [];

    for (const sec of sections) {
      const secNo = sec.sectionIndex + 1;
      const secDir = path.join(CAPTURE, 'sections', `${chapterIndex}-${sec.sectionIndex}`);
      const menu = loadGb(path.join(secDir, 'menu.html'));
      const secTitle = (menu.match(/第\s*[\d.]+\s*节\s*([^<>]+?)\s*</) || [])[1]?.trim() || `第${chapterNo}.${secNo}节`;
      const sectionId = `${chapterNo}.${secNo}`;
      const section = { id: sectionId, title: secTitle, knowledgePoints: [] };
      const kpBase = `${chapterNo}-${secNo}`;
      let kpSeq = 0;
      const addKp = (title, blocks) => {
        kpSeq += 1;
        const kpId = `${kpBase}-${kpSeq}`;
        section.knowledgePoints.push({ id: kpId, title });
        content.knowledgePoints[kpId] = { title, blocks };
        return kpId;
      };

      // 概述 → overviews(小节页头卡);理论/讲课/作业/活动 → 知识点卡
      const overviewBlocks = convertOverview(secDir, copyAsset);
      if (overviewBlocks.length) content.overviews[sectionId] = { title: `${secTitle} · 概述`, blocks: overviewBlocks };
      const theoryBlocks = convertTheory(secDir, copyAsset);
      if (theoryBlocks.length) addKp('理论知识', theoryBlocks);
      const lectureBlocks = convertLecture(secDir, copyAsset);
      if (lectureBlocks.length) addKp('讲课视频', lectureBlocks);

      // 作业(排除号不在 scope.homework 的)
      const hwIds = convertHomework(secDir, chapterNo, quiz.questionBank);
      const filteredHw = hwIds.filter((qid) => scope.homework.includes(Number(qid.match(/hw(\d+)/)[1])));
      if (filteredHw.length) {
        const kpId = addKp('作业', [{ type: 'sectionQuiz', quizRef: '' }]);
        content.knowledgePoints[kpId].blocks[0].quizRef = kpId;
        quiz.sectionQuizzes[kpId] = filteredHw;
        examIds.push(...filteredHw);
      }

      // 实验/工程活动
      for (const label of sec.experiments) {
        const n = Number((label.match(/实验(\d+)/) || [])[1]);
        if (!n || !scope.experiments.includes(n)) continue;
        addKp(label, convertActivity('experiment', n, copyAsset));
      }
      for (const label of sec.engineering) {
        const n = Number((label.match(/工程(\d+)/) || [])[1]);
        if (!n || !scope.projects.includes(n)) continue;
        addKp(label, convertActivity('engineering', n, copyAsset));
      }

      if (section.knowledgePoints.length) chapter.sections.push(section);
    }
    quiz.examQuestions[String(chapterNo)] = examIds;
    manifest.chapters.push(chapter);
  });

  manifest.stats.chapters = manifest.chapters.length;
  manifest.stats.knowledgePoints = Object.keys(content.knowledgePoints).length;
  manifest.stats.questions = Object.keys(quiz.questionBank).length;

  writeFileSync(path.join(courseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(courseDir, 'content.json'), `${JSON.stringify(content, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(courseDir, 'quiz.json'), `${JSON.stringify(quiz, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(courseDir, 'glossary.json'), '[]\n', 'utf8');
  console.log(JSON.stringify({
    id: deliverable.id,
    chapters: manifest.stats.chapters,
    knowledgePoints: manifest.stats.knowledgePoints,
    questions: manifest.stats.questions,
  }));
}

const only = process.argv[2];
for (const deliverable of plan.deliverables) {
  if (only && deliverable.id !== only) continue;
  buildCourse(deliverable);
}
// 等大文件流复制全部落盘(失败即整体失败,不留半截资源)
await Promise.all(pendingCopies);
console.log(`large-file copies: ${pendingCopies.length} done`);
