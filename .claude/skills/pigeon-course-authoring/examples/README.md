# examples — 可运行示例

最小完整课程示例,既可照着学结构,也能直接打开看效果。

| 内容 | 说明 |
|---|---|
| `demo-course/` | 课程包**源**(解包形态):`manifest/content/quiz/glossary.json` + `assets/images/demo.png`。覆盖了大多数块类型与四种题型,是新课程的起手模板。 |
| `demo-course.pigeon` | 上面的源已打包好的成品。可直接在 PigeonLib 首页拖拽上传,立即看到渲染效果。 |

## 用法

- **照着做新课程**:把 `demo-course/` 复制成 `courses/<你的课程id>/`,改 `manifest.id` 与内容,再 `node tools/build-pigeon.mjs <你的课程id>`。
- **重新打包这个示例**:仓库根运行 `node tools/build-pigeon.mjs demo-course`(注意:它会从仓库的 `courses/demo-course/` 取源,而非本目录的副本——本目录副本仅供 Skill 自包含参考)。
- **只想看效果**:首页上传 `demo-course.pigeon`。

> 字段含义见 [../reference/format-cheatsheet.md](../reference/format-cheatsheet.md)。
