---
archiveProfile: "algorithm-leetcode-hot100"
category: "Algorithm"
date: "2026-08-11"
description: ""
draft: false
featured: false
slug: "leetcode-206"
title: "LeetCode 206｜反转链表"
topic: "LeetCode Hot100"
updated: "2026-08-11"
tags:
  - "Backend"
  - "Python"
---

> **题型：链表｜双指针 / 三变量｜Easy**

**题目链接：** https://leetcode.cn/problems/reverse-linked-list/

![题目描述快照](/assets/notes/leetcode-206/01-206.webp)

## 1. 题目一句话

给定单链表头节点 `head`，把链表整体反转，并返回新的头节点。

```text
1 → 2 → 3 → None

反转后：

3 → 2 → 1 → None
```

## 2. 核心思路

用 3 个变量：

- `prev`：前一个节点
- `curr`：当前节点
- `next_node`：提前保存下一个节点

每轮只做 4 件事：

```text
保存 next → 当前反指 → prev 前进 → curr 前进
```

## 3. 标准代码

```python
class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        prev = None                 # 已反转部分的头
        curr = head                 # 当前处理节点

        while curr:
            next_node = curr.next   # 1. 先保存下一个节点
            curr.next = prev        # 2. 反转当前指针
            prev = curr             # 3. prev 前进
            curr = next_node        # 4. curr 前进

        return prev                 # prev 是新的头节点
```

## 4. 最容易错的地方

### 为什么必须先保存 `next_node`？

如果直接：

```python
curr.next = prev
```

原来的 `curr.next` 会被覆盖，后面的链表就找不到了。

所以顺序不能乱：

```python
next_node = curr.next
curr.next = prev
```

### 为什么返回 `prev`？

循环结束时：

```text
curr = None
prev = 新链表头节点
```

所以返回：

```python
return prev
```

## 5. 复杂度

- 时间复杂度：`O(n)`
- 空间复杂度：`O(1)`

## 6. 面试记忆口诀

> **存 next → 反指 → prev 走 → curr 走。**

闭卷时只要能写出下面 4 行，这题基本就稳了：

```python
next_node = curr.next
curr.next = prev
prev = curr
curr = next_node
```
