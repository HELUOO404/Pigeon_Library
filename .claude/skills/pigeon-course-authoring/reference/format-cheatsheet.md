# .pigeon 格式速查（cheatsheet）

> 速查表。字段冲突时以仓库 [`docs/pigeon-format.md`](../../../../docs/pigeon-format.md) 为**唯一权威**。schemaVersion = 1。

## 包结构

```
manifest.json   必需  元信息 + 章/节/知识点索引树
content.json    必需  知识点正文(类型化块)
quiz.json       可选  题库(引用模型)
glossary.json   可选  术语表
assets/images/  可选  图片(content 用相对路径引用)
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
| `paramsTable` | `headers[]`,`rows[][]` | 参数表 |
| `summaryBox` | `title`,`items: Span[][]` | 要点框 |
| `compareBox` | `title`,`headers[]`,`rows: {label,cells[]}[]` | 对比表 |
| `sectionQuiz` | `quizRef` | 小节小测(题来自 quiz.json.sectionQuizzes[quizRef]) |
| `html` | `html` | 逃生舱:原样 HTML(相对资源路径自动解析);承载复杂表格/合并单元格 |

未知 type → 渲染器跳过 + warn(向后兼容)。

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

`too-large`(>50MB)/`not-zip`/`no-manifest`/`bad-manifest`(缺 id/title/chapters)/`no-content`/`bad-content`(无 knowledgePoints)。图片缺失为警告级(`<img onerror>` 容错)。

---

## 自检清单（打包前过一遍）

- [ ] manifest 有 `schemaVersion:1` / `id` / `title` / `chapters`。
- [ ] 每个 `chapters[].sections[].knowledgePoints[]` 的 id 是 `章-节-序` 连字符格式。
- [ ] content.json 的 `knowledgePoints` key 与 manifest 的知识点 id **一一对应**。
- [ ] paragraph 内只用三种 Span(纯文本 / `b` / `sub`),无内联 `<a>`/`<img>`(否则拆包工具报错)。
- [ ] 题只在 `questionBank` 定义一次;`sectionQuizzes`/`examQuestions` 用 id 引用,无重复抄题。
- [ ] 每题有 `explain`;只有题无解析的课程已补解析(为什么对 / 别的为什么错 / 关联知识点 / 记忆点)。
- [ ] glossary 的 `t` 用正文实际写法;释义基于教材,不杜撰。
- [ ] 图片放 `assets/images/`,content 用相对路径;封面 `cover.png` 或 `coverText` 二选一。
- [ ] 打包:`node tools/build-pigeon.mjs <id>`;在首页上传 `.pigeon` 验证可加载、目录树/卡片/小测/考试/术语提示都正常。
