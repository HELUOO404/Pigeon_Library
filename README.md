# PigeonLib · 信鸽课程库

> 仓库:https://github.com/HELUOO404/Pigeon_Library
>
> 内容与平台解耦的课程学习平台。课程打包成独立的 `.pigeon` 文件(本质是 zip),由网站在浏览器本地解压渲染 —— **换一门课无需改一行网站代码**。**本地优先、可离线**;另带一个**可选**的轻量后端,登录后开启跨设备进度同步。

- **首页** `index.html`:浏览内置课程、上传 `.pigeon`、查看格式说明。
- **学习页** `learn.html?course=<id>`:目录树、知识卡片、小节小测、正计时章节考试(单选/判断/排序/匹配)、错题本、术语速查、亮/暗主题。

## 特性

- **内容解耦**:课程即 `.pigeon` 数据包,平台只负责渲染;任何人或 AI 都能制作并分享课程。
- **本地优先**:浏览器内解压(fflate),图片转 Blob URL,自包含、可离线;进度按课程隔离存于本地。
- **可选跨设备同步**:登录账户后,进度/错题/时长等通过轻量后端(Node + SQLite)在多设备间接续;不登录/不部署后端则等同纯静态本地档案。
- **邮政编辑风设计**:统一设计令牌、衬线标题、SVG 图标(无 emoji),亮/暗双主题。
- **可扩展格式**:原生块覆盖正文、列表、图片组、支持合并单元格多图的富表格和卡内 tab;`html` 仅作旧课程静态兼容位,需要 JS 的内容进入隔离 `sandbox`,可复用站点原生练习/答案模式控件并保存练习状态。

## 截图

> _(占位:可在此放首页与学习页截图)_

## 最快上手

**双击仓库根目录的 `启动PigeonLib.bat`** —— 自动(首次)安装依赖、打包内置课程、启动本地服务器并打开浏览器。

> 注意:不能直接双击 `app/index.html`(`file://`)打开 —— Chrome 在 `file://` 下禁止 ES 模块与本地 `fetch`,页面无法渲染。必须经 HTTP 源访问(启动器或 `npm run dev` 即提供本地服务器)。

## 开发 / 构建 / 部署

```bash
cd app
npm install
npm run dev        # http://localhost:5173/index.html(自动开浏览器)
npm run build      # 产出静态站点到 app/dist/
npm run preview    # 预览生产构建
```

**构建顺序(重要)**:`app/dist/` 的内置课程在构建时从 `dist-courses/ic-packaging.pigeon` 拷入。若该文件不存在,`npm run build` 仍成功但产物**无内置课程**(运行时 404)。首次构建前先打包课程:

```bash
node tools/build-pigeon.mjs ic-packaging   # 仓库根运行 → dist-courses/ic-packaging.pigeon
cd app && npm run build
```

(`启动PigeonLib.bat` 已自动处理。)部署:把 `app/dist/` 整目录交给任意静态服务器即可。

### 可选:跨设备同步后端

登录账户后,进度可在多设备间接续。后端是**可选**的渐进增强层 —— 不启动它,前端仍纯本地可用、可离线。

```bash
cd server
npm install
cp .env.example .env      # 按需改端口 / CORS 源 / 管理员种子
npm start                 # → http://localhost:8787
npm run smoke             # 可选:冒烟自测
```

首个注册的用户自动成为管理员(`admin.html` 管理面板)。技术栈用 Node 内置 `node:sqlite` + 纯 JS `bcryptjs`,**免原生编译**,装即用(需 Node ≥ 22.5)。契约见 [`docs/user-system-design.md`](./docs/user-system-design.md),细节见 [`server/README.md`](./server/README.md)。

## 目录结构

<!-- 维护点:目录结构变化时同步更新此处与 CLAUDE.md 的导览 -->

```
app/                 网站源码(Vite):index.html / learn.html / admin.html + src(core/render/styles) + public
server/              可选同步后端(Node + Express + node:sqlite + bcryptjs)
courses/<id>/        课程包源:manifest/content/quiz/glossary.json + cover.png + assets/images
tools/               build-pigeon(打包) / extract-ic-course(抽取) / migrate-quiz(题库迁移)
dist-courses/        打包产物 *.pigeon
docs/                格式契约、设计系统、代码规范、agent 工作流、AI 提示词、用户系统设计
参考项目/             原始硬编码站点(只读基线)
启动PigeonLib.bat    一键启动器(纯 ASCII 英文,自包含)
```

每个重要目录都有 `README.md` 说明其职责。

## 制作一个课程包

1. 在 `courses/<你的课程id>/` 按 [`docs/pigeon-format.md`](./docs/pigeon-format.md) 写 `manifest/content/quiz/glossary.json`(可写注释),图片放 `assets/images/`,封面 `cover.png`。
2. 打包:`node tools/build-pigeon.mjs <id>` → `dist-courses/<id>.pigeon`。
3. 在首页上传该 `.pigeon`(存浏览器 IndexedDB),或加入 `app/src/core/course-registry.js` 的 `BUILTIN_COURSES` 随站发布。

让 AI 把教材转成课程包:见 [`docs/ai-course-authoring-prompt.md`](./docs/ai-course-authoring-prompt.md)。`courses/demo-course/` 是最小示例模板。

## 规范与文档

项目总纲与**统一规范索引**:[`CLAUDE.md`](./CLAUDE.md)。

| 文档 | 内容 |
|---|---|
| [docs/pigeon-format.md](./docs/pigeon-format.md) | `.pigeon` 格式契约(权威) |
| [docs/user-system-design.md](./docs/user-system-design.md) | 用户系统/同步契约(架构·数据模型·API·安全) |
| [docs/deployment-guide.md](./docs/deployment-guide.md) | 部署指南(本地 / 静态 / Node 后端 / Windows Server) |
| [docs/design-system.md](./docs/design-system.md) | 设计系统:令牌 / 图标 / 禁用元素(emoji、竖线) |
| [docs/code-style.md](./docs/code-style.md) | 代码风格与中文注释规范 |
| [docs/agent-workflow.md](./docs/agent-workflow.md) | agent/codex 执行规范、构建/QA/提交 |
| [docs/ai-course-authoring-prompt.md](./docs/ai-course-authoring-prompt.md) | 给 AI 的课程制作提示词 |

> **文档动态更新**:结构或功能变更时,同步更新对应目录 README、本文件与 `CLAUDE.md` 索引,使文档始终反映现状(规则见 agent-workflow)。

## 技术要点

- 前端纯静态(Vite),本地优先;课程本地解压、图片转 Blob URL、可离线。可选后端(`server/`)仅作跨设备同步层。
- 进度/答题/错题/时长按 `pglib:u:<用户|local>:<courseId>:<slot>` 命名空间隔离(未登录 = `local` 访客档案);主题站点级共享。
- `.pigeon` 可扩展:优先使用原生内容块;`html` 仅兼容旧课程静态片段(相对资源路径加载时解析为 Blob URL),`sandbox` 负责隔离运行 JS 并可选外层练习/答案模式。课程作者可用 [`.claude/skills/pigeon-course-authoring`](./.claude/skills/pigeon-course-authoring/SKILL.md) 忠实制作,并经 `tools/pigeon-push.mjs` 推送到同步后端。

## 许可

> _(占位:上线前补充 LICENSE,例如 MIT)_
