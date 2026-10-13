# G-D · P4 地基（事务模块）门禁**原始输出** —— 2026-10-13

> 命令**直接落盘**，不是誊写。

- 采集时刻：2026-10-13 15:35:42 +08:00
- Node：v24.14.0


## 1. 状态机 · 日志 · 执行器（24 条）

```text
# node --test --test-isolation=none packages/engine/tests/transactions.test.mjs
# EXIT=0
✔ TX-S1 主链只能**前进一步**，不许跳步（跳步会把中间的校验整段跳过） (0.9484ms)
✔ TX-S2 ⭐ `COMMITTED` **不许 ABORT**（§3 第 5 条：只能"完成它"，回退会制造半完成状态） (0.1263ms)
✔ TX-S3 终态不可再变（幂等恢复的前提：第二次恢复什么都不改） (0.1042ms)
✔ TX-S4 ⭐ 取消只在**状态边界**生效：COMMITTED 之后不可取消（§5） (0.6183ms)
✔ TX-S5 ⭐ 恢复判定表（§4）逐态对齐 —— 这张表决定"进程被杀之后前进还是回退" (0.1757ms)
✔ TX-S6 ⭐ 歧义判定（§4）：只有两种情形该停下问人，且**不能把"已完成"误判成歧义** (0.1226ms)
✔ TX-J1 txnId 形态与规格 §1 一致：`<utc>-<rand>`，且可用固定 now/rand 复现 (0.2047ms)
✔ TX-J2 ⭐ 日志是**一事务一文件**且原子落盘（不留半截 JSON） (104.827ms)
✔ TX-J3 ⭐ 坏日志**不许让扫描崩**，而且要**可见**（"无法识别的状态"正是 §8 禁止的结果） (102.3037ms)
✔ TX-J4 `withState` 不改入参（状态跃迁必须产生新对象，避免"已经改了一半"） (1.1155ms)
✔ TX-J5 终态归档：从 journal/ 移到 journal/archive/ (111.9207ms)
✔ TX-E1 正常移动走完七步：CLEANED · 源已删 · 目标字节一致 · 索引恰好调一次 · staging 已清 (292.1837ms)
✔ TX-E2 ⭐⭐ 规则①：**索引更新失败 ⇒ 源绝不能删**（否则"文件没了、索引还指着它"） (257.737ms)
✔ TX-E3 ⭐⭐ 规则②：目标已存在且**字节不同** ⇒ 拒绝，且**一个字节都不许动** (68.3364ms)
✔ TX-E3b ⭐ 规则②的**幂等**那一半：目标字节相同 ⇒ 视为已命中、跳过该文件而不是再写一遍 (279.3599ms)
✔ TX-E3c ⭐⭐ `src === dst` 必须被拒绝（否则"幂等命中 + 清源"会把文件本身删掉） (45.6848ms)
✔ TX-E4 预检：源不存在 ⇒ 不写日志、不动任何东西 (54.7914ms)
✔ TX-E4b 多文件事务：图 + 包一起移动，两条都要到目标、源都要清干净 (307.7576ms)
✔ TX-C1 ⭐ 空间核算用**目标所在目录**（相对路径也不许静默失败） (54.4454ms)
✔ TX-C2 ⭐ 空间不足 ⇒ **在 PREPARED 之前拒绝**，给出"需要 X、可用 Y"（§6） (66.7236ms)
✔ TX-C3 没有 PREPARED 就不该有日志：空间不足时事务根本不开始 (56.0038ms)
✔ TX-P1 staging 路径形态与 §1 示例一致：落在**目标目录**下的 `.gs-staging/<txnId>/` (0.1299ms)
✔ TX-P2 注入点清单覆盖 §8 的 8 个位置（跨卷与重复恢复由测试额外驱动） (0.0721ms)
✔ TX-P3 缺 `indexPort` 必须**拒绝构造**（否则"索引成功后才清源"无从保证） (3021.4493ms)
ℹ tests 24
ℹ pass 24
ℹ fail 0
```

## 2. 启动恢复 §4（14 条）

