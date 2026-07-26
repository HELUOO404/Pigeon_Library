// main-admin.js — 管理控制台:KPI / 趋势 / 课程 / 会话 / 用户检索·下钻 / 审计 / 建号 / CSV。
// 仅 admin 可见;所有数据来自 /api/admin/*。设计系统:令牌配色、无 emoji、无竖线、亮暗双主题。
import { applyInitialTheme, toggleTheme } from './core/theme.js';
import { icon, hydrateIcons } from './core/icons.js';
import { initSession, getUser, isAdmin, api, apiForm } from './core/session.js';
import { initAuthUI } from './core/auth-ui.js';
import { toast } from './core/toast.js';
import { sparkline, sparkbars } from './core/sparkline.js';
import { BUILTIN_COURSES } from './core/course-registry.js';
import { applyBuiltinOverrides, resolveCourseCover } from './core/course-overrides.js';
import { COURSE_CATEGORIES } from './core/course-source.js';

applyInitialTheme();

const $ = (id) => document.getElementById(id);
const gate = $('adminGate');
const body = $('adminBody');

// 列表检索状态。
const state = { q: '', role: '', status: '', sort: 'id', dir: 'asc', page: 1, pageSize: 20 };
let drawerUserId = null;
let toolbarReady = false;
let adminCourseRows = [];
let courseEditorState = null;
let courseEditorRequestToken = 0;

const ACTION_LABEL = {
  disable: '禁用', enable: '启用', set_role: '改角色', reset_pw: '重置密码',
  rename: '改名', delete: '删除', create: '建号', force_logout: '强制下线', reset_state: '清空进度',
  course_approve: '通过课程', course_reject: '拒绝课程', course_takedown: '下架课程',
  course_edit: '编辑课程', course_delete: '删除课程',
};

const COURSE_STATUS = { private: '私有', pending: '审核中', published: '已发布', rejected: '被拒', builtin: '内置示例' };

