# 用户系统设计稿（User System Design）— v1

> 本文是用户系统的**设计契约**:先定架构与接口,再据此实现 `server/`(后端)与前端集成。
> 字段/端点改动先改本文档,再改代码(与 `pigeon-format.md` 同等约束)。
> 关联:部署见 [`deployment-guide.md`](./deployment-guide.md)(后端小节落地后回填校准),平台总纲见 [`../CLAUDE.md`](../CLAUDE.md)。

## 0. 设计目标与一句话定位

给 PigeonLib 增加**真正的账户 + 跨设备进度同步**,但**不破坏「纯静态、可离线」**这条命脉。

实现手法:后端是一层**渐进增强的同步层(progressive-enhancement sync layer)**。

- **不登录 / 无后端** → 行为完全等同今天:数据存浏览器本地(localStorage / IndexedDB),按课程隔离,可离线。称作「本地档案 / 访客档案」。
- **登录账户** → 在本地优先的基础上,叠加与 Node+SQLite 后端的双向同步,换设备/换浏览器可接续。

> 核心原则:**本地优先(local-first)**。后端宕机或未部署时,前端不报错、不阻塞,自动退化为本地档案。登录只是「打开同步开关」,不是「使用前提」。

---

## 1. 架构总览

```
┌──────────────────────── 浏览器(前端,纯静态) ────────────────────────┐
│                                                                        │
│  index.html / learn.html                                               │
│      │                                                                 │
│      ▼                                                                 │
│  渲染层 render/* ─── 读写 ──▶ createStore(courseId)  ◀── 不变的调用面 │
│                                   │                                     │
│                     ┌─────────────┴──────────────┐                     │
│                     ▼                            ▼                     │
│             localStorage(本地优先)      sync.js(可选,登录后启用)    │
│             pglib:u:<uid|local>:…              │  去抖 push / 启动 pull │
│                                                ▼                       │
│                                        session.js(登录态 + fetch 封装) │
└────────────────────────────────────────────────│──────────────────────┘
                                                  │ HTTPS / cookie(httpOnly)
                                                  ▼
┌──────────────────────── 后端 server/(Node + Express) ─────────────────┐
│  routes/auth   注册 / 登录 / 登出 / me                                  │
│  routes/state  GET/PUT 每课程每 slot 的状态(LWW)                       │
│  routes/admin  用户列表 / 禁用 / 统计(角色守卫)                        │
│  middleware/auth  会话校验 + 角色                                       │
│  db.js / schema.sql  better-sqlite3                                     │
│                                                                        │
│  SQLite 文件:server/data/pglib.db                                      │
└────────────────────────────────────────────────────────────────────────┘
```

要点:
- 渲染层(`content-renderer`/`quiz`/`wrongbook`/`exam-engine`/`panels`/`sidebar`/`main-learn`)**调用面不变** —— 仍用 `createStore(courseId).get/set(slot,…)`。变的只是 store 的「底层来源」:登录后由 `sync.js` 接管,做本地+远端双写。
- 后端只存**用户态数据**(进度/答题/错题/时长/主题/已上传课程元信息),**不存课程内容**(`.pigeon` 仍本地,IndexedDB)。
- 同步冲突用 **LWW(last-write-wins,按 `updated_at`)**:简单、可预测;复杂合并留作升级点。

> **MVP 技术栈(实现说明)**:数据库用 **Node 内置 `node:sqlite`**(需 Node ≥ 22.5),密码用 **`bcryptjs`(纯 JS)**——两者都**免原生编译**,`npm install` 不需要 Visual Studio 构建工具,装即用,贴合本项目「双击即跑」的取向。更高并发/更强安全可平滑换 better-sqlite3 + argon2(接口不变,见 §2 升级点)。

---

## 2. 功能清单:v1 vs 后期升级点

| 维度 | v1(本轮实现) | 后期升级点(本轮不做) |
|---|---|---|
| 认证 | 用户名 + 密码注册/登录/登出;httpOnly 会话 cookie | OAuth / 第三方登录、邮箱验证、找回密码、2FA |
| 账户 | 账户档案(用户名、角色、创建时间);改密码 | 头像、昵称、个人主页、绑定邮箱 |
| 同步 | 跨设备同步 progress/quiz/wrong/studyTime/theme + 已上传课程**元数据**;LWW 合并;去抖 push;离线缓冲回联补传 | 课程包字节云端托管、端到端加密、实时多端推送、更强冲突合并(CRDT/三方合并) |
| 角色 | 游客 / 普通用户 / 管理员 三级;管理面板(用户列表、禁用、全局统计) | 班级/组织、教师角色、细粒度 RBAC、审计日志 |
| 数据可携 | (无) | 导出 / 导入个人数据、跨账户迁移 |
| 排行/社交 | (无) | 排行榜、学习小组、评论 |

