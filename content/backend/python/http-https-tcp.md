---
archiveProfile: "backend-python"
category: "Backend"
date: "2026-09-13"
description: ""
draft: false
featured: false
slug: "http-https-tcp"
title: "HTTP / HTTPS / TCP 高频复盘"
topic: "Python"
updated: "2026-09-13"
tags:
---

## 一、HTTP 是什么？

**一句话：HTTP 是应用层的请求-响应协议，负责定义“客户端和服务器怎么说话”。**

### What

常见方法：

- `GET`：获取资源
- `HEAD`：只拿响应头，不拿响应体
- `POST`：提交数据 / 触发处理
- `PUT`：创建或整体替换目标资源
- `DELETE`：删除资源

### 安全性 & 幂等性

| 方法 | Safe | Idempotent |
|---|---|---|
| GET | ✅ | ✅ |
| HEAD | ✅ | ✅ |
| POST | ❌ | 通常 ❌ |
| PUT | ❌ | ✅ |
| DELETE | ❌ | ✅ |

**记忆：读 = safe；重复做结果不继续变化 = idempotent。**

⚠️ **易错**：

- “安全”不是“网络安全”，而是语义上不要求修改服务器状态。
- `DELETE` 不安全，但它是幂等的。
- `POST` 是否真的幂等取决于业务，但 HTTP 语义本身不保证它幂等。

### 面试追问

**Q：为什么幂等重要？**

A：因为网络失败后可以更放心地自动重试。例如同一个 `PUT` 重试两次，目标状态理论上和执行一次相同。

---

## 二、HTTP/1.0 → 1.1 → 2 → 3 怎么记？

### HTTP/1.0

**核心问题：一个请求经常对应一个 TCP 连接，连接成本高。**

后来出现 `Keep-Alive` 机制复用连接。

### HTTP/1.1

**一句话：默认持久连接，同一条 TCP 连接可以连续处理多个请求。**

流程：

`TCP 连接建立 → 请求1/响应1 → 请求2/响应2 → ...`

支持 pipelining：

`请求1 → 请求2 → 请求3` 可以不等前一个响应就先发出去。

但：

**响应仍必须按请求顺序返回。**

所以前面的响应慢，后面的响应也可能被卡住。

⚠️ **易错**：HTTP/1.1 pipelining ≠ HTTP/2 真正的多路复用。

### HTTP/2

**一句话：在一条 TCP 连接上用多个 Stream 并发传输。**

关键变化：

- 二进制分帧
- Stream 多路复用
- Header 压缩
- 协议支持 Server Push

流程理解：

```text
TCP connection
├─ Stream 1: HTML
├─ Stream 3: CSS
└─ Stream 5: JS
```

不同 Stream 可以交错传输。

但底层还是 TCP：

```text
某个 TCP 包丢失
      ↓
TCP 必须补齐字节流
      ↓
上层多个 HTTP/2 Stream 都可能一起等
```

这叫 **TCP 层的队头阻塞**。

### HTTP/3

**一句话：HTTP/3 跑在 QUIC 上，QUIC 基于 UDP，但自己实现了可靠传输、多路复用、拥塞控制和 TLS 1.3。**

```text
HTTP/3
  ↓
QUIC
  ↓
UDP
```

优势：

- Stream 之间更独立
- 一个 Stream 丢包，不必把其他 Stream 一起卡住
- TLS 1.3 与 QUIC 握手结合，建连延迟更低
- 使用 Connection ID，网络切换时连接更容易继续存活

**记忆：**

```text
HTTP/1.1：一条路排队
HTTP/2：一条高速路，多车道，但地基还是 TCP
HTTP/3：换成 QUIC，每条 Stream 更独立
```

---

## 三、HTTP 长连接 vs TCP 长连接

### TCP 长连接

**What：底层 TCP socket 保持 ESTABLISHED，不立即关闭。**

这是传输层连接本身。

### HTTP 长连接

**What：HTTP 复用已有 TCP 连接继续发送请求。**

所以：

```text
HTTP keep-alive
      ↓
依赖底层 TCP 连接没有关闭
```

