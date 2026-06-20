// main-home.js — 首页脚本:课程广场 / 我的课程两区、登录受限上传、发布/撤回/删除、课程详情弹层。
// 课程来源经 course-source.js 统一访问(服务端);内置课作为广场预置课保底(不变量 5:无后端仍可见内置课)。
import { BUILTIN_COURSES } from './core/course-registry.js';
import { loadPigeonFromUrl } from './core/pigeon-loader.js';
import { createStore, globalGet } from './core/store.js';
import { applyInitialTheme, toggleTheme } from './core/theme.js';
import { icon, hydrateIcons } from './core/icons.js';
import { toast } from './core/toast.js';
import { initSession, isLoggedIn } from './core/session.js';
import { initSync } from './core/sync.js';
import { initAuthUI, promptLogin } from './core/auth-ui.js';
import {
  COURSE_CATEGORIES, listSquare, listMine, uploadPrivate,
  publishCourse, unpublishCourse, removeCourse, listBookshelf,
} from './core/course-source.js';
import { openCourseDetail } from './core/course-modal.js';

applyInitialTheme();

const STATUS_LABEL = { private: '私有', pending: '审核中', published: '已发布', rejected: '被拒' };
const DROP_HELP = '或点击选择文件 · 单文件 ≤50MB · 登录后上传到「我的课程」(跨设备)';
const AI_PROMPT_FALLBACK = '请把我提供的教材整理成 PigeonLib schemaVersion 1 的 .pigeon 课程包源码(manifest.json / content.json / quiz.json / glossary.json + assets/images)。完整制作规范见首页"格式说明"区或 docs/ai-course-authoring-prompt.md。';

async function loadAuthoringPrompt() {
  try {
    const res = await fetch('/docs/ai-course-authoring-prompt.md', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.text()).trim() || AI_PROMPT_FALLBACK;
  } catch {
    return AI_PROMPT_FALLBACK;
  }
}

const state = {
  tab: 'square',
  loggedIn: false,
  builtin: [],
  builtinError: false,
  square: [],
  squareFilters: { q: '', category: '', publisher: '' },
  squareView: [],
  mine: [],
  mineFilters: { q: '', status: '' },
  mineView: [],
  shelved: new Set(),
};

const el = {
  nav: document.getElementById('siteNav'),
  squareCount: document.getElementById('squareCount'),
  mineCount: document.getElementById('mineCount'),
  tabCountSquare: document.getElementById('tabCountSquare'),
  tabCountMine: document.getElementById('tabCountMine'),
  resumeSlot: document.getElementById('resumeSlot'),
  tabs: [...document.querySelectorAll('.course-tab')],
  panelSquare: document.getElementById('panelSquare'),
  panelMine: document.getElementById('panelMine'),
  squareGrid: document.getElementById('squareGrid'),
  squareSearch: document.getElementById('squareSearch'),
  squareCategory: document.getElementById('squareCategory'),
  squarePublisher: document.getElementById('squarePublisher'),
  mineGrid: document.getElementById('mineGrid'),
  mineSearch: document.getElementById('mineSearch'),
  mineStatus: document.getElementById('mineStatus'),
  dropzone: document.getElementById('dropzone'),
  file: document.getElementById('courseFile'),
  dropTitle: document.getElementById('dropTitle'),
  aiPrompt: document.getElementById('aiPrompt'),
};

