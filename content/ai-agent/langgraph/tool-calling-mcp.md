---
archiveProfile: "ai-agent-langgraph"
category: "AI Agent"
date: "2026-08-04"
publishedAt: "2026-08-04T18:15:03+08:00"
description: ""
draft: false
featured: false
slug: "tool-calling-mcp"
title: "tool calling和mcp"
topic: "LangGraph"
updated: "2026-08-04"
tags:
---

## tool calling

llm：思考+生成文本

可以在此基础上加入调用外部工具完成实际任务的形式

tool schema

为了能让大模型能够正确理解工具结构，系统通常使用shcema来描述tool

主流的描述方式通常基于json schema

核心优势：

能力扩展，系统集成能力，系统化执行+可组合性

一个成熟的agent通常会维护一个tool registry（工具注册表）

function calling：

能够已结构化的方式调用函数和工具

llm输出：**结构化的函数调用指令**

通过functioncalling，大模型可以生成标准化的json调用格式

openai function calling：
函数名称+函数描述+参数定义

避免了-如果时prompt让模型模拟输出调用函数可能不会稳定

但是如果时functioncalling 通过schema约束让模型输出雅阁结构化的调用信息

tool invocation：

解析函数调用提取参数和名称-通过名称和参数数量匹配函数-执行之后返回执行结果-令模型继续推理

## mcp

> 为大模型提供统一的工具，资源和上下文访问协议，使得aiagent能够以标准化的方式访问外部系统

**标准化的能力接口层**

解决问题：

1.统一的工具访问方式

2.统一的资源访问方式

3.统一的上下文管理

架构：

user-ai agent-llm reasoning-mcp client-mcp server-tools/datas/services



