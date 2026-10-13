// packages/engine/src/transactions/recovery.mjs —— 启动恢复（规格 §4）
//
// 规格 §4 的判定表：
// ```
// 读取 state
//  ├ 终态（CLEANED / ABORTED）            → 归档日志，不动文件
//  ├ PREPARED                             → 回退（删 staging）
//  ├ STAGED                               → 校验 staging；一致则前进，不一致则回退
//  ├ VERIFIED / COMMITTED                 → 前进（完成 rename + 索引 + 清理源）
//  └ 判定不唯一（源与目标都存在且字节不同，或 staging 丢失但源已不在）
//                                          → RECOVERY_NEEDED：界面弹「待处理操作」
//                                            列出：库、uid、源、目标、缺什么
// ```
//
// **两条硬要求**：
//   · **幂等**（§4）：同一个事务恢复两次，结果一致，且不会把已完成的动作再做一遍
//     —— 靠 `srcDeleted` / `stagedSha1` / `indexUpdate.done` 这些标记判定。
//   · **不静默**（§4）：每次启动若有未完成事务，必须给出明确提示（本函数把 `pending` 交出去）。
//
// ⚠️ 本文件**不自己实现**任何文件操作：校验/rename/索引/清源全部调 `steps.mjs` 的共享原语。
//    那些原语里装着规格 §3 的**两条不可动摇的规则**，恢复路径与正常路径必须是同一份实现。
import { S, ACTION, recoveryActionOf } from './states.mjs';
import { listTxns, persistState, archiveTxn, writeTxn } from './journal.mjs';
import {
  cleanStaging, verifyStaged, commitRenames, applyIndex, cleanupSources, assessAmbiguity, validateRecord,
} from './steps.mjs';

/** 把"待处理"整理成界面能直接展示的形状（§4：库、uid、源、目标、缺什么） */
function describePending(rec, reason, ambiguity = null) {
  return {
    txnId: rec.txnId,
    libId: rec.libId,
    uid: rec.uid,
    op: rec.op,
    state: rec.state,
    reason,
    ambiguity: ambiguity ? ambiguity.details : [],
    files: (rec.files || []).map((f) => ({
      role: f.role,
      src: f.src,
      dst: f.dst,
      stage: f.stage,
      srcExists: !f.srcDeleted,
      missing: [
        f.srcDeleted ? 'src(已清理)' : null,
        f.stage ? 'stage' : null,
      ].filter(Boolean),
    })),
  };
}

/**
 * 扫描日志并恢复。
 *
 * @param {object} o
 * @param {string} o.journalDir
 * @param {{update:Function}} o.indexPort 与执行器**同一个**端口（唯一索引写入口）
 * @param {()=>number} [o.now]
 * @returns {{results:Array, pending:Array, broken:Array, summary:object}}
 */
