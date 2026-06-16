# PigeonLib · 信鸽课程库

可加载 `.pigeon` 课程包的学习平台。内容与网站**完全解耦**:网站本身不含任何课程,课程打包成独立的 `.pigeon` 文件(本质是 zip),由网站加载后渲染。换一门课无需改一行网站代码。

- **首页**(`index.html`):浏览内置课程、上传 `.pigeon`、查看课程包格式说明。
- **学习页**(`learn.html?course=<id>`):单页学习界面 —— 目录树、知识卡片、小节小测、章节考试(单选/判断/排序/匹配)、错题本、术语速查、亮/暗主题。1:1 复刻自原硬编码网站。

## 目录结构

```
参考项目/            原始硬编码网站(只读基线,勿改)
app/                 网站源码(Vite)
  index.html         首页入口
  learn.html         学习页入口
  src/
    core/            与内容无关的引擎:store(课程命名空间) / pigeon-loader(解压+Blob) / course-registry(IndexedDB) / theme
    render/          内容渲染器:content/sidebar/quiz/exam-engine/glossary/wrongbook/panels
    styles/          tokens.css(共享令牌) / learn.css(学习页) / home.css(首页)
    main-home.js     首页脚本
    main-learn.js    学习页脚本
  public/            站点静态资源(logo)
courses/<id>/        课程包源(解包形态:manifest/content/quiz/glossary.json + assets/images)
tools/               extract-ic-course.mjs(从原站抽取) + build-pigeon.mjs(打包)
dist-courses/        打包产物 *.pigeon
docs/                pigeon-format.md(格式规范) / ai-course-authoring-prompt.md(给AI的制作提示词) / 首页布局参考.md
```

## 开发 / 构建 / 部署

```bash
cd app
npm install
npm run dev        # 本地开发:http://localhost:5173/index.html
npm run build      # 产出静态站点到 app/dist/(含 dist/courses/ic-packaging.pigeon)
npm run preview    # 预览生产构建
```

部署:把 `app/dist/` 整个目录交给任意静态服务器(nginx 等)即可上线。

## 制作一个课程包

1. 在 `courses/<你的课程id>/` 下按 `docs/pigeon-format.md` 写 `manifest.json` / `content.json` / `quiz.json` / `glossary.json`,图片放 `assets/images/`。
2. 打包:`node tools/build-pigeon.mjs <你的课程id>` → 产出 `dist-courses/<id>.pigeon`。
3. 在首页上传该 `.pigeon`(存浏览器 IndexedDB),或加入 `app/src/core/course-registry.js` 的 `BUILTIN_COURSES` 作为内置课程随站发布。

让 AI 把教材转成课程包:见 `docs/ai-course-authoring-prompt.md`(含术语表与题目解析的制作指南)。

`courses/demo-course/` 是一个最小示例课程包,可作为制作模板与解耦验证用例。

## 技术要点

- 纯静态(Vite 构建),无后端。课程在浏览器本地解压(fflate),图片转 Blob URL,完全自包含、可离线。
- 学习进度/答题/错题/学习时长按 `pglib:<courseId>:<slot>` 命名空间隔离,课程之间互不串扰;主题为站点级共享。
- `.pigeon` 格式可扩展:内容节点与题型均为开放枚举,预留 `html` 节点(HTML 片段)与未来题型。