function text(value, fallback = '') {
  return value == null || value === '' ? fallback : String(value);
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function getStats(meta = {}) {
  const stats = meta.stats || {};
  return {
    chapters: stats.chapters ?? (Array.isArray(meta.chapters) ? meta.chapters.length : 0),
    knowledgePoints: stats.knowledgePoints ?? countKnowledgePoints(meta),
    questions: stats.questions ?? 0,
  };
}

function countKnowledgePoints(meta) {
  if (!Array.isArray(meta.chapters)) return 0;
  return meta.chapters.reduce((sum, chapter) => {
    const sections = Array.isArray(chapter.sections) ? chapter.sections : [];
    return sum + sections.reduce((inner, section) => inner + (section.knowledgePoints?.length || 0), 0);
  }, 0);
}

// 学习进度按 course_key 命名空间读取(与换设备/重新下载无关)。
function getProgress(courseKey, total) {
  const progress = createStore(courseKey).get('progress', {});
  const values = Object.values(progress || {});
  if (!values.length || !total) return null;
  const mastered = values.filter((value) => value === 'mastered').length;
  return { mastered, total, pct: Math.round((mastered / total) * 100) };
}

function startHref(card) {
  const key = encodeURIComponent(card.courseKey);
  return card.source === 'server' ? `/learn.html?course=${key}&src=${card.serverId}` : `/learn.html?course=${key}`;
}

function onStart(card) {
  location.href = startHref(card);
}

function renderEmptyCard(message, actionHtml = '') {
  const empty = document.createElement('div');
  empty.className = 'empty-card';
  empty.innerHTML = `${escapeHtml(message)}${actionHtml}`;
  return empty;
}

// ---------- 卡片 ----------
function mineActions(card) {
  const canPublish = card.status === 'private' || card.status === 'rejected';
  const canWithdraw = card.status === 'pending' || card.status === 'published';
  return `
    ${canPublish ? '<button class="card-act" type="button" data-action="publish">发布到广场</button>' : ''}
    ${canWithdraw ? '<button class="card-act" type="button" data-action="withdraw">撤回</button>' : ''}
    <button class="card-act card-act-danger" type="button" data-action="delete" title="删除课程" aria-label="删除课程">${icon('trash-2', { size: 15 })}</button>`;
}

function renderCourseCard(card, context) {
  const stats = card.stats || {};
  const title = text(card.title, card.courseKey);
  const publisher = text(card.publisherName || card.author, 'PigeonLib');
  const progress = getProgress(card.courseKey, stats.knowledgePoints);
  const cover = card.coverDataUrl || '';

  const badges = context === 'square'
    ? `<span class="course-metrics"><span class="course-metric">${icon('star', { size: 12 })} ${card.avgRating || '—'}</span><span class="course-metric">${icon('download', { size: 12 })} ${card.downloadCount || 0}</span></span>`
    : `<span class="status-badge status-${card.status}">${STATUS_LABEL[card.status] || card.status}</span>`;

  const article = document.createElement('article');
  article.className = 'course-card';
  article.dataset.courseKey = card.courseKey;
  article.innerHTML = `
    <div class="course-cover ${cover ? 'has-image' : ''}" aria-hidden="true">${cover ? '' : `<span class="cover-letter">${escapeHtml(title.slice(0, 1))}</span>`}</div>
    <div class="course-topline">
      <span class="course-badge">${escapeHtml(publisher)}</span>
      ${badges}
    </div>
    <h3>${escapeHtml(title)}</h3>
    <p class="course-subtitle">${escapeHtml(text(card.subtitle, context === 'square' ? '课程广场' : '我的课程'))}</p>
    <p class="course-stats"><span>${icon('book', { size: 13 })} ${stats.chapters || 0} 章</span> <span>${icon('bookmark', { size: 13 })} ${stats.knowledgePoints || 0} 知识点</span> <span>${icon('square-pen', { size: 13 })} ${stats.questions || 0} 题</span></p>
    ${progress ? `<div class="course-progress" aria-label="学习进度 ${progress.pct}%"><span style="width:${progress.pct}%"></span></div><p class="progress-text">已掌握 ${progress.mastered}/${progress.total} · ${progress.pct}%</p>` : ''}
    <div class="course-card-foot">
      <button class="study-link" type="button" data-action="open-detail">${context === 'mine' ? '详情 / 学习 ▸' : '查看详情 ▸'}</button>
      ${context === 'mine' ? mineActions(card) : ''}
    </div>`;
  if (cover) {
    const coverEl = article.querySelector('.course-cover');
    coverEl.style.backgroundImage = `url("${cover}")`;
  }
  return article;
}

// ---------- 课程广场 ----------
function squareItems() {
  const map = new Map();
  for (const c of state.square) map.set(c.courseKey, c);
  for (const b of state.builtin) if (!map.has(b.courseKey)) map.set(b.courseKey, b);
  let items = [...map.values()];
  const f = state.squareFilters;
  if (f.q) {
    const q = f.q.toLowerCase();
    items = items.filter((c) => [c.title, c.subtitle, c.publisherName, c.author]
      .some((v) => text(v).toLowerCase().includes(q)));
  }
  if (f.category) items = items.filter((c) => c.category === f.category);
  if (f.publisher) items = items.filter((c) => (c.publisherName || c.author || 'PigeonLib') === f.publisher);
  return items;
}

function renderSquare() {
  const items = squareItems();
  state.squareView = items;
  const totalUnique = new Set([...state.square, ...state.builtin].map((c) => c.courseKey)).size;
  el.squareCount.textContent = String(totalUnique);
  if (el.tabCountSquare) el.tabCountSquare.textContent = String(totalUnique);

  if (!items.length) {
    const filtering = state.squareFilters.q || state.squareFilters.category || state.squareFilters.publisher;
    el.squareGrid.replaceChildren(renderEmptyCard(filtering ? '无匹配课程' : '课程广场暂无课程。'));
    return;
  }
  el.squareGrid.replaceChildren(...items.map((c, i) => {
    const card = renderCourseCard(c, 'square');
    card.dataset.idx = String(i);
    card.style.animationDelay = `${i * 60}ms`;
    return card;
  }));
}

function rebuildPublisherFilter() {
  const names = new Set();
  for (const c of [...state.builtin, ...state.square]) names.add(c.publisherName || c.author || 'PigeonLib');
  const sorted = [...names].sort();
  const cur = state.squareFilters.publisher;
  el.squarePublisher.innerHTML = ['<option value="">全部发布人</option>',
    ...sorted.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)].join('');
  if (sorted.includes(cur)) el.squarePublisher.value = cur;
  else state.squareFilters.publisher = '';
}

