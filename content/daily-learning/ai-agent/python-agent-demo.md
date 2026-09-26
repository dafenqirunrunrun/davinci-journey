---
archiveProfile: "daily-learning-ai-agent"
category: "Daily Learning"
date: "2026-09-26"
description: ""
draft: false
featured: false
slug: "python-agent-demo"
title: "Python + Agent 项目：从 Demo 到上线，再到线上事故排查与复盘"
topic: "AI Agent"
updated: "2026-09-26"
tags:
  - "Backend"
  - "Python"
---

> 适用场景：Python / FastAPI / AI Agent / DeepResearch / RAG / SSE / 长任务系统  
> 核心目标：把“能跑的 Demo”变成“可上线、可观测、可恢复、可扩容、可排障”的生产系统。

---

# 第一部分：从 Demo 到生产上线

## 1. 先明确：Demo 和生产系统的区别

Demo 只需要证明：

- 功能能跑通
- 模型能返回结果
- 页面能展示
- 单用户测试正常

生产系统还必须保证：

- 多用户同时使用不会把服务打挂
- 单个任务失败不会拖垮整个系统
- 服务重启后任务状态不丢
- 模型超时、限流、返回异常时可以恢复
- 数据库、线程池、队列、内存都有容量边界
- 线上问题发生后可以快速定位
- 新版本出现问题可以快速回滚

一句话：

> Demo 关注“能不能跑”，生产关注“坏了以后怎么办”。

---

## 2. 推荐的生产级长任务架构

长程 Agent 不建议让一个 HTTP 请求一直等待几分钟。

推荐架构：

```text
用户
  ↓
API 网关
  ↓
任务创建接口
  ↓
立即返回 task_id
  ↓
任务队列
  ↓
Agent Worker
  ↓
Planning / Research / Analysis / Writing / Review
  ↓
阶段状态持久化
  ↓
SSE 推送进度
  ↓
前端展示
```

其中：

- `task_id`：任务唯一标识
- `Worker`（工作进程）：真正执行长任务的后台进程
- `SSE`（Server-Sent Events，服务端事件推送）：服务端持续向浏览器推送任务进度
- `Checkpoint`（检查点）：保存任务已经执行到哪个阶段，方便失败恢复
- `Queue`（任务队列）：负责排队，不让所有任务同时冲进执行层

不要这样：

```text
POST /research
  ↓
等待 2 分钟
  ↓
最后一次性返回完整报告
```

因为浏览器、网关、反向代理、负载均衡、服务进程任意一层超时，都可能导致任务失败。

---

## 3. 上线前第一件事：任务生命周期设计

长任务必须有明确状态。

例如：

```text
PENDING      等待执行
PLANNING     规划中
RESEARCHING  调研中
ANALYZING    分析中
WRITING      写作中
REVIEWING    审核中
COMPLETED    完成
FAILED       失败
CANCELLED    已取消
PAUSED       已暂停
```

数据库至少保存：

```text
task_id
session_id
user_id
current_stage
status
created_at
updated_at
error_code
retry_count
checkpoint
```

生产级要求：

> 任务状态不能只放在 Python 进程内存里。

否则：

```text
服务重启
→ 内存状态全部丢失
→ 用户任务消失
```

正确做法：

```text
任务执行
→ 每完成关键阶段
→ 写入数据库 Checkpoint（检查点）
→ 服务重启
→ 从最近成功阶段继续
```

---

## 4. 任务和前端连接必须解耦

必须明确：

> SSE 连接生命周期 ≠ 任务生命周期。

用户刷新网页：

```text
SSE 断开
```

但是后台任务应该继续执行。

刷新后：

```text
task_id / session_id
→ 重新查询任务状态
→ 重新订阅 SSE
```

不能出现：

```text
浏览器刷新
→ 后台任务也被取消
```

---

## 5. 上线前必须建立分层超时

不能只写一个 `timeout=30`。

至少需要：

```text
HTTP 请求超时
LLM 调用超时
Web Search 超时
RAG 检索超时
数据库操作超时
Tool 调用超时
Sandbox 沙箱执行超时
整个 Research Task 总超时
```

