# 验收判据索引（A1–A18 + M0）—— 当下快照

日期：2026-10-15 · 口径：**只有「命令 + 原始输出」才算已验**；未验/部分一律写明，**不许含糊成「应该没问题」**。
判据正文在 `SPEC §7`；本文件只做**索引**（哪条 · 现状 · 证据在哪 · 还缺什么）。

> ✅ **权威门禁（2026-10-15 收工前 · **冻结窗口** · Lead 实跑 · commit `16e7f3a`）**：`npx prettier --check .` **EXIT=0** · 单测 **613 / pass 612 / fail 0 / cancelled 0 / skipped 1 / EXIT=0** · `npm run typecheck` **0** · `npm run build` **0** · `npm run e2e` **63 passed / 1 skipped / 0 failed（3.1 分钟）** · `s4-accept.mjs` **PASS 13 / FAIL 0 / SKIP 0** · `out/` 指纹 build 后 = e2e 后（`AB88FA1B…`）；`npm run lint` 报告制 **22 条**（LINT-1 承接）。
> ✅ **DF-1 / DF-2（第三方审查的两条 P0）修完后门禁复跑**：单测 **583 / pass 582 / fail 0 / skipped 1 / EXIT=0**（Lead 实跑）。
> ⚠️ **波动如实记录**：全量 e2e 的**第一次**跑出 `62 passed / 1 failed`（`E11-a`）；`E11-a` **单跑 6.7s 绿**，随后**全量复跑 63/1/0 绿** ⇒ 判为**偶发**。第一次那次与我方另一张卡的**能红探针**（临时改 `main/storage-ports.ts`，而部分 spec 会转译 `src`）在时间上重叠 ⇒ 记在此处备查，**不当作已修复**。

## 里程碑

| 判据 | 现状 | 证据 |
|---|---|---|
| **M0** 真窗口端到端（启动 → 库就绪 → 检索 → 详情 → 取件） | ✅ **绿**（Lead 复跑：`1 passed (6.6s)` · `结果条数 = 60` · 取件真出文件 `23B sha1=52d168d6…`） | `apps/desktop/e2e/m0-real.spec.mjs` · 提交 `cf6d341` |

## SPEC §7 的 A1–A18

