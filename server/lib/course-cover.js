// course-cover.js — 管理员课程封面设置的纯校验与规范化。
export const ADMIN_COVER_MAX_BYTES = 600 * 1024;

export class CoverInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CoverInputError';
    this.code = 'bad_request';
  }
}

const TYPES = {
  'image/png': (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  'image/webp': (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP',
};

export function normalizeCoverSettings({ mode, text = '', file = null, existingImage = null, existingText = null }) {
  if (!['default', 'image', 'text'].includes(mode)) throw new CoverInputError('封面模式无效');
  if (mode === 'default') return { coverMode: 'default', coverImage: null, coverText: null };
  if (mode === 'text') {
    if (typeof text !== 'string') throw new CoverInputError('文字封面须为字符串');
    const value = text.trim();
    if (Array.from(value).length < 1 || Array.from(value).length > 6) throw new CoverInputError('文字封面须为 1 至 6 个字符');
    return { coverMode: 'text', coverImage: existingImage || null, coverText: value };
  }
  if (!file && !existingImage) throw new CoverInputError('请选择封面图片');
  if (!file) return { coverMode: 'image', coverImage: existingImage, coverText: existingText || null };
  if (file.buffer.length > ADMIN_COVER_MAX_BYTES) throw new CoverInputError('封面图片不能超过 600 KB');
  const check = TYPES[file.mimetype];
  if (!check || !check(file.buffer)) throw new CoverInputError('封面图片仅支持 PNG、JPEG 或 WebP');
  return {
    coverMode: 'image',
    coverImage: `data:${file.mimetype};base64,${file.buffer.toString('base64')}`,
    coverText: existingText || null,
  };
}
