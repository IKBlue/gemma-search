// packages/engine/src/transactions/executor.mjs —— 事务执行器（规格 §1/§3/§5/§6）
//
// ⚠️ **本目录是引擎里唯一允许写素材文件的路径**（§9）。这条不是口号：
//    `packages/engine/tests/transactions-write-path.test.mjs` 会机械地检查
//    "全引擎只有 `src/transactions/` 里能出现 fs 写 API"。
//
// 规格里**两条不可动摇的规则**（§3），本文件的每个 `await` 顺序都是为了它们：
//   ① **源文件在 `COMMITTED` 且索引更新成功之前绝不删除。**
//      （宁可留下重复文件让人看见，也不要"文件没了、索引还指着它"。）
//   ② **绝不覆盖已存在的不同内容文件。** 目标重名且字节不同 → 拒绝；字节相同 → 幂等命中，跳过。
//
// 七步（§3）：预检 → PREPARED → STAGED → VERIFIED → COMMITTED → 更新索引 → CLEANED
import fs from 'node:fs';
import path from 'node:path';

import { S, canCancel } from './states.mjs';
import { ensureJournalDir, makeTxnId, txnPath, writeTxn, persistState } from './journal.mjs';
import { sha1File } from './hash.mjs';
import { cleanStaging, verifyStaged, commitRenames, applyIndex, cleanupSources, STAGING_DIRNAME } from './steps.mjs';

/** staging 目录名（§1 的示例是 `.gs-staging`）。⚠️ 定义在 `steps.mjs`，这里**只 import 不重定义**。 */
export { STAGING_DIRNAME } from './steps.mjs';

/** §8 的注入点名字。**必须与实际到达位置一一对应** —— 测试靠它证明"确实杀在那个边界上"。 */
export const CRASH_POINTS = Object.freeze([
  'before-prepared',   // 1：写 PREPARED 前
  'after-prepared',    // 2：PREPARED 后、写 staging 前
  'mid-staging',       // 3：staging 写到一半
  'after-staging',     // 4：staging 完成、校验前
  'after-verified',    // 5：校验通过、rename 前
  'mid-rename',        // 6：图已 rename、包未 rename
  'after-commit',      // 7：rename 完成、索引未更新
  'after-index',       // 8：索引已更新、源未删
]);

// `sha1File` 已移到 `./hash.mjs`（只有一份实现）；本文件按需 import。

/** 同卷 staging 路径：`<dst 所在目录>/.gs-staging/<txnId>/<dst 文件名>`（§1 的示例形态） */
export function stagingPathFor(dst, txnId) {
  return path.join(path.dirname(dst), STAGING_DIRNAME, txnId, path.basename(dst));
}

/**
 * 某个目录所在卷的剩余可用字节。**拿不到就返回 null**（不猜、不假装够）。
 *
 * ⚠️ 用**目标所在目录**而不是"卷根"：`path.parse('相对路径').root` 是 `''`，
 *    拿它去 `statfs` 会 ENOENT（实测踩过：整条流程因此静默 abort、日志为空、看不出原因）。
 *    目录本身对 statfs 完全够用，且相对/绝对路径都能工作。
 */
export function freeBytesOn(dir) {
  try {
    const st = fs.statfsSync(dir);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null;
  }
}

/**
 * §6：执行任何事务前，在**目标卷**上核算空间。
 *
 * ```
 * 需要空间 = Σ(staging 文件大小) + 索引重建期的新索引 + 新旧并存 + 模型缓存 + 撤销保留区
 * ```
 *
 * ⚠️ 规格里那几项**都是情境相关的输入** ⇒ 由调用方经 `extraBytes` 传入，
 *    **不在这里写死**（P3：不许硬编码应当可配置的值；而 11 MB / 1.7 GB 会随后续决策变化）。
 * ⚠️ **不额外加安全系数** —— 规格只写了"需要 X、可用 Y"的具体数字，加戏就等于改判据。
 *
 * @param {Array<{src:string,dst:string}>} files
 * @param {{extraBytes?:number}} [opts]
 * @returns {{ok:boolean, need:number, details:Array, reason?:string}}
 */
