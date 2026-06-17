# 打包用法（build-pigeon）

打包脚本是仓库的 [`tools/build-pigeon.mjs`](../../../../tools/build-pigeon.mjs)。本 Skill 不重复实现,直接调它。

## 用法

```bash
# 在 PigeonLib 仓库根运行。<课程id> = courses/ 下的目录名
node tools/build-pigeon.mjs <课程id>
# 例:
node tools/build-pigeon.mjs demo-course      # → dist-courses/demo-course.pigeon
```

脚本会:
1. 递归收集 `courses/<课程id>/` 下所有文件(JSON + assets + cover)。
2. 断言存在 `manifest.json` 与 `content.json`(缺则报错退出)。
3. 用 `fflate.zipSync`(level 9)压成 `dist-courses/<课程id>.pigeon`。
4. 打印 `packageFiles / rawBytes / pigeonBytes`。

## 前置

- 依赖 `app/node_modules/fflate`,所以先在 `app/` 跑过 `npm install`(或用过启动器)。
- 课程目录必须按 [reference/format-cheatsheet.md](../reference/format-cheatsheet.md) 的结构组织。

## 产出验证

把 `dist-courses/<课程id>.pigeon` 在首页(`index.html`)拖拽上传,确认:目录树、知识卡片、小节小测、章节考试、术语提示均正常。无误后即可分享该 `.pigeon`,或加入 `app/src/core/course-registry.js` 的 `BUILTIN_COURSES` 随站发布。
