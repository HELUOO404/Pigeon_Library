// routes/admin.js — 管理端:用户列表 / 禁用·改角色·重置密码 / 全局统计。全部经 requireAdmin。
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { users, userState } from '../db.js';
import { config } from '../config.js';
import { requireAdmin, authError } from '../middleware/auth.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/users', (req, res) => {
  res.json({ users: users.listAll() });
});

adminRouter.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const target = users.byId(id);
  if (!target) return authError(res, 404, 'not_found', '用户不存在');
  const { disabled, role, resetPassword } = req.body || {};

  // 防呆:不允许使最后一个有效管理员被禁用或降级,避免系统无 admin。
  const wouldRemoveAdmin =
    target.role === 'admin' && !target.disabled &&
    ((disabled === true) || (role && role !== 'admin'));
  if (wouldRemoveAdmin && users.countAdmins() <= 1) {
    return authError(res, 409, 'last_admin', '不能禁用/降级最后一个管理员');
  }

  if (typeof disabled === 'boolean') users.setDisabled(id, disabled);
  if (role === 'user' || role === 'admin') users.setRole(id, role);
  if (typeof resetPassword === 'string') {
    if (resetPassword.length < 8 || resetPassword.length > 128) {
      return authError(res, 400, 'bad_request', '重置密码长度需为 8–128 字符');
    }
    users.setPassword(id, bcrypt.hashSync(resetPassword, config.bcryptRounds));
  }
  res.json({ user: users.byId(id) && publicAdminUser(users.byId(id)) });
});

adminRouter.get('/stats', (req, res) => {
  const all = users.listAll();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  res.json({
    userCount: all.length,
    active7d: all.filter((u) => (u.last_seen || 0) >= weekAgo).length,
    stateRows: userState.countRows(),
    topCourses: userState.topCourses(10),
  });
});

function publicAdminUser(u) {
  return { id: u.id, username: u.username, role: u.role, disabled: u.disabled, created_at: u.created_at, last_seen: u.last_seen };
}