function buildCategoryFilter() {
  el.squareCategory.innerHTML = ['<option value="">全部分类</option>',
    ...COURSE_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`)].join('');
}

async function fetchSquare() {
  const r = await listSquare({ pageSize: 100 });
  state.square = r.items;
}

async function hydrateBuiltin() {
  let failed = false;
  const cards = await Promise.all(BUILTIN_COURSES.map(async (course) => {
    try {
      const loaded = await loadPigeonFromUrl(`/${course.url}`);
      const m = loaded.manifest;
      const card = {
        source: 'builtin', serverId: null, courseKey: course.id,
        title: m.title || course.title, subtitle: m.subtitle || course.subtitle || '',
        description: m.description || '',
        author: m.author || '', publisherName: m.author || 'PigeonLib',
        category: '', status: 'published',
        stats: getStats(m), coverDataUrl: loaded.coverDataUrl || '',
        avgRating: 0, ratingCount: 0, downloadCount: 0,
      };
      loaded.revoke();
      return card;
    } catch {
      failed = true;
      return null;
    }
  }));
  state.builtin = cards.filter(Boolean);
  state.builtinError = failed;
}

// ---------- 我的课程 ----------
function renderMine() {
  if (!state.loggedIn) {
    state.mineView = [];
    el.mineCount.textContent = '0';
    if (el.tabCountMine) el.tabCountMine.textContent = '0';
    el.mineGrid.replaceChildren(renderEmptyCard(
      '登录后可上传课程、管理私人课程,并申请发布到课程广场。',
      `<button class="btn btn-secondary empty-action" type="button" data-action="login-empty">${icon('user', { size: 16 })} 登录 / 注册</button>`,
    ));
    return;
  }
  let items = state.mine.slice();
  const f = state.mineFilters;
  if (f.q) {
    const q = f.q.toLowerCase();
    items = items.filter((c) => [c.title, c.subtitle].some((v) => text(v).toLowerCase().includes(q)));
  }
  if (f.status) items = items.filter((c) => c.status === f.status);
  state.mineView = items;
  el.mineCount.textContent = String(state.mine.length);
  if (el.tabCountMine) el.tabCountMine.textContent = String(state.mine.length);

  if (!items.length) {
    const filtering = f.q || f.status;
    el.mineGrid.replaceChildren(renderEmptyCard(filtering ? '无匹配课程' : '还没有课程。投递一个 .pigeon 开始。'));
    return;
  }
  el.mineGrid.replaceChildren(...items.map((c, i) => {
    const card = renderCourseCard(c, 'mine');
    card.dataset.idx = String(i);
    card.style.animationDelay = `${i * 60}ms`;
    return card;
  }));
}

async function fetchMine() {
  if (!state.loggedIn) { state.mine = []; state.shelved = new Set(); return; }
  const [mineRes, shelf] = await Promise.all([listMine(), listBookshelf()]);
  state.mine = mineRes.items;
  state.shelved = new Set(shelf.map((x) => x.course_key));
}

// ---------- 续学卡 ----------
function renderResumeCard() {
  const last = globalGet('lastCourse', null);
  const all = [...state.builtin, ...state.square, ...state.mine];
  const exists = last && all.some((c) => c.courseKey === last.id);
  if (!exists) {
    el.resumeSlot.hidden = true;
    el.resumeSlot.replaceChildren();
    return;
  }
  const href = `/learn.html?course=${encodeURIComponent(last.id)}&section=${encodeURIComponent(last.sectionId || '')}`;
  el.resumeSlot.innerHTML = `
    <article class="resume-card">
      <div>
        <p class="resume-eyebrow">继续学习 / RESUME</p>
        <h2>${escapeHtml(last.title || last.id)}</h2>
        <p class="resume-section">${icon('book-open', { size: 15 })}<span>${escapeHtml(last.sectionTitle || '上次进度')}</span></p>
      </div>
      <a class="resume-link" href="${href}">继续 ▸</a>
    </article>`;
  el.resumeSlot.hidden = false;
}

// ---------- 课程详情 ----------
function openDetail(card) {
  openCourseDetail(card, {
    onStart,
    shelved: state.shelved.has(card.courseKey),
    onShelfChange: (key, added) => { if (added) state.shelved.add(key); else state.shelved.delete(key); },
  });
}

// ---------- 发布弹层 ----------
function openPublishDialog() {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'detail-overlay';
    const opts = COURSE_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    ov.innerHTML = `
      <div class="publish-modal" role="dialog" aria-modal="true" aria-label="发布到课程广场">
        <h3 class="publish-title">发布到课程广场</h3>
        <p class="publish-hint">提交后进入管理员审核;通过后将以你的用户名作为「发布人」公开展示。</p>
        <label class="publish-field"><span>选择分类</span><select class="publish-cat">${opts}</select></label>
        <div class="publish-actions">
          <button class="btn btn-secondary" type="button" data-x="cancel">取消</button>
          <button class="btn btn-primary" type="button" data-x="ok">提交审核</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const done = (val) => { ov.remove(); resolve(val); };
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('[data-x="cancel"]')) return done(null);
      if (e.target.closest('[data-x="ok"]')) return done(ov.querySelector('.publish-cat').value);
    });
  });
}

