# 2026 离线课程交接

最后更新：2026-07-18

> 当前质量重建的唯一转换规范、硬停止条件和分阶段验收流程见
> [`CONVERSION.md`](./CONVERSION.md)。本文只记录既有抓取与旧流水线状态；若与转换规范冲突，
> 以 `CONVERSION.md` 为准，不得按本文的旧产物状态直接批量重建。

## 当前质量重建状态

旧流水线曾生成三门分离部署包并通过当时的忠实度门禁与浏览器冒烟，但这些产物**不代表本轮质量重建已验收**。当前只允许继续完善 `0-1`“氧化”黄金样板及平台系统适配；黄金样板未通过用户明确人工认可前，不得批量重建或发布三门正式课程。下文关于旧包、抓取和仿真证据的记录仅用于复用已验证来源。

## 关键修正：工程仿真按钮的真实行为

早前记录有误——工程「工艺参数仿真」按钮（`btn_gycsfz`）点击后并非返回二级 sandbox 页面，而是 `Submission.php` 返回**已验证的结果图片路径**（`../img/...jpg`，单张），由 `$("#csfz").attr("src", data)` 填入弹窗 `<img>`，与实验的 `btn_djhdfz` 同类。图片已抓取完毕（工程 1=20 步/工程 2=9 步/工程 6=2 步，共 31 张，[reports/engineering-simulation-capture-v1.json](./reports/engineering-simulation-capture-v1.json)）。

按钮 `index`（页面第几个 `.ax-btn`，0 起）与按钮所在单元格的 `rowspan` 挂靠层级**在不同活动里不统一**：工程 1 挂在「工艺」细分组，工程 2/6 挂在更粗的「结构」组。因此契约把仿真与 `groups` 解耦，改用**参数序号区间**描述（`docs/pigeon-format.md` §2.6）：

```jsonc
"simulations": [
  { "label": "埋层-氧化工艺参数仿真", "paramRange": [1, 8], "images": ["assets/images/eng-1-0-0-0.jpg"] }
]
```

旧流水线（`archive/build-course-content-legacy.mjs` 的 `parseSelectTable`）曾按原始表格行区间定位每个按钮覆盖的全局参数序号，再从 `engineering-simulation-capture-v1.json` 按 `engineering:<号>:<subIndex>:<index>` 取图片。该脚本只供审计，不得运行。渲染器（`app/src/render/param-select.js`）：`paramRange` 内下拉**全部填写**（与对错无关）即出现按钮，点击展开 `images`（原样 `<img>`，不做判分渲染）。

## 旧转化流水线（已归档，不可运行）

早期全量生成器已移至 `archive/build-course-content-legacy.mjs`。它不满足 `CONVERSION.md` 的
原生理论卡、题目归属和硬停止要求，当前没有可运行的正式全量生成入口。黄金样板验收后应
另行实现新转换器，再接入忠实度与交付门禁。

- 数据源：`reports/source-capture/`（28 小节原始页 + 理论 61 页 + 静态/视频资源）、`reports/activity-details/`（49 活动 80 tab）、满分审计 `ui-state-*`（score=100 才被采信）、`candidate-answers.json`（作业）、`process-step-video-capture-v1.json`（452 步骤短片）、`engineering-simulation-capture-v1.json`（31 张工程仿真结果图）。
- 转化映射：概述→`paragraph/image`；理论→`heading + html`（整段逐字嵌入，图片重映射）；讲课→`video`；作业→quiz `single`（答案取 candidate-answers）；标准 select 表→**`paramSelect`**（契约 §2.6，merged 列驱动解析还原任意层合并单元格，仿真按钮按参数区间接入）；gnq 两级流程→**`stepSimulation groups`**；平表流程（实验42-47）→`stepSimulation` 扁平；非标 tab（阶段面板/矩阵/版图等 17 个）→`html` 块逐字保留（文字忠实，交互待迭代）。
- 一切不确定即断言硬停：答案不在选项、行数不匹配、资源未抓取，绝不猜。

## 交付产物

| 课程 | 章 | 知识点 | 题 | 交互块 |
| --- | --- | --- | --- | --- |
| 2026职业赛道初赛IC制造 | 1 | 46 | 71 | paramSelect×18 |
| 2026职业赛道初赛IC器件 | 2–3 | 42 | 85 | paramSelect×2（含工程1/2 仿真图 20+9 张） + stepSimulation×10 |
| 2026职业赛道初赛IC封装 | 4–6 | 45 | 101 | paramSelect×9（含工程6 仿真图 2 张） + stepSimulation×6 |

