// pigeon-server.js - server-side .pigeon (zip) parser.
// Validates an uploaded course package and extracts AUTHORITATIVE metadata.
// Client-sent metadata is never trusted; everything the server stores comes from here.
import { Unzip, UnzipInflate, strFromU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';

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
const MAX_ZIP_ENTRIES = 2048;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;

function validateZipBounds(input) {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const firstEocdOffset = Math.max(0, input.byteLength - 65557);
  let eocd = -1;
  for (let offset = input.byteLength - 22; offset >= firstEocdOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new PigeonError('bad_pigeon', '无法解压:不是有效的 .pigeon(zip)文件');

  if (eocd >= 20 && view.getUint32(eocd - 20, true) === 0x07064b50) {
    throw new PigeonError('pigeon_zip64_unsupported', '不支持 ZIP64 课程包');
  }

  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (
    diskEntries === 0xffff
    || totalEntries === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
  ) {
    throw new PigeonError('pigeon_zip64_unsupported', '不支持 ZIP64 课程包');
  }
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new PigeonError('bad_pigeon', '不支持分卷 ZIP 课程包');
  }
  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new PigeonError('pigeon_entry_limit', `课程包文件条目不能超过 ${MAX_ZIP_ENTRIES} 个`);
  }
  if (centralOffset + centralSize > eocd) {
    throw new PigeonError('bad_pigeon', 'ZIP 中央目录无效');
  }
  for (let metadataOffset = centralOffset + centralSize; metadataOffset + 4 <= eocd; metadataOffset += 1) {
    const signature = view.getUint32(metadataOffset, true);
    if (signature === 0x06064b50 || signature === 0x07064b50) {
      throw new PigeonError('pigeon_zip64_unsupported', '不支持 ZIP64 课程包');
    }
  }

  let offset = centralOffset;
  let expandedBytes = 0;
  const entries = [];
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) {
      throw new PigeonError('bad_pigeon', 'ZIP 中央目录无效');
    }
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const diskStart = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (compressedSize === 0xffffffff || size === 0xffffffff || diskStart === 0xffff || localOffset === 0xffffffff) {
      throw new PigeonError('pigeon_zip64_unsupported', '不支持 ZIP64 课程包');
    }
    expandedBytes += size;
    if (expandedBytes > MAX_EXPANDED_BYTES) {
      throw new PigeonError('pigeon_expanded_limit', '课程包解压后不能超过 64 MiB');
    }
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const flags = view.getUint16(offset + 8, true);
    let name;
    try {
      name = strFromU8(input.subarray(offset + 46, offset + 46 + nameLength), !(flags & 0x0800));
    } catch {
      throw new PigeonError('bad_pigeon', 'ZIP 文件名编码无效');
    }
    let extraOffset = offset + 46 + nameLength;
    const extraEnd = extraOffset + extraLength;
    if (extraEnd > eocd) throw new PigeonError('bad_pigeon', 'ZIP 中央目录无效');
    while (extraOffset + 4 <= extraEnd) {
      const headerId = view.getUint16(extraOffset, true);
      const dataSize = view.getUint16(extraOffset + 2, true);
      if (headerId === 0x0001) throw new PigeonError('pigeon_zip64_unsupported', '不支持 ZIP64 课程包');
      extraOffset += 4 + dataSize;
      if (extraOffset > extraEnd) throw new PigeonError('bad_pigeon', 'ZIP extra 字段无效');
    }
    if (extraOffset !== extraEnd) throw new PigeonError('bad_pigeon', 'ZIP extra 字段无效');
    entries.push({ name, compressedSize, size, crc: expectedCrc, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralOffset + centralSize) {
    throw new PigeonError('bad_pigeon', 'ZIP 中央目录长度无效');
  }
  return entries.sort((a, b) => a.localOffset - b.localOffset);
}

function extractZipBounded(input, expectedEntries) {
  const raw = {};
  let expandedBytes = 0;
  let entryIndex = 0;
  const unzip = new Unzip((file) => {
    const expected = expectedEntries[entryIndex];
    entryIndex += 1;
    if (!expected || file.name !== expected.name) {
      throw new PigeonError('bad_pigeon', 'ZIP 本地条目与中央目录不一致');
    }

    let actualSize = 0;
    let actualCrc = 0;
    const chunks = [];
    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      actualSize += chunk.length;
      expandedBytes += chunk.length;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new PigeonError('pigeon_expanded_limit', '课程包解压后不能超过 64 MiB');
      }
      actualCrc = crc32(chunk, actualCrc);
      chunks.push(chunk);

      if (!final) return;
      if (
        actualSize !== expected.size
        || (file.originalSize !== undefined && file.originalSize !== actualSize)
        || (file.size !== undefined && file.size !== expected.compressedSize)
        || actualCrc !== expected.crc
      ) {
        throw new PigeonError('bad_pigeon', 'ZIP 条目大小或 CRC 校验失败');
      }
      const bytes = new Uint8Array(actualSize);
      let outputOffset = 0;
      for (const part of chunks) {
        bytes.set(part, outputOffset);
        outputOffset += part.length;
      }
      raw[file.name] = bytes;
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  try {
    const chunkSize = 16 * 1024;
    for (let offset = 0; offset < input.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, input.length);
      unzip.push(input.subarray(offset, end), end === input.length);
    }
  } catch (error) {
    if (error instanceof PigeonError) throw error;
    throw new PigeonError('bad_pigeon', '无法解压:不是有效的 .pigeon(zip)文件');
  }
  if (entryIndex !== expectedEntries.length) {
    throw new PigeonError('bad_pigeon', 'ZIP 本地条目与中央目录不一致');
  }
  return raw;
}

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
  const expectedEntries = validateZipBounds(input);
  const raw = extractZipBounded(input, expectedEntries);

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
    description: typeof manifest.description === 'string' ? manifest.description : null,
    author: manifest.author || null,
    version: manifest.version || null,
    stats,
    statsJson: JSON.stringify(stats),
    coverBase64,
    coverText: typeof manifest.coverText === 'string' ? manifest.coverText : null,
    fileHash,
  };
}
