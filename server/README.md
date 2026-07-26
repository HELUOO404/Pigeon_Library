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
npm run smoke:admin-courses  # 可回滚地验证管理员课程编辑/删除 API
npm run test:admin-cover  # 验证管理员课程展示覆盖与封面处理
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
| `POST /api/courses` (multipart) | 用户 | 上传私人课(服务端解析 manifest 提取权威元数据) |
| `GET  /api/courses/mine` | 用户 | 我的课程(含状态) |
| `GET  /api/courses/square` | 公开 | 已发布课程(搜索/分类/发布人筛选) |
| `GET  /api/courses/:id/file` | owner/admin/已发布 | 下载课程包字节(记一次去重下载) |
| `GET  /api/courses/:id/analytics` | owner | **聚合**学习数据(只回数字,无个体) |
| `POST /api/courses/:id/publish` · `/unpublish` | owner | 申请发布(选分类)/ 撤回 |
| `POST /api/courses/:id/versions` (multipart) | owner | 上传新版本(多版本保留) |
| `PUT/GET /api/social/:key/rating` · `comments` | 公开读 / 用户写 | 评分(1–5)/ 评论(先发后审,作者·admin 可删) |
| `GET/PUT/DELETE /api/bookshelf[/:key]` | 用户 | 书架(收藏)增删查 |
| `GET /api/admin/courses/pending` · `/` | admin | 待审版本队列 / 全部课程 |
| `GET /api/admin/courses/:ref` | admin | 获取当前平台展示资料；上传课的 `original` 从当前已发布包读取（否则 latest），内置课返回 `original: null`，管理端从本地 `BUILTIN_COURSES` 取原始展示资料；`ref` 为数字 ID 或 `builtin:<course_key>` |
| `PATCH /api/admin/courses/:ref` (multipart) | admin | 展示元数据更新并返回 `{course}`：`visible` 使用 `true|false`（multipart 文本值为 `"true"|"false"`），图片字段为 `coverImage`；封面可选原始、PNG/JPEG/WebP 图片（原图不超过 600 KB）或 1-6 个 Unicode 字符文字；不改变课程包、版本或审核状态 |
| `DELETE /api/admin/courses/:ref` | admin | 删除课程；内置课写入 `hidden` 删除墓碑，和 `visible=false` 的可恢复临时隐藏分开；`ref` 为数字 ID 或 `builtin:<course_key>` |
| `POST /api/admin/courses/:id/versions/:vid/approve`·`reject` | admin | 通过(发布)/ 拒绝(写原因);均记审计 |
| `POST /api/admin/courses/:id/takedown` | admin | 已发布下架 |

slot 枚举:`progress | quiz | wrong | studyTime | simulations | theme | localCourses`。

### 课程广场相关文件

- `lib/pigeon-server.js` —— 服务端 `.pigeon`(zip)解析:解包前拒绝 ZIP64、预检最多 2048 个条目，再以 `fflate` 流式解包并按实际输出限制 64 MiB，同时校验声明大小与 CRC；最后校验 manifest、提取权威 `stats`/`cover`/`hash`(**不信任前端元数据**)。
- `lib/version-cover-backfill.js` —— 启动时尽力回填既有版本的 `manifest.coverText`；`cover_text_checked` 持久记录成功、无文字封面、缺失、损坏或超限结果，后续启动不重复解析；不阻塞启动、不改包字节。
- `db-courses.js` —— `courses` + `course_versions` 增删查 + **聚合-only** 学习数据(绝不外泄个体)。
- `builtin_course_overrides` —— 内置课在线元数据覆盖与隐藏标记；静态包保留作为无后端回退。
- `db-social.js` / `db-bookshelf.js` —— 评分/评论/下载去重、书架,均按 `course_key`。
- `routes/courses.js` · `social.js` · `bookshelf.js` · `admin-courses.js` —— 对应路由;课程文件落 `data/courses/<courseId>/<hash>.pigeon`。

## 安全要点

- 密码 bcrypt 哈希,绝不存明文;登录失败统一 401(不泄漏用户名是否存在)。
- 会话:随机 256-bit token + httpOnly cookie(生产 Secure);过期清理。
- CORS 白名单 + `credentials`;`/api/auth/*` 基础限流。
- state 一律按会话 `userId` 隔离,不信任请求里的任何用户标识。
- **真实密钥/口令由你在 `.env` 配置,代码不内置。**
