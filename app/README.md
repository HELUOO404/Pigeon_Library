# app/ — 网站源码(Vite)

PigeonLib 的前端站点。纯静态、无后端,课程在浏览器本地解压渲染。

## 入口
- `index.html` — 首页(浏览/上传课程、格式说明)。脚本 `src/main-home.js`。
- `learn.html` — 学习页 `?course=<id>`(目录/知识卡/小测/考试/错题/术语)。脚本 `src/main-learn.js`。

## 目录
- `src/core/` — 与内容无关的引擎(存储、主题、`.pigeon` 加载、课程登记、图标)。见其 README。
- `src/render/` — 把课程数据渲染成 DOM 的渲染器。见其 README。
- `src/styles/` — 设计令牌与两页样式。见其 README。
- `public/` — 站点静态资源(品牌标)。

## 运行 / 构建
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # → app/dist/  (先在仓库根打包课程,见 ../CLAUDE.md 构建顺序)
npm run preview
```
配置:`vite.config.js`(双入口 index/learn;开发期把 `dist-courses/*.pigeon` 与 `docs/` 提供给页面)。

规范见 [`../CLAUDE.md`](../CLAUDE.md) 与 [`../docs/design-system.md`](../docs/design-system.md)。
