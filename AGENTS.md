# AGENTS.md

## 1. 项目身份

### 项目名称

**达芬奇的奇妙之旅**

不要擅自修改、翻译或替换这个名称。

项目定位：

> 一个以 GitHub 仓库为唯一内容源、专门服务程序员站长本人的可视化 Markdown 笔记发布、图片处理、自动归档和静态网站生成工具。

本项目不是：

- 面向普通用户的博客 SaaS；
- 多用户内容平台；
- 社交社区；
- 在线协作文档；
- 以数据库作为文章唯一来源的 CMS。

系统只有两类使用场景：

1. 站长在本地管理工具中上传和发布笔记；
2. 访客在公开网站中浏览、搜索和分享笔记。

------

## 2. 核心产品目标

将传统发布流程：

```text
整理 Markdown
→ 查找关联图片
→ 复制图片
→ 修改图片路径
→ 编写 Front Matter
→ 判断分类
→ 创建目录
→ 移动文件
→ Git Commit
→ Git Push
→ 等待部署
```

简化为：

```text
选择 Markdown
→ 检查系统自动处理结果
→ 点击发布
```

核心验收目标：

- 站长只选择 Markdown 文件；
- 系统自动找到 Markdown 引用的本地图片；
- 自动复制、重命名、压缩并重写图片路径；
- 自动推荐分类、标签、摘要和归档目录；
- 站长通过可视化页面完成最终确认；
- Markdown 与全部资源在一次 Git Commit 中提交；
- Git Push 后由 GitHub Actions 自动部署；
- 公开网站无需登录即可访问。

------

## 3. 技术方案

采用 Monorepo。

推荐技术栈：

### 本地管理工具

- Tauri 2；
- React；
- TypeScript；
- Vite；
- Tailwind CSS；
- Rust 负责文件系统、图片处理和 Git 操作。

### 公开个人网站

- Astro；
- TypeScript；
- Astro Content Collections；
- Remark；
- Rehype；
- Shiki；
- KaTeX；
- Mermaid；
- Pagefind。

### 内容和部署

- Markdown 文件作为内容源；
- GitHub 仓库保存 Markdown、图片、配置和网站代码；
- GitHub Actions 构建和部署；
- 第一版优先支持 GitHub Pages；
- 架构上保留迁移至 Cloudflare Pages 或 Vercel 的可能。

不要为了展示技术复杂度引入：

- 微服务；
- Kubernetes；
- 消息队列；
- 独立文章数据库；
- 多租户系统；
- 复杂账户权限系统。

------

## 4. 推荐仓库结构

```text
da-vinci-journey/
├── AGENTS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── apps/
│   ├── desktop/
│   │   ├── src/
│   │   ├── src-tauri/
│   │   └── package.json
│   └── website/
│       ├── src/
│       ├── public/
│       ├── astro.config.mjs
│       └── package.json
├── packages/
│   ├── markdown-core/
│   ├── content-schema/
│   ├── classification/
│   └── shared/
├── content/
│   ├── ai-agent/
│   ├── rag/
│   ├── llm/
│   ├── backend/
│   ├── engineering/
│   └── uncategorized/
├── public/
│   └── assets/
│       └── notes/
├── config/
│   ├── site.config.ts
│   ├── categories.yml
│   └── classification-rules.yml
├── scripts/
│   ├── validate-content.ts
│   └── check-links.ts
└── .github/
    └── workflows/
        ├── ci.yml
        └── deploy.yml
```

目录可根据框架要求微调，但必须保持：

- 应用代码与笔记内容分离；
- Markdown 和图片可以脱离管理工具独立使用；
- GitHub 仓库始终是内容的最终事实来源；
- 不把文章只保存在 SQLite、PostgreSQL 或浏览器存储中。

------

## 5. 公开网站 UI 规范

### 5.1 固定视觉方向

采用已经确认的 **Apple 极简风**。

设计关键词：

- 极简；
- 留白；
- 专注阅读；
- 轻盈；
- 精致；
- 克制；
- 清晰的信息层级。

禁止：

