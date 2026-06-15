# `.pigeon` 课程包格式规范 (schemaVersion 1)

> 本文件是**唯一权威契约**:拆包工具(`tools/build-pigeon.mjs`)与学习页渲染器(`app/src/render/*`)都必须严格遵守。任何字段改动先改本文件,再改代码。

`.pigeon` 文件本质是一个 **zip** 压缩包(后缀改名为 `.pigeon`)。解压后的根目录结构:

```
manifest.json     必需  课程元信息 + 章/节/知识点索引树
content.json      必需  知识点正文(类型化节点)
quiz.json         可选  题库:小节小测 + 章节考试
glossary.json     可选  术语表
assets/           可选  课程资源(图片等),content 用相对路径引用
  └─ images/...
cover.png         可选  课程封面(manifest.cover 指向它)
```

加载流程:`fflate.unzipSync` 解压 → 校验 manifest/content → `assets/` 下图片转 Blob URL → 渲染器按 manifest 索引树驱动,从 content/quiz/glossary 取数据渲染。

---

## 1. manifest.json — 元信息 + 结构索引

```jsonc
{
  "schemaVersion": 1,                         // 必需。格式版本号
  "id": "ic-packaging",                       // 必需。课程唯一 id(localStorage 命名空间 / ?course= 用)
  "title": "IC封装技术",                       // 必需。课程名(顶栏 logo、首页卡片标题)
  "subtitle": "集创赛备考 · 微电子封装工艺",     // 可选。副标题(首页卡片)
  "author": "PigeonLib",                      // 可选
  "version": "1.0",                           // 可选。课程内容版本
  "cover": "cover.png",                       // 可选。封面相对路径
  "stats": { "chapters": 3, "knowledgePoints": 25, "questions": 120 }, // 可选。首页卡片元信息;缺省时由平台扫描计算
  "chapters": [                               // 必需。驱动顶栏 tab 与侧栏目录树
    {
      "id": "4",                              // 章 id(字符串)
      "title": "第4章 微电子IC封装技术",         // 章标题(顶栏 tab 用"第N章"由平台截取或直接用 tabLabel)
      "tabLabel": "第4章",                     // 可选。顶栏 tab 文案;缺省时平台从 title 提取
      "sections": [
        {
          "id": "4.1",                        // 节 id,形如 "章.节"
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

**ID 约定(强制)**:
- 章 id:`"4"`(与原站一致,数字字符串)。
- 节 id:`"4.1"`(章.节)。
- 知识点 id:`"4-1-1"`(章-节-序,连字符)。原站 DOM 用 `kp-4-1-1` / `dot-4-1-1` / `badge-4-1-1`,渲染器据知识点 id 拼接这些 DOM id,保持选择器一致。
- 小测题 id:`"q-kp-4-1-1-1"`(原站格式),见 quiz.json。

---

## 2. content.json — 知识点正文(类型化节点)

```jsonc
{
  "overviews": {                  // 节概述卡(原 .overview-card),key = 节 id
    "4.1": {
      "title": "第4.1节 IC封装制程",  // 概述卡标题(原 <h2>)
      "blocks": [ /* 块节点数组,见下 */ ]
    }
  },
  "knowledgePoints": {            // 知识点正文(原 .knowledge-card .card-body),key = 知识点 id
    "4-1-1": {
      "title": "晶圆减薄划片",
      "blocks": [ /* 块节点数组 */ ]
    }
  }
}
```

### 2.1 块节点(block)类型

每个 block 是 `{ "type": "...", ... }`。渲染器按 type 分派;**遇到未知 type 跳过并 console.warn**,保证向后兼容。

| type | 字段 | 渲染为(原站对应) |
|------|------|------------------|
| `paragraph` | `spans: Span[]` | `<p>` + 内联 span(见 2.2) |
| `numTitle` | `text: string` | `<p><strong class="num-title">text</strong></p>`(编号高亮药丸) |
| `boldCaption` | `text: string` | `<p><strong>text</strong></p>`(如"封胶工艺参数") |
| `heading` | `text: string` | `<h4>text</h4>`(原 card-body h4,少见) |
| `image` | `src: string, alt?: string` | `<img loading="lazy" onerror=hide src alt ...>`;src 是 `assets/images/...` 相对路径,运行时换 Blob URL |
| `paramsTable` | `headers: string[], rows: string[][]` | `<table class="params-table">`(thead+tbody,居中) |
| `summaryBox` | `title: string, items: Span[][]` | `<div class="summary-box"><h4>title</h4><ul><li>…</li></ul></div>` |
| `compareBox` | `title: string, headers: string[], rows: CompareRow[]` | `<div class="compare-box"><h4>title</h4><table class="compare-table">…</table></div>` |
| `sectionQuiz` | `quizRef: string` | `<div class="section-quiz">`,题目来自 quiz.json.sectionQuizzes[quizRef] |
| `html` | `html: string` | **扩展位**:原样插入(未来 HTML 片段)。渲染前经白名单清洗 |

- `CompareRow`:`{ "label": string, "cells": string[] }` — 首列是 `.compare-label`(行标题),其余是 `cells`。`headers[0]` 是对比项目列头,`headers[1..]` 是各方案列头。
- `summaryBox.items`:每个 li 是一个 `Span[]`(支持其中的 `<strong>` 加粗,如"**塑料封装**占90%市场")。

### 2.2 内联节点(Span) — paragraph / summaryBox.items 内使用

原站 `<p>` 内只出现三种内联构造,因此 Span 模型完备:

```jsonc
{ "t": "纯文本" }                  // 普通文本
{ "t": "加粗文本", "b": true }      // <strong> 普通加粗
{ "t": "子标题", "sub": true }      // <span class="sub-title"> 子标题样式(如 "1）盖印式")
```

渲染规则:
- `b:true` → `<strong>t</strong>`
- `sub:true` → `<span class="sub-title">t</span>`
- 否则 → 文本节点(术语提示在渲染后由 glossary 模块走 TreeWalker 注入,与原站一致)

> **拆包工具断言**:解析原站 `<p>` 时,若遇到上述三种以外的内联标签(如 `<a>`、`<img>` 内联),必须报错中止,提示人工处理 —— 确保 Span 模型对本课程 100% 完备。

---

## 3. quiz.json — 题库(小节小测 + 章节考试)

```jsonc
{
  "sectionQuizzes": {              // 小节小测,key = quizRef(= 知识点 id,如 "4-1-1")
    "4-1-1": [
      {
        "qid": "q-kp-4-1-1-1",     // 原站题目 id(fb-/name 选择器据此)
        "q": "芯片减薄技术主要有:",
        "options": ["A. ...", "B. ..."],   // 每项以 "X. " 开头
        "ans": "A",                // 正确选项字母
        "exp": "解析文本"           // 解析(可空字符串;制作指南要求尽量补全)
      }
    ]
  },
  "examQuestions": [               // 章节考试题库(原 ALL_QUESTIONS),4 题型
    // 单选 single
    { "id": "cw-4-1-20-1", "type": "single", "chapter": "4",
      "question": "...", "options": ["A. ...","B. ..."], "answer": "A", "explain": "..." },
    // 判断 judge
    { "id": "4-j1", "type": "judge", "chapter": "4",
      "question": "...", "answer": true, "explain": "..." },
    // 排序 sort
    { "id": "4-s1", "type": "sort", "chapter": "4",
      "question": "...", "items": ["切割","贴膜",...], "answer": ["贴膜","减薄",...], "explain": "..." },
    // 匹配 match
    { "id": "m-4-1", "type": "match", "chapter": "4",
      "question": "...", "left": ["热压键合",...], "right": ["键合压力高...",...],
      "answer": { "热压键合": "键合压力高...", ... }, "explain": "..." }
  ]
}
```

- `type` 是**开放枚举**:渲染器按 type 分派,未知题型显示"暂不支持的题型"占位而非崩溃。
- 考试按 `chapter` 过滤出当前章题目(原 `openExam` 逻辑)。

---

## 4. glossary.json — 术语表

```jsonc
[
  { "t": "DBG", "full": "Dicing Before Grinding", "cn": "先划片后减薄", "d": "在背面磨削之前..." }
]
```

- `t` 缩写(术语提示命中用,**须用正文中的实际写法**,含 `/`,如 `T/C`);`full` 英文全称;`cn` 中文名;`d` 一句话释义。
- 术语提示:渲染后扫描正文文本节点,把出现的 `t` 包成 `.term-tip`,悬浮显示 full/cn/d。

---

## 5. 校验规则(加载时)

| 错误 code | 触发条件 | 首页文案 |
|-----------|---------|---------|
| `too-large` | 文件 > 50MB | 文件超过 50MB 上限 |
| `not-zip` | 无法解压 | 文件已损坏或不是 .pigeon 课程包 |
| `no-manifest` | 缺 manifest.json | 缺少 manifest.json |
| `bad-manifest` | 缺 id/title/chapters | manifest 格式错误:缺少 … |
| `no-content` | 缺 content.json | 课程内容缺失 |
| `bad-content` | content 无 knowledgePoints | 课程内容格式错误 |
| (警告级) | content 引用的图片在包内找不到 | 可导入,提示"N 张图片缺失"(由 `<img onerror>` 容错) |

---

## 6. 给 AI 的课程制作指南(首页 E 区展示 + 一键复制提示词)

见 `docs/ai-course-authoring-prompt.md`。要点:
1. 按本规范产出 5 个文件 + assets/images。
2. **术语表制作**:从教材自动抽取缩写/专名 → `{t,full,cn,d}`;`t` 用正文实际写法。
3. **题目解析制作**(针对只有题目无解析的课程):为每题自动生成优质解析 → ① 为什么对 ② 其他选项为什么错 ③ 关联知识点 ④ 记忆要点;按题型区分侧重;须基于课程正文,不杜撰,存疑标"需人工复核"。
