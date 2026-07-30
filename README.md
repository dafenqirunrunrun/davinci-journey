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
## 桌面端真实文件系统与发布工作区

项目名称始终为：达芬奇的奇妙之旅。

桌面端正式运行路径使用 Tauri 2。React 前端只通过 `DesktopBridge` 调用桌面能力，不直接使用 `node:fs`、`node:path`、`node:crypto` 或 `child_process`。`packages/desktop-node-adapter` 仅用于 Node 单元测试、维护脚本和非 Tauri 开发辅助，不会作为 Tauri 前端运行时依赖。

本地预览可使用：

```bash
pnpm --dir apps/desktop exec vite --host 127.0.0.1 --port 4174
```

Tauri 开发环境需要本机安装 Rust/Cargo 后运行：

```bash
pnpm --dir apps/desktop exec vite --host 127.0.0.1 --port 4174
cargo test
```

浏览器预览模式只能读取用户选择的 Markdown 内容，不能读取 Markdown 相邻图片，也不能生成 `.publish-workspaces`。真实文件选择、相邻图片解析、图片复制/转换和临时发布工作区生成必须在 Tauri 桌面模式下完成。

临时发布工作区位置：

```text
.publish-workspaces/<workspace-id>/
├── manifest.json
├── content/<category>/<topic>/<slug>.md
├── public/assets/notes/<slug>/
└── reports/validation.json
```

工作区只用于预览和校验，不会写入正式 `content/` 或 `public/assets/notes/`，也不会执行 Git Commit/Push。遗留工作区不会自动删除；用户可以在发布流程中点击“丢弃工作区”清理当前工作区。

当前支持识别标准 Markdown 图片、HTML `img`、Obsidian `![[image.png]]`、远程图片和 Base64 图片。PNG/JPEG 在 Tauri 工作区生成时默认转换为 WebP；WebP、SVG、GIF、AVIF 默认保持原格式。Base64 图片本轮先阻止工作区生成，后续再实现提取为独立资源。
