# G-D · P4 地基：事务模块（日志 / 状态机 / 恢复 / 故障注入）—— 2026-10-13

> 门禁：**G-D**。规格依据：[`docs/spec/SPEC-transactions.md`](../../docs/spec/SPEC-transactions.md)（§1 日志 · §2 状态机 · §3 流程 · §4 恢复 · §5 并发与取消 · §6 空间 · §8 故障注入 · §9 唯一写路径）
> 目标：把 P4（入库/增量）的**地基**立起来，使后续实现 `ingest`/`mutate` 时不用返工。
> **全程只在夹具上跑**（`fixtures/lib-a/` 的副本，落在 `data/_txn-test/`）—— **绝不对真实素材库写**。

## 1. 结论（一句话）

**地基已立起**：状态机、日志、执行器、启动恢复四条都实现了，**§9 的"唯一写路径"成了机械断言**，
**§8 的 10 例里 9 例有断言覆盖（其中 8 例是"真的杀进程"）**，`npm test` **300/299/0/1**。
⚠️ **§8 第 9 例（跨卷 / 拔盘）本环境无法验证**，如实记录在 §5，**没有伪造**。

## 2. 交付物

| 文件 | 职责 |
|---|---|
| `packages/engine/src/transactions/states.mjs` | 状态机（**纯函数**：合法跃迁 · 取消边界 · §4 恢复判定表 · 歧义判据） |
| `packages/engine/src/transactions/journal.mjs` | 日志：一事务一文件 · **原子落盘**（tmp→fsync→rename）· 扫描（坏文件**可见**）· 归档 · `persistState` |
| `packages/engine/src/transactions/hash.mjs` | 文件/内存 sha1（**只有一份实现**） |
| `packages/engine/src/transactions/steps.mjs` | **共享原语**：清 staging · 校验 · 逐个 rename · 更新索引 · 清源 · 歧义评估 · 记录完整性 |
| `packages/engine/src/transactions/executor.mjs` | 执行器（七步流程 + 8 个故障注入点 + 边界取消 + §6 空间核算） |
| `packages/engine/src/transactions/recovery.mjs` | 启动恢复（§4 判定表逐态落地，**幂等**，不静默） |
| `fixtures/lib-a/` | 写操作夹具库：**32 文件 / 6 目录**，覆盖配对全分支（含**只有包**与**两个歧义分支**），内容确定性可复现 |
| `packages/engine/tests/transactions.test.mjs` | 24 条 |
| `packages/engine/tests/transactions-recovery.test.mjs` | 14 条 |
| `packages/engine/tests/transactions-write-path.test.mjs` | 4 条（§9 机械断言） |
| `packages/engine/tests/transactions-fault-injection.test.mjs` | 10 条（§8，**真杀进程**） |
| `packages/engine/tests/helpers/txn-crash-child.mjs` | 被杀的**子进程**本体 |
| [`p4-txn-gates.md`](p4-txn-gates.md) | 五组门禁的**原始输出** |
| [`bidirectional-p4-txn.md`](bidirectional-p4-txn.md) | 三条新防线的**双向验证**（注入红 / 还原绿） |

**本次新增 52 条测试**（`npm test` 248 → **300**）。

## 3. 规格里那两条**不可动摇的规则**，以及它们各自被谁钉住

`SPEC-transactions.md` §3 原文：

> 1. **源文件在 `COMMITTED` 且索引更新成功之前绝不删除。**
> 2. **绝不覆盖已存在的不同内容文件。** 字节相同 → 视为幂等命中，跳过该文件而不是再写一遍。

| 规则 | 断言 | 双向验证 |
|---|---|---|
| ① | `TX-E2`：索引端口抛错 ⇒ `recovery_needed`，**源必须还在且字节未变** | ✅ 拆掉"索引失败就停下"的早退 ⇒ **24 条里 fail 1** |
| ② | `TX-E3`：目标存在且字节不同 ⇒ `aborted`，**目标一个字节都不许动**、索引零调用、日志都不写 | — |
| ②（幂等那一半） | `TX-E3b`：目标字节相同 ⇒ `committed`、标记 `_idempotent`、收尾仍清源 | — |
| ②（隐患） | `TX-E3c`：`src === dst` ⇒ **拒绝**（否则"幂等命中 + 清源"会**把文件本身删掉**） | — |

## 4. §8 故障注入覆盖表（10 例）