例如：

```text
单次 LLM 调用：60 秒
Web Search：20 秒
Tool：30 秒
完整任务：10 分钟
```

具体数字要通过实际压测确定。

生产级原则：

> 任何步骤都不能无限等待。

---

## 6. 给 Agent 设置执行预算

Agent 最危险的问题之一是：

```text
没找到答案
→ 再搜
→ 再分析
→ 再调模型
→ 再搜
→ 无限循环
```

所以至少要限制：

- `max_iterations`（最大迭代次数）
- 最大 LLM 调用次数
- 最大 Token 数
- 最大任务总耗时
- 最大任务成本

例如：

```text
最多 20 个步骤
最多 15 次 LLM 调用
最多 100k Token
最多执行 10 分钟
```

超限后不要直接崩溃，可以：

```text
达到预算
→ 停止继续扩展
→ 基于已有证据生成 best-effort report（尽力而为的报告）
```

---

## 7. 做并发容量测试

生产上线前不能凭感觉说：

> 支持 20 并发。

应该真实压：

```text
1 并发
5 并发
10 并发
20 并发
```

同时观察：

- P50（50% 请求完成时间）
- P95（95% 请求完成时间）
- P99（99% 请求完成时间）
- 成功率
- CPU
- RSS（Resident Set Size，进程实际驻留物理内存）
- 数据库连接池
- 线程池
- 任务队列长度
- LLM 错误率
- LLM 429 限流次数

---

## 8. 一定要有背压

`Backpressure`（背压）指：

> 下游处理不过来时，不允许上游无限塞任务。

例如：

```text
最大同时运行任务 = 10
```

那么：

```text
前 10 个：执行
第 11～50 个：排队
队列满了：拒绝新任务 / 返回系统繁忙
```

绝不能：

```text
请求来多少
→ 全部创建后台任务
→ 内存、线程、数据库、LLM 一起爆
```

---

## 9. 做资源隔离

不要让完全不同的任务共用一个无限制资源池。

例如：

```text
LLM
Embedding
Sandbox
```

如果全部共用一个 `ThreadPoolExecutor`（线程池执行器）：

```text
Sandbox 卡死
→ 线程被占住
→ LLM 也拿不到线程
→ 全站越来越慢
```

生产级更合理：

```text
LLM：异步 I/O
Embedding：独立 Worker / GPU
Sandbox：独立进程或容器
数据库：独立连接池
```

原则：

> 一类任务失控，不应该拖死其他任务。

---

## 10. 做数据库连接生命周期管理

Agent 长任务最容易写出：

```python
db = get_session()

query()

await llm_call()

await web_search()

db.close()
```

这意味着：

> 调 LLM 和 Web Search 的几十秒里，数据库连接一直被占着。

并发一高，连接池很快满。

正确做法：

```text
需要数据库
→ 拿连接
→ 快速查 / 写
→ commit
→ 立即释放
→ 再调用 LLM / HTTP
```

原则：

> 不要跨慢 I/O 持有数据库连接和事务。

---

## 11. 上线前必须做可观测性

每个任务统一携带：

```text
trace_id
request_id
task_id
session_id
user_id
```

其中：

- `trace_id`（链路追踪标识）：串起整条调用链
- `request_id`（请求标识）：定位某一次 HTTP 请求
- `task_id`：定位某个长任务
- `session_id`：定位某个会话

建议记录每个阶段耗时：

```text
planning_duration
research_duration
rag_duration
analysis_duration
writing_duration
review_duration
queue_wait_time
db_pool_wait_time
llm_duration
```

还应记录：

```text
llm_calls
token_count
source_count
retry_count
queue_length
running_tasks
rss
cpu
db_pool_checked_out
```

---

## 12. 上线前做故障注入

`Fault Injection`（故障注入）：

> 主动把某个依赖搞坏，看系统是否能正确处理。

至少测试：

### LLM 故障

```text
429
500
Timeout
```

看是否：

