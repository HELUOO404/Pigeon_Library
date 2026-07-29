# `.pigeon` 课程包格式规范 (schemaVersion 1)

> 本文件是**唯一权威契约**:拆包工具(`tools/build-pigeon.mjs`)与学习页渲染器(`app/src/render/*`)都必须严格遵守。任何字段改动先改本文件,再改代码。

`.pigeon` 文件本质是一个 **zip** 压缩包(后缀改名为 `.pigeon`)。解压后的根目录结构:

```
manifest.json     必需  课程元信息 + 章/节/知识点索引树
content.json      必需  知识点正文(类型化节点)
quiz.json         可选  题库:小节小测 + 章节考试
glossary.json     可选  术语表
assets/           可选  课程资源(图片、视频、字幕、仿真依赖等),content 用相对路径引用
  ├─ images/...
  └─ media/...
cover.png         可选  课程封面(manifest.cover 指向它)
```

加载流程:`fflate.unzipSync` 解压 → 校验 manifest/content → `assets/` 下受支持资源转 Blob URL → 渲染器按 manifest 索引树驱动,从 content/quiz/glossary 取数据渲染。

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
  "assetBase": "/courses/ic-packaging/",      // 可选。大媒体分离部署时的同源本地资源根路径
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

> **分离媒体**:`assetBase` 仅用于大视频等资源不放入部署版 `.pigeon` 时的同源本地回退。包内资源始终优先;回退路径必须是相对路径、以单个 `/` 开头的同源路径,或与当前页面同源的绝对 URL。完整迁移备份仍须包含所有媒体,不得把公网地址当离线资源。

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
| `paragraph` | `spans: Span[]` | `<p>` + 内联 span(见 §2.4) |
| `numTitle` | `text: string` | `<p><strong class="num-title">text</strong></p>`(编号高亮药丸) |
| `boldCaption` | `text: string` | `<p><strong>text</strong></p>`(如"封胶工艺参数") |
| `heading` | `text: string` | `<h4>text</h4>`(知识点内的小标题,较少用) |
| `image` | `src: string, alt?: string` | `<img loading="lazy" onerror=hide src alt ...>`;src 是 `assets/images/...` 相对路径,运行时换 Blob URL |
| `imageGroup` | `images: {src, alt?, caption?}[]` | 同组图片的原生响应式网格;窄容器自动单列,图片路径按 `image` 规则解析 |
| `list` | `ordered?: boolean, items: Span[][]` | `ordered:true` 渲染 `<ol>`,否则渲染 `<ul>`;列表项保留 Span 语义 |
| `paramsTable` | `headers: TableCell[], rows: TableCell[][]` | 站点原生语义表格;兼容旧字符串单元格,支持富文本、图片和合并单元格,窄容器自动重排。详见 §2.2 |
| `tabSet` | `id: string, tabs: {id, label, blocks}[]` | 卡片内原生标签页;默认首项,支持键盘与 ARIA,tab 内继续渲染普通 blocks。详见 §2.3 |
| `summaryBox` | `title: string, items: Span[][]` | `<div class="summary-box"><h4>title</h4><ul><li>…</li></ul></div>` |
| `compareBox` | `title: string, headers: string[], rows: CompareRow[]` | `<div class="compare-box"><h4>title</h4><table class="compare-table">…</table></div>` |
| `sectionQuiz` | `quizRef: string` | `<div class="section-quiz">`,题目来自 quiz.json.sectionQuizzes[quizRef] |
| `html` | `html: string` | **兼容性扩展位**:旧课程 HTML 片段先经浏览器 DOM/template 严格静态白名单消毒,仅保留文档、表格、图片与受限视频标签/属性;移除脚本、样式、嵌入对象、表单、事件属性及危险 URL,再解析相对资源路径。新课程能用原生块表达的标题、正文、列表、图片和表格不得使用本块;需要 JS 交互请用 `sandbox` 块 |
| `sandbox` | `html: string, id?: string, height?: number, dependencies?: string[], modeSwitch?: boolean` | **隔离沙箱**:把含 JS 逻辑的 HTML 片段渲染进 `<iframe sandbox="allow-scripts">`,脚本可运行但与主站完全隔离。`assets/...` 相对路径同样解析为运行时 URL;`height` 为初始/兜底高度(像素,缺省 320);动态加载依赖须逐项列入 `dependencies`;带练习/答案双模式时设 `modeSwitch:true`;建议提供稳定 `id` 供练习状态持久化。详见 §2.5 |
| `video` | `src: string, title?: string, poster?: string, captions?: string` | 本地原生视频播放器;视频、封面和 WebVTT 字幕都按课程资源路径解析。详见 §2.6 |
| `stepSimulation` | `id: string, title?: string, poster?: string, steps: StepSimulationStep[]` | 答题正确后逐步播放不可操作的仿真短片,结束后保持尾帧并解锁下一步。详见 §2.7 |
| `paramSelect` | `id: string, title?: string, groups?: ParamGroup[], matrixRows?: ParamMatrixRow[]` | 参数选择答题表(实验/工程参数设计):分组纵表或二维选择矩阵二选一,下拉全填后统一提交计分。详见 §2.8 |

