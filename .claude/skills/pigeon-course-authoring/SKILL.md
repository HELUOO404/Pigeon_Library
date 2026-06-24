---
name: pigeon-course-authoring
description: Author a PigeonLib .pigeon course package from teaching material, faithfully. Use when the user wants to turn a textbook, lecture notes, PDF/Word/HTML, or study material into a PigeonLib course (manifest/content/quiz/glossary JSON + assets), or asks to build/package/validate/push a .pigeon file. Runs a P0–P6 pipeline: ingest → faithful per-chapter extraction → a hard fidelity gate (scripts/verify-fidelity.mjs) that guarantees body text and questions are never altered → optional enrichment → metadata/typography → build → optional cloud push. Produces schemaVersion-1 files packaged with tools/build-pigeon.mjs.
---

# PigeonLib 课程包制作 / .pigeon Course Authoring

把教材**忠实**转成一个合法的 **`.pigeon`** 课程包(本质是 zip:4 个 JSON + 图片)。换一门课无需改网站代码 —— 平台在浏览器本地解压渲染。

**最高纪律(贯穿全程)**:**正文与题目 100% 不被改动 —— 逐字保留,连错别字、可疑错误也不在制作中擅改,只在 P6 打包完成后单独汇报提醒。** 制作时只做三件事:选块类型、排版式、补「增强内容」(解析/术语/梳理),三者都不得改动一个原文字符。

## 何时用这个 Skill

- 用户给一份教材(课文 / 讲义 / 题库 / PDF / Word / HTML / 图片),想做成 PigeonLib 课程。
- 用户要求"打包 / 制作 / 校验 / 推送一个 .pigeon"。
- 用户要为已有课程补题目解析、补术语表。

> 上手前可选:`node scripts/check-update.mjs` 看本 Skill 是否有新版(离线则静默跳过)。

---

## 编排协议(P0–P6)

> **主 agent 编排;能并行处理的抽取/增强按章拆给子代理。** 没有子代理能力时,同一套阶段顺序串行执行即可。**P2 忠实度门禁是硬关卡,不过不放行。**

### P0 · 摄取与规划(主)
1. 只读通读原始课件,识别格式(md/docx/html/纯文本/图片)。
2. 搭 **manifest 索引树**:章(`"4"`)→ 节(`"4.1"`)→ 知识点(`"4-1-1"`),并记录**每个知识点对应原文的哪一段**(源映射),供后续按章分派与门禁比对。
3. 定 `course id`(= 目录名 = `manifest.id`,小写连字符)。**先把索引树立住,其余内容都挂在它下面。**

### P1 · 忠实抽取(子代理,按章并行)
每章一个子代理,**只抽取、不创作**。各自产出该章的 content/quiz 片段:
- **正文** → 类型化块,**逐字保留**(只决定块类型与排块,不改字)。块选型见 [reference/typography.md](./reference/typography.md)。
- **题目** → 逐字进 `questionBank`,**一题只定义一次**;小测/考试用 id 引用。
- **表格**:规则表 → `paramsTable`/`compareBox`;合并单元格/含图 → `html` 块。
- **HTML 片段** → 走下面的「HTML 决策分支」。
- 拿不准某块会渲成什么 → 查只读快照 [reference/renderer-src/](./reference/renderer-src/)。

### P2 · 合并 + 忠实度门禁(主)★
1. 合并各章片段为完整 `content.json` / `quiz.json`。
2. **跑硬门禁**:
   ```bash
   node .claude/skills/pigeon-course-authoring/scripts/verify-fidelity.mjs <原始课件路径> courses/<id>
   ```
   它把每段正文/题目去空白后,逐块在原文里找逐字子串;**有找不到的(疑似改字/漏字/换标点)就退出码 1**。
3. **退出码非 0 → 硬停**,逐条核对报出的块:确属忠实抽取的误报(多为源用了不同标点/全半角)才人工放行;真改动了的,改回与原文一致。**门禁不绿不进 P3。**

### P3 · 增强(可选,子代理;P2 锁定后才做)
纯增量,**绝不混入正文,绝不改动已锁定的原文**:
- 题目**解析** `explain`(① 为什么对 ② 别的为什么错 ③ 关联知识点 ④ 记忆点;基于教材不杜撰,存疑标「需人工复核」)。
- **术语表** glossary(`{t,full,cn,d}`,`t` 用正文实际写法)。
- **对比记忆卡** compareBox / **知识点梳理** summaryBox。
> 增强写完,正文/题目原文仍应能通过 P2 门禁(增强内容不参与门禁比对)。

