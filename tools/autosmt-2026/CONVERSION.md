# AutoSMT 2026 → PigeonLib `.pigeon` 转换规范

> 版本：1.0（本轮重建唯一操作规范）
> 适用课程：`2026-ic-manufacturing`、`2026-ic-devices`、`2026-ic-packaging`
> 规范状态：已确认需求；未满足任一硬停止条件时不得生成正式交付包。

本文件是 AutoSMT 原站内容转为 PigeonLib 课程包的唯一转换规范和操作手册。它把
[`REBUILD-REQUIREMENTS.md`](./REBUILD-REQUIREMENTS.md) 的要求落成可执行步骤；`.pigeon`
字段仍以 [`docs/pigeon-format.md`](../../docs/pigeon-format.md) 为唯一格式契约。若两者出现
冲突，先修正格式契约和本文件，再改脚本。不得把本文件理解为允许修改原始抓取资料的授权。

## 0. 不可违背的边界

1. **来源唯一**：新课程的正文、题干、完整选项、答案、图片、视频、仿真公式和仿真证据
   只能来自 AutoSMT 2026 原站抓取及其满分审计。`奥施特资料/` 只能作为来源交叉核对，
   未建立 AutoSMT 2026 来源映射和哈希前不能覆盖抓取证据；
   `dist-courses/ic-packaging.pigeon` 和 `platform-runtime-preview` 只能提供结构、排版、
   交互参考，不能贡献正文或题库。
2. **只读源**：`参考项目/`、`tools/autosmt-2026/reports/source-capture/`、
   `reports/activity-details/` 及其资源映射只读。禁止格式化、修补、覆盖、删减或在原文件中
   注入新内容。
3. **原文保真**：逐字保留标点、单位、明显错别字和原始顺序；不润色、不纠错、不补写。
   疑似错别字只能列入最终报告，不能静默修改。
4. **站点原生化**：章节、卡片、标题、正文、列表、图片、图片组、表格、tab、下拉和反馈
   全部使用 PigeonLib 公共渲染器与设计令牌。课程 JSON 不写死颜色、字体、间距、圆角、
   固定宽度、原站 class/style 或原站蓝色大标题。
5. **离线闭包**：视频、海报、字幕、图片、短片、Canvas 依赖和结果图必须在包内或
   `assetBase` 同源本地目录中；禁止原站 PHP、登录态、Cookie、外链和运行时网络依赖。
6. **卡内无横向滚动**：所有目标视口都必须满足
   `document.documentElement.scrollWidth <= innerWidth`；不得以隐藏列、裁图、缩小到不可读
   或给卡片加横向滚动条来“通过”检查。
7. **先样板、后批量**：先只做 `0-1`（第 1 章第 1.2 节“氧化”）黄金样板。自动门禁和
   用户明确人工确认都通过前，不得批量重建三门课程。

## 1. 权威资料和目录约定

### 1.1 来源与证据

下表的 `reports/...` 路径均相对于 `tools/autosmt-2026/`。

| 用途 | 权威路径/文件 | 用法 |
| --- | --- | --- |
| 章节、节、活动目录 | `reports/source-capture/sections/<chapterIndex>-<sectionIndex>/menu.html`、`manifest.json` | 解析原站章/节标题、活动名称和组件边界 |
| 节概述 | 同目录 `overview.html` | 转为 `content.overviews[sectionId]` |
| 理论索引 | 同目录 `theory.html` 的 `strllzs` | 得到每个独立理论主题及其源 HTML |
| 理论正文与图片 | `reports/resource-capture-theory-v1.json` → `source-capture/resources/*.html` | 逐字解析为原生 blocks |
| 讲解视频 | 同目录 `lecture-video.html`、`resource-capture-video-v1.json` | 标题、顺序、视频、海报、字幕映射 |
| 作业题面 | 同目录 `homework.html` | 题干和选择器的完整选项正文 |
| 活动 tab | `reports/activity-details/*.json` + 对应 `.html` | tab 标签、类型、表格、脚本变量和媒体边界 |
| 满分答案 | `reports/ui-state-*.json`（只接受 `score === 100`）及有对应满分记录支撑的 `candidate-answers.json` | 参数/流程/作业正确答案证据；候选文件单独不能定案 |
| 两级流程分组 | `current-site-indexed-gnq-map.json` | 交叉验证组头和子步骤序号 |
| 流程短片 | `process-step-video-capture-v1.json` | 步骤顺序、视频、海报和尾帧 |
| 工程结果图 | `engineering-simulation-capture-v1.json` | 原站按钮返回的已验证结果图片 |
| 资源完整性 | `resource-capture-*.json`、`activity-resource-inventory.json` | 本地复制和哈希闭包 |