- `CompareRow`:`{ "label": string, "cells": string[] }` — 首列是 `.compare-label`(行标题),其余是 `cells`。`headers[0]` 是对比项目列头,`headers[1..]` 是各方案列头。
- `summaryBox.items`:每个 li 是一个 `Span[]`(支持其中的 `<strong>` 加粗,如"**塑料封装**占90%市场")。

### 2.2 原生表格单元格(TableCell)

`paramsTable.headers` 与每一行 `rows[]` 都接受 `TableCell`。旧课程的字符串单元格保持有效;富单元格使用对象:

```jsonc
"普通文本"                              // 旧格式/简写
{ "text": "参数名称", "header": true, "scope": "row" }
{ "spans": [{ "t": "键合", "b": true }, { "t": "压力" }] }
{ "image": { "src": "assets/images/process.png", "alt": "工艺示意图" } }
{ "images": [{ "src": "assets/images/device-a.png", "alt": "设备 A" }, { "src": "assets/images/device-b.png", "alt": "设备 B" }] }
{ "text": "氧化阶段", "rowspan": 3 }
{ "text": "测试结果", "colspan": 2 }
```

- `text`、`spans` 可与 `image` 或 `images` 组合;存在 `spans` 时正文以 `spans` 为准。
- `images` 必须是非空图片数组,按数组顺序在同一单元格内显示;窄容器自动换行。`image` 与 `images` 不得同时出现。
- `header:true` 把该单元格渲染为 `<th>`;`scope` 仅允许 `row` 或 `col`。
- `rowspan`、`colspan` 必须是正整数,按 HTML 表格语义渲染。
- `image.src` 与 `images[].src` 按课程资源规则解析,图片始终限制在单元格宽度内。
- `headers` 可用单个 `colspan=N` 单元格表达表标题;若 `rows` 中随后出现覆盖全部逻辑列的 `header:true, scope:"col"` 行,该行作为后续数据最近的列名来源,表标题在移动端单独保留,不得重复成每列标签。
- 桌面保持二维语义表;容器不足时由站点按逻辑网格把每一数据行重排成独立“列名 + 值”记录,跨行共享单元格在相关记录中保留,不得要求课程数据复制列名,也不得产生卡片内横向滚动。

### 2.3 原生标签页(tabSet)

```jsonc
{
  "type": "tabSet",
  "id": "oxidation-theory",
  "tabs": [
    { "id": "theory", "label": "知识正文", "blocks": [/* 普通 blocks */] },
    { "id": "video", "label": "讲解视频", "blocks": [{ "type": "video", "src": "assets/media/oxidation.mp4" }] }
  ]
}
```