- 赛博朋克风；
- 大面积霓虹色；
- 复杂渐变；
- 过度玻璃拟态；
- 密集卡片；
- 粗重阴影；
- 花哨粒子动画；
- 为视觉效果牺牲阅读体验。

### 5.2 颜色规范

浅色模式建议：

```text
页面背景：#FFFFFF
次级背景：#F5F5F7
主要文字：#1D1D1F
次要文字：#6E6E73
边框：rgba(0, 0, 0, 0.08)
强调蓝：#0071E3
浅蓝背景：#EAF3FF
```

深色模式建议：

```text
页面背景：#000000
次级背景：#1D1D1F
主要文字：#F5F5F7
次要文字：#A1A1A6
边框：rgba(255, 255, 255, 0.12)
强调蓝：#2997FF
```

强调色只用于：

- 主要按钮；
- 当前导航；
- 链接；
- 标签选中状态；
- 阅读进度；
- 重要状态提示。

### 5.3 字体

使用系统字体栈：

```css
font-family:
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  "PingFang SC",
  "Microsoft YaHei",
  sans-serif;
```

不要在仓库中提交或分发 Apple 的 SF Pro 字体文件。

代码字体使用系统等宽字体栈。

### 5.4 几何和动效

- 普通圆角：12px；
- 主要卡片圆角：16px；
- 大型容器圆角：20px；
- 边框应弱于阴影；
- 阴影必须轻微；
- 动效时长控制在 160～240ms；
- 动效用于反馈状态变化，不用于装饰；
- 支持 `prefers-reduced-motion`。

------

## 6. 公开网站页面

### 6.1 顶部导航

导航栏包含：

- 达芬奇的奇妙之旅；
- 首页；
- 笔记；
- 分类；
- 标签；
- 关于；
- GitHub；
- 搜索；
- 浅色／深色模式切换。

桌面端使用轻微半透明和背景模糊。

移动端使用简洁折叠菜单。

### 6.2 首页

首页结构：

1. 顶部导航；
2. 个人介绍 Hero；
3. 精选笔记；
4. 最近更新；
5. 分类入口；
6. 标签云；
7. 专题合集；
8. 页脚。

默认 Hero 文案可以配置为：

```text
记录 AI Agent、RAG、LLM 应用开发与工程实践
```

辅助文案：

```text
记录在构建智能应用过程中的思考、实验与踩坑，
分享可落地的技术方案与工程经验。
```

Hero 可以保留一个非常克制的浅蓝色抽象球体或轨道图形，但不能抢夺文字注意力。

### 6.3 笔记卡片

卡片展示：

- 分类图标；
- 分类名称；
- 标题；
- 两至三行摘要；
- 发布时间；
- 最后更新时间；
- 预计阅读时间；
- 收藏外观图标，仅用于装饰或本地交互。

卡片布局应轻盈，不要把首页设计成后台仪表盘。

### 6.4 文章详情页

桌面端采用：

```text
左侧或顶部：返回路径和文章信息
中间：Markdown 正文
右侧：文章目录
```

正文最大宽度建议为 720～780px。

文章页包含：

- 面包屑；
- 标题；
- 发布时间；
- 最后更新时间；
- 分类；
- 标签；
- 预计阅读时间；
- 摘要提示块；
- 自动目录；
- 正文；
- 上一篇和下一篇；
- 相关文章；
- 在 GitHub 查看源文件；
- 提交 Issue 或 PR 的入口。

移动端隐藏固定目录，改为可展开目录。

------

## 7. Markdown 展示能力

公开网站必须支持：

- GFM；
- 标题锚点；
- 自动目录；
- 表格；
- 任务列表；
- 脚注；
- 代码语法高亮；
- 代码一键复制；
- 文件名或语言标签；
- Mermaid；
- KaTeX 数学公式；
- 图片标题；
- 图片懒加载；
- 外部链接提示；
- 提示、警告和危险 Callout；
- 阅读进度；
- RSS；
- Sitemap；
- 全文搜索。

所有 HTML 内容都必须经过安全处理。

不得默认执行 Markdown 中的任意 JavaScript。

------

## 8. 本地管理工具 UI

