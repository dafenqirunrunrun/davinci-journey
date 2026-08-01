# 达芬奇的奇妙之旅

一个以 GitHub 仓库为唯一内容源的可视化 Markdown 笔记发布、图片处理、自动归档和静态网站生成工具。

## 运行前置条件

- Node.js 20+
- pnpm 11+
- Rust stable
- Tauri 2 所需系统依赖

## 浏览器预览

```bash
pnpm --filter @davinci-journey/desktop dev
```

浏览器预览只验证 React UI：

- 可以读取用户手动选择的 Markdown 内容；
- 不能读取 Markdown 相邻图片；
- 不能生成真实临时发布工作区；
- 不执行正式仓库写入、Git stage、commit 或 push。

## Tauri 桌面模式

```bash
pnpm --filter @davinci-journey/desktop tauri:dev
```

桌面模式用于验证真实本地能力：

- 文件选择器；
- Markdown 相邻图片解析；
- 临时发布工作区生成；
- 文件管理器打开工作区；
- 丢弃临时工作区。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Rust/Tauri：

```bash
cd apps/desktop/src-tauri
cargo fmt --check
cargo check --all-targets --all-features
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
```

## 当前限制

- 尚未启用正式 `content/` 写入；
- 尚未启用自动 Git stage、commit、push；
- 尚未写入 `config/archive-profiles.yml` 的正式发布变更；
- Base64 图片仍阻止工作区生成；
- 网络图片不会下载，只保留原始 URL；
- 外部 AI 分类未接入。

## Markdown 内容规范

公开网站文章页会使用 Front Matter 的 `title` 作为页面标题。

如果 Front Matter 已经包含 `title`，正文首个标题不建议再写重复的 `# H1`。网站渲染层会自动隐藏与页面标题重复或高度相似的首个 H1，以避免文章标题重复显示。