编码按实际文件判断：脚本用 UTF-8 严格解码，失败时回退 GB18030；不得凭显示乱码猜测文本。
每一个生成字段都应能回指“源文件 + DOM 路径/变量 + 证据文件”。

### 1.2 目标课程包结构

每门课仍使用原课程 ID，版本递增；新版本首次加载时清空旧版本的学习进度、答题、错题、
考试和仿真练习状态。包的最小结构为：

```text
manifest.json
content.json
quiz.json
glossary.json
assets/images/...
assets/media/...
assets/simulations/<simulation-id>/...   # 仅 Canvas/sandbox 的离线依赖
```

`manifest.chapters` 必须保持原章号：制造=1，器件=2、3，封装=4、5、6；标题为
`第N章 …`，`tabLabel` 为精确的 `第N章`。节 ID 为 `N.M`、知识点 ID 为 `N-M-K`，遵守
[`docs/pigeon-format.md`](../../docs/pigeon-format.md) 的 ID 约定。

`manifest.version` 必须相对已发布版本递增。学习页按“课程 ID + 最后见到的版本”识别一次性
迁移：首次看到新版本时清理该课程的进度、答题、错题、考试和仿真状态，记录新版本后不再
重复清理；不能通过更换课程 ID 绕过迁移。

每个节的顺序固定为：

```text
第N章 …
  第N.M节 …
    overview（原生概述）
    独立理论知识卡 1…K
    独立实验卡 / 工程卡（按原活动顺序）
    无法可靠归属的视频才放“补充视频”卡
```

不得生成“理论知识”“讲课视频”“作业”泛化卡，不得保留独立作业章节或作业卡。一个可
独立学习的理论主题就是一张知识卡；活动名称保留原站名称。

侧栏由同一份 `manifest.chapters[].sections[].knowledgePoints` 驱动，固定为“章节 → 小节 →
知识卡”三级：章节可折叠且同一时间只展开当前章，当前章内小节和知识卡全部显示，小节本身
不再折叠。顶部章节 tab 与侧栏同步；窄屏把同一目录树放进抽屉，不维护第二份目录。知识卡
独立折叠且默认收起；目录定位必须展开目标卡并滚动到卡片，但不强制关闭其他卡。卡片展开
状态只保留当前浏览会话，不写学习进度、不云同步。目录文字必须完整换行，不能截断或横向滚动。

## 2. 总体流水线与阶段门禁

### 2.1 执行顺序

1. **预检**：确认源目录只读、证据索引存在、纳入范围的活动均已满分审计，建立本次转换
   的源清单和哈希快照。
2. **解析**：按本文件第 3 节将 menu、overview、理论、视频、题目和活动 tab 解析为中间
   语义对象；每个对象附 `sourceFile`、DOM/变量定位和证据引用。
3. **原生化**：把中间对象映射为 `paragraph`、`numTitle`、`boldCaption`、`heading`、
   `list`、`image`、`imageGroup`、`paramsTable`、`tabSet`、`video`、`paramSelect`、
   `stepSimulation` 或经批准的 `sandbox`。理论卡不得使用 `html`。
4. **题目归属**：生成版本化 `question-knowledge-map.json`，以理论原文证据审核每题唯一
   知识点，再生成 `questionBank`、知识点 `sectionQuiz` 和章节 `examQuestions` 的 ID 引用。
5. **资源闭包**：复制并哈希所有本地资源，替换所有相对路径；扫描 JSON、HTML、CSS、
   `srcset`、`poster`、`captions`、`clip` 和 sandbox `dependencies`。
