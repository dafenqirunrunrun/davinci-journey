---
archiveProfile: "ai-agent-langgraph"
category: "AI Agent"
date: "2026-08-04"
publishedAt: "2026-08-04T18:14:56+08:00"
description: ""
draft: false
featured: false
slug: "langgraph-agent"
title: "agent 框架"
topic: "LangGraph"
updated: "2026-08-04"
tags:
  - "AI Agent"
  - "LangGraph"
---

## langchain

提供了一整套围绕大语言模型构建的应用基础组件：

prompt管理，chain编排，agent推理，工具调用和记忆机制等能力

核心模块：

llm layer：是llm本身，例如gpt，claude或开源模型。llm负责理解自然语言理解，推理和文本生成

prompt layer：prompt用于控制模型行为。langchain提供prompttemplate等工具，使得prompt可以被参数化和复用从而提高系统的可维护性

chain layer：任务流程的编排机制

tool layer：用于链接外部能力

agent layer：自主选择需要调用tool，并规划执行步骤



### chain

llmchain：最基础的-prompt+llm调用

sequential chain：用于执行多个连续步骤

router chain：根据输入内容选择不同的处理路径

技术问题，客服问题



### agent

chain是固定流程-agent是动态决策系统

关键能力-任务理解，工具选择，步骤规划，结果整合



### tool

agent扩展核心

大模型本身无法访问互联网

name+description+function

（真正执行任务的代码）



**缺点：状态管理与复杂流程控制方面存在一定限制**



## LangGraph

条件分支，循环执行，状态更新和多个阶段推理chain无法做



**用图结构来描述ai工作流**

组成结构：

state graph：

node代表任务步骤

edge表示执行路径

state代表当前上下文

再langgraph中映入一个重要机制

Durabe execute



## AutoGpt

早期最具有代表性的自主智能体框架



**用户只需要给出目标，ai就会自动思考并完成任务**

在整个过程中，agent会不断自我规划并执行任务

用户不需要干预，agent会不断自主规划并执行任务

#### 架构

goal：

用户首先为agent 设定一个或多个目标。

task planning：

收到目标之后，会进行任务拆解，将一个复杂任务分解为多个子任务

memory：

通常包括短期记忆和长期记忆

短期记忆用于保存当前任务上下文

长期记忆通常位于向量数据库用于存储历史信息

tool use：

调用外部工具

action loop：
采用循环推理机制

thought-th-usetool-observation-think----

thought-action-observation



核心：autonomou agent

目标驱动-自主规划-持续执行-反思自我修正



## crewai

单个agent在处理复杂任务时往往存在能力边界



**通过多个agent分工协作来完成复杂任务**-**称之为multi-agent-system**

将一个复杂任务给一组专业团队-多个扮演不同角色的agent，通过协作完成整体目标



核心：multi-agent协作机制

研究院agent-写作agent-编辑agent-审校agent



role-base agent

给与每个agent一个明确的角色

包含一下信息：

角色名称+角色目标+角色能力+角色工具