> v1 同步**不含 `.pigeon` 字节**:本地上传的课程包仍只在本机 IndexedDB;云端只记其**元信息**(id/title/...),换设备时提示「该课程未在本机,请重新上传」。这把首版复杂度与存储成本压到最低。

---

## 3. 角色与权限矩阵

| 能力 | 游客(未登录) | 普通用户 | 管理员 |
|---|:--:|:--:|:--:|
| 浏览/学习内置课程 | ✓ | ✓ | ✓ |
| 上传/学习本地课程 | ✓(本机) | ✓(本机) | ✓(本机) |
| 本地保存进度(本地档案) | ✓ | ✓ | ✓ |
| 跨设备同步进度 | ✗ | ✓ | ✓ |
| 管理账户(改本人密码) | ✗ | ✓ | ✓ |
| 查看用户列表 | ✗ | ✗ | ✓ |
| 禁用/启用用户、重置其密码 | ✗ | ✗ | ✓ |
| 查看全局统计 | ✗ | ✗ | ✓ |

- **管理员产生方式**:首次启动时,若库中无任何用户,则**首位注册者自动成为 admin**;或由 `.env` 的 `SEED_ADMIN`(可选)预置。二者取其一,文档与 README 说明。
- 角色存于 `users.role ∈ {'user','admin'}`。游客不是一条记录,是「无会话」状态。

---

## 4. 数据模型(SQLite)

```sql
-- schema.sql(server/ 启动时若表不存在则建)
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL UNIQUE,           -- 登录名,大小写敏感,3–32 字符
  pass_hash   TEXT    NOT NULL,                  -- bcrypt 哈希(含盐;升级可换 argon2id)
  role        TEXT    NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  disabled    INTEGER NOT NULL DEFAULT 0,        -- 0/1;禁用后不能登录
  created_at  INTEGER NOT NULL,                  -- epoch ms
  last_seen   INTEGER                            -- epoch ms,最近一次有效请求
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT    PRIMARY KEY,               -- 随机 256-bit,十六进制;作为 cookie 值
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL                   -- epoch ms;过期即失效
);

-- 每用户 × 每课程 × 每 slot 一行;data_json 是该 slot 的整块 JSON
CREATE TABLE IF NOT EXISTS user_state (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   TEXT    NOT NULL,                  -- 课程 id(含 '__global__' 表示站点级,如 theme)
  slot        TEXT    NOT NULL,                  -- 'progress'|'quiz'|'wrong'|'studyTime'|'theme'|'localCourses'
  data_json   TEXT    NOT NULL,                  -- 该 slot 的 JSON 字符串
  updated_at  INTEGER NOT NULL,                  -- epoch ms;LWW 比较键
  PRIMARY KEY (user_id, course_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_state_user ON user_state(user_id);
```

约定:
- **slot 枚举**与前端 store 对齐:课程级 `progress|quiz|wrong|studyTime`;站点级用保留 `course_id='__global__'` + `slot='theme'`(主题)、`slot='localCourses'`(已上传课程元信息清单)。
- `data_json` 原样存前端那一块状态(服务端不解释其结构,只按 `updated_at` 决定新旧),这样新增 slot 不必改表。
- 大小防护:单 `data_json` 上限(如 256KB),超限 413;`wrong` 已是数组,通常很小。

---

## 5. API 契约(端点表)

Base path:`/api`(便于反向代理)。请求/响应均 `application/json`。会话用 httpOnly cookie `pglib_sess`。

| 方法 & 路径 | 鉴权 | 请求体 | 成功响应 | 说明 |
|---|---|---|---|---|
| `POST /api/auth/register` | 公开 | `{username,password}` | `200 {user:{id,username,role}}` + Set-Cookie | 用户名唯一;首注册者→admin;弱口令 400 |
| `POST /api/auth/login` | 公开 | `{username,password}` | `200 {user:{...}}` + Set-Cookie | 失败 401;被禁用 403 |
| `POST /api/auth/logout` | 用户 | — | `204` | 删除会话 + 清 cookie |
| `GET  /api/me` | 用户 | — | `200 {user:{id,username,role}}` | 未登录 401(前端据此判定游客) |
| `POST /api/me/password` | 用户 | `{oldPassword,newPassword}` | `204` | 改本人密码 |
| `GET  /api/state/:courseId` | 用户 | — | `200 {slots:{slot:{data,updated_at}}}` | 拉该课程全部 slot(pull 用) |
| `GET  /api/state/:courseId/:slot` | 用户 | — | `200 {data,updated_at}` 或 `204` | 单 slot |
| `PUT  /api/state/:courseId/:slot` | 用户 | `{data,updated_at}` | `200 {applied:bool,updated_at}` | LWW:仅当传入 `updated_at` ≥ 库中才覆盖;`applied=false` 表示服务端更新 |
| `GET  /api/sync/:since?` | 用户 | — | `200 {states:[{course_id,slot,data,updated_at}]}` | 拉该用户**所有**课程自 `since` 后的变更(登录首拉/补传) |
| `GET  /api/admin/users` | admin | — | `200 {users:[{id,username,role,disabled,created_at,last_seen}]}` | 列表 |
| `PATCH /api/admin/users/:id` | admin | `{disabled?,role?,resetPassword?}` | `200 {user}` | 禁用/启用、改角色、重置密码(返回临时口令或要求改) |
| `GET  /api/admin/stats` | admin | — | `200 {userCount,active7d,stateRows,topCourses[]}` | 全局统计 |
| `GET  /api/health` | 公开 | — | `200 {ok:true}` | 健康检查(反代/NSSM 探活) |