export function checkSpace(files, { extraBytes = 0 } = {}) {
  // 按**目标卷**归组：不同卷各有各的余量，不能拿一个卷的数字去判另一个卷
  const groups = new Map();
  for (const f of files) {
    const dir = path.resolve(path.dirname(f.dst));
    const vol = path.parse(dir).root || dir;
    const g = groups.get(vol) || { vol, dir, staged: 0 };
    g.staged += fs.statSync(f.src).size;
    groups.set(vol, g);
  }

  const details = [];
  for (const g of groups.values()) {
    const need = g.staged + Number(extraBytes) || g.staged;
    const free = freeBytesOn(g.dir);
    details.push({ vol: g.vol, dir: g.dir, staged: g.staged, extraBytes: Number(extraBytes) || 0, need, free });
    if (free === null) {
      return { ok: false, need, details, reason: `拿不到目标卷 ${g.vol} 的可用空间 —— 按规格 §6 不得贸然开始` };
    }
    if (free < need) {
      return { ok: false, need, details, reason: `目标卷 ${g.vol} 空间不足：需要 ${need} B、可用 ${free} B` };
    }
  }
  return { ok: true, need: details.reduce((n, d) => n + d.need, 0), details };
}

/**
 * 预检（§3 ①）：目标是否被占用 / 是否幂等命中。
 *
 * ⚠️ **不改入参** —— 返回 `idempotentIdx`（下标集合）而不是往调用方的对象上挂 `_idempotent` 字段。
 *    改别人的数据是隐性耦合，后面必然出怪事。
 */
export function preflight(files) {
  const idempotentIdx = new Set();
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i];
    // ⚠️ 源与目标是同一个路径 ⇒ **直接拒绝**。这种请求下"幂等命中"会成立，
    //    而收尾阶段的"删源"就会**把文件本身删掉** —— 那是丢素材。
    if (path.resolve(f.src) === path.resolve(f.dst)) {
      return { ok: false, reason: `源与目标相同（拒绝，避免收尾阶段把自己删掉）：${f.src}`, kind: 'same-path' };
    }
    if (!fs.existsSync(f.src)) return { ok: false, reason: `源不存在：${f.src}`, kind: 'missing-src' };
    if (!fs.existsSync(f.dst)) continue;                       // 目标空着：正常
    if (sha1File(f.src) !== sha1File(f.dst)) {
      // 规则 ②：**绝不覆盖不同内容**
      return { ok: false, reason: `目标已占用且字节不同：${f.dst}`, kind: 'dst-occupied' };
    }
    idempotentIdx.add(i);                                      // 规则 ②：字节相同 ⇒ 幂等命中，跳过**重写**
  }
  return { ok: true, idempotentIdx };
}

/**
 * 建一个执行器实例。
 *
 * @param {object} o
 * @param {string} o.journalDir   日志目录（**注入**；引擎不认 `%APPDATA%`）
 * @param {{update:Function}} o.indexPort 索引更新端口。**必填** —— 缺了它"CLEANED 前必须更新索引"无从保证
 * @param {(point:string)=>void} [o.onCrash] 故障注入：到达注入点后由调用方"杀死"本进程
 * @param {string|null} [o.crashAt] 要在哪个注入点杀（见 `CRASH_POINTS`）
 * @param {()=>number} [o.now]
 */
