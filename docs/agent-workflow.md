# Agent / Codex 执行规范

> 面向在本仓库工作的 AI/agent(Claude、codex 等)。返回索引:[`../CLAUDE.md`](../CLAUDE.md)。

## 一、分工(codex 为编程子代理,默认承担实现)

- **Claude(设计 + 复核,主导)**:需求澄清、方案/架构设计、正确性关键决策、计划编排,以及**对 codex 产出的复核与 QA**。
- **codex(实现,默认执行者)**:**规格明确的编码实现默认交 codex 执行** —— 组件/样式/脚本编写、数据迁移、批量改写或加注释、文件编码处理等。Claude 先给出清晰规格(目标文件、约束、验收点),codex 执行,Claude **review diff** 后采纳。
- 例外(Claude 直接做):规格尚不明确、需边探索边定的;跨多文件的设计权衡;治理/规范类文档(如本文件)等以精确措辞为先的产出。

### 调用方式

- 非交互式,在仓库根运行:`codex exec --cd <仓库根> -s workspace-write "<自包含规格>"`;规格较长时用 `codex exec ... < spec.txt` 经 stdin 传入,避免 shell/中文转义问题。(`exec` 子命令默认即非交互、无审批,不要加 `-a`。)
- 规格须**自包含**:codex 不知道本次对话上下文 —— 写明目标文件、不可触碰项、具体做法、验收点。
- Claude 闭环:写规格 → 跑 codex → **review 改动 diff**(`git status` / `git diff`)→ 按 QA 清单验证 → 不达标补规格重跑。
- 确定性的字节级操作(如按指定编码落盘)在规格里直接给出确切命令(如 PowerShell `[IO.File]::WriteAllText($p, $t, [Text.Encoding]::GetEncoding(936))`),让 codex 照做。

## 二、codex 执行边界与避坑

- **不得触碰**:`参考项目/`(只读)、`app/src/styles/tokens.css` 设计令牌、`app/src/render/*` 渲染器逻辑 —— 除非有明确规格且经复核。
- **必须**:产出后交 Claude QA(语法检查 + Preview MCP 实测);保持编辑完整(不漏改关联点)。
- **已知坑(历史教训)**:
  - 勿注入 UTF-8 BOM(改完用工具确认无 BOM)。
  - 多点关联改动勿只改一处(如改了字段名要全链路跟到底)。
  - 大段重写易丢功能,优先小步可验证的编辑。

## 三、构建 / 运行 / 预览

- 见 [`../CLAUDE.md`](../CLAUDE.md) 第三节。要点:**先 `node tools/build-pigeon.mjs <id>` 打包课程,再 `cd app && npm run build`**,否则产物无内置课程(运行时 404)。
- 预览:`preview_start("pigeonlib")`(配置见 `.claude/launch.json`)→ Preview MCP 截图 / `preview_inspect` / `preview_eval` 自查。

## 四、QA 清单(改动后自查)

1. 无控制台报错(`preview_console_logs`)。
2. 涉及 UI:亮/暗双主题、移动端、`prefers-reduced-motion` 均正常。
3. 涉及"禁用元素":`grep` 确认无新 emoji、无装饰性 `border-left/right`。
4. 涉及课程数据:重新 `build-pigeon` 打包并在学习页实测渲染。
5. 功能未回归:答题判分、错题去重、考试题型、术语提示。
6. 生产构建通过:`cd app && npm run build`。

## 五、提交规范

- **仅在用户要求时**提交;默认分支上先确认是否需要新分支(用户可能自行管理工作树)。
- 每个逻辑批次(一轮需求)独立成 commit;信息首行一句话概括,正文分点列改动。
- 提交信息结尾署名:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- 不提交用户的备份/临时文件(如 `dist-courses/*副本*.zip`)。

## 六、文档维护规则(支撑"动态更新")

**结构或功能变更时,同步更新文档**,使其始终反映现状:

- 新增/删除目录或关键文件 → 更新该目录 `README.md`、根 `README.md` 的目录树、`CLAUDE.md` 的导览与索引。
- 改 `.pigeon` 字段/能力 → 先改 `pigeon-format.md`(权威),再改代码与 `ai-course-authoring-prompt.md`。
- 改设计令牌/组件/图标/禁用规则 → 更新 `design-system.md`。
- 新增规范文件 → 必须登记进 `CLAUDE.md` 的**规范索引**表。
- 一句话原则:**代码与文档一起改,索引保持可达**。