### P4 · 元信息 + 排版(主)
- 智能补 `subtitle` / `description` / `stats` / `coverText`(或 `cover.png`);新版本则递增 `manifest.version`。
- **排版走平台 CSS,不进数据**:首行缩进、标题顶格、宽表横滑都是平台自动的;**不要往 content 塞空格/缩进**(见 typography.md 第一节)。

### P5 · 构建 + 自检
```bash
node tools/build-pigeon.mjs <id>          # → dist-courses/<id>.pigeon
```
- 跑 [reference/format-cheatsheet.md](./reference/format-cheatsheet.md) 末尾自检清单。
- 在首页上传该 `.pigeon`:目录树/卡片/小测/考试/术语提示正常;含 `sandbox` 的知识点可交互;宽表手机视口可左右滑。

### P6 · 推送(可选)+ 错别字汇报
- 推送到云端(需后端在跑):
  ```bash
  node tools/pigeon-push.mjs login            # 用户本机输自己的账号密码(agent 不代输)
  node tools/pigeon-push.mjs push <id>        # 打包→建课/新版本→可选提交审核
  ```
- **推送完成后,才**把全程记下的**原文错别字 / 可疑错误**汇总报告给用户(给出位置与建议),**永不擅自改动** —— 是否修订由用户定。

---

## HTML 决策分支(P1 内)

课件里出现 HTML 片段时:

1. **能拆成普通文档/表格**(静态结构、无脚本)→ 问用户是否规范化为结构化块(paragraph/paramsTable/compareBox);用户要保留原结构则进 `html` 块。
2. **静态但结构复杂**(合并单元格、图文混排)→ `html` 块(`<script>` 不执行,相对资源路径自动解析)。
3. **真靠 JS 驱动**(点击/计算/动态)→ `sandbox` 块(隔离 iframe,JS 可运行)。**只把配色改成自洽可读的令牌色,绝不碰逻辑**;沙箱不继承主题,须自管配色。详见 typography.md 第四节。

---

## ID 约定(强制)

- 章 `"4"`(数字字符串);节 `"4.1"`(章.节);知识点 `"4-1-1"`(章-节-序);题 `"4-001"`(章-三位流水)。
- 渲染器据知识点 id 拼 DOM id 定位,**务必遵守连字符/点号格式**。

## 关键纪律(复述)

- 字段名严格照规范;题库**一题只在 `questionBank` 定义一次**,多处用 id 引用(错题本据同一 id 去重)。
- 正文/题目**逐字忠实**;解析、术语**基于教材不杜撰**,不确定处标「需人工复核」。
- JSON 可写 `//` `/* */` 注释(平台加载自动剥离),建议每文件开头放"字段图例"注释。
- **正文内 emoji 由作者自由**;但层次靠块类型(numTitle/boldCaption/summaryBox)承载,不靠 emoji 撑。

## 渐进式参考(按需深入)

- **块选型 / 排版 / html·sandbox 决策** → [reference/typography.md](./reference/typography.md)
- **完整字段速查 + 自检清单** → [reference/format-cheatsheet.md](./reference/format-cheatsheet.md)
- **渲染器只读快照(自查渲染效果)** → [reference/renderer-src/](./reference/renderer-src/)
- **唯一权威契约** → 仓库 [`docs/pigeon-format.md`](../../../docs/pigeon-format.md)(字段冲突以它为准)
- **忠实度门禁 / 更新检查** → [scripts/verify-fidelity.mjs](./scripts/verify-fidelity.mjs) · [scripts/check-update.mjs](./scripts/check-update.mjs)
- **打包 / 推送** → 仓库 [`tools/build-pigeon.mjs`](../../../tools/build-pigeon.mjs)(用法 [scripts/build-usage.md](./scripts/build-usage.md))· [`tools/pigeon-push.mjs`](../../../tools/pigeon-push.mjs)
- **可运行示例** → [examples/](./examples/):`demo-course/` 源(覆盖多数块类型 + `sandbox` 交互样板)+ 已打包 `demo-course.pigeon`

## 版本与安装

- 当前 Skill 版本见 [VERSION](./VERSION);`node scripts/check-update.mjs` 比对远端。
- **分发**:本 Skill 可独立分发。从 GitHub 获取:
  ```
  https://github.com/HELUOO404/Pigeon_Library/tree/main/.claude/skills/pigeon-course-authoring
  ```
  把 `pigeon-course-authoring/` 整个目录放到目标项目的 `.claude/skills/` 下即可被 Claude Code 识别。打包/推送仍依赖仓库的 `tools/` 与 `app/node_modules/fflate`,故制作课程请在 PigeonLib 仓库内进行。
