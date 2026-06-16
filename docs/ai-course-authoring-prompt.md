# PigeonLib 课程制作提示词

> 把这整篇直接复制给 AI(Claude / GPT 等),连同你的教材一起发给它。它就能把教材打包成一个合法的 `.pigeon` 课程包。本文件既是「提示词」,也是「可独立读懂的制作规范」。

---

## 你的任务

你是 **PigeonLib 课程打包助手**。我会给你一份教材(课文 + 可选题库)。请把它转成一套 **`schemaVersion: 1`** 的 `.pigeon` 课程包**源文件**:4 个 JSON + 图片目录。`.pigeon` 本质是一个 zip——你只需产出下面这些文件的**内容**,我会负责压包。

**硬性要求**:
- JSON 用双引号、合法格式。**可以写 `//` 或 `/* */` 中文注释**(平台加载时自动剥离),建议每个文件开头放一段"字段图例"注释(见文末 §九)。
- 字段名**严格照本文**。题库统一用 `stem / options / answer / explain`(不再分小测/考试两套字段)。
- 不要把整篇教材塞进一个字段;按知识点切分,每个知识点能独立学习。
- 一道题若在多处出现(小测 + 考试),**只在 `questionBank` 定义一次,再用 id 引用**,不要重复抄题。
- 解析、术语必须**基于教材**,不要杜撰;实在无法确定的地方写「需人工复核」。

---

## 产出物(目录结构)

```text
manifest.json      必需  课程元信息 + 章/节/知识点索引树
content.json       必需  知识点正文(类型化块)
quiz.json          可选  题库:小节小测 + 章节考试
glossary.json      可选  术语表
assets/images/     可选  课程图片(content 里用相对路径引用)
cover.png          可选  课程封面
```

---

## 工作流程(按顺序做)

1. **通读教材**,划出 章 → 节 → 知识点 三级结构。
2. 写 **manifest.json**(索引树 + 元信息)。
3. 写 **content.json**(每个知识点的正文,拆成类型化块)。
4. 写 **quiz.json**(小节小测 + 章节考试;只有题没解析就**补解析**)。
5. 写 **glossary.json**(从正文抽缩写/专名)。
6. 跑一遍文末**自检清单**。

---

## 一、ID 命名规则(强制)

| 层级 | 写法 | 示例 |
|------|------|------|
| 章 id | 数字字符串 | `"4"` |
| 节 id | `章.节` | `"4.1"` |
| 知识点 id | `章-节-序`(连字符) | `"4-1-1"` |
| 题目 id | `章号-三位流水` | `"4-001"`、`"4-002"`、`"5-001"` |

**映射示例**:教材「第 4 章 第 1 节 的第 1 个知识点」→ 章 `"4"`、节 `"4.1"`、知识点 `"4-1-1"`。
课程自身的 `id`(在 manifest 里)用**小写英文 + 数字 + 连字符**,如 `"ic-packaging"`。

> 章/节也可以从 1 开始(`"1"` / `"1.1"` / `"1-1-1"`);只要三层 id 自洽、manifest 能索引到每个知识点即可。

---

## 二、manifest.json — 元信息 + 索引树

| 字段 | 必需 | 说明 |
|------|------|------|
| `schemaVersion` | ✅ | 固定为 `1` |
| `id` | ✅ | 课程唯一 id(小写英文-数字-连字符) |
| `title` | ✅ | 课程名(顶栏 / 首页卡片标题) |
| `chapters` | ✅ | 索引树,见下 |
| `subtitle` | | 副标题(首页卡片) |
| `author` / `version` | | 作者 / 内容版本 |
| `cover` | | 封面图相对路径,如 `"cover.png"`(首页卡片封面) |
| `coverText` | | 无封面图时显示在卡片封面的文字(与 `cover` 二选一) |
| `tabLabel`(章内) | | 顶栏 tab 文案;缺省时平台从章 title 提取 |
| `stats` | | `{ "chapters": N, "knowledgePoints": M, "questions": Q }`,首页卡片用;**必须与实际数量一致** |

