# server/ — PigeonLib 可选同步后端

PigeonLib 的**可选**账户 + 跨设备进度同步后端。设计契约见 [`../docs/user-system-design.md`](../docs/user-system-design.md)。

> **本地优先**:前端**不接**这个后端也能完整运行(纯本地档案、可离线)。登录账户后才启用与本后端的双向同步。

## 技术栈(为何这样选)

- **`node:sqlite`(Node 内置)** 而非 better-sqlite3 —— 免原生编译,`npm install` 不需要 Visual Studio 构建工具,装即用。需 Node ≥ 22.5(本机 Node 24)。
- **`bcryptjs`(纯 JS)** 而非 argon2 —— 同样免原生编译。密码用 bcrypt 哈希(含盐)。
- `express` + `cookie-parser` + `cors`。

> 升级点:高并发/更强安全场景可换 better-sqlite3 + argon2(接口不变,见设计稿 §2 升级点)。

## 起停

```bash
cd server
npm install
cp .env.example .env      # 按需修改端口 / CORS 源 / 管理员种子
npm start                 # → http://localhost:8787
```

- 默认端口 `8787`,可用 `.env` 的 `PORT` 改。
- SQLite 数据库落 `server/data/pglib.db`(首次启动自动建);`data/` 不入库。
- 首个注册用户自动成为**管理员**;或用 `.env` 的 `SEED_ADMIN_USER/PASS` 预置。
- 启动会有一行 `ExperimentalWarning`(node:sqlite 实验特性),已用 `--disable-warning=ExperimentalWarning` 抑制。

## 冒烟测试

```bash
npm start        # 终端 1
npm run smoke    # 终端 2:注册→登录→state(LWW)→sync→admin 守卫→登出 + 密码哈希断言
```

## 端点速查(权威契约见设计稿 §5)

| 方法 路径 | 鉴权 | 说明 |
|---|---|---|
| `GET  /api/health` | 公开 | 健康检查 |
| `POST /api/auth/register` | 公开 | 注册(首个用户→admin);注册即登录 |
| `POST /api/auth/login` | 公开 | 登录,下发 httpOnly cookie |
| `POST /api/auth/logout` | 用户 | 登出 |
| `GET  /api/me` | 用户 | 当前账户(未登录 401) |
| `POST /api/me/password` | 用户 | 改本人密码 |
| `GET  /api/state/:courseId` | 用户 | 该课程全部 slot |
| `GET  /api/state/:courseId/:slot` | 用户 | 单 slot(无则 204) |
| `PUT  /api/state/:courseId/:slot` | 用户 | LWW upsert,`{data,updated_at}` |
| `GET  /api/sync?since=` | 用户 | 该用户所有变更(首拉/补传) |
| `GET  /api/admin/users` | admin | 用户列表 |
| `PATCH /api/admin/users/:id` | admin | 禁用/角色/重置密码(防呆:不可移除最后一个 admin) |
| `GET  /api/admin/stats` | admin | 全局统计 |

slot 枚举:`progress | quiz | wrong | studyTime | theme | localCourses`。

## 安全要点

- 密码 bcrypt 哈希,绝不存明文;登录失败统一 401(不泄漏用户名是否存在)。
- 会话:随机 256-bit token + httpOnly cookie(生产 Secure);过期清理。
- CORS 白名单 + `credentials`;`/api/auth/*` 基础限流。
- state 一律按会话 `userId` 隔离,不信任请求里的任何用户标识。
- **真实密钥/口令由你在 `.env` 配置,代码不内置。**
