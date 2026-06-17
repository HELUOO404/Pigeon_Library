// auth-ui.js — 顶栏账户菜单 + 登录/注册/改密码弹窗(首页与学习页共用)。
// 登录/注册/登出成功后重载页面:让 store 按新用户重命名空间、sync 重新拉取(最简且可靠)。
import { icon } from './icons.js';
import { getUser, isAdmin, login, register, logout, changePassword } from './session.js';

let slotEl = null;
let overlay = null;

const ROLE_LABEL = { admin: '管理员', user: '普通用户' };

// ---- 顶栏账户控件 ----
export function initAuthUI(el) {
  slotEl = el;
  if (!slotEl) return;
  renderControl();
  document.addEventListener('click', onDocClick);
}

function renderControl() {
  const user = getUser();
  if (!user) {
    slotEl.innerHTML = `<button class="account-btn" type="button" data-auth="open-login">${icon('user', { size: 16 })}<span>登录</span></button>`;
    return;
  }
  const adminItem = isAdmin()
    ? `<a class="account-item" href="/admin.html">${icon('shield', { size: 15 })} 管理面板</a>`
    : '';
  slotEl.innerHTML = `
    <div class="account">
      <button class="account-btn" type="button" data-auth="toggle-menu" aria-expanded="false">
        ${icon('user', { size: 16 })}<span class="account-name">${escape(user.username)}</span>${icon('chevron-down', { size: 14 })}
      </button>
      <div class="account-menu" hidden>
        <div class="account-head">
          <span class="account-head-name">${escape(user.username)}</span>
          <span class="account-role">${ROLE_LABEL[user.role] || user.role}</span>
        </div>
        <button class="account-item" type="button" data-auth="change-pw">${icon('user', { size: 15 })} 修改密码</button>
        ${adminItem}
        <button class="account-item account-item-danger" type="button" data-auth="logout">${icon('log-out', { size: 15 })} 退出登录</button>
      </div>
    </div>`;
}

function onDocClick(e) {
  const t = e.target.closest('[data-auth]');
  if (t) {
    const a = t.dataset.auth;
    if (a === 'open-login') openModal('login');
    else if (a === 'toggle-menu') toggleMenu(t);
    else if (a === 'change-pw') { closeMenu(); openModal('password'); }
    else if (a === 'logout') doLogout();
    else if (a === 'close') closeModal();
    else if (a === 'to-register') openModal('register');
    else if (a === 'to-login') openModal('login');
    return;
  }
  // 点击菜单外:收起下拉
  if (!e.target.closest('.account')) closeMenu();
}

function toggleMenu(btn) {
  const menu = slotEl.querySelector('.account-menu');
  if (!menu) return;
  const open = menu.hidden;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}
function closeMenu() {
  const menu = slotEl?.querySelector('.account-menu');
  if (menu) menu.hidden = true;
  const btn = slotEl?.querySelector('[data-auth="toggle-menu"]');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

async function doLogout() {
  closeMenu();
  await logout();
  location.reload();
}

// ---- 弹窗(登录 / 注册 / 改密码)----
function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'auth-overlay';
  overlay.hidden = true;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  return overlay;
}

function openModal(mode) {
  ensureOverlay();
  const isPw = mode === 'password';
  const isReg = mode === 'register';
  const title = isPw ? '修改密码' : isReg ? '注册账户' : '登录 PigeonLib';
  const fields = isPw
    ? `<label>原密码<input name="f1" type="password" autocomplete="current-password"></label>
       <label>新密码(≥8 位)<input name="f2" type="password" autocomplete="new-password"></label>`
    : `<label>用户名<input name="f1" autocomplete="username" maxlength="32"></label>
       <label>密码(≥8 位)<input name="f2" type="password" autocomplete="${isReg ? 'new-password' : 'current-password'}"></label>`;
  const switchRow = isPw ? '' : isReg
    ? `<p class="auth-switch">已有账户?<button type="button" data-auth="to-login">去登录</button></p>`
    : `<p class="auth-switch">还没有账户?<button type="button" data-auth="to-register">注册一个</button></p>`;
  overlay.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true" aria-label="${title}">
      <button class="auth-close" type="button" data-auth="close" aria-label="关闭">${icon('x', { size: 18 })}</button>
      <p class="auth-eyebrow">PIGEONLIB / ACCOUNT</p>
      <h2 class="auth-title">${title}</h2>
      <form class="auth-form">
        ${fields}
        <p class="auth-msg" hidden></p>
        <button class="auth-submit" type="submit">${isPw ? '保存新密码' : isReg ? '注册并登录' : '登录'}</button>
      </form>
      ${switchRow}
      <p class="auth-hint">${isPw ? '修改后当前会话仍有效。' : '本地档案不受影响,登录仅开启跨设备同步。'}</p>
    </div>`;
  overlay.hidden = false;
  const form = overlay.querySelector('.auth-form');
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(mode, form); });
  setTimeout(() => form.querySelector('input')?.focus(), 30);
}

function closeModal() {
  if (overlay) overlay.hidden = true;
}

async function submit(mode, form) {
  const f1 = form.f1.value.trim();
  const f2 = form.f2.value;
  const msg = form.querySelector('.auth-msg');
  const btn = form.querySelector('.auth-submit');
  const show = (text, ok = false) => {
    msg.hidden = false;
    msg.textContent = text;
    msg.classList.toggle('ok', ok);
  };
  if (!f1 || !f2) return show('请填写完整');
  btn.disabled = true;
  try {
    if (mode === 'password') {
      const r = await changePassword(f1, f2);
      if (!r.ok) return show(r.error);
      show('已修改', true);
      setTimeout(closeModal, 900);
    } else {
      const r = mode === 'register' ? await register(f1, f2) : await login(f1, f2);
      if (!r.ok) return show(r.error);
      location.reload();
    }
  } finally {
    btn.disabled = false;
  }
}

function escape(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