| # | 判据（摘要） | 现状 | 证据 / 还缺什么 |
|---|---|---|---|
| A1 | 7 条工作流在**干净安装**上都能走通 | ⛔ **未验** | 需要 P8（打包 + 干净机器）；**本轮不做** |
| A2 | 门禁：类型 + 单测 + 构建全绿；e2e 覆盖主流程 | ✅ **已验**（2026-10-15 权威门禁） | 单测 **574 / pass 573 / fail 0 / skipped 1 / EXIT=0** · 类型 **0**（`npm run typecheck`）· 构建 **0** · e2e **63 passed / 1 skipped / 0 failed（6.6 分钟）**；`out/` 指纹 build 前后与 e2e 前后**均逐字节相同**（`908FAC9B…AB28`） |
| A3 | 库内写入不变式（保留命名空间外零写入） | ✅ **已验** | S2：导入前后**源文件 sha1 变化 0**；M0：库根内容 = `[.gs-index.bin, .gs.db, .gs.db-shm, .gs.db-wal, VR, items.json, meta.json]`；S4-ITEMS：`.gs.db` 跑前后**逐字节一致** |
| A4 | 事务两条铁律（杀进程后恢复判定正确） | ⛔ **本轮未验** | 事务路径属第二批（`job` 表）；本轮不产生证据 |
| A5 | 索引五道校验任一道被破坏 ⇒ 报「索引损坏」而不是空结果 | ✅ **已验** | S3：六条破坏全 `[OK]`，判定 100% 走产品 `readIndexFile`（`s3-verify.mjs verify` ⇒ PASS） |
| A6 | 对比度与命中区达标（真窗口量计算样式） | ✅ **由 e2e 覆盖** | 全量 e2e 63 绿含 a11y / uiux / style-contract spec（`style-contract` 4/4） |
| A7 | 缺模型 ⇒ 明确指引，且**不显示假结果** | ✅ **既有证据**（T-17 轮次） | 引用既有证据，非本轮实测 |
| A8 | 多库合并只合并 compat 相同；排除原因可见 | 🔒 **门控未开** | 合并检索属 P7 门控（需第二个库） |
| A9 | 文档检索给片段与出处、不做生成 | 🔒 **门控未开** | F7 进入条件（10–30 份真实文档）不满足 |
| A10 | 交付只复制不删除、冲突不覆盖 | ⚠️ **部分** | 取件路径已在 M0 真窗口验证（`out/ID-15302998.7z`）；**交付/集合属第二批**（`asset_export` / `collection` 未建） |
| A11 | 重建可达且规则正确（丢事实、留过程与意图；素材摘要一致） | ✅ **已验** | `db-rebuild` **5/5**（Lead 复跑 EXIT=0）· `libraryRebuild` 保留（U21）· M0 里重建后检索仍 60 条 |
| A12 | 设备语义（`device` = 请求值 · `effectiveProvider` = 实际或 null） | ✅ **既有证据**（T-31 轮次） | 引用既有证据 |
| A13 | `thumb://` 失败状态映射（安全拒绝 ⇒ 403 · 内部 ⇒ 500 · **不许伪装 404**） | ⚠️ **部分** | M0 真窗口观测到 **415**（`解码失败`，SPEC §5.3 表内合法）；403/500 两条依赖既有 T-15 用例 |
| A14 | 6 张表且每张被点名（DDL 派生双向） | ✅ **已验** | S4-A14 PASS（含「14 张暂缓表两库皆无」+ 删一条 DDL 派生清单跟着少） |
| A15 | `library_registry.root` 规范化 + UNIQUE | ✅ **已验** | S4-A15 PASS（4 种写法 → 1 个规范形；第二次登记被拒） |
| A16 | 旧库不升级（丢弃重建 + 如实告知） | ✅ **已验** | S4-A16：旧口径库 ⇒ 体检 `SCHEMA_TOO_NEW` / `rebuildable=true`（不假装兼容）· `openGsDb` **抛**同一个码 · `rebuildLibraryDb` 丢弃重建后旧表消失、绿地表齐备、**`materialDigest（含内容）前后逐位相同**`；对照：当前版本库**不被丢弃** |
| A17 | `items` 只读 + `facets` 全库口径/跨分页稳定 | ✅ **已验** | S4-ITEMS PASS · browse e2e **E14-g** 真窗口绿 |
| A18 | 错误码 **28** 一致 + 两条路同名 | ✅ **已验** | 前半 S4-A18（`ERR` 键数 28 == SPEC §5.2 同一集合）· 后半 **S4-A18b 真断言**（引擎端口 = 体检 = `DB_OPEN_FAILED`）+ `M9b/M9c` 守护；能红对照已做 |

## 本轮新增的两条守卫（自建判据）

| 判据 | 现状 | 证据 |
|---|---|---|
| **索引 ↔ 条目自反性**（`vector_row` 双射 + top-1 是自己） | ✅ | S4-REFLEX（100×768 · 采样 15 条）· S3 的 `cos = 1.000000`（重编 row 0/50/99） |
| **对账漂移 = 0**（索引行数与 `vector_row` 非空一致） | ✅ | `s3-verify.mjs verify` ⇒ 漂移 0（含 `needs_reencode` 0 · 磁盘 stat 漂移 0） |

## 结论（当下）

· **已验**：M0 · A3 · A5 · A6 · A7 · A11 · A12 · A14 · A15 · A17（+ 两条自建守卫）；
· **部分/待补**：A2（等 S2b 清完 10 红）· A10 · A13 · A18 后半（M9c 已绿，可结案）；
· **门控未开**：A8 · A9；**本轮范围外**：A1 · A4 · A16（A16 可补一个小用例）。

⇒ **离「门禁全绿」只差 S2b 那 10 条**；离 **M1（对外里程碑）**还差 A1/A4/A16 的补验与 P8。
## 今日新增纪律（见 TASKS §3）

| # | 一句话 | 触发它的实况 |
|---|---|---|
| 14 | 别把 `blockedBy` 接在你叫不出名字的依赖上 | Lead 误接 S2/S6 的依赖 ⇒ 队友刷卡被拒 |
| 15 | 判「没人在做」不能靠一次 grep | Lead 误判「S3 没人开工」 |
| 16 | 门禁结论必须来自**最后一次写入之后**的干净跑 | 队友的 tsc 结论比改动早 2 分钟 |
| 17 | 否定式结论（「0 残留」）**先跑命令 → 贴输出 → 再结论** | 同一人两次先说结论、实测命中 2/4 处 |
| 18 | 变异/注入必须作用在**代码真正读的那个名字**上 | 注入改底层列名 `size_bytes`、SQL 返回的却是别名 `image_size` ⇒ **假绿** |

## 第三方审查台账（`review.html` / `review-dev.html` · Lead 逐条核实）