管理工具同样采用 Apple 极简风，但信息密度可以高于公开网站。

主要导航：

- 仪表盘；
- 笔记管理；
- 新建发布；
- 分类管理；
- 标签管理；
- 资源管理；
- 设置；
- 关于。

核心发布流程使用四步进度：

```text
1. 上传文件
2. 内容解析
3. 归档设置
4. 预览与发布
```

### 8.1 上传页面

提供：

- Markdown 拖拽区域；
- 文件选择按钮；
- 批量 Markdown 选择；
- Obsidian Vault 目录配置；
- 最近使用目录；
- 文件解析状态。

### 8.2 归档设置页面

采用四栏或响应式三栏布局：

1. 文件和图片信息；
2. 标题、摘要、分类、标签和 Slug；
3. 可视化目录树；
4. 最终文章预览。

显示：

- Markdown 文件名；
- 检测到的图片数量；
- 图片大小；
- 图片是否存在；
- 自动分类结果；
- 分类置信度；
- 最终保存路径；
- Git 文件变更列表。

### 8.3 发布按钮

主要按钮使用强调蓝色：

```text
发布到 GitHub
```

发布前必须明确展示：

- 新增文件；
- 修改文件；
- 删除文件；
- Markdown 保存位置；
- 图片保存位置；
- Commit Message；
- 目标分支。

------

## 9. Markdown 图片自动处理

这是项目的核心功能，不得降级为普通附件上传。

用户只选择 Markdown 后，系统必须自动解析其中的图片引用。

至少支持：

```markdown
![图片](./images/example.png)
![图片](../assets/example.jpg "标题")
![[example.png]]
![[example.png|800]]
<img src="./images/example.png" alt="示例">
```

同时处理：

- 相对路径；
- 绝对路径；
- Obsidian 引用；
- HTML `img`；
- Base64 图片；
- 网络图片。

### 9.1 本地图片解析

以 Markdown 文件所在目录为基准解析相对路径。

对于 Obsidian：

1. 优先查找 Markdown 同级目录；
2. 查找配置的附件目录；
3. 查找 Vault 全局目录；
4. 多个同名文件时要求人工选择；
5. 找不到文件时明确报错。

### 9.2 图片处理流程

```text
解析 Markdown AST
→ 提取图片节点
→ 定位图片文件
→ 验证文件类型
→ 计算哈希
→ 复制到临时目录
→ 压缩或转换
→ 生成安全文件名
→ 重写 Markdown 图片路径
→ 验证最终引用
```

不要使用简单正则表达式完成全部 Markdown 图片处理。

应优先使用 Markdown AST。

### 9.3 图片保存目录

按文章 Slug 隔离资源：

```text
public/assets/notes/<article-slug>/
```

例如：

```text
public/assets/notes/langgraph-checkpoint/
├── architecture.webp
├── execution-flow.webp
└── state-storage.webp
```

Markdown 中重写为：

```markdown
![Checkpoint 架构](/assets/notes/langgraph-checkpoint/architecture.webp)
```

### 9.4 图片处理规则

- PNG 和 JPG 可转换为 WebP；
- SVG 默认保持原格式；
- GIF 默认保持原格式；
- 保持宽高比；
- 删除不必要的 EXIF；
- 不得让代码截图明显模糊；
- 输出文件名只能使用安全字符；
- 使用内容哈希处理同名冲突；
- 禁止路径穿越；
- 根据文件内容验证 MIME 类型，不能只相信扩展名。

### 9.5 缺失图片

发现缺失图片时默认阻止发布。

显示：

- Markdown 原始引用；
- 推导出的本地路径；
- 所在行号；
- 可选择的修复操作。

允许用户：

- 重新选择图片；
- 删除引用；
- 明确确认忽略。

不得静默忽略缺失图片。

------

## 10. 自动分类和归档

自动分类采用：

```text
已有 Front Matter
→ 固定规则
→ 历史修正记录
→ 可选 AI 推荐
→ 人工确认
```

不要让大模型直接决定最终目录并立即发布。

分类体系：

```text
Category
└── Topic
    └── Tags
```

约束：

