---
archiveProfile: "backend-python"
category: "Backend"
date: "2026-09-14"
description: ""
draft: false
featured: false
slug: "os"
title: "OS × 计算机网络｜面试复盘"
topic: "Python"
updated: "2026-09-14"
tags:
---

> `Linux` · `I/O` · `零拷贝` · `Reactor / Proactor` · `网络安全` · `Socket / TCP`

---

### 快速目录

| 模块 | 内容 |
|---|---|
| **01** | Linux 命令面试题 |
| **02** | Linux I/O |
| **03** | 零拷贝 |
| **04** | Reactor / Proactor |
| **05** | 计算机网络 |
| **06** | Socket / TCP |

---

## 01｜Linux 命令面试题

### 1. 如何看进程 CPU 占用？

常用命令：

```bash
top
ps
```

- `top`：实时查看系统资源和进程占用。
- `ps`：查看当前进程信息。

### 2. 如何看进程号 PID？

- `top`：第一列通常是 PID。
- `ps`：常见输出中第二列通常是 PID，具体以命令格式为准。

### 3. 如何看某个进程中的线程？

```bash
ps -T -p <PID>
```

例如：

```bash
ps -T -p 55499
```

> **⚠️ 易错 / 注意**
> 这里的 `55499` 是 **进程 PID**，不是端口号。

常见字段：

```text
PID    SPID
进程ID 线程ID
```

也可以：

```bash
top -Hp <PID>
```

拆开记：

- `-H`：显示线程（Threads）
- `-p PID`：只看指定 PID 的进程


> **💡 一句话结论**
> **top -Hp PID = 实时查看某个进程下面各线程的资源占用。**

---

### 4. 怎么看某个端口被哪个进程占用？

```bash
netstat -napt | grep 443
```

参数：

- `-n`：直接显示 IP 和端口的数字形式。
- `-a`：显示所有连接和监听端口。
- `-p`：显示进程信息。
- `-t`：只看 TCP。
- `|`：把前一个命令的输出交给后一个命令。

也可以：

```bash
lsof -i :<端口号>
```

例如：

```bash
lsof -i :443
```

- `lsof` = list open files，列出打开的文件。
- Linux 中网络连接也可以看作文件。
- `-i`：查看网络相关文件 / 连接。

---

### 5. Linux 怎么看 TCP 状态？

```bash
netstat -nat
```

查看监听状态可以配合：

```bash
netstat -nat | grep LISTEN
```

也可以使用：

```bash
ss -t
```

> `ss`：查看 socket 状态，功能和 `netstat` 类似。

---

### 6. 如何判断远程端口是否可连接？

可以使用：

```bash
nc
telnet
```

- `nc`：network cat，常用于测试网络连接。
- `telnet`：也可以用于测试远程端口连通性。

---

### 7. 查看 TCP 已建立连接数

```bash
netstat -nat | grep ESTABLISHED | wc -l
```


**流程**

```text
netstat -nat
    ↓
列出 TCP 连接状态
    ↓
grep ESTABLISHED
    ↓
筛选已建立连接
    ↓
wc -l
    ↓
统计行数
```

- `wc` = word count
- `-l` = line，统计行数

---

### 8. top 命令能看到什么？

主要包括：

- CPU 使用情况
- 内存信息
- Swap 交换区信息
- 系统负载 `load average`
- 进程统计信息
- 各进程 `%CPU`、`%MEM` 等资源占用

---

### 9. CPU 使用率达到 100% 怎么排查？

核心流程：

```text
top 找高 CPU 进程
    ↓
top -Hp PID 找高 CPU 线程
    ↓
线程 ID 转十六进制
    ↓
jstack 定位线程堆栈
```

#### 第一步：找到高 CPU 进程

```bash
top
```

#### 第二步：找到进程中的高 CPU 线程

```bash
top -Hp <PID>
```

例如发现线程 ID 为：

```text
958
```

#### 第三步：线程 ID 转十六进制

```bash
printf "0x%x\n" 958
```

输出：

```text
0x3be
```

拆开：

- `printf`：格式化输出。
- `0x`：十六进制前缀。
- `%x`：按十六进制输出。
- `\n`：换行。
- `958`：十进制线程 ID。