export function createTxnExecutor({
  journalDir,
  indexPort,
  onCrash = null,
  crashAt = null,
  now = Date.now,
} = {}) {
  if (!journalDir) throw new Error('createTxnExecutor: 必须注入 journalDir');
  if (!indexPort || typeof indexPort.update !== 'function') {
    throw new Error('createTxnExecutor: 必须注入 indexPort.update（否则无法保证"索引更新成功后才清源"）');
  }

  // ⚠️ `cleanStaging` 已移到 `./steps.mjs`（**只有一份实现**，恢复路径用的是同一份）。
  //    这里**不再**定义本地版本 —— 定义了就会遮蔽 import，于是"两条路径共用一份"变成空话。

  /**
   * 到达注入点。
   *
   * ⚠️⚠️ **`onCrash` 必须让进程"死掉"，不能只是抛异常。** 这是本模块最容易搞错的一处：
   *    抛异常会被调用点的 `catch` 接住（例如 rename 循环的 catch 会把它变成 `RECOVERY_NEEDED`），
   *    而**进程真被杀**时日志停留在被杀前的那个状态、没有任何 JS 收尾 ⇒ 恢复才能按 §4 前进。
   *    §8 因此明确要求"必须真的杀进程，不能只做代码评审"。
   *    ⇒ 本函数**只负责通知**；调用方（子进程）应当 `process.exit()` 或挂起等外部 kill。
   */
  const hit = (point) => {
    if (crashAt !== point) return;
    if (onCrash) onCrash(point);
    // 没有 onCrash ⇒ 显式抛，**不静默继续**（但要知道：这在语义上不等于"被杀"）
    throw new Error(`故障注入点未处理：${point}（注意：抛异常 ≠ 进程被杀，见 hit 的注释）`);
  };

  // ⚠️ "检查跃迁合法性 + write-ahead 落盘" 已提到 `journal.persistState` ——
  //    恢复路径用的是**同一份**（各写一份的话，合法性检查迟早有一边漏掉）。
  const persist = (rec, next, patch = {}) => persistState(journalDir, rec, next, patch, now());

  /**
   * 跑一次移动类事务。
   *
   * @param {object} req
   * @param {string} req.libId
   * @param {string} req.uid
   * @param {string} req.op  §1 的 op 之一（ingest | rename-id | move-folder | re-pair | replace-image | move-out | move-lib | restore）
   * @param {Array<{role:'image'|'archive', src:string, dst:string}>} req.files
   * @param {string} [req.txnId] 复用已有 id（恢复流程用）
   * @returns {{outcome:'committed'|'aborted'|'recovery_needed', txnId:string, rec:object, detail?:string}}
   */
  function runMove({ libId, uid, op, files = [], reason = '用户操作', txnId = null, extraBytes = 0 }) {
    ensureJournalDir(journalDir);
    if (files.length === 0) return { outcome: 'aborted', txnId, rec: null, detail: '没有文件要动' };

    // ── ① 预检（§3）────────────────────────────────────────────────
    const pre = preflight(files);
    if (!pre.ok) {
      // 预检失败 ⇒ **什么都没发生**（§8 第 1 例的期望）。不写日志、不动文件。
      return { outcome: 'aborted', txnId: txnId || makeTxnId(now()), rec: null, detail: pre.reason };
    }
    const idem = pre.idempotentIdx;
    const space = checkSpace(files, { extraBytes });
    if (!space.ok) return { outcome: 'aborted', txnId: txnId || makeTxnId(now()), rec: null, detail: space.reason };

    const id = txnId || makeTxnId(now());
    const t = now();
    let rec = {
      txnId: id, state: S.PREPARED, op, libId, uid, reason,
      createdAt: new Date(t).toISOString(), updatedAt: new Date(t).toISOString(),
      files: files.map((f, i) => ({
        role: f.role, src: f.src, dst: f.dst,
        stage: stagingPathFor(f.dst, id),
        size: fs.statSync(f.src).size,
        sha1: sha1File(f.src),
        stagedSha1: null,
        srcDeleted: false,
        _idempotent: idem.has(i),
      })),
      indexUpdate: { done: false, before: null, after: null },
      undoOf: null,
    };

    // ── ①′ 注入点 1：写 PREPARED **之前**被杀 ⇒ 什么都没发生
    hit('before-prepared');

    // ── ② PREPARED：写日志 + fsync（write-ahead）────────────────────
    writeTxn(journalDir, rec);
    hit('after-prepared');                               // 注入点 2：PREPARED 已落盘、还没动任何文件

    // ── ③ STAGED：复制到**目标卷**的 staging（不覆盖任何既有文件）────
    //
    // ⚠️ 顺序刻意如此：**先复制、复制完才把 STAGED 落盘** —— 因为规格 §2 定义
    //    `STAGED` = "目标卷上已写出暂存副本"。所以"复制到一半被杀"时日志仍停在 `PREPARED`
    //    ⇒ 恢复按 §4 走 ROLLBACK（清 staging、源不动），正是 §8 第 3 例的期望。
    try {
      for (const f of rec.files) {
        if (f._idempotent) continue;                    // 规则 ②：幂等命中，不重写
        fs.mkdirSync(path.dirname(f.stage), { recursive: true });
        // staging 已存在 ⇒ 只能是**同一事务**的上一次尝试留下的；比对后决定复用或重做
        if (fs.existsSync(f.stage)) {
          if (sha1File(f.stage) === f.sha1) continue;    // 幂等：已落盘且一致，跳过
          fs.rmSync(f.stage, { force: true });           // 不一致 ⇒ 是坏残留，删掉重做
        }
        fs.copyFileSync(f.src, f.stage);                 // ⚠️ 只复制，**不动源**
        hit('mid-staging');                              // 注入点 3：写到一半
      }
    } catch (err) {
      // staging 阶段出问题 ⇒ 还没动过任何最终文件 ⇒ 回退（**清 staging**，源不动）
      rec = persist(rec, S.ABORTED, { abortedAt: new Date(now()).toISOString(), abortReason: String(err && err.message) });
      cleanStaging(rec);
      return { outcome: 'aborted', txnId: id, rec, detail: String(err && err.message) };
    }

    // 回填 staging 的实际哈希，然后 **STAGED 落盘**（write-ahead：校验之前先记下"已暂存"）
    rec = persist(rec, S.STAGED, {
      files: rec.files.map((f) => ({
        ...f,
        stagedSha1: f._idempotent ? null : (fs.existsSync(f.stage) ? sha1File(f.stage) : null),
      })),
    });
    hit('after-staging');                                // 注入点 4：staging 完成、校验前

    // ── ④ VERIFIED：逐个比对 stagedSha1 == 源 sha1（§3 ④）──────────
    //    判定用**共享原语** `verifyStaged`（`recovery.mjs` 走的是同一份）
    const ver = verifyStaged(rec);
    if (!ver.ok) {
      rec = persist(rec, S.ABORTED, { abortReason: `校验失败：${rec.files[ver.bad[0]].dst}` });
      cleanStaging(rec);
      return { outcome: 'aborted', txnId: id, rec, detail: `校验失败：${rec.files[ver.bad[0]].dst}` };
    }
    rec = persist(rec, S.VERIFIED);                      // ← 这一步原先漏了，导致 STAGED→COMMITTED 非法跃迁
    hit('after-verified');                               // 注入点 5：校验通过、rename 前

    // ── ⑤ COMMITTED：rename staging → 最终名（同卷、单文件原子）────
    //    规则 ②（绝不覆盖不同内容 / 字节相同即幂等命中）在 `commitRenames` 里**只有一份实现**。
    //    ⚠️ 它**不抛**、而是返回 `{doneIdx, error}`：调用方必须知道"已经 rename 成功了几条"。
    const ren = commitRenames(rec, () => hit('mid-rename'));   // 注入点 6：逐个 rename 之间
    if (ren.error) {
      // ⚠️ 这里**不能 ABORT**：可能已有文件落到最终名（§2 明确 COMMITTED 之后不许回退）
      rec = persist(rec, S.RECOVERY_NEEDED, { recoveryReason: ren.error });
      return { outcome: 'recovery_needed', txnId: id, rec, detail: ren.error };
    }

    rec = persist(rec, S.COMMITTED, { committedAt: new Date(now()).toISOString() });
    hit('after-commit');                                 // 注入点 7：rename 完成、索引未更新

    // ── ⑥ 更新索引（同一事务内）；**失败则停在 COMMITTED，绝不去清源** ──
    //    规则 ① 的关键：`applyIndex` 失败时**绝不往下走到 cleanupSources**。
    const ix = applyIndex(indexPort, rec);
    if (!ix.ok) {
      rec = persist(rec, S.RECOVERY_NEEDED, { recoveryReason: ix.error });
      return { outcome: 'recovery_needed', txnId: id, rec, detail: ix.error };
    }
    rec = { ...rec, indexUpdate: { ...rec.indexUpdate, done: true } };
    writeTxn(journalDir, rec);
    hit('after-index');                                  // 注入点 8：索引已更新、源未删

    // ── ⑦ CLEANED：删源 + 审计（**规则 ① 现在才允许删源**）────────
    cleanupSources(rec);
    rec = persist(rec, S.CLEANED, { cleanedAt: new Date(now()).toISOString() });
    cleanStaging(rec);                                   // 收尾：staging 文件已被 rename 走，清掉空目录
    return { outcome: 'committed', txnId: id, rec, detail: null };
  }

  /**
   * 边界取消（§5）：**只在状态边界生效**；`COMMITTED` 之后不可取消。
   * 返回 `{cancelled:boolean, at:string}` —— 不可取消时**如实说不可以**，不假装成功。
   */
  function requestCancel(rec) {
    if (canCancel(rec.state)) return { cancelled: true, at: rec.state };
    return { cancelled: false, at: rec.state, reason: `状态 ${rec.state} 不可取消（§5：COMMITTED 之后必须把索引更新完）` };
  }

  return { runMove, requestCancel, journalDir, txnFile: (id) => txnPath(journalDir, id) };
}
