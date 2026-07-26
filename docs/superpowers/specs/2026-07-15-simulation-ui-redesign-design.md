# 仿真 UI 重设计(stepSimulation + 工程 sandbox)设计文档

日期:2026-07-15
分支:feat/course-square-private-courses
背景:`tools/autosmt-2026/HANDOFF.md`。platform-runtime-preview 预览课暴露出两类问题:
stepSimulation 排版松垮、不成体系;工程 sandbox 是原站 Excel 风写死色值,与邮政编辑风
完全脱节。正式三门课中流程仿真页多达 16 页、最长 87 步(实验 29),当前布局无法承载。

## 目标

1. stepSimulation 在几步~87 步的量级下都紧凑、可用、符合邮政编辑风。
2. schema 忠实承载原站两级答题结构(功能区组头也是下拉答题项)。
3. sandbox iframe 获得站点设计令牌,自动跟随亮/暗主题;正式课的真仿真页直接继承。
4. 工程"工艺参数仿真"按钮移出表格,成为独立按钮。

## 非目标

- 不改 quiz/exam/glossary 等其他渲染器。
- 不做原生 Fullscreen API(用户明确不要;可自行 F11)。
- 不动 `参考项目/`;不改已抓取的原始 HTML(只读)。

## 数据事实(来自抓取报告)

- 流程仿真 16 页,步数 min 10 / median 19 / max 87(实验 29:87 步,含 10 个功能区组头题
  + 77 个工序步骤题,`json_gnqsy` 给出组边界)。
- 原站结构:表格行 = `序号 | 功能区(rowspan 下拉) | 工序(下拉) | 播放按钮`。
  功能区本身是答题项,选错扣分 —— 忠实度要求两级都可答。

---

## 设计

### ① stepSimulation 紧凑化(app/src/styles/learn.css + step-simulation.js)

- 删除 `.card-body .step-simulation-prompt` 的 `line-height:.5` hack。
- 步骤行改单行网格:`[mono 序号] [题干] [下拉框]` 横向三列,行高约 40px,
  行间 hairline 分隔(不是每行一个独立卡盒)。题干过长时下拉框换行到第二行(grid 自适应)。
- 块头部加 eyebrow:mono 小字「仿真练习 SIMULATION」+ 横向 hairline,标题保持 `--serif`。
- 模式切换(操作练习/答案回放)、提交按钮样式保持既有令牌风格不变。

### ② schema 扩展:groups(docs/pigeon-format.md §2.5 → step-simulation.js)

```jsonc
{
  "type": "stepSimulation",
  "id": "exp-29-flow",
  "title": "CMOS反相器工艺流程设计",
  "groups": [
    {
      "prompt": "功能区",            // 可省,默认无题干
      "options": ["栅氧化区", "光刻区", ...],
      "answerIndex": 2,              // 组头本身是答题项,1 起
      "steps": [                     // 组内工序,结构同现有 StepSimulationStep
        { "prompt": "...", "options": [...], "answerIndex": 1, "clip": "assets/media/....mp4" }
      ]
    }
  ]
}
```

- `groups` 与扁平 `steps` 互斥,二选一;旧扁平写法继续支持(等价于单组无组头)。
- 计分 = 组头题数 + 全部步骤题数;进度分母同口径。
- 组头选对不播视频(原站组头无短片),仅解锁视觉确认(金框);组内步骤行为不变
  (选对播放对应 clip,尾帧保持)。
- 步骤 clip 的"答对才创建 video 元素"门控、答案回放连续播放语义均不变。
- `schemaVersion` 仍为 1;旧渲染器遇到 `groups` 字段按现有未知字段容忍逻辑处理。

### ③ 长列表布局:限高预览 + 覆盖层全屏 + 移动端无视频

**非全屏(知识卡片内):**
- 步骤列与视频面板等高(约 420px),步骤列内部滚动(唯一允许的嵌套滚动,因为全屏才是主战场)。
- 底部一排:`进度 n/N · [⛶ 全屏练习] [提交]`(答案模式为 [连续播放])。
- 组渲染为手风琴:组头行(含组头下拉题)+ 展开的组内步骤;默认展开第一个未完成组。

