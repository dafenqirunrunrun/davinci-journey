# 达芬奇的奇妙之旅

一个以 **GitHub 仓库为唯一内容源**的可视化 Markdown 笔记发布工具。支持本地写作、图片自动处理、归档管理，以及一键写入仓库、提交、推送并部署到 GitHub Pages 公开网站。

- 🌐 **公开网站**：<https://dafenqirunrunrun.github.io/davinci-journey/>
- 📦 **GitHub 仓库**：<https://github.com/dafenqirunrunrun/davinci-journey>
- 🖥️ **桌面应用**：Tauri 2 + React，提供 Windows NSIS 安装包

---

## ✨ 功能特性

### 笔记发布流程

从选择 Markdown 到公开上线，全程可视化：

```
选择 Markdown
→ 自动识别引用图片
→ 编辑文章信息
→ 选择或新建归档方案
→ 生成并验证发布工作区
→ 写入正式仓库（原子化事务）
→ 查看 Git Diff
→ 精确 Stage
→ 确认 Commit
→ 推送 GitHub
→ 跟踪 GitHub Pages 部署
→ 验证公开文章
```

### 批量发布

一次导入多篇笔记，逐篇审核后按队列顺序发布（每批最多 10 篇）：

```
选择多篇 Markdown（系统原生多选，最多 10 篇）
→ 批量队列预览、排序、选择 / 跳过 / 移除
→ 逐篇解析与审核（标题 / Slug / 摘要 / 标签 / 归档方案 / 图片检查）
→ 队列预检（新建 / 更新 / 图片数 / Commit 数）
→ 顺序写入并逐篇独立 Commit（失败即暂停，可重试 / 跳过）
→ 整批一次 Push（复用远程 / 分支 / HEAD 安全检查）
→ 跟踪 GitHub Pages 部署并输出批量发布报告
```

### 主要能力

- **批量发布**：多文件导入（最多 10 篇）、队列排序 / 选择 / 跳过、逐篇审核门禁、失败暂停与安全恢复、每篇独立 Commit、整批一次 Push、结果页查看公开文章
- **重启恢复**：批量队列状态保存到本地应用数据目录，重启后可继续（仅存元数据与提交引用，不存 Markdown 正文 / Token / 图片二进制）
- **Markdown 解析**：AST 级解析、Front Matter 读写、标准 / HTML / Obsidian 图片识别
- **图片处理**：本地相对图片解析、MIME 与 SHA-256 校验、PNG/JPEG 转 WebP、SVG 安全校验
- **原子化写入**：事务化写入正式仓库（Markdown + 图片 + 归档配置），失败自动回滚，不覆盖用户未提交修改
- **Git 集成**：安全 Git Diff、精确 Stage、Conventional Commit 确认、推送前远程/分支安全检查
- **GitHub Pages**：`gh` CLI 跟踪 Deploy Pages 工作流，验证公开文章可访问；`gh` 缺失时优雅降级
- **网站渲染**：Astro 静态站，支持 GFM（表格/引用/删除线）、AST 级去重页面标题、自动摘要、深浅色模式、移动端适配
- **Windows 安装包**：NSIS 安装程序，桌面/开始菜单快捷方式，卸载程序，本地配置保留

---

## 📁 项目结构

```
├── apps/
│   ├── desktop/          # Tauri 2 + React 桌面应用
│   │   └── src-tauri/    #   Rust 后端（服务层 + 安全层 + Tauri 命令）
│   └── website/          # Astro 公开网站
├── packages/
│   ├── classification/   # 归档方案推荐与文章信息处理
│   ├── markdown-core/    # Markdown 解析 / 图片引用 / 标题规范化
│   └── desktop-node-adapter/  # 桌面端 Node 适配
├── config/
│   └── archive-profiles.yml    # 归档方案配置（唯一事实来源）
├── content/              # 已发布文章（写入正式仓库）
├── public/assets/notes/  # 已发布图片（写入正式仓库）
├── fixtures/             # 测试用 Fixture
└── scripts/              # 构建 / 冒烟测试脚本
```

---

## 🚀 快速开始

### 环境要求

- Node.js 20+
- pnpm 11+
- Rust stable（含 MSVC toolchain）
- Tauri 2 所需系统依赖（WebView2、Windows Build Tools）

### 安装依赖

```bash
pnpm install
```

### 浏览器预览（仅验证 React UI）

```bash
pnpm --filter @davinci-journey/desktop dev
```

浏览器预览只验证界面：可读取手动选择的 Markdown，但不能访问相邻图片、不能生成真实发布工作区、不执行仓库写入或 Git 操作。

### Tauri 桌面模式（完整功能）

```bash
pnpm --filter @davinci-journey/desktop tauri:dev
```

桌面模式提供完整本地能力：文件选择、图片解析、工作区生成、正式仓库写入、Git Stage/Commit、Push、Pages 部署跟踪。

### 打包 Windows 安装包

```bash
powershell -ExecutionPolicy Bypass -File ".\scripts\build-windows-installer.ps1"
```

或直接：

```bash
pnpm --filter @davinci-journey/desktop tauri:build
```

安装包输出到：

```
apps/desktop/src-tauri/target/release/bundle/nsis/达芬奇的奇妙之旅_<version>_x64-setup.exe
```

---

## 📝 内容规范

- 文章标题以 Front Matter 的 `title` 为准，页面级标题唯一
- 正文首个标题建议不要重复写 `# H1`（网站渲染层会自动移除重复标题）
- `description` 为空时自动生成摘要（AST 级提取，不包含 `$1` 或目录噪声）
- 图片引用支持标准 Markdown、HTML `<img>` 与 Obsidian 语法

---

## ✅ 验证门禁

### TypeScript / 前端

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### Rust / Tauri

```bash
cd apps/desktop/src-tauri
cargo fmt --check
cargo check --all-targets --all-features
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets --all-features
```

### 端到端测试

- 临时 Git 仓库发布 E2E（`cargo test --test e2e_publish`）
- 图片处理 E2E（PNG/JPEG → WebP，`cargo test --test image_e2e`）
- 远程推送 E2E（本地 Bare Remote，`cargo test --test e2e_push`）
- 批量发布 Bare Remote 回归（2 篇 2 Commit 1 Push + 失败恢复，`cargo test batch_`）
- 批量发布组件测试（成功链路 / 失败重试 / 跳过 / 重启恢复 / 一次 Push，`test/BatchPublishFlow.test.tsx`）

---

## 🌍 部署

网站由 GitHub Pages 自动部署：

- 推送 `master` 分支后，`Deploy Pages` 工作流自动构建并发布
- 公开网站：<https://dafenqirunrunrun.github.io/davinci-journey/>
- 部署状态可在仓库的 Actions 页面查看

---

## ⚠️ 已知限制

- Base64 嵌入图片暂不写入工作区，需先转为本地图片
- 网络图片不会下载，保留原始 URL
- 外部 AI 分类未接入
- GitHub Pages 部署后图片存在短暂 CDN 缓存延迟（通常 1～2 分钟）

---

## 🔗 相关链接

- 公开网站：<https://dafenqirunrunrun.github.io/davinci-journey/>
- GitHub 仓库：<https://github.com/dafenqirunrunrun/davinci-journey>