// ---------- 工具 ----------
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function escAttr(s) {
  return esc(s).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function fmtDate(ms) { return ms ? new Date(ms).toLocaleDateString() : '—'; }
function fmtRel(ms) {
  if (!ms) return '—';
  const d = Date.now() - ms; const m = 60000, h = 3600000, day = 86400000;
  if (d < 0) return '刚刚';
  if (d < m) return '刚刚';
  if (d < h) return `${Math.floor(d / m)} 分钟前`;
  if (d < day) return `${Math.floor(d / h)} 小时前`;
  if (d < 7 * day) return `${Math.floor(d / day)} 天前`;
  return new Date(ms).toLocaleDateString();
}
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function shortUA(ua) {
  if (!ua) return '—';
  const m = ua.match(/(Edg|Chrome|Firefox|Safari|OPR)\/[\d.]+/);
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = m ? m[0].replace('Edg', 'Edge').replace('OPR', 'Opera') : '未知';
  return os ? `${br} · ${os}` : br;
}

function renderGate(message, withLogin) {
  body.hidden = true;
  gate.hidden = false;
  gate.innerHTML = `<p>${esc(message)}</p>${withLogin
    ? `<button class="btn btn-primary" type="button" data-auth="open-login">${icon('user', { size: 16 })} 登录</button>`
    : '<a class="btn btn-secondary" href="/index.html">返回首页</a>'}`;
}

// ---------- KPI ----------
function renderStats(s) {
  const cards = [
    { label: '用户总数', value: s.userCount, sub: `今日 +${s.newToday} · 7日 +${s.new7d}` },
    { label: '活跃 · 7日', value: s.active7d, sub: `今日 ${s.activeToday} · 30日 ${s.active30d}` },
    { label: '管理员', value: s.adminCount, sub: `禁用 ${s.disabledCount}` },
    { label: '从未登录', value: s.neverLoggedIn, sub: '未完成首次登录' },
    { label: '有效会话', value: s.activeSessions, sub: '当前在线' },
    { label: '同步行', value: s.stateRows, sub: `${s.courseCount} 门课程` },
    { label: '课程数', value: s.courseCount, sub: `${s.stateRows} 行同步数据` },
    { label: '数据库', value: fmtBytes(s.dbBytes), mono: true, sub: 'SQLite 文件大小' },
  ];
  $('adminStats').innerHTML = cards.map((c) => `
    <div class="admin-stat">
      <div class="admin-stat-label">${esc(c.label)}</div>
      <div class="admin-stat-value">${esc(c.value)}</div>
      ${c.sub ? `<div class="admin-stat-sub">${esc(c.sub)}</div>` : ''}
    </div>`).join('');
}

// ---------- 趋势 ----------
function renderTrends(t) {
  const regs = t.registrations || [];
  const cum = t.cumulative || [];
  const sumNew = regs.reduce((a, r) => a + r.count, 0);
  const lastTotal = cum.length ? cum[cum.length - 1].total : 0;
  const axis = (arr) => arr.length
    ? `<div class="admin-trend-axis"><span>${esc(arr[0].day)}</span><span>${esc(arr[arr.length - 1].day)}</span></div>` : '';
  $('adminTrends').innerHTML = `
    <div class="admin-trend">
      <div class="admin-trend-head"><span class="admin-trend-label">每日新增</span><span class="admin-trend-val">+${sumNew} · 近 ${regs.length} 天</span></div>
      <div class="admin-trend-chart spark-gold">${sparkbars(regs.map((r) => r.count))}</div>
      ${axis(regs)}
    </div>
    <div class="admin-trend">
      <div class="admin-trend-head"><span class="admin-trend-label">累计用户</span><span class="admin-trend-val">${lastTotal}</span></div>
      <div class="admin-trend-chart spark-gold">${sparkline(cum.map((c) => c.total))}</div>
      ${axis(cum)}
    </div>`;
}

// ---------- 课程分析 ----------
function renderCourses(list) {
  $('adminCoursesSub').textContent = `${list.length} 门`;
  if (!list.length) { $('adminCourses').innerHTML = '<p class="admin-empty">还没有任何同步进度</p>'; return; }
  $('adminCourses').innerHTML = list.map((c) => `
    <div class="admin-row">
      <div class="admin-row-main">
        <span class="admin-row-title mono">${esc(c.course_id)}</span>
        <span class="admin-row-meta">${c.learners} 学习者 · ${c.rows} 行 · ${fmtBytes(c.bytes)}</span>
      </div>
      <span class="admin-row-side">${fmtRel(c.lastActivity)}</span>
    </div>`).join('');
}

// ---------- 课程审核 ----------
function renderPending(list) {
  $('adminPendingSub').textContent = `${list.length} 个待审`;
  if (!list.length) { $('adminPending').innerHTML = '<p class="admin-empty">没有待审课程</p>'; return; }
  $('adminPending').innerHTML = list.map((p) => `
    <div class="admin-row review-row">
      <div class="admin-row-main">
        <span class="admin-row-title">${esc(p.title)} <span class="review-ver">v${esc(p.version || '—')}</span></span>
        <span class="admin-row-meta">发布人 ${esc(p.publisher_name)} · ${esc(p.category || '未分类')} · ${fmtBytes(p.file_size)} · ${fmtRel(p.created_at)}</span>
      </div>
      <div class="review-actions">
        <button class="admin-mini-btn" type="button" data-act="preview-course" data-key="${escAttr(p.course_key)}" data-cid="${escAttr(p.course_id)}" data-vid="${escAttr(p.version_id)}">预览</button>
        <button class="admin-mini-btn primary" type="button" data-act="approve-course" data-cid="${escAttr(p.course_id)}" data-vid="${escAttr(p.version_id)}" data-title="${escAttr(p.title)}">通过</button>
        <button class="admin-mini-btn danger" type="button" data-act="reject-course" data-cid="${escAttr(p.course_id)}" data-vid="${escAttr(p.version_id)}" data-title="${escAttr(p.title)}">拒绝</button>
      </div>
    </div>`).join('');
}

function renderAllCourses(list, overrides) {
  const builtinSources = new Map(BUILTIN_COURSES.map((course) => [course.id, course]));
  const builtins = applyBuiltinOverrides(BUILTIN_COURSES, overrides, { includeInvisible: true }).map((course) => {
    const source = builtinSources.get(course.id);
    return {
      id: null,
      ref: `builtin:${course.id}`,
      title: course.title,
      subtitle: course.subtitle || '',
      description: course.description || '',
      author: course.author || '',
      publisher_name: course.publisherName || course.author || 'PigeonLib',
      category: course.category || '',
      course_key: course.id,
      status: 'builtin',
      updated_at: course.updatedAt || null,
      visible: course.visible,
      cover_mode: course.coverMode,
      cover_image: course.coverImageOverride,
      cover_text: course.coverTextOverride,
      coverDataUrl: course.coverUrl,
      coverText: course.coverText,
      original: {
        title: source.title,
        subtitle: source.subtitle || '',
        description: source.description || '',
        author: source.author || '',
        cover_image: source.coverUrl || '',
        cover_text: source.coverText || '',
      },
    };
  });
  const uploaded = list.map((course) => ({
    ...course,
    ref: String(course.id),
    visible: course.visible !== 0,
    cover_mode: course.cover_mode || 'default',
    cover_image: course.cover_image || '',
    cover_text: course.cover_text_override || '',
    coverDataUrl: course.cover_data || '',
    coverText: course.cover_text || '',
  }));
  adminCourseRows = [...builtins, ...uploaded];
  $('adminAllCoursesSub').textContent = `${adminCourseRows.length} 门`;
  if (!adminCourseRows.length) { $('adminAllCourses').innerHTML = '<p class="admin-empty">还没有课程</p>'; return; }
  $('adminAllCourses').innerHTML = adminCourseRows.map((c, index) => {
    const vid = c.current_version_id || c.latest_version_id || '';
    return `
    <div class="admin-row review-row">
      <div class="admin-row-main">
        <span class="admin-row-title">${esc(c.title)} <span class="admin-role${c.status === 'published' ? ' is-admin' : ''}">${esc(COURSE_STATUS[c.status] || c.status)}</span>${c.visible === false ? ' <span class="admin-role is-hidden">已隐藏</span>' : ''}</span>
        <span class="admin-row-meta">发布人 ${esc(c.publisher_name)} · ${esc(c.category || '未分类')} · ${fmtRel(c.updated_at)}</span>
      </div>
      <div class="review-actions">
        ${c.id && vid ? `<button class="admin-mini-btn" type="button" data-act="preview-course" data-key="${escAttr(c.course_key)}" data-cid="${c.id}" data-vid="${vid}">预览</button>` : ''}
        <button class="admin-mini-btn" type="button" data-act="edit-course" data-course-idx="${index}" data-course-ref="${escAttr(c.ref)}">${icon('square-pen', { size: 14 })} 编辑</button>
        <button class="admin-mini-btn danger" type="button" data-act="delete-course" data-course-idx="${index}" data-course-ref="${escAttr(c.ref)}">${icon('trash-2', { size: 14 })} 删除</button>
        ${c.id && c.status === 'published' ? `<button class="admin-mini-btn danger" type="button" data-act="takedown-course" data-cid="${c.id}" data-title="${escAttr(c.title)}">下架</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ---------- 会话 ----------
function renderSessions(list) {
  $('adminSessionsSub').textContent = `${list.length} 个`;
  if (!list.length) { $('adminSessions').innerHTML = '<p class="admin-empty">当前没有有效会话</p>'; return; }
  $('adminSessions').innerHTML = list.map((s) => `
    <div class="admin-row">
      <div class="admin-row-main">
        <span class="admin-row-title">${esc(s.username)}</span>
        <span class="admin-row-meta">${esc(shortUA(s.user_agent))} · ${esc(s.ip || '—')}</span>
      </div>
      <span class="admin-row-side">登录于 ${fmtRel(s.created_at)}</span>
      <button class="admin-mini-btn danger" type="button" data-act="revoke-session" data-sid="${s.sid}" aria-label="吊销会话">吊销</button>
    </div>`).join('');
}

// ---------- 审计 ----------
function renderAudit(list) {
  $('adminAuditSub').textContent = `近 ${list.length} 条`;
  if (!list.length) { $('adminAudit').innerHTML = '<p class="admin-empty">暂无操作记录</p>'; return; }
  $('adminAudit').innerHTML = list.map((a) => `
    <div class="admin-audit-row">
      <span class="admin-audit-time">${fmtRel(a.created_at)}</span>
      <span class="admin-audit-text"><strong>${esc(a.actor_name)}</strong> ${esc(ACTION_LABEL[a.action] || a.action)}${a.target_name ? ` <em>${esc(a.target_name)}</em>` : ''}${a.detail ? ` · ${esc(a.detail)}` : ''}</span>
    </div>`).join('');
}

// ---------- 用户控制台 ----------
function renderToolbar() {
  if (toolbarReady) return;
  $('adminToolbar').innerHTML = `
    <label class="admin-search">
      <span class="icn" data-icon="search" data-size="15" aria-hidden="true"></span>
      <input id="userSearch" type="search" placeholder="搜索用户名" autocomplete="off">
    </label>
    <select id="filterRole" class="admin-select" aria-label="角色筛选">
      <option value="">全部角色</option><option value="admin">管理员</option><option value="user">普通用户</option>
    </select>
    <select id="filterStatus" class="admin-select" aria-label="状态筛选">
      <option value="">全部状态</option><option value="active">正常</option><option value="disabled">已禁用</option><option value="never">从未登录</option>
    </select>
    <select id="sortSel" class="admin-select" aria-label="排序">
      <option value="id:asc">ID ↑</option>
      <option value="created_at:desc">最新注册</option>
      <option value="created_at:asc">最早注册</option>
      <option value="last_seen:desc">最近活跃</option>
      <option value="username:asc">用户名 A→Z</option>
    </select>
    <button class="admin-tool-btn primary" type="button" data-act="create-user">新建用户</button>
    <button class="admin-tool-btn" type="button" data-act="export-csv">导出 CSV</button>`;
  hydrateIcons($('adminToolbar'));

  let timer = null;
  $('userSearch').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; loadUsers(); }, 300);
  });
  $('filterRole').addEventListener('change', (e) => { state.role = e.target.value; state.page = 1; loadUsers(); });
  $('filterStatus').addEventListener('change', (e) => { state.status = e.target.value; state.page = 1; loadUsers(); });
  $('sortSel').addEventListener('change', (e) => {
    const [sort, dir] = e.target.value.split(':');
    state.sort = sort; state.dir = dir; state.page = 1; loadUsers();
  });
  toolbarReady = true;
}

