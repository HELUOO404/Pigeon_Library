// main-admin.js — 管理面板:用户列表 / 禁用·启用 / 改角色 / 重置密码 / 全局统计。仅 admin 可见。
import { applyInitialTheme, toggleTheme } from './core/theme.js';
import { icon, hydrateIcons } from './core/icons.js';
import { initSession, getUser, isAdmin, api } from './core/session.js';
import { initAuthUI } from './core/auth-ui.js';
import { toast } from './core/toast.js';

applyInitialTheme();

const gate = document.getElementById('adminGate');
const body = document.getElementById('adminBody');
const statsEl = document.getElementById('adminStats');
const usersEl = document.getElementById('adminUsers');

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleDateString() : '—';
}

function renderGate(message, withLogin) {
  body.hidden = true;
  gate.hidden = false;
  gate.innerHTML = `<p>${esc(message)}</p>${withLogin
    ? `<button class="btn btn-primary" type="button" data-auth="open-login">${icon('user', { size: 16 })} 登录</button>`
    : `<a class="btn btn-secondary" href="/index.html">返回首页</a>`}`;
}

function renderStats(s) {
  const cards = [
    ['用户总数', s.userCount],
    ['近 7 日活跃', s.active7d],
    ['同步状态行', s.stateRows],
    ['有进度课程', (s.topCourses || []).length],
  ];
  statsEl.innerHTML = cards.map(([label, value]) =>
    `<div class="admin-stat"><div class="admin-stat-label">${esc(label)}</div><div class="admin-stat-value">${esc(value)}</div></div>`,
  ).join('');
}

function renderUsers(list) {
  const meId = getUser()?.id;
  const rows = list.map((u) => {
    const isMe = u.id === meId;
    const roleCls = u.role === 'admin' ? ' is-admin' : '';
    const state = u.disabled
      ? '<span class="admin-state-off">已禁用</span>'
      : '<span class="admin-state-ok">正常</span>';
    const actions = isMe
      ? '<span class="admin-self">当前账户</span>'
      : `
        <button type="button" data-act="toggle-disable" data-id="${u.id}" data-on="${u.disabled ? 1 : 0}" class="${u.disabled ? '' : 'danger'}">${u.disabled ? '启用' : '禁用'}</button>
        <button type="button" data-act="toggle-role" data-id="${u.id}" data-role="${esc(u.role)}">${u.role === 'admin' ? '降为用户' : '设为管理员'}</button>
        <button type="button" data-act="reset-pw" data-id="${u.id}">重置密码</button>`;
    return `<tr>
      <td class="col-user">${esc(u.username)}</td>
      <td><span class="admin-role${roleCls}">${u.role === 'admin' ? '管理员' : '用户'}</span></td>
      <td>${state}</td>
      <td>${fmtDate(u.created_at)}</td>
      <td><div class="admin-actions">${actions}</div></td>
    </tr>`;
  }).join('');
  usersEl.innerHTML = `
    <thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
    <tbody>${rows}</tbody>`;
}

async function loadData() {
  const [stats, users] = await Promise.all([api('GET', '/admin/stats'), api('GET', '/admin/users')]);
  if (!stats.ok || !users.ok) {
    renderGate('加载管理数据失败,请确认后端已启动且你具备管理员权限。', false);
    return;
  }
  gate.hidden = true;
  body.hidden = false;
  renderStats(stats.json);
  renderUsers(users.json.users || []);
}

async function patchUser(id, payload, okMsg) {
  const r = await api('PATCH', `/admin/users/${id}`, payload);
  if (r.ok) { toast(okMsg, { type: 'success' }); await loadData(); }
  else toast(r.json?.error?.message || '操作失败', { type: 'error' });
}

function bindEvents() {
  document.addEventListener('click', (e) => {
    const themeBtn = e.target.closest('[data-action="toggle-theme"]');
    if (themeBtn) { toggleTheme(); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    const id = Number(act.dataset.id);
    if (act.dataset.act === 'toggle-disable') {
      patchUser(id, { disabled: act.dataset.on !== '1' }, '已更新账户状态');
    } else if (act.dataset.act === 'toggle-role') {
      const next = act.dataset.role === 'admin' ? 'user' : 'admin';
      patchUser(id, { role: next }, '已更新角色');
    } else if (act.dataset.act === 'reset-pw') {
      const pw = prompt('输入该用户的新密码(≥8 位):');
      if (pw == null) return;
      if (pw.length < 8) { toast('密码至少 8 位', { type: 'error' }); return; }
      patchUser(id, { resetPassword: pw }, '已重置密码');
    }
  });
}

async function main() {
  hydrateIcons();
  bindEvents();
  await initSession();
  initAuthUI(document.getElementById('accountSlot'));
  if (!getUser()) { renderGate('管理面板需要登录管理员账户。', true); return; }
  if (!isAdmin()) { renderGate('当前账户没有管理员权限。', false); return; }
  await loadData();
}

main().catch((err) => {
  console.error(err);
  renderGate('加载失败:' + (err?.message || err), false);
});