| 条目 | 核实结果 | 状态 |
|---|---|---|
| **P0** 指纹漏跳保留命名空间（与 `materialDigest` 两套口径） | ✅ **真**（`fingerprint.ts` 无跳过） | ✅ **已修** DF-1（`task-68`）：修后 203 vs 203 · 指纹 `G:\model` 未变 |
| **P0** `app-db.ts` `num()/text()` 静默降级 bigint | ✅ **真**（`:91-92`） | ✅ **已修** DF-2（`task-69`）：收窄只留一份（`numberOf/flagOf/…`）· 显式 `readBigInts: false` · **自查发现并修了 `items-ipc.ts` 同类缺陷** · 全仓 31 处逐条判定 · 三组能红 |
| **P1** `engine.ts:613` 用 `Math.random` 生成 jobId | ✅ **真** | ✅ **已修** DF-3（`crypto.randomUUID` + 固定种子红锚） |
| **P1** `thumb-cache` 写入非原子（截断文件永久缓存） | ✅ **真**（`writeFileSync` 裸写） | ✅ **已修** DF-4（`atomic-write.ts` 唯一实现 + EOI 判据 + 假 fs 真跑失败路径） |
| **P1** `uncaughtException` 只记日志不退出 | ✅ **真**（`index.ts:1254-1255`） | ✅ **已修** DF-6（落盘→flush→`app.exit(1)`；`unhandledRejection` 只标记不退出 —— **所有者已授权该策略**） |
| **债务** `row-types.ts` 残留死 SQL | ✅ **真**（`ITEM_INSERT_SQL/UPSERT_SQL/sqlRowToItemRecord` 仍在、仍被 barrel 转出） | ✅ **已修** DF-5（0 残留 grep 命中 0） |
| 债务 引擎 6 个下线桩 / 索引布局双轨 / CSS 双轨 / 配置多路 / BANDS 暂定 | ✅ 真，但**属已知设计取舍** | 见 SPEC §8 与 `BATCH2-PLAN.md` |
| 「20 个方法、无 `items`」「BrowsePage 恒返回 `ITEMS_NOT_WIRED`」 | ❌ **已被今日改动超越**（现 21 方法 · 浏览页已接真数据 · 6 条 e2e 绿） | 无需处理 |
| 产品判断 R1/R2/R3/M4/M6（模型自备 · 建索引是桩 · 质量无凭据 · 内存峰值 · 串行推进） | ✅ 成立 | 对应 `BATCH2-PLAN.md` **B2-1（job）** 与 P8/P2 |
| ⚠️ 口径待裁：指纹是否也对齐扫描器的「跳过隐藏项」 | 实现者标注为**有意差异**（指纹=「被动过没」；扫描器=「有哪些素材」） | **待所有者** |

## 修复台账（DF 系列 · 由两份第三方审查驱动）

| 卡 | 内容 | 状态 |
|---|---|---|
| DF-1 | 指纹漏跳保留命名空间（与 `materialDigest` 两套口径） | ✅ 已提交（`7ef28e0`） |
| DF-2 | `num()/text()` 静默降级 bigint（+ 自查 `items-ipc` 同类） | ✅ 已提交（`3ae79b0`） |
| DF-3 | `jobId` 换 CSPRNG + 「什么算素材」收敛**一份实现** | ✅ 已提交（`ade8523` + 补 `c4ab9d9`） |
| DF-4 | thumb-cache 原子写 + 截断不再永久命中 | ✅ 已提交（`90c5a9b`） |
| DF-5 | 删 `row-types.ts` 死 SQL（S2 漏做那条） | ✅ 已提交（`7005795`） |
| DF-6 | 未捕获异常策略 + 生产态 DevTools 收口 | ✅ 已提交（`3d100bf`） |
| DF-8 | `index-file.ts` 写入编排收敛到 `atomic-write.ts`（P1 唯一实现） | ✅ 已提交（`d1eeb0d`） |
| **DF-7** | 路径逃逸（B）+ `engineMethod` 类型收口 + `footLen` 校验；**驳回 4 条**（D2/D3/D4/checkSpace）| ✅ 已提交（`091eac5`） |
| **DF-9** | `assertCollectDirAllowed` 纯词法 ⇒ junction 绕过白名单（**第二条逃逸**，与 B **共用**同一份逐段实现） | ✅ 已提交（`b27541b`） |
| **ENC-1** | `readImageAny` 有界头读 + `pickEmbedding` **全零拒绝**并把 **5 份副本收敛成 1 份**（**改前/改后同一编码基线**：Top-5 逐位一致） | ✅ 已提交（`1ab9a5f`） |
| 门禁范围 | 把 `packages/indexer/tests/*.test.mjs` 纳入 `npm test`（**不在门禁里的测试等于白写**） | ✅ 已提交（`461e5e7`） |
| **T-09** | ESLint + Prettier 落地（Prettier 全仓 + ESLint 报告制；`typescript-eslint` 因 TS7 冲突撤掉） | ✅ 已提交（`16e7f3a`）· 顺手挖出 **CT-3 假绿**（原本碰巧绿）并修 |
| **LINT-1** | 修掉 **22 条** ESLint error（**不许关规则**） | ◐ 待派（`task-83`） |
| **DOC-1** | 修 **3 处悬挂文档引用**（指向已删除的文档） | ◐ 待派（`task-84`） |
| 待裁 | `appHealth`（第 22 个方法，只读，暴露「不健康」） | **等所有者**（一句话即可派卡） |