function roleBadge(role) {
  return `<span class="admin-role${role === 'admin' ? ' is-admin' : ''}">${role === 'admin' ? '管理员' : '用户'}</span>`;
}
function renderUserTable(resp) {
  const meId = getUser()?.id;
  const head = '<thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>创建</th><th>最近活跃</th><th></th></tr></thead>';
  const list = resp.users || [];
  if (!list.length) {
    $('adminUsers').innerHTML = `${head}<tbody><tr><td colspan="6" class="admin-empty">没有匹配的用户</td></tr></tbody>`;
    $('adminPager').innerHTML = '';
    return;
  }
  const rows = list.map((u) => `
    <tr data-act="open-user" data-id="${u.id}" tabindex="0">
      <td class="col-user">${esc(u.username)}${u.id === meId ? ' <span class="admin-self">本人</span>' : ''}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${u.disabled ? '<span class="admin-state-off">已禁用</span>' : '<span class="admin-state-ok">正常</span>'}</td>
      <td class="mono">${fmtDate(u.created_at)}</td>
      <td class="mono">${fmtRel(u.last_seen)}</td>
      <td><button class="admin-mini-btn" type="button" data-act="open-user" data-id="${u.id}">详情</button></td>
    </tr>`).join('');
  $('adminUsers').innerHTML = `${head}<tbody>${rows}</tbody>`;

  const pages = Math.max(1, Math.ceil(resp.total / resp.pageSize));
  $('adminPager').innerHTML = `
    <button class="admin-mini-btn" type="button" data-act="page-prev" ${resp.page <= 1 ? 'disabled' : ''}>← 上一页</button>
    <span class="admin-pager-info">第 ${resp.page} / ${pages} 页 · 共 ${resp.total} 人</span>
    <button class="admin-mini-btn" type="button" data-act="page-next" ${resp.page >= pages ? 'disabled' : ''}>下一页 →</button>`;
}

