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

> **JSON 可带注释(JSONC)**:四个 JSON 文件都可写 `//` 行注释、`/* */` 块注释(也容忍尾随逗号),平台加载时自动剥离。约定每个文件**开头放一段"字段图例"注释**讲清各字段,正文不逐条重复,只在结构不直观处点一句 —— 让课程文件对人类友好,运行时仍是标准 JSON。

---

## 1. manifest.json — 元信息 + 结构索引

```jsonc
{
  "schemaVersion": 1,                         // 必需。格式版本号
  "id": "ic-packaging",                       // 必需。课程唯一 id(localStorage 命名空间 / ?course= 用)
  "title": "IC封装技术",                       // 必需。课程名(顶栏 logo、首页卡片标题)
  "subtitle": "集创赛备考 · 微电子封装工艺",     // 可选。副标题(首页卡片)
  "description": "面向集创赛的微电子封装工艺速成:从晶圆减薄到系统级封装……", // 可选。课程简介(详情弹窗展示;缺省时弹窗回退用 subtitle)
  "author": "PigeonLib",                      // 可选
  "version": "1.0",                           // 可选。课程内容版本
  "cover": "cover.png",                       // 可选。封面图相对路径(首页卡片封面)
  "coverText": "IC",                          // 可选。无封面图时显示在卡片封面的文字(与 cover 二选一)
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
- 章 id:`"4"`(数字字符串)。
- 节 id:`"4.1"`(章.节)。
- 知识点 id:`"4-1-1"`(章-节-序,连字符)。渲染器据知识点 id 拼接 DOM id(`kp-4-1-1` / `dot-4-1-1` / `badge-4-1-1`)用于定位与高亮。
- 题目 id:`"4-001"`(章号-三位流水)。在 quiz.json 的 `questionBank` 中定义,小测/考试用 id 引用,见 §3。

> **封面**:`cover` 指向包内图片(如 `cover.png`),首页卡片显示该图;若无图,用 `coverText` 显示自定义文字;两者都无则用课程标题首字。建议封面图 ≤ 数百 KB。

> **简介**:`description` 是课程的整体介绍(一段话即可),在课程广场的「课程详情弹窗」里以「课程简介」区展示;缺省时弹窗回退显示 `subtitle`。服务端解析 .pigeon 时提取并存库(权威),与封面/统计一同随卡片下发。

> **分类 / 发布人 / 评分 / 版本审核等是平台层概念,不写入 `.pigeon`**:课程包只描述「内容本身」。分类在发布到课程广场时由发布人选择、存于服务端数据库;发布人、审核状态、评分、下载量、版本指针等同样由平台维护(见 `docs/user-system-design.md` §13)。`manifest.author` 仅表示原始创作者署名,不等于平台「发布人」。

---

## 2. content.json — 知识点正文(类型化节点)

```jsonc
{
  "overviews": {                  // 节概述卡(每节开头的概述区块),key = 节 id
    "4.1": {
      "title": "第4.1节 IC封装制程",  // 概述卡标题
      "blocks": [ /* 块节点数组,见下 */ ]
    }
  },
  "knowledgePoints": {            // 知识点正文(每个知识点卡片的正文区),key = 知识点 id
    "4-1-1": {
      "title": "晶圆减薄划片",
      "blocks": [ /* 块节点数组 */ ]
    }
  }
}
```

### 2.1 块节点(block)类型

每个 block 是 `{ "type": "...", ... }`。渲染器按 type 分派;**遇到未知 type 跳过并 console.warn**,保证向后兼容。

| type | 字段 | 渲染为 |
|------|------|------------------|
| `paragraph` | `spans: Span[]` | `<p>` + 内联 span(见 2.2) |
| `numTitle` | `text: string` | `<p><strong class="num-title">text</strong></p>`(编号高亮药丸) |
| `boldCaption` | `text: string` | `<p><strong>text</strong></p>`(如"封胶工艺参数") |
| `heading` | `text: string` | `<h4>text</h4>`(知识点内的小标题,较少用) |
| `image` | `src: string, alt?: string` | `<img loading="lazy" onerror=hide src alt ...>`;src 是 `assets/images/...` 相对路径,运行时换 Blob URL |
| `paramsTable` | `headers: string[], rows: string[][]` | `<table class="params-table">`(thead+tbody,居中) |
| `summaryBox` | `title: string, items: Span[][]` | `<div class="summary-box"><h4>title</h4><ul><li>…</li></ul></div>` |
| `compareBox` | `title: string, headers: string[], rows: CompareRow[]` | `<div class="compare-box"><h4>title</h4><table class="compare-table">…</table></div>` |
| `sectionQuiz` | `quizRef: string` | `<div class="section-quiz">`,题目来自 quiz.json.sectionQuizzes[quizRef] |
| `html` | `html: string` | **扩展位/逃生舱**:原样插入的 HTML 片段,用于结构化块表达不了的内容(如含图片或 `rowspan`/`colspan` 合并单元格的复杂表格)。其中 `<img src="assets/...">` 等**相对资源路径会在加载时自动解析为运行时 URL**(与 `image` 块一致);`http/blob/data/` 与绝对路径原样保留。**注:`<script>` 与内联事件不执行**(渲染器用 `insertAdjacentHTML` 注入),需要 JS 交互请用 `sandbox` 块 |
| `sandbox` | `html: string, height?: number` | **隔离沙箱**:把含 JS 逻辑的 HTML 片段渲染进 `<iframe sandbox="allow-scripts">`,脚本可运行但与主站完全隔离。`assets/...` 相对路径同样解析为运行时 URL;`height` 为初始/兜底高度(像素,缺省 320),运行时按内容自适应。详见 §2.3 |

- `CompareRow`:`{ "label": string, "cells": string[] }` — 首列是 `.compare-label`(行标题),其余是 `cells`。`headers[0]` 是对比项目列头,`headers[1..]` 是各方案列头。
- `summaryBox.items`:每个 li 是一个 `Span[]`(支持其中的 `<strong>` 加粗,如"**塑料封装**占90%市场")。

### 2.2 内联节点(Span) — paragraph / summaryBox.items 内使用

课程正文 `<p>` 内只使用三种内联构造,因此 Span 模型完备:

```jsonc
{ "t": "纯文本" }                  // 普通文本
{ "t": "加粗文本", "b": true }      // <strong> 普通加粗
{ "t": "子标题", "sub": true }      // <span class="sub-title"> 子标题样式(如 "1）盖印式")
```

渲染规则:
- `b:true` → `<strong>t</strong>`
- `sub:true` → `<span class="sub-title">t</span>`
- 否则 → 文本节点(术语提示在渲染后由 glossary 模块走 TreeWalker 注入)

> **拆包工具断言**:解析课程正文 `<p>` 时,若遇到上述三种以外的内联标签(如 `<a>`、`<img>` 内联),必须报错中止,提示人工处理 —— 确保 Span 模型对本课程 100% 完备。

### 2.3 sandbox 块 — 隔离运行的交互片段

`html` 块用 `insertAdjacentHTML` 注入主页面,其中 `<script>` 与内联事件**永不执行**(安全考量)。当课件确有「真靠 JS 驱动」的片段(点击切换、小计算器、动态图示)时,用 `sandbox` 块:

```jsonc
{ "type": "sandbox", "html": "<button onclick=\"this.textContent='已点击'\">点我</button>", "height": 320 }
```

**渲染**:整段 `html` 装进一个 `<iframe class="sandbox-frame" sandbox="allow-scripts" srcdoc="...">`。脚本可运行,`assets/...` 相对路径在装入前解析为运行时 Blob URL(与 `image`/`html` 块一致)。

**高度自适应**:`height` 是初始/兜底高度(像素,缺省 320)。iframe 内置脚本在 load 与内容尺寸变化时,通过 `postMessage({pigeonHeight})` 把实际高度上报给学习页;学习页只认「本页生成的 iframe」(按 `contentWindow` 比对来源)后调整其高度。脚本不跑或上报失败时即保持 `height` 兜底值。

**安全边界(沙箱不获 `allow-same-origin`)**:沙箱内代码**无法**访问父页 DOM、`localStorage`、登录 cookie、学习进度,也不能改主站任何状态;它是一个独立源的隔离文档。代价是它**也无法继承站点的明暗主题与设计令牌**(`var(--…)` 跨文档不可见)—— 作者需在 `html` 内**自管配色**(建议显式给定背景与文字色,以同时适配明/暗环境)。

**向后兼容**:`schemaVersion` 仍为 1。旧渲染器遇到 `sandbox`(未知 type)按「跳过 + `console.warn`」处理,不崩溃。

---

## 3. quiz.json — 题库(引用模型)

**一道题在 `questionBank` 里定义一次,小节小测与章节考试都用 id 引用** —— 同一道题出现在多处时不再重复抄写,错题本也能据同一 id 去重。

```jsonc
{
  "questionBank": {                 // 题库:{ 题id: 题对象 };题id = 章号-三位流水,如 "4-001"
    "4-001": {                       // 单选 single
      "type": "single",
      "stem": "芯片减薄技术主要有:",   // 题干
      "options": ["A. ...", "B. ..."],// 每项以 "X. " 开头
      "answer": "A",                 // 正确选项字母
      "explain": "解析文本"
    },
    "4-002": { "type": "judge", "stem": "...", "answer": true, "explain": "..." },     // 判断:answer 为布尔
    "4-003": { "type": "sort", "stem": "...", "items": ["切割","贴膜"], "answer": ["贴膜","切割"], "explain": "..." }, // 排序:items 乱序,answer 正确顺序
    "4-004": { "type": "match", "stem": "...", "left": ["热压键合"], "right": ["压力高,300~500℃"],
               "answer": { "热压键合": "压力高,300~500℃" }, "explain": "..." }          // 匹配:answer={左:右}
  },
  "sectionQuizzes": {               // 小节小测:{ 知识点id: [题id...] }
    "4-1-1": ["4-001", "4-007"]
  },
  "examQuestions": {                // 章节考试:{ 章id: [题id...] }
    "4": ["4-001", "4-002", "4-003"]
  }
}
```

- 题型字段:`single` 用 `options`;`judge` 无 options(answer 为 `true`/`false`);`sort` 用 `items` + 数组 `answer`;`match` 用 `left`/`right` + 对象 `answer`。
- `type` 是**开放枚举**:渲染器按 type 分派,未知题型显示"暂不支持的题型"占位而非崩溃。
- 平台加载时把引用解析回内联题目交给渲染器,考试按章过滤。
- **向后兼容**:旧版"内联格式"(`sectionQuizzes` 直接放题对象 `{qid,q,options,ans,exp}`、`examQuestions` 为带 `chapter` 的扁平数组)仍可加载,无需迁移。

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