**全屏(覆盖层,非原生 API):**
- `position:fixed; inset:0` 铺满视口,`z-index` 高于侧栏;背景 `--paper`,吃主题令牌,
  亮暗自动跟随。Esc 或右上「退出全屏」按钮关闭(自实现,焦点困在覆盖层内)。
- 布局:左 ~60% 步骤列表(可滚,组手风琴),右 ~40% 视频 sticky + 进度 + 提交。
- 打开/关闭只是把同一块 DOM 移入/移出覆盖层容器(状态本就持久化在 store,无需重建)。

**移动端(≤768px):**
- 不渲染视频面板;答对某步只给行级视觉确认(金框 + 对勾)。
- 全屏覆盖层里也只有步骤列表;答案回放模式仅列出正确答案文本,不放视频。

### ④ sandbox 令牌注入(docs/pigeon-format.md §2.3 → app/src/core/pigeon-loader.js)

- loader 组装 srcdoc 时,读取当前生效主题下的一组白名单令牌
  (`--paper/--surface/--card/--ink/--text/--text-soft/--line/--line-2/--gold/--gold-deep/--stamp/--hover`
  + `--serif/--sans/--mono`),以 `<style>:root{...}</style>` 前置注入 iframe。
- 主题切换时向所有 sandbox iframe `postMessage({type:'pigeon-theme', tokens:{...}})`,
  iframe 内由注入的小段引导脚本接收并更新 `:root`(sandbox 无 same-origin,只能 postMessage)。
- 契约文档新增:sandbox 内可用变量清单;课程包 CSS 建议 `var(--ink, #24211d)` 带兜底,
  保证包在旧版/裸环境仍可读。
- 预览课 `courses/platform-runtime-preview/assets/simulations/engineering-plot/styles.css`
  改为令牌写法,作为正式课仿真页的示范。

### ⑤ 工程仿真按钮移出表格(预览课 sandbox html + styles.css)

- 表格删除第六列("工艺参数仿真" rowspan 单元格),只剩五列:序号/结构/工艺/参数名称/选择。
- 按钮独立放在表格下方右侧:墨底纸字主按钮样式(令牌),旁注 mono 小字「选择参数后生成曲线」。
- 曲线面板仍在按钮下方,canvas 绘制逻辑不变(轴色/曲线色改用令牌对应值)。
- 注意:此为预览课演示;正式工程 1/2/6 忠实版以补抓的二级仿真页为准(HANDOFF 待办),
  但按钮外置 + 令牌化的样式规范先在此确立。

## 错误处理 / 边界

- `groups` 与 `steps` 同时出现:取 `groups`,`console.warn`。
- 覆盖层打开时锁 body 滚动;关闭恢复;组件卸载(切换知识点)时强制关闭覆盖层。
- iframe 未加载完成时的主题 postMessage 丢失:引导脚本加载后主动请求一次
  (`postMessage` 握手),loader 应答当前令牌。
- 移动端判定用 CSS 断点为主(`display:none`),JS 仅用于跳过创建 video 元素,避免多余下载。

## 验证

1. `node tools/autosmt-2026/scripts/test-step-simulation.mjs` 通过(必要时同步扩展该测试覆盖 groups)。
2. `node tools/autosmt-2026/qa/verify-platform-runtime-preview.mjs` 通过。
3. 手工/Playwright:87 步模拟数据(可临时改预览课)在非全屏、全屏、移动端三形态截图检查;
   亮/暗主题下 sandbox 配色跟随;答案回放连续播放不回归。
4. `cd app && npm run build` 通过;重打包 `platform-runtime-preview.pigeon` 后离线加载正常。

## 涉及文件

- `docs/pigeon-format.md`(契约先行:§2.3 令牌注入、§2.5 groups)
- `app/src/render/step-simulation.js`(groups/紧凑行/覆盖层/移动端)
- `app/src/styles/learn.css`(step-simulation 全部样式重排 + 覆盖层)
- `app/src/core/pigeon-loader.js`(令牌注入 + 主题 postMessage)
- `courses/platform-runtime-preview/content.json`(sandbox html 改五列 + 按钮外置)
- `courses/platform-runtime-preview/assets/simulations/engineering-plot/{styles.css,runtime.js}`(令牌化)
- `tools/autosmt-2026/scripts/test-step-simulation.mjs`(补 groups 用例)
