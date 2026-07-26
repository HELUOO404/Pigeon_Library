# courses/ — 课程包源(解包形态)

每个子目录是一门课的源文件;用 `tools/build-pigeon.mjs` 打包成 `dist-courses/<id>.pigeon`。

```
courses/<id>/
  manifest.json     必需  元信息 + 章/节/知识点索引树(含 cover/coverText)
  content.json      必需  知识点正文(类型化块)
  quiz.json         可选  题库(questionBank 引用模型)+ 小测/考试引用
  glossary.json     可选  术语表
  cover.png         可选  课程封面(manifest.cover 指向)
  assets/images/    可选  正文/表格引用的图片
```

- 入库的只有 `demo-course`(最小示例/模板);其余课程包(含内置课 `ic-packaging`)是本地资产,不进版本库,随部署另行分发(见根 `.gitignore`)。
- 字段与块类型契约见 [`../docs/pigeon-format.md`](../docs/pigeon-format.md);JSON 可写注释(JSONC),约定见 [`../docs/code-style.md`](../docs/code-style.md)。
- 复杂表格(含图/合并单元格)用 `html` 块,内嵌 `<img src="assets/...">` 路径加载时自动解析。
- 改了课程数据后**记得重新打包**:`node tools/build-pigeon.mjs <id>`。
- 课程**正文数据**里的 emoji 由作者决定,不受平台"禁 UI emoji"约束。
