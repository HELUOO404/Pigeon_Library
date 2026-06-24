// main-profile.js — 个人主页(左右分栏):个人中心(账户编辑 + 学习概览)/ 我的作品 / 我的书架。
// 隐私:个人中心的学习图表纯本地聚合(learning-stats),只展示自己的数据;创作者的「聚合学习数据」走 owner-only analytics(只回数字)。
import { applyInitialTheme, toggleTheme } from './core/theme.js';
import { hydrateIcons, icon } from './core/icons.js';
import { createStore, getActiveUser } from './core/store.js';
import {
  initSession, getUser, isLoggedIn, changeUsername, changePassword,
} from './core/session.js';
import { initAuthUI, promptLogin } from './core/auth-ui.js';
import { toast } from './core/toast.js';
import { loadPigeonFromUrl } from './core/pigeon-loader.js';
import {
  listMine, courseAnalytics, listVersions, listSquare, listBookshelf, removeFromShelf, getSocial,
} from './core/course-source.js';
import { BUILTIN_COURSES } from './core/course-registry.js';
import { sparkbars } from './core/sparkline.js';
import { collectLearningStats } from './core/learning-stats.js';

applyInitialTheme();

const STATUS_LABEL = { private: '私有', pending: '审核中', published: '已发布', rejected: '被拒' };
const ROLE_LABEL = { admin: '管理员', user: '普通用户' };

const state = { tab: 'account', creator: [], shelf: [], titles: {}, srcByKey: {}, stats: null };

const el = {
  tabs: [...document.querySelectorAll('.pnav-item')],
  navFoot: document.getElementById('profileNavFoot'),
  panelAccount: document.getElementById('panelAccount'),
  panelCreator: document.getElementById('panelCreator'),
  panelShelf: document.getElementById('panelShelf'),
  creatorGrid: document.getElementById('creatorGrid'),
  shelfGrid: document.getElementById('shelfGrid'),
  creatorSummary: document.getElementById('creatorSummary'),
  shelfSummary: document.getElementById('shelfSummary'),
};

