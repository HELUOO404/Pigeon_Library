# Agent / Codex 执行规范

> 面向在本仓库工作的 AI/agent(Claude、codex 等)。返回索引:[`../CLAUDE.md`](../CLAUDE.md)。

## 一、分工

- **Claude(主导)**:设计、架构、正确性关键逻辑(loader / 渲染器 / 题库 / 设计系统),以及对其他 agent 产出的复核。
- **codex(辅助)**:机械、规格明确的批量活 —— 如给多文件批量加注释、数据迁移、重复性替换。**必须在 Claude 复核下进行**。

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
