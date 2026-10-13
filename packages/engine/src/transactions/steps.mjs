// packages/engine/src/transactions/steps.mjs —— 事务流程里**共享的原语**（§2/§3）
//
// ── 为什么要有这个文件（不是为了整洁）──────────────────────────────────
//   同一套"校验 staging / 逐个 rename / 更新索引 / 清源"既被**正常路径**（`executor.mjs`）
//   用到，也被**恢复路径**（`recovery.mjs`）用到。
//   如果在两处各写一遍，就等于把规格 §3 那**两条不可动摇的规则**实现两次：
//     ① 源文件在 COMMITTED 且索引更新成功之前绝不删除
//     ② 绝不覆盖已存在的不同内容文件
//   两份实现迟早会有一份漏掉某条 —— 而这类 bug 的表现是**用户素材丢失**。
//   ⇒ 所以这几个步骤**只能有一份实现**，两条路径都调它。
//
// ⚠️ 本目录是引擎里唯一允许出现 fs 写 API 的地方（§9）。
import fs from 'node:fs';
import path from 'node:path';

import { sha1File } from './hash.mjs';
import { isAmbiguous } from './states.mjs';

/** staging 目录名。⚠️ 与 `executor.mjs` 的**必须一致** —— 所以这里导出，那边 import，不各写一份。 */
export const STAGING_DIRNAME = '.gs-staging';

/**
 * 清 staging（§2 `ABORTED（清 staging，源保持不动）` / §4 `PREPARED → 回退（删 staging）`）。
 * 只删**本次事务自己的**暂存文件与那个空的 `<txnId>` 目录 —— **不递归删父目录**
 * （`.gs-staging/` 下可能还有别的未完成事务）。
 */
export function cleanStaging(rec) {
  for (const f of rec.files || []) {
    try { if (f.stage && fs.existsSync(f.stage)) fs.rmSync(f.stage, { force: true }); } catch { /* 删不掉不致命 */ }
  }
  const dirs = new Set((rec.files || []).map((f) => (f.stage ? path.dirname(f.stage) : null)).filter(Boolean));
  for (const d of dirs) {
    try { if (fs.existsSync(d) && fs.readdirSync(d).length === 0) fs.rmdirSync(d); } catch { /* 同上 */ }
    // 父目录 `.gs-staging/` 若也空了就一并收掉 —— 素材库里少留一点我们自己的东西。
    // ⚠️ `rmdir` **只在空目录时成功**，所以并发场景下竞争失败是安全的（不会删掉别人的 staging）。
    const parent = path.dirname(d);
    try {
      if (path.basename(parent) === STAGING_DIRNAME && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
        fs.rmdirSync(parent);
      }
    } catch { /* 同上 */ }
  }
}

/**
 * §3 ④ 校验：逐个比对 `stagedSha1 == 源 sha1`（PREPARED 时记下的 `sha1`）。
 * 纯判定，不动文件。返回坏掉的条目下标。
 */
export function verifyStaged(rec) {
  const bad = [];
  (rec.files || []).forEach((f, i) => {
    if (f._idempotent) return;
    if (!f.stagedSha1 || f.stagedSha1 !== f.sha1) bad.push(i);
  });
  return { ok: bad.length === 0, bad };
}

/**
 * §3 ⑤ 逐个 rename staging → 最终名。
 *
 * ⚠️ 规则 ② 在这里：目标是**已存在**的文件时，字节相同 ⇒ 幂等命中跳过；字节不同 ⇒ **拒绝覆盖**。
 * ⚠️ 返回 `{doneIdx, error}` 而**不是**抛 —— 调用方需要知道"已经 rename 成功了几条"
 *    （§3 第 5 条：图已 rename、包未 rename 时**只能前进**，不能回滚）。
 */
export function commitRenames(rec, onEach = null) {
  const doneIdx = [];
  for (let i = 0; i < rec.files.length; i += 1) {
    const f = rec.files[i];
    if (f._idempotent) { doneIdx.push(i); continue; }
    if (!fs.existsSync(f.stage)) {
      // staging 不在：要么已经 rename 过（目标在且字节一致），要么数据丢了（由歧义判定处理）
      if (fs.existsSync(f.dst) && sha1File(f.dst) === f.sha1) { doneIdx.push(i); continue; }
      return { doneIdx, error: `staging 与目标都不在：${f.dst}` };
    }
    if (fs.existsSync(f.dst)) {
      if (sha1File(f.dst) === f.sha1) {                 // 规则 ②：幂等命中
        try { fs.rmSync(f.stage, { force: true }); } catch { /* 不影响正确性 */ }
        doneIdx.push(i);
        continue;
      }
      return { doneIdx, error: `目标已被占用且字节不同（绝不覆盖）：${f.dst}` };
    }
    try {
      fs.renameSync(f.stage, f.dst);                    // 同卷、单文件原子
    } catch (e) {
      return { doneIdx, error: `rename 失败：${f.dst} —— ${e && e.message}` };
    }
    doneIdx.push(i);
    if (onEach) onEach(i);                              // 故障注入点挂在两条 rename 之间
  }
  return { doneIdx, error: null };
}

/**
 * §3 ⑥ 更新索引。**失败必须被调用方看见** —— 规则 ① 说索引更新成功之前不许清源。
 * 返回值刻意是 `{ok, error}` 而不是抛：抛出去会被上层误当成"可以回滚"。
 */
