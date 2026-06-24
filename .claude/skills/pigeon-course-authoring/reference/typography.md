# typography.md — 智能排版与可读性

> 目标:**排版好看、层次清晰、可读性高 —— 但全部走块类型与平台 CSS,绝不靠改正文文字或往数据里塞空格/缩进实现。**
> 字段权威见 [`docs/pigeon-format.md`](../../../../docs/pigeon-format.md);本文只讲「怎么选块、怎么排得好看」。

## 一、铁律:版式由平台负责,数据保持忠实

学习页 CSS 已经自动做掉这些,**不要在 content.json 里手动做**:

| 想要的效果 | 谁来做 | 你**不该**做的事 |
|---|---|---|
| 正文段落首行缩进两格 | 平台 CSS(`.card-body>p{text-indent:2em}`) | ❌ 往段首塞全角空格 `　　` |
| 标题 / 题目顶格不缩进 | 平台 CSS(标题非 `<p>`;题目在 `.section-quiz` 内) | ❌ 手动对齐 |
| 宽表手机端左右滑 | 平台 CSS(`.table-scroll`) | ❌ 删列 / 改表 |
| 明暗主题配色 | 平台令牌 | ❌ 在正文写死颜色(sandbox 除外,见下) |

**原因**:正文/题目要 100% 忠实于原文(连错别字都只在打包后提醒、不擅改)。任何「为了排版」往数据里加的字符,都会破坏忠实度,并被 `scripts/verify-fidelity.mjs` 拦下。

## 二、层次结构 —— 用块类型承载,不用 emoji 撑层次

正文的「标题感 / 层次感」靠选对块类型,而不是靠加 emoji 或符号:

| 想表达 | 用 | 渲染 |
|---|---|---|
| 知识点内的小标题 | `heading{text}` | `<h4>`(衬线、邮政金) |
| 编号小标题(1./2./3.) | `numTitle{text}` | mono 编号药丸(暖底) |
| 加粗小标题(如"封胶工艺参数") | `boldCaption{text}` | 独占一行的 `<strong>` |
| 段内子标题(如"1)盖印式") | paragraph 里的 `{t,sub:true}` span | `.sub-title` 样式 |
| 普通强调 | paragraph 里的 `{t,b:true}` span | `<strong>` |

> `numTitle` / `boldCaption`(strong 独占整段)平台会自动**不缩进**;普通段落自动缩进 —— 所以编号小标题会顶格、说明文字会缩进,层次天然分明。

**emoji**:正文 emoji 由作者自由(如 `summaryBox.title` 写 "📝 知识点梳理" 完全可以,课程数据不受平台 UI 禁 emoji 规则约束)。但**层次不要只靠 emoji** —— 该用 numTitle 的地方用 numTitle,emoji 只作点缀。

## 三、表格选型

| 表的形态 | 用 | 说明 |
|---|---|---|
| 规则的「参数—值」「多列规则」表 | `paramsTable{headers,rows}` | 居中、斑马纹;表头深色 |
| 对比多个方案/项(首列是行标题) | `compareBox{title,headers,rows[{label,cells}]}` | 顶部 hairline + 衬线标题 |
| 合并单元格(`rowspan`/`colspan`)、单元格内嵌图 | `html{html}` | 逃生舱;手写 `<table>`,`assets/` 相对路径自动解析 |

- **宽表不用操心手机**:平台已给 `paramsTable`/`compareBox` 自动套横向滚动壳,窄屏左右滑、不撑破布局。`html` 块里的宽表如需同样效果,自己在外面包一层 `<div class="table-scroll">`。
- **能用结构化块就别用 html**:`paramsTable`/`compareBox` 能表达的,优先用它们(语义清晰、明暗主题自适应、术语提示能命中)。`html` 只留给它们表达不了的复杂结构。

## 四、html vs sandbox —— 静态用 html,要 JS 才用 sandbox

渲染器用 `insertAdjacentHTML` 注入 `html` 块,**其中 `<script>` 与内联事件永不执行**(安全)。据此二选一:

- **静态复杂结构**(合并单元格表、图文混排、自定义布局)→ `html` 块。无脚本,直接渲染。
- **真需要 JS 交互**(点击切换、小计算器、动态演示)→ `sandbox` 块:
  - 渲染进隔离 `<iframe sandbox="allow-scripts">`,脚本能跑,但**读不到父页 DOM/localStorage/登录态**。
  - **必须自管配色**:沙箱是独立文档,继承不到站点明暗主题与令牌。给你的元素显式设背景与文字色(建议浅底深字,明暗环境都清楚)。
  - `height` 给初始/兜底高度(缺省 320),运行时按内容自适应。
  - 处理课件里**别人写好的 JS 片段**时:**只把配色改成自洽可读,绝不改动逻辑**。

## 五、可读性小结

- 段落别太长;一个段落一个意思,长内容拆成多个 `paragraph`。
- 每个知识点末尾用 `summaryBox` 收束 3–5 条要点(`items` 支持加粗)。
- 易混概念用 `compareBox` 做「对比记忆卡」,比纯文字更好记。
- 概述卡(`overviews`)放「这一节讲什么」,知识点卡放细节 —— 别把概述写成正文。
- 图片配 `alt`;封面用 `cover.png` 或 `coverText`(二选一)。
