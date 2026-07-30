# 达芬奇的奇妙之旅

一个以 GitHub 仓库为唯一内容源、面向站长本人的可视化 Markdown 笔记发布工具。

## 当前能力

- 读取归档方案配置并进行校验。
- 使用纯 TypeScript Markdown AST 解析 Front Matter、标题、代码语言和图片引用。
- 识别 Markdown 图片、HTML `img`、Obsidian 图片、远程图片、Base64 图片和绝对路径。
- 通过桌面 Node 适配层读取真实 Markdown 文件，并解析本地图片依赖状态。
- 桌面端提供五步发布草稿流程：选择 Markdown、检查图片、编辑文章信息、选择归档方案、预览与发布。
- 新建归档方案先进入发布草稿的待提交变更，不会提前写入 `config/archive-profiles.yml`。

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## 当前限制

- 本轮只生成发布草稿和发布计划，不复制图片、不重写 Markdown 图片路径、不执行 Git Push。
- 浏览器预览无法直接读取 Markdown 相邻图片；真实文件系统解析能力位于桌面适配层，后续接入 Tauri/Rust 命令。
