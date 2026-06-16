# app/src/core/ — 与内容无关的引擎

不依赖任何具体课程,首页与学习页共用。

| 文件 | 职责 |
|---|---|
| `pigeon-loader.js` | 解压 `.pigeon`(fflate)、校验 manifest/content、JSONC 注释剥离、题库引用归一(`normalizeQuiz`)、图片转 Blob URL、封面转 base64;暴露 `resolveAsset`。 |
| `course-registry.js` | 内置课程清单 `BUILTIN_COURSES` + 本地上传课程的 IndexedDB 存取(增删查)。 |
| `store.js` | 按课程 id 分命名空间的 localStorage 封装(`pglib:<courseId>:<slot>`),隔离各课进度/答题/错题。 |
| `theme.js` | 亮/暗主题(站点级)应用与切换。 |
| `icons.js` | UI 图标库(Lucide 子集):`icon(name,opts)` 返回内联 SVG;`hydrateIcons(root)` 填充 `[data-icon]` 占位。**平台禁 emoji,一律用此**。 |

约定见 [`../../../docs/code-style.md`](../../../docs/code-style.md);格式契约见 [`../../../docs/pigeon-format.md`](../../../docs/pigeon-format.md)。
