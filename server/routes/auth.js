// routes/auth.js — 注册 / 登录 / 登出 / me / 改密码。
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { users, sessions } from '../db.js';
import { config } from '../config.js';
import { requireUser, authError, currentUser } from '../middleware/auth.js';

export const authRouter = Router();
export const meRouter = Router();

const USERNAME_RE = /^\S{3,32}$/;        // 3–32 个非空白字符
const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role });

function issueSession(req, res, userId) {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + config.sessionTtlMs;
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  sessions.create({ token, userId, createdAt: now, expiresAt, ip: req.ip || null, userAgent: ua || null });
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    expires: new Date(expiresAt),
    path: '/',
  });
}

function validCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return '用户名需为 3–32 个非空白字符';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return '密码长度需为 8–128 字符';
  }
  return null;
}

authRouter.post('/register', (req, res) => {
  const { username, password } = req.body || {};
  const bad = validCredentials(username, password);
  if (bad) return authError(res, 400, 'bad_request', bad);
  if (users.byUsername(username)) return authError(res, 409, 'username_taken', '用户名已被占用');

  // 首位注册者自动成为管理员(契约见 user-system-design §3)。
  const role = users.count() === 0 ? 'admin' : 'user';
  const passHash = bcrypt.hashSync(password, config.bcryptRounds);
  const info = users.create({ username, passHash, role, createdAt: Date.now() });
  const id = Number(info.lastInsertRowid);
  issueSession(req, res, id);
  res.json({ user: { id, username, role } });
});

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return authError(res, 400, 'bad_request', '缺少用户名或密码');
  }
  const user = users.byUsername(username);
  // 统一失败信息,不泄漏「用户名是否存在」。
  if (!user || !bcrypt.compareSync(password, user.pass_hash)) {
    return authError(res, 401, 'unauthorized', '用户名或密码错误');
  }
  if (user.disabled) return authError(res, 403, 'forbidden', '该账户已被禁用');
  users.touch(user.id, Date.now());
  issueSession(req, res, user.id);
  res.json({ user: publicUser(user) });
});

authRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[config.cookieName];
  if (token) sessions.delete(token);
  res.clearCookie(config.cookieName, { path: '/' });
  res.status(204).end();
});

meRouter.get('/', (req, res) => {
  const user = currentUser(req);
  if (!user) return authError(res, 401, 'unauthorized', '未登录');
  res.json({ user });
});

meRouter.post('/password', requireUser, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
    return authError(res, 400, 'bad_request', '新密码长度需为 8–128 字符');
  }
  const user = users.byId(req.user.id);
  if (!bcrypt.compareSync(oldPassword || '', user.pass_hash)) {
    return authError(res, 401, 'unauthorized', '原密码错误');
  }
  users.setPassword(user.id, bcrypt.hashSync(newPassword, config.bcryptRounds));
  res.status(204).end();
});