- `id` 在课程内唯一;tab 的 `id` 在当前 `tabSet` 内唯一。
- `tabs` 顺序即显示顺序,至少包含一个 tab,默认激活第一项。
- `blocks` 使用本节定义的普通块类型;**禁止嵌套 `tabSet`**。
- 标签按钮使用 `role="tab"`、`aria-selected`、`aria-controls`;面板使用 `role="tabpanel"`。
- 支持左右方向键、Home、End 与点击切换;切换只隐藏面板,不得销毁表单或仿真状态。
- 标签在窄容器中允许换行,不得产生卡片内横向滚动。

### 2.4 内联节点(Span) — paragraph / summaryBox.items / list.items 内使用

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

### 2.5 sandbox 块 — 隔离运行的交互片段

`html` 块在注入主页面前必须经过浏览器 DOM/template 结构化消毒;不得用正则替代 HTML 解析。标签与属性执行严格白名单:保留静态正文、语义表格、图片及受限的 `video/source/track`,移除 `script/style/link/iframe/object/embed/form`、交互控件、未知标签外壳、全部 `on*` 与 `style`,并拒绝 `javascript:` 等危险 URL。相对媒体路径消毒后通过 `resolveAsset` 解析。当课件确有「真靠 JS 驱动」的片段(点击切换、小计算器、动态图示)时,用 `sandbox` 块:

```jsonc
{
  "type": "sandbox",
  "html": "<button onclick=\"this.textContent='已点击'\">点我</button>",
  "height": 320,
  "modeSwitch": true
}
```

**渲染**:整段 `html` 装进一个 `<iframe class="sandbox-frame" sandbox="allow-scripts" srcdoc="...">`。脚本可运行,`assets/...` 相对路径在装入前解析为运行时 Blob URL(与 `image`/`html` 块一致)。

**高度与滚动归属**:`height` 只是在首次测量前或高度上报失败时使用的初始/兜底高度(像素,缺省 320),不是固定高度、最大高度或 iframe 内部滚动视口。sandbox 必须在 load、内容尺寸变化、容器宽度变化及收到父页 `{ type: 'pigeon-sandbox-layout' }` 后重新测量完整布局高度,并通过 `postMessage({pigeonHeight})` 上报;父页在所属 tab 激活后触发重测,按最新高度扩展 iframe 与所在卡片。布局稳定后 sandbox 的完整内容必须一次性可见,纵向滚动只属于学习页主内容区;其 `html`、`body` 和业务内容不得形成纵向或横向滚动容器,宽内容必须响应式换行或缩放,且不得裁剪题面、控件、图形或结果。学习页仍只接受本页生成 iframe 的高度消息(按 `contentWindow` 比对来源);脚本不运行或上报失败时保持 `height` 兜底值。

**依赖闭包**:HTML 属性或 CSS `url()` 中直接出现的相对资源会自动解析。脚本通过 `fetch()`、XHR、动态 `import()` 等间接加载的文件必须放在 `assets/simulations/<仿真id>/` 下,并在 `dependencies` 中逐项列出。分离部署会原样复制该完整目录,保持 JS/CSS/WASM/字体/JSON 的相对路径关系。依赖原站 PHP、登录态或全局对象的片段不能直接作为离线 sandbox,必须转换成本地适配器。

**安全边界(沙箱不获 `allow-same-origin`)**:沙箱内代码**无法直接**访问父页 DOM、`localStorage`、登录 cookie、学习进度,也不能任意修改主站状态;它是一个独立源的隔离文档。平台只接收下述白名单 `postMessage` 消息,并按 `contentWindow` 校验来源。

**练习/答案模式(可选)**:`modeSwitch:true` 时,平台在 iframe **外部**渲染与 `stepSimulation` / `paramSelect` 一致的原生分段控件「操作练习 / 参考答案」;iframe 内不得再放重复的答案按钮或模式标签。平台与对应 iframe 双向发送:

```js
{ type: 'pigeon-sandbox-mode', mode: 'practice' | 'answer' }
```

- 初始模式为 `practice`;点击外层控件时,平台只向同一 `.sandbox-wrapper` 内的 iframe 发消息。
- iframe 收到 `answer` 后显示来自已验证正确答案的只读参数与结果;收到 `practice` 后恢复用户练习值和可编辑状态。
- iframe 内的「清空」等操作若主动返回练习模式,须向父页回传同一消息;学习页按 `contentWindow` 校验来源后同步外层按钮。模式与答案展示仍为会话态;练习控件值由平台桥接并按下述规则保存。

**练习状态与分数回传**:平台自动采集 sandbox 内非密码/文件类 `input`、`select`、`textarea` 的值;含正确答案的交互仿真(如工程参数绘图)可在沙箱内**自行判分**,再通过 `postMessage({type:'pigeon-score', score, total, detail})` 把结果回传学习页。学习页据 `contentWindow` 比对来源后,在该 iframe 上方显示分数徽章(百分制得分 + 正确率 `n/total`,口径与 stepSimulation 一致)。`score`/`total` 为整数,`detail` 可选(一句话说明,如"3 项参数全部正确")。控件值与最近一次分数写入课程的 `simulations` 槽位:登录用户持久化并随进度同步,访客仅在当前页面会话暂存。`id` 作为稳定存储键;缺省时平台按 `html + dependencies` 生成确定性键。正确答案仍随课程包一并离线,判分不依赖网络或登录态。

**设计令牌注入**:`var(--…)` 跨文档本不可见,为此学习页在组装 srcdoc 时把当前主题下的一组**白名单令牌**以 `<style>:root{…}</style>` 前置注入 iframe,并在主题切换时向所有 sandbox iframe `postMessage({type:'pigeon-theme', tokens:{…}})`,由注入的引导脚本更新 `:root`(引导脚本 load 后也会主动发 `{type:'pigeon-theme-request'}` 握手,防止切换消息早于 iframe 加载而丢失)。可用令牌:

> `--paper` `--surface` `--card` `--ink` `--text` `--text-soft` `--line` `--line-2` `--gold` `--gold-deep` `--seal` `--hover` `--serif` `--sans` `--mono` `--radius` `--correct-bg` `--correct-tx` `--wrong-bg` `--wrong-tx`

课程包 CSS **建议写 `var(--ink, #24211d)` 带兜底值**,保证包在旧版渲染器或裸浏览器打开时仍可读;沙箱内配色应优先走令牌,使内容自动跟随站点明暗主题。

**向后兼容**:`schemaVersion` 仍为 1。旧渲染器遇到 `sandbox`(未知 type)按「跳过 + `console.warn`」处理,不崩溃。

### 2.6 video 块 — 本地视频

```jsonc
{
  "type": "video",
  "title": "原站视频标题",
  "src": "assets/media/lecture-01.mp4",
  "poster": "assets/images/lecture-01.jpg",
  "captions": "assets/media/lecture-01.vtt"
}
```

- `src` 必需;支持 `mp4`、`m4v`、`mov`、`webm`、`ogg`。
- `poster`、`captions` 可选;字幕使用 WebVTT。Web 交付构建可在缺少 `poster` 时从同一视频约 0.5 秒处生成压缩首帧并写入构建副本，避开常见的空白起始帧；课程源不改、字段语义不变，派生文件必须进入资源清单与哈希校验。
- 平台初始只显示独立 poster 和播放按钮，不创建视频 source；用户点击播放后才加载完整视频。poster 可有损压缩，只是播放前预览，不替代完整视频或正文最终图片。页面任一时刻只保留一个活动完整视频传输，启动新视频会卸载旧 source，避免多个大文件竞争家庭网络。
- 便携包内资源转为 Blob URL;分离部署资源通过 `manifest.assetBase` 从同源本地目录读取。
- 视频标题、字幕和伴随文字属于课程原文,必须逐字保留。

