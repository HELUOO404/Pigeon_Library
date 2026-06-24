# renderer-src — 渲染器只读快照

这里是学习页正文渲染器的**只读快照**,供本 Skill 的 agent 在写块时**自查渲染效果**(某个 block 会被渲成什么 HTML、走哪些 class、哪些字段被 `escapeHtml`):

| 文件 | 作用 |
|---|---|
| `content-renderer.js` | 块分派:`paragraph/numTitle/boldCaption/heading/image/paramsTable/summaryBox/compareBox/sectionQuiz/html/sandbox` → HTML |
| `utils.js` | `escapeHtml` / `renderSpans`(Span→内联)/ `textFromSpans` 等公用工具 |
| `quiz.js` | 小测交互(选项判分、错题记录) |

> ⚠ **权威以仓库为准**。这是某次拷贝的快照,可能与 `app/src/render/` 的最新实现漂移。判断渲染行为时,优先看仓库的 [`app/src/render/`](../../../../../app/src/render/) 与契约 [`docs/pigeon-format.md`](../../../../../docs/pigeon-format.md);本快照仅为「手边可读」的便利副本。

**怎么用**:写正文块拿不准时,在 `content-renderer.js` 里搜对应 `case`,看它如何取字段、套哪层 class —— 据此决定块类型与字段,而不是凭空猜测。