```text
有限重试
→ 指数退避
→ 降级
→ 最终失败可恢复
```

### Web Search 故障

```text
Web Search 挂掉
→ Local RAG 是否还能继续
```

### Worker 被杀

```text
Research 执行到一半
→ kill worker
→ 重启
→ 是否从 checkpoint 恢复
```

### SSE 断开

```text
浏览器刷新
→ 后台任务是否继续
→ 是否能重新订阅
```

### 数据库短暂异常

看是否：

```text
连接失败
→ 快速失败
→ 不无限阻塞
```

---

## 13. 上线前 Release Gate

`Release Gate`（发布门禁）：

> 达到全部关键条件后，版本才允许进入生产。

### 功能

- 核心流程 E2E（End-to-End，端到端测试）通过
- RAG 检索正确
- Citation（引用）正确
- Cancel / Resume（取消 / 恢复）通过

### 数据

- 数据库迁移通过
- 数据库备份通过
- 恢复演练通过

### 安全

- Secret Scan（密钥扫描）通过
- tenant_id 租户隔离通过
- ACL（Access Control List，访问控制）通过

### 稳定性

- timeout 超时策略通过
- retry 重试策略通过
- budget 预算控制通过
- Worker 重启恢复通过

### 性能

- 目标并发测试通过
- CPU 在安全范围
- RSS 不持续增长
- 数据库连接池不爆
- 队列长度可控

### 运维

- 日志完整
- 监控完整
- 告警完整
- 回滚方案可用

存在 P0（最高优先级严重问题）：

> 不上线。

---

## 14. 正式上线不要直接全量

建议：

```text
开发环境
→ 测试环境
→ 预发布环境
→ Canary（金丝雀灰度）
→ 小流量
→ 扩大流量
→ 全量
```

每一步观察：

```text
成功率
P95
CPU
RSS
队列
DB Pool
LLM 429
错误率
```

如果指标异常：

```text
停止继续放量
→ 回滚
```

---

# 第二部分：线上事故排查总范式

所有事故统一先问：

```text
1. 影响范围是什么？
2. 是所有用户还是部分用户？
3. 是所有接口还是某个接口？
4. 是突然发生还是逐渐恶化？
5. 是在算、在等，还是在排队？
6. 出问题前 1～5 分钟发生了什么？
```

统一排障口诀：

> 接口慢：时间花在哪？  
> CPU 高：谁在一直算？  
> OOM：谁占着内存不放？  
> 死锁：谁拿着资源在等谁？  
> DB Pool 满：连接是没还、拿太久，还是借的人太多？  
> 慢 SQL：数据库到底扫描了多少数据？  
> 进程挂了：到底是谁把它杀掉了？

---

# 第三部分：线上接口响应慢

## 1. 第一原则：先拆耗时

接口总耗时：

```text
总耗时
=
网关等待
+ Queue Wait（队列等待）
+ Python 执行
+ DB Pool Wait（数据库连接池等待）
+ SQL
+ Redis
+ RAG
+ LLM
+ Web Search
+ JSON 序列化
+ 网络
```

例如：

```text
总耗时       5.2s
Auth         20ms
DB           30ms
RAG          80ms
LLM          4.9s
JSON         30ms
```

结论：

> LLM 慢，不是 FastAPI 慢。

再例如：

```text
总耗时       5s
Queue Wait   4.5s
执行         500ms
```

结论：

> Worker / 线程池饱和。

---

## 2. 先判断是全局慢还是单接口慢

如果所有接口一起慢：

优先查：

```text
CPU
RSS
Event Loop（事件循环）
线程池
数据库连接池
网络
```

如果只有某个接口慢：

优先查该接口调用链。

---

## 3. 判断是在算还是在等

### CPU 高

说明可能在：

```text
死循环
Embedding
Rerank
JSON 序列化
正则
大量 Python 计算
```

使用：

```text
py-spy
Flame Graph（火焰图）
```

找热点函数。

### CPU 不高但接口慢

优先查：