错误体统一 `{error:{code,message}}`。常见:`400 bad_request`、`401 unauthorized`、`403 forbidden`、`404 not_found`、`409 username_taken`、`413 payload_too_large`、`429 rate_limited`。

---

## 6. 同步流程(时序)

### 6.1 登录后首次同步(pull → merge）
```
用户点登录 → POST /api/auth/login → 200 + cookie
  ↓
session.js 标记已登录(user)
  ↓
sync.js: GET /api/sync  ──▶ 服务端返回该用户所有 {course_id,slot,data,updated_at}
  ↓
对每条:与本地 pglib:u:<uid>:<course>:<slot> 比较 updated_at
   远端新 → 写本地;本地新 → 入「待 push 队列」;无本地 → 写本地
  ↓
把本地有、远端无 的 slot 也加入待 push 队列
  ↓
flush 待 push 队列(去抖)→ 逐条 PUT /api/state/:course/:slot
  ↓
UI 刷新(若当前在学习页,重渲染进度/错题)
```

### 6.2 学习过程中的增量 push（本地写触发）
```
渲染层 store.set(slot,val)
  → 本地立即写(local-first,永不阻塞 UI)
  → 标记该 (course,slot) dirty,记 updated_at = now
  → 去抖(如 1.5s)后 PUT /api/state/:course/:slot {data,updated_at}
      → 网络失败:留在 dirty 队列,下次写或重连/定时再试(离线缓冲)
      → 200 applied=false(服务端更新):拉回服务端版本并合并到本地
```

### 6.3 退化路径
- **无后端 / 请求失败 / 未登录**:`sync.js` 不参与,`createStore` 纯本地。UI 无任何报错,等价现状。
- **会话过期(401)**:静默转游客(保留本地档案),顶栏提示「登录已过期,请重新登录」。

> 合并粒度 = **整块 slot**(不是逐字段)。`progress` 是 `{kpId:status}` 对象,LWW 会整体覆盖——v1 接受「以最近保存的设备为准」。逐知识点级合并是升级点。

---

## 7. 隔离与本地 key 命名空间迁移

### 7.1 现状 → 目标
- 现状:`pglib:<courseId>:<slot>`(课程级)、`pglib:<key>`(站点级,如 `pglib:theme`、本设计新增的 `pglib:lastCourse`)。
- 目标:用户维度前缀
  - 课程级:`pglib:u:<uid|local>:<courseId>:<slot>`
  - 站点级:`pglib:u:<uid|local>:<key>`(注:`theme`/`lastCourse` 是否随账户走?见下)
- `<uid>` = 登录用户 id;未登录 = 字面量 `local`(本地档案)。

### 7.2 迁移(一次性,幂等)
首次加载新版本时,`store.js` 执行迁移:把所有旧 `pglib:<courseId>:<slot>`(不含 `u:` 段、且非保留全局键)搬到 `pglib:u:local:<courseId>:<slot>`,迁移后打一个 `pglib:migrated=1` 标记,避免重复。`theme` 这类站点偏好保留为站点级(不进用户命名空间),保证未登录也共享主题。

### 7.3 登录态切换的数据可见性
- 游客期间产生的数据在 `…:u:local:…`。
- 登录后读 `…:u:<uid>:…`;`sync.js` 在首次 pull 后,可选地把 `local` 档案**并入**当前账户(询问用户「把本机访客进度并入此账户?」)——v1 做**简单策略**:登录后若账户某 slot 为空而 `local` 有,则把 `local` 作为初始值 push 上去;否则以账户为准。该策略写进 `sync.js` 注释。

---

## 8. 页面线框(ASCII)