6. **黄金样板门禁**：只构建 `0-1` 氧化小节，跑自动测试、构建和浏览器 QA；提交截图、
   结构对照、Canvas 参数差异和控制台/资源报告，等待用户明确人工确认。
7. **全量重建**：仅在确认后运行三门课程转换，逐章自动遍历并人工分层抽查。
8. **打包交付**：先忠实度和资源门禁，再生成分离部署包；最后运行 `ic-packaging.pigeon`
   回归，确认参考包没有视觉或行为退化。

任何一步失败都停止该阶段，不用“尽量生成”“占位文本”“回退整段 HTML”掩盖失败。

### 2.2 当前脚本的基线和必须改造项

归档的 `archive/build-course-content-legacy.mjs` 是早期流水线，仅用于审计历史行为，
不得作为当前转换入口；其产物**不等于本规范合格产物**：

- `convertOverview` 已按段落和图片输出原生 `paragraph/image`，可保留其思路。
- `convertTheory` 当前输出 `heading + html`；必须改为逐主题知识卡，并解析为原生标题、
  Span、列表、图片、图片组和 `paramsTable`，理论卡禁止 `html`。
- `convertLecture` 当前生成独立“讲课视频”知识点；必须归入关联理论卡的 `tabSet` 的
  “讲解视频” tab，无法匹配才生成节末补充视频卡。
- `convertHomework` 当前从 `<option value>` 只取 `A/B/C` 字母；必须从题干/选项 DOM 提取
`A. 完整正文`，并逐项核对数量、字母和满分答案。
- `convertActivity` 当前按 tab 追加 `heading`，未知 tab 回退 `html`；必须改成单活动单卡
  的 `tabSet`，tab 内用原生 blocks；只有不可表达的真实交互才进入隔离 `sandbox`。
- 当前缺失工程仿真图时会继续生成并写提示段；新流程必须在证据缺失时硬停止，不能交付
  占位段落。
- 当前没有强制生成 `question-knowledge-map.json`，也没有验证每题在小测和章节考试各出现
  恰好一次；这两个检查必须作为独立门禁。
- 当前 `verify-course-fidelity.mjs` 主要做“生成文本是否存在于全局源文本池”的检查，尚不
  等于逐字段来源审核；新流程必须递归检查 `tabSet`、`list`、`imageGroup`、富
  `paramsTable`、视频标题、题目完整选项和映射证据。

这些改造不能通过修改 `reports/source-capture` 或复制原站 CSS 来规避。

## 3. 源对象 → 目标原生块映射

### 3.1 章节、节、概述和卡片

| 原站对象 | 目标位置/块 | 转换规则 |
| --- | --- | --- |
| `menu.html` 的章标题 | `manifest.chapters[].title/tabLabel` | 标准化为 `第N章 …` 与 `第N章`；只去除重复包装，不改正文 |
| `menu.html` 的节标题 | `manifest.chapters[].sections[].title` | 标准化为 `第N.M节 …` |
| `overview.html` 的 `<p>` | `content.overviews[sectionId].blocks[]` 的 `paragraph` | 保留文字和顺序，允许 Span；不携带原 class/style |
| `overview.html` 的 `<img>` | `image` | 资源本地化并保留源 `alt`；只有相邻原文明确给出说明时才能据此填写，找不到资源即硬停 |
| 理论索引中的一个独立主题 | 一个 `knowledgePoints[kpId]` | 主题标题是卡片标题；不可把整个节塞入“理论知识”卡 |
| 实验/工程活动 | 一个独立知识卡 | 卡片位于该节理论卡之后，保留活动原名和全部 tab |

原站与卡片标题重复的蓝色大标题直接删除；原站编号型小标题变为 `numTitle`，说明型小标题
变为 `boldCaption`，少量真正的层级标题才用 `heading`。标题层级来自语义，不复制原站
字体、颜色、大小、边框或固定宽度。

### 3.2 理论正文

`theory.html` 的 `strllzs` 给出主题顺序；每个 `<object data="../Html/<主题>.html">`
对应一份已抓取理论资源。转换器必须：