```text
线程池等待
数据库连接池等待
锁等待
任务队列
LLM
RAG
Web Search
外部 HTTP
```

---

## 4. FastAPI 特别注意同步阻塞

错误：

```python
async def handler():
    requests.get(url)
```

`requests` 是同步阻塞库。

会导致：

```text
事件循环被卡
→ 其他请求一起变慢
```

更合理：

```python
await httpx.AsyncClient().get(url)
```

CPU 重任务放独立 Worker。

---

## 5. 修复思路

按根因修：

| 根因 | 修复 |
|---|---|
| LLM 慢 | timeout、重试、并发限制、模型降级 |
| Queue 等太久 | 扩 Worker、限流、有界队列 |
| Event Loop 阻塞 | 换异步 I/O，重计算移出事件循环 |
| Thread Pool 满 | 资源隔离、缩短任务占用 |
| DB Pool 满 | 缩短连接生命周期 |
| 大 JSON | 减字段、分页、按需返回 |
| Rerank 太重 | 限 TopK、批处理、独立 Worker |

---

# 第四部分：CPU 飙高

## 1. 排查流程

```text
CPU 告警
→ 看是哪台机器
→ 看哪个进程
→ 看 user / system / iowait
→ 看和并发量是否相关
→ 找具体 Python 热点函数
→ 关联 task_id
→ 修复
→ 压测验证
```

### CPU 类型

- `user`：应用计算
- `system`：系统调用较多
- `iowait`：大量等待磁盘 I/O

---

## 2. 常见 Agent 根因

### Agent 死循环

```python
while not finished:
    execute_step()
```

状态永远不结束。

修复：

```text
max_iterations
task_timeout
token_budget
cost_budget
```

### Busy Waiting（忙等）

错误：

```python
while True:
    check_status()
```

正确：

```python
await asyncio.sleep(...)
```

或改成事件通知。

### Rerank 太重

错误：

```text
2000 chunks
→ 全部 CrossEncoder
```

修：

```text
BM25 / Dense 召回
→ RRF 融合
→ Top 20
→ CrossEncoder
→ Top 5
```

### Embedding 回退 CPU

如果 GPU 异常后自动落到 CPU：

```text
GPU 利用率 0
CPU 95%
Embedding 延迟暴涨
```

修：

```text
恢复 GPU
限制 CPU fallback
独立 Embedding 服务
```

### SSE 事件过密

错误：

```text
1 token
→ 1 次 JSON 序列化
→ 1 次 SSE
```

修：

```text
多个 token buffer（缓冲）
→ 批量发送
```

### 日志过重

不要反复打印：

```text
完整 ResearchState
完整 Prompt
完整 LLM Response
```

改为结构化摘要。

---

## 3. 工具

Python 常用：

```text
top
htop
pidstat
py-spy
Flame Graph（火焰图）
```

---

## 4. 修复后验证

至少压：

```text
1
5
10
20 并发
```

观察：

```text
CPU
P95
成功率
队列等待
```

---

# 第五部分：OOM / 内存持续增长

`OOM`（Out Of Memory，内存不足）不是根因，而是最终结果。

核心问题：

> 谁在涨？为什么不释放？

---

## 1. 先确认是否真 OOM

Docker / Kubernetes 看：

```text
Exit Code
OOMKilled
```

Linux：

```bash
dmesg | grep -i oom
```

不要把所有“进程挂了”都叫 OOM。

---

## 2. 看 RSS 趋势

### 峰值型

```text
1.2GB
1.3GB
1.4GB
7.8GB
OOM
```

通常是：

```text
超大文件
大量 chunk
大批 embedding
超长 context
大 JSON
```

### 泄漏型

```text
1.2GB
1.5GB
1.8GB
2.2GB
2.8GB
```

任务结束后内存不回落。

通常是：

```text
对象引用未释放
无界缓存
无界队列
listener 未清理
session registry 未删除
```

### 并发放大型

单任务：

```text
300MB
```

20 并发：

```text
6GB
```

这不一定是泄漏，而是：

`Working Set`（工作集）过大。