- 分离部署包在 `dist-courses/2026-vocational-preliminary/<id>/`（全部 `assets/` 走 `assetBase` 外置，web `.pigeon` 仅保留 JSON/manifest；图片/视频按需加载）；`.full.pigeon` 备份因超加载器 1GB 上限跳过（delivery-manifest 有记录）。
- 三门课已登记为内置课程（`app/src/core/course-registry.js`），dev/构建产物直接可学；浏览器冒烟通过（标题/章节/知识卡/交互块渲染，无加载失败）；工程仿真按钮回归验证通过（填满即出现 + 点开显示真实结果图，见截图核验记录）。

## 已知缺口（正式收尾前必须处理）

1. **17 个非标 tab 目前是 html 块**（阶段面板/参数矩阵/版图设计/测试曲线）：文字逐字忠实，但只读不可交互；如需交互需逐类设计（可扩展 paramSelect 或新块型）。
2. **解析（explain）未生成**：paramSelect/stepSimulation/quiz 均支持可选解析字段，后续增强内容可直接补（不影响题面忠实度）。
3. 步骤短片走 `assetBase` 分离加载，`stepSimulation` 的“答对播放/尾帧保持/连续回放”已在预览课验证；三门课的逐一人工抽查还没做（建议每课抽 2 个活动核对答案与视频映射）。
4. 工程 5、7、8 不在满分验证范围内（`included-activity-scope.json` 排除项），其参数表已按纯 paramSelect（无仿真）转化。

## 成绩门禁

最终证据：[reports/final-score-before-capture.json](./reports/final-score-before-capture.json)。所有纳入范围的作业、实验和工程均为 `100.00`。

- 作业：1–9、11–29 为 100.00。
- 实验：1–19、22–47 为 100.00。
- 工程：1、2、5、6 为 100.00。
- 排除项：作业 10；实验 20–21；工程 3–4、7–8。正式标题不含“课程包”。

不要重新做题或把去年的答案当作最终答案。

## 已抓取内容

- 28/28 小节原始页、61/61 理论页（GB18030 原始字节）、49 活动 80 tab、290 静态资源、83 固定视频、452 流程步骤短片、31 张工程仿真结果图 —— 均有哈希审计。
- 原始 HTML 只读，不可修改。

## 守护与安全

不保存账号、密码、Cookie 或可复用令牌。守护程序只在运行中的 PowerShell 进程内保存登录态；重启守护后需要在本机重新输入凭据。启动守护用 `launch/启动AutoSMT会话守护.bat`；所有联网抓取都经守护队列执行。

## 平台能力（已在预览课 + 三门正式课验证）

- `paramSelect`（契约 §2.6）：参数选择答题表，merged 列合并单元格，仿真按钮按 `paramRange` 填满即出现（与对错无关），点开展示原站已验证结果图（非交互）；统一提交百分制计分，逐项对错反馈。
- `stepSimulation`（契约 §2.5）：flat/groups 两形态，答对播放短片保尾帧，「参考答案」直接连播，全屏覆盖层练习，移动端无视频面板。
- sandbox（契约 §2.3）：设计令牌注入 + 主题跟随 + `pigeon-score` 自判分回传（仅用于预览课的手工交互示例，工程仿真本身不用它）。
- 核心实现：`app/src/render/param-select.js`、`step-simulation.js`、`content-renderer.js`、`app/src/main-learn.js`。

## 验证命令

```powershell
node tools/autosmt-2026/scripts/verify-course-fidelity.mjs
node tools/autosmt-2026/scripts/audit-capture-integrity.mjs
node tools/autosmt-2026/scripts/test-step-simulation.mjs
node tools/autosmt-2026/scripts/test-pigeon-media-loader.mjs
node tools/autosmt-2026/scripts/test-offline-content-renderer.mjs
node tools/autosmt-2026/scripts/test-fidelity-media.mjs
node tools/autosmt-2026/scripts/test-course-delivery.mjs
node tools/autosmt-2026/qa/verify-platform-runtime-preview.mjs
cd app
npm.cmd run build
```
