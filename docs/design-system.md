# PigeonLib 设计系统

> 信鸽邮政编辑风(postal editorial)。所有界面遵循本文件;令牌单一来源在 `app/src/styles/tokens.css`。
> 返回总纲与索引:[`../CLAUDE.md`](../CLAUDE.md)。

## 一、调性

暖纸(paper)+ 墨黑(ink)+ 邮政金 brass(gold)+ 火漆印章红(seal)。展示用衬线,正文无衬线,数据用等宽。**无科技蓝**。母题:邮票齿孔、邮戳、航空压线、火漆印。

## 二、设计令牌(`tokens.css` 唯一来源)

> 组件**只引用令牌,不写死色值**。改色板只改 `tokens.css`,亮/暗双主题自动派生。

### 品牌色板
| 令牌 | 含义 | 亮 | 暗 |
|---|---|---|---|
| `--paper` / `--paper-edge` | 纸底 / 纸边 | `#f4efe2` / `#ece3d1` | `#16161d` / `#1e1e28` |
| `--ink` / `--ink-soft` | 墨黑 / 次要墨 | `#23262e` / `#5f636d` | `#ece7da` / `#a39f91` |
| `--gold` / `--gold-deep` | 邮政金 / 深金 | `#b8842c` / `#946a1d` | `#d8b06a` / `#e6c486` |
| `--seal` | 火漆印章红 | `#b23a2e` | `#e07a64` |
| `--card` | 卡片面 | `#fbf8f1` | `#1f1f29` |
| `--line` / `--line-2` | 分隔线(淡/稍重) | rgba ink .13 / .22 | rgba ink .14 / .26 |
| `--shadow` | 暖投影 | — | — |

### 语义令牌(组件引用这些)
`--bg`(页面底)`--surface`(卡片)`--surface-sunken`(内凹面)`--text` / `--text-soft`(正文/次要)`--border`(描边)`--hover`(悬浮底)`--accent` / `--accent-deep`(=金,主强调)`--danger`(=印章红)`--radius`(9px)。
反馈色:`--correct-bg/--correct-tx`(暖橄榄绿)、`--wrong-bg/--wrong-tx`(印章红系)。
布局:`--sidebar-w` `--header-h` `--footer-h`。
> `--c1/--ctx/--cbg/--cs/--cd…` 是**遗留别名**(映射到新调色板),仅为兼容旧选择器,**新代码勿用**。

### 字体
| 令牌 | 字体 | 用途 |
|---|---|---|
| `--serif` | Fraunces / Noto Serif SC | 展示标题、品牌名、大数字 |
| `--sans` | Noto Sans SC | 正文默认 |
| `--mono` | Space Mono | 统计 / 徽章 / 计数 / 计时 / 编号 / 邮戳字 |

两页都需在 `<head>` 引入这四个 Google Fonts 字体族(见 index.html / learn.html)。

## 三、字阶与排版

- 大标题(hero / 区块 h2):`--serif` 700–900,`clamp()` 自适应。
- 卡片标题、知识卡标题:`--serif` 700。
- 正文:`--sans`,行高 1.7–1.8。
- 数据点缀(徽章/计数/进度/计时/编号):`--mono`,小字号、字距略松。
- 区块编号用 CSS 计数器 `NO.01`(`counter`),不手写序号。

## 四、组件规范