修复：

```text
限并发
排队
背压
```

---

## 3. Agent 里重点查

```text
ResearchState
sources
chunks
messages
evidence
SSE events
LLM context
embedding cache
session registry
asyncio.Queue
listener
```

---

## 4. 阶段打点

记录：

```text
start
planning
research
rag
analysis
writing
review
finish
```

每一步 RSS。

例如：

```text
start          800MB
planning       850MB
research      1650MB
analysis      1700MB
writing       1720MB
```

说明主要增长发生在 Research。

继续拆：

```text
search
web_fetch
rag
embedding
rerank
evidence
```

---

## 5. Python 对象级排查

使用：

`tracemalloc`（Python 内存分配追踪工具）

思路：

```text
Snapshot A
→ 执行任务
→ Snapshot B
→ 比较差异
```

找出：

```text
哪个文件
哪一行
哪类对象
```

增长最多。

---

## 6. 常见修复

### 无界事件历史

错误：

```python
event_history.append(event)
```

永远追加。

修：

```python
deque(maxlen=1000)
```

### 无界队列

错误：

```python
asyncio.Queue()
```

修：

```python
asyncio.Queue(maxsize=1000)
```

队列满后：

```text
producer 等待
```

这就是背压。

### Cache 无上限

修：

```text
LRU（最近最少使用缓存）
TTL（过期时间）
max_size
```

### Session / Listener 未清理

任务结束后：

```text
unsubscribe
del registry[task_id]
close event source
```

---

## 7. 如果 RSS 高但 tracemalloc 看不到

说明可能是：

`Native Memory`（本地内存，C/C++ 扩展分配的内存）

例如：

```text
NumPy
PyTorch
FAISS
Tokenizer
CUDA
BLAS
```

这时不能只盯 Python GC。

---

## 8. 验证

### 单任务重复

连续跑 50 次。

理想趋势：

```text
每次任务涨一点
→ 结束后基本回落
```

### 并发压测

```text
1
5
10
20 并发
```

看 Peak RSS（峰值内存）。

### Soak Test（长时间稳定性测试）

持续：

```text
2 小时
6 小时
24 小时
```

观察内存是否持续爬升。

---

# 第六部分：死锁 / 假死

首先区分：

> 真死锁，还是线程池、连接池、队列耗尽导致的假死。

---

## 1. 典型现象

```text
接口一直不返回
SSE 不继续
CPU 不一定高
进程还活着
```

先查：

```text
CPU
线程状态
Thread Pool
DB Pool
锁等待
Queue
```

---

## 2. 真死锁

例如：

```text
线程 A：
拿锁 A
→ 等锁 B

线程 B：
拿锁 B
→ 等锁 A
```

形成环。

---

## 3. Agent 项目常见假死

### 线程池耗尽

```text
12 个 worker
全部被 LLM / Sandbox / Embedding 占住
→ 后续任务全部等
```

这不是死锁，是：

`Thread Pool Starvation`（线程池饥饿）

修：

```text
资源隔离
LLM 异步化
Sandbox 独立
有界队列
背压
```

### DB Pool 耗尽

拿连接后去调 LLM：

```text
DB Connection
→ 等 LLM 30s
→ 连接一直不还
```

修：

```text
DB 操作完立即释放连接
```

---

## 4. 真死锁怎么修

### 统一加锁顺序

例如统一：

```text
task_lock
→ checkpoint_lock
→ event_lock
```

所有地方都按同样顺序。

### 缩小锁范围

错误：

```python
with lock:
    await llm_call()
    await web_search()
```

正确：

```python
result = await llm_call()

with lock:
    update_state(result)
```

原则：

> 持锁期间不做慢 I/O。

### 加超时

不要无限：

```python
lock.acquire()
```

应该允许 timeout。

超时后记录：

```text
lock_name
owner
wait_time
task_id
stack
```

---

## 5. 线上已卡死时

不要第一时间直接重启。

先：

```text
停止新流量
→ dump 线程栈
→ 记录 CPU / RSS / ThreadPool / DB Lock
→ 保存日志
→ 再重启恢复
```