- 一篇文章只有一个主分类；
- 可以有一个子主题；
- 可以有多个标签；
- 一级分类控制在合理数量；
- 新分类必须经过站长确认；
- AI 不得自行无限创建相似分类。

推荐初始分类：

- AI Agent；
- RAG；
- LLM；
- Backend；
- Engineering；
- Tools；
- Other。

系统应记录用户对自动分类的修正，并更新本地分类规则。

------

## 11. Front Matter

统一生成以下结构：

```yaml
---
title: "LangGraph Checkpoint 原理与实践"
description: "介绍 LangGraph 状态持久化、线程恢复和断点续跑机制"
category: "AI Agent"
topic: "LangGraph"
tags:
  - "LangGraph"
  - "Checkpoint"
  - "State"
slug: "langgraph-checkpoint"
date: "2026-07-30"
updated: "2026-07-30"
draft: false
featured: false
---
```

规则：

- 保留用户已有且合法的字段；
- 系统生成字段必须允许修改；
- Slug 默认使用英文、小写和连字符；
- Slug 冲突必须提示；
- 日期使用 ISO 格式；
- 不要因为重新发布而覆盖原始发布日期；
- 更新文章时只更新 `updated`。

------

## 12. Git 发布规则

使用用户本机已有 Git 和 GitHub 凭证。

不得：

- 将 Personal Access Token 写进前端代码；
- 将密钥提交到仓库；
- 默认执行 `git add .`；
- 覆盖用户未提交的无关修改；
- 自动强制推送；
- 自动删除未知文件。

发布前检查：

- Git 仓库是否存在；
- 当前分支是否正确；
- 工作区是否存在无关变更；
- 远程仓库是否配置；
- 图片是否全部有效；
- Front Matter 是否通过校验；
- Slug 是否冲突。

只暂存本次发布生成或修改的文件。

Commit 示例：

```text
docs(agent): add langgraph checkpoint note with assets
```

------

## 13. 原子化发布

Markdown、图片和元数据必须：

> 要么一起成功，要么一起失败。

流程：

```text
创建临时工作区
→ 解析和处理 Markdown
→ 处理全部图片
→ 验证最终内容
→ 展示变更
→ 用户确认
→ 移动到正式目录
→ 精确 Git Stage
→ Git Commit
→ Git Push
```

任何步骤失败：

- 不创建不完整提交；
- 尽可能恢复发布前状态；
- 显示具体错误；
- 保留可重试信息；
- 不留下半处理文件。

------

## 14. 安全要求

必须防止：

- Markdown XSS；
- HTML 事件属性注入；
- 危险 URL；
- 路径穿越；
- 任意文件读取；
- 软链接绕过；
- 非图片伪装文件；
- Git 命令参数注入；
- Token 泄露；
- 未经确认的覆盖和删除。

所有文件路径在使用前必须：

1. 规范化；
2. 判断是否位于允许目录；
3. 拒绝越界路径；
4. 验证文件真实类型。

------

## 15. 可访问性和响应式

- 使用语义化 HTML；
- 所有按钮具有可读名称；
- 表单输入具有 Label；
- 键盘可以完成主要操作；
- 焦点状态清晰；
- 颜色对比度符合 WCAG AA；
- 不只使用颜色表达状态；
- 支持 320px 以上屏幕；
- 桌面、平板和手机均不能产生无意义横向滚动；
- 代码块允许局部横向滚动。

------

## 16. 性能目标

公开站点优先静态生成。

目标：

- 首页和文章页尽量不依赖客户端 JavaScript；
- 图片懒加载；
- 图片提供明确宽高，减少布局抖动；
- 搜索索引在构建期生成；
- 避免引入大型 UI 框架；
- Lighthouse Performance、Accessibility、Best Practices、SEO 尽量达到 90 分以上；
- 首屏不得因为非关键动画或远程字体阻塞。

------

## 17. 测试要求

至少编写：

### 单元测试

- Front Matter 解析；
- Slug 生成和冲突；
- Markdown 图片 AST 提取；
- 相对路径解析；
- Obsidian 图片解析；
- 图片重命名；
- 哈希去重；
- 分类规则；
- 路径安全校验。

