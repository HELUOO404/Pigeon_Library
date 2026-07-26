# CLAUDE.md — PigeonLib 项目总纲

> 本文件是项目的**总纲与规范索引**,面向人与 AI/agent。动手前先读这里;细则见下方索引指向的专文。
> 面向用户的介绍与上手见 [`README.md`](./README.md)。

## 一、这是什么

PigeonLib 是一个**内容与平台解耦**的课程学习平台(**静态前端 + 可选轻量同步后端**,Vite 构建)。
课程打包成独立的 `.pigeon` 文件(本质是 zip),由网站在浏览器本地解压、渲染;**换一门课无需改一行网站代码**。
前端**本地优先、可离线**:不登录/不部署后端时等同纯静态;登录账户后才启用与 `server/`(Node + SQLite)的**跨设备进度同步**(渐进增强同步层,见 [`docs/user-system-design.md`](./docs/user-system-design.md))。

- 首页 `app/index.html`:浏览内置课程、上传 `.pigeon`、查看格式说明。
- 学习页 `app/learn.html?course=<id>`:目录树、知识卡片、小节小测、章节考试、错题本、术语速查、亮/暗主题。

## 二、目录导览

```
app/                 网站源码(Vite)
  index.html / learn.html / admin.html   三个入口(admin = 管理面板)
  src/core/          与内容无关的引擎:store / theme / pigeon-loader / course-registry / icons / toast
                     + 同步层:session(登录态) / sync(本地优先同步) / auth-ui(账户菜单/弹窗)
  src/render/        内容渲染器:content / sidebar / quiz / exam-engine / glossary / wrongbook / panels / utils
  src/styles/        tokens.css(设计令牌·单一来源) / home.css / learn.css / auth.css / admin.css
  public/            站点静态资源(brand-logo.svg)
server/              可选同步后端(Node + Express + node:sqlite + bcryptjs):auth/state/admin 路由
courses/<id>/        课程包源(解包形态):manifest/content/quiz/glossary.json + cover.png + assets/images
tools/               build-pigeon.mjs(打包) / pigeon-push.mjs(推送到同步后端) / extract-ic-course.mjs(从原站抽取) / migrate-quiz.mjs(题库迁移)
dist-courses/        打包产物 *.pigeon
docs/                格式契约、设计系统、代码规范、agent 工作流、AI 制作提示词、用户系统设计
参考项目/             原始硬编码站点(只读基线)
.claude/skills/      Claude Code Skill:pigeon-course-authoring(课程包制作,渐进式披露 + 示例)
启动PigeonLib.bat    一键启动器(纯 ASCII 英文,自包含;本机 cmd 解析中文 .bat 会乱码故用英文)
```
每个重要目录都有自己的 `README.md`,说明该目录职责与关键文件。

## 三、构建 / 运行