> **🧠 速记**
> `%x` = hexadecimal = 十六进制。

注意 Linux 终端要使用英文半角引号：

```bash
printf "0x%x\n" 958
```

#### 第四步：jstack 找线程堆栈

```bash
jstack 163 | grep '0x3be' -C5 --color
```

拆开：

- `jstack 163`：打印 PID=163 的 Java 进程线程堆栈。
- `|`：把左边输出交给右边。
- `grep '0x3be'`：搜索对应线程。
- `-C5`：显示匹配行前后各 5 行。
- `--color`：高亮匹配内容。

如果想详细查看：

```bash
jstack 163 | vim +/0x3be -
```

- `vim`：使用 vim 查看。
- `+/0x3be`：打开后自动搜索 `0x3be`。
- `-`：从标准输入 stdin 读取。

---

### 10. 查看内存使用情况

```bash
free -m
```

常见字段：

- `total`：总内存。
- `free`：当前完全未使用的内存。

---

### 11. 查看磁盘剩余空间

```bash
df -h
```

可以看到：

- 总容量
- 已使用
- 可用空间


> 🧠 **记忆：**

- `df` = disk free
- `-h` = human-readable，人类更容易阅读的单位。

---

### 12. Linux 服务器如何看负载？

```bash
top
uptime
```

重点看：

```text
load average
```

分别表示：

```text
1 分钟 / 5 分钟 / 15 分钟
```

---

### 13. 查看文件内容

```bash
cat
more
less
head
tail
```

- `cat`：一次性查看全部内容。
- `more`：分页查看。
- `less`：分页 + 搜索，功能更多。
- `head`：查看文件头部。
- `tail`：查看文件尾部。

例如：

```bash
tail -n 3 your_file.txt
```

表示查看最后 3 行。

---

### 14. 查看文件大小

```bash
ls -l filename
du -h filename
stat filename
```

---

### 15. 常用文件 / 目录命令

```bash
pwd
touch
mkdir
rm
cp
mv
find
```

- `pwd`：当前工作目录的绝对路径。
- `touch`：创建文件。
- `mkdir`：创建文件夹。
- `rm`：删除文件。
- `cp`：复制。
- `mv`：移动 / 重命名。
- `find`：查找文件。

删除文件夹：

```bash
rm -r directory_name
```

复制整个文件夹：

```bash
cp -r <源目录> <目标目录>
```

> `-r` = recursive，递归处理目录。

---

### 16. 查看最近修改的文件

```bash
ls -lt
```

- `-l`：long format，详细格式。
- `-t`：按照修改时间排序。

---

### 17. chmod 修改权限

```bash
chmod u+x 文件名
```

- `u`：user，文件所有者。
- `x`：execute，执行权限。

---

### 18. grep 统计字段出现次数

```bash
grep -o '字段' filename | wc -l
```

---

### 19. sed 替换字符串

```bash
sed -i 's/旧字符串/新字符串/g' filename
```

---


---

## 02｜Linux I/O


### 1. ️ Linux 的 I/O 模型

常见 I/O 模型：

```text
阻塞 I/O
非阻塞 I/O
I/O 多路复用
信号驱动 I/O
异步 I/O
```

#### I/O 多路复用


> **💡 一句话结论**
> **一个线程同时监听多个 socket，哪个就绪就处理哪个。**

常见实现：

```text
select
poll
epoll
```

#### CPU 密集型和 I/O 密集型

- **CPU 密集型**：主要关注 CPU 计算，应该尽量避免无意义的忙轮询消耗 CPU。
- **I/O 密集型**：大量时间在等待 I/O，常配合非阻塞 I/O 或 I/O 多路复用提高并发能力。

---


### 2. select、poll、epoll 有什么用？

统一记忆：

> **它们都是做 I/O 多路复用：让一个线程同时监听很多 socket。**

核心区别：

| 机制 | 核心思路 | 大量连接时 |
| --- | --- | --- |
| `select` | 每次传入全部 fd，并遍历检查 | 较差 |
| `poll` | 类似 select，但通常没有固定 fd 数量上限 | 较差 |
| `epoll` | fd 提前注册到内核，只返回就绪事件 | 更高效 |

