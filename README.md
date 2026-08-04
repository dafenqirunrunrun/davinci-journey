# 达芬奇的奇妙之旅

> 一个以 **GitHub 仓库为唯一内容源**的 Markdown 笔记发布工具 —— 本地写作、图片自动处理、归档管理，一键提交、推送并部署到 GitHub Pages 公开网站。

- 🌐 **公开网站** · <https://dafenqirunrunrun.github.io/davinci-journey/>
- 📦 **源码仓库** · <https://github.com/dafenqirunrunrun/davinci-journey>
- 🖥️ **桌面应用** · Tauri 2 + React，提供 Windows NSIS 安装包

---

## ✨ 特性一览

- **全链路可视化发布**：选择 Markdown → 自动识别图片 → 编辑信息 → 归档 → 写入 → 提交 → 推送 → 跟踪部署 → 验证公开文章
- **批量发布**：一次导入最多 10 篇，逐篇审核、队列排序、每篇独立 Commit、整批一次 Push
- **图片自动处理**：本地图片解析、MIME/SHA-256 校验、PNG/JPEG → WebP、SVG 安全校验
- **原子化安全写入**：事务化写入正式仓库，失败自动回滚，不覆盖未提交修改，绝不 `git add .`
- **GitHub Pages 一键部署**：`gh` 跟踪 Deploy Pages 工作流，验证公开文章可访问

---

## 🧱 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面应用 | Tauri 2 · React 18 · TypeScript · Vite · Rust |
| 公开网站 | Astro 4 · TypeScript · Remark / Rehype · GFM |
| 内容与归档 | Markdown · Front Matter · Archive Profile（YAML，仓库唯一事实来源） |
| 图片处理 | Rust `image`（PNG / JPEG → WebP）、MIME 内容校验 |
| Git 集成 | 本地 `git` + `gh` CLI，远程 / 分支 / HEAD 推送安全检查 |
| 部署 | GitHub Actions（CI + Deploy Pages）→ GitHub Pages |

---

## 📁 项目结构

```
├── apps/
│   ├── desktop/              # Tauri 2 + React 桌面应用
│   │   └── src-tauri/        #   Rust 后端（服务层 + 安全层 + Tauri 命令）
│   └── website/              # Astro 公开网站
├── packages/
│   ├── classification/       # 归档方案推荐与文章信息处理
│   ├── markdown-core/        # Markdown 解析 / 图片引用 / 标题规范化
│   └── desktop-node-adapter/ # 桌面端 Node 适配
├── config/
│   └── archive-profiles.yml  # 归档方案配置（唯一事实来源）
├── content/                  # 已发布文章（写入正式仓库）
├── public/assets/notes/      # 已发布图片（写入正式仓库）
├── fixtures/                 # 测试用 Fixture
└── scripts/                  # 构建 / 冒烟测试脚本
```

---

## 🚀 快速开始

### 环境要求

- Node.js 20+
- pnpm 11+
- Rust stable（含 MSVC toolchain）
- Tauri 2 系统依赖（WebView2、Windows Build Tools）

### 安装依赖

```bash
pnpm install
```

### 浏览器预览（仅验证 React UI）

```bash
pnpm --filter @davinci-journey/desktop dev
```

浏览器预览可读取手动选择的 Markdown 并验证界面；不能访问相邻图片、生成发布工作区或执行 Git 操作。

### Tauri 桌面模式（完整功能）

```bash
pnpm --filter @davinci-journey/desktop tauri:dev
```

桌面模式提供完整本地能力：文件选择、图片解析、工作区生成、仓库写入、Git Stage/Commit、Push、Pages 部署跟踪。

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
- 所有公开文章 `slug` 必须唯一（构建期强制校验，重复即失败并列出冲突文件）
- `publishedAt`（首次发布）与 `gitUpdatedAt`（最近更新）分离：编辑、改名不改变首次发布时间

---

## ✅ 测试与门禁

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
- 桌面安装包：见「打包 Windows 安装包」一节
