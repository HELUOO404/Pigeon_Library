// routes/state.js — 每用户每课程每 slot 的状态读写;LWW(按 updated_at)。
import { Router } from 'express';
import { userState } from '../db.js';
import { config, SLOTS } from '../config.js';
import { requireUser, authError } from '../middleware/auth.js';

export const stateRouter = Router();
stateRouter.use(requireUser);   // 所有 state 端点都需登录

function parse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

// GET /state/:courseId → 该课程全部 slot
stateRouter.get('/:courseId', (req, res) => {
  const rows = userState.byCourse(req.user.id, req.params.courseId);
  const slots = {};
  for (const r of rows) slots[r.slot] = { data: parse(r.data_json), updated_at: r.updated_at };
  res.json({ slots });
});

// GET /state/:courseId/:slot → 单 slot
stateRouter.get('/:courseId/:slot', (req, res) => {
  const { courseId, slot } = req.params;
  if (!SLOTS.includes(slot)) return authError(res, 400, 'bad_request', '未知的 slot');
  const row = userState.get(req.user.id, courseId, slot);
  if (!row) return res.status(204).end();
  res.json({ data: parse(row.data_json), updated_at: row.updated_at });
});

// PUT /state/:courseId/:slot {data, updated_at} → LWW upsert
stateRouter.put('/:courseId/:slot', (req, res) => {
  const { courseId, slot } = req.params;
  if (!SLOTS.includes(slot)) return authError(res, 400, 'bad_request', '未知的 slot');
  const { data, updated_at } = req.body || {};
  const incomingAt = Number(updated_at);
  if (!Number.isFinite(incomingAt)) return authError(res, 400, 'bad_request', '缺少有效的 updated_at');

  const dataJson = JSON.stringify(data ?? null);
  if (Buffer.byteLength(dataJson, 'utf8') > config.maxStateBytes) {
    return authError(res, 413, 'payload_too_large', '该 slot 数据超出大小上限');
  }

  const existing = userState.get(req.user.id, courseId, slot);
  if (existing && incomingAt < existing.updated_at) {
    // 服务端更新,拒绝覆盖,回服务端版本让前端合并。
    return res.json({ applied: false, updated_at: existing.updated_at, data: parse(existing.data_json) });
  }
  userState.upsert({ userId: req.user.id, courseId, slot, dataJson, updatedAt: incomingAt });
  res.json({ applied: true, updated_at: incomingAt });
});

// GET /sync?since=<ms> → 该用户所有 updated_at > since 的状态(登录首拉/补传)
export const syncRouter = Router();
syncRouter.use(requireUser);
syncRouter.get('/', (req, res) => {
  const since = Number(req.query.since) || 0;
  const rows = userState.since(req.user.id, since);
  const states = rows.map((r) => ({
    course_id: r.course_id, slot: r.slot, data: parse(r.data_json), updated_at: r.updated_at,
  }));
  res.json({ states });
});