async function loadUsers() {
  const qs = new URLSearchParams({
    q: state.q, role: state.role, status: state.status,
    sort: state.sort, dir: state.dir, page: state.page, pageSize: state.pageSize,
  }).toString();
  const r = await api('GET', `/admin/users?${qs}`);
  if (r.ok) renderUserTable(r.json);
  else toast(r.json?.error?.message || '加载用户失败', { type: 'error' });
}

// ---------- 下钻抽屉 ----------
function metaRow(label, value) {
  return `<div class="drawer-meta"><span class="drawer-meta-label">${label}</span><span class="drawer-meta-val">${value}</span></div>`;
}
function renderDrawer(detail) {
  const u = detail.user;
  const isSelf = u.id === getUser()?.id;
  const courses = detail.courses || [];
  const courseRows = courses.length
    ? courses.map((c) => `
        <div class="admin-row">
          <div class="admin-row-main">
            <span class="admin-row-title mono">${c.course_id === '__global__' ? '（站点级）' : esc(c.course_id)}</span>
            <span class="admin-row-meta">${c.slots} 项 · ${fmtBytes(c.bytes)} · ${fmtRel(c.lastActivity)}</span>
          </div>
          <button class="admin-mini-btn danger" type="button" data-act="reset-course" data-course="${esc(c.course_id)}">清空</button>
        </div>`).join('')
    : '<p class="admin-empty">无同步数据</p>';

  $('adminDrawer').innerHTML = `
    <div class="drawer-head">
      <div>
        <div class="drawer-title">${esc(u.username)} ${roleBadge(u.role)}</div>
        <div class="drawer-sub">ID ${u.id}${isSelf ? ' · 当前账户' : ''}</div>
      </div>
      <button class="admin-icon-btn" type="button" data-act="close-drawer" aria-label="关闭">${icon('x', { size: 18 })}</button>
    </div>
    <div class="drawer-metas">
      ${metaRow('状态', u.disabled ? '<span class="admin-state-off">已禁用</span>' : '<span class="admin-state-ok">正常</span>')}
      ${metaRow('创建', fmtDate(u.created_at))}
      ${metaRow('最近活跃', fmtRel(u.last_seen))}
      ${metaRow('有效会话', `${detail.sessionCount} 个`)}
    </div>
    <div class="drawer-actions">
      ${isSelf ? '' : `<button class="admin-tool-btn" type="button" data-act="toggle-disable" data-on="${u.disabled ? 1 : 0}">${u.disabled ? '启用' : '禁用'}</button>`}
      ${isSelf ? '' : `<button class="admin-tool-btn" type="button" data-act="toggle-role" data-role="${esc(u.role)}">${u.role === 'admin' ? '降为用户' : '设为管理员'}</button>`}
      <button class="admin-tool-btn" type="button" data-act="rename">改名</button>
      <button class="admin-tool-btn" type="button" data-act="reset-pw">重置密码</button>
      <button class="admin-tool-btn" type="button" data-act="force-logout">强制下线</button>
      ${isSelf ? '' : `<button class="admin-tool-btn danger" type="button" data-act="delete-user">删除用户</button>`}
    </div>
    <div class="drawer-section-title">同步数据 <button class="admin-mini-btn danger" type="button" data-act="reset-all">清空全部</button></div>
    <div class="drawer-courses">${courseRows}</div>`;
}

async function openDrawer(id) {
  const r = await api('GET', `/admin/users/${id}`);
  if (!r.ok) { toast(r.json?.error?.message || '加载用户详情失败', { type: 'error' }); return; }
  drawerUserId = id;
  renderDrawer(r.json);
  $('drawerOverlay').hidden = false;
  $('adminDrawer').hidden = false;
  void $('adminDrawer').offsetWidth;   // 强制回流:先提交初始(移出屏幕)状态,再过渡滑入(不依赖 rAF,后台标签页也可靠)
  $('adminDrawer').classList.add('open');
  $('drawerOverlay').classList.add('show');
  $('adminDrawer').focus();
}
function closeDrawer() {
  drawerUserId = null;
  $('adminDrawer').classList.remove('open');
  $('drawerOverlay').classList.remove('show');
  setTimeout(() => { $('adminDrawer').hidden = true; $('drawerOverlay').hidden = true; }, 200);
}