否则现场消失。

---

# 第七部分：MySQL 连接池爆满

核心问题：

> 连接是借了不还、拿得太久，还是借的人太多？

---

## 1. 先区分两件事

### 应用连接池满

例如：

```text
pool_size = 10
max_overflow = 5
checked_out = 15
```

但 MySQL：

```text
Threads_connected = 30
max_connections = 200
```

说明：

> 应用池自己满了。

### MySQL 自身连接数满

```text
Threads_connected = 198
max_connections = 200
```

说明整个数据库快撑爆。

---

## 2. 常见原因

### 连接泄漏

忘记 close。

修：

```python
try:
    ...
finally:
    db.close()
```

或：

```python
with Session() as db:
    ...
```

### 跨 LLM 持连接

错误：

```python
db = Session()
query()
await llm_call()
db.close()
```

修：

```text
查 DB
→ 释放
→ 调 LLM
→ 再拿连接写结果
```

### 长事务

不要：

```text
BEGIN
→ DB
→ LLM 30s
→ Web Search
→ COMMIT
```

应该拆成多个短事务。

### 慢 SQL

SQL 运行越久，连接占用越久。

### 并发突增

不要直接把 `pool_size` 从 10 调到 100。

因为：

```text
实例数
× Worker 数
× pool_size
```

才是真正可能连接数。

---

## 3. MySQL 侧排查

常用：

```sql
SHOW FULL PROCESSLIST;
```

重点看：

```text
Sleep
Query
Locked
Time
State
```

还可以：

```sql
SHOW STATUS LIKE 'Threads_connected';
SHOW VARIABLES LIKE 'max_connections';
```

---

## 4. 一定区分三段时间

```text
DB 总耗时
=
pool wait
+
SQL execution
+
transaction time
```

例如：

```text
pool wait = 4s
SQL = 20ms
```

这不是慢 SQL，是连接池问题。

---

## 5. 修复原则

```text
缩短连接生命周期
缩短事务
保证连接归还
优化慢 SQL
控制 Agent 并发
合理设置 pool_size
设置 pool_timeout
监控 pool wait
```

---

# 第八部分：慢 SQL

核心问题：

> SQL 为什么需要扫描这么多数据？

---

## 1. 标准流程

```text
接口慢
→ 确认 SQL 真慢
→ 慢查询日志 / APM 定位 SQL
→ EXPLAIN / EXPLAIN ANALYZE
→ 看扫描行数
→ 看索引
→ 修 SQL
→ 再验证
```

`EXPLAIN`（执行计划）：

> 查看数据库准备怎么执行这条 SQL。

`EXPLAIN ANALYZE`：

> 不只看计划，还实际执行并显示真实耗时和行数。

---

## 2. 没索引

例如：

```sql
SELECT *
FROM research_events
WHERE session_id = ?
ORDER BY created_at DESC;
```

修：

```sql
CREATE INDEX idx_session_created
ON research_events(session_id, created_at DESC);
```

如果查询条件和排序经常一起使用：

> 考虑联合索引。

---

## 3. 索引失效

错误：

```sql
WHERE DATE(created_at) = '2026-09-26'
```

修：

```sql
WHERE created_at >= '2026-09-26 00:00:00'
AND created_at < '2026-09-27 00:00:00'
```

原则：

> 尽量不要对索引列做函数、计算和隐式类型转换。

---

## 4. SELECT * 太多

Agent 数据里可能包含：

```text
raw_payload
prompt
response
metadata
full_context
```

不要全部查。

只查真正需要字段。

---

## 5. N+1

错误：

```python
tasks = query_tasks()

for task in tasks:
    task.events
```

可能变成：

```text
1 次 task 查询
+
N 次 event 查询
```

修：

```text
eager loading（预加载）
join
批量查询
```

---

## 6. 深分页

错误：

```sql
LIMIT 20 OFFSET 1000000
```

修：

`Cursor Pagination`（游标分页）：

