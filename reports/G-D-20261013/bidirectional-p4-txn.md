# G-D · P4 地基（事务模块）断言的**双向验证** —— 2026-10-13

> 判据同 `bidirectional.md`：**把防线拆掉，断言必须变红。**
> 本文件里每一例都是 `注入 → 跑 → 变红`、`还原 → 跑 → 变绿`，输出为命令**直接落盘**的原文。

- 采集时刻：2026-10-13 15:35:14 +08:00

| 例 | 拆掉什么 | 期望变红的断言 |
|---|---|---|
| 规则① | `executor.mjs` 里"索引失败就停下"的早退 —— 改成照清源不误 | `TX-E2` |
| 歧义修正 | `states.mjs` 里"目标就是期望字节 ⇒ 不算歧义"那句 —— 退回旧判据 | `RC-6` / `RC-9` |
| 记录完整性 | `steps.mjs` 的 `validateRecord` —— 改成恒真 | `RC-13` |


## 规则① · 索引更新失败 ⇒ 源绝不允许被清（TX-E2）

### ① 拆掉防线（期望**变红**）

```text
  已注入：packages/engine/src/transactions/executor.mjs
node --test --test-isolation=none packages/engine/tests/transactions.test.mjs
# EXIT=1   ← 期望非 0
ℹ tests 24 | ℹ pass 23 | ℹ fail 1
✖ TX-E2 ⭐⭐ 规则①：**索引更新失败 ⇒ 源绝不能删**（否则"文件没了、索引还指着它"） (280.9641ms)
✖ TX-E2 ⭐⭐ 规则①：**索引更新失败 ⇒ 源绝不能删**（否则"文件没了、索引还指着它"） (280.9641ms)
```

### ② 还原防线（期望**变绿**）

```text
  已还原：packages/engine/src/transactions/executor.mjs
# EXIT=0   ← 期望 0
ℹ tests 24 | ℹ pass 24 | ℹ fail 0
```

## 歧义修正 · "已完成 rename"不许被误判成不唯一（RC-6 / RC-9）

### ① 拆掉防线（期望**变红**）

```text
  已注入：packages/engine/src/transactions/states.mjs
node --test --test-isolation=none packages/engine/tests/transactions-recovery.test.mjs
# EXIT=1   ← 期望非 0
ℹ tests 14 | ℹ pass 11 | ℹ fail 3
✖ RC-6 ⭐ `COMMITTED` 但索引未更新 ⇒ **只补索引**，然后清源（绝不出现索引指向不存在的文件） (146.6431ms)
✖ RC-9 索引端口在恢复时失败 ⇒ **停下报出来**，绝不当成"已完成"去清源 (155.7999ms)
✖ RC-11 多文件事务：只 rename 了一半 ⇒ 恢复把**另一半也补上**（不留半截） (168.318ms)
✖ RC-6 ⭐ `COMMITTED` 但索引未更新 ⇒ **只补索引**，然后清源（绝不出现索引指向不存在的文件） (146.6431ms)
```

### ② 还原防线（期望**变绿**）

```text
  已还原：packages/engine/src/transactions/states.mjs
# EXIT=0   ← 期望 0
ℹ tests 14 | ℹ pass 14 | ℹ fail 0
```

## 记录完整性 · 日志记录不完整必须停下问人（RC-13）

### ① 拆掉防线（期望**变红**）

```text
  已注入：packages/engine/src/transactions/steps.mjs
node --test --test-isolation=none packages/engine/tests/transactions-recovery.test.mjs
# EXIT=1   ← 期望非 0
ℹ tests 14 | ℹ pass 13 | ℹ fail 1
✖ RC-13 ⭐⭐ 记录**不完整**（缺 `sha1`）⇒ 停下问人，**不许**被误读成"校验不一致" (113.7513ms)
✖ RC-13 ⭐⭐ 记录**不完整**（缺 `sha1`）⇒ 停下问人，**不许**被误读成"校验不一致" (113.7513ms)
```

### ② 还原防线（期望**变绿**）

```text
  已还原：packages/engine/src/transactions/steps.mjs
# EXIT=0   ← 期望 0
ℹ tests 14 | ℹ pass 14 | ℹ fail 0
```