### 8.1 顶栏账户菜单(home & learn 复用)
```
未登录:                          已登录:
┌───────────────────────────┐    ┌───────────────────────────┐
│ … 课程  格式  关于   [登录]│    │ … 课程  格式  关于   [▼ 阿狸]│
└───────────────────────────┘    └───────────────────────────┘
                                       点击展开 ▼
                                  ┌───────────────────┐
                                  │ 阿狸  (普通用户)   │
                                  │ ───────────────── │
                                  │ 同步状态:已同步 ✓ │
                                  │ 修改密码          │
                                  │ 管理面板  (admin) │
                                  │ 退出登录          │
                                  └───────────────────┘
```

### 8.2 登录 / 注册(弹窗,二选一切换)
```
┌──────── 登录 PigeonLib ────────┐
│  邮政编辑风纸卡 · 无竖线        │
│  用户名 [______________]       │
│  密  码 [______________]       │
│  [ 登录 ]            注册 →     │
│  本地档案不受影响,登录仅开启同步│
└────────────────────────────────┘
```

### 8.3 管理面板(`admin.html` 或 home 内视图,仅 admin)
```
┌── 管理面板 ───────────────────────────────────────┐
│ 概览: 用户 12 · 近7日活跃 5 · 状态行 340         │
│ ────────────────────────────────────────────────  │
│ 用户          角色     状态     创建        操作    │
│ 阿狸          admin    正常     2026-06-01  —       │
│ 小灰          user     正常     2026-06-10  [禁用]  │
│ 测试号        user     已禁用   2026-06-12  [启用]  │
│                                          [重置密码] │
└────────────────────────────────────────────────────┘
```

> 三处 UI 一律守设计系统:令牌配色、无 emoji(用 `icon()`)、无 `border-left/right` 竖线、serif 标题 / mono 数据、亮暗双主题。

---

## 9. 安全模型

- **密码**:`bcrypt` 哈希(`bcryptjs`,内置盐;升级点可换 argon2id);绝不存明文、不可逆。最小口令策略(≥8 字符,前端+后端双校验)。
- **会话**:登录签发随机 256-bit token,存 `sessions` 表;下发 **httpOnly + SameSite=Lax + Secure(生产)** cookie;服务端按 token 查会话+用户;过期清理。登出删除会话行 + 清 cookie。
- **CORS**:白名单源(dev `http://localhost:5173`,生产同源或配置的前端源);`credentials: true`。
- **限流**:`/auth/*` 基础限流(如每 IP 每分钟 N 次),抵御撞库。
- **最小权限**:`admin/*` 全部经角色中间件;普通用户只能读写自己的 `user_state`(服务端按会话 `user_id`,**不信任**请求里的任何 user 标识)。
- **输入校验**:用户名/口令长度与字符校验;`data_json` 大小上限;`:slot` 仅允许枚举值。
- **密钥/配置**:会话密钥、端口、CORS 源、SEED_ADMIN 等走 `.env`(提供 `.env.example`)。**真实密钥由用户本机配置,实现者/AI 不经手真实凭据。**
- **不在 URL 放敏感数据**;错误信息不泄漏「用户名是否存在」(登录失败统一 `401 unauthorized`)。

---

## 10. 部署对齐(与 deployment-guide 呼应)

- 后端默认端口 `8787`;dev 时前端 `5173` 跨源调后端(CORS 白名单 + cookie credentials)。
- 生产两种形态:
  1. **同机同源**:用反向代理(IIS / Nginx)把 `/api/*` 转后端、其余静态服务 `app/dist/`,无跨域、cookie 同源最简。
  2. **分离部署**:前端静态托管 + 后端独立域名,配 CORS 白名单 + `Secure` cookie + HTTPS。
- Windows Server:用 NSSM 把 `node server/index.js` 注册为服务;IIS(ARR)反代 `/api` → `127.0.0.1:8787`;防火墙放行。细节落 `deployment-guide.md`。
- SQLite 文件 `server/data/pglib.db` 需随服务持久化与备份。

---

## 11. 执行顺序与检查点

1. **本设计稿**(本文件)—— 作为契约。
2. **后端 MVP `server/`** —— 按 §4/§5/§9 实现;`curl`/脚本冒烟:注册→登录→PUT/GET state→admin 列表→登出;断言密码不落明文。
3. **前端集成** —— `session.js` + `sync.js` 包装 `createStore`;key 迁移;顶栏账户菜单;管理面板;守设计系统。
4. **收尾** —— 启动器可选双进程拉起后端;回填 `deployment-guide.md`;更新 `CLAUDE.md` 不变量为「静态前端 + 可选后端」。

验收(端到端):两套 localStorage / 两浏览器登录同账户 → 进度/错题/时长接续;游客与离线仍可用;`admin` 能管理用户;无后端时前端零报错退化为本地档案。