// ---------- 工具 ----------
function esc(value) {
  return (value == null ? '' : String(value)).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDuration(ms) {
  const m = Math.round((Number(ms) || 0) / 60000);
  if (m <= 0) return '0分';
  if (m < 60) return `${m}分`;
  return `${Math.floor(m / 60)}时${m % 60}分`;
}

function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function letterOf(title) {
  return (title || '?').slice(0, 1).toUpperCase();
}

function countKnowledgePoints(manifest) {
  if (!Array.isArray(manifest.chapters)) return null;
  return manifest.chapters.reduce((sum, ch) => {
    const sections = Array.isArray(ch.sections) ? ch.sections : [];
    return sum + sections.reduce((inner, sec) => inner + (sec.knowledgePoints?.length || 0), 0);
  }, 0);
}

function hrefFor(courseKey) {
  const base = `/learn.html?course=${encodeURIComponent(courseKey)}`;
  const src = state.srcByKey[courseKey];
  return src ? `${base}&src=${src}` : base;
}

function emptyCard(message) {
  const div = document.createElement('div');
  div.className = 'empty-card';
  div.textContent = message;
  return div;
}

// ---------- 左导航脚注 ----------
function renderNavFoot() {
  const user = getUser();
  if (!user) { el.navFoot.innerHTML = ''; return; }
  el.navFoot.innerHTML = `
    <span class="pf-name">${esc(user.username)}</span>
    <span class="pf-role">${esc(ROLE_LABEL[user.role] || user.role)}</span>`;
}

// ====================================================================
// 个人中心:账户卡 + 学习概览
// ====================================================================
function accountCardHtml(user) {
  return `
  <div class="account-card">
    <div class="account-top">
      <div class="account-id">
        <h1>${esc(user.username)}</h1>
        <span class="pf-role">${esc(ROLE_LABEL[user.role] || user.role)}</span>
        <span class="account-joined">注册于 ${fmtDate(user.created_at)}</span>
      </div>
      <div class="account-actions">
        <button class="btn btn-secondary" type="button" data-act="toggle-username">${icon('square-pen', { size: 15 })} 编辑用户名</button>
        <button class="btn btn-secondary" type="button" data-act="toggle-password">${icon('shield', { size: 15 })} 修改密码</button>
      </div>
    </div>

    <form class="account-form" data-form="username" hidden>
      <div class="account-field"><label>新用户名(3–32 个非空白字符)</label><input name="username" autocomplete="off" maxlength="32" required></div>
      <div class="account-field"><label>当前密码(验证身份)</label><input name="password" type="password" autocomplete="current-password" required></div>
      <div class="account-form-actions"><button class="btn btn-primary" type="submit">保存</button><button class="btn btn-secondary" type="button" data-act="cancel">取消</button><span class="account-form-msg" data-msg></span></div>
    </form>

    <form class="account-form" data-form="password" hidden>
      <div class="account-field"><label>当前密码</label><input name="oldPassword" type="password" autocomplete="current-password" required></div>
      <div class="account-field"><label>新密码(8–128 字符)</label><input name="newPassword" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="account-field"><label>确认新密码</label><input name="confirm" type="password" autocomplete="new-password" minlength="8" required></div>
      <div class="account-form-actions"><button class="btn btn-primary" type="submit">保存</button><button class="btn btn-secondary" type="button" data-act="cancel">取消</button><span class="account-form-msg" data-msg></span></div>
    </form>

    <p class="account-note">用户名变更不影响已发布课程的署名快照与历史评论。修改账号需已登录并连接同步后端。</p>
  </div>`;
}

function accuracyRing(pct) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const val = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const dash = (val / 100) * c;
  return `<div class="acc-ring">
    <svg viewBox="0 0 128 128" aria-hidden="true">
      <circle class="ring-track" cx="64" cy="64" r="${r}" stroke-width="12"/>
      <circle class="ring-fill" cx="64" cy="64" r="${r}" stroke-width="12" stroke-dasharray="${dash.toFixed(1)} ${(c - dash).toFixed(1)}"/>
    </svg>
    <div class="acc-ring-label"><span class="acc-ring-pct">${pct == null ? '—' : `${pct}%`}</span><span class="acc-ring-cap">综合正确率</span></div>
  </div>`;
}

function courseRowHtml(c) {
  const bar = c.total
    ? `<div class="course-progress" aria-hidden="true"><span style="width:${c.progressPct}%"></span></div>`
    : '';
  const bits = [
    c.total ? `掌握 ${c.mastered}/${c.total}` : `已掌握 ${c.mastered} 点`,
    c.accuracy == null ? null : `正确率 ${c.accuracy}%`,
    c.studyMs ? fmtDuration(c.studyMs) : null,
    c.examCount ? `考试 ${c.examCount} 次` : null,
  ].filter(Boolean).join(' · ');
  const cover = state.titles[c.courseKey]?.coverDataUrl || '';
  const badgeClass = cover ? 'cp-badge has-image' : 'cp-badge';
  const badgeStyle = cover ? ` style="background-image:url('${cover}')"` : '';
  const badgeContent = cover ? '' : esc(letterOf(c.title));
  return `<div class="cp-row">
    <div class="${badgeClass}"${badgeStyle} aria-hidden="true">${badgeContent}</div>
    <div class="cp-main">
      <div class="cp-title">${esc(c.title)}</div>
      ${bar}
      <div class="cp-meta">${esc(bits)}</div>
    </div>
    <a class="study-link cp-go" href="${hrefFor(c.courseKey)}">继续 ▸</a>
  </div>`;
}