// ---------- 建号弹窗 ----------
function openModal() {
  $('adminModal').classList.remove('admin-course-modal');
  $('adminModal').setAttribute('aria-label', '新建用户');
  $('adminModal').innerHTML = `
    <button class="admin-icon-btn admin-modal-close" type="button" data-act="close-modal" aria-label="关闭">${icon('x', { size: 18 })}</button>
    <p class="auth-eyebrow">管理员建号</p>
    <h3 class="admin-modal-title">新建用户</h3>
    <form class="admin-form" id="createForm">
      <label>用户名<input name="username" type="text" autocomplete="off" required></label>
      <label>初始密码<input name="password" type="text" autocomplete="off" placeholder="≥ 8 位" required></label>
      <label>角色
        <select name="role" class="admin-select">
          <option value="user">普通用户</option><option value="admin">管理员</option>
        </select>
      </label>
      <p class="admin-form-msg" id="createMsg"></p>
      <button class="admin-tool-btn primary" type="submit">创建</button>
    </form>`;
  $('modalOverlay').hidden = false;
  void $('modalOverlay').offsetWidth;
  $('modalOverlay').classList.add('show');
  $('createForm').addEventListener('submit', submitCreate);
  $('adminModal').querySelector('input[name=username]').focus();
}
function closeModal() {
  $('modalOverlay').classList.remove('show');
  courseEditorRequestToken += 1;
  if (courseEditorState?.previewObjectUrl) URL.revokeObjectURL(courseEditorState.previewObjectUrl);
  courseEditorState = null;
  setTimeout(() => { $('modalOverlay').hidden = true; }, 200);
}
async function submitCreate(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  const r = await api('POST', '/admin/users', {
    username: String(fd.get('username') || '').trim(),
    password: String(fd.get('password') || ''),
    role: fd.get('role'),
  });
  if (r.ok) { toast('已创建用户', { type: 'success' }); closeModal(); await loadAll(); }
  else { $('createMsg').textContent = r.json?.error?.message || '创建失败'; btn.disabled = false; }
}

function courseDisplayPreview(kind, value) {
  const image = value.cover_image || value.coverDataUrl || '';
  const coverText = value.cover_text || value.coverText || Array.from(value.title || '')[0] || '课';
  return `<section class="admin-course-preview" data-preview="${escAttr(kind)}">
    <p class="admin-preview-label">${kind === 'original' ? '原始展示' : '当前展示'}</p>
    <div class="admin-preview-cover${image ? ' has-image' : ''}"${image ? ` data-preview-cover-url="${escAttr(image)}"` : ''}>
      ${image ? '' : `<span data-preview-cover-text>${esc(coverText)}</span>`}
    </div>
    <div class="admin-preview-copy">
      <strong data-preview-title>${esc(value.title || '')}</strong>
      <span data-preview-subtitle>${esc(value.subtitle || '')}</span>
      ${kind === 'current' ? `
        <span data-preview-publisher>${esc(value.publisher_name || '未设置发布人')}</span>
        <span data-preview-category>${esc(value.category || '未分类')}</span>
        <span data-preview-visibility>${value.visible ? '公开可见' : '已隐藏'}</span>` : `
        <span data-preview-author>${esc(value.author || '未署名')}</span>`}
      <p data-preview-description>${esc(value.description || '')}</p>
    </div>
  </section>`;
}

function hydrateCoursePreviewImages(root) {
  root.querySelectorAll('[data-preview-cover-url]').forEach((cover) => {
    cover.style.backgroundImage = `url(${JSON.stringify(cover.dataset.previewCoverUrl)})`;
  });
}

function currentCourseDisplay(form) {
  const data = new FormData(form);
  const original = courseEditorState.original;
  const current = courseEditorState.current;
  const mode = String(data.get('coverMode') || 'default');
  const resolved = resolveCourseCover({
    title: String(data.get('title') || '').trim(),
    baseImage: original.cover_image || '',
    baseText: original.cover_text || '',
    mode,
    image: courseEditorState.previewObjectUrl || current.cover_image || '',
    text: String(data.get('coverText') || '').trim(),
  });
  return {
    title: String(data.get('title') || '').trim(),
    subtitle: String(data.get('subtitle') || '').trim(),
    publisher_name: String(data.get('publisherName') || '').trim(),
    category: String(data.get('category') || '').trim(),
    visible: form.elements.visible.checked,
    description: String(data.get('description') || '').trim(),
    cover_image: resolved.coverUrl,
    cover_text: resolved.coverText,
  };
}

function updateCourseEditorPreview(form) {
  const coverMode = String(new FormData(form).get('coverMode') || 'default');
  form.querySelector('[data-cover-panel="image"]').hidden = coverMode !== 'image';
  form.querySelector('[data-cover-panel="text"]').hidden = coverMode !== 'text';
  const coverTextInput = form.elements.coverText;
  const textLength = Array.from(coverTextInput.value.trim()).length;
  $('coverTextCount').textContent = `${textLength} / 6`;
  coverTextInput.setCustomValidity(
    coverMode === 'text' && (textLength < 1 || textLength > 6) ? '文字封面须为 1–6 个字符' : '',
  );
  $('adminModal').querySelector('[data-preview="current"]').outerHTML = courseDisplayPreview('current', currentCourseDisplay(form));
  hydrateCoursePreviewImages($('adminModal'));
}

