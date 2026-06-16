# CLAUDE.md — PigeonLib 项目总纲

> 本文件是项目的**总纲与规范索引**,面向人与 AI/agent。动手前先读这里;细则见下方索引指向的专文。
> 面向用户的介绍与上手见 [`README.md`](./README.md)。

## 一、这是什么

PigeonLib 是一个**内容与平台解耦**的课程学习平台(纯静态,Vite 构建,无后端)。
课程打包成独立的 `.pigeon` 文件(本质是 zip),由网站在浏览器本地解压、渲染;**换一门课无需改一行网站代码**。

- 首页 `app/index.html`:浏览内置课程、上传 `.pigeon`、查看格式说明。
- 学习页 `app/learn.html?course=<id>`:目录树、知识卡片、小节小测、章节考试、错题本、术语速查、亮/暗主题。

## 二、目录导览

```
app/                 网站源码(Vite)
  index.html / learn.html   两个入口
  src/core/          与内容无关的引擎:store / theme / pigeon-loader / course-registry / icons
  src/render/        内容渲染器:content / sidebar / quiz / exam-engine / glossary / wrongbook / panels / utils
  src/styles/        tokens.css(设计令牌·单一来源) / home.css(首页) / learn.css(学习页)
  public/            站点静态资源(brand-logo.svg)
courses/<id>/        课程包源(解包形态):manifest/content/quiz/glossary.json + cover.png + assets/images
tools/               build-pigeon.mjs(打包) / extract-ic-course.mjs(从原站抽取) / migrate-quiz.mjs(题库迁移)
dist-courses/        打包产物 *.pigeon
docs/                格式契约、设计系统、代码规范、agent 工作流、AI 制作提示词
参考项目/             原始硬编码站点(只读基线)
启动PigeonLib.bat    一键启动器
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

## 四、不变量(硬约束,勿违反)

1. **`参考项目/` 只读** —— 永不修改,仅作基线参考。
2. **课程内容数据**(`courses/*/content.json` 等)非因需求勿改;改了要重新 `build-pigeon` 打包。
3. **`.pigeon` 契约以 [`docs/pigeon-format.md`](./docs/pigeon-format.md) 为唯一权威** —— 改字段先改该文档,再改代码。
4. **文档随代码同步更新**:结构/功能变更时,同步更新对应目录 README、根 README 与本索引(见 agent-workflow)。

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
| [`docs/agent-workflow.md`](./docs/agent-workflow.md) | **agent/codex 执行规范**、构建/提交/QA、文档维护规则 |
| [`docs/pigeon-format.md`](./docs/pigeon-format.md) | `.pigeon` 课程包格式**契约(权威)** |
| [`docs/ai-course-authoring-prompt.md`](./docs/ai-course-authoring-prompt.md) | 给 AI 的课程制作提示词 |
| [`docs/首页布局参考.md`](./docs/首页布局参考.md) | 首页布局参考(历史记录) |
| 各目录 `README.md` | `app/`、`app/src/core/`、`app/src/render/`、`app/src/styles/`、`app/public/`、`courses/`、`tools/`、`dist-courses/`、`docs/` 各自的职责说明 |
