---
archiveProfile: "ai-agent-langgraph"
category: "AI Agent"
date: "2026-08-04"
description: ""
draft: false
featured: false
slug: "aiagent"
title: "aiagent系统架构设计"
topic: "LangGraph"
updated: "2026-08-04"
tags:
  - "RAG"
  - "Retrieval"
---

aiagent

agent系统架构

client-api gateway-agent service-llm service-tool layer-external system

client：负责将用户输入发送到后端接口，并实时展示agent的回复内容

api gateway：身份认证+权限控制-流量控制和限流-请求路由和转发-具体的agentservice

agent service：prompt构建+推理控制+工具调用

llmservice：模型推理曾，外部大模型api+云端api

toollayer：链接外部能力的关键曾

external sys：最终连接的业务系统，企业数据库，业务服务或第三方api



agent可观测：

logging-记录发生了说明：请求日志，prompt日志，模型响应日志，tool调用日志

tracing-记录事情时如何发生的：任务执行链路，核心是为用户的每一次请求建立一个trace id并记录请求在系统之中的完整执行路径

monitoring：
实时监控系统运行状态

与前两者把不同的地方在于关注的更加整体关注的时系统的整体指标而不是单个请求系统性能指标，模型使用指标，工具调用指标，业务指标



成本控制

token优化：prompt结构，控制对话历史长度，优化rag文档长度

cache：prompt cache，embeding cache，tool cache，推理结果cache

小模型策略：做任务分类，模型路由



稳定性设计：

retry：重试次数限制+指数退避，错误类型判断（网络，参数）

guardrail：行为控制和限制，校验和验证，在模型输出层加入一道安全防线

fallback：模型降级，功能降级