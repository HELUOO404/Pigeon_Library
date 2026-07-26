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
- 后端只存**用户态数据**(进度/答题/错题/仿真练习/时长/主题/已上传课程元信息),**不存课程内容**(`.pigeon` 仍本地,IndexedDB)。
- 同步冲突用 **LWW(last-write-wins,按 `updated_at`)**:简单、可预测;复杂合并留作升级点。

> **MVP 技术栈(实现说明)**:数据库用 **Node 内置 `node:sqlite`**(需 Node ≥ 22.5),密码用 **`bcryptjs`(纯 JS)**——两者都**免原生编译**,`npm install` 不需要 Visual Studio 构建工具,装即用,贴合本项目「双击即跑」的取向。更高并发/更强安全可平滑换 better-sqlite3 + argon2(接口不变,见 §2 升级点)。

---

## 2. 功能清单:v1 vs 后期升级点

| 维度 | v1(本轮实现) | 后期升级点(本轮不做) |
|---|---|---|
| 认证 | 用户名 + 密码注册/登录/登出;httpOnly 会话 cookie | OAuth / 第三方登录、邮箱验证、找回密码、2FA |
| 账户 | 账户档案(用户名、角色、创建时间);改密码 | 头像、昵称、个人主页、绑定邮箱 |
| 同步 | 跨设备同步 progress/quiz/wrong/studyTime/simulations/theme + 已上传课程**元数据**;LWW 合并;去抖 push;离线缓冲回联补传 | 课程包字节云端托管、端到端加密、实时多端推送、更强冲突合并(CRDT/三方合并) |
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
  slot        TEXT    NOT NULL,                  -- 'progress'|'quiz'|'wrong'|'studyTime'|'simulations'|'theme'|'localCourses'
  data_json   TEXT    NOT NULL,                  -- 该 slot 的 JSON 字符串
  updated_at  INTEGER NOT NULL,                  -- epoch ms;LWW 比较键
  PRIMARY KEY (user_id, course_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_state_user ON user_state(user_id);
```

约定:
- **slot 枚举**与前端 store 对齐:课程级 `progress|quiz|wrong|studyTime|simulations`;站点级用保留 `course_id='__global__'` + `slot='theme'`(主题)、`slot='localCourses'`(已上传课程元信息清单)。
- `data_json` 原样存前端那一块状态(服务端不解释其结构,只按 `updated_at` 决定新旧),这样新增 slot 不必改表。
- 大小防护:单 `data_json` 上限(如 256KB),超限 413;`wrong` 已是数组,通常很小。

---

## 5. API 契约(端点表)

Base path:`/api`(便于反向代理)。请求/响应均 `application/json`。会话用 httpOnly cookie `pglib_sess`。

| 方法 & 路径 | 鉴权 | 请求体 | 成功响应 | 说明 |
|---|---|---|---|---|
| `POST /api/auth/register` | 公开 | `{username,password}` | `200 {user:{id,username,role,created_at}}` + Set-Cookie | 用户名唯一;首注册者→admin;弱口令 400 |
| `POST /api/auth/login` | 公开 | `{username,password}` | `200 {user:{...}}` + Set-Cookie | 失败 401;被禁用 403 |
| `POST /api/auth/logout` | 用户 | — | `204` | 删除会话 + 清 cookie |
| `GET  /api/me` | 用户 | — | `200 {user:{id,username,role,created_at}}` | 未登录 401(前端据此判定游客);`created_at` 供个人中心显示注册时间 |
| `POST /api/me/password` | 用户 | `{oldPassword,newPassword}` | `204` | 改本人密码 |
| `POST /api/me/username` | 用户 | `{username,password}` | `200 {user:{...}}` | 自助改用户名:校验当前密码 + 用户名格式 + 查重(占用 409);用户名变更为快照语义,不回写历史已发布课署名与历史评论 |
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

---

## 12. 管理后台增强(v1.1 · 本轮)

> 在 v1 的「用户列表 / 禁用 / 重置密码 / 4 项统计」基础上,把管理面板做成可用的**运营控制台**。
> 原则不变:后端只读写用户态聚合,**不暴露明文密码、不暴露学习者具体答案**,只新增 admin 可见数据。

### 12.1 数据模型增量

```sql
-- sessions 增列(为「会话 / 安全」面板提供最近登录来源;旧库用 ALTER 幂等补列)
ALTER TABLE sessions ADD COLUMN ip          TEXT;   -- 登录时的 req.ip(生产经反代需 trust proxy)
ALTER TABLE sessions ADD COLUMN user_agent  TEXT;   -- 登录时 UA(截断存储)

-- 审计日志:每次管理员的变更操作留痕(问责)
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER NOT NULL,          -- 执行操作的管理员 user id
  actor_name  TEXT    NOT NULL,          -- 冗余存用户名(被删用户后仍可读)
  action      TEXT    NOT NULL,          -- disable|enable|set_role|reset_pw|rename|delete|create|force_logout|reset_state
  target_id   INTEGER,                   -- 受影响用户 id(可空)
  target_name TEXT,                      -- 受影响用户名(冗余)
  detail      TEXT,                      -- 简短补充(如「角色 user→admin」)
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
```

> `user_state.data_json` 仍是不透明块:服务端不知课程总节数,**完成率% 无法在服务端算**;课程分析只给「学习者数 / 最近活动 / 占用字节 / 同步行数」等可聚合量。深度指标(进度%、考分)留前端(持有课程结构时)或后续升级。
> 活跃趋势同理:`last_seen` 只存最近一次,**无法重建历史每日活跃**;故趋势图给「每日新增 + 累计用户」(均由 `created_at` 真实可算),不伪造每日活跃序列。

### 12.2 新增 / 扩展 API(均 admin 守卫,变更类一律写 audit_log)

| 方法 & 路径 | 请求 | 响应 | 说明 |
|---|---|---|---|
| `GET /api/admin/stats` | — | 扩展统计对象 | 总数 / 今日·7·30 日新增 / 活跃(今·7·30,按 last_seen 快照)/ 管理员 / 禁用 / 从未登录 / 有效会话 / DB 字节 / 同步行 / 课程数 |
| `GET /api/admin/users` | `?q&role&status&sort&dir&page&pageSize` | `{users,total,page,pageSize}` | 搜索 / 筛选(角色·状态)/ 排序 / 分页 |
| `GET /api/admin/users/:id` | — | `{user,sessionCount,courses[]}` | 单用户下钻:账户 + 会话数 + 涉及课程(各课最近活动 / 字节) |
| `PATCH /api/admin/users/:id` | `{disabled?,role?,resetPassword?,username?}` | `{user}` | 增 `username` 改名;最后管理员防呆 |
| `POST /api/admin/users` | `{username,password,role}` | `{user}` | 管理员建号 |
| `DELETE /api/admin/users/:id` | — | `{deleted}` | 删除(CASCADE 清会话 + 状态);禁删自己 / 最后管理员 |
| `POST /api/admin/users/:id/logout` | — | `{revoked}` | 强制下线(吊销该用户全部会话) |
| `DELETE /api/admin/users/:id/state` | `?course=<id|all>` | `{removed}` | 清空该用户某课 / 全部同步数据 |
| `GET /api/admin/courses` | — | `{courses[]}` | 每课:学习者数 / 最近活动 / 字节 / 行数 |
| `GET /api/admin/sessions` | — | `{sessions[]}` | 当前有效会话(用户名 + 创建 + 过期 + IP + UA) |
| `DELETE /api/admin/sessions/:token` | — | `{revoked}` | 吊销单个会话 |
| `GET /api/admin/trends` | `?days=14` | `{registrations[],cumulative[]}` | 按天:新增数 / 累计用户(供 sparkline) |
| `GET /api/admin/audit` | `?limit=50` | `{entries[]}` | 审计日志(倒序) |

### 12.3 前端(`admin.html` / `main-admin.js` / `admin.css`)

- 布局:**KPI 条 → 趋势(双 sparkline)→ 两栏(课程分析 | 有效会话)→ 用户控制台(搜索·筛选·排序·分页 + 表)→ 单用户下钻抽屉 → 审计日志**;建号弹窗;CSV 导出。
- 守设计系统:令牌配色 + 动效令牌、无 emoji(`icon()`)、无竖向装饰线、serif 标题 / mono 数据、亮暗双主题、`:focus-visible`、`prefers-reduced-motion`。
- 破坏性操作(删除 / 禁用 / 强制下线 / 清空进度 / 降级)均**二次确认** + 提交中禁用按钮防重复。

### 12.4 本轮不做(标注,后续单独一轮)

- 失败登录次数 / 自动锁定(需 `login_attempts` 表 + 撞库逻辑)。
- 历史留存 cohort / DAU-WAU-MAU 时序(需每日活跃打点表;现仅能用 `last_seen` 快照近似)。
- 站点维护横幅 / 公告广播(需全局 `settings` + 公开端点 + 注入 home/learn)。

---

## 13. 课程广场 + 私人课程(v1.2 · 本轮 · 权威)

> 把首页从「内置 / 本地」二分,升级为 **课程广场(公开·审核发布)+ 我的课程(私人·登录态)**。
> 服务端首次承载**课程文件**(`.pigeon`),并引入**审核发布、版本管理、评分/评论/下载量、书架、创作者数据**。
> **本地优先不破(不变量 5)**:不接后端时,首页仍显示**内置预置课**(随站打包),仅「上传 / 发布 / 广场扩展课 / 社交 / 书架」等需后端的能力退化禁用。

### 13.0 关键决策(已确认)

| 维度 | 决策 |
|---|---|
| 私人课存储 | **必须登录** → 服务端权威 + 跨设备;IndexedDB 仅作已下载课的离线缓存 |
| 未登录上传 | **不允许**:点上传入口直接弹登录框,不写本地 |
| 分类 | 平台预设枚举,**发布时选**,存 DB,**不写入 `.pigeon`** |
| 内置课 | 作为**广场预置课**,发布人 = `manifest.author`(PigeonLib) |
| 评论 | **显示用户名 + 先发后审**(作者删己评、管理员删任意,软删) |
| 版本 | **多版本保留 + 新版重审**,历史版可下载,学习默认走当前版 |
| 下载量 | **去重学习人数**(distinct) |

### 13.1 三类课程与存储分层

| 来源 | 存储 | 关联键 | 无后端时 |
|---|---|---|---|
| 内置课 | 随站打包 `app/dist/courses/*.pigeon` + 前端常量保底 | `course_key` | ✅ 可见可学 |
| 私人课(用户上传) | 登录 → 服务端权威;IndexedDB 离线缓存 | `courses.id` / `course_key` | 仅内置可见,不能上传 |
| 广场课(审核发布) | 服务端 `current_version.status=published` | `course_key`(去重展示单位) | 仅内置预置课 |

- 广场展示 = 内置保底课 ∪ 服务端 published 课,按 `course_key` 去重(服务端优先)。

### 13.2 数据模型(SQLite,沿用 `CREATE IF NOT EXISTS` 幂等风格)

```sql
-- 课级元数据 + 版本指针
CREATE TABLE IF NOT EXISTS courses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_key        TEXT    NOT NULL,         -- manifest.id(展示/进度/社交/书架关联键,可重复)
  title             TEXT    NOT NULL,
  subtitle          TEXT,
  description       TEXT,                     -- manifest.description(课程简介,详情弹窗展示;服务端解析提取)
  author            TEXT,                     -- manifest.author(原始创作者)
  publisher_name    TEXT    NOT NULL,         -- 发布人(卡片 tag):用户课=上传者 username,内置=author
  category          TEXT,                     -- 预设分类枚举之一(非法回退「其他」)
  status            TEXT    NOT NULL DEFAULT 'private', -- private|pending|published|rejected(由版本推导维护)
  visible           INTEGER NOT NULL DEFAULT 1, -- 公开列表展示开关，不改变审核状态
  cover_mode        TEXT    NOT NULL DEFAULT 'default', -- default|image|text
  cover_image       TEXT,                     -- 管理员图片封面 data URL，原图 <= 600 KB
  cover_text        TEXT,                     -- 管理员文字封面，1 至 6 个 Unicode 字符
  current_version_id INTEGER,                 -- 广场展示的「当前已发布版」
  latest_version_id  INTEGER,                 -- 最新上传版(可能 pending)
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courses_owner  ON courses(owner_id);
CREATE INDEX IF NOT EXISTS idx_courses_status ON courses(status);
CREATE INDEX IF NOT EXISTS idx_courses_key    ON courses(course_key);

-- 内置课在线元数据覆盖；前端常量仍是无后端时的离线默认值
CREATE TABLE IF NOT EXISTS builtin_course_overrides (
  course_key      TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  subtitle        TEXT,
  description     TEXT,
  author          TEXT,
  publisher_name  TEXT NOT NULL,
  category        TEXT,
  hidden          INTEGER NOT NULL DEFAULT 0,
  visible         INTEGER NOT NULL DEFAULT 1, -- 公开列表展示开关，不改变审核状态
  cover_mode      TEXT    NOT NULL DEFAULT 'default', -- default|image|text
  cover_image     TEXT,                       -- 管理员图片封面 data URL，原图 <= 600 KB
  cover_text      TEXT,                       -- 管理员文字封面，1 至 6 个 Unicode 字符
  updated_at      INTEGER NOT NULL
);

-- 版本级文件(多版本核心)
CREATE TABLE IF NOT EXISTS course_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  version      TEXT,                          -- manifest.version
  status       TEXT    NOT NULL DEFAULT 'private', -- private|pending|published|rejected(本版自己的审核态)
  file_path    TEXT    NOT NULL,              -- server/data/courses/<courseId>/<versionId>.pigeon
  file_size    INTEGER NOT NULL,
  file_hash    TEXT,                          -- sha256
  stats_json   TEXT,                          -- {chapters,knowledgePoints,questions}(服务端解析,权威)
  cover_data   TEXT,                          -- base64 缩略(卡片用,无图为空)
  cover_text   TEXT,                          -- manifest.coverText(版本级默认文字封面)
  cover_text_checked INTEGER NOT NULL DEFAULT 0, -- 旧包文字封面回填已处理(含无封面/失败)
  review_note  TEXT,                          -- 拒绝原因
  reviewer_id  INTEGER,
  created_at   INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_versions_course ON course_versions(course_id);

-- 评分:每用户每课一条(可改)
CREATE TABLE IF NOT EXISTS course_ratings (
  course_key  TEXT    NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,               -- 1..5
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (course_key, user_id)
);

-- 评论:先发后审,软删
CREATE TABLE IF NOT EXISTS course_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  course_key  TEXT    NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username    TEXT    NOT NULL,               -- 冗余存名(删号后可显示「已注销」)
  body        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'visible', -- visible|hidden(作者/管理员软删)
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_course ON course_comments(course_key, created_at);

-- 下载去重(distinct 学习人数)
CREATE TABLE IF NOT EXISTS course_downloads (
  course_key  TEXT    NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_at    INTEGER NOT NULL,
  PRIMARY KEY (course_key, user_id)
);

-- 书架(收藏)
CREATE TABLE IF NOT EXISTS bookshelf (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_key  TEXT    NOT NULL,
  added_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, course_key)
);
```

文件存储:`server/data/courses/<courseId>/<versionId>.pigeon`;上传上限沿用 `.pigeon` 格式上限 **50MB**(multer limits)。服务端在解包前拒绝 ZIP64，并通过 ZIP 中央目录预检最多 2048 个条目与声明解压尺寸；随后用 `fflate` 流式解包，按实际输出字节再次强制累计不超过 64 MiB，并校验中央目录声明的条目大小与 CRC 后再**提取权威元数据**(不信任前端传入)。旧库启动时幂等新增 `course_versions.cover_text` 与 `cover_text_checked`，并尽力从既有包回填；成功、无文字封面、文件缺失、损坏或超限都会持久标记为已处理，后续启动不再同步解析该行。不阻塞启动，也不改写包字节。

### 13.3 课程标识与进度命名空间

- `courses.id`(自增)= 课程主键;`course_key = manifest.id`(展示/进度/社交/书架的关联键,可重复)。
- **进度命名空间仍用 `course_key`**(`pglib:u:<uid>:<course_key>:<slot>`),换设备 / 重新下载进度不丢。
- 学习页 URL:内置 `learn.html?course=<course_key>`;服务端课 `learn.html?course=<course_key>&src=<courseId>`(带 `src` 走服务端下载);审核预览 `&preview=1`。

### 13.4 审核状态机(作用于**版本**)

```
作者首传 → courses(private) + course_versions v1(private)
作者发布某版 → 该版 pending
管理员 approve → 该版 published;courses.current_version_id ← 该版;courses.status=published;记 published_at + audit
管理员 reject  → 该版 rejected + review_note;courses.status 回退(若无已发布版则 private);audit
作者再传新版 → 新增 course_versions 行(private);latest_version_id ← 新版
作者发布新版 → pending → approve → current_version_id 切到新版(旧版保留)
管理员 takedown → 已发布课下架 → current 版回 private,广场移除;audit
```
- 历史版本文件与记录**保留**:课程详情 / 个人主页可查看版本列表、下载历史版。

### 13.5 API 契约

**用户端 `/api/courses`**
| 方法 路径 | 请求 | 守卫 | 说明 |
|---|---|---|---|
| `POST /` | multipart(file, category?) | requireUser | 上传私人课(建 courses+v1) |
| `GET /mine` | — | requireUser | 我的课程(含状态 / 版本指针) |
| `GET /square` | `?q&category&publisher&page` | 公开 | 广场已发布课(筛选 / 分页) |
| `GET /:id/file` | — | owner \| admin \| published | 下载 .pigeon;成功 upsert `course_downloads` |
| `GET /:id/analytics` | — | **仅 owner** | 聚合学习数据(只回数字,见 13.6) |
| `POST /:id/publish` | `{category}` | owner | 发布当前最新版 → pending |
| `POST /:id/unpublish` | — | owner | 撤回 → private |
| `PATCH /:id` | `{category?...}` | owner | 改元数据 |
| `DELETE /:id` | — | owner | 删课(连同版本文件) |
| `POST /:id/versions` | multipart | owner | 上传新版本 |
| `GET /:id/versions` | — | owner \| admin | 版本列表 |
| `POST /:id/versions/:vid/publish` | — | owner | 发布指定版 → pending |

**社交 `/api/courses/c/:key`(以 `course_key` 为单位)**
| 方法 路径 | 守卫 | 说明 |
|---|---|---|
| `GET /social` | 公开 | `{avgRating,ratingCount,myRating,downloadCount,commentCount}` |
| `PUT /rating` `{score}` | requireUser | 打分 / 改分(1..5) |
| `GET /comments` `?before=` | 公开 | 评论分页(倒序,仅 visible) |
| `POST /comments` `{body}` | requireUser | 发评论(先发后审,即时可见) |
| `DELETE /api/courses/comments/:cid` | requireUser | 删评论(作者本人 / admin,软删) |

**书架 `/api/bookshelf`**
| 方法 路径 | 守卫 | 说明 |
|---|---|---|
| `GET /` | requireUser | 我的书架(course_key 列表 + 课程摘要) |
| `PUT /:key` | requireUser | 加入书架 |
| `DELETE /:key` | requireUser | 移出书架 |

**管理端 `/api/admin/courses`(requireAdmin,变更写 audit_log)**
| 方法 路径 | 说明 |
|---|---|
| `GET /pending` | 待审版本队列(课 + 版本 + 发布人 + 分类 + 大小 + 提交时间) |
| `GET /` | 全部课程总览(可按 status 筛) |
| `GET /:ref` | 读取一门课程的管理元数据；`ref` 为数字课程 ID 或 `builtin:<course_key>` |
| `PATCH /:ref` multipart(`title,subtitle,category,publisherName,author,description,visible,coverMode,coverText,coverImage?`) → `{course}` | 编辑课程元数据和封面；`visible` 是布尔值，multipart 中使用 `"true"|"false"`；`ref` 为数字课程 ID 或 `builtin:<course_key>` |
| `DELETE /:ref` | 删除服务端课程及版本文件；内置课写 `hidden=1` 墓碑 |
| `POST /:id/versions/:vid/approve` | 通过 → published + 切 current_version_id |
| `POST /:id/versions/:vid/reject` `{note}` | 拒绝 → rejected + review_note |
| `POST /:id/takedown` | 已发布下架 → private |

错误格式沿用 `authError(res,status,code,message)`;新增码:`not_owner`、`course_not_found`、`bad_pigeon`、`payload_too_large`、`already_published`。

管理员元数据校验上限：标题 120、副标题 180、发布人 120、作者 120、简介 2000 字符；标题和发布人不能为空，分类为空或取预设枚举。multipart 最多 9 个文本字段、1 个文件和 10 个 part。`visible=false` 只从公开列表隐藏课程，不改变审核状态、记录或可编辑性；内置课的 `hidden=1` 是删除后的墓碑，阻止该内置课回到列表。封面模式为 `default|image|text`：图片字段名为 `coverImage`，原图最多 600 KB，只接受 PNG/JPEG/WebP 且校验文件签名；文字封面为 1 至 6 个 Unicode 字符。有效封面优先级为「图片覆盖 → 文字覆盖 → 课程包/内置默认 → 标题首字符」。后端不可用时仍显示随站打包的内置默认封面。编辑/删除分别记 `course_edit` / `course_delete` 审计。删除课程不清理按 `course_key` 独立存储的学习进度、评分、评论与书架记录。

### 13.6 个人主页 + 创作者数据 + 隐私铁律

- **个人主页 `profile.html`**(仅登录):分区「我创作的」(我的课 + 版本列表 + 聚合学习数据)/「我的书架」(收藏课 + **本人**学习情况)。账户下拉新增「个人主页」「我的书架」入口。
- **聚合学习数据**(`GET /:id/analytics`,仅 owner):按 `course_key` 聚合 `user_state`:
  - `learners` = `COUNT(DISTINCT user_id)`
  - `totalStudyMs` / `avgStudyMs` = 解析各学习者 `studyTime` slot 求和 / 均值
  - `active7d` = 近 7 天 `updated_at` 有更新的学习者数
- **隐私铁律(不可违反)**:学习数据 / 下载人数 / 书架等**被学习者非自愿**的行为数据,任何接口**只返回聚合数字**,**绝不**返回 user_id / username / IP / 任何可定位个体的字段;非 owner 调 analytics → `403 not_owner`。
- **唯一露名例外**:评论区显示发言人 username —— 那是发言人**自愿公开**的言论,与上面不矛盾。

### 13.7 前端页面与降级

- **首页**:两区 tab(课程广场 / 我的课程),各自工具栏(搜索 + 分类下拉 + 广场发布人下拉 / 我的状态下拉);卡片 tag=`publisher_name`,加 ★均分·⬇人数 轻量徽(mono);课程详情弹层承载评分 / 评论 / 下载量 / 版本 / 开始学习 / 加入书架。
- **守设计系统**:令牌配色 + 动效令牌、无 UI emoji、无竖向装饰线、serif 标题 / mono 数据、亮暗双主题、`:focus-visible`、`prefers-reduced-motion`、破坏性操作二次确认 + 在途禁用。
- **本地优先降级**:无后端 / 未登录 → 广场仅内置课;上传 / 发布 / 评分 / 评论 / 书架按钮禁用并提示「登录并启动同步后端后可用」。
- **内置课管理覆盖**:后端在线时，`GET /api/courses/square` 附带 `builtinOverrides`，首页将其合并到内置常量并过滤 `hidden=1`；后端离线时直接使用内置常量，静态课程包仍可学习。

### 13.8 本轮不做(划界)

- ❌ 课程独立详情路由页(用弹层);❌ 评论嵌套 / 点赞 / @;❌ 评分理由文本;❌ 按学习者锁定旧版本;❌ 书架分组 / 标签;❌ 课程评分 / 评论的服务端审核前置(本轮先发后审);❌ 私人课逐字段 LWW(服务端为权威 + 离线缓存)。

---

## 14. 课程简介 + 个人主页重构(v1.3 · 本轮 · 权威)

### 14.1 课程简介 `description`
- `.pigeon` manifest 增可选 `description`(课程简介,见 `pigeon-format.md` §1)。服务端 `pigeon-server.js` 解析提取(权威,不信前端),存 `courses.description`。
- 旧库迁移(沿用 §12.1 范式):`PRAGMA table_info(courses)` 缺 `description` 列则 `ALTER TABLE courses ADD COLUMN description TEXT`(幂等)。
- 下发:`GET /api/courses/square`、`GET /api/courses/mine` 的卡片行附带 `description`;前端 `normalizeServerCourse` 归一为 `description`。内置课由前端读 `manifest.description`。
- 展示:课程详情弹层新增「课程简介」区,取 `description`,缺省回退 `subtitle`。

### 14.2 自助改用户名
- `POST /api/me/username`(见 §5):requireUser,body `{username,password}`。流程:校验用户名格式(复用注册规则)→ `bcrypt.compareSync` 校验当前密码(失败 401)→ `users.byUsername` 查重(占用且非本人 → `409 username_taken`)→ `users.rename(id,username)` → 返回 `publicUser`。
- `publicUser` 扩为 `{id,username,role,created_at}`(register/login/me 同源)。
- **快照语义**:用户名变更**不回写**已发布课程 `publisher_name` 与历史评论 `username`(均为发布/发言时的快照)。

### 14.3 个人主页改为左右分栏三区(`profile.html`)
- 左侧导航栏(类似学习页 sidebar)三项:**个人中心 / 我的作品 / 我的书架**;右侧内容随 `?tab=account|creator|shelf` 切换(默认 account)。
- **个人中心**:账户卡(用户名 + 角色 + 注册时间,**无头像**)+ 页内「编辑用户名 / 修改密码」表单 + **学习概览图表**(KPI 数字带 / 正确率环 / 章节考试战绩 / 逐课进度)。
- **我的作品**:沿用创作者中心,卡片补社交行(★均分 / ⬇学习人数 / 评论数,来自 social)+ 聚合学习数据 + 版本记录。
- **我的书架**:收藏课网格 + 本人学习情况。
- **学习统计数据源 = 纯本地**:个人中心图表只读 localStorage 当前用户命名空间(`progress/quiz/wrong/studyTime/exams`)聚合,**不新增服务端聚合接口**(本地优先;创作者「聚合学习数据」仍走 §13.6 的 owner-only analytics)。

### 14.4 章节考试成绩入档(新增本地 slot `exams`)
- 学习页新增 `exams` slot(`pglib:u:<uid>:<course_key>:exams`),`exam-engine.finishExam()` 在**真实章节考试**结束时追加一条成绩汇总 `{chapter,total,correct,score,t}`(错题重做 session 不计;只存汇总不存逐题)。
- 随 `__meta` 自动纳入既有 LWW 同步;重置学习进度时一并清空。
- 个人中心「综合做题数 / 正确率」= 小测(`quiz`)+ 考试(`exams`)合并统计。