function renderCourseEditor() {
  const { current, original } = courseEditorState;
  $('adminModal').classList.add('admin-course-modal');
  $('adminModal').setAttribute('aria-label', `编辑课程：${current.title}`);
  const categories = ['<option value="">未分类</option>', ...COURSE_CATEGORIES.map((category) => (
    `<option value="${escAttr(category)}"${current.category === category ? ' selected' : ''}>${esc(category)}</option>`
  ))].join('');
  const coverMode = current.cover_mode || 'default';
  $('adminModal').innerHTML = `
    <button class="admin-icon-btn admin-modal-close" type="button" data-act="close-modal" aria-label="关闭">${icon('x', { size: 18 })}</button>
    <p class="auth-eyebrow">课程管理</p>
    <h3 class="admin-modal-title">编辑课程展示</h3>
    <div class="admin-course-previews">
      ${courseDisplayPreview('original', original)}
      ${courseDisplayPreview('current', {
        ...current,
        cover_image: current.coverDataUrl || '',
        cover_text: current.coverText || '',
      })}
    </div>
    <form class="admin-form admin-course-form" id="courseEditForm">
      <label>标题<input name="title" type="text" maxlength="120" value="${escAttr(current.title)}" required></label>
      <label>副标题<input name="subtitle" type="text" maxlength="180" value="${escAttr(current.subtitle || '')}"></label>
      <label>分类<select name="category" class="admin-select">${categories}</select></label>
      <label>发布人（平台）<input name="publisherName" type="text" maxlength="120" value="${escAttr(current.publisher_name || '')}" required></label>
      <label class="admin-form-wide">作者（内容署名）<input name="author" type="text" maxlength="120" value="${escAttr(current.author || '')}"></label>
      <label class="admin-form-wide">简介<textarea name="description" maxlength="2000" rows="5">${esc(current.description || '')}</textarea></label>
      <label class="admin-visibility-toggle admin-form-wide"><input name="visible" type="checkbox"${current.visible === false ? '' : ' checked'}>课程可见</label>
      <fieldset class="admin-cover-fieldset admin-form-wide">
        <legend>封面展示</legend>
        <div class="admin-cover-segments">
          <label><input name="coverMode" type="radio" value="default"${coverMode === 'default' ? ' checked' : ''}>原封面</label>
          <label><input name="coverMode" type="radio" value="image"${coverMode === 'image' ? ' checked' : ''}>图片</label>
          <label><input name="coverMode" type="radio" value="text"${coverMode === 'text' ? ' checked' : ''}>文字</label>
        </div>
        <label data-cover-panel="image">图片封面<input name="coverImage" type="file" accept="image/png,image/jpeg,image/webp"></label>
        <label data-cover-panel="text">文字封面<input name="coverText" type="text" value="${escAttr(current.cover_text || '')}" aria-describedby="coverTextCount"></label>
        <span id="coverTextCount" class="admin-cover-count" aria-live="polite">0 / 6</span>
      </fieldset>
      <p class="admin-form-msg admin-form-wide" id="courseEditMsg"></p>
      <div class="admin-form-actions admin-form-wide">
        <button class="admin-tool-btn" type="button" data-act="close-modal">取消</button>
        <button class="admin-tool-btn primary" type="submit">保存修改</button>
      </div>
    </form>`;
  const form = $('courseEditForm');
  form.addEventListener('submit', submitCourseEdit);
  form.addEventListener('input', () => updateCourseEditorPreview(form));
  form.addEventListener('change', (event) => {
    if (event.target === form.elements.coverImage) {
      if (courseEditorState.previewObjectUrl) URL.revokeObjectURL(courseEditorState.previewObjectUrl);
      courseEditorState.selectedImage = form.elements.coverImage.files?.[0] || null;
      courseEditorState.previewObjectUrl = courseEditorState.selectedImage
        ? URL.createObjectURL(courseEditorState.selectedImage)
        : '';
    }
    updateCourseEditorPreview(form);
  });
  updateCourseEditorPreview(form);
  form.elements.title.focus();
}

async function openCourseModal(course) {
  const requestToken = ++courseEditorRequestToken;
  $('adminModal').classList.add('admin-course-modal');
  $('adminModal').setAttribute('aria-label', `编辑课程：${course.title}`);
  $('adminModal').innerHTML = `
    <button class="admin-icon-btn admin-modal-close" type="button" data-act="close-modal" aria-label="关闭">${icon('x', { size: 18 })}</button>
    <p class="admin-empty">正在加载课程展示信息…</p>`;
  $('modalOverlay').hidden = false;
  void $('modalOverlay').offsetWidth;
  $('modalOverlay').classList.add('show');

  let original = course.original;
  let current = course;
  if (course.id) {
    const response = await api('GET', `/admin/courses/${encodeURIComponent(course.ref)}`);
    if (requestToken !== courseEditorRequestToken) return;
    if (!response.ok || !response.json?.original) {
      toast(response.json?.error?.message || '加载课程详情失败', { type: 'error' });
      closeModal();
      return;
    }
    original = response.json.original;
    current = {
      ...course,
      ...response.json.course,
      ref: course.ref,
      visible: response.json.course.visible !== 0,
      cover_mode: response.json.course.cover_mode || 'default',
      cover_image: response.json.course.cover_image || '',
      cover_text: response.json.course.cover_text || '',
    };
  }
  courseEditorState = {
    ref: course.ref,
    original,
    current,
    selectedImage: null,
    previewObjectUrl: '',
  };
  renderCourseEditor();
}