function overviewHtml(stats) {
  const t = stats.totals;
  if (!t.courses && !t.doneQuestions && !t.studyMs && !t.mastered) {
    return `<div class="overview-empty">
      <p>还没有学习记录。</p>
      <a class="study-link" href="/index.html#courses">去课程广场开始第一课 ▸</a>
    </div>`;
  }
  const kpis = [
    [t.courses, '在学课程'],
    [t.doneQuestions, '累计做题'],
    [t.accuracy == null ? '—' : `${t.accuracy}%`, '综合正确率'],
    [t.mastered, '已掌握知识点'],
    [fmtDuration(t.studyMs), '学习时长'],
    [t.wrongCount, '待复习错题'],
  ];
  const kpiBand = `<div class="kpi-band">${kpis.map(([n, l]) => `<div class="kpi"><div class="kpi-num">${esc(String(n))}</div><div class="kpi-label">${l}</div></div>`).join('')}</div>`;

  const examBlock = t.examCount
    ? `<div class="exam-record">
        <div class="exam-record-head"><span>章节考试 <b>${t.examCount}</b> 次</span><span>均分 <b>${t.examAvgScore ?? '—'}</b></span><span>最高 <b>${t.examBestScore ?? '—'}</b></span></div>
        <span class="exam-spark">${sparkbars(t.examScores.slice(-14), { width: 260, height: 38 })}</span>
      </div>`
    : '<div class="exam-record"><div class="exam-record-head"><span>章节考试 <b>0</b> 次 —— 到学习页做一次章节测试,成绩会记入这里</span></div></div>';

  const overviewRow = `<div class="overview-row">
    ${accuracyRing(t.accuracy)}
    <div class="overview-side">
      <div class="split-legend"><span>小测 <b>${t.quizQuestions}</b> 题</span><span>考试 <b>${t.examQuestions}</b> 题</span><span>已掌握 <b>${t.mastered}</b> 点</span></div>
      ${examBlock}
    </div>
  </div>`;

  const rows = stats.perCourse.filter((c) => c.doneQuestions || c.mastered || c.studyMs);
  const listBlock = rows.length
    ? `<p class="overview-eyebrow">逐课进度</p><div class="course-progress-list">${rows.map(courseRowHtml).join('')}</div>`
    : '';

  return `<p class="overview-eyebrow">学习概览</p>${kpiBand}${overviewRow}${listBlock}`;
}

function renderAccount() {
  const user = getUser();
  if (!user) { el.panelAccount.replaceChildren(emptyCard('请登录后查看个人中心。')); return; }
  const stats = state.stats || { totals: { courses: 0, doneQuestions: 0, studyMs: 0, mastered: 0 }, perCourse: [] };
  el.panelAccount.innerHTML = accountCardHtml(user) + overviewHtml(stats);
}

// 账户编辑:表单展开 / 取消 / 提交(委托一次,渲染重建表单不需重绑)
function onAccountClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const forms = el.panelAccount.querySelectorAll('.account-form');
  if (act === 'toggle-username' || act === 'toggle-password') {
    const want = act === 'toggle-username' ? 'username' : 'password';
    forms.forEach((f) => { f.hidden = f.dataset.form !== want ? true : !f.hidden; });
  } else if (act === 'cancel') {
    const form = btn.closest('.account-form');
    if (form) { form.hidden = true; form.reset(); }
  }
}

async function onAccountSubmit(e) {
  const form = e.target.closest('.account-form');
  if (!form) return;
  e.preventDefault();
  const msg = form.querySelector('[data-msg]');
  const submitBtn = form.querySelector('button[type="submit"]');
  const setMsg = (text, ok) => { msg.textContent = text; msg.className = `account-form-msg ${ok ? 'ok' : 'err'}`; };

  if (form.dataset.form === 'username') {
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!/^\S{3,32}$/.test(username)) return setMsg('用户名需为 3–32 个非空白字符', false);
    submitBtn.disabled = true;
    const r = await changeUsername(username, password);
    submitBtn.disabled = false;
    if (!r.ok) return setMsg(r.error || '修改失败', false);
    toast('用户名已更新', { type: 'success' });
    renderNavFoot();
    renderAccount();
    return undefined;
  }

  // password
  const oldPassword = form.oldPassword.value;
  const newPassword = form.newPassword.value;
  const confirm = form.confirm.value;
  if (newPassword.length < 8) return setMsg('新密码长度需为 8–128 字符', false);
  if (newPassword !== confirm) return setMsg('两次输入的新密码不一致', false);
  submitBtn.disabled = true;
  const r = await changePassword(oldPassword, newPassword);
  submitBtn.disabled = false;
  if (!r.ok) return setMsg(r.error || '修改失败', false);
  toast('密码已修改', { type: 'success' });
  form.reset();
  setMsg('已修改', true);
  return undefined;
}

