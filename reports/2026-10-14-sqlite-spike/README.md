# 证据 · node:sqlite 在真 Electron 主进程内（T-03）

> 日期：2026-10-14 · 类型：**本轮实测** · 结论：**PASS**
> 原始输出：`probe.txt` · 探针源码：`probe.cjs`

## 为什么要单独验

Node 里能用不等于 **Electron 主进程**里能用：Electron 自己编译 Node，内置模块可能被裁掉；而且之前只验过
`ELECTRON_RUN_AS_NODE=1`（那是"以纯 Node 运行 Electron"，**不是主进程**）。

## 命令

`~powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue   # 本机该变量默认存在，会让 Electron 变纯 Node
.\node_modules\electron\dist\electron.exe data\_sqlite-probe.cjs --no-sandbox
`~

## 结果：**PASS · EXIT=0**

| 断言 | 实测 |
|---|---|
| 真主进程 | `process.type = browser` · node **24.21.0** · electron **44.7.0** · chrome 152.0.7977.130 |
| 模块可用 | `require("node:sqlite") = OK` · `DatabaseSync = function` |
| WAL | `journal_mode = wal` · 落盘出现 `.db-wal` 与 `.db-shm` |
| 建表/插入/查询 | ✅ 插入后行数 = 2 |
| 体检要用的 SQL | ✅ `GROUP BY … HAVING count>1` 可用（重复检测） |
| 关闭 | ✅ `close()` |
| **删除后重建** | ✅ 成立 ⇒ SPEC §3「`.gs.db` 是可重建的派生数据」这条**有实测支撑** |

## 两个环境备注（不是产品问题）

1. 本机默认设置 `ELECTRON_RUN_AS_NODE` ⇒ Electron 会以**纯 Node** 启动并报一个极具误导性的错。产品侧本来就有启动助手在摘它，这里手动摘一次即可。
2. Electron 抱怨创建 GPU 持久缓存失败（`AppData\Roaming\Electron\GPUPersistentCache: 拒绝访问`）—— 沙箱环境对 AppData 的限制，**退出码仍是 0**，不影响本次结论。
