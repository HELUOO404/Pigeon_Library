// pigeon-loader.js — 加载并解析 .pigeon 课程包。
//
// .pigeon 本质是 zip,解压后含:
//   manifest.json   元信息 + 章节/节/知识点索引树
//   content.json    知识点正文(类型化节点)
//   quiz.json       题库(小节小测 + 章节考试)
//   glossary.json   术语表
//   assets/images/  图片(content 用相对路径引用)
//   cover.png       (可选)封面
//
// 图片不走网络:解压得到字节后转成 Blob URL,再填进 <img src>,
// 因此课程完全自包含、可离线、可分享。
//
// 解析结果是一个 LoadedCourse 对象,交给渲染器使用。调用方在卸载课程时
// 应调用 course.revoke() 释放所有 Blob URL,避免内存泄漏。

import { unzipSync, strFromU8 } from 'fflate';

export const MAX_PIGEON_BYTES = 50 * 1024 * 1024; // 50MB 上限,与首页文案一致

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
};

function mimeFor(path) {
  const ext = (path.split('.').pop() || '').toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// zip 内路径统一为不带前导 ./ 的正斜杠形式,便于按相对路径查找。
function normalize(path) {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function parseJSON(files, name, errCode) {
  const entry = files[name];
  if (!entry) {
    if (errCode) throw new PigeonError(errCode, `课程包缺少 ${name}`);
    return null;
  }
  try {
    return JSON.parse(strFromU8(entry));
  } catch (e) {
    throw new PigeonError(errCode || 'bad-json', `${name} 不是合法 JSON:${e.message}`);
  }
}

/**
 * 解析 .pigeon 的字节数据(ArrayBuffer / Uint8Array)。
 * @returns LoadedCourse
 */
export function parsePigeon(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength > MAX_PIGEON_BYTES) {
    throw new PigeonError('too-large', '文件超过 50MB 上限');
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
  const quiz = parseJSON(files, 'quiz.json') || { sectionQuizzes: {}, examQuestions: [] };
  const glossary = parseJSON(files, 'glossary.json') || [];

  // 图片转 Blob URL,建立 相对路径 -> objectURL 映射。
  const blobUrls = [];
  const imageMap = {};
  let imageCount = 0;
  for (const path of Object.keys(files)) {
    if (!IMAGE_EXT.test(path)) continue;
    const url = URL.createObjectURL(new Blob([files[path]], { type: mimeFor(path) }));
    blobUrls.push(url);
    imageMap[path] = url;
    imageCount++;
  }

  // 封面单独取一份(可能也在 imageMap 里)。
  let coverUrl = null;
  if (manifest.cover) {
    coverUrl = imageMap[normalize(manifest.cover)] || null;
  }

  /**
   * 把 content 里的相对路径(assets/images/...)解析为可用的 Blob URL。
   * 找不到时返回原路径(由 <img onerror> 容错,与原站行为一致)。
   */
  function resolveAsset(relPath) {
    if (!relPath) return relPath;
    return imageMap[normalize(relPath)] || relPath;
  }

  return {
    id: manifest.id,
    manifest,
    content,
    quiz,
    glossary,
    coverUrl,
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
    case 'too-large': return '文件超过 50MB 上限';
    case 'not-zip': return '文件已损坏或不是 .pigeon 课程包';
    case 'no-manifest': return '缺少 manifest.json(不是合法课程包)';
    case 'bad-manifest': return err.message || 'manifest 格式错误';
    case 'no-content': return '课程内容缺失(缺少 content.json)';
    case 'bad-content': return '课程内容格式错误';
    default: return (err && err.message) || '无法导入:未知错误';
  }
}
