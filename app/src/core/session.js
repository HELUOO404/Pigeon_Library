// session.js — 登录态 + 后端 fetch 封装。后端是「可选同步层」:
// 连不上(未部署/宕机)时一切照常本地运行,这里的调用静默失败回退访客。
import { setActiveUser } from './store.js';

// API 基址:本地开发(任意 localhost 端口,如 Vite 5173/5174…,但后端自身 8787 除外)
// 一律跨源指向后端 8787;生产(真实域名)走同源 /api(反向代理转发)。可用 window.PIGEONLIB_API 覆盖。
const isLocalDev = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  && location.port !== '8787';
const API_BASE = (typeof window !== 'undefined' && window.PIGEONLIB_API)
  || (isLocalDev ? 'http://localhost:8787/api' : '/api');

let currentUser = null;

export function getUser() {
  return currentUser;
}
export function isLoggedIn() {
  return !!currentUser;
}
export function isAdmin() {
  return currentUser?.role === 'admin';
}

// 统一请求封装:始终带 cookie;网络错误归一为 {ok:false, networkError:true}。
export async function api(method, path, body) {
  try {
    const res = await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* 204/空体 */ }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null, networkError: true };
  }
}

// 启动时确认登录态。无后端/未登录都返回 null,并把命名空间设为访客。
export async function initSession() {
  const r = await api('GET', '/me');
  currentUser = r.ok && r.json?.user ? r.json.user : null;
  setActiveUser(currentUser ? currentUser.id : 'local');
  return currentUser;
}

function errorMessage(r, fallback) {
  if (r.networkError) return '连不上同步服务器。双击「启动PigeonLib.bat」会自动启动后端(或在 server/ 运行 npm start)。';
  return r.json?.error?.message || fallback;
}

export async function login(username, password) {
  const r = await api('POST', '/auth/login', { username, password });
  if (r.ok && r.json?.user) { currentUser = r.json.user; return { ok: true, user: currentUser }; }
  return { ok: false, error: errorMessage(r, '登录失败') };
}

export async function register(username, password) {
  const r = await api('POST', '/auth/register', { username, password });
  if (r.ok && r.json?.user) { currentUser = r.json.user; return { ok: true, user: currentUser }; }
  return { ok: false, error: errorMessage(r, '注册失败') };
}

export async function logout() {
  await api('POST', '/auth/logout');
  currentUser = null;
}

export async function changePassword(oldPassword, newPassword) {
  const r = await api('POST', '/me/password', { oldPassword, newPassword });
  if (r.ok || r.status === 204) return { ok: true };
  return { ok: false, error: errorMessage(r, '修改失败') };
}