1. 读取 `<body>` 内部，记录源文件和 DOM 路径。
2. 删除与卡片标题重复的顶层大标题，保留正文文字原样。
3. 将段落拆成 `paragraph.spans`。Span 只允许 `{t}`、`{t,b:true}`、`{t,sub:true}`；
   遇到链接、内联图片、未知标签或无法判断的嵌套，报告课程、节、文件、DOM 路径和原始
   片段后硬停。
4. 将有序/无序列表转为 `list`，项目保留 Span；将编号/说明小标题转为 `numTitle`/
   `boldCaption`。
5. 将静态表按第 4 节分类并转 `paramsTable`；将并列图片转 `imageGroup`，单图转 `image`。
6. 为每一个生成字段保留源证据，运行忠实度检查；理论卡不得用 `html` 兜底。

正文首行缩进、字阶、段距和图片间距由站点公共 CSS 控制。原站的 Word/Axure 蓝色大字、
`style`、`class`、宽高和表格 CSS 一律丢弃。

### 3.3 卡内 tab 和视频

同一理论主题或活动的所有原站 tab 必须放在同一张卡中：

```jsonc
{
  "type": "tabSet",
  "id": "1-2-1-oxidation",
  "tabs": [
    { "id": "theory", "label": "知识正文", "blocks": [] },
    { "id": "video", "label": "讲解视频", "blocks": [] }
  ]
}
```

`tabs` 顺序、名称和内容顺序与原站一致；默认第一个 tab；禁止嵌套 `tabSet`。tab 切换
只隐藏面板，不销毁已填写的下拉、练习或仿真状态。键盘、ARIA、焦点、换行和移动端样式
由公共渲染器实现，不在课程数据里硬编码样式。

视频归属按标题和正文的可证据关联判定：可靠匹配的 `video` 块进入“讲解视频”tab；不能
可靠匹配的进入该节末尾“补充视频”卡。`src`、`poster`、`captions`、标题、顺序和字幕
必须逐字/逐文件映射并本地化。不得生成独立“讲课视频”导航卡。

## 4. 表格和布局转换

先判断表格语义，再选块型；不能看见 `<table>` 就机械生成 `paramsTable`。

### 4.1 分类规则

| 原表语义 | 目标块 | 必须保留 |
| --- | --- | --- |
| 静态数据/对照表 | `paramsTable` | 表头、文本、单位、图片、顺序、`rowspan`/`colspan` |
| 参数下拉答题表 | `paramSelect` | 参数名、全部选项、满分答案、分组/合并关系、仿真按钮区间 |
| 工艺流程下拉答题表 | `stepSimulation` | 每步题干、选项、答案序号、短片/尾帧；两级时保留组头 |
| 仅排版图片/段落的布局表 | `paragraph` + `image`/`imageGroup` | 阅读顺序、图片和说明；不能伪装数据表 |
| 真正需要 JS 的交互片段 | `sandbox` | 原题信息、独立脚本、依赖清单和令牌注入 |

禁止保留原站表格 HTML、固定列宽或原站表格样式。`paramsTable` 使用
[`docs/pigeon-format.md`](../../docs/pigeon-format.md) §2.2 的 `TableCell`：字符串仍兼容；
富单元格可组合 `text`/`spans`/`image`、`header`、`scope`、`rowspan`、`colspan`。对象单元格
不得被序列化成 `[object Object]`。

桌面端保持二维语义表；窄屏由站点转换成“列名 + 值”的纵向记录，合并单元格变为分组标题或
共享字段。不得隐藏列、截断文本、裁剪图片或添加卡内横向滚动。

## 5. 实验、工程和双层下拉

### 5.1 活动卡和 tab

读取 `activity-details/<chapter>-<section>-<type>-<number>-tab-<subIndex>.json` 与对应
HTML，按 `subIndex` 排序。一个活动对应一张卡、一个 `tabSet`；tab label 使用 metadata
的 `label`，不把 tab 误当成多张卡。静态说明、参数矩阵、图片、视频和按钮原始顺序全部保留。

### 5.2 `paramSelect`（参数选择表）

适用于实验参数设置和工程工艺参数设计。每个下拉都是独立题目；全部填完后统一提交并逐项
计分。生成：