### 集成测试

- Markdown 和图片完整发布；
- 缺失图片阻止发布；
- 同名图片处理；
- 同名文章更新；
- Git 工作区存在无关修改；
- Commit 失败回滚；
- Push 失败可重试。

### E2E 测试

完整流程：

```text
选择包含图片的 Markdown
→ 自动解析
→ 自动归档
→ 修改分类
→ 预览
→ 发布
→ 检查 Git 变更
→ 检查公开页面
```

每次交付前必须运行适用的：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

不得在测试失败时宣称任务完成。

------

## 18. 开发执行原则

开始修改前：

1. 阅读现有仓库；
2. 检查当前架构；
3. 输出简洁实施计划；
4. 明确将修改的文件；
5. 识别风险；
6. 然后开始编码。

编码过程中：

- 小步修改；
- 每个模块保持单一职责；
- 避免一次生成大量无法审查的代码；
- 不做与当前任务无关的重构；
- 不随意升级依赖；
- 不改变已经确认的产品名称和 UI 风格；
- 不删除暂未理解的代码；
- 优先修复根因，不隐藏错误；
- 所有用户可见错误使用中文；
- 代码标识符使用清晰英文。

------

## 19. 分阶段交付

### Phase 0：项目骨架

- 建立 Monorepo；
- 初始化 Astro；
- 初始化 Tauri + React；
- 配置 TypeScript、Lint、测试和 CI；
- 创建基础内容 Schema。

### Phase 1：公开网站

- 首页；
- 笔记列表；
- 文章详情；
- 分类；
- 标签；
- 深色模式；
- 响应式；
- Apple 极简风基础设计系统。

### Phase 2：本地上传

- 文件选择；
- Markdown 解析；
- Front Matter 编辑；
- 文章预览；
- 保存到内容目录。

### Phase 3：图片处理

- 图片 AST 提取；
- 本地图片定位；
- Obsidian 支持；
- 图片复制和优化；
- 路径重写；
- 缺失图片校验。

### Phase 4：自动归档

- 分类规则；
- 自动标签；
- 摘要；
- Slug；
- 可视化目录树；
- 历史修正学习。

### Phase 5：Git 发布

- Git 状态检查；
- 变更预览；
- 精确 Stage；
- Commit；
- Push；
- 失败回滚；
- GitHub Actions 部署。

### Phase 6：增强能力

- Pagefind；
- RSS；
- Mermaid；
- KaTeX；
- 资源管理；
- 批量导入；
- Obsidian Vault；
- 可选 AI 分类接口。

不要跨过基础阶段直接堆叠 AI 功能。

------

## 20. 完成定义

一个功能只有同时满足以下条件才算完成：

- 功能可以实际运行；
- UI 符合 Apple 极简风；
- 浅色和深色模式正常；
- 手机端可使用；
- 有清晰错误处理；
- 核心逻辑有测试；
- Lint、类型检查和构建通过；
- 没有提交密钥；
- 没有破坏现有笔记；
- README 已更新；
- Codex 能说明改动文件、验证方式和剩余风险。

------

## 21. 每次任务的最终报告格式

完成任务后必须输出：

```text
完成内容
- ...

主要改动
- 文件路径：改动说明

验证结果
- lint：
- typecheck：
- test：
- build：

未完成或已知限制
- ...

建议下一步
- ...
```

不得只回复“已完成”。

------

## 22. 最高优先级约束

发生冲突时按以下顺序处理：

1. 不丢失用户笔记和图片；
2. 不泄露密钥和本地文件；
3. Markdown 与图片原子化发布；
4. GitHub 是内容唯一事实来源；
5. 自动处理结果必须可视化确认；
6. UI 始终保持 Apple 极简风；
7. 优先完成可靠 MVP；
8. 最后才考虑复杂 AI 能力。

# “达芬奇的奇妙之旅”归档与发布交互补充规范

## 1. 归档设计原则

笔记发布时，系统必须让站长明确选择文章的归档位置。

系统可以分析 Markdown 内容并推荐归档方案，但不得在用户未确认的情况下自动创建分类、专题或目录。

归档流程遵循：

