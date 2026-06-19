// main-profile.js — 个人主页(创作者中心):我创作的课程 + 聚合学习数据 + 版本列表;我的书架 + 学习情况。
// 隐私铁律:学习数据只展示聚合数字(来自服务端 analytics),绝不含任何可定位个体的信息。
import { applyInitialTheme, toggleTheme } from './core/theme.js';
import { hydrateIcons, icon } from './core/icons.js';
import { createStore } from './core/store.js';
import { initSession, getUser, isLoggedIn } from './core/session.js';
import { initAuthUI, promptLogin } from './core/auth-ui.js';
import { toast } from './core/toast.js';
import {
  listMine, courseAnalytics, listVersions, listSquare, listBookshelf, removeFromShelf,
} from './core/course-source.js';
import { BUILTIN_COURSES } from './core/course-registry.js';

applyInitialTheme();

const STATUS_LABEL = { private: '私有', pending: '审核中', published: '已发布', rejected: '被拒' };
const ROLE_LABEL = { admin: '管理员', user: '普通用户' };

const state = { tab: 'creator', creator: [], shelf: [] };

const el = {
  head: document.getElementById('profileHead'),
  tabs: [...document.querySelectorAll('.profile-tab')],
  panelCreator: document.getElementById('panelCreator'),
  panelShelf: document.getElementById('panelShelf'),
  creatorGrid: document.getElementById('creatorGrid'),
  shelfGrid: document.getElementById('shelfGrid'),
};