- `groups[].params[].label`：原参数名；`options`：原站完整选项文本；`answerIndex`：
  1 起，来自 `score === 100` 审计，不猜测。
- `headers`：原表头逐字保留（不新增仿真按钮列）。
- `groups[].merged`：按原 `rowspan` 还原的结构/工艺合并值；图片单元格用
  `{ "image": "assets/images/..." }`。
- `simulations[]`：每个原站仿真按钮独立记录 `label`、全局 `paramRange` 和已验证
  `images`。按钮按覆盖参数全部填写即出现，与对错无关；点击显示原始结果图。

`paramRange` 按全局参数序号描述，不与 `groups` 绑定，因为工程 1、2、6 的按钮 rowspan
挂靠层级不同。缺任一结果图、参数、选项、单位或满分证据即硬停。

### 5.3 `stepSimulation`（流程答题）

平表使用 `steps`；原站两层“功能区/流程名 → 具体工序”必须使用 `groups`：

- 组头下拉保存自己的 `prompt`、完整 `options`、`answerIndex`，并独立计分。
- 每个子步骤保存自己的题干、完整选项、答案序号和 `clip`/`poster`；答对后播放对应短片，
  结束保持尾帧。
- 保留原 `rowspan` 分组、子工序顺序、仿真按钮索引和视频映射；组头答对不播放短片。
- 桌面使用原生分组表，移动端使用组头保留下拉的手风琴；不能把上层下拉当装饰或与子题
  合并成一个答案。

### 5.4 原站工程按钮的边界

交接证据已确认 `btn_gycsfz` 调用 `Submission.php` 后返回的是已验证结果图片路径，而非
二级交互页面。离线迁移必须把已抓取图片接入 `paramSelect.simulations`，不能伪装成 Canvas
或 sandbox。工程 1/2/6 的 31 张结果图缺任一张就停止。

## 6. Canvas / 绘图仿真转换

绘图题必须使用 `platform-runtime-preview` 的站点自有控件、设计令牌和 sandbox 运行边界；
不能使用静态截图、固定演示曲线或原站 jQuery 兼容层。

**布局与滚动硬规则**：绘图 sandbox 的 `height` 只作首次渲染和失败兜底，不得把它当作固定高度
或用来制造 iframe 内滚动。iframe 与所在卡片必须按 sandbox 完整布局高度展开；`html`、`body`、
画布区、参数区和结果区不得设置会形成纵向或横向滚动的固定高度、`max-height` 或
`overflow:auto/scroll`。内容须在卡片宽度内响应式换行或缩放，并完整保留原题信息。首次加载、
所属 tab 激活、视口/容器宽度变化及动态内容变化后都必须重新测量并上报高度；隐藏 tab 不能沿用
隐藏状态下的错误测量值。

### 6.1 迁移步骤

1. 从源 HTML、脚本变量、有限请求/响应和已抓资源中列出题名、提示、输入项、选项、单位、
   阶段、公式、坐标轴、刻度、图例、初始值、输出和错误提示。
2. 对每个输入记录源 DOM/变量及证据哈希；将公式和绘图逻辑重写为独立离线模块，放入
   `assets/simulations/<id>/` 或卡片 `sandbox`，不访问父页面 DOM、Cookie、localStorage、
   PHP、网络或登录态。
3. sandbox 只允许网格、尺寸约束和响应式布局 CSS；颜色、字体、圆角、边框和状态色通过
   学习页注入的 `tokens.css` 令牌获得。不得在课程数据中写死原站蓝色或固定宽度。
4. 带参考答案的绘图题必须设置 `sandbox.modeSwitch:true`，由平台在 iframe 外渲染与
   `stepSimulation` / `paramSelect` 一致的「操作练习 / 参考答案」分段控件。iframe 内只保留
   原题输入、仿真和清空操作，通过 `pigeon-sandbox-mode` 消息切换；不得重复答案按钮或模式标签。
5. 若原站依赖服务端，必须捕获所有有限输入组合的请求、响应、资源和哈希；证据不完整时
   硬停，不猜公式、不补输出。
