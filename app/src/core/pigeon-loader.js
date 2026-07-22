// pigeon-loader.js — 加载并解析 .pigeon 课程包。
//
// .pigeon 本质是 zip,解压后含:
//   manifest.json   元信息 + 章节/节/知识点索引树
//   content.json    知识点正文(类型化节点)
//   quiz.json       题库(小节小测 + 章节考试)
//   glossary.json   术语表
//   assets/         图片、视频、字幕等(content 用相对路径引用)
//   cover.png       (可选)封面
//
// 包内资源不走网络:解压得到字节后转成 Blob URL。大型视频也可通过
// manifest.assetBase 从同源本地目录读取,同时保留含全部媒体的迁移备份。
//
// 解析结果是一个 LoadedCourse 对象,交给渲染器使用。调用方在卸载课程时
// 应调用 course.revoke() 释放所有 Blob URL,避免内存泄漏。

import { unzipSync, strFromU8 } from 'fflate';

export const MAX_PIGEON_BYTES = 1024 * 1024 * 1024; // 1GB: supports portable offline video packages.

/** 课程包校验/解析错误,带可读的 code 供 UI 显示对应文案。 */
export class PigeonError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PigeonError';
    this.code = code; // 'too-large' | 'not-zip' | 'no-manifest' | 'bad-manifest' | 'no-content' | 'bad-content'
  }
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', ogg: 'video/ogg', vtt: 'text/vtt',
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', wasm: 'application/wasm', txt: 'text/plain', csv: 'text/csv',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

