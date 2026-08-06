---
archiveProfile: "backend-python"
category: "Backend"
date: "2026-08-06"
description: ""
draft: false
featured: false
slug: "leetcode1"
title: "算法训练第 1 天：哈希表基础"
topic: "Python"
updated: "2026-08-06"
tags:
  - "Backend"
  - "Python"
---

- 日期：2026-08-06
- 学习主题：数组、哈希表、哈希集合
- 今日题目：
  1. LeetCode 1：两数之和
  2. LeetCode 128：最长连续序列
- 今日状态：两道题均已完成首次学习与提交调试

------

## 一、今日核心知识

今天主要学习两种哈希结构：

### 字典 `dict`

保存键值映射：

```python
数字 -> 下标
```

适合解决：

> 某个数字是否出现过？如果出现过，它的下标是多少？

代表题目：

```text
两数之和
```

### 集合 `set`

只保存不同的元素，不保存下标：

```python
{1, 2, 3, 4}
```

适合解决：

> 某个数字是否存在？

代表题目：

```text
最长连续序列
```

字典和集合中的查询，平均时间复杂度都是：

```text
O(1)
```

------

# 二、两数之和

## 1. 题目信息

- LeetCode：1
- 难度：简单
- 标签：数组、哈希表
- 当前状态：初次完成，能够理解代码
- 核心模板：遍历当前数字，使用哈希表查找补数

题目要求：

给定整数数组 `nums` 和目标值 `target`，找出数组中两个数字，使它们的和等于 `target`，返回两个数字的下标。

例如：

```python
nums = [2, 7, 11, 15]
target = 9
```

因为：

```text
2 + 7 = 9
```

所以返回：

```python
[0, 1]
```

------

## 2. 核心思路

遍历到当前数字 `num` 时，计算它需要搭配的数字：

```python
complement = target - num
```

使用字典保存已经遍历过的数字：

```text
数字 -> 下标
```

如果补数已经存在于字典中，直接返回：

```python
[补数的下标, 当前数字的下标]
```

否则，将当前数字及其下标存入字典。

------

## 3. 标准代码

```python
from typing import List


class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        num_to_index = {}                          # 保存：数字 -> 下标

        for index, num in enumerate(nums):         # 同时遍历下标和数字
            complement = target - num              # 计算当前数字需要的补数

            if complement in num_to_index:         # 补数已经在前面出现
                return [
                    num_to_index[complement],      # 补数的下标
                    index                          # 当前数字的下标
                ]

            num_to_index[num] = index              # 保存当前数字和下标

        return []                                  # 没有找到答案
```

------

## 4. 执行过程

输入：

```python
nums = [2, 7, 11, 15]
target = 9
```

第一次遍历：

```text
index = 0
num = 2
complement = 9 - 2 = 7
```

字典为空，`7` 不存在，因此保存：

```python
{2: 0}
```

第二次遍历：

```text
index = 1
num = 7
complement = 9 - 7 = 2
```

字典中已经存在：

```python
{2: 0}
```

所以返回：

```python
[0, 1]
```

------

## 5. 今日出现的错误

### 错误：函数内部代码没有缩进

错误结构：

```python
class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:

    num_to_index = {}
```

`num_to_index` 没有缩进到 `twoSum` 方法内部。

正确结构：

```python
class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        num_to_index = {}
```

Python 使用缩进表示代码层级：

```text
class 内部缩进 4 个空格
方法内部再缩进 4 个空格
循环和判断内部继续缩进
```

### 注意：Python 一般不写分号

不推荐：

```python
num_to_index = {};
return [];
```

推荐：

```python
num_to_index = {}
return []
```

------

## 6. 复杂度

```text
时间复杂度：O(n)
空间复杂度：O(n)
```

只遍历一次数组，哈希表查询平均为 `O(1)`。

------

## 7. 面试口述

我使用哈希表保存已经遍历过的数字及其下标。遍历数组时，对于当前数字，计算它需要的补数 `target - num`。如果补数已经存在于哈希表中，就返回补数对应的下标和当前下标；否则将当前数字及其下标加入哈希表。时间复杂度是 O(n)，空间复杂度是 O(n)。

------

## 8. 两数之和背诵口诀

