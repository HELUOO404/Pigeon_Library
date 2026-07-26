// course-source.js — 课程数据源:服务端「广场 / 私人课程 + 社交 + 书架 + 审核」API 封装。
// 本地优先(不变量 5):后端连不上或未登录时,涉及服务端的功能静默退化(返回空/false),
// 不抛错、不阻塞 UI;首页的「内置课保底」由调用方在本模块之外合并(见 main-home.js)。
import { api, apiUpload, apiBytes } from './session.js';

// 课程广场预设分类(与 server/config.js 的 COURSE_CATEGORIES 对齐;非法值由后端回退「其他」)。
export const COURSE_CATEGORIES = ['电子/集成电路', '材料/工艺', '计算机/软件', '数理基础', '通用/综合', '其他'];

// 把后端课程行(square / mine)归一为前端卡片对象,屏蔽 snake_case 与 JSON 字段。
export function normalizeServerCourse(row) {
  let stats = {};
  try { stats = row.stats_json ? JSON.parse(row.stats_json) : {}; } catch { stats = {}; }
  return {
    source: 'server',
    serverId: row.id,
    courseKey: row.course_key,
    title: row.title,
    subtitle: row.subtitle || '',
    description: row.description || '',
    author: row.author || '',
    publisherName: row.publisher_name || '',
    category: row.category || '',
    status: row.status || 'private',
    latestStatus: row.latest_status || '',
    version: row.version || '',
    stats: {
      chapters: stats.chapters ?? 0,
      knowledgePoints: stats.knowledgePoints ?? 0,
      questions: stats.questions ?? 0,
    },
    coverDataUrl: row.cover_data || '',
    coverText: row.cover_text || '',
    visible: row.visible !== 0,
    coverMode: row.cover_mode || 'default',
    coverImageOverride: row.cover_image || '',
    coverTextOverride: row.cover_text_override || '',
    fileSize: row.file_size || 0,
    updatedAt: row.updated_at || 0,
    avgRating: row.avg_rating ?? 0,
    ratingCount: row.rating_count ?? 0,
    downloadCount: row.download_count ?? 0,
  };
}

// ---------- 课程广场 ----------
export async function listSquare(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.q) qs.set('q', filters.q);
  if (filters.category) qs.set('category', filters.category);
  if (filters.publisher) qs.set('publisher', filters.publisher);
  qs.set('page', String(filters.page || 1));
  qs.set('pageSize', String(filters.pageSize || 24));
  const r = await api('GET', `/courses/square?${qs.toString()}`);
  if (!r.ok || !r.json) {
    return { items: [], total: 0, page: 1, pageSize: 24, builtinOverrides: [], offline: !!r.networkError };
  }
  return {
    items: (r.json.items || []).map(normalizeServerCourse),
    total: r.json.total || 0,
    page: r.json.page || 1,
    pageSize: r.json.pageSize || 24,
    builtinOverrides: r.json.builtinOverrides || [],
    offline: false,
  };
}

// ---------- 我的课程(需登录) ----------
export async function listMine() {
  const r = await api('GET', '/courses/mine');
  if (!r.ok || !r.json) return { items: [], offline: !!r.networkError, needLogin: r.status === 401 };
  return { items: (r.json.courses || []).map(normalizeServerCourse), offline: false, needLogin: false };
}

// ---------- 上传私人课(需登录;multipart) ----------
export async function uploadPrivate(file, { category = '' } = {}) {
  const fd = new FormData();
  fd.append('file', file);
  if (category) fd.append('category', category);
  const r = await apiUpload('/courses', fd);
  if (r.ok && r.json?.course) return { ok: true, course: normalizeServerCourse(r.json.course) };
  return {
    ok: false,
    status: r.status,
    error: r.json?.error?.message || '上传失败',
    needLogin: r.status === 401,
    offline: !!r.networkError,
  };
}

// ---------- 发布 / 撤回 / 改元数据 / 删除 ----------
export async function publishCourse(serverId, category) {
  const r = await api('POST', `/courses/${serverId}/publish`, { category });
  return { ok: r.ok, error: r.json?.error?.message };
}
export async function unpublishCourse(serverId) {
  const r = await api('POST', `/courses/${serverId}/unpublish`);
  return { ok: r.ok, error: r.json?.error?.message };
}
export async function patchCourse(serverId, body) {
  const r = await api('PATCH', `/courses/${serverId}`, body);
  return { ok: r.ok, course: r.json?.course ? normalizeServerCourse(r.json.course) : null };
}
export async function removeCourse(serverId) {
  const r = await api('DELETE', `/courses/${serverId}`);
  return { ok: r.ok };
}