`SPEC-transactions.md` §8 要求：「必须**真的杀进程**，不能只做代码评审。在每个状态边界各注入一次」。

**怎么做到"真杀"**（这一步做错了会得出**错误结论**，我第一版就错了）：
父进程 `spawn` 子进程 → 子进程跑到边界、写 `boundary.json`、然后 `Atomics.wait` **同步挂死** →
父进程轮询到标记后 `child.kill()` **终结它**。判据两条：`boundary` 在（确实杀在那个边界）+
`done` **不在**（事务确实没跑完）。

> ⚠️ **不能用"抛异常"模拟**：抛异常会被调用点的 `catch` 接住（rename 循环的 catch 会把它变成
> `RECOVERY_NEEDED`），而**进程真被杀**时没有任何 JS 收尾 ⇒ 日志停在被杀前的状态。
> 两者在盘上留下的状态**不一样**。实测踩过：用 `setInterval` 让 `onCrash`"挂住"是**无效**的
> （它照样返回，于是 `hit()` 里的 `throw` 生效 ⇒ 子进程**崩溃退出 code 1**、不是被杀），
> 父进程轮询与它赛跑 ⇒ 有的用例过、有的不过。改用 `Atomics.wait` 才稳定（连跑 3 次全绿）。

| # | 注入点 | 被杀后日志状态（实测=期望） | 恢复动作与结果（实测） | 判据 |
|---|---|---|---|---|
| 1 | 写 `PREPARED` 前 | *（无日志）* | 无事可恢复 —— 「什么都没发生，重试即可」 | ✅ |
| 2 | `PREPARED` 后 | `PREPARED` | **回退** → `aborted`；源完好 | ✅ |
| 3 | staging 写到一半 | `PREPARED` | **回退** → `aborted`；staging 被清；源完好 | ✅ |
| 4 | staging 完成、校验前 | `STAGED` | **校验后前进** → `committed`（确定的，不是"可能前进可能回退"） | ✅ |
| 5 | 校验通过、rename 前 | `VERIFIED` | **前进** → `committed` | ✅ |
| 6 | 图已 rename、包未 rename | `VERIFIED` | **前进**：把包也 rename，**不留半截** | ✅ |
| 7 | rename 完成、索引未更新 | `COMMITTED` | **前进**：补索引 → 清源；全程**不出现"索引指向不存在的文件"** | ✅ |
| 8 | 索引已更新、源未删 | `COMMITTED`（`indexUpdate.done=true`） | **前进**：清源；且**索引不被重复更新**（幂等） | ✅ |
| 9 | 跨卷 `G:→E:` 在 3/5/7 点 + **E: 拔盘** | — | — | ❌ **未验证**（见 §5） |
| 10 | 同一事务**重复恢复两次** | — | 第二次**什么都不改**、索引零调用、目标字节不变 | ✅ |

**每条用例都额外断言了 §8 的总判据「不丢素材」**：图的原始字节与包的原始字节
**必须还能在盘上（源 / 目标 / staging 之一）按 sha1 找到** —— 一个都找不到就是丢素材。

## 5. ❌ 本环境**无法验证**的部分（如实记录，未伪造）

| 项 | 为什么做不了（实测理由） |
|---|---|
| **§8 第 9 例：跨卷 `G:→E:`** | ① 沙箱文件策略为 **workspace-write**（只能写会话工作区 `D:\USERS\...\gemma-search`），跨卷写 staging 会被拒；② 本机虽有 C/D/E/G 四个卷（`statfsSync` 都拿得到余量），但按规格 **E: 是取件/移出保留区、G: 是库盘** —— 往那里写测试数据属于**碰真实数据**，与「绝不对真实素材库跑」冲突；③ "拔盘"要在操作系统层卸载卷，沙箱内无法模拟。<br>**怎么才能验**：在一台有**两个可写空卷**的机器上，把夹具放卷 A、`dst` 指向卷 B，照本目录同样的 kill+恢复流程各跑一次；拔盘用 VHDX 挂载/卸载模拟。 |
| **§5 并发（库级排他锁 / uid 锁 / 字典序防死锁）** | `canCancel` 的边界已实现并有断言（`TX-S4`）；但**锁本身尚未实现** —— 属 P4 正式实现范围，不是本次"地基"的交付。 |
| **§6 里"索引重建期 +11 MB×2 / 模型缓存 ≤1.7 GB / 撤销保留区"** | 公式与"在 `PREPARED` **之前**拒绝"已实现并断言（`TX-C2`/`TX-C3`）；但那几项**数值**是情境相关的**调用方输入**（`extraBytes`），**不硬编码**（P3）。 |
| **§7 撤销策略与保留期（30 天 / 5 GB / 绝不自动删旧）** | 未实现 —— 属 P4 正式实现范围。 |
| **真实 `ingest` / `mutate` 接线** | 未接线（引擎 `UNIMPLEMENTED_METHODS` 仍是唯一清单）—— 地基已就位，接线是下一步。 |

