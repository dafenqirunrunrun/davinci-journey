---
archiveProfile: "daily-learning-ai-agent"
category: "Daily Learning"
date: "2026-08-27"
description: ""
draft: false
featured: false
slug: "md"
title: "今日面试准备"
topic: "AI Agent"
updated: "2026-08-27"
tags:
  - "RAG"
  - "Evaluation"
---

## 使用过哪些ai coding工具

我目前 AI Coding 用得最多的是 **Codex 和 Claude Code**，之前也使用过 **Kiro**。

我不会把它们简单理解成“代码补全工具”，我更关注的是它们作为 Coding Agent 的工作方式。实际使用下来，我觉得三者的产品思路差异挺明显。

cc-terminal native agent -用于陌生代码库理解，调用链路分析，复杂的debug等需要多轮推理任务（本质其实是agent loop）-自己通过配置的bash进行搜索代码，读写文件，执行命令跑测试等，然后失败通过observation去迭代修改错误点，本质上是一个完整的agent loop，anthropic本身-agentic coding tool



codex-任务委派+多agent并行处理-主agent委派+subagent执行具体并实时反馈纠正细节



kiro-spec-driven development：
需求-》requirement-design-tasks 接着再让agent去执行，而不是一句prompt直接开始写代码

有steering+hooks+custom agent

强调的点就是如何约束团队工程规范工作。目前kiro已经把ide，cli和web统一到同一个agent harness上面了



coding agent真正进入生产工程以后，核心问题已经不是模型会不会写代码

管理context，规划任务，控制权限，验证结果，怎么让agent遵守工程规范



Claude Code 对我最大的价值不是代码生成，而是让我比较直观地理解了 **Agent Loop 和 Observation-driven Replanning**。

codex-拆任务，给约束，分配agent，review agent



hooks- 可以在某些事件发生时自动执行 Agent prompt 或 shell command

Agent 修改文件
        ↓
PostFileSave Hook
        ↓
自动执行 lint
        ↓
自动执行 test

## AI 工作流

理解任务-建立上下文-规划-小步执行-自动验证-人工review-迭代修正-沉淀上下文



第一步:requirement understanding(需求理解)

明确这到底是一个什么样的任务

确定四件事情

goal-scope（哪些代码哪些函数允许执行和修改）-constraint（约束）-acceptance criteria（验收标准是什么）

第二步：上下文建立-需要ai明确上下文因为上下文错了ai一样会执行错误

为的是避免垃圾代码

==read before write

应该告诉agent：“先不要修改代码，先告诉我相关模块，调用链，现有实现以及你准备修改哪些地方”

第三步：先plan，再coding

复杂任务修改必须要先给一个

implementation plan—任务拆解

第四步：small step execution

edit-test-observe-continue

第五步：agent execution

关键的点就在于-scope control指明修改哪里，不动哪里

防止agent顺手重构

让agent尽量产生最小可验证修改

第五步：验证是整个工作流中最关键的一步

代码规范检查-单元测试-集成测试-实际运行验证



test=agent observation

最后一步：human reviewer

1.判断逻辑正确性

2.架构合理性分析

3.安全性分析

4.edge case

如果失败：

这是刚才的测试结果-分析原因在修改

**一定是先分析原因**



第八步：上下文沉淀

成熟的工作流会将长期规则沉淀下来

cc-claude.md

codex-agents.md

## ai coding喜欢用什么skill？

需求想清楚
    ↓
grill-me / grill-with-docs
    ↓
开发
    ↓
tdd
    ↓
遇到问题
    ↓
systematic-debugging
    ↓
架构变复杂
    ↓
improve-codebase-architecture
    ↓
需要网页实际操作
    ↓
agent-browser
    ↓
前端任务
    ↓
frontend-design / React best practices



grillme-goal+行为+做到哪（scope）+约束+边界情况考虑+什么叫做成功

确定spec



几万行代码

grill with docs-主动读取现有代码+领域上下文+adr（架构决策记录）

> `grill-me` = **把人的需求问清楚**

> `grill-with-docs` = **把需求和现有系统对齐**



tdd：test-driven-develop（测试驱动开发）



小目标
↓
小修改
↓
立即验证
↓
再继续



`improve-codebase-architecture`：我不会天天用，但大型项目非常有价值

## 如果做前端，我会装 `frontend-design`

Anthropic 官方的：

> **frontend-design**

我也会考虑。

因为模型写前端一个非常著名的问题就是：

### AI Slop（千篇一律的 AI 风格）

你应该见过：



```
白色背景
+
紫色渐变
+
大圆角卡片
+
Inter字体
+
三个feature card
```



一看就是 AI 做的。

`frontend-design` 的核心就是主动打破这些默认审美模式，让 Agent 在写代码前先选择：



```
Visual Direction
视觉方向

Typography
字体体系

Spatial Composition
空间布局

Motion
动效

Texture
质感
```

如果项目是 React / Next.js，我还会结合：

> **vercel-react-best-practices**

Vercel 当前这个 Skill 包含约 70 条 React / Next.js 性能规则

`find-skills` 是 Vercel Labs 做的，它的作用就是：

> 当 Agent 碰到一个自己不擅长的领域时，先去现有 Skill 生态里找有没有成熟 Skill，而不是每次都自己现编 Prompt。

如何理解goal工程？

Objective
目标
Metric
指标
Constraint
约束
Acceptance Criteria
验收标准
Stop Condition
停止条件

今日面试复盘：

你们 DR 有没有做 FT？

在 DeepResearch 这个项目里，我们主链路并没有把 Fine-tuning（模型微调）作为核心优化手段，所以我不会说我们实际上完成了一个生产级的 SFT/LoRA 训练方案。

当时系统的主要瓶颈更多集中在 Agent 编排、搜索召回、RRF 融合、JSON 结构化输出稳定性、Checkpoint 和 Critic 等工程环节，所以我们优先通过 Prompt、RAG、Workflow 和 Eval 解决问题。

但是如果现在让我继续优化这个系统，我会先做 Error Attribution（错误归因），判断问题到底来自 Planner、Search、Retriever、Writer 还是 Critic，而不会一上来就 Fine-tune。

如果发现一些稳定重复的模型行为仍然通过 Prompt 难以解决，我会优先考虑对 Planner/Router 和 Query Generation 做 SFT（监督微调）。因为任务拆解、路由、结构化输出和搜索 Query 生成都有比较明确的输入输出，可以从 Agent Trace（智能体轨迹）里筛选高质量样本形成训练集。

框架上如果是快速实验，我会先用 LLaMA-Factory 跑 LoRA/QLoRA；如果需要更细粒度地控制训练和评测，我会用 Hugging Face Transformers + PEFT + TRL。PEFT负责 LoRA 这种参数高效微调，TRL负责 SFT、DPO 等后训练流程。

后续如果 Critic 已经积累了大量优质/劣质回答对，我还会考虑使用 DPO（直接偏好优化），让模型学习“什么样的研究回答更值得偏好”。

但我认为 DR 做 FT 最关键的不是选什么框架，而是构建可靠的数据飞轮：Agent 在线产生 Trace → Eval 筛选 → 人工/规则/强模型校验 → 构建 SFT 或 Preference Dataset → Fine-tune → 再做端到端评测。只有最终 Task Success、Citation Accuracy、Recall 和成本等指标真正改善，我才会认为这个 FT 是有效的。