### 2.7 stepSimulation 块 — 答题门控的连续仿真短片

```jsonc
{
  "type": "stepSimulation",
  "id": "exp-43-flow",
  "title": "BGA封装工艺流程设计",
  "steps": [
    {
      "prompt": "原站步骤题目",
      "options": ["原站选项一", "原站选项二"],
      "answerIndex": 2,
      "clip": "assets/media/exp-43-step-01.mp4",
      "poster": "assets/images/exp-43-step-01.jpg",
      "explain": "增强解析(可选)"
    }
  ]
}
```

- `id` 必需且在课程内唯一;用于保存该仿真的本地练习状态。
- `answerIndex` 为从 1 开始的选项序号,必须来自当前网站的满分验证结果。
- `explain` **可选**,答对/答错反馈里附带的解析文本;属**增强内容**,不得改写题干、选项与答案(见忠实度约定)。
- 练习模式各步骤可任意顺序填写,全部选择后统一提交计分。选错不泄露答案;选对后只加载并立即播放对应 `clip`,播放结束保持尾帧；切换步骤会先卸载旧片段，任何时刻最多一个片段播放器。
- **提交后**每个步骤行显示对错:答对标金、答错标红并给出正确答案(有 `explain` 时一并展示),口径与小节小测的选择题反馈一致。
- 答案模式显示已经验证的正确序列,切换时从第一段开始连续回放；后一段只在前一段有效结束后创建，不提前加载后续短片。
- `prompt` 与 `options` 是网站题目原文,不得改写。提取时还必须保留源 HTML、脚本、短片顺序与答案验证证据。

**分组形态(`groups`)**:原站流程设计页是两级答题 —— "功能区"一级本身也是下拉答题项(选错同样扣分),其下才是各工序步骤。此类页面用 `groups` 表达:

```jsonc
{
  "type": "stepSimulation",
  "id": "exp-29-flow",
  "title": "CMOS反相器工艺流程设计",
  "groups": [
    {
      "prompt": "功能区",                       // 可省
      "options": ["栅氧化区", "光刻区"],         // 组头下拉题(原站原文)
      "answerIndex": 1,                         // 1 起;来自满分验证
      "steps": [ /* 同上文 StepSimulationStep */ ]
    }
  ]
}
```

- `groups` 与扁平 `steps` **二选一**;两者同时出现时渲染器取 `groups` 并 `console.warn`。旧扁平写法继续支持,等价于单组无组头。
- 计分与进度分母 = 组头题数 + 全部步骤题数。
- 组头选对**不播放视频**(原站组头无短片),仅给视觉确认;组内步骤行为与扁平形态一致。
- UI 上组渲染为手风琴,默认展开第一个未完成组;页面内步骤列限高内滚,可进入全屏覆盖层练习;移动端(≤768px)不渲染视频面板。

### 2.8 paramSelect 块 — 参数选择答题表(实验/工程参数设计)

原站的「实验·参数设置」与「工程·工艺参数设计」是同一交互的多种表格形态,全部填写后统一提交计分。普通实验是三列平表(`序号|项目|选择`),少数实验在同一数据行中包含多个选择框;工程多出「结构→工艺」两级合并单元格。普通/工程纵表使用 `groups`,二维选择矩阵使用 `matrixRows`,两者必须二选一。部分参数区间带一个**仿真按钮**——实测该按钮(`btn_gycsfz`)提交后由 Submission.php 返回的是**已验证的结果图片路径**(非交互页面),点击即弹出对应静态图。按钮的 rowspan 挂靠层级在不同活动里不统一(有的挂最细的「工艺」组,有的挂粗的「结构」组),因此不与 `groups` 绑定,改用**参数序号区间**独立描述:

> 注意区分:**答对才能看的流程短片仿真**(左边选工序、右边播视频)是 `stepSimulation`(§2.7),与本块无关;`paramSelect` 的 `simulations` 专指**原站已验证的结果图**,不是交互 sandbox。