```text
系统分析内容
→ 推荐已有归档位置
→ 用户选择或修改
→ 必要时新建分类或专题
→ 预览最终文件路径
→ 确认发布
```

核心原则：

1. 归档推荐只是辅助，不是最终决定；
2. 优先复用已有分类和专题；
3. 不存在合适归档位置时，允许在发布流程中直接新建；
4. 创建新分类前必须检查是否存在名称相似或含义重复的分类；
5. 最终保存位置必须在发布前清晰展示；
6. 用户必须能够修改系统推荐结果；
7. 系统应记录用户修正，用于后续推荐。

------

## 2. 归档层级

统一使用三级内容组织结构：

```text
分类 Category
└── 专题 Topic
    └── 文章 Note
```

标签 Tag 不决定物理目录，只用于跨分类检索和关联。

例如：

```text
AI Agent
├── LangGraph
│   ├── LangGraph Checkpoint 原理与实践
│   └── LangGraph Memory 机制
├── Agent Memory
└── Tool Calling

RAG
├── 混合检索
├── Reranker
└── RAG 评测
```

约束：

- 每篇文章必须选择一个主分类；
- 每篇文章可以选择零个或一个专题；
- 每篇文章可以拥有多个标签；
- 分类数量应保持稳定；
- 专题允许随知识积累逐步增加；
- 标签不创建文件夹；
- 不允许 AI 自动创建大量相近分类。

------

## 3. 归档档案模型

在代码和配置中，将用户可选择的归档位置统一称为：

```text
Archive Profile
```

中文 UI 显示为：

```text
归档方案
```

每个归档方案描述一篇笔记应该保存到哪里，以及默认使用哪些元数据。

建议数据结构：

```ts
interface ArchiveProfile {
  id: string;
  name: string;
  category: string;
  topic?: string;
  directory: string;
  defaultTags?: string[];
  description?: string;
  icon?: string;
  colorToken?: string;
  createdAt: string;
  updatedAt: string;
}
```

示例：

```yaml
id: ai-agent-langgraph
name: AI Agent / LangGraph
category: AI Agent
topic: LangGraph
directory: content/ai-agent/langgraph
defaultTags:
  - AI Agent
  - LangGraph
description: LangGraph 原理、开发实践和问题排查
```

归档方案保存在 GitHub 仓库中，例如：

```text
config/archive-profiles.yml
```

GitHub 仍然是归档配置的唯一事实来源。

------

## 4. 发布流程调整

发布流程调整为五步：

```text
1. 选择 Markdown
2. 检查图片
3. 编辑文章信息
4. 选择归档方案
5. 预览并发布
```

### 第一步：选择 Markdown

用户可以：

- 拖入一个 Markdown 文件；
- 批量选择 Markdown；
- 从配置好的 Obsidian Vault 中选择笔记。

系统读取：

- Markdown 内容；
- Front Matter；
- 标题；
- 本地图片；
- 网络图片；
- 代码语言；
- 关键词；
- 已有分类和标签。

### 第二步：检查图片

系统自动：

- 提取所有图片引用；
- 查找本地图片；
- 显示缺失图片；
- 生成图片处理方案；
- 预览最终图片路径；
- 计算新增和复用资源。

如果存在未处理的缺失图片，默认不允许进入最终发布。

### 第三步：编辑文章信息

用户可以编辑：

- 标题；
- 摘要；
- Slug；
- 标签；
- 发布时间；
- 是否公开；
- 是否精选；
- 是否草稿。

系统可以推荐这些信息，但不能锁定。

### 第四步：选择归档方案

这是发布流程中的必选步骤。

页面顶部显示系统推荐：

```text
推荐归档

AI Agent / LangGraph
匹配度：92%

推荐依据：
- 正文多次出现 LangGraph
- 主要讨论 Checkpoint 和状态恢复
- 与现有 LangGraph 笔记主题相似
```

系统同时展示：

- 推荐归档方案；
- 最近使用；
- 常用归档；
- 全部分类；
- 全部专题；
- 搜索框。

用户可以选择：