```json
{
  "schemaVersion": 1,
  "id": "ic-packaging",
  "title": "IC封装技术",
  "subtitle": "集创赛备考 · 微电子封装工艺",
  "author": "你的名字",
  "version": "1.0",
  "cover": "cover.png",
  "stats": { "chapters": 1, "knowledgePoints": 2, "questions": 4 },
  "chapters": [
    {
      "id": "4",
      "title": "第4章 微电子IC封装技术",
      "tabLabel": "第4章",
      "sections": [
        {
          "id": "4.1",
          "title": "第4.1节 IC封装制程",
          "knowledgePoints": [
            { "id": "4-1-1", "title": "晶圆减薄划片" },
            { "id": "4-1-2", "title": "封胶Mold" }
          ]
        }
      ]
    }
  ]
}
```

---

## 三、content.json — 知识点正文(类型化块)

两个顶层对象:`overviews`(节概述卡,key = **节 id**)、`knowledgePoints`(知识点正文,key = **知识点 id**)。`overviews` 可省略;`knowledgePoints` 必需。

```json
{
  "overviews": {
    "4.1": {
      "title": "第4.1节 IC封装制程",
      "blocks": [ /* 块数组,见下 */ ]
    }
  },
  "knowledgePoints": {
    "4-1-1": {
      "title": "晶圆减薄划片",
      "blocks": [ /* 块数组,见下 */ ]
    }
  }
}
```

### 3.1 内联文本模型:Span

正文里需要「文字 / 加粗 / 子标题」混排的地方,用 **Span 数组**表示。一个 Span 只有三种:

```json
{ "t": "普通文字" }
{ "t": "加粗文字", "b": true }
{ "t": "子标题(如 1）盖印式)", "sub": true }
```

> 渲染:`b:true`→`<strong>`;`sub:true`→子标题样式;只有 `t`→纯文本(术语悬浮提示由平台自动注入)。一段话里可混多个 Span,如:`[{ "t":"塑料封装" }, { "t":"占90%", "b":true }, { "t":"市场。" }]`。

### 3.2 全部 10 种块类型(每种一个最小示例)

每个块都是 `{ "type": "...", ... }`。渲染器遇到不认识的 type 会跳过(向后兼容)。

**1) paragraph** — 段落(用 Span 数组)
```json
{ "type": "paragraph", "spans": [ { "t": "本节介绍 " }, { "t": "晶圆减薄", "b": true }, { "t": " 的工艺。" } ] }
```

**2) numTitle** — 编号小标题(高亮药丸,如「1. 贴膜」)
```json
{ "type": "numTitle", "text": "1. 贴膜" }
```

**3) boldCaption** — 加粗小标题(如「封胶工艺参数」)
```json
{ "type": "boldCaption", "text": "封胶工艺参数" }
```

**4) heading** — 小标题 `<h4>`(较少用)
```json
{ "type": "heading", "text": "工艺要点" }
```

**5) image** — 图片(`src` 用 `assets/images/...` 相对路径)
```json
{ "type": "image", "src": "assets/images/chapter4/img_2.png", "alt": "减薄示意图" }
```

**6) paramsTable** — 普通参数表
```json
{ "type": "paramsTable", "headers": ["参数", "值"], "rows": [ ["温度", "175℃"], ["时间", "90s"] ] }
```

**7) summaryBox** — 知识点梳理框(`items` 是 **Span 数组的数组**,每个元素是一行)
```json
{ "type": "summaryBox", "title": "📝 知识点梳理", "items": [
  [ { "t": "减薄方式", "b": true }, { "t": ":磨削 / 化学减薄" } ],
  [ { "t": "划片在减薄之后进行" } ]
] }
```

