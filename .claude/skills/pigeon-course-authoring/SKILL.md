---
name: pigeon-course-authoring
description: Author a PigeonLib .pigeon course package from teaching material. Use when the user wants to turn a textbook, lecture notes, or study material into a PigeonLib course (manifest/content/quiz/glossary JSON + assets), or asks to build/package/validate a .pigeon file. Produces schemaVersion-1 source files and packages them with tools/build-pigeon.mjs.
---

# PigeonLib 课程包制作 / .pigeon Course Authoring

把教材转成一个合法的 **`.pigeon`** 课程包(本质是 zip:4 个 JSON + 图片)。换一门课无需改网站代码——平台在浏览器本地解压渲染。

## 何时用这个 Skill

- 用户给一份教材(课文 / 讲义 / 题库),想做成 PigeonLib 课程。
- 用户要求"打包 / 制作 / 校验一个 .pigeon"。
- 用户要为已有课程补题目解析、补术语表。

## 工作流(按顺序)

1. **通读教材**,划出 章 → 节 → 知识点 三级结构(这是 manifest 索引树的骨架)。
2. **写 4 个源文件**到 `courses/<课程id>/`:
   - `manifest.json` — 元信息 + 章/节/知识点索引树(**必需**)
   - `content.json` — 每个知识点的正文,拆成类型化块(**必需**)
   - `quiz.json` — 题库:`questionBank` 定义题、小测/考试用 id 引用(可选)
   - `glossary.json` — 术语表 `{t,full,cn,d}`(可选)
   - 图片放 `courses/<课程id>/assets/images/`,封面 `cover.png`(可选)
3. **打包**:仓库根运行 `node tools/build-pigeon.mjs <课程id>` → 产出 `dist-courses/<课程id>.pigeon`。
4. **自检**:跑 [reference/format-cheatsheet.md](./reference/format-cheatsheet.md) 末尾的清单;在首页上传该 `.pigeon` 验证可加载、可学习。

## ID 约定(强制)

- 章 id:`"4"`(数字字符串);节 id:`"4.1"`(章.节);知识点 id:`"4-1-1"`(章-节-序);题 id:`"4-001"`(章-三位流水)。
- 渲染器据知识点 id 拼 DOM id 定位,**务必遵守连字符/点号格式**。

## 关键纪律

- 字段名严格照规范;题库**一题只在 `questionBank` 定义一次**,多处出现用 id 引用(错题本据同一 id 去重)。
- 解析、术语**基于教材,不杜撰**;不确定处标「需人工复核」。
- JSON 可写 `//` `/* */` 注释(平台加载自动剥离),建议每文件开头放"字段图例"注释。
- **正文内 emoji 由作者自由**(课程数据不受平台 UI 禁 emoji 规则约束)。

## 渐进式参考(按需深入)

- **完整字段规范 + 自检清单** → [reference/format-cheatsheet.md](./reference/format-cheatsheet.md)(速查;块类型、Span、题型、校验)
- **唯一权威契约** → 仓库 [`docs/pigeon-format.md`](../../../docs/pigeon-format.md)(字段冲突时以它为准)
- **可直接发给 AI 的全量提示词** → 仓库 [`docs/ai-course-authoring-prompt.md`](../../../docs/ai-course-authoring-prompt.md)
- **打包脚本** → 仓库 [`tools/build-pigeon.mjs`](../../../tools/build-pigeon.mjs)(用法见 [scripts/build-usage.md](./scripts/build-usage.md))
- **可运行示例** → [examples/](./examples/):`demo-course/` 源(最小完整课程)+ 已打包 `demo-course.pigeon`

## 安装到其它机器

> 本 Skill 设计为可独立分发。从 GitHub 获取:
>
> ```
> https://github.com/HELUOO404/Pigeon_Library/tree/main/.claude/skills/pigeon-course-authoring
> ```
>
> 安装:把 `pigeon-course-authoring/` 整个目录放到目标项目的 `.claude/skills/` 下即可被 Claude Code 识别。打包仍依赖仓库的 `tools/build-pigeon.mjs` 与 `app/node_modules/fflate`,故制作课程请在 PigeonLib 仓库内进行。