```text
AI Agent / LangGraph
AI Agent / Memory
RAG / 工程实践
Backend / Python
其他 / 待整理
```

选择后必须实时显示：

```text
最终保存位置

content/
└── ai-agent/
    └── langgraph/
        └── langgraph-checkpoint.md
```

同时显示图片位置：

```text
public/
└── assets/
    └── notes/
        └── langgraph-checkpoint/
```

------

## 5. 没有合适归档方案时的处理

在归档方案选择页面提供：

```text
＋ 新建归档方案
```

用户不需要退出发布流程进入单独设置页面。

点击后显示一个简洁表单：

```text
归档方案名称
主分类
专题名称
文件目录
默认标签
方案说明
```

用户可以选择两种创建方式。

### 方式一：在已有分类下新建专题

例如：

```text
主分类：AI Agent
新专题：Durable Execution
```

生成：

```text
content/ai-agent/durable-execution/
```

### 方式二：创建新分类

例如：

```text
新分类：AI Infra
新专题：Inference
```

生成：

```text
content/ai-infra/inference/
```

创建新分类时，系统必须先检查：

- 是否存在相同名称；
- 是否存在仅大小写不同的名称；
- 是否存在 Slug 冲突；
- 是否存在含义高度相似的分类；
- 是否与现有专题重复。

如果检测到相似内容，应提示：

```text
发现可能重复的归档方案：

AI Agent / Runtime
AI Engineering / Infrastructure

建议优先使用已有方案。
```

用户仍然可以明确确认创建，但系统不得静默创建。

------

## 6. 新建归档方案的目录规则

目录名称必须：

- 使用小写英文；
- 单词之间使用连字符；
- 禁止空格；
- 禁止中文目录名；
- 禁止路径穿越字符；
- 禁止与保留目录冲突；
- 不允许目录位于 `content` 之外。

例如：

```text
分类名称：AI Agent
分类 Slug：ai-agent

专题名称：Durable Execution
专题 Slug：durable-execution
```

最终路径：

```text
content/ai-agent/durable-execution/
```

系统自动生成 Slug，但用户可以修改。

修改后必须重新校验。

------

## 7. 推荐归档算法

归档推荐采用多层策略：

```text
已有 Front Matter
→ 标题和正文关键词
→ 当前归档规则
→ 用户历史选择
→ 相似文章
→ 可选 AI 推荐
```

推荐优先级：

1. Markdown 已有合法分类；
2. 用户近期对相似文章选择的归档方案；
3. 固定关键词规则；
4. 与已有文章的内容相似度；
5. AI 推荐。

推荐结果至少包含：

```json
{
  "archiveProfileId": "ai-agent-langgraph",
  "confidence": 0.92,
  "reasons": [
    "标题包含 LangGraph",
    "正文重点讨论 Checkpoint",
    "与现有 LangGraph 专题文章相似"
  ],
  "alternatives": [
    {
      "archiveProfileId": "ai-agent-memory",
      "confidence": 0.71
    }
  ]
}
```

不要只输出一个无法解释的分类名称。

------

## 8. 用户修正记录

如果系统推荐：

```text
AI Agent / Memory
```

用户最终选择：

```text
AI Agent / LangGraph
```

系统应记录该次修正。

建议保存到：

```text
config/classification-history.json
```

记录内容：

```json
{
  "noteFingerprint": "sha256...",
  "keywords": [
    "langgraph",
    "checkpoint",
    "state"
  ],
  "suggestedArchive": "ai-agent-memory",
  "selectedArchive": "ai-agent-langgraph",
  "timestamp": "2026-07-30T11:08:00+08:00"
}
```

后续遇到类似内容时，应提高正确归档方案的优先级。

不得将完整私人笔记内容发送给外部模型，除非用户已经明确启用 AI 分类功能。

------

## 9. 归档方案管理页面

管理工具中增加：

```text
归档管理
```

页面包含：

- 分类树；
- 专题列表；
- 每个归档方案的文章数量；
- 最近更新时间；
- 默认标签；
- 文件目录；
- 合并归档方案；
- 重命名；
- 停用；
- 删除。

删除归档方案时：

