# 给 AI 的 PigeonLib 课程制作提示词

请把我提供的教材整理成 PigeonLib `schemaVersion: 1` 的 `.pigeon` 课程包源码。`.pigeon` 本质是 zip,根目录必须包含:

```text
manifest.json
content.json
quiz.json
glossary.json
assets/images/
```

请严格按 `docs/pigeon-format.md` 产出 JSON。`manifest.json` 必须包含 `id`、`title`、`schemaVersion`、`chapters` 和可选 `stats`。`id` 使用小写英文、数字和连字符。章节 id 用 `"4"` 这种数字字符串,小节 id 用 `"4.1"`,知识点 id 用 `"4-1-1"`。图片统一放入 `assets/images/`,正文只引用相对路径。

`content.json` 请按教材结构切分知识点,每个知识点使用类型化块: `paragraph`、`heading`、`image`、`paramsTable`、`summaryBox`、`compareBox`、`sectionQuiz`。不要把整篇教材塞进一个字段;每个知识点应能独立学习。

`glossary.json` 请从教材自动抽取缩写和专有名词,生成 `{ "t": "...", "full": "...", "cn": "...", "d": "..." }`。`t` 必须使用正文里的实际写法,包括 `T/C`、`I/O` 这类符号,保证悬浮提示能命中。`full` 写英文全称或完整术语,`cn` 写中文名,`d` 用一句话解释清楚。

`quiz.json` 如原资料只有题目没有解析,请为每题补充 `exp` 或 `explain`。解析必须包含:为什么正确、其他选项为什么错、关联哪个知识点、记忆要点。`single` 题侧重选项辨析;`judge` 题说明判断依据;`sort` 题说明步骤顺序;`match` 题说明配对关系。解析必须基于课程正文,不要杜撰;不确定处标注“需人工复核”。

最后请自检:JSON 必须可解析;`manifest.chapters` 能索引所有知识点;题目答案存在且格式一致;图片路径都能在 `assets/images/` 找到;`stats` 与实际章节、知识点、题目数量一致。