export function applyIndex(indexPort, rec) {
  if (rec.indexUpdate && rec.indexUpdate.done) return { ok: true, skipped: true };
  try {
    indexPort.update({
      txnId: rec.txnId, libId: rec.libId, uid: rec.uid, op: rec.op,
      files: (rec.files || []).map((f) => ({ role: f.role, src: f.src, dst: f.dst })),
    });
    return { ok: true, skipped: false };
  } catch (e) {
    return { ok: false, error: `索引更新失败：${e && e.message}` };
  }
}

/**
 * §3 ⑦ 删源。**调用方必须先确认 `COMMITTED` 且索引更新成功**（规则 ①）——
 * 本函数不自己检查状态，因为那是调用点的责任，藏在这里反而会让"谁负责"变模糊。
 *
 * ⚠️ **幂等命中的条目也要清源**：规则 ② 说的是"跳过该文件**不要重写**"，不是"这条不用收尾"。
 *    中断后重试时，已 rename 过去的文件正是靠这一步把源删掉；漏了它就会留一份重复文件。
 * ⚠️⚠️ **`src === dst` 时绝不删** —— 那种请求下"删源"等于删掉文件本身。
 *    （`preflight` 已经会拒绝这种请求，这里是第二道锁：宁可留下文件，也不可删错。）
 * 返回被真正删掉的下标；已删过的（`srcDeleted`）跳过 ⇒ 幂等。
 */
export function cleanupSources(rec) {
  const deleted = [];
  rec.files.forEach((f, i) => {
    if (f.srcDeleted) return;                           // 幂等：已删过
    if (path.resolve(f.src) === path.resolve(f.dst)) return;   // 第二道锁：绝不删"源即目标"
    if (fs.existsSync(f.src)) { fs.rmSync(f.src, { force: true }); deleted.push(i); }
    f.srcDeleted = true;
  });
  return deleted;
}

/** staging 是否还在盘上（恢复时判"要不要继续往前推"） */
export const stagingExists = (f) => Boolean(f.stage) && fs.existsSync(f.stage);

/**
 * 记录是否**完整到可以据它恢复**。
 *
 * ⚠️ 为什么需要这个：日志条目缺字段时（典型成因：`JSON.stringify` 丢掉了值为 `undefined` 的键），
 *    `verifyStaged` 会拿 `undefined` 去比哈希 ⇒ 判成"校验不一致" ⇒ **一个合法事务被静默 ABORT**，
 *    而且理由显示的是"校验失败"，根本看不出真实原因是**记录不完整**。
 *    ⇒ 记录不完整 = "无法识别的状态"，按 §4 的精神**必须停下来问人**，不许猜。
 *
 * @returns {{ok:boolean, missing:string[]}} `missing` 形如 `files[0].sha1`
 */
export function validateRecord(rec) {
  const missing = [];
  if (!rec || typeof rec !== 'object') return { ok: false, missing: ['(记录本身)'] };
  if (!rec.txnId) missing.push('txnId');
  if (typeof rec.state !== 'string') missing.push('state');
  if (!Array.isArray(rec.files)) missing.push('files');
  else {
    rec.files.forEach((f, i) => {
      for (const k of ['src', 'dst', 'stage', 'sha1']) {
        if (f == null || f[k] === undefined || f[k] === null) missing.push(`files[${i}].${k}`);
      }
    });
  }
  return { ok: missing.length === 0, missing };
}

/**
 * §4 的**歧义判定**（逐文件）：`源与目标都存在且字节不同` 或 `staging 丢失但源也不在`
 * ⇒ 判定不唯一 ⇒ 必须进 `RECOVERY_NEEDED` **停下问人，绝不猜**。
 *
 * 只读，不动任何文件。返回明细（哪一条、缺什么），因为 §4 要求界面能列出来。
 */
export function assessAmbiguity(rec) {
  const details = [];
  (rec.files || []).forEach((f, i) => {
    const srcExists = fs.existsSync(f.src);
    const dstExists = fs.existsSync(f.dst);
    const stageExists = stagingExists(f);
    let sameBytes = null;
    if (srcExists && dstExists) sameBytes = sha1File(f.src) === sha1File(f.dst);
    // ⚠️ 目标是否"就是期望的那份字节" —— 用来区分"rename 已完成"与"数据不知去向"。
    //    只有源不在时才需要算（否则不影响判定，算了也是白读盘）。
    let dstHasExpectedBytes = null;
    if (!srcExists && dstExists) dstHasExpectedBytes = f.sha1 ? (sha1File(f.dst) === f.sha1) : null;

    if (!isAmbiguous({ srcExists, dstExists, sameBytes, stagingExists: stageExists, dstHasExpectedBytes })) return;
    details.push({
      index: i, role: f.role, src: f.src, dst: f.dst, stage: f.stage,
      srcExists, dstExists, stagingExists: stageExists, sameBytes, dstHasExpectedBytes,
      reason: (srcExists && dstExists && sameBytes === false)
        ? '源与目标都存在且字节不同'
        : 'staging 丢失、源也不在，且目标不是期望的内容（数据去向不明）',
    });
  });
  return { ambiguous: details.length > 0, details };
}