- 不得直接删除文章；
- 必须先选择文章迁移目标；
- 必须展示受影响文件；
- 必须经过二次确认；
- 必须生成可回滚的 Git Commit。

建议提供：

```text
合并归档方案
```

例如将：

```text
AI Agent / Agent Memory
```

合并到：

```text
AI Agent / Memory
```

系统自动更新：

- Markdown Front Matter；
- 文件目录；
- 分类配置；
- 内部链接；
- 搜索索引。

------

## 10. 归档选择界面规范

归档选择页面继续使用 Apple 极简风。

布局建议：

```text
┌──────────────────────────────────────────────────────────┐
│ 归档方案                                                 │
│ 系统已根据文章内容推荐以下位置                           │
├───────────────────┬──────────────────────────────────────┤
│ 归档方案列表      │ 最终结构预览                         │
│                   │                                      │
│ 推荐              │ content                              │
│ ● AI Agent        │ └── ai-agent                         │
│   └ LangGraph     │     └── langgraph                    │
│                   │         └── checkpoint.md             │
│ 最近使用          │                                      │
│ ○ RAG / 评测      │ 图片资源                             │
│ ○ Backend/Python  │ public/assets/notes/checkpoint/       │
│                   │                                      │
│ ＋ 新建归档方案   │                                      │
└───────────────────┴──────────────────────────────────────┘
```

交互要求：

- 支持搜索；
- 支持键盘选择；
- 显示推荐原因；
- 显示文章数量；
- 显示最终目录；
- 显示目录是否已存在；
- 显示 Slug 冲突；
- 创建新归档后立即自动选中；
- 不需要离开当前发布页面；
- 保留用户已经填写的文章信息。

------

## 11. Front Matter 调整

文章 Front Matter 增加稳定的归档标识：

```yaml
---
title: "LangGraph Checkpoint 原理与实践"
description: "介绍 LangGraph 状态持久化与断点恢复机制"
archiveProfile: "ai-agent-langgraph"
category: "AI Agent"
topic: "LangGraph"
tags:
  - "LangGraph"
  - "Checkpoint"
  - "State"
slug: "langgraph-checkpoint"
date: "2026-07-30"
updated: "2026-07-30"
draft: false
featured: false
---
```

其中：

- `archiveProfile` 是稳定 ID；
- `category` 和 `topic` 用于阅读和兼容；
- 修改分类显示名称时，不应导致文章失去关联；
- 移动目录后必须同步更新 Front Matter；
- 禁止只依赖目录推断分类。

------

## 12. 发布前确认页面

最终发布页面必须展示完整结果：

```text
文章信息
- 标题：LangGraph Checkpoint 原理与实践
- Slug：langgraph-checkpoint
- 状态：公开

归档信息
- 归档方案：AI Agent / LangGraph
- Markdown：
  content/ai-agent/langgraph/langgraph-checkpoint.md

图片资源
- 检测图片：6
- 新增图片：5
- 复用图片：1
- 缺失图片：0
- 保存目录：
  public/assets/notes/langgraph-checkpoint/

Git 变更
- 新增文件：6
- 修改文件：2
- 删除文件：0

Commit
docs(langgraph): add checkpoint guide with assets
```

只有用户点击：

```text
确认并发布到 GitHub
```

才允许执行 Git 操作。

------

## 13. 原子化归档操作

新建归档方案、写入 Markdown、处理图片和更新配置必须属于同一次原子化发布。

同一次 Commit 中应包含：

```text
新增或修改 Markdown
新增或修改图片
更新 archive-profiles.yml
更新分类历史
更新内容索引
```

如果新归档方案创建成功，但 Markdown 或图片处理失败：

- 不得保留不完整归档配置；
- 不得创建正式 Commit；
- 必须恢复到发布前状态。

------

## 14. 更新后的核心发布体验

最终用户体验应为：

```text
选择 Markdown
→ 自动发现全部图片
→ 检查文章信息
→ 选择系统推荐的归档方案
→ 没有合适方案时现场新建
→ 预览文件和图片最终位置
→ 一键发布到 GitHub
```

这个流程比“完全自动归档”更可靠，也比每次手动整理目录更简单。