export function recoverJournal({ journalDir, indexPort, now = Date.now } = {}) {
  if (!journalDir) throw new Error('recoverJournal: 必须注入 journalDir');
  if (!indexPort || typeof indexPort.update !== 'function') {
    throw new Error('recoverJournal: 必须注入 indexPort.update（前进路径要更新索引）');
  }

  const { txns, broken } = listTxns(journalDir);
  const results = [];
  const pending = [];
  const iso = () => new Date(now()).toISOString();

  /** 前进：把一条已到 VERIFIED/COMMITTED 的事务**做完**（§4「前进（完成 rename + 索引 + 清理源）」） */
  const advance = (rec) => {
    // ① 歧义先判：判不出来就停下问人，绝不猜
    const amb = assessAmbiguity(rec);
    if (amb.ambiguous) {
      let cur = rec;
      if (cur.state !== S.RECOVERY_NEEDED) {
        cur = persistState(journalDir, cur, S.RECOVERY_NEEDED, { recoveryReason: '判定不唯一', ambiguity: amb.details }, now());
      }
      pending.push(describePending(cur, '恢复时判定不唯一', amb));
      return { outcome: 'recovery_needed', rec: cur, action: ACTION.ASK_HUMAN };
    }

    // ② 把还没 rename 的补上（**幂等**：已经 rename 过去的条目会被 `commitRenames` 跳过）
    const ren = commitRenames(rec);
    if (ren.error) {
      const cur = persistState(journalDir, rec, S.RECOVERY_NEEDED, { recoveryReason: ren.error }, now());
      pending.push(describePending(cur, ren.error));
      return { outcome: 'recovery_needed', rec: cur, action: ACTION.ADVANCE };
    }

    // ③ VERIFIED → COMMITTED
    let cur = rec.state === S.VERIFIED ? persistState(journalDir, rec, S.COMMITTED, { committedAt: iso() }, now()) : rec;

    // ④ 索引（**幂等**：`indexUpdate.done` 已为真就跳过，不会重复写索引）
    const ix = applyIndex(indexPort, cur);
    if (!ix.ok) {
      cur = persistState(journalDir, cur, S.RECOVERY_NEEDED, { recoveryReason: ix.error }, now());
      pending.push(describePending(cur, ix.error));
      return { outcome: 'recovery_needed', rec: cur, action: ACTION.ADVANCE };
    }
    if (!ix.skipped) {
      cur = { ...cur, indexUpdate: { ...cur.indexUpdate, done: true } };
      // ⚠️ 这里**不能**用 `persistState`：状态仍是 COMMITTED（没变），而 `persistState` 会因
      //    "原地不动不算跃迁" 直接抛。但**内容变了**（indexUpdate.done）⇒ 必须落盘，
      //    否则下次恢复会重复更新索引。用 `writeTxn` 直接写。
      writeTxn(journalDir, cur);
    }

    // ⑤ 清源（**幂等**：`srcDeleted` 已为真的条目跳过）+ CLEANED
    cleanupSources(cur);
    cur = persistState(journalDir, cur, S.CLEANED, { cleanedAt: iso(), recoveredAt: iso() }, now());
    // ⚠️ 收尾必须清 staging —— 正常路径里有这一步，恢复路径**原先漏了**，
    //    结果空的 `.gs-staging/<txnId>` 留在素材库里（故障注入用例 FI after-staging/after-verified 抓到）。
    cleanStaging(cur);
    archiveTxn(journalDir, cur.txnId);
    return { outcome: 'committed', rec: cur, action: ACTION.ADVANCE };
  };

  for (const rec of txns) {
    const action = recoveryActionOf(rec.state);
    try {
      // ⚠️ **先查记录完整性**：不完整的记录不能据它动文件（否则缺 `sha1` 会被误读成"校验不一致"，
      //    把一个合法事务静默 ABORT 掉，且理由是假的）。按 §4 的精神 ⇒ 停下问人。
      const v = validateRecord(rec);
      if (!v.ok) {
        pending.push(describePending(rec, `日志记录不完整（缺 ${v.missing.join('、')}）—— 无法据它安全恢复`));
        results.push({ txnId: rec.txnId, state: rec.state, action: ACTION.ASK_HUMAN, outcome: 'recovery_needed' });
        continue;
      }
      if (action === ACTION.ARCHIVE) {
        archiveTxn(journalDir, rec.txnId);                    // 终态：只归档，不动文件
        results.push({ txnId: rec.txnId, state: rec.state, action, outcome: 'archived' });
        continue;
      }
      if (action === ACTION.ASK_HUMAN) {
        pending.push(describePending(rec, '恢复判定不唯一：需要人来决定（重试 / 回退 / 保留现状）'));
        results.push({ txnId: rec.txnId, state: rec.state, action, outcome: 'recovery_needed' });
        continue;
      }
      if (action === ACTION.ROLLBACK) {
        // PREPARED：计划已写盘、尚未动任何最终文件 ⇒ 删 staging，源不动，落到 ABORTED
        cleanStaging(rec);
        const cur = persistState(journalDir, rec, S.ABORTED, { recoveredAt: iso(), recoveryReason: 'PREPARED 中断 ⇒ 回退' }, now());
        archiveTxn(journalDir, cur.txnId);
        results.push({ txnId: rec.txnId, state: rec.state, action, outcome: 'aborted' });
        continue;
      }
      if (action === ACTION.VERIFY) {
        // STAGED：先判歧义，再校验 staging
        const amb = assessAmbiguity(rec);
        if (amb.ambiguous) {
          const cur = persistState(journalDir, rec, S.RECOVERY_NEEDED, { recoveryReason: '判定不唯一', ambiguity: amb.details }, now());
          pending.push(describePending(cur, '恢复时判定不唯一', amb));
          results.push({ txnId: rec.txnId, state: rec.state, action, outcome: 'recovery_needed' });
          continue;
        }
        const ver = verifyStaged(rec);
        if (!ver.ok) {
          cleanStaging(rec);
          const cur = persistState(journalDir, rec, S.ABORTED, { recoveredAt: iso(), recoveryReason: 'staging 校验不一致 ⇒ 回退' }, now());
          archiveTxn(journalDir, cur.txnId);
          results.push({ txnId: rec.txnId, state: rec.state, action, outcome: 'aborted' });
          continue;
        }
        // 一致 ⇒ 前进到 VERIFIED，然后走"把它做完"
        const v = persistState(journalDir, rec, S.VERIFIED, { recoveredAt: iso() }, now());
        const r = advance(v);
        results.push({ txnId: rec.txnId, state: rec.state, action, outcome: r.outcome });
        continue;
      }
      // VERIFIED / COMMITTED
      const r = advance(rec);
      results.push({ txnId: rec.txnId, state: rec.state, action, outcome: r.outcome });
    } catch (e) {
      // 恢复本身出错 ⇒ 如实报出来，**绝不吞掉**（"不静默"是 §4 的明文要求）
      results.push({ txnId: rec.txnId, state: rec.state, action, outcome: 'error', detail: String(e && e.message) });
      pending.push(describePending(rec, `恢复过程出错：${e && e.message}`));
    }
  }

  const summary = {
    scanned: txns.length,
    archived: results.filter((r) => r.outcome === 'archived').length,
    aborted: results.filter((r) => r.outcome === 'aborted').length,
    committed: results.filter((r) => r.outcome === 'committed').length,
    recoveryNeeded: results.filter((r) => r.outcome === 'recovery_needed').length,
    broken: broken.length,
  };
  return { results, pending, broken, summary };
}