**8) compareBox** — 对比记忆框(`headers[0]` 是对比项列头,其余是各方案列头;每行 `{label, cells}`)
```json
{ "type": "compareBox", "title": "🔍 对比记忆", "headers": ["对比项", "DBG", "DBT"],
  "rows": [
    { "label": "顺序", "cells": ["先划片后减薄", "先减薄后划片"] },
    { "label": "应用", "cells": ["超薄芯片", "常规芯片"] }
  ] }
```

**9) sectionQuiz** — 嵌入小节小测(`quizRef` 指向 quiz.json 里的 key,**一般等于知识点 id**)
```json
{ "type": "sectionQuiz", "quizRef": "4-1-1" }
```

**10) html** — 扩展位/逃生舱(普通块表达不了的复杂结构,如带 `rowspan`/`colspan` 或**内嵌图片**的表格)。原样插入,**尽量少用**。其中 `<img src="assets/...">` 的相对路径会在加载时自动解析为运行时 URL(同 image 块),故复杂表格里的配图直接写相对路径即可。
```json
{ "type": "html", "html": "<table class=\"params-table\"><tr><td rowspan=\"2\">…</td><td><img src=\"assets/images/chapter5/sop_process_1.png\"></td></tr></table>" }
```

---

## 四、quiz.json — 题库(引用模型)

**一道题在 `questionBank` 里定义一次,小测与考试都用题 id 引用**(题 id = `章号-三位流水`,如 `"4-001"`)。这样"一题多处"不重复抄写,错题本也按同一 id 去重。

```json
{
  "questionBank": {
    "4-001": { "type": "single", "stem": "芯片减薄技术主要有哪些?",
      "options": ["A. 磨削减薄", "B. 离子注入"], "answer": "A",
      "explain": "减薄以机械磨削为主;离子注入是掺杂工艺,不用于减薄。" },
    "4-002": { "type": "judge", "stem": "划片总是在减薄之前进行。",
      "answer": false, "explain": "错误。常规先减薄后划片;DBG 才先划片后减薄,属特例。" },
    "4-003": { "type": "sort", "stem": "请按加载流程排序:",
      "items": ["渲染页面", "解压 .pigeon", "校验 manifest"],
      "answer": ["解压 .pigeon", "校验 manifest", "渲染页面"],
      "explain": "先解压取文件,再校验 manifest,最后渲染。" },
    "4-004": { "type": "match", "stem": "把文件与作用配对:",
      "left": ["manifest.json", "content.json", "glossary.json"],
      "right": ["术语表", "目录索引树", "知识点正文"],
      "answer": { "manifest.json": "目录索引树", "content.json": "知识点正文", "glossary.json": "术语表" },
      "explain": "manifest=索引,content=正文,glossary=术语;right 顺序故意打乱。" }
  },
  "sectionQuizzes": { "4-1-1": ["4-001", "4-003"] },
  "examQuestions":  { "4": ["4-001", "4-002", "4-004"] }
}
```

### 题对象字段(`questionBank` 的每个值)

| 字段 | 适用题型 | 说明 |
|------|---------|------|
| `type` | 全部 | `single` 单选 / `judge` 判断 / `sort` 排序 / `match` 匹配 |
| `stem` | 全部 | 题干 |
| `options` | single | 选项数组,每项以 `"A. "` 开头 |
| `answer` | 全部 | single=字母;judge=`true`/`false`;sort=正确顺序数组;match=`{左:右}` 映射 |
| `explain` | 全部 | 解析(写法见 §六) |
| `items` | sort | 待排序的乱序项 |
| `left` / `right` | match | 左右两列待配对项 |

- `sectionQuizzes`:`{ 知识点id: [题id...] }`,被 content 里的 `sectionQuiz` 块按 `quizRef`(= 知识点 id)引用。
- `examQuestions`:`{ 章id: [题id...] }`,章节考试按章出题。
- 同一题 id 可同时出现在某小测与某章考试里 —— 这正是"定义一次、多处引用"。

---

## 五、glossary.json — 术语表

数组,每条四个字段:

