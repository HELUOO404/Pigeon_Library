# app/src/core/ — 与内容无关的引擎

不依赖任何具体课程,首页与学习页共用。

| 文件 | 职责 |
|---|---|
| `pigeon-loader.js` | 解压 `.pigeon`(fflate)、校验 manifest/content、JSONC 注释剥离、题库引用归一(`normalizeQuiz`)、图片转 Blob URL、封面转 base64;暴露 `resolveAsset`。 |
| `course-registry.js` | 内置课程清单 `BUILTIN_COURSES`(含首页轻量卡片元数据,避免列表页解压完整课程包)+ 本地课程包的 IndexedDB 存取(`getLocalCourse` 供学习页离线读取)。 |
| `course-source.js` | 课程数据源:服务端「广场 / 私人课程 + 社交(评分·评论·下载量)+ 书架 + 审核」API 封装 + 归一化;含分类枚举 `COURSE_CATEGORIES`。**本地优先**:连不上后端/未登录时静默退化,不抛错。 |
| `course-modal.js` | 课程详情弹层(`openCourseDetail`):简介/统计/评分/下载量/评论区/加入书架/开始学习;广场与个人主页共用。 |
| `session.js` | 登录态 + 后端 fetch 封装(`api` / `apiUpload` 多部件上传 / `apiBytes` 二进制下载);导出 `API_BASE`。 |
| `auth-ui.js` | 顶栏账户菜单 + 登录/注册/改密弹窗;`promptLogin()` 供「需登录」场景(如未登录上传)主动唤起登录框。 |
| `store.js` | 按「用户 × 课程」分命名空间的 localStorage 封装(`pglib:u:<uid>:<courseId>:<slot>`),slot:`progress/quiz/wrong/studyTime/exams`(含章节考试成绩档)。 |
| `learning-stats.js` | 个人中心学习概览:遍历当前用户命名空间聚合各课 `quiz/progress/wrong/studyTime/exams`,导出 `collectLearningStats({uid,titles})→{totals,perCourse,exams}`。**纯本地**,不外泄个体数据。 |
| `sparkline.js` | 迷你图 SVG 生成:`sparkline`(折线/面积)/ `sparkbars`(柱状),用于仪表盘与个人中心考试战绩。 |
| `theme.js` | 亮/暗主题(站点级)应用与切换。 |
| `icons.js` | UI 图标库(Lucide 子集):`icon(name,opts)` 返回内联 SVG;`hydrateIcons(root)` 填充 `[data-icon]` 占位。**平台禁 emoji,一律用此**。 |

约定见 [`../../../docs/code-style.md`](../../../docs/code-style.md);格式契约见 [`../../../docs/pigeon-format.md`](../../../docs/pigeon-format.md)。