async function refreshAll() {
  await Promise.all([fetchSquare(), fetchMine()]);
  rebuildPublisherFilter();
  renderSquare();
  renderMine();
  renderResumeCard();
}

async function doPublish(card) {
  const category = await openPublishDialog();
  if (!category) return;
  const r = await publishCourse(card.serverId, category);
  if (!r.ok) return toast(r.error || '发布失败', { type: 'error' });
  toast('已提交审核', { type: 'success' });
  await refreshAll();
}

async function doWithdraw(card) {
  if (!confirm('撤回后将从课程广场移除并回到「私有」,确定吗?')) return;
  const r = await unpublishCourse(card.serverId);
  if (!r.ok) return toast(r.error || '撤回失败', { type: 'error' });
  toast('已撤回', { type: 'info' });
  await refreshAll();
}

async function doDelete(card) {
  if (!confirm(`删除课程《${card.title}》？此操作不可恢复(含已上传的课程文件)。`)) return;
  const r = await removeCourse(card.serverId);
  if (!r.ok) return toast('删除失败', { type: 'error' });
  toast('已删除', { type: 'info' });
  await refreshAll();
}

// ---------- 上传(需登录) ----------
function setDropState(status, title, detail) {
  el.dropzone.dataset.status = status;
  el.dropTitle.textContent = title;
  const help = document.getElementById('uploadHelp');
  if (help) help.textContent = detail;
}

function tryPickFile() {
  if (!state.loggedIn) { toast('请先登录后再上传课程', { type: 'info' }); promptLogin(); return; }
  el.file.click();
}

async function handleUpload(file) {
  if (!file) return;
  if (!state.loggedIn) { toast('请先登录后再上传课程', { type: 'info' }); promptLogin(); return; }
  setDropState('parsing', '正在上传课程包', '上传 → 服务端校验 manifest → 入库(私有)');
  const r = await uploadPrivate(file);
  el.file.value = '';
  if (r.needLogin) { setDropState('idle', '拖拽 .pigeon 到这里', DROP_HELP); return promptLogin(); }
  if (!r.ok) {
    toast(`上传失败:${r.error}`, { type: 'error' });
    setDropState('error', `上传失败:${r.error}`, '请检查 .pigeon 结构,或查看下方格式说明');
    return;
  }
  toast(`上传成功:《${r.course.title}》`, { type: 'success' });
  setDropState('success', `上传成功:《${r.course.title}》`, '课程已进入「我的课程」(私有),可发布到广场');
  setTimeout(() => setDropState('idle', '拖拽 .pigeon 到这里', DROP_HELP), 2200);
  await fetchMine();
  renderMine();
  if (state.tab !== 'mine') switchTab('mine');
}