function mimeFor(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// 把字节转成 base64 data URL。与 Blob URL 不同,data URL 不依赖对象生命周期,
// revoke() 后仍可用、可存入 IndexedDB,适合做首页课程卡封面缩略图。
function bytesToDataUrl(bytes, mime) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

// zip 内路径统一为不带前导 ./ 的正斜杠形式,便于按相对路径查找。
function normalize(path) {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function localAssetBase(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const base = value.trim();
  if (!/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(base)) return base;
  if (typeof location === 'undefined' || !location.origin || location.origin === 'null') return '';
  try {
    return new URL(base, location.href).origin === location.origin ? base : '';
  } catch {
    return '';
  }
}

// 课程 JSON 允许写成 JSONC:加载时剥离 `//` 行注释、`/* */` 块注释,并容忍尾随逗号。
// 这样课程文件可以带中文注释、对人类友好,运行时仍按标准 JSON 解析。
// 两个函数都"字符串感知"地逐字符扫描,绝不误删字符串内的 // 或 http:// 等内容。
function stripJsonComments(text) {
  let out = '';
  let inStr = false, esc = false, inLine = false, inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { inLine = true; i++; continue; }
    if (c === '/' && n === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

function stripTrailingCommas(text) {
  let out = '';
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue; // 丢弃 } / ] 前的尾随逗号
    }
    out += c;
  }
  return out;
}

function parseJSON(files, name, errCode) {
  const entry = files[name];
  if (!entry) {
    if (errCode) throw new PigeonError(errCode, `课程包缺少 ${name}`);
    return null;
  }
  try {
    return JSON.parse(stripTrailingCommas(stripJsonComments(strFromU8(entry))));
  } catch (e) {
    throw new PigeonError(errCode || 'bad-json', `${name} 不是合法 JSON:${e.message}`);
  }
}

// 题库引用模型归一。
// 新版 quiz.json 用 `questionBank` 把每道题定义一次,再在 sectionQuizzes / examQuestions 里用 id 引用,
// 避免"一题多处"重复。这里把引用解析回渲染器期望的内联结构:
//   sectionQuizzes[kpId] -> [{ qid, type, q, options, ans, exp }]
//   examQuestions        -> [{ id, chapter, type, question, options, answer, explain, items?, left?, right? }]
// 没有 questionBank 时,视为旧版内联格式原样返回(向后兼容,旧课程包仍可加载)。
function normalizeQuiz(quiz) {
  if (!quiz || typeof quiz !== 'object') return { sectionQuizzes: {}, examQuestions: [] };
  const bank = quiz.questionBank;
  if (!bank || typeof bank !== 'object') {
    return {
      sectionQuizzes: quiz.sectionQuizzes || {},
      examQuestions: Array.isArray(quiz.examQuestions) ? quiz.examQuestions : [],
    };
  }

  const sectionQuizzes = {};
  for (const [kpId, ids] of Object.entries(quiz.sectionQuizzes || {})) {
    sectionQuizzes[kpId] = (Array.isArray(ids) ? ids : [])
      .map((id) => {
        const q = bank[id];
        if (!q) return null;
        return { qid: id, type: q.type, q: q.stem, options: q.options, ans: q.answer, exp: q.explain };
      })
      .filter(Boolean);
  }

  const toExam = (id, chapter) => {
    const q = bank[id];
    if (!q) return null;
    return {
      id, chapter: String(chapter ?? q.chapter ?? ''), type: q.type,
      question: q.stem, options: q.options, answer: q.answer, explain: q.explain,
      items: q.items, left: q.left, right: q.right,
    };
  };

  let examQuestions = [];
  const exam = quiz.examQuestions;
  if (exam && !Array.isArray(exam) && typeof exam === 'object') {
    // { 章: [题id] }
    for (const [chapter, ids] of Object.entries(exam)) {
      for (const id of (Array.isArray(ids) ? ids : [])) {
        const item = toExam(id, chapter);
        if (item) examQuestions.push(item);
      }
    }
  } else if (Array.isArray(exam)) {
    // 也接受扁平数组(题 id 字符串或已内联的对象)
    examQuestions = exam.map((it) => (typeof it === 'string' ? toExam(it) : it)).filter(Boolean);
  }

  return { sectionQuizzes, examQuestions };
}

/**
 * 解析 .pigeon 的字节数据(ArrayBuffer / Uint8Array)。
 * @returns LoadedCourse
 */
export function parsePigeon(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength > MAX_PIGEON_BYTES) {
    throw new PigeonError('too-large', '文件超过 1GB 上限');
  }

  let raw;
  try {
    raw = unzipSync(bytes);
  } catch {
    throw new PigeonError('not-zip', '文件已损坏或不是 .pigeon 课程包');
  }

  // 规整路径 + 过滤目录项(fflate 以 / 结尾且长度为 0 表示目录)。
  const files = {};
  for (const key of Object.keys(raw)) {
    const p = normalize(key);
    if (!p || p.endsWith('/')) continue;
    files[p] = raw[key];
  }

  // 必需文件 + schema 基本校验
  const manifest = parseJSON(files, 'manifest.json', 'no-manifest');
  if (!manifest || typeof manifest !== 'object') {
    throw new PigeonError('bad-manifest', 'manifest.json 格式错误');
  }
  if (!manifest.title || !manifest.id) {
    throw new PigeonError('bad-manifest', 'manifest 格式错误:缺少 id / title');
  }
  if (!Array.isArray(manifest.chapters) || manifest.chapters.length === 0) {
    throw new PigeonError('bad-manifest', 'manifest 格式错误:缺少 chapters');
  }

  const content = parseJSON(files, 'content.json', 'no-content');
  if (!content || typeof content !== 'object' || !content.knowledgePoints) {
    throw new PigeonError('bad-content', '课程内容缺失或格式错误');
  }

  // 可选文件
  const quiz = normalizeQuiz(parseJSON(files, 'quiz.json'));
  const glossary = parseJSON(files, 'glossary.json') || [];

  // assets/ 下的资源全部转 Blob URL。仿真可能依赖 JS/CSS/WASM/字体/JSON,
  // 不能只处理图片和视频。
  const blobUrls = [];
  const assetMap = {};
  const imageMap = {};
  let imageCount = 0;
  for (const path of Object.keys(files)) {
    if (!path.startsWith('assets/') && !IMAGE_EXT.test(path)) continue;
    const url = URL.createObjectURL(new Blob([files[path]], { type: mimeFor(path) }));
    blobUrls.push(url);
    assetMap[path] = url;
    if (IMAGE_EXT.test(path)) {
      imageMap[path] = url;
      imageCount++;
    }
  }

  // 封面单独取一份(可能也在 imageMap 里)。
  // coverUrl 是 Blob URL(随 revoke 失效,供学习页等长期持有场景);
  // coverDataUrl 是 base64(不随 revoke 失效,供首页卡片 / 本地存储)。
  let coverUrl = null;
  let coverDataUrl = null;
  if (manifest.cover) {
    const coverPath = normalize(manifest.cover);
    coverUrl = assetMap[coverPath] || null;
    if (files[coverPath]) coverDataUrl = bytesToDataUrl(files[coverPath], mimeFor(coverPath));
  }

  /**
   * 把 content 里的相对路径(assets/images/...)解析为可用的 Blob URL。
   * 找不到时返回原路径(由 <img onerror> 容错,与原站行为一致)。
   */
  function resolveAsset(relPath) {
    if (!relPath) return relPath;
    if (/^(https?:|blob:|data:|\/)/i.test(relPath)) return relPath;
    const match = String(relPath).match(/^([^?#]*)([?#].*)?$/);
    const normalized = normalize(match?.[1] || relPath);
    const suffix = match?.[2] || '';
    if (assetMap[normalized]) return `${assetMap[normalized]}${suffix}`;
    const configuredBase = localAssetBase(manifest.assetBase);
    if (configuredBase) {
      const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;
      const relative = base.endsWith('/assets/') && normalized.startsWith('assets/') ? normalized.slice('assets/'.length) : normalized;
      return `${base}${relative}${suffix}`;
    }
    return relPath;
  }

  return {
    id: manifest.id,
    manifest,
    content,
    quiz,
    glossary,
    coverUrl,
    coverDataUrl,
    imageCount,
    resolveAsset,
    /** 释放全部 Blob URL。卸载课程时必须调用。 */
    revoke() {
      blobUrls.forEach((u) => URL.revokeObjectURL(u));
      blobUrls.length = 0;
    },
  };
}

/** 从 URL 拉取并解析一个 .pigeon(用于内置课程随站发布)。 */
export async function loadPigeonFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new PigeonError('not-zip', `无法下载课程包(${res.status})`);
  const buf = await res.arrayBuffer();
  return parsePigeon(buf);
}

/** 从 File / Blob(上传)解析。 */
export async function loadPigeonFromFile(file) {
  const buf = await file.arrayBuffer();
  return parsePigeon(buf);
}

/** 把错误 code 翻成首页上传区的用户文案。 */
export function pigeonErrorText(err) {
  const code = err && err.code;
  switch (code) {
    case 'too-large': return '文件超过 1GB 上限';
    case 'not-zip': return '文件已损坏或不是 .pigeon 课程包';
    case 'no-manifest': return '缺少 manifest.json(不是合法课程包)';
    case 'bad-manifest': return err.message || 'manifest 格式错误';
    case 'no-content': return '课程内容缺失(缺少 content.json)';
    case 'bad-content': return '课程内容格式错误';
    default: return (err && err.message) || '无法导入:未知错误';
  }
}