```text
建立字典，遍历数组；
计算补数，先查后存；
找到补数，返回下标。
```

必须记住：

```text
先查找补数，再保存当前数字。
```

------

# 三、最长连续序列

## 1. 题目信息

- LeetCode：128
- 难度：中等
- 标签：数组、哈希集合
- 当前状态：初次完成，已解决超时问题
- 核心模板：集合去重，只从连续序列起点向后统计

题目要求：

给定一个未排序的整数数组，找出其中最长连续整数序列的长度。

例如：

```python
nums = [100, 4, 200, 1, 3, 2]
```

其中存在：

```text
1、2、3、4
```

最长连续序列长度为：

```text
4
```

注意：

```text
题目要求数字本身连续，不要求它们在原数组中的位置连续。
```

------

## 2. 核心思路

第一步，将数组转换成集合：

```python
num_set = set(nums)
```

集合具有两个作用：

```text
1. 自动去重
2. 平均 O(1) 查询数字是否存在
```

第二步，遍历集合中的每个数字。

只有当：

```python
num - 1 not in num_set
```

才说明当前数字是连续序列的起点。

例如：

```text
1、2、3、4
```

只有 `1` 的前一个数字 `0` 不存在，因此只从 `1` 开始向后统计。

第三步，不断检查：

```python
current_num + 1
```

是否存在，并累计当前连续序列长度。

------

## 3. 标准代码

```python
from typing import List


class Solution:
    def longestConsecutive(self, nums: List[int]) -> int:
        num_set = set(nums)                          # 数组转集合，完成去重和快速查询
        longest_length = 0                           # 保存最长连续序列长度

        for num in num_set:                          # 遍历集合中的每个数字
            if num - 1 not in num_set:               # 前一个数不存在，num 才是起点
                current_num = num                    # 当前正在检查的数字
                current_length = 1                   # 起点本身算一个数字

                while current_num + 1 in num_set:    # 下一个连续数字存在
                    current_num += 1                  # 移动到下一个数字
                    current_length += 1               # 当前序列长度加一

                longest_length = max(                # 更新最大长度
                    longest_length,
                    current_length
                )

        return longest_length                        # 返回最终结果
```

------

## 4. 执行过程

输入：

```python
nums = [100, 4, 200, 1, 3, 2]
```

转换成集合：

```python
num_set = {1, 2, 3, 4, 100, 200}
```

检查数字 `1`：

```text
1 - 1 = 0
0 不在集合中
```

因此 `1` 是起点。

向后统计：

```text
1 存在，长度为 1
2 存在，长度为 2
3 存在，长度为 3
4 存在，长度为 4
5 不存在，停止
```

更新：

```python
longest_length = 4
```

检查数字 `2`：

```text
2 - 1 = 1
1 在集合中
```

因此 `2` 不是起点，直接跳过。

`3` 和 `4` 同样跳过。

数字 `100` 和 `200` 都只能形成长度为 `1` 的序列。

最终返回：

```python
4
```

------

## 5. 今日出现的超时问题

第一次提交结果：

```text
Time Limit Exceeded
74 / 85 cases passed
```

说明算法结果基本正确，但在大规模数据下执行时间过长。大数据用例期望结果为 `100000`。

### 超时原因一：从每个数字都向后查

错误写法：

```python
for num in num_set:
    current_num = num
    current_length = 1

    while current_num + 1 in num_set:
        current_num += 1
        current_length += 1
```

假设集合中包含：

```text
1、2、3、……、100000
```

程序会：

```text
从 1 检查到 100000
从 2 检查到 100000
从 3 检查到 100000
……
```

产生大量重复检查，时间复杂度退化为：

```text
O(n²)
```

### 正确优化

必须加入起点判断：

```python
if num - 1 not in num_set:
```

只有连续序列的第一个数字，才有资格进入 `while` 循环。

对于：

```text
1、2、3、……、100000
```

只有 `1` 会完整向后检查一次。

`2～100000` 因为前一个数字存在，都会被直接跳过。

------

## 6. 另一个可能造成超时的错误

错误：

```python
while current_num + 1 in nums:
```

`nums` 是列表。

在列表中查询一个元素，时间复杂度为：