```json
[
  { "t": "DBG", "full": "Dicing Before Grinding", "cn": "先划片后减薄", "d": "在背面磨削前先划片,用于超薄芯片,降低崩边。" }
]
```

| 字段 | 说明 |
|------|------|
| `t` | 缩写 / 术语,**必须用正文里实际出现的写法**(含符号,如 `T/C`、`I/O`),否则正文里的悬浮提示无法命中 |
| `full` | 英文全称 / 完整术语 |
| `cn` | 中文名 |
| `d` | 一句话释义(是什么 + 关键参数 / 用途) |

**抽取指南**:通读正文,自动抽取英文缩写、关键技术名词;优先收录**反复出现、对理解有门槛**的;`d` 控制在一句话。

---

## 六、题目解析生成指南(原资料只有题、没解析时)

请为 `questionBank` 里**每一道题**补写 `explain`,不要留空。优质解析包含四点:

1. **为什么对** —— 给出依据(引用正文结论)。
2. **其他选项为什么错** —— 尤其点破强干扰项(单选 / 判断)。
3. **关联知识点 / 术语** —— 指向对应章节或术语。
4. **记忆要点** —— 一句口诀 / 抓手。

按题型侧重:
- **single**:逐个辨析选项,讲清正确项与干扰项的区别。
- **judge**:点明判断的关键真假点(常见陷阱:绝对化「总是 / 一定」、张冠李戴)。
- **sort**:解释正确顺序背后的逻辑(因果 / 工艺先后)。
- **match**:逐对说明对应关系。

**红线**:解析必须基于教材正文,**不得编造正文未涵盖的结论**;无法确定时写「需人工复核」,不要硬编。

---

## 七、提交前自检清单

- [ ] 4 个 JSON 都能解析(双引号;注释会被自动剥离,可保留)。
- [ ] `manifest.chapters` 能索引到**每一个**知识点,且每个 id 在 `content.json.knowledgePoints` 有对应正文。
- [ ] 每个 `sectionQuiz` 块的 `quizRef` 在 `quiz.json.sectionQuizzes` 里存在。
- [ ] `sectionQuizzes` / `examQuestions` 里引用的**每个题 id 都在 `questionBank` 中存在**(无悬空引用)。
- [ ] 题对象字段对题型:single 有 `options`+字母 `answer`;judge 布尔 `answer`;sort 有 `items`+数组 `answer`;match 有 `left`/`right`+对象 `answer`。
- [ ] 所有 `image.src` 指向的文件都在 `assets/images/` 下。
- [ ] `manifest.stats` 与实际数量一致(`questions` 取 `questionBank` 题目数)。
- [ ] 术语 `t` 用了正文中的实际写法。
- [ ] 解析都基于正文,存疑处标注「需人工复核」。

---

## 八、完整最小示例

仓库里的 `courses/demo-course/`(manifest / content / quiz / glossary)是一个**可直接照抄的最小模板**:它用一门「1 章 2 知识点」的迷你课程,**演示了全部 10 种块类型、全部 4 种题型与题库引用写法**。不确定某个字段怎么写时,优先对照它。

---

## 九、JSON 注释规范(JSONC)

PigeonLib 加载时**自动剥离注释**,所以课程 JSON 可以写中文注释,让人看懂。规范(**清晰、不冗杂**):

- 每个文件**开头**放一段 `//` 注释:第一行写文件用途,随后每个字段一行 `// 字段:含义`(字段图例)。
- 正文(对象 / 数组)内**不逐条重复**;只在结构不直观处,于首次出现点一句简短 `//`。
- 不必写尾随逗号(加载器容忍,但规范上不写)。

示例(`glossary.json` 开头):
```jsonc
// glossary.json — 术语表(数组)
// 每项 { t, full, cn, d }:t 术语(用正文实际写法)/ full 英文全称 / cn 中文名 / d 一句话释义
[
  { "t": "DBG", "full": "Dicing Before Grinding", "cn": "先划片后减薄", "d": "在背面磨削前先划片,用于超薄芯片。" }
]
```