```jsonc
{
  "type": "paramSelect",
  "id": "eng-1-params",                 // 必需,课程内唯一;练习状态持久化 key
  "title": "参数设置",                   // 可省
  "headers": ["序号", "结构", "工艺", "参数名称", "选择"],  // 可省:原站表头逐字保留(不含仿真按钮列)
  "groups": [
    {
      // merged:与 headers 中间列(序号与参数名称之间)对齐的组级合并单元格值,
      // 每组给全值(上级列跨多组时逐组重复);字符串 = 文本。
      // 单图可用 {"image":"assets/images/..."} 或 {"image":{"src":"...","alt":"..."}};
      // 多图用 {"images":[{"src":"...","alt":"..."}, ...]},按源顺序显示。
      // 渲染器把相邻组同列的相同文本值合并为 rowspan(还原原站 埋层 rowspan=27 跨多工艺组)。
      // 简写:实验平表(序号|项目|选择)省略 merged 与 headers;
      //       "structure"/"process" 字段是 merged 两列形态的等价简写。
      "merged": ["埋层", "热氧化工艺参数"],
      "params": [
        {
          "label": "埋层的厚度",          // 参数名称(原站原文)
          "options": ["1um", "2um", "3um"],
          "answerIndex": 2,              // 1 起;来自满分验证
          "explain": "增强解析(可选,不得改写题面)"
        }
      ]
    }
  ],
  "simulations": [                       // 可省;每项对应原站一个仿真按钮
    {
      "label": "埋层-氧化工艺参数仿真",    // 按钮文字(原站原文)
      "paramRange": [1, 8],              // 覆盖的全局参数序号区间(1 起,含端点,对齐 params 全局编号)
      "images": [
        { "src": "assets/images/eng-1-oxide.jpg", "alt": "氧化结果", "caption": "氧化结果" }
      ]                                      // 已验证结果图；字符串简写继续兼容，对象可保留逐图说明
    }
  ]
}
```

二维选择矩阵把源表的每一行（包括真正的列标题行）依次写入 `matrixRows`，不得把 `<th>` 压成普通字符串。每个 cell 使用 `{tag,scope?,rowspan?,colspan?,content}`：`tag` 为 `th` 或 `td`；`scope` 仅用于 `th`；`content` 按源单元格阅读顺序保存文本与选择控件。合法空白固定格使用 `content: []`，不得补造文字。参数全局编号按 `matrixRows` 行顺序、cell 顺序、再按 `content` 顺序递增,供状态和 `simulations[].paramRange` 共用:

```jsonc
{
  "type": "paramSelect",
  "id": "experiment-3-1",
  "matrixRows": [
    { "cells": [
      { "tag": "th", "scope": "col", "content": [{ "type": "text", "text": "工艺名称" }] },
      { "tag": "th", "scope": "col", "content": [{ "type": "text", "text": "步骤名称Step Name" }] },
      { "tag": "th", "scope": "col", "content": [{ "type": "text", "text": "工艺气体" }] },
      { "tag": "th", "scope": "col", "content": [{ "type": "text", "text": "备注Remark" }] }
    ] },
    { "cells": [
      { "tag": "td", "content": [{ "type": "control", "label": "工艺名称", "options": ["CMOS_SiO2", "CMOS_Si3N4"], "answerIndex": 1 }] },
      { "tag": "td", "content": [{ "type": "text", "text": "CMOS1" }] },
      { "tag": "td", "content": [{ "type": "control", "label": "工艺气体", "options": ["O2", "SiH4+N2O"], "answerIndex": 2 }] },
      { "tag": "td", "content": [{ "type": "text", "text": "淀积氧化硅" }] }
    ] }
  ]
}
```