#### select


**流程**

```text
很多 socket
    ↓
select
    ↓
返回就绪结果
    ↓
程序遍历整个集合寻找就绪 fd
```

问题：

- 每次调用都要传入整个 fd 集合。
- 返回后还要遍历集合。
- 通常存在 fd 数量限制。


> **🧠 速记**
> **select = 把所有人叫过来，再挨个问。**

#### poll

思想和 select 类似：

```text
很多 socket
    ↓
poll
    ↓
返回就绪结果
    ↓
继续遍历寻找就绪 fd
```

改进：

- 通常没有 select 那种固定 fd 数量限制。

问题：

- 连接很多时仍然需要遍历。


> **🧠 速记**
> **poll = 人数限制少了，但还是挨个问。**

#### epoll

epoll 的思路：

```text
先把 fd 注册给内核
    ↓
内核长期维护
    ↓
某些 fd 就绪
    ↓
epoll_wait 返回就绪事件
```

不需要每次重新把所有 fd 集合传入，也不需要用户程序遍历全部连接找谁就绪。


> **🧠 速记**
> **epoll = 谁有事谁举手，我只处理举手的人。**

---


### 3. select / poll / epoll 都要进入内核吗？

要。

```text
select(...)
poll(...)
epoll_wait(...)
```

它们都是系统调用，都会发生：

```text
用户态
  ↓
内核态
  ↓
用户态
```

真正的区别不是“epoll 才进入内核”，而是监听集合如何维护。

#### select / poll

每次调用：

```text
用户态保存 fd 集合
    ↓
调用 select / poll
    ↓
把监听集合交给内核
    ↓
内核扫描
    ↓
返回结果
```

#### epoll

先注册：

```bash
epoll_create(...)
epoll_ctl(...)
```

相当于：

> “这些 fd 以后都帮我盯着。”

之后：

```bash
epoll_wait(...)
```

只获取已经就绪的事件。

因此：

```text
select / poll：
每次告诉内核监听哪些 fd
→ 内核扫描
→ 返回结果

epoll：
提前把 fd 注册到内核
→ 内核长期维护
→ epoll_wait 获取就绪事件
```

#### 为什么 fd 很少时 epoll 优势不明显？

因为 epoll 本身还需要维护：

- epoll 实例
- fd 监听关系
- 就绪队列
- `epoll_ctl()` 的添加 / 删除 / 修改

如果只监听很少几个 fd，`poll` 直接扫描几项就结束，epoll 的额外维护成本不一定划算。

---


### 4. epoll 的水平触发和边缘触发

#### LT：水平触发

只要 fd 仍然处于就绪状态，下一次 `epoll_wait` 还会继续通知。

例如：

```text
来了 100 字节
↓
epoll_wait 通知
↓
只读 20 字节
↓
还剩 80 字节
↓
下一次 epoll_wait 还会通知
```


> **🧠 速记**
> **水平触发比较“念旧”，没处理完还会继续提醒。**

#### ET：边缘触发

只有 fd 状态从“未就绪 → 就绪”发生变化时通知。

因此收到通知后，要尽量一次把当前可处理的数据处理完。


> **🧠 速记**
> **边缘触发比较“果断”，状态变化时提醒一次。**

---


---

## 03｜零拷贝


### 1. 什么是零拷贝技术？


> **💡 一句话结论**
> **尽量减少数据在用户态和内核态之间来回拷贝，从而减少 CPU 拷贝和上下文切换。**

传统 `read + write` 发送文件时，会涉及多次数据拷贝和用户态 / 内核态切换。

使用：

```bash
sendfile
```

可以减少用户态参与的数据搬运。

如果网卡支持 `SG-DMA`，流程可以进一步简化：

```text
磁盘文件
  ↓ DMA
内核 Buffer
  ↓ SG-DMA
网卡
```

Kafka 中也会用到零拷贝技术。

---


---

## 04｜Reactor / Proactor


### 1. Reactor 模式是什么？

Reactor 是网络 I/O 中常见的事件驱动设计。


> 🎯 **核心：**

> **I/O 事件来了以后，把事件分发给对应处理器。**

---


