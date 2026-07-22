# .pigeon 格式速查（cheatsheet）

> 速查表。字段冲突时以仓库 [`docs/pigeon-format.md`](../../../../docs/pigeon-format.md) 为**唯一权威**。schemaVersion = 1。

## 包结构

```
manifest.json   必需  元信息 + 章/节/知识点索引树
content.json    必需  知识点正文(类型化块)
quiz.json       可选  题库(引用模型)
glossary.json   可选  术语表
assets/         可选  图片、视频、字幕与仿真依赖(content 用相对路径引用)
cover.png       可选  封面(manifest.cover 指向)
```

四个 JSON 都可写 `//` / `/* */` 注释(加载时自动剥离),建议开头放"字段图例"。

## ID 约定（强制）

| 层级 | 格式 | 例 |
|---|---|---|
| 章 | 数字字符串 | `"4"` |
| 节 | 章.节 | `"4.1"` |
| 知识点 | 章-节-序 | `"4-1-1"` |
| 题 | 章-三位流水 | `"4-001"` |

## manifest.json

```jsonc
{
  "schemaVersion": 1,                  // 必需
  "id": "my-course",                   // 必需,唯一(localStorage 命名空间 / ?course=)
  "title": "课程名",                    // 必需
  "subtitle": "副标题",                 // 可选
  "author": "作者",                     // 可选
  "version": "1.0",                    // 可选
  "cover": "cover.png",                // 可选,封面图相对路径
  "assetBase": "/courses/my-course/",  // 可选,大媒体/仿真分离部署的同源本地根路径
  "coverText": "缩写",                  // 可选,无封面图时显示的文字(与 cover 二选一)
  "stats": { "chapters": 3, "knowledgePoints": 25, "questions": 120 }, // 可选,缺省平台扫描
  "chapters": [                        // 必需
    {
      "id": "4",
      "title": "第4章 标题",
      "tabLabel": "第4章",             // 可选,顶栏 tab 文案
      "sections": [
        {
          "id": "4.1",
          "title": "第4.1节 标题",
          "knowledgePoints": [
            { "id": "4-1-1", "title": "知识点标题" }
          ]
        }
      ]
    }
  ]
}
```

## content.json — 块类型

`overviews`(节概述,key=节id)与 `knowledgePoints`(知识点正文,key=知识点id),每个含 `title` + `blocks[]`。

| type | 字段 | 渲染 |
|---|---|---|
| `paragraph` | `spans: Span[]` | 段落 + 内联 |
| `numTitle` | `text` | 编号高亮药丸 |
| `boldCaption` | `text` | 加粗小标题 |
| `heading` | `text` | `<h4>` |
| `image` | `src`,`alt?` | 图片(src 为 `assets/images/…`,运行时转 Blob URL) |
| `imageGroup` | `images: {src,alt?,caption?}[]` | 同组图片的原生响应式网格；窄容器自动单列 |
| `list` | `ordered?`,`items: Span[][]` | 原生有序/无序列表 |
| `paramsTable` | `headers: TableCell[]`,`rows: TableCell[][]` | 原生语义表格；支持富文本、图片、`rowspan`、`colspan`，窄容器自动重排为记录 |
| `tabSet` | `id`,`tabs: {id,label,blocks}[]` | 卡片内原生标签页；支持点击、键盘、ARIA 与标签换行，禁止嵌套 |
| `summaryBox` | `title`,`items: Span[][]` | 要点框 |
| `compareBox` | `title`,`headers[]`,`rows: {label,cells[]}[]` | 对比表 |
| `sectionQuiz` | `quizRef` | 小节小测(题来自 quiz.json.sectionQuizzes[quizRef]) |
| `html` | `html` | 旧课程兼容位：严格白名单消毒后的静态内容；新课程能用原生块表达时禁止使用 |
| `sandbox` | `html`,`height?`,`dependencies?`,`modeSwitch?` | 隔离 iframe(`sandbox="allow-scripts"`):JS 可运行;动态依赖逐项列入 `dependencies`;带答案时 `modeSwitch:true` 使用站点外层模式控件 |
| `video` | `src`,`title?`,`poster?`,`captions?` | 本地视频、封面与 WebVTT 字幕 |
| `stepSimulation` | `id`,`title?`,`poster?`,`steps[]` | 正确答案门控的连续仿真短片;`answerIndex` 从 1 开始 |
| `paramSelect` | `id`,`title?`,`headers?`,`groups[]`,`simulations?` | 参数选择答题表；保留分组、完整选项、满分答案与已验证结果图 |