function esc(value) {
  return (value == null ? '' : String(value)).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDuration(ms) {
  const m = Math.round((Number(ms) || 0) / 60000);
  if (m <= 0) return '0 分钟';
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function localProgress(courseKey) {
  const store = createStore(courseKey);
  const progress = store.get('progress', {});
  const values = Object.values(progress || {});
  const mastered = values.filter((v) => v === 'mastered').length;
  const studyMs = store.get('studyTime', 0);
  return { mastered, total: values.length, studyMs };
}

function renderHead() {
  const user = getUser();
  const letter = user ? user.username.slice(0, 1).toUpperCase() : '?';
  el.head.innerHTML = `
    <div class="profile-avatar" aria-hidden="true">${esc(letter)}</div>
    <div class="profile-id">
      <h1>${esc(user ? user.username : '未登录')}</h1>
      <span class="account-role">${esc(user ? (ROLE_LABEL[user.role] || user.role) : '访客')}</span>
    </div>
    <p class="profile-sub">创作者中心 · 课程学习数据与书架(学习数据均为聚合统计,不含任何个人身份信息)</p>`;
}

// ---------- 我创作的 ----------
function analyticsRow(a) {
  if (!a) return '<p class="analytics-empty">暂无学习数据</p>';
  return `
    <div class="analytics-row">
      <span class="metric"><span class="metric-num">${a.learners}</span> 学习人数</span>
      <span class="metric"><span class="metric-num">${fmtDuration(a.totalStudyMs)}</span> 累计学习</span>
      <span class="metric"><span class="metric-num">${fmtDuration(a.avgStudyMs)}</span> 人均</span>
      <span class="metric"><span class="metric-num">${a.active7d}</span> 近7天活跃</span>
    </div>`;
}

function versionRows(versions) {
  if (!versions || !versions.length) return '';
  const rows = versions.map((v) => `
    <li class="version-row">
      <span class="version-tag">v${esc(v.version || '—')}</span>
      <span class="status-badge status-${esc(v.status)}">${esc(STATUS_LABEL[v.status] || v.status)}</span>
      <span class="version-date">${fmtDate(v.created_at)}</span>
    </li>`).join('');
  return `<details class="version-box"><summary>版本记录(${versions.length})</summary><ul class="version-list">${rows}</ul></details>`;
}

function creatorCard({ course, analytics, versions }) {
  const s = course.stats || {};
  const cover = course.coverDataUrl || '';
  const article = document.createElement('article');
  article.className = 'profile-card';
  article.innerHTML = `
    <div class="profile-card-top">
      <div class="profile-cover ${cover ? 'has-image' : ''}" aria-hidden="true">${cover ? '' : `<span>${esc(course.title.slice(0, 1))}</span>`}</div>
      <div class="profile-card-id">
        <span class="status-badge status-${esc(course.status)}">${esc(STATUS_LABEL[course.status] || course.status)}</span>
        <h3>${esc(course.title)}</h3>
        <p class="profile-card-sub">${esc(course.subtitle || '')}</p>
        <p class="course-stats"><span>${icon('book', { size: 13 })} ${s.chapters || 0} 章</span> <span>${icon('bookmark', { size: 13 })} ${s.knowledgePoints || 0} 知识点</span> <span>${icon('square-pen', { size: 13 })} ${s.questions || 0} 题</span></p>
      </div>
    </div>
    <p class="analytics-title">${icon('users', { size: 14 })} 学习数据(聚合)</p>
    ${analyticsRow(analytics)}
    ${versionRows(versions)}
    <a class="study-link" href="/learn.html?course=${encodeURIComponent(course.courseKey)}&src=${course.serverId}">查看课程 ▸</a>`;
  if (cover) article.querySelector('.profile-cover').style.backgroundImage = `url("${cover}")`;
  return article;
}

function renderCreator() {
  if (!state.creator.length) {
    el.creatorGrid.replaceChildren(emptyCard('你还没有创作课程。到首页「我的课程」上传一个 .pigeon 开始。'));
    return;
  }
  el.creatorGrid.replaceChildren(...state.creator.map((d, i) => {
    const card = creatorCard(d);
    card.style.animationDelay = `${i * 60}ms`;
    return card;
  }));
}

// ---------- 我的书架 ----------
function shelfCard(item) {
  const meta = item.meta;
  const title = meta?.title || item.key;
  const prog = localProgress(item.key);
  const pct = prog.total ? Math.round((prog.mastered / prog.total) * 100) : 0;
  const href = meta?.source === 'server' && meta.serverId
    ? `/learn.html?course=${encodeURIComponent(item.key)}&src=${meta.serverId}`
    : `/learn.html?course=${encodeURIComponent(item.key)}`;
  const article = document.createElement('article');
  article.className = 'profile-card';
  article.dataset.key = item.key;
  article.innerHTML = `
    <div class="profile-card-top">
      <div class="profile-cover ${meta?.coverDataUrl ? 'has-image' : ''}" aria-hidden="true">${meta?.coverDataUrl ? '' : `<span>${esc(title.slice(0, 1))}</span>`}</div>
      <div class="profile-card-id">
        ${meta?.publisherName ? `<span class="course-badge">${esc(meta.publisherName)}</span>` : ''}
        <h3>${esc(title)}</h3>
        <p class="profile-card-sub">${esc(meta?.subtitle || '')}</p>
        <p class="shelf-added">加入于 ${fmtDate(item.addedAt)}</p>
      </div>
    </div>
    <div class="shelf-progress">
      ${prog.total ? `<div class="course-progress"><span style="width:${pct}%"></span></div><p class="progress-text">已掌握 ${prog.mastered}/${prog.total} · ${pct}% · 已学 ${fmtDuration(prog.studyMs)}</p>` : '<p class="progress-text">尚未开始学习</p>'}
    </div>
    <div class="course-card-foot">
      <a class="study-link" href="${href}">${prog.total ? '继续学习 ▸' : '开始学习 ▸'}</a>
      <button class="card-act card-act-danger" type="button" data-action="unshelf" title="移出书架" aria-label="移出书架">${icon('trash-2', { size: 15 })}</button>
    </div>`;
  if (meta?.coverDataUrl) article.querySelector('.profile-cover').style.backgroundImage = `url("${meta.coverDataUrl}")`;
  return article;
}

function renderShelf() {
  if (!state.shelf.length) {
    el.shelfGrid.replaceChildren(emptyCard('书架还是空的。在课程广场的课程详情里点「加入书架」。'));
    return;
  }
  el.shelfGrid.replaceChildren(...state.shelf.map((item, i) => {
    const card = shelfCard(item);
    card.style.animationDelay = `${i * 60}ms`;
    return card;
  }));
}

function emptyCard(message) {
  const div = document.createElement('div');
  div.className = 'empty-card';
  div.textContent = message;
  return div;
}

// ---------- 数据加载 ----------
async function loadCreator() {
  const { items } = await listMine();
  state.creator = await Promise.all(items.map(async (course) => {
    const [analytics, versions] = await Promise.all([
      courseAnalytics(course.serverId),
      listVersions(course.serverId),
    ]);
    return { course, analytics, versions };
  }));
}

async function loadShelf() {
  const [shelf, square] = await Promise.all([listBookshelf(), listSquare({ pageSize: 100 })]);
  const metaByKey = new Map();
  for (const c of square.items) metaByKey.set(c.courseKey, c);
  for (const b of BUILTIN_COURSES) {
    if (!metaByKey.has(b.id)) metaByKey.set(b.id, { courseKey: b.id, title: b.title, subtitle: b.subtitle || '', source: 'builtin' });
  }
  state.shelf = shelf.map((s) => ({ key: s.course_key, addedAt: s.added_at, meta: metaByKey.get(s.course_key) || null }));
}

// ---------- Tab ----------
function switchTab(tab) {
  state.tab = tab;
  el.tabs.forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', String(active));
  });
  el.panelCreator.hidden = tab !== 'creator';
  el.panelShelf.hidden = tab !== 'shelf';
}

function bindEvents() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="toggle-theme"]')) return toggleTheme();
    const tab = e.target.closest('.profile-tab');
    if (tab) return switchTab(tab.dataset.tab);
  });
  el.shelfGrid.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="unshelf"]');
    if (!btn) return;
    const key = btn.closest('.profile-card')?.dataset.key;
    if (!key) return;
    const r = await removeFromShelf(key);
    if (r.ok) {
      state.shelf = state.shelf.filter((s) => s.key !== key);
      renderShelf();
      toast('已移出书架', { type: 'info' });
    } else {
      toast('操作失败', { type: 'error' });
    }
  });
}

function renderLoggedOut() {
  el.creatorGrid.replaceChildren(emptyCard('请登录后查看个人主页。'));
  el.shelfGrid.replaceChildren(emptyCard('请登录后查看书架。'));
}

async function init() {
  hydrateIcons();
  await initSession();
  initAuthUI(document.getElementById('accountSlot'));
  renderHead();
  bindEvents();
  const initialTab = new URLSearchParams(location.search).get('tab') === 'shelf' ? 'shelf' : 'creator';
  switchTab(initialTab);

  if (!isLoggedIn()) {
    renderLoggedOut();
    promptLogin();
    return;
  }
  await Promise.all([loadCreator(), loadShelf()]);
  renderCreator();
  renderShelf();
}

init().catch((err) => {
  console.error(err);
  renderLoggedOut();
});