### 2. 单 Reactor 单线程

```text
Reactor
  ↓
监听 I/O
  ↓
处理 I/O
  ↓
处理业务
```

特点：

- 一个线程负责所有 I/O 事件。
- 同一个线程直接处理业务逻辑。
- 逻辑简单。
- 没有额外线程切换。
- 业务一旦耗时，整体并发能力会受影响。

---


### 3. 单 Reactor 多线程

```text
Reactor 线程
   ↓
监听 / 分发 I/O
   ↓
工作线程池
   ↓
处理业务
```

特点：

- Reactor 负责监听和分发 I/O。
- 工作线程池并发处理业务。
- 解决单线程业务处理能力不足的问题。
- 但所有连接的 I/O 事件仍然由同一个 Reactor 线程监听和分发，因此 Reactor 线程可能成为瓶颈。


> **🧠 速记**
> **它不是不能处理很多连接，而是很多连接的 I/O 监听和分发仍然集中在一个 Reactor。**

---


### 4. 主从 Reactor 多线程

```text
Main Reactor
    ↓
负责接收新连接
    ↓
Sub Reactor
    ↓
监听连接上的 I/O
    ↓
工作线程处理业务
```

核心区别：

> **把“连接建立后的 I/O 监听工作”也分摊给多个 Reactor。**

---


### 5. Reactor 和 Proactor


> **💡 一句话结论**
> **Reactor：通知你“可以做 I/O 了”，然后应用自己做。**

> **Proactor：把 I/O 任务交出去，系统做完后通知你“已经完成了”。**

#### Reactor

```text
应用注册读事件
    ↓
内核监听
    ↓
数据就绪
    ↓
通知应用
    ↓
应用读取数据
    ↓
处理业务
```

#### Proactor

```text
应用提交 I/O
    ↓
内核执行 I/O
    ↓
I/O 完成
    ↓
通知应用
    ↓
应用直接处理结果
```

---


---

## 05｜计算机网络


### 1. ️ DNS 劫持

DNS 用来完成：

```text
域名
 ↓
IP 地址
```

DNS 劫持：

> **把你的 DNS 请求接管 / 改道，最终把你引导到错误甚至恶意的网站。**

可以尝试更换可信 DNS 服务器，绕开被劫持的 DNS 服务。

你原来的类比可以继续记：

> **“挟天子以令诸侯”，DNS 被控制了，就可能把你带去错误的地址。**

---


### 2. DNS 污染

DNS 查询常使用 UDP 53 端口，传统 DNS 本身缺少结果认证，因此解析结果可能被伪造。

DNS 污染：

> **给 DNS 查询塞一个假的解析结果。**


> 🧠 **记忆：**

```text
DNS 劫持：DNS 请求被接管 / 改道
DNS 污染：DNS 返回结果被伪造
```

“污染”更强调：

> **解析结果是假的。**

常见思路：

- 使用可信、干净的 DNS。
- 本机直接通过 `hosts` 绑定固定域名和 IP。

---


### 3. DDoS 攻击

DDoS：

> **大量恶意主机同时向服务器发送请求，消耗 CPU、内存、带宽或连接资源，使正常用户无法获得服务。**

#### 常见分类

应用层：

```text
HTTP Flood
DNS Query Flood
```

传输层：

```text
SYN Flood
UDP Flood
```

网络层：

```text
部分 ICMP Flood 等
```


> 🧠 **记忆：**

```text
L7：打业务
L4：打连接 / 端口
L3：打 IP / 网络通道
```

#### 防护

- 限制单个 IP 的请求频率。
- 对异常 IP 拉黑。
- 敏感操作增加验证码等用户验证。
- 使用专业 DDoS 防护服务过滤异常流量。

---


### 4. XSS 攻击

XSS = 跨站脚本攻击。

#### 持久型 XSS


**流程**

```text
攻击者上传恶意脚本
    ↓
服务器保存
    ↓
正常用户访问页面
    ↓
服务器返回恶意脚本
    ↓
脚本在用户浏览器执行
    ↓
可能窃取敏感信息 / 执行恶意操作
```

#### 防护

