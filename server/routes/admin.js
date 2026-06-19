// routes/admin.js — 管理端控制台:统计 / 用户检索·下钻 / 增删改·重置·改角色·强制下线·清进度
//                    / 课程分析 / 会话 / 趋势 / 审计日志。全部经 requireAdmin;变更类一律写 audit_log。
//                    契约见 docs/user-system-design.md §5 + §12。
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { users } from '../db.js';
import { adminDb } from '../db-admin.js';
import { config } from '../config.js';
import { requireAdmin, authError } from '../middleware/auth.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const USERNAME_RE = /^\S{3,32}$/;                 // 与 auth.js 对齐:3–32 个非空白字符
const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 128;
const publicAdminUser = (u) => ({
  id: u.id, username: u.username, role: u.role, disabled: u.disabled,
  created_at: u.created_at, last_seen: u.last_seen,
});

// 审计:记录一次管理员变更操作(actor 取自会话,不信任请求体)。
function audit(req, action, target, detail) {
  adminDb.writeAudit({
    actorId: req.user.id,
    actorName: req.user.username,
    action,
    targetId: target?.id ?? null,
    targetName: target?.username ?? null,
    detail: detail ?? null,
  });
}

// ---- 统计 / 趋势 / 课程 / 会话 / 审计(只读)----
adminRouter.get('/stats', (req, res) => {
  res.json(adminDb.stats());
});

adminRouter.get('/trends', (req, res) => {
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  res.json(adminDb.trends(days));
});

adminRouter.get('/courses', (req, res) => {
  res.json({ courses: adminDb.courses() });
});

adminRouter.get('/sessions', (req, res) => {
  res.json({ sessions: adminDb.sessionsList() });
});

adminRouter.delete('/sessions/:sid', (req, res) => {
  const sid = Number(req.params.sid);
  if (!Number.isFinite(sid)) return authError(res, 400, 'bad_request', '无效的会话标识');
  const revoked = adminDb.revokeSession(sid);
  audit(req, 'force_logout', null, `吊销会话 #${sid}`);
  res.json({ revoked });
});

adminRouter.get('/audit', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  res.json({ entries: adminDb.listAudit(limit) });
});

// ---- 用户列表 / 下钻 ----
adminRouter.get('/users', (req, res) => {
  const { q, role, status, sort, dir, page, pageSize } = req.query;
  res.json(adminDb.listUsers({
    q: typeof q === 'string' ? q : '',
    role: typeof role === 'string' ? role : '',
    status: typeof status === 'string' ? status : '',
    sort: typeof sort === 'string' ? sort : 'id',
    dir: typeof dir === 'string' ? dir : 'asc',
    page: Number(page) || 1,
    pageSize: Number(pageSize) || 20,
  }));
});

adminRouter.get('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const detail = adminDb.userDetail(id);
  if (!detail) return authError(res, 404, 'not_found', '用户不存在');
  res.json(detail);
});

// ---- 用户建号 ----
adminRouter.post('/users', (req, res) => {
  const { username, password, role } = req.body || {};
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return authError(res, 400, 'bad_request', '用户名需为 3–32 个非空白字符');
  }
  if (!validPassword(password)) {
    return authError(res, 400, 'bad_request', '密码长度需为 8–128 字符');
  }
  if (users.byUsername(username)) return authError(res, 409, 'username_taken', '用户名已被占用');
  const newRole = role === 'admin' ? 'admin' : 'user';
  const passHash = bcrypt.hashSync(password, config.bcryptRounds);
  const info = users.create({ username, passHash, role: newRole, createdAt: Date.now() });
  const created = users.byId(Number(info.lastInsertRowid));
  audit(req, 'create', created, `角色 ${newRole}`);
  res.json({ user: publicAdminUser(created) });
});

// ---- 用户改:禁用/启用、角色、重置密码、改名 ----
adminRouter.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = users.byId(id);
  if (!target) return authError(res, 404, 'not_found', '用户不存在');
  const { disabled, role, resetPassword, username } = req.body || {};

  // 防呆:不允许使最后一个有效管理员被禁用或降级,避免系统无 admin。
  const wouldRemoveAdmin =
    target.role === 'admin' && !target.disabled &&
    ((disabled === true) || (role && role !== 'admin'));
  if (wouldRemoveAdmin && users.countAdmins() <= 1) {
    return authError(res, 409, 'last_admin', '不能禁用/降级最后一个管理员');
  }

  // 改名:校验 + 唯一性(排除自身)。
  if (typeof username === 'string') {
    if (!USERNAME_RE.test(username)) {
      return authError(res, 400, 'bad_request', '用户名需为 3–32 个非空白字符');
    }
    const clash = users.byUsername(username);
    if (clash && clash.id !== id) return authError(res, 409, 'username_taken', '用户名已被占用');
    if (username !== target.username) {
      adminDb.rename(id, username);
      audit(req, 'rename', { id, username: target.username }, `→ ${username}`);
    }
  }

  if (typeof disabled === 'boolean') {
    users.setDisabled(id, disabled);
    audit(req, disabled ? 'disable' : 'enable', target);
  }
  if (role === 'user' || role === 'admin') {
    if (role !== target.role) {
      users.setRole(id, role);
      audit(req, 'set_role', target, `${target.role}→${role}`);
    }
  }
  if (typeof resetPassword === 'string') {
    if (!validPassword(resetPassword)) {
      return authError(res, 400, 'bad_request', '重置密码长度需为 8–128 字符');
    }
    users.setPassword(id, bcrypt.hashSync(resetPassword, config.bcryptRounds));
    audit(req, 'reset_pw', target);
  }
  const fresh = users.byId(id);
  res.json({ user: fresh && publicAdminUser(fresh) });
});

// ---- 用户删 ----
adminRouter.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = users.byId(id);
  if (!target) return authError(res, 404, 'not_found', '用户不存在');
  if (id === req.user.id) return authError(res, 409, 'self_delete', '不能删除当前登录的账户');
  if (target.role === 'admin' && !target.disabled && users.countAdmins() <= 1) {
    return authError(res, 409, 'last_admin', '不能删除最后一个管理员');
  }
  const deleted = adminDb.deleteUser(id);   // sessions + user_state 随 CASCADE 一并清除
  audit(req, 'delete', target);
  res.json({ deleted });
});

// ---- 强制下线(吊销该用户全部会话)----
adminRouter.post('/users/:id/logout', (req, res) => {
  const id = Number(req.params.id);
  const target = users.byId(id);
  if (!target) return authError(res, 404, 'not_found', '用户不存在');
  const revoked = adminDb.forceLogout(id);
  audit(req, 'force_logout', target, `吊销 ${revoked} 个会话`);
  res.json({ revoked });
});

// ---- 清空该用户某课 / 全部同步数据 ----
adminRouter.delete('/users/:id/state', (req, res) => {
  const id = Number(req.params.id);
  const target = users.byId(id);
  if (!target) return authError(res, 404, 'not_found', '用户不存在');
  const course = typeof req.query.course === 'string' && req.query.course ? req.query.course : 'all';
  const removed = adminDb.resetState(id, course);
  audit(req, 'reset_state', target, course === 'all' ? '全部课程' : `课程 ${course}`);
  res.json({ removed });
});