## 今日新增纪律（TASKS §3 · 14–19）
全部来自今日实况，其中 **16/19 是 Lead 自己的错**：「最后一次写入之后」与「门禁窗口要冻结写入面+测试面」。

## 第三份审查（`reports/2026-10-16-review/review-report.md` · 2026-10-16 · Lead 逐条核实）

| 条目 | 核实结果 | 处置 |
|---|---|---|
| **S1** 🔴 构建门禁 RED（`esbuild remove … Access is denied`，`out/renderer` 空） | ⚠️ **复现，但定性为「环境」不是「产品」** —— Lead 三组对照：**默认 TEMP** ⇒ `Build failed / EXIT=-1`；**TEMP+TMP 都指仓库内** ⇒ **EXIT=0**；**只改 TMP、TEMP 留默认** ⇒ `EXIT=-1` ⇒ **必须同时改两个**（vite/esbuild 在 Windows 读 `TEMP`） | 开 **BUILD-1**：让构建**不依赖环境临时目录**（把 vite/esbuild 的 temp 指到可写位置）+ 顺手修 **S10**（`bmp_decode.ts` 静态+动态双 import 警告） |
| **S2** 🟠 打包从未真正验证 | ✅ **真**（`electron-builder.yml` 自述「从未打包过」；`dist/win-unpacked` 停在 10-14） | **P8 的范围**（我们已排期）· 记录：`asarUnpack` 需按实测补原生 `.node` |
| **S3** 🟡 元数据押在实验性 `node:sqlite` | ✅ 真（有薄适配层隔离；Stability 1.2） | **已知取舍**（AGENTS §1 已选型）· 保留适配层 + 锁 Electron 版本 + 备逃生路线 |
| **S4** 🟡 两个方法接受渲染层传来的**绝对路径**，与「渲染层传不进路径」的声明不符 | ✅ **真**（`libraryAdd.root` · `collectDirAdd.absPath`） | 开 **SEC-1**：① **把声明改成如实**（说明这两处例外与缓解）；② 主进程**二次校验**（必须存在且是目录） |
| **S5/S6/S8/S9** 设置中心 · 入库增量 · 快捷键 · `cmdk` 零 import | ✅ 真，**都是已排期项** | 对应 **P4-4 设置中心** · 第二批表（入库）· **P4-6 命令面板**（用上 `cmdk`） |
| **S7** 🟡 侧栏连「文档」入口都没有（与 SPEC §4 信息架构不符） | ✅ **真**（SPEC 说有、侧栏没有） | 开 **IA-1**：加**禁用占位 + 原因**（F7 门控：需 10–30 份真实文档）—— 与其它门控项同一形态 |
| **S10** 🟢 `bmp_decode.ts` 静态+动态双 import | ✅ 真（构建警告） | 并入 **BUILD-1** |
| **S11** 🟢 生产态 `devTools: true` | ✅ 真但**是有意保留**（DF-6 的 C5 断言「`devTools:true` 必须还在」= 允许打开，**不是自动打开**；`openDevTools()` 已被禁止） | **不改**，口径已钉 |
| **S12** ⚪ `npm audit` 不可用（镜像源没有 audit 端点） | ✅ 真（环境） | 记入 `TASKS §5`：查漏洞要用**官方源** `npm audit --registry=https://registry.npmjs.org` |
| 「单测 644 通过 / 0 失败」·「类型只覆盖 `.ts`、`checkJs` 关闭」 | ✅ 与我们的门禁一致；第二条是**已知边界**（`.mjs` 由运行时测试覆盖） | 不改 |
