// middleware/auth.js — 会话校验:读 cookie → 查 session(未过期)→ 查 user(未禁用)→ 挂 req.user。
import { sessions, users } from '../db.js';
import { config } from '../config.js';

export function authError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// 解析当前请求的登录用户;无/失效返回 null(不写响应)。
export function currentUser(req) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return null;
  const sess = sessions.byToken(token);
  if (!sess || sess.expires_at < Date.now()) {
    if (sess) sessions.delete(token);
    return null;
  }
  const user = users.byId(sess.user_id);
  if (!user || user.disabled) return null;
  users.touch(user.id, Date.now());
  return { id: user.id, username: user.username, role: user.role };
}

export function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return authError(res, 401, 'unauthorized', '未登录或会话已过期');
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) return authError(res, 401, 'unauthorized', '未登录或会话已过期');
  if (user.role !== 'admin') return authError(res, 403, 'forbidden', '需要管理员权限');
  req.user = user;
  next();
}