```sql
WHERE id > last_id
ORDER BY id
LIMIT 20
```

---

## 7. Join 太重

修：

```text
Join Key 建索引
减少不必要 Join
复杂查询拆分
预计算
缓存
```

---

## 8. ORDER BY / GROUP BY 太重

修：

```text
缩小数据范围
索引
预聚合
物化结果
缓存
```

---

## 9. IN 太长

例如：

```text
IN 10000 个 id
```

可改：

```text
分批
临时表
重新设计查询
```

---

## 10. 慢 SQL 修复总表

| 问题 | 修复 |
|---|---|
| 全表扫描 | 建索引 |
| 索引失效 | 去函数、去隐式类型转换 |
| 返回列太多 | 不用 SELECT * |
| 返回行太多 | LIMIT / 分页 |
| 深分页 | 游标分页 |
| N+1 | 预加载 / Join / 批量 |
| Join 慢 | Join Key 建索引 |
| 排序聚合慢 | 索引 / 预聚合 |
| IN 太多 | 分批 / 临时表 |
| 锁等待 | 缩短事务 |
| DB Pool Wait | 缩短连接持有时间 |

---

# 第九部分：进程突然异常退出

首先问：

> 进程是真的退出了，还是进程还活着但服务不响应？

---

## 1. 进程已退出

看：

```text
Exit Code
OOMKilled
日志
系统事件
```

常见：

| Exit Code | 含义 |
|---|---|
| 0 | 正常退出 |
| 1 | 应用异常 |
| 137 | SIGKILL，常见于 OOM |
| 139 | Segmentation Fault（段错误） |
| 143 | SIGTERM，平台正常终止 |

注意：

> 137 不一定就是 OOM，必须结合 OOMKilled / 系统日志确认。

---

## 2. OOM

进入前面的 OOM 范式。

---

## 3. Python 未捕获异常

查：

```text
Traceback
Exception
Error
Fatal
```

Kubernetes 中如果容器已经重启，要看 previous logs（上一个容器日志）。

---

## 4. Native Crash

Python 项目里如果使用：

```text
PyTorch
FAISS
NumPy
CUDA
Tokenizer
```

底层 C/C++ 也可能崩。

如果 Exit 139：

> 优先怀疑 native extension（本地扩展）。

可以开启：

```python
faulthandler
```

需要时分析 core dump（核心转储）。

---

## 5. 被平台主动重启

可能是：

```text
滚动发布
节点迁移
健康检查失败
人工 kill
```

所以看：

```text
Kubernetes Events
Restart Count
Liveness Probe
Readiness Probe
```

---

## 6. 健康检查导致重启

例如：

```text
线程池全部耗尽
→ /health 也响应不了
→ liveness probe 失败
→ Kubernetes 重启容器
```

用户看到：

> 进程突然挂了。

真实链路：

> 线程池耗尽 → 健康检查失败 → 平台重启。

---

## 7. 进程还活着但不响应

### CPU 高

进入 CPU 排查。

### CPU 低

重点查：

```text
死锁
线程池
DB Pool
Queue
Event Loop
下游等待
```

---

## 8. 看死亡前 1～5 分钟

真正有价值的是：

```text
CPU
RSS
QPS
running_tasks
queue_length
DB pool
LLM error
```

例如：

```text
22:00 CPU 30%
22:01 CPU 70%
22:02 CPU 95%
22:03 RSS 7.5GB
22:04 OOMKilled
```

这比单独看到 Exit 137 有价值得多。

---

# 第十部分：Agent 项目上线后的高频问题清单

长程 Agent 还要特别关注这些。

## 1. LLM 429

`429 Too Many Requests`（请求过多，被模型服务限流）

修：

```text
并发限制
指数退避
jitter（随机抖动）
备用模型
队列
```

---

## 2. Agent 无限循环

修：

```text
max_iterations
task_timeout
token_budget
cost_budget
```

---

## 3. SSE 连接泄漏

用户开多个页面：

```text
连接越来越多
listener 越来越多
```

必须：

```text
disconnect cleanup（断开后清理）
```