async function submitCourseEdit(event) {
  event.preventDefault();
  const editorState = courseEditorState;
  const requestToken = courseEditorRequestToken;
  const ref = editorState?.ref;
  if (!ref) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const controls = [...form.querySelectorAll('input, select, textarea, button')];
  controls.forEach((control) => { control.disabled = true; });
  const payload = new FormData();
  for (const name of ['title', 'subtitle', 'category', 'publisherName', 'author', 'description']) {
    payload.set(name, String(data.get(name) || '').trim());
  }
  payload.set('visible', form.elements.visible.checked ? 'true' : 'false');
  const coverMode = String(data.get('coverMode') || 'default');
  payload.set('coverMode', coverMode);
  payload.set('coverText', String(data.get('coverText') || '').trim());
  const image = data.get('coverImage');
  if (coverMode === 'image' && image instanceof File && image.size > 0) payload.set('coverImage', image);
  const response = await apiForm('PATCH', `/admin/courses/${encodeURIComponent(ref)}`, payload);
  if (courseEditorState !== editorState || courseEditorRequestToken !== requestToken || courseEditorState?.ref !== ref) return;
  if (!response.ok) {
    $('courseEditMsg').textContent = response.json?.error?.message || '保存失败';
    controls.forEach((control) => { control.disabled = false; });
    return;
  }
  toast('课程展示信息已更新', { type: 'success' });
  closeModal();
  await loadAll();
}