```text
O(n)
```

正确：

```python
while current_num + 1 in num_set:
```

集合查询平均时间复杂度为：

```text
O(1)
```

起点判断也必须使用集合：

```python
if num - 1 not in num_set:
```

------

## 7. 复杂度

```text
时间复杂度：O(n)
空间复杂度：O(n)
```

虽然代码中同时出现了 `for` 和 `while`，但并不是所有数字都会完整执行 `while`。

只有连续序列的起点会向后统计，每个数字总体只被有效访问有限次数，因此总复杂度仍然是 `O(n)`。

------

## 8. 面试口述

我先把数组中的所有数字放入哈希集合，用于去重和快速查询。然后遍历集合中的每个数字，只有当当前数字的前一个数字不存在时，才说明它是一段连续序列的起点。接着从这个起点不断检查下一个数字是否存在，并统计当前连续序列长度，最后更新最大值。每个数字最多被有效访问一次，因此时间复杂度是 O(n)，空间复杂度是 O(n)。

------

## 9. 最长连续序列背诵口诀

```text
数组转集合，
只找序列头。

前一个不存在，
当前才是头。

从头不断加一，
统计长度取最大。
```

极简版：

```text
Set 去重，找起点，向后数，取最大。
```

------

# 四、两道题对比

| 题目         | 使用结构    | 保存内容     | 核心判断           |
| ------------ | ----------- | ------------ | ------------------ |
| 两数之和     | 字典 `dict` | 数字 → 下标  | 补数是否出现       |
| 最长连续序列 | 集合 `set`  | 不重复的数字 | 当前数字是否为起点 |

两数之和：

```python
num_to_index = {}
```

最长连续序列：

```python
num_set = set(nums)
```

------

# 五、今日必须记住的代码

## 两数之和

```python
num_to_index = {}

for index, num in enumerate(nums):
    complement = target - num

    if complement in num_to_index:
        return [num_to_index[complement], index]

    num_to_index[num] = index
```

## 最长连续序列

```python
num_set = set(nums)
longest_length = 0

for num in num_set:
    if num - 1 not in num_set:
        current_num = num
        current_length = 1

        while current_num + 1 in num_set:
            current_num += 1
            current_length += 1

        longest_length = max(longest_length, current_length)

return longest_length
```

------

# 六、今日错误总结

## Python 语法问题

```text
1. 函数内部代码必须正确缩进。
2. for、if、while 内部继续缩进。
3. Python 通常不需要写分号。
4. return [] 必须放在 for 循环外。
```

## 算法性能问题

```text
1. 不能从每个数字重复向后统计。
2. 必须判断当前数字是否为连续序列起点。
3. 查询数字是否存在时使用 set，而不是 list。
4. 代码能够通过小用例，不代表复杂度一定正确。
```

------

# 七、今日学习状态

```text
✅ 两数之和：首次完成
✅ 最长连续序列：首次完成
✅ 完成代码提交与测试
✅ 理解 dict 和 set 的区别
✅ 解决 Python 缩进错误
✅ 解决最长连续序列超时问题
```

当前掌握程度：

```text
两数之和：理解标准解法，待独立默写
最长连续序列：理解标准解法，待独立默写
```

------

# 八、复习安排

## 2026-08-07

不看答案默写：

```text
1. 两数之和
2. 最长连续序列
```

重点检查：

```text
两数之和：
是否先查补数，再保存当前数字？

最长连续序列：
是否只从 num - 1 不存在的数字开始？
```

## 2026-08-09

再次独立完成两题，并口述：

```text
核心思路
为什么使用哈希结构
时间复杂度
空间复杂度
```

## 2026-08-13

限时复习：

```text
两数之和：5 分钟内完成
最长连续序列：8 分钟内完成
```

------

# 九、今日总结

今天掌握了哈希表题目的两个基础模式：

```text
模式一：使用字典保存“数字到下标”的映射。
模式二：使用集合快速判断某个数字是否存在。
```

最重要的认识：

```text
算法不仅要算对，还要避免重复计算。

小用例通过不代表算法复杂度合格。
```

今日最终口诀：

```text
两数之和：遍历当前数，哈希查补数。

最长连续：集合找起点，只从起点向后数。
```