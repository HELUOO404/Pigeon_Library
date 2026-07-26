# dist-courses/ — 打包产物(*.pigeon)

`tools/build-pigeon.mjs` 的输出。每个 `<id>.pigeon` 是一门课的 zip 包。

- 内置课 `ic-packaging.pigeon`:开发期由 Vite 提供给页面;`npm run build` 时拷入 `app/dist/`(故**先打包课程再构建**,见 [`../CLAUDE.md`](../CLAUDE.md))。该文件**不入版本库**,需在本机由 `courses/ic-packaging/` 打包生成。
- 入库的只有 `demo-course.pigeon`(最小示例);其余 `.pigeon` 是本地产物,随部署另行分发(见根 `.gitignore`)。
- 由源 `courses/<id>/` 生成;改源后重跑打包。
- 由脚本生成,一般不手工编辑;用户的备份/临时 zip(如 `*副本*.zip`)不纳入提交。