- **顶栏**:半透明 `--paper` + `blur` + 底部 `--line` hairline;品牌名 `--serif`。
- **卡片**(课程卡/知识卡/题卡):`--card` 底 + `1px var(--line-2)` 边 + `--shadow` + 圆角;课程卡顶部邮票齿孔条。
- **按钮**:主按钮 `--ink` 底 / `--paper` 字(暗色用 `--gold` 底);次按钮透明 + `--line-2` 边,hover 转金。
- **徽章/标签**:`--mono`,药丸形;状态色取金/印章红/中性。
- **quiz / exam 选项**:`--line-2` 边,hover/选中 = `--hover` 底 + 金边;对错 = 反馈色底。
- **考试计时 / 结果**:计时用 `--mono`,从 `00:00` 正向累计且不按固定时限自动交卷;错题回顾用颜色与对/错图标表达状态,正确选项不再重复附加“正确答案”文字标签。
- **课程目录**:章节是单开手风琴;当前章节显示全部小节与知识卡,小节不再折叠。长标题自然换行,章节/小节/知识卡使用同一棵树供桌面侧栏与移动抽屉复用。
- **卡内 tab**:紧凑按钮组 + 底部 hairline,窄容器自动换行;选中态用 `--ink`/`--paper`,暗色主题沿用令牌反转。
- **表格**:表头 `--ink` 底 / `--paper` 字;单元格 `--line-2` 边;斑马行用金色微 tint。原生 `paramsTable` 和 `compareBox` 在窄容器改为“列名 + 值”记录;富表格保留跨行共享字段,不得横向滚动。
- **图片组**:宽容器自适应网格,窄容器单列;图片、说明和网格子项均不得撑破内容卡。
- **进度条**:金渐变(`--gold → --gold-deep`)。

## 五、图标体系(`app/src/core/icons.js`)

- 选用 **Lucide**(MIT,24×24,~2px 线性描边),逐图标内联 `<path>`,不引运行时依赖。
- 动态渲染(JS 模板串):`icon('check', {size, cls})` 返回内联 SVG 字符串。
- 静态页面 chrome:写 `<span data-icon="menu" aria-hidden="true"></span>` 占位,`main-*.js` 启动调 `hydrateIcons(document)` 填充。占位预留行内盒避免水合抖动。
- 主题键写 `data-icon="theme"`,水合为 月+日 两枚,由 `tokens.css` 按 `[data-theme]` 切换显隐。
- 图标随上下文 `font-size` 缩放(默认 `1em`),用 `currentColor` 继承文字色。
- 已纳入的图标:menu, moon/sun, sun-moon, package, folder, upload, sparkles, send, book, bookmark, square-pen, layout-dashboard, circle-x, book-open, list-tree, clock, grip-vertical, check, x, lightbulb, rotate-ccw, party-popper, trash-2。新增时从 lucide.dev 复制 path 加进 `PATHS`。

## 六、禁用元素(本项目硬规则)

### 1. 禁 emoji(UI 一律用 SVG 图标)
- 平台界面(HTML chrome、`render/*`、`main-*` 模板串)**不得出现 emoji**,改用图标体系。
- 正例:`icon('circle-x')`、`<span data-icon="menu">`。
- 反例(过去的写法,已全部替换):用 emoji `错题本`/图表/对勾/刷新/灯泡等当图标。
- 例外:**课程正文数据**(`courses/*/content.json` 等)由作者决定,可含 emoji;平台不强制。
- 例外:方向/展开等**排版箭头**(→ ← ▾ ▴ ▶ ▼)属字体排版,可保留(它们位于 `textContent` 槽,且非图形图标)。

### 2. 禁竖向装饰线
- **不得**用 `border-left` / `border-right` 给内容盒子加装饰性 accent 竖条(用户明确不喜欢"框框左边一条竖线")。
- 替代手法:顶部 `border-top` hairline、eyebrow 小标签、`--mono` 序号 chip、圆点、背景色差(`--surface-sunken` / `--hover`)。
- 连结构性分隔(如侧栏)也改用**背景色差**而非竖线。
- 自检:`grep border-left|border-right app/src/styles` 应只剩注释,无装饰性声明。

## 七、动效与无障碍

- 入场用 `riseIn` 交错动画(`animation-delay`);克制,集中在首屏。
- 必须支持 `@media (prefers-reduced-motion: reduce)`(关闭动画/过渡)。
- 图标加 `aria-hidden="true"`;纯图标按钮加 `aria-label`。
- 颜色对比满足正文可读;暗色主题单独校准反馈色透明度。

## 八、设计资源

- 令牌:`app/src/styles/tokens.css`(唯一来源)。
- 图标:`app/src/core/icons.js`。
- 品牌标:`app/public/brand-logo.svg`(邮戳圆环 + 折纸信鸽 + 火漆印;**站点 logo,勿与课程封面混用**)。
- 课程封面:`courses/<id>/cover.png`(或 manifest `coverText` 自定义文字)。