// ---------- Tab ----------
function switchTab(tab) {
  state.tab = tab;
  el.tabs.forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', String(active));
  });
  el.panelSquare.hidden = tab !== 'square';
  el.panelMine.hidden = tab !== 'mine';
}

// ---------- 格式说明手风琴 ----------
function togglePanel(trigger, forceOpen = false) {
  const panel = trigger.closest('.format-panel');
  const isOpen = forceOpen || !panel.classList.contains('open');
  document.querySelectorAll('.format-panel.open').forEach((item) => {
    if (item !== panel) {
      item.classList.remove('open');
      item.querySelector('.panel-trigger span').textContent = '展开 ▾';
    }
  });
  panel.classList.toggle('open', isOpen);
  trigger.querySelector('span').textContent = isOpen ? '收起 ▴' : '展开 ▾';
}

function onGridClick(event, context) {
  const cardEl = event.target.closest('.course-card');
  if (!cardEl) return;
  const view = context === 'square' ? state.squareView : state.mineView;
  const item = view[Number(cardEl.dataset.idx)];
  if (!item) return;
  const act = event.target.closest('[data-action]')?.dataset.action;
  if (act === 'publish') return doPublish(item);
  if (act === 'withdraw') return doWithdraw(item);
  if (act === 'delete') return doDelete(item);
  openDetail(item);
}

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const panelTrigger = event.target.closest('.panel-trigger');
    if (panelTrigger) togglePanel(panelTrigger);
    const tab = event.target.closest('.course-tab');
    if (tab) switchTab(tab.dataset.tab);
    const actionTarget = event.target.closest('[data-action]');
    if (!actionTarget) return;
    const action = actionTarget.dataset.action;
    if (action === 'toggle-menu') el.nav.classList.toggle('open');
    else if (action === 'toggle-theme') toggleTheme();
    else if (action === 'choose-file') { event.preventDefault(); tryPickFile(); }
    else if (action === 'login-empty') promptLogin();
    else if (action === 'open-format') {
      const first = document.querySelector('.format-panel .panel-trigger');
      if (first) togglePanel(first, true);
    } else if (action === 'copy-prompt') {
      try { await navigator.clipboard.writeText(el.aiPrompt.value); toast('提示词已复制到剪贴板', { type: 'success' }); }
      catch { toast('复制失败,请手动选择文本', { type: 'error' }); }
    }
  });

  el.squareGrid.addEventListener('click', (e) => onGridClick(e, 'square'));
  el.mineGrid.addEventListener('click', (e) => onGridClick(e, 'mine'));

  el.squareSearch.addEventListener('input', (e) => { state.squareFilters.q = e.target.value.trim(); renderSquare(); });
  el.squareCategory.addEventListener('change', (e) => { state.squareFilters.category = e.target.value; renderSquare(); });
  el.squarePublisher.addEventListener('change', (e) => { state.squareFilters.publisher = e.target.value; renderSquare(); });
  el.mineSearch.addEventListener('input', (e) => { state.mineFilters.q = e.target.value.trim(); renderMine(); });
  el.mineStatus.addEventListener('change', (e) => { state.mineFilters.status = e.target.value; renderMine(); });

  el.file.addEventListener('change', () => handleUpload(el.file.files?.[0]));
  el.dropzone.addEventListener('click', (event) => { if (!event.target.closest('button')) tryPickFile(); });
  el.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); tryPickFile(); }
  });
  ['dragenter', 'dragover'].forEach((type) => {
    el.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      setDropState('drag-over', '松手即可上传', '正在接收这枚知识投递包');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    el.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === 'drop') handleUpload(event.dataTransfer.files?.[0]);
      else setDropState('idle', '拖拽 .pigeon 到这里', DROP_HELP);
    });
  });
}

async function init() {
  hydrateIcons();
  await initSession();
  state.loggedIn = isLoggedIn();
  initAuthUI(document.getElementById('accountSlot'));
  buildCategoryFilter();
  el.aiPrompt.value = await loadAuthoringPrompt();
  bindEvents();
  renderResumeCard();
  await Promise.all([hydrateBuiltin(), fetchSquare(), fetchMine()]);
  rebuildPublisherFilter();
  renderSquare();
  renderMine();
  renderResumeCard();
  initSync({
    onApplied: () => { renderSquare(); renderMine(); renderResumeCard(); },
  });
}

init().catch((error) => {
  console.error(error);
  renderSquare();
  renderMine();
});