⚠️ **易错**：不是“HTTP 在用户态、TCP 在内核态”就能完整解释二者区别；关键区别是**协议层级和语义不同**。

---

## 四、HTTP 和 HTTPS 的区别

**一句话：HTTPS = HTTP + TLS。**

| HTTP | HTTPS |
|---|---|
| 默认 80 | 默认 443 |
| 明文传输 | TLS 加密 |
| 不验证服务器身份 | 通常通过证书验证服务器身份 |
| 无 TLS 完整性保护 | 提供机密性 + 完整性 + 身份认证 |

### HTTPS 为什么既安全又快？

**核心思想：非对称密码学解决认证/密钥协商，对称加密负责大量数据传输。**

因为：

- 非对称运算贵
- 对称加密快

所以建立安全连接后，应用数据主要用对称密钥保护。

---

## 五、SHA、RSA、AES 到底是什么？

### SHA

**哈希函数，不是对称加密。**

作用：

`任意长度输入 → 固定长度摘要`

常用于完整性校验、签名体系里的摘要计算等。

### RSA

**非对称密码算法。**

有公钥 / 私钥。

可用于签名，也可用于某些加密场景。

⚠️ TLS 1.3 已经移除了旧式“静态 RSA 密钥交换”。

### AES

**对称加密。**

通信双方使用共享密钥进行高速加密解密。

### 快速记忆

```text
SHA = 摘要
RSA = 公私钥
AES = 共享密钥高速加密
```

⚠️ **易错**：MD5 / SHA 生成的是哈希摘要，不应该理解成“绝对唯一 ID”，因为哈希理论上存在碰撞。

---

## 六、现代 TLS 1.3 握手怎么理解？

不要死背“固定四次握手”。

**一句话：TLS 1.3 的核心是双方协商参数、建立共享密钥、验证服务器身份，然后切换到加密通信。**

简化流程：

```text
ClientHello
- 支持的 TLS 版本
- 密码套件
- key share
        ↓
ServerHello
- 选择参数
- server key share
        ↓
双方根据 (EC)DHE 等方式得到共享密钥
        ↓
服务器发送证书 + 签名证明身份
        ↓
Finished 校验
        ↓
开始传应用数据
```

### 为什么不再记“客户端生成第三个随机数再用 RSA 公钥加密”？

这是更接近旧版 TLS / RSA key exchange 的理解方式。

TLS 1.3 默认思路已经变成：

**临时 Diffie-Hellman 类密钥交换 + 证书签名认证。**

好处：

- 前向安全性更好
- 完整握手通常 1 RTT
- 恢复连接时还可支持 0-RTT early data（有重放风险，不能乱用）

---

## 七、HTTP/2 和 HTTP/3 最容易被问什么？

### Q1：HTTP/2 都多路复用了，为什么还需要 HTTP/3？

因为 HTTP/2 的多个 Stream 最终还是落到**同一个 TCP 字节流**。

TCP 某个包丢失：

```text
丢包
 ↓
TCP 等待重传
 ↓
后续字节不能交给 HTTP/2
 ↓
多个 Stream 一起受影响
```

HTTP/3 把可靠传输放进 QUIC，并按 Stream 管理，能降低这种跨 Stream 的相互阻塞。

### Q2：QUIC 用 UDP，为什么还能可靠？

因为 UDP 只是提供最基础的数据报能力。

QUIC 自己在用户态实现：

- 序列与确认
- 丢包恢复
- 拥塞控制
- 流量控制
- Stream
- TLS 1.3

所以：

**UDP 不可靠 ≠ 基于 UDP 的上层协议不能做可靠传输。**

---

# 30 秒自测

1. GET、PUT、DELETE 哪些幂等？
2. HTTP/1.1 pipelining 和 HTTP/2 multiplexing 最大区别是什么？
3. HTTP/2 为什么仍然有 TCP 层队头阻塞？
4. SHA、RSA、AES 分别是什么类型？
5. TLS 1.3 为什么不能再简单背成“RSA 加密第三个随机数”？
6. QUIC 为什么基于 UDP 仍能可靠？

如果这 6 个能顺畅说出来，这一段基本就能应付常见面试追问。