1. 对输入进行验证和过滤，对特殊字符进行正确转义。
2. 敏感会话 Cookie 设置 `HttpOnly`，降低恶意 JavaScript 窃取 Cookie 的风险。

#### HttpOnly Cookie

`HttpOnly` 是 Cookie 的安全属性。

开启后：

```text
浏览器请求
→ 仍然自动携带 Cookie

JavaScript
→ 不能通过 document.cookie 读取该 Cookie
```

例如：

```http
Set-Cookie: sessionId=abc123; HttpOnly
```


> 🎯 **核心：**

> **HttpOnly 主要防止 XSS 恶意脚本直接读取敏感 Cookie，但不能阻止 XSS 本身。**

---


### 5. CSRF 攻击

CSRF = 跨站请求伪造。


**流程**

```text
用户登录网站 A
    ↓
浏览器保存 A 的 Cookie
    ↓
用户访问恶意网站 B
    ↓
B 诱导浏览器向 A 发请求
    ↓
浏览器可能自动携带 A 的 Cookie
    ↓
A 误以为这是用户本人操作
```

#### 防护


> **记住三个：**

```text
同源 / 来源检测
验证码
CSRF Token
```

- 服务端检查请求来源。
- 敏感操作要求验证码。
- 请求携带服务端生成的 CSRF Token，服务端校验 Token。

---


### 6. ️ SQL 注入

SQL 注入：

> **攻击者把恶意 SQL 片段放进用户输入，如果服务端直接拼接 SQL，就可能让数据库执行攻击者构造的语句。**


**流程**

```text
恶意输入
  ↓
服务端直接拼接 SQL
  ↓
数据库执行
  ↓
数据可能被查询 / 修改 / 删除
```

#### 防护

1. **参数化查询 / 预编译语句**
   - 用户输入只作为参数传递。
   - 不直接拼接到 SQL 字符串中。

2. **输入验证和过滤**
   - 对用户输入进行合法性检查。

3. **最小权限原则**
   - 应用使用权限尽可能小的数据库账户，降低攻击成功后的损失。

---


---

## 06｜Socket / TCP


### 1. Socket 是什么？


> **💡 一句话结论**
> **Socket 是操作系统提供的网络通信端点，IP 和端口是这个端点的重要标识信息。**

服务器可以把 socket 绑定到：

```text
192.168.1.10:8080
```

其中：

```text
192.168.1.10 → IP
8080         → 端口
```

但一个已经建立的 TCP 连接通常通过四元组唯一标识：

```text
源 IP
源端口
目的 IP
目的端口
```

例如：

```text
客户端 A：10.0.0.1:50001
              ↓
服务器：192.168.1.10:8080
```

```text
客户端 B：10.0.0.2:50002
              ↓
服务器：192.168.1.10:8080
```

虽然服务器 IP + 端口相同，但客户端 IP / 端口不同，所以可以区分不同连接。

---


### 2. Socket 编程和 TCP 三次握手

服务端先：

```text
socket
  ↓
bind
  ↓
listen
  ↓
accept
```

#### bind

把 socket 绑定到本地：

```text
IP + 端口
```

#### listen

进入监听状态，等待客户端发起连接。

#### connect

客户端调用：

```text
connect()
```

内核开始发起 TCP 三次握手，客户端进入：

```text
SYN_SENT
```


> **整体可以记：**

```text
服务端：
bind → listen → accept

客户端：
connect → 发起三次握手
```

---


### 3. Linux 内核维护的两个 TCP 队列

```text
半连接队列（SYN Queue）
全连接队列（Accept Queue）
```

#### 半连接队列

保存：

> **已经收到客户端 SYN，但三次握手还没有完全完成的连接。**

#### 全连接队列

保存：

> **已经完成 TCP 三次握手，等待应用程序 `accept()` 取走的连接。**


**流程**

```text
客户端 SYN
   ↓
半连接队列
   ↓
三次握手完成
   ↓
全连接队列
   ↓
accept()
   ↓
应用拿到已连接 socket
```

#### backlog

Linux 2.2 之后，`listen(backlog)` 中的 `backlog` 主要影响已经完成握手、等待 `accept()` 的全连接队列长度。

其实际上限还会受到内核参数：

```text
somaxconn
```

的限制。