6. 用至少一组正确、一组错误和一组边界输入对照原站输出；至少两组不同参数必须产生不同
   Canvas 输出。记录截图、像素/结果摘要、控制台和资源请求报告。

### 6.2 氧化黄金样板的必保信息

实验 1“温度曲线参数设置及仿真”必须保留 5 个下拉及其选项/单位、两条干氧/湿氧曲线、
阶段顺序、坐标轴、刻度、图例、初始状态、提示和输出。源脚本的 `dw`、原点、五段点列、
色块/虚线/标准曲线公式必须逐项可追溯；不得只画一条固定示例线。UI 视觉采用
`http://localhost:5173/learn.html?course=platform-runtime-preview` 的自有样式，而非原站
Canvas 颜色或字体。操作练习初始五项必须为空且 Canvas 未绘制；外层「参考答案」才可填入
满分证据中的正确参数并绘制答案，返回练习或点击 iframe 内「清空」后恢复可编辑空白状态。

## 7. 选择题语义映射与硬停止

### 7.1 题面转换

每道作业题在 `quiz.json.questionBank` 只定义一次：

```jsonc
{
  "type": "single",
  "stem": "只含题干，不含选项正文",
  "options": ["A. 完整原文", "B. 完整原文"],
  "answer": "A"
}
```

解析器必须从题干中的 `<br>`、中文/英文分号和粘连字母中分离选项正文，再与原页面
`<select>` 的字母和数量逐项对齐。`options` 绝不能是空数组、单独字母或 `[object Object]`；
答案只能取对应满分审计证据；`candidate-answers.json` 只有在能回指该满分记录时才可作为
结构化索引，且答案必须存在于选项中。

三门题数门禁为制造 71、器件 85、封装 101，共 257 题（排除范围按
`included-activity-scope.json`）。建立版本化 `question-knowledge-map.json`，每条记录至少
含：题目 ID、原作业、源文件/DOM、目标知识点、题干关键词、答案关联、直接理论原文证据、
匹配理由。候选映射可由低成本模型提出，但模型不能绕过证据审核。

`question-knowledge-map.json` 是课程源目录中的版本化审计产物；运行时只消费由它生成的
`quiz.json` 引用关系。除非先更新通用格式契约，平台不得把该映射文件当成新的运行时字段。

### 7.2 归属和引用

- 每题恰好归属一个知识点；无直接理论证据、跨章、重复归属或漏题即硬停。
- 每题在一个知识点 `sectionQuiz` 中恰好一次，在所属章 `examQuestions` 中恰好一次。
- 小测和章节测试只引用题 ID，不复制题对象；题目顺序按知识点相关性组织，不按原作业
  顺序轮询。
- 本轮不生成选择题、实验题或工程题解析；以后若生成，答案来源必须 100% 是课程原文和
  正确答案，并独立复核。

## 8. 资源本地化与离线闭包

1. 通过 `resource-capture-*.json` 的映射把原 URL 解析为抓取文件；复制到
   `assets/images`、`assets/media` 或 `assets/simulations/<id>`，按源文件哈希去重。
2. 重写 `src`、`poster`、`captions`、`clip`、`srcset`、HTML/CSS `url()` 和 sandbox
   `dependencies`；保留扩展名和相对目录关系。视频、WebVTT、海报和短片不可只留 URL。
3. `manifest.assetBase` 仅指向同源本地分离资源；完整备份仍应包含全部媒体。不得把
   `http(s)://`、`//`、`/` 外部资源、PHP endpoint、登录 cookie 或动态网络请求写入包。
4. 用构建器扫描 `content.json`、`manifest.json` 和所有块引用，逐一确认文件存在、路径未
   越界、哈希可复现。构建器在临时目录生成与原图同像素尺寸的 lossless WebP，并在课程没有
   显式 poster 时从同一视频约 0.5 秒处生成最长边不超过 1280px 的压缩 WebP 首帧（避开常见空白起始帧）；增强只写入构建副本，
   不改课程源。全部派生文件必须与原资源一起进入 deployment/full 包的资源闭包、字节数和
   SHA-256 清单。首帧 p90 必须不超过 64 KiB，单张硬上限 100 KiB；浏览器中按源宽高比完整显示，
   不得裁切或拉伸。找不到图片不许用空路径、占位图或幽灵引用掩盖；应报告源 URL 和文件。
   源 `alt` 为空时保持为空并列入可访问性报告，不能凭图片内容猜写替代文本。
