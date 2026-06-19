// pigeon-server.js - server-side .pigeon (zip) parser.
// Validates an uploaded course package and extracts AUTHORITATIVE metadata.
// Client-sent metadata is never trusted; everything the server stores comes from here.
import { unzipSync, strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';

// Course package validation error, carries a short code for the route layer.
export class PigeonError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'PigeonError';
  }
}

const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

const COVER_MAX_BYTES = 600 * 1024; // skip thumbnails larger than this; card falls back to text/title

// Normalize a zip entry path: forward slashes, no leading "./".
function normalize(p) {
  return String(p).replace(/\\/g, '/').replace(/^\.?\//, '');
}

function mimeForExt(p) {
  const ext = (p.split('.').pop() || '').toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

// Strip // line comments and /* */ block comments, string-aware so that
// "http://..." or "//" inside string literals is never touched.
function stripJsonComments(text) {
  let out = '';
  let inStr = false;
  let esc = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out += c;
      }
      continue;
    }
    if (inBlock) {
      if (c === '*' && n === '/') {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === '/' && n === '/') {
      inLine = true;
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      inBlock = true;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

// Drop trailing commas before } or ], string-aware so commas inside strings stay.
function stripTrailingCommas(text) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

// Tolerant JSON parse mirroring the frontend pigeon-loader: allow comments and
// trailing commas so authors can keep human-friendly notes in their files.
function parseJsonc(text) {
  return JSON.parse(stripTrailingCommas(stripJsonComments(text)));
}

// Count knowledge points across every section of every chapter.
function countKnowledgePoints(chapters) {
  let n = 0;
  for (const chapter of chapters) {
    const sections = Array.isArray(chapter && chapter.sections) ? chapter.sections : [];
    for (const section of sections) {
      if (Array.isArray(section && section.knowledgePoints)) n += section.knowledgePoints.length;
    }
  }
  return n;
}

/**
 * Parse and validate a .pigeon buffer, returning authoritative metadata.
 * @param {Buffer|Uint8Array} buffer raw package bytes
 */
export function parsePigeonBuffer(buffer) {
  const input = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  let raw;
  try {
    raw = unzipSync(input);
  } catch {
    throw new PigeonError('bad_pigeon', '无法解压:不是有效的 .pigeon(zip)文件');
  }

  // Normalize paths and drop directory entries (fflate marks them with a trailing slash).
  const files = {};
  for (const key of Object.keys(raw)) {
    const p = normalize(key);
    if (!p || p.endsWith('/')) continue;
    files[p] = raw[key];
  }

  const manifestEntry = files['manifest.json'];
  if (!manifestEntry) throw new PigeonError('bad_pigeon', '课程包缺少 manifest.json');
  let manifest;
  try {
    manifest = parseJsonc(strFromU8(manifestEntry));
  } catch (e) {
    throw new PigeonError('bad_pigeon', `manifest.json 解析失败:${e.message}`);
  }
  if (!manifest || typeof manifest !== 'object') {
    throw new PigeonError('bad_pigeon', 'manifest.json 格式无效');
  }

  if (
    typeof manifest.id !== 'string'
    || typeof manifest.title !== 'string'
    || !Array.isArray(manifest.chapters)
    || manifest.chapters.length === 0
  ) {
    throw new PigeonError('bad_pigeon', 'manifest 缺少 id / title / chapters 字段');
  }

  // Stats: trust manifest.stats if present, otherwise compute from the package.
  let stats;
  if (manifest.stats && typeof manifest.stats === 'object') {
    stats = manifest.stats;
  } else {
    let questions = 0;
    const quizEntry = files['quiz.json'];
    if (quizEntry) {
      try {
        const quiz = parseJsonc(strFromU8(quizEntry));
        if (quiz && typeof quiz.questionBank === 'object' && quiz.questionBank) {
          questions = Object.keys(quiz.questionBank).length;
        }
      } catch {
        questions = 0;
      }
    }
    stats = {
      chapters: manifest.chapters.length,
      knowledgePoints: countKnowledgePoints(manifest.chapters),
      questions,
    };
  }

  // Cover thumbnail as a base64 data URL, or null when absent/missing/too big.
  let coverBase64 = null;
  if (manifest.cover) {
    const coverPath = normalize(manifest.cover);
    const bytes = files[coverPath];
    if (bytes && bytes.length <= COVER_MAX_BYTES) {
      coverBase64 = `data:${mimeForExt(coverPath)};base64,${Buffer.from(bytes).toString('base64')}`;
    }
  }

  const fileHash = createHash('sha256').update(input).digest('hex');

  return {
    courseKey: manifest.id,
    title: manifest.title,
    subtitle: manifest.subtitle || null,
    author: manifest.author || null,
    version: manifest.version || null,
    stats,
    statsJson: JSON.stringify(stats),
    coverBase64,
    fileHash,
  };
}
