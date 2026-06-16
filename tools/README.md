# tools/ — 构建与维护脚本(Node,从仓库根运行)

| 脚本 | 用途 |
|---|---|
| `build-pigeon.mjs` | 把 `courses/<id>/` 打包成 `dist-courses/<id>.pigeon`(zip)。`node tools/build-pigeon.mjs <id>`。要求至少有 manifest.json + content.json。 |
| `extract-ic-course.mjs` | 从 `参考项目/index.html` 抽取 IC 课为结构化课程包。含图/合并单元格的复杂表格会保存为 `html` 块(图片 src 收集进资源)。**`参考项目/` 只读;勿随意重跑覆盖手工调整过的 content.json**。 |
| `migrate-quiz.mjs` | 把旧版内联 quiz.json 迁移成 `questionBank + 引用` 模型(题 id = 章号-三位流水),跨池去重。`node tools/migrate-quiz.mjs <id>`。 |

构建顺序见 [`../CLAUDE.md`](../CLAUDE.md)(先打包课程,再 `npm run build`)。