// ====================================================================
// 我的作品(创作者中心):保留评分/评论/下载量 + 聚合数据 + 版本
// ====================================================================
function socialRow(social) {
  if (!social) return '';
  const avg = social.avgRating ? social.avgRating : '—';
  return `<p class="card-social">
    <span>${icon('star', { size: 13 })} ${avg}${social.ratingCount ? `(${social.ratingCount})` : ''}</span>
    <span>${icon('download', { size: 13 })} ${social.downloadCount || 0}</span>
    <span>${icon('message-square', { size: 13 })} ${social.commentCount || 0}</span>
  </p>`;
}

function analyticsRow(a) {
  if (!a) return '<p class="analytics-empty">暂无学习数据</p>';
  return `<div class="analytics-row">
    <span class="metric"><span class="metric-num">${a.learners}</span> 学习人数</span>
    <span class="metric"><span class="metric-num">${fmtDuration(a.totalStudyMs)}</span> 累计</span>
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

function creatorCard({ course, analytics, versions, social }) {
  const s = course.stats || {};
  const cover = course.coverDataUrl || '';
  const article = document.createElement('article');
  article.className = 'profile-card';
  article.innerHTML = `
    <div class="profile-card-top">
      <div class="profile-cover ${cover ? 'has-image' : ''}" aria-hidden="true">${cover ? '' : `<span>${esc(letterOf(course.title))}</span>`}</div>
      <div class="profile-card-id">
        <span class="status-badge status-${esc(course.status)}">${esc(STATUS_LABEL[course.status] || course.status)}</span>
        <h3>${esc(course.title)}</h3>
        <p class="profile-card-sub">${esc(course.subtitle || '')}</p>
        <p class="course-stats"><span>${icon('book', { size: 13 })} ${s.chapters || 0} 章</span> <span>${icon('bookmark', { size: 13 })} ${s.knowledgePoints || 0} 知识点</span> <span>${icon('square-pen', { size: 13 })} ${s.questions || 0} 题</span></p>
      </div>
    </div>
    ${socialRow(social)}
    <p class="analytics-title">${icon('users', { size: 14 })} 学习数据(聚合)</p>
    ${analyticsRow(analytics)}
    ${versionRows(versions)}
    <div class="profile-card-foot">
      <a class="study-link" href="/learn.html?course=${encodeURIComponent(course.courseKey)}&src=${course.serverId}">查看课程 ▸</a>
    </div>`;
  if (cover) article.querySelector('.profile-cover').style.backgroundImage = `url("${cover}")`;
  return article;
}

function renderCreatorSummary() {
  const items = state.creator;
  if (!items.length) { el.creatorSummary.innerHTML = ''; return; }
  const published = items.filter((d) => d.course.status === 'published').length;
  const pending = items.filter((d) => d.course.status === 'pending' || d.course.latestStatus === 'pending').length;
  const learners = items.reduce((sum, d) => sum + (d.analytics?.learners || 0), 0);
  el.creatorSummary.innerHTML = `
    <span>作品 <b>${items.length}</b></span>
    <span>已发布 <b>${published}</b></span>
    <span>学习人数 <b>${learners}</b></span>
    <span>待审核 <b>${pending}</b></span>
    <a class="study-link summary-link" href="/index.html#courses">上传新课程 ▸</a>`;
}

function renderCreator() {
  renderCreatorSummary();
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

// ====================================================================
// 我的书架
// ====================================================================
function progressFor(courseKey) {
  const progress = createStore(courseKey).get('progress', {});
  const values = Object.values(progress || {});
  const mastered = values.filter((v) => v === 'mastered').length;
  const studyMs = createStore(courseKey).get('studyTime', 0);
  const total = state.titles[courseKey]?.total ?? null;
  const pct = total ? Math.round((mastered / total) * 100) : null;
  return { mastered, total, studyMs, pct, started: values.length > 0 || studyMs > 0 };
}

function shelfCard(item) {
  const meta = item.meta || {};
  const title = meta.title || item.key;
  const prog = progressFor(item.key);
  const article = document.createElement('article');
  article.className = 'profile-card';
  article.dataset.key = item.key;
  const progLine = prog.started
    ? `<div class="course-progress" aria-hidden="true"><span style="width:${prog.pct ?? 0}%"></span></div>
       <p class="progress-text">${prog.total ? `已掌握 ${prog.mastered}/${prog.total} · ${prog.pct}%` : `已掌握 ${prog.mastered} 点`} · 已学 ${fmtDuration(prog.studyMs)}</p>`
    : '<p class="progress-text">尚未开始学习</p>';
  article.innerHTML = `
    <div class="profile-card-top">
      <div class="profile-cover ${meta.coverDataUrl ? 'has-image' : ''}" aria-hidden="true">${meta.coverDataUrl ? '' : `<span>${esc(letterOf(title))}</span>`}</div>
      <div class="profile-card-id">
        ${meta.publisherName ? `<span class="course-badge">${esc(meta.publisherName)}</span>` : ''}
        <h3>${esc(title)}</h3>
        <p class="profile-card-sub">${esc(meta.subtitle || '')}</p>
        <p class="shelf-added">加入于 ${fmtDate(item.addedAt)}</p>
      </div>
    </div>
    <div class="shelf-progress">${progLine}</div>
    <div class="profile-card-foot">
      <a class="study-link" href="${hrefFor(item.key)}">${prog.started ? '继续学习 ▸' : '开始学习 ▸'}</a>
      <button class="card-act card-act-danger" type="button" data-action="unshelf" title="移出书架" aria-label="移出书架">${icon('trash-2', { size: 15 })}</button>
    </div>`;
  if (meta.coverDataUrl) article.querySelector('.profile-cover').style.backgroundImage = `url("${meta.coverDataUrl}")`;
  return article;
}

function renderShelfSummary() {
  const items = state.shelf;
  if (!items.length) { el.shelfSummary.innerHTML = ''; return; }
  // 上次在学:取本地 perCourse(按最近活跃排序)里第一门在书架中的课
  const shelfKeys = new Set(items.map((s) => s.key));
  const last = (state.stats?.perCourse || []).find((c) => shelfKeys.has(c.courseKey) && c.lastActivity);
  const resume = last
    ? `<span>上次在学:<b>${esc(state.titles[last.courseKey]?.title || last.courseKey)}</b></span><a class="study-link summary-link" href="${hrefFor(last.courseKey)}">续学 ▸</a>`
    : '';
  el.shelfSummary.innerHTML = `<span>收藏 <b>${items.length}</b> 门</span>${resume}`;
}

function renderShelf() {
  renderShelfSummary();
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

// ====================================================================
// 数据加载
// ====================================================================
async function loadAll() {
  const [mineRes, square, shelf] = await Promise.all([
    listMine(), listSquare({ pageSize: 100 }), listBookshelf(),
  ]);

  // 课名 / 知识点总数 / 服务端 id 映射(供逐课进度与 learn 链接)
  const titles = {};
  const srcByKey = {};
  for (const c of square.items) { titles[c.courseKey] = { title: c.title, total: c.stats?.knowledgePoints || null, coverDataUrl: c.coverDataUrl || '' }; if (c.serverId) srcByKey[c.courseKey] = c.serverId; }
  for (const c of mineRes.items) { titles[c.courseKey] = { title: c.title, total: c.stats?.knowledgePoints || null, coverDataUrl: c.coverDataUrl || '' }; if (c.serverId) srcByKey[c.courseKey] = c.serverId; }
  // 内置课:解包取课名/知识点总数/封面(书架若收藏内置课,封面需从这里取,服务端广场无内置课记录)。
  const builtinMeta = {};
  await Promise.all(BUILTIN_COURSES.map(async (b) => {
    try {
      const loaded = await loadPigeonFromUrl(`/${b.url}`);
      const m = loaded.manifest;
      titles[b.id] = { title: m.title || b.title, total: m.stats?.knowledgePoints ?? countKnowledgePoints(m), coverDataUrl: loaded.coverDataUrl || '' };
      builtinMeta[b.id] = {
        courseKey: b.id, title: m.title || b.title, subtitle: m.subtitle || b.subtitle || '',
        publisherName: m.author || 'PigeonLib', coverDataUrl: loaded.coverDataUrl || '', source: 'builtin',
      };
      loaded.revoke();
    } catch {
      if (!titles[b.id]) titles[b.id] = { title: b.title, total: null };
    }
  }));
  state.titles = titles;
  state.srcByKey = srcByKey;

  // 我的作品:聚合数据 + 版本 + 社交(评分/评论/下载量)
  state.creator = await Promise.all(mineRes.items.map(async (course) => {
    const [analytics, versions, social] = await Promise.all([
      courseAnalytics(course.serverId), listVersions(course.serverId), getSocial(course.courseKey),
    ]);
    return { course, analytics, versions, social };
  }));

  // 书架:补课程摘要(广场 ∪ 内置;内置带解包出的封面)
  const metaByKey = new Map();
  for (const c of square.items) metaByKey.set(c.courseKey, c);
  for (const b of BUILTIN_COURSES) {
    if (!metaByKey.has(b.id)) {
      metaByKey.set(b.id, builtinMeta[b.id] || { courseKey: b.id, title: b.title, subtitle: b.subtitle || '', source: 'builtin' });
    }
  }
  state.shelf = shelf.map((s) => ({ key: s.course_key, addedAt: s.added_at, meta: metaByKey.get(s.course_key) || null }));

  // 学习概览:纯本地聚合
  state.stats = collectLearningStats({ uid: getActiveUser(), titles });
}

// ====================================================================
// Tab 切换 + 事件
// ====================================================================
function switchTab(tab) {
  state.tab = tab;
  el.tabs.forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', String(active));
  });
  el.panelAccount.hidden = tab !== 'account';
  el.panelCreator.hidden = tab !== 'creator';
  el.panelShelf.hidden = tab !== 'shelf';
}

function bindEvents() {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="toggle-theme"]')) return toggleTheme();
    const tab = e.target.closest('.pnav-item');
    if (tab) switchTab(tab.dataset.tab);
  });
  el.panelAccount.addEventListener('click', onAccountClick);
  el.panelAccount.addEventListener('submit', onAccountSubmit);
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
  el.panelAccount.replaceChildren(emptyCard('请登录后查看个人主页。'));
  el.creatorGrid.replaceChildren(emptyCard('请登录后查看我的作品。'));
  el.shelfGrid.replaceChildren(emptyCard('请登录后查看书架。'));
}

async function init() {
  hydrateIcons();
  await initSession();
  initAuthUI(document.getElementById('accountSlot'));
  renderNavFoot();
  bindEvents();
  const initialTab = new URLSearchParams(location.search).get('tab');
  switchTab(['creator', 'shelf'].includes(initialTab) ? initialTab : 'account');

  if (!isLoggedIn()) {
    renderLoggedOut();
    promptLogin();
    return;
  }
  renderAccount(); // 先出账户卡(统计随后补)
  await loadAll();
  renderAccount();
  renderCreator();
  renderShelf();
}

init().catch((err) => {
  console.error(err);
  renderLoggedOut();
});