- `content` 项只有两种：`{ "type":"text", "text": string }` 与 `{ "type":"control", "label": string, "options": string[], "answerIndex": number }`。同一格允许“前文字 → control → 后文字”，前后文字（包括原始空格和单位）逐字符保留。
- `rowspan`、`colspan` 为正整数；桌面按原生表格语义渲染。`th` 的 `scope` 仅允许 `row` 或 `col`。
- 第一行全部为 `th scope:"col"` 时，平台将其作为列标题，并在移动端用作字段名；包含 `th scope:"row"` 的普通源行在移动端以行标题分组。课程数据不得另造移动端标签。

**行为(平台统一实现,课程包零 JS)**:

- 各下拉可任意顺序填写;全部填写后「提交」可用,统一计分,显示 `得分 <百分制> 分 · 正确率 n/m`(口径同 stepSimulation)。
- 提交后逐项反馈:答对绿框、答错红框 + 行下「正确答案:…」(有 `explain` 一并展示);修改任一选择即清除对错态。
- 「参考答案」模式:下拉替换为已验证答案文本,不带对错色。
- **仿真按钮:`paramRange` 覆盖的全部参数填写后出现(与对错无关,忠实原站行为)**;点击展开 `images`。图片项可为资源路径字符串，或 `{src,alt,caption?}`；对象形态按源顺序渲染图片与可选逐图说明，不额外判分。再次点击收起。
- `groups` 桌面渲染为合并单元格表:`headers` 首列固定为序号、末列固定为选择,中间列 = 各组 `merged` 值(相邻组同列同文本自动 rowspan 合并)+ 参数名称。`merged` 单图兼容 `{"image":"assets/..."}` 与 `{"image":{"src":"...","alt":"..."}}`;多图使用 `{"images":[{"src":"...","alt":"..."}, ...]}`,逐项按课程资源规则解析并保留顺序与 `alt`。
- `matrixRows` 桌面严格按源 rows/cells 保持二维行列、表头与合并关系;固定文本与选择框不得换列、拆行或补造。窄容器按源行重排：列标题表使用源 `th scope:"col"` 作为字段名，行标题表保留源 `th scope:"row"`；桌面与移动表示共享同一练习状态。
- 仿真按钮置于表格下方,按 `paramRange` 起点顺序排列,不占表格列。课程数据不得复制移动端列名,也不得依赖横向滚动。
- 练习状态(已选项/提交结果)按 `id` 持久化,登录后随进度同步;访客会话内暂存。
- **向后兼容**:旧渲染器遇未知 type 跳过 + `console.warn`,`schemaVersion` 仍为 1。

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
| `too-large` | 文件 > 1GB | 文件超过 1GB 上限 |
| `not-zip` | 无法解压 | 文件已损坏或不是 .pigeon 课程包 |
| `no-manifest` | 缺 manifest.json | 缺少 manifest.json |
| `bad-manifest` | 缺 id/title/chapters | manifest 格式错误:缺少 … |
| `no-content` | 缺 content.json | 课程内容缺失 |
| `bad-content` | content 无 knowledgePoints | 课程内容格式错误 |
| (警告级) | content 引用的图片在包内找不到 | 可导入,提示"N 张图片缺失"(由 `<img onerror>` 容错) |

---

## 6. 给 AI 的课程制作指南(首页 E 区展示 + 一键复制提示词)

见 `docs/ai-course-authoring-prompt.md`。要点:
1. 按本规范产出必需的 `manifest.json` / `content.json`、可选的 `quiz.json` / `glossary.json` / `cover.png`,以及包含图片、媒体和仿真依赖的 `assets/`。
2. **术语表制作**:从教材自动抽取缩写/专名 → `{t,full,cn,d}`;`t` 用正文实际写法。
3. **题目解析制作**(针对只有题目无解析的课程):为每题自动生成优质解析 → ① 为什么对 ② 其他选项为什么错 ③ 关联知识点 ④ 记忆要点;按题型区分侧重;须基于课程正文,不杜撰,存疑标"需人工复核"。
