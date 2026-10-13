// packages/engine/src/fake.mjs —— 契约 §8 要求的「模拟模式」（`createEngine({ fake: true })`）
//
// ── 为什么需要它（这不是"测试便利"，是**契约欠账**）──────────────────────
//   `docs/spec/CONTRACT-engine-v1.md` §8 写着：
//     「契约要求提供两份可注入的东西，让 **P3a–P3d 独立开发**」
//     「**P3 的验收依赖它**：界面在 `fake:true` 下必须能演示全部状态
//       （空、加载、无结果、无索引、索引损坏、`RECOVERY_NEEDED`、`COMPAT_MISMATCH`、部分成功）」
//   而 2026-10-13 实测：引擎里**零** `fake`、`fixtures/` 不存在 ⇒ 这条从没实现过。
//   没有它，P3c/P3d 就只能靠"人工 `npm run dev` 对着真库看"—— 那既不可复跑，也没法进 `npm test`。
//   ⇒ 本文件补的正是这一块。它同时解开 P3d 的死结：`indexStart` 的真实实现要 ONNX 模型，
//     而 P3d 的验收（阶段条/进度/ETA/失败项/取消）**只需要事件流的形状**。
//
// ── ⚠️ 四条硬约束（都能被测试证明，别削弱）────────────────────────────
//   ① **绝不触碰真实文件系统**（契约 §8 原文）。
//      本模块只在**可选**的 `loadSampleIndex()` 里读一次 fixture 文件；**核心路径零 fs**。
//      可证的判据（见 `tests/fake.test.mjs`）：库根是合成值 `Z:\__fake_library__`，**且测试先断言它不存在**。
//      若任何代码路径真的去解析库根，`requireExistingRoot`/`readFileSync` 会当场抛
//      ⇒ "在库根不存在的前提下全部方法都成功" **就是**"没碰真实文件系统"的证据。
//   ② **不改行为**：真实模式（`fake:false`，默认）一行都不走这里。
//   ③ **不重复实现**：`bandOf` 由 `engine.mjs` **注入**（引擎的设计原则就是"依赖全部注入"，
//      见 `engine.mjs:3`）。本模块不自己算档位阈值 —— 那会造出第二份阈值（P2/F-02 的教训）。
//   ④ ⚠️ **必须返回完整信封 `ok(...)`**。`envelope(fn)` 只是 `return await fn()`
//      （`errors.mjs:94-101`），**不做包装** —— 内部函数返回裸对象会让调用方拿到
//      `{tookMs:…}` 而不是 `{ok:true,data:…}`，症状是**处处 `undefined`**。
//      第一次写本文件就是这么错的（11 条测试全红在 "Cannot read properties of undefined"）。
//
// ── 数据来源 ─────────────────────────────────────────────────────────
//   `fixtures/sample-index.json`（契约点名的路径）。也可由调用方直接传 `fixture` 对象
//   ⇒ 测试不依赖文件路径解析。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ERR, fail, ok } from './errors.mjs';

/** 仓库根的 `fixtures/sample-index.json`（本文件在 packages/engine/src/ ⇒ 上溯三层） */
export const DEFAULT_FIXTURE_PATH = fileURLToPath(new URL('../../../fixtures/sample-index.json', import.meta.url));

/** 读样例索引。**这是本模块唯一碰 fs 的地方**，且只读仓库内的 fixture，不碰素材库。 */
export function loadSampleIndex(file = DEFAULT_FIXTURE_PATH) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 把 fixture 的扁平 items 按库分组 */
function groupByLib(fixture) {
  const byLib = new Map();
  for (const it of fixture.items || []) {
    if (!byLib.has(it.libId)) byLib.set(it.libId, []);
    byLib.get(it.libId).push(it);
  }
  return byLib;
}