5. 资源请求失败、控制台 404/CORS/脚本错误或字幕/海报缺失均阻断交付，除非该资源经证据
   证明原站本来就不存在，并在报告中明确记录。

## 9. 构建、测试和浏览器 QA

以下命令均从仓库根目录运行；命令本身不修改原始抓取目录。

### 9.1 预检与源完整性

```powershell
node tools/autosmt-2026/scripts/audit-capture-integrity.mjs
```

应确认纳入范围的 49 个活动、80 个活动 tab、资源清单和满分证据完整。任何失败先修复
抓取/证据，不进入转换。

### 9.2 黄金样板

归档的 `build-course-content-legacy.mjs` 只能选择整门课，**没有安全的黄金样板开关**，
不得直接运行。样板转换必须
只写隔离输出，覆盖 `0-1` 氧化小节，然后运行：

```powershell
node tools/autosmt-2026/scripts/test-native-content-blocks.mjs
node tools/autosmt-2026/scripts/test-offline-content-renderer.mjs
node tools/autosmt-2026/scripts/test-pigeon-media-loader.mjs
node tools/autosmt-2026/scripts/test-step-simulation.mjs
node tools/autosmt-2026/scripts/test-fidelity-media.mjs
```

样板自动门禁还必须检查：三张理论主题卡、无理论 `html`、无重复蓝色标题、原生表格/图片
组、讲解视频 tab、作业完整选项和题目归属、实验 1 全 tab/参数/Canvas，以及桌面/手机无
横向溢出。

现有脚本返回退出码 0 仍不足以证明样板合格；在正式打包前，忠实度门禁必须覆盖新块递归、
题目完整选项、题目唯一归属和四个目标视口，浏览器 QA 必须遍历真实课程页的全部卡片，而
不仅是 `offline-runtime-qa.html` 或 `platform-runtime-preview` 示例页。

### 9.3 用户确认后的全量流水线

用户明确确认样板后，必须先实现满足本规范的新全量转换器；当前没有可运行的正式全量生成
入口。新转换器通过逐字段来源、资源闭包和题目归属门禁后，才可运行以下验证与交付步骤：

```powershell
node tools/autosmt-2026/scripts/verify-course-fidelity.mjs
node tools/autosmt-2026/scripts/audit-capture-integrity.mjs
node tools/autosmt-2026/scripts/test-course-delivery.mjs
node tools/autosmt-2026/scripts/test-native-content-blocks.mjs
node tools/autosmt-2026/scripts/test-offline-content-renderer.mjs
node tools/autosmt-2026/scripts/test-pigeon-media-loader.mjs
node tools/autosmt-2026/scripts/test-step-simulation.mjs
node tools/autosmt-2026/scripts/test-fidelity-media.mjs
```

逐门生成分离部署包（全部 `assets/` 资源放同源 sibling 目录，部署 `.pigeon` 仅保留 JSON/manifest，避免首次进入课程下载全部图片/媒体）。构建器同时生成清单内的无损 WebP 最终图和压缩视频首帧；需要 Pillow 和可用的 ffmpeg（已有 `imageio_ffmpeg` 时自动复用其二进制）：

```powershell
node tools/autosmt-2026/scripts/build-course-delivery.mjs 2026-ic-manufacturing --collection 2026-vocational-preliminary
node tools/autosmt-2026/scripts/build-course-delivery.mjs 2026-ic-devices --collection 2026-vocational-preliminary
node tools/autosmt-2026/scripts/build-course-delivery.mjs 2026-ic-packaging --collection 2026-vocational-preliminary
# 或一次重建三门：python tools/autosmt-2026/scripts/optimize-delivery-images.py
```

若只需普通小课程的单包打包，才使用 `node tools/build-pigeon.mjs <courseId>`；三门 AutoSMT
分离部署必须使用 `build-course-delivery.mjs`，因为它还检查资源闭包、外链、哈希、`assetBase`
和 1 GB 便携包上限。

