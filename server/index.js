// index.js — PigeonLib 同步后端入口:装配中间件、挂路由、建表(由 db.js)、监听。
// 本地优先的「可选同步层」:前端不接它也能纯本地运行(契约见 docs/user-system-design.md)。
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, users, sessions } from './db.js';
import { authRouter, meRouter } from './routes/auth.js';
import { stateRouter, syncRouter } from './routes/state.js';
import { adminRouter } from './routes/admin.js';
import { coursesRouter } from './routes/courses.js';
import { socialRouter } from './routes/social.js';
import { bookshelfRouter } from './routes/bookshelf.js';
import { adminCoursesRouter } from './routes/admin-courses.js';

// 启动清理:删过期会话;按需播种管理员。
sessions.deleteExpired(Date.now());
if (config.seedAdminUser && config.seedAdminPass && !users.byUsername(config.seedAdminUser)) {
  users.create({
    username: config.seedAdminUser,
    passHash: bcrypt.hashSync(config.seedAdminPass, config.bcryptRounds),
    role: 'admin',
    createdAt: Date.now(),
  });
  console.log(`[seed] 已创建管理员账户:${config.seedAdminUser}`);
}

const app = express();
app.disable('x-powered-by');
// 反代层数(TRUST_PROXY)。设了才认 X-Forwarded-For,req.ip 才是真实客户端 IP;
// 不设则限流按反代地址归并,全站用户共用一个配额而互相误伤(见 config.trustProxy)。
if (config.trustProxy !== '0') {
  const hops = Number(config.trustProxy);
  app.set('trust proxy', Number.isFinite(hops) && hops > 0 ? hops : config.trustProxy);
}

// CORS:仅放行白名单源;无 Origin(curl/同源/Node fetch)放行。携带 cookie。
app.use(cors({
  origin(origin, cb) {
    if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS_NOT_ALLOWED'));
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json({ limit: '512kb' }));

// 认证端点基础限流(每 IP 每窗口),抵御撞库。
const hits = new Map();
app.use('/api/auth', (req, res, next) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || rec.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + config.authRateWindowMs });
    return next();
  }
  rec.count += 1;
  if (rec.count > config.authRateMax) {
    return res.status(429).json({ error: { code: 'rate_limited', message: '请求过于频繁,请稍后再试' } });
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRouter);
app.use('/api/me', meRouter);
app.use('/api/state', stateRouter);
app.use('/api/sync', syncRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/social', socialRouter);
app.use('/api/bookshelf', bookshelfRouter);
// 课程审核挂在 /api/admin/courses,须排在 /api/admin 之前,让更具体的前缀先匹配。
app.use('/api/admin/courses', adminCoursesRouter);
app.use('/api/admin', adminRouter);

// 生产可选:同一 Node 进程托管 Vite 静态产物,避免额外 IIS/桌面窗口。
// API 路由已在前,未知 /api 请求不会落到 HTML;其余路径按文件名或首页返回。
if (config.staticDir && fs.existsSync(config.staticDir)) {
  app.use(express.static(config.staticDir, {
    index: false,
    fallthrough: true,
    setHeaders(res, file) {
      const rel = path.relative(config.staticDir, file).replaceAll('\\', '/');
      if (rel.startsWith('assets/') || /^courses\/.*(?:\.pigeon|\/assets\/)/.test(rel)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));
  app.get(/^\/(?!api(?:\/|$)).*/, (req, res) => {
    if (path.extname(req.path)) return res.status(404).end();
    return res.sendFile(path.join(config.staticDir, 'index.html'));
  });
}

// 统一错误体。
app.use((err, req, res, next) => {
  if (err && err.message === 'CORS_NOT_ALLOWED') {
    return res.status(403).json({ error: { code: 'cors', message: '来源不被允许' } });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: '请求体过大' } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'internal', message: '服务器内部错误' } });
});

const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`PigeonLib sync server → http://127.0.0.1:${config.port}  (CORS: ${config.corsOrigins.join(', ')})`);
});

function shutdown() {
  server.close(() => { try { db.close(); } catch { /* ignore */ } process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