/**
 * 创建一个"模拟引擎"的内部实现。返回的函数**形状与 engine.mjs 里那些内部函数一致**：
 * 返回 `ok(...)` 信封，或抛 `fail(...)`（由 `envelope()` 转成错误信封）。
 *
 * ⚠️ 全部依赖注入 —— 本模块**不 import** `engine.mjs`（避免循环依赖）。
 *
 * @param {object} o
 * @param {object} [o.fixture]      样例索引；缺省从 `DEFAULT_FIXTURE_PATH` 读
 * @param {(e: object) => void} [o.onEvent] 事件出口（真实模式由主进程 `webContents.send` 转发）
 * @param {() => number} [o.now]
 * @param {(score:number, mode:string) => string} o.bandOf  **必须注入**（见文件头 ③）
 * @param {number} [o.intervalMs]   进度的推进间隔；缺省取 fixture 的 `jobs.intervalMs`
 * @param {Function} [o.setTimer]   定时器注入（测试用假时钟把它变确定）
 * @param {Function} [o.clearTimer]
 */
export function createFakeKit({
  fixture = null,
  onEvent = () => {},
  now = () => Date.now(),
  bandOf,
  intervalMs = null,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof bandOf !== 'function') {
    throw new TypeError('createFakeKit 需要注入 bandOf（别在本模块里重算档位阈值 —— 那会造出第二份阈值）');
  }
  const data = fixture || loadSampleIndex();
  const byLib = groupByLib(data);
  const root = data.root || 'Z:\\__fake_library__';
  const jobCfg = data.jobs || {};
  const tickMs = intervalMs ?? jobCfg.intervalMs ?? 400;

  // ── 内存态（`ingest`/`mutate` 只改这里；进程退出即消失，永不落盘）────────
  const itemsByLib = new Map();
  for (const [libId, list] of byLib) itemsByLib.set(libId, list.map((it) => ({ ...it })));
  /** 未收尾的事务（用于演示 `RECOVERY_NEEDED` 那条路） */
  let pendingTx = data.pendingTx ? { ...data.pendingTx } : null;
  const txLog = [];
  const jobs = new Map();
  let jobSeq = 0;

  /** 与 `LibraryRegistry` **同形状**的最小实现（engine.mjs 只用到这四个方法） */
  const registry = {
    list: () => (data.libs || []).map((l) => ({ libId: l.libId, label: l.label, root })),
    has: (libId) => (data.libs || []).some((l) => l.libId === libId),
    get: (libId) => {
      const l = (data.libs || []).find((x) => x.libId === libId);
      if (!l) throw fail(ERR.LIB_NOT_FOUND, `库不存在：${libId}`, { libId });
      return { libId: l.libId, label: l.label, root };
    },
    // ⚠️ **故意不检查磁盘** —— 模拟模式的库根本来就不存在。
    //    这正是"绝不触碰真实文件系统"的可证形态：不检查，就不会误碰。
    requireExistingRoot: (libId) => {
      if (!registry.has(libId)) throw fail(ERR.LIB_NOT_FOUND, `库不存在：${libId}`, { libId });
    },
  };

  /** 与真实 `load()` 返回的 entry 同形状（保证 `byUid` / `items` / `dim` 等字段可用） */
  function load(libId) {
    const meta = (data.libs || []).find((l) => l.libId === libId);
    if (!meta) throw fail(ERR.LIB_NOT_FOUND, `库不存在：${libId}`, { libId });
    // 「索引损坏的库」——界面必须能演示这个状态（契约 §8）
    if (meta.state === 'corrupt') throw fail(ERR.INDEX_CORRUPT, `索引损坏（模拟）：${libId}`, { libId });
    const items = itemsByLib.get(libId) || [];
    const byUid = new Map(items.map((it) => [it.uid, it]));
    const vectors = items.map((it, i) => ({ row: it.vectorRow ?? i }));
    const compatBase = {
      model_revision: data.encoding?.modelRevision ?? 'fake',
      dtype: data.encoding?.dtype ?? 'q4f16',
      preprocess_version: data.encoding?.preprocessVersion ?? 2,
      seq: data.encoding?.seq ?? 140,
    };
    return {
      libId,
      dir: `${root}\\${libId}`,
      header: {
        dim: meta.dim,
        model_revision: compatBase.model_revision,
        dtype: compatBase.dtype,
        preprocess_version: compatBase.preprocess_version,
        seq: compatBase.seq,
        built_at: 1760000000000,
        // L2 刻意与 L1 的 compat 不同 ⇒ 演示 `COMPAT_MISMATCH`（契约 §6）
        compat: meta.state === 'compat-mismatch'
          ? { model_revision: 'other', dtype: 'fp32', preprocess_version: 1, seq: 280 }
          : compatBase,
      },
      items,
      vectors,
      count: items.length,
      dim: meta.dim,
      meta: { failed: (jobCfg.failAt || []).map((i) => ({ relPath: items[i]?.relPath ?? `#${i}` })) },
      byUid,
      rowToRel: new Map(items.map((it, i) => [it.vectorRow ?? i, it.relPath])),
    };
  }

  /** 固定排序的检索（契约 §8：`search 返回固定排序`）。不依赖向量 ⇒ 不需要模型。 */
  function doSearch(req = {}) {
    const mode = req.mode || 'text';
    const topK = Math.max(1, Math.min(200, Number(req.topK) || 50));
    const only = req.libIds && req.libIds.length ? req.libIds : (data.libs || []).map((l) => l.libId);
    const libsUsed = [];
    const libsSkipped = [];
    const scored = [];
    for (const libId of only) {
      const meta = (data.libs || []).find((l) => l.libId === libId);
      if (!meta) continue;
      if (meta.state === 'corrupt') {
        libsSkipped.push({ libId, reason: { kind: 'unavailable', code: ERR.INDEX_CORRUPT, detail: '索引损坏（模拟）' } });
        continue;
      }
      if (meta.state === 'compat-mismatch') {
        libsSkipped.push({ libId, reason: { kind: 'incompatible', code: ERR.COMPAT_MISMATCH, detail: 'compat 与基准库不符（模拟）' } });
        continue;
      }
      libsUsed.push(libId);
      const items = itemsByLib.get(libId) || [];
      // 固定顺序：按 fixture 顺序，分数线性递减 —— **可复现**，测试才能断言
      items.forEach((it, i) => {
        const score = Number(Math.max(0.5, 0.99 - i * 0.01).toFixed(6));
        scored.push({ libId, item: it, score });
      });
    }
    // 「无结果」分支：查询词里含 `__empty__` 就返回空 —— 界面要能演示空状态（契约 §8）
    const empty = typeof req.text === 'string' && req.text.includes('__empty__');
    const top = empty ? [] : scored.slice(0, topK);
    return ok({
      tookMs: 3,
      libsUsed,
      libsSkipped,
      results: top.map((r) => ({
        libId: r.libId,
        uid: r.item.uid,
        score: r.score,
        band: bandOf(r.score, mode),
        relPath: r.item.relPath,
        folder: r.item.folder,
        stem: r.item.stem,
        imageExt: r.item.imageExt,
        imageSize: r.item.imageSize,
        vectorSource: r.item.vectorSource || 'native',
        archive: r.item.archiveRelPath
          ? { relPath: r.item.archiveRelPath, ext: r.item.archiveExt, size: r.item.archiveSize }
          : null,
      })),
    });
  }

  function findItem({ libId, uid } = {}) {
    const e = load(libId);
    const it = e.byUid.get(uid);
    if (!it) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${uid}`, { libId, uid });
    return it;
  }

  /**
   * 单条元数据。⚠️ **不返回绝对路径** —— 那是 `itemPaths` 的职责（见契约 §2.2a）。
   *
   * ⚠️⚠️ **字段集合必须与真实引擎的 `item` 逐字一致**。我第一版在这里多加了 `indexState`,
   *   那会造成最坏的一种假绿：**页面在模拟模式下能跑、在真库上拿到 `undefined`**。
   *   "索引状态"是**派生**的（`exists.image` + 一次 `scan` 的差异），归 Operation 层
   *   （`renderer/src/utils/index-state.js`），不归引擎。
   *   `tests/fake.test.mjs` 的 **F12** 钉住这条"真假同形"。
   */
  function doItem(req = {}) {
    const it = findItem(req);
    const missing = new Set((data.scan?.[req.libId]?.missing) || []);
    return ok({
      libId: req.libId, uid: it.uid, relPath: it.relPath, folder: it.folder, stem: it.stem,
      imageExt: it.imageExt, imageSize: it.imageSize, imageMtime: it.imageMtime,
      vectorSource: it.vectorSource || 'native',
      archive: it.archiveRelPath
        ? { relPath: it.archiveRelPath, ext: it.archiveExt, size: it.archiveSize, mtime: it.archiveMtime }
        : null,
      exists: {
        image: !missing.has(it.uid),
        archive: Boolean(it.archiveRelPath) && !missing.has(it.uid),
      },
    });
  }

  /** 两条绝对路径。⚠️ **单独的方法**：契约 §0「路径只能由 lib_id+uid 解析」，不主动到处泄 */
  function doItemPaths(req = {}) {
    const it = findItem(req);
    const missing = new Set((data.scan?.[req.libId]?.missing) || []);
    const gone = missing.has(it.uid);
    return ok({
      libId: req.libId,
      uid: it.uid,
      imagePath: `${root}\\${it.relPath}`,
      archivePath: it.archiveRelPath ? `${root}\\${it.archiveRelPath}` : null,
      exists: { image: !gone, archive: Boolean(it.archiveRelPath) && !gone },
    });
  }

  function doIndexStatus() {
    // ⚠️ `compat` 必须是**与真实引擎同形**的 8 段竖线串（`compat.mjs` 的 `COMPAT_FIELDS` 顺序）：
    //    model_repo|model_revision|model_weights_dtype|preprocessing_version|seq_length|dim|normalization|pooling
    //    我第一版返回了 `'fake'` 一个词 —— 那会让"在模拟模式下能显示、在真库上格式完全不同"。
    //    `tests/fake.test.mjs` 的 **F13** 拿 `COMPAT_FIELDS` 逐段核对。
    const seg = (l) => [
      'demo-repo',
      l.state === 'compat-mismatch' ? 'other-rev' : (data.encoding?.modelRevision ?? 'demo-rev-1'),
      l.state === 'compat-mismatch' ? 'fp32' : (data.encoding?.dtype ?? 'q4f16'),
      String(l.state === 'compat-mismatch' ? 1 : (data.encoding?.preprocessVersion ?? 2)),
      String(l.state === 'compat-mismatch' ? 280 : (data.encoding?.seq ?? 140)),
      String(l.dim ?? ''),
      l.state === 'compat-mismatch' ? 'none' : 'l2',
      l.state === 'compat-mismatch' ? 'cls' : 'mean',
    ].join('|');
    const libs = (data.libs || []).map((l) => {
      let indexed = 0, encoded = 0, problems = [];
      try {
        const e = load(l.libId);
        indexed = e.items.length;
        encoded = e.count;
      } catch (err) {
        problems = [{ code: err.code, message: err.message }];
      }
      return {
        libId: l.libId, label: l.label, root, rootExists: true,
        indexed, encoded, dim: l.dim,
        // ⚠️ 索引读不出来的库，真实引擎返回 **`compat: null`**（`compatComplete` 为假时），
        //    而不是一个"带空段的串"。空段是我第二版犯的错，F13 当场抓到。
        compat: l.state === 'corrupt' ? null : seg(l),
        builtAt: 1760000000000,
        failed: (jobCfg.failAt || []).length,
        healthy: l.state === 'healthy' && problems.length === 0 && indexed === encoded,
        problems,
      };
    });
    return ok({ libs });
  }

  function doScan({ libId } = {}) {
    const meta = (data.libs || []).find((l) => l.libId === libId);
    if (!meta) throw fail(ERR.LIB_NOT_FOUND, `库不存在：${libId}`, { libId });
    const d = (data.scan || {})[libId] || { added: [], changed: [], missing: [] };
    return ok({ libId, added: d.added || [], changed: d.changed || [], missing: d.missing || [] });
  }

  // ── 长任务：假进度（契约 §8「indexStart 发假进度（约 10 s 走完）」）────────
  function emit(ev) { onEvent(ev); }

  function recoveryDetails(libId) {
    return {
      libId, txId: pendingTx.txId, state: pendingTx.state,
      startedAt: pendingTx.startedAt,
      canUndo: Boolean(pendingTx.canUndo), canRollback: Boolean(pendingTx.canRollback),
    };
  }

  /**
   * 已收尾任务的**履历**。⚠️ 不能只靠 `jobs` Map：`cancelJob` 会把它删掉，
   * 而契约 §3 要求「取消后**已编码行保留（续跑用）**」⇒ 续跑必须能找回"编到第几条"。
   * （第一次写漏了这张表 ⇒ `indexResume` 永远复用 0 条，测试当场抓到。）
   */
  const jobHistory = new Map();

  /** 当前索引口径 —— 续跑要不要复用，按 `compat` 判定（契约 §3） */
  function currentCompat() {
    return JSON.stringify({
      model_revision: data.encoding?.modelRevision ?? 'fake',
      dtype: data.encoding?.dtype ?? 'q4f16',
      preprocess_version: data.encoding?.preprocessVersion ?? 2,
      seq: data.encoding?.seq ?? 140,
    });
  }

  function startJob({ libId, device = 'webgpu', seq = 140, rebuild = false } = {}) {
    if (pendingTx) throw fail(ERR.RECOVERY_NEEDED, '上次操作未完成，需要先恢复。', recoveryDetails(libId));
    const total = jobCfg.total ?? 30;
    const jobId = `j-fake-${++jobSeq}`;
    const phases = jobCfg.phases || ['scan', 'pair', 'encode', 'verify', 'finalize'];
    const job = { jobId, libId, kind: 'index', cancelled: false, done: 0, total, device, seq, rebuild, startedAt: now(), timer: null };
    jobs.set(jobId, job);
    jobHistory.set(jobId, { libId, done: 0, compat: currentCompat(), device, seq });
    emit({ type: 'index.progress', jobId, libId, done: 0, total, skipped: 0, failed: 0, ratePerSec: 0, etaSec: null, phase: phases[0] });

    const step = () => {
      job.timer = null;
      if (job.cancelled) return;
      job.done = Math.min(total, job.done + Math.max(1, Math.round(total / 8)));
      const elapsedSec = Math.max(0.001, (now() - job.startedAt) / 1000);
      const ratePerSec = Number((job.done / elapsedSec).toFixed(2));
      const phase = phases[Math.min(phases.length - 1, Math.floor((job.done / total) * phases.length))];
      /** @type {any} */
      const ev = {
        type: 'index.progress', jobId, libId,
        done: job.done, total, skipped: 0,
        failed: (jobCfg.failAt || []).filter((i) => i < job.done).length,
        ratePerSec, etaSec: ratePerSec > 0 ? Math.round((total - job.done) / ratePerSec) : null,
        phase,
      };
      // GPU 回退必须**不静默**（契约 §3）—— 界面要能演示这条
      if (device === 'webgpu' && job.done >= Math.round(total / 2) && !job.fallbackSent) {
        job.fallbackSent = true;
        ev.deviceFallback = { from: 'webgpu', to: 'cpu', reason: '模拟：WebGPU 适配器丢失' };
      }
      emit(ev);
      if (job.done >= total) return finishJob(job, true);
      job.timer = setTimer(step, tickMs);
      return undefined;
    };
    job.timer = setTimer(step, tickMs);
    return ok({ jobId, total, phase: phases[0] });
  }

  /**
   * 收尾：`failed[]` 每项含 `{relPath, stage, error}`；非空则 `ok:false`（契约 §3）。
   *
   * ⚠️ **失败项的错误码只能用 `errors.mjs` 里那 20 个之一**（这里用 `INTERNAL`）。
   *    我第一次写时造了个 `ENCODE_FAILED` —— 那是**改错误码表**，
   *    按契约 §9.2 属于**破坏性变更**（要升 v2）。演示数据也不例外。
   *    区分"哪一条、哪个阶段、为什么"靠 `stage` + `error.message`，不靠新码。
   *    （`tests/fake.test.mjs` 的 **F9** 是这条的元断言。）
   */
  function finishJob(job, ranToEnd) {
    if (job.timer) { clearTimer(job.timer); job.timer = null; }
    const hist = jobHistory.get(job.jobId);
    if (hist) hist.done = job.done;              // 保留"编到第几条"⇒ 续跑要用
    const all = itemsByLib.get(job.libId) || [];
    const failed = !ranToEnd
      ? (jobCfg.failAt || []).slice(0, 1).map((i) => ({
        relPath: all[i]?.relPath ?? `#${i}`,
        stage: 'encode',
        error: { code: ERR.INTERNAL, message: '已取消：该条编码未完成' },
      }))
      : (jobCfg.failAt || []).map((i, n) => ({
        relPath: all[i]?.relPath ?? `#${i}`,
        stage: (jobCfg.failReasons?.[n]?.stage) || 'encode',
        error: (jobCfg.failReasons?.[n]?.error) || { code: ERR.INTERNAL, message: '编码失败' },
      }));
    emit({
      type: 'index.done', jobId: job.jobId, libId: job.libId, ok: failed.length === 0,
      cancelled: Boolean(job.cancelled),
      indexed: job.done, total: job.total,
      reused: job.reused ?? 0, encoded: Math.max(0, job.done - failed.length), failed,
      compat: 'fake',
    });
    jobs.delete(job.jobId);
  }

  /** 取消：**立即**收尾（契约 §3 要求 2 s 内发出 done/failed），已编码行保留（续跑用） */
  function cancelJob({ jobId } = {}) {
    const job = jobs.get(jobId);
    if (!job) return ok({ cancelled: false, reason: 'no-such-job' });
    job.cancelled = true;
    finishJob(job, false);
    return ok({ cancelled: true });
  }

  /**
   * 续跑：**必须按 compat 判定**；复用多少、为什么**都要写在事件里**（契约 §3：「不许静默」）。
   * ⚠️ 履历表 `jobHistory` 才是复用量的来源 —— `jobs` 在取消时就删了（见那张表的注释）。
   */
  function resumeJob({ jobId } = {}) {
    const h = jobHistory.get(jobId);
    const libId = h?.libId ?? data.libs?.[0]?.libId;
    // 契约 §3：`indexResume` 必须**按 `compat` 判定**，不等则**不复用**并说明原因
    const compatOk = h ? h.compat === currentCompat() : true;
    const reuse = compatOk ? (h?.done ?? 0) : 0;

    const out = startJob({ libId, device: h?.device, seq: h?.seq });
    const job = jobs.get(out.data.jobId);
    job.reused = reuse;
    emit({
      type: 'index.progress', jobId: out.data.jobId, libId: job.libId, done: reuse, total: job.total,
      skipped: 0, failed: 0, ratePerSec: 0, etaSec: null, phase: 'encode',
      note: compatOk ? `复用 ${reuse} 条（compat 相符）` : '复用 0 条：compat 不符',
    });
    out.data.reused = reuse;
    return out;
  }

  // ── 事务（操作记录，契约 §2.11 / SPEC-transactions §9）─────────────────────
  /**
   * 事务台账。**内存态**：`mutate`/`ingest` 会往前面插新记录，`undo` 会把状态改成 `undone`。
   * 初值来自 fixture 的 `transactions.items` —— 其中一条刻意是 `recovery_needed`，
   * 让「操作记录」页有**真的待处理**可显示（三条路：重试 / 回退 / 保持现状）。
   */
  const transactions = ((data.transactions && data.transactions.items) || []).map((t) => ({ ...t }));

  /** 契约 §2.11 `transactions`：可按 libId / txId 过滤，也可只要前 N 条 */
  function doTransactions({ libId = null, txId = null, limit = 50 } = {}) {
    let list = transactions;
    if (libId) list = list.filter((t) => t.libId === libId);
    if (txId) list = list.filter((t) => t.txId === txId);
    const n = Math.max(1, Math.min(200, Number(limit) || 50));
    // 新→旧（界面默认关心的就是最近发生了什么）
    return ok({
      transactions: [...list].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)).slice(0, n),
      /** 有未收尾事务时，任何写方法都会被 RECOVERY_NEEDED 挡住 —— 界面据此提示 */
      blocked: Boolean(pendingTx),
    });
  }

  function pushTx(rec) {
    transactions.unshift({
      canUndo: false, canRollback: false, finishedAt: now(), changes: [], ...rec,
    });
    return rec.txId;
  }

  // ── 写操作：只在内存里改（契约 §8），并演示 `RECOVERY_NEEDED` 那条路 ──────
  function mutate(req = {}) {
    if (pendingTx && req.op !== 'undo') {
      throw fail(ERR.RECOVERY_NEEDED, '上次操作未完成，需要先恢复。', recoveryDetails(req.libId));
    }
    if (req.op === 'undo') {
      const txId = req.params?.txId || pendingTx?.txId;
      if (!txId) throw fail(ERR.BAD_REQUEST, '没有可撤销的事务');
      const hit = transactions.find((t) => t.txId === txId);
      // 不可撤销的事务要**如实拒绝**（契约 §5：界面据 canUndo 决定按钮，但后端也要守）
      if (hit && hit.canUndo === false && hit.state !== 'recovery_needed') {
        throw fail(ERR.UNDO_EXPIRED, `该事务已过撤销期：${txId}`, { txId, state: hit.state });
      }
      pendingTx = null;
      if (hit) { hit.state = 'undone'; hit.canUndo = false; hit.canRollback = false; hit.finishedAt = now(); }
      else pushTx({ txId, libId: req.libId, op: 'undo', state: 'undone', startedAt: now(), summary: '撤销' });
      txLog.push({ txId, op: 'undo', at: now() });
      return ok({ txId, undone: true });
    }

    const txId = `tx-fake-${txLog.length + 1}`;
    const op = req.op || 'rename';
    pushTx({
      txId, libId: req.libId, op, state: 'committed', startedAt: now(),
      // 「是否需重编码」按操作语义给：改路径/改配对**不动像素** ⇒ 复用向量；
      // 只有"换图 / 外部内容变更"才要重编码，而那两种在这里没有对应 op（见 P3c 的 IA3）。
      needsReencode: false,
      summary: `${{ rename: '改 ID', moveFolder: '改分类', reattachArchive: '重新配对压缩包', moveOutOfLibrary: '移出素材库' }[op] || op}`,
      changes: req.uid ? [{ uid: req.uid, kind: op }] : [],
    });
    txLog.push({ txId, op, at: now(), params: req.params || {} });
    return ok({ txId, applied: true, needsReencode: false });
  }

  function ingest(req = {}) {
    if (pendingTx) throw fail(ERR.RECOVERY_NEEDED, '上次操作未完成，需要先恢复。', recoveryDetails(req.libId));
    const src = Array.isArray(req.sourcePaths) ? req.sourcePaths : [];
    const txId = `tx-fake-ingest-${txLog.length + 1}`;
    pushTx({
      txId, libId: req.libId, op: 'ingest', state: 'committed', startedAt: now(),
      needsReencode: true, summary: `入库 ${src.length} 个文件（需编码）`,
      changes: src.map((p) => ({ relPath: p, kind: 'ingest' })),
    });
    txLog.push({ txId, op: 'ingest', at: now(), count: src.length });
    return ok({ txId, accepted: src, needsReencode: true });
  }

  return {
    registry, load, root,
    // ⚠️ 返回对象的键**刻意与引擎方法名一一对应**（`indexStart: startJob` 等）。
    //    这样引擎侧就是 `fakeKit[name]` 一句话，不需要再维护一张"方法名→套件名"的映射表
    //    （那种表两个方向都会漂移）。`transactions` 在这里补上别名以保持一致。
    doSearch, doItem, doItemPaths, doIndexStatus, doScan, doTransactions,
    transactions: doTransactions,
    indexStart: startJob, indexCancel: cancelJob, indexResume: resumeJob,
    mutate, ingest,
    /** 供测试：造一个未收尾事务，用来演示 `RECOVERY_NEEDED` */
    __injectPendingTx(tx = { txId: 'tx-test', state: 'staged', startedAt: 1760000000000, canUndo: true, canRollback: true }) {
      pendingTx = { ...tx };
      return pendingTx;
    },
    __jobs: jobs,
    __txLog: txLog,
    /** 停掉所有定时器（测试收尾用；不调会让 node:test 挂着不退） */
    __dispose() { for (const j of jobs.values()) if (j.timer) clearTimer(j.timer); jobs.clear(); },
  };
}