// ---------- 版本管理 ----------
export async function uploadVersion(serverId, file) {
  const fd = new FormData();
  fd.append('file', file);
  const r = await apiUpload(`/courses/${serverId}/versions`, fd);
  return { ok: r.ok, version: r.json?.version || null, error: r.json?.error?.message };
}
export async function listVersions(serverId) {
  const r = await api('GET', `/courses/${serverId}/versions`);
  return r.ok && r.json ? (r.json.versions || []) : [];
}
export async function publishVersion(serverId, versionId) {
  const r = await api('POST', `/courses/${serverId}/versions/${versionId}/publish`);
  return { ok: r.ok, error: r.json?.error?.message };
}

// ---------- 聚合学习数据(仅 owner;隐私铁律:只回聚合数字) ----------
export async function courseAnalytics(serverId) {
  const r = await api('GET', `/courses/${serverId}/analytics`);
  return r.ok && r.json ? r.json : null;
}

// ---------- 下载课程包字节(内置课不走这里;返回 Uint8Array 或 null) ----------
export async function downloadCourse(serverId, { version } = {}) {
  const path = version ? `/courses/${serverId}/file?v=${version}` : `/courses/${serverId}/file`;
  const r = await apiBytes(path);
  return r.ok ? r.bytes : null;
}

// ---------- 社交:评分 / 评论 / 下载量 ----------
export async function getSocial(courseKey) {
  const r = await api('GET', `/social/${encodeURIComponent(courseKey)}/social`);
  return r.ok && r.json ? r.json : { avgRating: 0, ratingCount: 0, myRating: null, downloadCount: 0, commentCount: 0 };
}
export async function setRating(courseKey, score) {
  const r = await api('PUT', `/social/${encodeURIComponent(courseKey)}/rating`, { score });
  return r.ok && r.json ? r.json : null;
}
export async function listComments(courseKey, before = null) {
  const qs = before ? `?before=${before}` : '';
  const r = await api('GET', `/social/${encodeURIComponent(courseKey)}/comments${qs}`);
  return r.ok && r.json ? r.json : { items: [], nextBefore: null };
}
export async function addComment(courseKey, body) {
  const r = await api('POST', `/social/${encodeURIComponent(courseKey)}/comments`, { body });
  return { ok: r.ok, comment: r.json?.comment || null, error: r.json?.error?.message, needLogin: r.status === 401 };
}
export async function deleteComment(commentId) {
  const r = await api('DELETE', `/social/comment/${commentId}`);
  return { ok: r.ok };
}

// ---------- 书架(需登录) ----------
export async function listBookshelf() {
  const r = await api('GET', '/bookshelf');
  return r.ok && r.json ? (r.json.items || []) : [];
}
export async function addToShelf(courseKey) {
  const r = await api('PUT', `/bookshelf/${encodeURIComponent(courseKey)}`);
  return { ok: r.ok, needLogin: r.status === 401 };
}
export async function removeFromShelf(courseKey) {
  const r = await api('DELETE', `/bookshelf/${encodeURIComponent(courseKey)}`);
  return { ok: r.ok };
}

// ---------- 管理员审核 ----------
export async function adminPending() {
  const r = await api('GET', '/admin/courses/pending');
  return r.ok && r.json ? (r.json.items || []) : [];
}
export async function adminAllCourses(status = '') {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const r = await api('GET', `/admin/courses${qs}`);
  return r.ok && r.json ? (r.json.courses || []) : [];
}
export async function adminApprove(serverId, versionId) {
  const r = await api('POST', `/admin/courses/${serverId}/versions/${versionId}/approve`);
  return { ok: r.ok, error: r.json?.error?.message };
}
export async function adminReject(serverId, versionId, note) {
  const r = await api('POST', `/admin/courses/${serverId}/versions/${versionId}/reject`, { note });
  return { ok: r.ok, error: r.json?.error?.message };
}
export async function adminTakedown(serverId) {
  const r = await api('POST', `/admin/courses/${serverId}/takedown`);
  return { ok: r.ok, error: r.json?.error?.message };
}