### 9.4 浏览器 QA

启动本地站点后，在 `learn.html` 逐卡检查并运行：

```powershell
node tools/autosmt-2026/qa/verify-platform-runtime-preview.mjs
node tools/autosmt-2026/scripts/capture-runtime-qa.mjs
cd app
npm.cmd run build
```

视口至少为 1440、1024、390、360 px。每章至少人工抽查理论原生化、复杂合并表、视频、
实验和工程各一例；还要自动遍历所有卡的资源、tab、表格、下拉、Canvas 和溢出。浏览器报告
必须包含截图、控制台错误、资源请求、`scrollWidth` 检查和至少两组不同 Canvas 输出。
每个 sandbox 还必须在首次加载、所属 tab 激活后及每次目标视口调整后等待布局稳定，再断言：
iframe 与所在卡片高度覆盖内部完整内容，内部 `scrollWidth <= clientWidth + 1`、
`scrollHeight <= clientHeight + 2`、`html/body.scrollTop === 0`；鼠标位于 iframe 上方滚轮操作时
应滚动外层 `.main`，不得滚动或卡住 iframe 内部。

最后将现有 `dist-courses/ic-packaging.pigeon` 加入回归：目录、表格、题目、主题切换、折叠、
视频和 sandbox 行为不得退化。

## 10. 硬停止清单和故障处理

出现任一项，立即停止当前转换并报告课程、章/节、知识点/活动、源文件、DOM 路径、原始片段
和建议人工动作：

- 文字、标题、列表、表格单元格、图片说明、题干、选项、参数或单位无法回溯源；
- 理论卡出现未知结构、未原生化块或 `html` 回退；
- 原站 class/style/蓝色标题、固定宽度、外链、PHP、登录态或网络依赖残留；
- 表格、图片、tab、下拉、Canvas 在任一视口横向溢出、被截断或不可读；
- 题目选项为空/只有字母、答案无满分证据、不在选项中、映射重复或漏题；
- 原站 tab、双层下拉、合并关系、图片、视频、字幕或仿真结果缺失；
- Canvas 不随参数变化、输出为空、公式/坐标轴与源逻辑不一致；
- 服务端仿真有限输入输出证据不完整；
- `ic-packaging.pigeon` 回归出现视觉或行为退化；
- `git diff --check`、构建、忠实度、资源闭包或浏览器 QA 失败。

故障处理只能回到源证据或转换器逻辑修复，不能手工在抓取目录补数据、把失败项改成纯文本、
写“待补”占位，或放宽门禁后继续打包。

## 11. 黄金样板交付单

用户人工确认前，交付包只允许包含以下证据，不得宣称三门课程已完成：

- 本地可访问的 `0-1` 氧化页面；
- 原站菜单与新目录/卡片结构对照；
- `介质薄膜`、`二氧化硅膜`、`氧化工艺` 三个理论主题卡，以及 overview、原生标题/正文/
  列表/图片/图片组/表格；
- 讲解视频 tab 和本地媒体；
- 作业 2 的完整题干/选项、题目映射、知识点小测；
- 实验 1 的 `热氧化原理`、`温度曲线参数设置及仿真`、`生产操作质量检验`、`热分解淀积`
  四个 tab，及其参数表、输入校验和 Canvas 温度曲线；
- 1440/1024/390/360 px 截图及无横向滚动证据；
- 至少两组不同参数的 Canvas 输出对照；
- 资源请求、控制台和构建/测试日志；
- 明确的“请用户人工确认样板”状态。

只有用户明确表示样板通过，才把同一转换器应用到三门课程；全量交付还必须附题目计数、
资源哈希、每章抽查记录、部署包路径和回归结果。

## 12. 本轮不做与后续兼容

本轮不生成选择题/实验题/工程题解析、AI 知识梳理、AI 对比记忆、术语速查，也不把实验/工程
题加入章节测试的可选开关。原站已有的总结、对比和术语仍按原文逐字转换，不新增推导。
后续增强必须从本规范生成的正确答案和课程原文出发，不得改变题面、答案、卡片组织或离线边界。