```text
# node --test --test-isolation=none packages/engine/tests/transactions-recovery.test.mjs
# EXIT=0
✔ RC-1 `PREPARED` ⇒ **回退**：清 staging、源不动、落到 ABORTED 并归档 (145.2068ms)
✔ RC-2 ⭐ `STAGED` 且校验一致 ⇒ **前进**：rename + 索引 + 清源，走完整条 (246.715ms)
✔ RC-3 ⭐ `STAGED` 但校验**不一致** ⇒ 回退（清 staging、源不动、绝不将坏字节扶正） (134.4975ms)
✔ RC-4 ⭐⭐ 判定不唯一（staging 丢失 **且** 源已不在）⇒ `RECOVERY_NEEDED` **停下问人** (157.8418ms)
✔ RC-5 ⭐ 源与目标都在且**字节不同** ⇒ 同样停下问人（不能挑一个） (157.9059ms)
✔ RC-6 ⭐ `COMMITTED` 但索引未更新 ⇒ **只补索引**，然后清源（绝不出现索引指向不存在的文件） (190.2085ms)
✔ RC-7 ⭐⭐ **幂等**：同一条事务恢复两次，第二次什么也不改、索引不再被调 (236.9553ms)
✔ RC-8 终态（CLEANED / ABORTED）⇒ **只归档、不动文件** (136.5101ms)
✔ RC-9 索引端口在恢复时失败 ⇒ **停下报出来**，绝不当成"已完成"去清源 (169.3317ms)
✔ RC-10 坏日志**不静默**：`broken` 要报出来，且不影响其它事务的恢复 (166.4684ms)
✔ RC-11 多文件事务：只 rename 了一半 ⇒ 恢复把**另一半也补上**（不留半截） (236.3795ms)
✔ RC-13 ⭐⭐ 记录**不完整**（缺 `sha1`）⇒ 停下问人，**不许**被误读成"校验不一致" (68.7199ms)
✔ RC-14 `writeTxn` 拒绝结构不完整的记录（在**写的时候**就炸，不留半截档案） (52.9454ms)
✔ RC-12 恢复报告**不静默**：有未完成事务时 summary/pending 必须给得出东西 (148.7565ms)
ℹ tests 14
ℹ pass 14
ℹ fail 0
```

## 3. 唯一写路径机械断言 §9（4 条）

```text
# node --test --test-isolation=none packages/engine/tests/transactions-write-path.test.mjs
# EXIT=0
✔ TX-W1 ⭐⭐ 破坏性写操作（rename/unlink/rm）只允许出现在 `src/transactions/`（规格 §9） (16.845ms)
✔ TX-W2 断言**不是空的**：transactions/ 里确实用到了这些 API（否则上面那条恒真） (11.9286ms)
✔ TX-W3 ⭐ 判据**能红**：往 `engine.mjs` 注入一行 fs.renameSync ⇒ 必须被扫出来 (0.2038ms)
✔ TX-W4 如实钉住边界：`collect` 会在**库外**（取件目录）新增文件，不属 §9 的"写素材文件" (9.0895ms)
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

## 4. 故障注入 §8（**真的杀进程**，10 条）

```text
# node --test --test-isolation=none packages/engine/tests/transactions-fault-injection.test.mjs
# EXIT=0
✔ FI before-prepared —— §8 第 1 例：写 PREPARED 前被杀 ⇒ 什么都没发生，重试即可 (141.1845ms)
✔ FI after-prepared —— §8 第 2 例：PREPARED 后被杀 ⇒ 恢复=回退；源完好 (236.8004ms)
✔ FI mid-staging —— §8 第 3 例：staging 写到一半 ⇒ 恢复=回退；staging 被清理；源完好 (223.8588ms)
✔ FI after-staging —— §8 第 4 例：staging 完成、校验前 ⇒ 校验后前进或回退都可接受，但必须确定（这里是前进） (381.9279ms)
✔ FI after-verified —— §8 第 5 例：校验通过、rename 前 ⇒ 恢复=前进 (381.9704ms)
✔ FI mid-rename —— §8 第 6 例：图已 rename、包未 rename ⇒ 恢复=把包也 rename（前进），不留半截 (357.5747ms)
✔ FI after-commit —— §8 第 7 例：rename 完成、索引未更新 ⇒ 恢复=更新索引；绝不出现索引指向不存在的文件 (435.6129ms)
✔ FI after-index —— §8 第 8 例：索引已更新、源未删 ⇒ 恢复=删源（且**不得重复更新索引**） (382.175ms)
  ⚠️ §8 第 9 例（跨卷 / 拔盘）**未验证**：沙箱文件策略为 workspace-write，跨卷写 staging 会被拒；E: 是取件区、G: 是库盘 —— 往那里写测试数据会碰真实数据，违反"绝不对真实库跑"；拔盘需要在操作系统层卸载卷，沙箱内无法模拟
✔ FI-10 ⭐⭐ 同一事务**重复恢复两次**：幂等 —— 第二次不改动任何东西（§8 第 10 例） (379.9258ms)
✔ FI-09 ⚠️ 跨卷（G:→E:）与"E: 拔盘" —— **本环境未验证**，如实记录（§8 第 9 例） (0.3619ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

## 5. `npm test` 全套

```text
# npm test
# EXIT=0
ℹ tests 300
ℹ pass 299
ℹ fail 0
ℹ skipped 1
```