- **最快**:双击根目录 `启动PigeonLib.bat`(自动装依赖、打包内置课、起服务、开浏览器)。
- 手动:`cd app && npm install && npm run dev`(→ http://localhost:5173)。
- **构建顺序(重要)**:`app/dist/` 的内置课程是构建时从 `dist-courses/ic-packaging.pigeon` 拷入的。**首次构建前先打包课程**:
  ```bash
  node tools/build-pigeon.mjs ic-packaging   # 仓库根运行 → dist-courses/ic-packaging.pigeon
  cd app && npm run build
  ```
- 预览/QA(agent):`.claude/launch.json` 已配置,用 `preview_start("pigeonlib")` 起服务,再用 Preview MCP 截图/inspect。
- **可选同步后端**(跨设备进度同步):`cd server && npm install && cp .env.example .env && npm start`(→ http://localhost:8787)。不启动它前端仍纯本地可用;冒烟 `npm run smoke`。详见 [`server/README.md`](./server/README.md)。
- **AI 执行约定**:编程实现默认交 **codex** 子代理执行,Claude 负责设计与复核(详见 [`docs/agent-workflow.md`](./docs/agent-workflow.md) §一)。**例外**:含中文的既有源文件改写本机 codex 会乱码,改由 Claude 亲自编辑(见不变量 8)。

## 四、不变量(硬约束,勿违反)

1. **`参考项目/` 只读** —— 永不修改,仅作基线参考。
2. **课程内容数据**(`courses/*/content.json` 等)非因需求勿改;改了要重新 `build-pigeon` 打包。
3. **`.pigeon` 契约以 [`docs/pigeon-format.md`](./docs/pigeon-format.md) 为唯一权威** —— 改字段先改该文档,再改代码。
4. **用户系统契约以 [`docs/user-system-design.md`](./docs/user-system-design.md) 为权威** —— 改数据模型/API/同步流程先改该文档,再改 `server/` 与前端同步层。
5. **本地优先不可破**:前端不接后端必须仍能完整运行(纯本地、可离线);后端是**可选**同步层,任何远端调用失败都静默退化为本地档案,不得阻塞 UI 或抛错。
6. **安全**:Claude 不替用户输入任何真实账号/密码/密钥;`server/.env`、密钥、首个管理员口令均由用户本机配置。
7. **文档随代码同步更新**:结构/功能变更时,同步更新对应目录 README、根 README 与本索引(见 agent-workflow)。
8. **中文文件编码**:本机 codex 改写既有中文文件会乱码(见用户记忆);**含中文的既有源文件由 Claude 亲自用 Edit/Write 编辑**,codex 仅用于新建文件或纯逻辑文件,改后须验编码(无 BOM、无 mojibake)。

## 五、设计硬规则(摘要,细则见设计系统)

- **配色/令牌**:所有颜色走 `app/src/styles/tokens.css` 的令牌,**不写死色值**;调性 = 邮政编辑风(纸/墨/邮政金/印章红),无科技蓝。
- **禁 UI emoji**:界面图标一律用 SVG(`app/src/core/icons.js` 的 `icon()` / `[data-icon]` 占位,Lucide 子集)。方向/展开等排版箭头(→ ← ▾ ▸)按字体排版保留。课程**正文数据**里的 emoji 不在此限(作者内容自由)。
- **禁竖向装饰线**:不得用 `border-left/right` 给内容盒子加 accent 竖条;用横向 hairline / eyebrow / mono 序号 / 圆点 / 背景色差替代。
- **字体**:展示标题 `--serif`(Fraunces / Noto Serif SC)、正文 `--sans`(Noto Sans SC)、数据/徽章/计数 `--mono`(Space Mono)。

## 六、规范索引(全部规范从这里可达)

| 文件 | 职责 |
|------|------|
| `CLAUDE.md`(本文件) | 项目总纲、目录导览、不变量、设计硬规则、规范索引 |
| [`README.md`](./README.md) | 面向用户/GitHub 的项目介绍与上手(动态维护) |
| [`docs/design-system.md`](./docs/design-system.md) | 设计系统:令牌 / 字体字阶 / 组件 / **图标体系** / **禁用元素(emoji、竖线)** |
| [`docs/code-style.md`](./docs/code-style.md) | 代码风格与**中文注释规范** |
| [`docs/agent-workflow.md`](./docs/agent-workflow.md) | **agent/codex 执行规范**:**编程实现默认交 codex 执行、Claude 设计/复核**;构建/提交/QA、文档维护规则 |
| [`docs/pigeon-format.md`](./docs/pigeon-format.md) | `.pigeon` 课程包格式**契约(权威)** |
| [`tools/autosmt-2026/CONVERSION.md`](./tools/autosmt-2026/CONVERSION.md) | AutoSMT 2026 原站内容到新课程包的**唯一转换规范**、证据门禁与分阶段验收流程 |
| [`docs/user-system-design.md`](./docs/user-system-design.md) | **用户系统/同步契约(权威)**:架构、数据模型、API、同步流程、角色权限、安全 |
| [`docs/deployment-guide.md`](./docs/deployment-guide.md) | 部署指南:本地 / 静态托管 / Node 后端 / Windows Server(IIS 反代 + NSSM)/ CORS·cookie / 排错 |
| [`docs/ai-course-authoring-prompt.md`](./docs/ai-course-authoring-prompt.md) | 给 AI 的课程制作提示词 |
| [`.claude/skills/pigeon-course-authoring/`](./.claude/skills/pigeon-course-authoring/SKILL.md) | 课程包制作 Skill(Claude Code):工作流 + 格式速查 + 打包用法 + 示例课程 |
| [`docs/首页布局参考.md`](./docs/首页布局参考.md) | 首页布局参考(历史记录) |
| [`server/README.md`](./server/README.md) | 可选同步后端的起停、端点速查、安全要点 |
| 各目录 `README.md` | `app/`、`app/src/core/`、`app/src/render/`、`app/src/styles/`、`app/public/`、`server/`、`courses/`、`tools/`、`dist-courses/`、`docs/` 各自的职责说明 |
