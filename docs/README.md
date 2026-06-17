# docs/ — 文档与规范

文档分区索引。项目总纲与完整规范索引在 [`../CLAUDE.md`](../CLAUDE.md)。

| 文件 | 职责 |
|---|---|
| [`pigeon-format.md`](./pigeon-format.md) | `.pigeon` 课程包格式**契约(唯一权威)**:文件结构、块类型、题库引用模型、校验规则。 |
| [`user-system-design.md`](./user-system-design.md) | 用户系统/同步**契约(权威)**:渐进增强同步层架构、SQLite 数据模型、API 端点、同步流程、角色权限矩阵、安全模型。 |
| [`deployment-guide.md`](./deployment-guide.md) | 部署指南:本地开发、生产静态托管、可选 Node 后端、Windows Server(IIS 反代 + NSSM)、CORS/cookie 对接、排错。 |
| [`design-system.md`](./design-system.md) | 设计系统:令牌 / 字体字阶 / 组件 / 图标体系 / **禁用元素(emoji、竖线)** / 无障碍 / 设计资源。 |
| [`code-style.md`](./code-style.md) | 代码风格与**中文注释规范**(含 JSONC 课程注释约定)。 |
| [`agent-workflow.md`](./agent-workflow.md) | **agent/codex 执行规范**、构建/QA/提交、文档维护规则。 |
| [`ai-course-authoring-prompt.md`](./ai-course-authoring-prompt.md) | 给 AI 的课程制作提示词(首页可一键复制)。 |
| [`首页布局参考.md`](./首页布局参考.md) | 首页布局参考(历史记录)。 |

维护:新增规范文件须同时登记进本表与 `CLAUDE.md` 的规范索引(见 agent-workflow 的"文档维护规则")。