未知 type → 渲染器跳过 + warn(向后兼容)。

### 富表格单元格(TableCell)

旧字符串单元格继续有效；富单元格可使用 `text`、`spans`、`image`、`header`、`scope`、`rowspan`、`colspan`。桌面保留二维语义表，窄容器由平台按逻辑网格转成独立“列名 + 值”记录；跨行共享字段仍会出现在相关记录中。课程数据不得复制移动端列名，也不得用横向滚动承载完整内容。

### 原生标签页(tabSet)

`tabSet.id` 在课程内唯一；每个 tab 的 `id` 在当前集合内唯一，`blocks` 继续使用普通块且不得再嵌套 `tabSet`。默认打开首项，切换仅隐藏面板、不销毁其中表单或仿真状态；标签在窄容器自动换行。

### Span(内联,仅三种)

```jsonc
{ "t": "纯文本" }
{ "t": "加粗", "b": true }            // <strong>
{ "t": "子标题", "sub": true }         // .sub-title 样式
```

## quiz.json — 引用模型

```jsonc
{
  "questionBank": {                    // 一题定义一次,id = 章-三位流水
    "4-001": { "type": "single", "stem": "题干", "options": ["A. ..","B. .."], "answer": "A", "explain": ".." },
    "4-002": { "type": "judge",  "stem": "..", "answer": true, "explain": ".." },
    "4-003": { "type": "sort",   "stem": "..", "items": ["乱序.."], "answer": ["正确顺序.."], "explain": ".." },
    "4-004": { "type": "match",  "stem": "..", "left": [".."], "right": [".."], "answer": {"左":"右"}, "explain": ".." }
  },
  "sectionQuizzes": { "4-1-1": ["4-001","4-007"] },   // 小节小测:知识点id → [题id]
  "examQuestions":  { "4": ["4-001","4-002"] }        // 章节考试:章id → [题id]
}
```

题型:`single`(options)/`judge`(answer 布尔,无 options)/`sort`(items+数组 answer)/`match`(left/right+对象 answer)。type 是开放枚举,未知题型显示占位不崩溃。

## glossary.json

```jsonc
[ { "t": "DBG", "full": "Dicing Before Grinding", "cn": "先划片后减薄", "d": "一句话释义" } ]
```

`t` 用**正文里的实际写法**(含 `/`,如 `T/C`);渲染后扫描正文文本节点,把命中的 `t` 包成术语提示。

## 校验（加载时报错码）

`too-large`(>1GB)/`not-zip`/`no-manifest`/`bad-manifest`(缺 id/title/chapters)/`no-content`/`bad-content`(无 knowledgePoints)。图片缺失为警告级(`<img onerror>` 容错)。

---

## 自检清单（打包前过一遍）

- [ ] manifest 有 `schemaVersion:1` / `id` / `title` / `chapters`。
- [ ] 每个 `chapters[].sections[].knowledgePoints[]` 的 id 是 `章-节-序` 连字符格式。
- [ ] content.json 的 `knowledgePoints` key 与 manifest 的知识点 id **一一对应**。
- [ ] paragraph 内只用三种 Span(纯文本 / `b` / `sub`),无内联 `<a>`/`<img>`(否则拆包工具报错)。
- [ ] 新课程的正文、列表、图片、图片组和静态表格使用原生块；理论知识卡没有 `html` 兜底。
- [ ] 富 `paramsTable` 完整保留表头、图片和合并关系，并能在窄容器重排；`tabSet` 无嵌套且标签无需横向滚动。
- [ ] 图片 `alt` 逐字保留源值；源值为空时保持为空并报告，禁止猜写。
- [ ] 题只在 `questionBank` 定义一次;`sectionQuizzes`/`examQuestions` 用 id 引用,无重复抄题。
- [ ] 每题有 `explain`;只有题无解析的课程已补解析(为什么对 / 别的为什么错 / 关联知识点 / 记忆点)。
- [ ] glossary 的 `t` 用正文实际写法;释义基于教材,不杜撰。
- [ ] 图片放 `assets/images/`,视频/字幕放 `assets/media/`,仿真依赖放 `assets/simulations/<id>/`;所有资源引用通过离线闭包校验，无外链、PHP 或运行时网络依赖。
- [ ] 1440/1024/390/360 px 下卡片、tab、图片、表格、下拉和 Canvas 均无横向溢出。
- [ ] 打包:`node tools/build-pigeon.mjs <id>`;在首页上传 `.pigeon` 验证可加载、目录树/卡片/小测/考试/术语提示都正常。
