# app/src/render/ — 内容渲染器

把已加载课程的数据渲染成 DOM。依赖 `core/`(数据)与 `styles/`(外观)。

| 文件 | 职责 |
|---|---|
| `content-renderer.js` | 知识点正文:类型化块(段落/表格/小结/对比/小测/图片/`html`/`sandbox`)→ HTML;状态徽章;**`html` 块相对资源路径在此解析为 Blob URL**;**`sandbox` 块装进隔离 iframe(`sandbox="allow-scripts"`,允许 JS、与主站隔离),高度由 `main-learn.js` 的 message 监听按内容自适应**。 |
| `sidebar-renderer.js` | 目录树、章节 tab、侧栏/页脚学习进度。 |
| `quiz.js` | 小节小测:渲染判分、结果恢复、错题记录(按题库 id 去重)。 |
| `exam-engine.js` | 章节考试引擎:单选/判断/排序/匹配的渲染、作答、计时、判分、错题汇总。 |
| `glossary.js` | 术语表渲染 + 正文术语提示(TreeWalker 注入 `.term-tip`)。 |
| `wrongbook.js` | 错题本:增删、按章筛选、渲染、重做。 |
| `panels.js` | 浮层面板:学习仪表盘 / 错题本 / 术语速查。 |
| `utils.js` | 公用工具:`escapeHtml`、Span 渲染、章节展开、计数、时长格式化。 |

注意:**class 名与 DOM 结构是契约**(JS/CSS 都依赖),重命名需同步。动态 HTML 必须 `escapeHtml` 外部数据;图标用 `core/icons.js` 的 `icon()`。