---

## 4. Checkpoint 太大

不要把：

```text
raw html
full prompt
full response
全部 source
```

都塞进 JSONB。

更合理：

```text
数据库：结构化状态 + 引用
对象存储：大文本 / 文件
```

---

## 5. RAG 串租户

必须显式：

```text
tenant_id
user_id
ACL
```

禁止：

```text
tenant_id = default
```

作为生产兜底。

---

## 6. 成本失控

监控：

```text
cost_per_task
tokens_per_task
llm_calls_per_task
```

Agent 的成本不是简单和 QPS 成正比，而是：

```text
请求量
× Agent 步数
× LLM Calls
× Token
× Search
× Rerank
```

---

# 第十一部分：线上事故处理的标准动作

真正生产环境发生事故时：

```text
1. 判断影响范围
2. 先止血
3. 保留现场
4. 恢复核心服务
5. 定位根因
6. 修复
7. 压测验证
8. 补监控 / 告警
9. 写事故复盘
```

---

## 1. 止血

可能动作：

```text
限流
降低 Agent 并发
摘掉异常实例
关闭非核心功能
切备用模型
暂停某类任务
```

---

## 2. 保留现场

不要什么都没留就：

```text
restart
```

应该尽量保留：

```text
日志
CPU
RSS
线程栈
数据库锁
Process List
Queue Length
task_id
trace_id
```

---

## 3. 修复后验证

必须：

```text
复现问题
→ 修复
→ 原场景再次执行
→ 并发压测
→ Soak Test
```

不能：

> 改完代码，本地跑一次没问题，就认为修好了。

---

# 第十二部分：事故复盘模板

一次完整线上事故建议写：

## 1. 事故现象

```text
什么时候开始
哪些用户受影响
哪些接口受影响
持续多久
```

## 2. 直接原因

例如：

```text
DB Pool 耗尽
```

## 3. 根因

例如：

```text
Research Agent 在持有数据库 Session 的情况下等待 LLM 30 秒
```

## 4. 放大因素

例如：

```text
并发突然增加
没有背压
pool_size 较小
缺少 pool wait 告警
```

## 5. 临时止血

```text
降低并发
重启异常 Worker
```

## 6. 永久修复

```text
缩短 DB Session 生命周期
拆短事务
增加连接池监控
增加背压
```

## 7. 验证

```text
10 并发测试
P95 恢复
pool wait 恢复
无连接泄漏
```

## 8. 防复发

```text
监控
告警
测试
Release Gate
故障注入
```

---

# 第十三部分：面试速记版

## 接口慢

> 先定位时间花在哪，再判断是在算、在等还是在排队。

## CPU 高

> 找到哪个进程、哪个函数一直在计算，再判断是死循环、重计算还是并发放大。

## OOM

> 看 RSS 是突然涨、持续涨还是随并发涨，再定位哪个 Agent 阶段和什么对象占内存。

## 死锁

> 先排除线程池和连接池耗尽，再抓线程栈找“谁持有什么锁，又在等待什么锁”。

## DB 连接池满

> 查连接是没归还、拿太久，还是并发太多，不要一上来只调大 pool_size。

## 慢 SQL

> 先看执行计划和扫描行数，再从索引、N+1、深分页、Join、排序和事务角度修。

## 进程异常退出

> 先判断是真退出还是假死；真退出查 Exit Code、OOM、异常和平台事件，假死查 CPU、线程池、锁、DB Pool 和 Event Loop。

---

# 最终统一记忆

```text
接口慢：
时间花在哪？

CPU 高：
谁一直在算？

OOM：
谁占着内存不放？

死锁：
谁拿着资源在等谁？

DB Pool 满：
连接为什么一直拿不到？

慢 SQL：
数据库为什么扫描这么多数据？

进程挂了：
到底是谁把它杀掉了？
```

> 生产排障最核心的能力，不是会多少命令，而是每一步都能快速排除一类可能性，最终把问题从“整个系统有问题”缩小到“某个 task、某个阶段、某个资源、某一行代码”。