## 6. 过程中抓到的**真缺陷**（本轮最值钱的部分）

| # | 缺陷 | 后果（如果不修） | 谁抓到的 |
|---|---|---|---|
| 1 | 空间核算用 `path.parse(dst).root` | 相对路径下 `root === ''` ⇒ `statfs('')` ENOENT ⇒ **整条流程静默 abort、日志为空**，看不出原因 | 冒烟测试 |
| 2 | 我自己发明了 `need × 2` 的安全系数 | 规格 §6 只写了"需要 X、可用 Y" ⇒ **加戏就是改判据**；那几项改为调用方注入 | 对照规格 |
| 3 | `src === dst` 时"幂等命中 + 清源" | **把文件本身删掉** —— 丢素材 | 写 `TX-E3c` 时想到 |
| 4 | `ABORTED` 后没清 staging | 坏残留堆在素材库里（规格 §2/§4 明写要清） | 冒烟测试 |
| 5 | **恢复的"前进"路径漏了 `cleanStaging`** | 空的 `.gs-staging/<txnId>` 留在素材库里 | `FI after-staging` |
| 6 | **`after-prepared` 注入点在清单里、却从没被调用** | §8 第 2 例实际上**不可注入**，用例会"看起来通过"（子进程一路跑完） | `FI after-prepared` |
| 7 | 歧义判据把"**已完成 rename**"误判成"不唯一" | `COMMITTED` 事务永远停在"问人"，**正常事务再也走不完** | `RC-6`/`RC-9` |
| 8 | 日志记录缺字段（`JSON.stringify` 静默丢掉 `undefined`）被当成"哈希不一致" | 一个**合法**事务被静默 `ABORTED`，且理由是假的 | 我自己踩的（测试助手字段名写错）⇒ 补了 `validateRecord` 守卫 + `RC-13` 回归锁 |

> 第 8 条顺带暴露一个**通用陷阱**：`JSON.stringify` **会静默丢掉值为 `undefined` 的键**。
> 写日志/证据这类"结构必须完整"的地方，宁可在**写的时候**就炸（`writeTxn` 现在校验 `txnId`/`state`/`files`）。

## 7. §9 唯一写路径：机械断言 + 它抓到的**语义边界**

断言 `TX-W1`：全引擎的**破坏性**写调用（`fs.rename` / `fs.unlink` / `fs.rm` / `fs.rmdir`）
**只允许出现在 `src/transactions/`**。

- **判据必须匹配 `fs.<api>(` 而不是裸搜 `rename`** —— 实测 `fake.mjs:480` 有 `req.op || 'rename'`、
  `:486` 有 `{ rename: '改 ID' }`，那是**操作名**不是文件系统调用，裸搜立刻假阳性。
- **必须剥注释** —— 这几个文件注释很密，"禁止 `fs.rename`"这类说明本身会命中。
  复用全仓唯一那份剥注释扫描器（`apps/desktop/tests/helpers/source-scan.mjs`），不写第二份（P1）。
- **双向验证** ✅：往 `engine.mjs` 真注入一行 `fs.renameSync` ⇒ `TX-W1` **红**并报出 `engine.mjs:56`；还原 ⇒ 4/4 绿。
- **它立刻抓到了一处真实边界**：`engine.mjs:384`/`:432` 是 **`collect`（取件）** 的
  `fs.mkdirSync` + `fs.copyFileSync(..., COPYFILE_EXCL)` —— 写的是**库外的取件目录**、且绝不覆盖，
  属规格原文"不得 rename/unlink **素材文件**"的语义之外。
  `TX-W4` **把它钉住**（"除 `transactions/` 外写文件的只有 `engine.mjs` 这一个"），
  将来别处新增写文件点会红 —— **不装作没这回事**。

---

*本目录只收 `md` / `json`（`reports/README.md` 的协议）。*