// ---------- CSV 导出 ----------
async function exportCsv() {
  const qs = new URLSearchParams({ q: state.q, role: state.role, status: state.status, sort: state.sort, dir: state.dir, page: 1, pageSize: 1000 }).toString();
  const r = await api('GET', `/admin/users?${qs}`);
  if (!r.ok) { toast('导出失败', { type: 'error' }); return; }
  const head = ['id', 'username', 'role', 'disabled', 'created_at', 'last_seen'];
  const lines = [head.join(',')].concat((r.json.users || []).map((u) => [
    u.id, `"${String(u.username).replace(/"/g, '""')}"`, u.role, u.disabled,
    u.created_at ? new Date(u.created_at).toISOString() : '',
    u.last_seen ? new Date(u.last_seen).toISOString() : '',
  ].join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pigeonlib-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('已导出 CSV', { type: 'success' });
}

// ---------- 动作执行 ----------
async function runAction(btn, method, path, payload, okMsg) {
  if (btn) btn.disabled = true;
  const r = await api(method, path, payload);
  if (r.ok || r.status === 204) {
    toast(okMsg, { type: 'success' });
    await loadAll();
    if (drawerUserId) await openDrawer(drawerUserId);
    return true;
  }
  toast(r.json?.error?.message || '操作失败', { type: 'error' });
  if (btn) btn.disabled = false;
  return false;
}

// ---------- 加载全部 ----------
function renderLoading() {
  gate.hidden = true;
  body.hidden = false;
  $('adminStats').innerHTML = ['用户总数', '活跃 · 7日', '管理员', '从未登录', '有效会话', '同步行', '课程数', '数据库']
    .map((l) => `<div class="admin-stat"><div class="admin-stat-label">${l}</div><div class="admin-stat-value admin-stat-loading">···</div></div>`).join('');
}
async function loadAll() {
  renderLoading();
  const [stats, users, trends, courses, sessions, audit, pending, allCourses] = await Promise.all([
    api('GET', '/admin/stats'),
    api('GET', `/admin/users?${new URLSearchParams({ q: state.q, role: state.role, status: state.status, sort: state.sort, dir: state.dir, page: state.page, pageSize: state.pageSize })}`),
    api('GET', '/admin/trends?days=14'),
    api('GET', '/admin/courses'),
    api('GET', '/admin/sessions'),
    api('GET', '/admin/audit?limit=40'),
    api('GET', '/admin/courses/pending'),
    api('GET', '/admin/courses'),
  ]);
  if (!stats.ok || !users.ok) {
    renderGate('加载管理数据失败,请确认后端已启动且你具备管理员权限。', false);
    return;
  }
  gate.hidden = true; body.hidden = false;
  renderToolbar();
  renderStats(stats.json);
  if (trends.ok) renderTrends(trends.json);
  if (courses.ok) renderCourses(courses.json.courses || []);
  if (sessions.ok) renderSessions(sessions.json.sessions || []);
  if (pending.ok) renderPending(pending.json.items || []);
  if (allCourses.ok) renderAllCourses(allCourses.json.courses || [], allCourses.json.builtinOverrides || []);
  renderUserTable(users.json);
  if (audit.ok) renderAudit(audit.json.entries || []);
}

// ---------- 事件 ----------
function userRowName() {
  return document.querySelector(`tr[data-id="${drawerUserId}"] .col-user`)?.textContent?.replace('本人', '').trim() || '该用户';
}

function bindEvents() {
  document.addEventListener('click', async (e) => {
    const themeBtn = e.target.closest('[data-action="toggle-theme"]');
    if (themeBtn) { toggleTheme(); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const act = el.dataset.act;

    if (act === 'open-user') { openDrawer(Number(el.dataset.id)); return; }
    if (act === 'close-drawer') { closeDrawer(); return; }
    if (act === 'close-modal') { closeModal(); return; }
    if (act === 'create-user') { openModal(); return; }
    if (act === 'export-csv') { exportCsv(); return; }
    if (act === 'page-prev') { state.page = Math.max(1, state.page - 1); loadUsers(); return; }
    if (act === 'page-next') { state.page += 1; loadUsers(); return; }

    if (act === 'edit-course') {
      const course = adminCourseRows[Number(el.dataset.courseIdx)];
      if (course) openCourseModal(course);
      return;
    }
    if (act === 'delete-course') {
      const course = adminCourseRows[Number(el.dataset.courseIdx)];
      if (!course) return;
      const detail = course.status === 'builtin'
        ? '该课程将从在线课程列表隐藏；离线默认包仍会保留。'
        : '课程记录和已上传文件都将删除，此操作不可恢复。';
      if (!confirm(`删除《${course.title}》？${detail}`)) return;
      el.disabled = true;
      const response = await api('DELETE', `/admin/courses/${encodeURIComponent(course.ref)}`);
      if (!response.ok) {
        toast(response.json?.error?.message || '删除课程失败', { type: 'error' });
        el.disabled = false;
        return;
      }
      toast('课程已删除', { type: 'success' });
      await loadAll();
      return;
    }

    if (act === 'revoke-session') {
      const sid = Number(el.dataset.sid);
      if (!confirm('吊销该会话?对应设备将需要重新登录。')) return;
      runAction(el, 'DELETE', `/admin/sessions/${sid}`, undefined, '已吊销会话');
      return;
    }

    // 课程审核动作(不依赖抽屉)
    if (act === 'preview-course') {
      const key = el.dataset.key; const cid = el.dataset.cid; const vid = el.dataset.vid;
      const v = vid ? `&v=${vid}` : '';
      window.open(`/learn.html?course=${encodeURIComponent(key)}&src=${cid}${v}&preview=1`, '_blank');
      return;
    }
    if (act === 'approve-course') {
      if (!confirm(`通过《${el.dataset.title}》并发布到课程广场?`)) return;
      runAction(el, 'POST', `/admin/courses/${el.dataset.cid}/versions/${el.dataset.vid}/approve`, {}, '已通过并发布');
      return;
    }
    if (act === 'reject-course') {
      const note = prompt(`拒绝《${el.dataset.title}》的理由(可留空):`, '');
      if (note === null) return;
      runAction(el, 'POST', `/admin/courses/${el.dataset.cid}/versions/${el.dataset.vid}/reject`, { note }, '已拒绝该版本');
      return;
    }
    if (act === 'takedown-course') {
      if (!confirm(`将《${el.dataset.title}》从课程广场下架?`)) return;
      runAction(el, 'POST', `/admin/courses/${el.dataset.cid}/takedown`, {}, '已下架');
      return;
    }

    // 以下为抽屉内针对 drawerUserId 的操作
    const id = drawerUserId;
    if (!id) return;
    const name = userRowName();
    if (act === 'toggle-disable') {
      const willDisable = el.dataset.on !== '1';
      if (willDisable && !confirm(`禁用「${name}」?对方将无法登录。`)) return;
      runAction(el, 'PATCH', `/admin/users/${id}`, { disabled: willDisable }, '已更新账户状态');
    } else if (act === 'toggle-role') {
      const next = el.dataset.role === 'admin' ? 'user' : 'admin';
      if (next === 'user' && !confirm(`将「${name}」降为普通用户?对方将失去管理权限。`)) return;
      runAction(el, 'PATCH', `/admin/users/${id}`, { role: next }, '已更新角色');
    } else if (act === 'rename') {
      const username = prompt('新用户名(3–32 个非空白字符):', name);
      if (username == null) return;
      runAction(el, 'PATCH', `/admin/users/${id}`, { username: username.trim() }, '已改名');
    } else if (act === 'reset-pw') {
      const pw = prompt(`为「${name}」设置新密码(≥8 位):`);
      if (pw == null) return;
      if (pw.length < 8) { toast('密码至少 8 位', { type: 'error' }); return; }
      runAction(el, 'PATCH', `/admin/users/${id}`, { resetPassword: pw }, '已重置密码');
    } else if (act === 'force-logout') {
      if (!confirm(`强制「${name}」下线?其全部会话将失效。`)) return;
      runAction(el, 'POST', `/admin/users/${id}/logout`, {}, '已强制下线');
    } else if (act === 'reset-course') {
      const course = el.dataset.course;
      if (!confirm(`清空「${name}」在该课程的同步数据?不可恢复。`)) return;
      runAction(el, 'DELETE', `/admin/users/${id}/state?course=${encodeURIComponent(course)}`, undefined, '已清空该课进度');
    } else if (act === 'reset-all') {
      if (!confirm(`清空「${name}」的全部同步数据?不可恢复。`)) return;
      runAction(el, 'DELETE', `/admin/users/${id}/state?course=all`, undefined, '已清空全部进度');
    } else if (act === 'delete-user') {
      if (!confirm(`彻底删除「${name}」?其账户、会话与全部同步数据都将被清除,不可恢复。`)) return;
      const ok = await runAction(el, 'DELETE', `/admin/users/${id}`, undefined, '已删除用户');
      if (ok) closeDrawer();
    }
  });

  $('drawerOverlay').addEventListener('click', closeDrawer);
  $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('modalOverlay').hidden) closeModal();
    else if (!$('adminDrawer').hidden) closeDrawer();
  });
}

// ---------- 启动 ----------
async function main() {
  hydrateIcons();
  bindEvents();
  await initSession();
  initAuthUI($('accountSlot'));
  if (!getUser()) { renderGate('管理面板需要登录管理员账户。', true); return; }
  if (!isAdmin()) { renderGate('当前账户没有管理员权限。', false); return; }
  await loadAll();
}

main().catch((err) => {
  console.error(err);
  renderGate('加载失败:' + (err?.message || err), false);
});
