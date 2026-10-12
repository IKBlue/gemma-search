// packages/engine/src/engine.mjs —— 引擎主体：传输无关、依赖注入
//
// 设计要点（都是为了"可测 + 可换）：
//   · **依赖全部注入**：库注册表、编码器、时钟、事件回调。本包因此零依赖，
//     测试里注入假编码器即可跑全部逻辑，不需要模型、不需要 GPU。
//   · **不 import electron / http**（契约 §0 的可执行判据）。
//   · 索引按库懒加载并缓存；`compat` 决定哪些库能一起检索（§6）。
//   · 所有方法返回契约 §1.1 的信封，**永不抛异常给调用方**。
import fs from 'node:fs';
import path from 'node:path';
import { ERR, fail, ok, envelope } from './errors.mjs';
import { readIndexBin, readItems, readMeta, relOf } from './index.mjs';
import { compatComplete, compatEqual, compatKey, compatReason } from './compat.mjs';
import { LibraryRegistry, resolveInLibrary, resolveQueryImage } from './library.mjs';
import { fingerprintV1 } from './fingerprint.mjs';

/**
 * 分数区间：**按模态分别定义**。
 * 契约 §2.1 明确：分数不可跨模态比大小，所以界面只能用引擎给的 band，
 * 不许自己拿"文本 0.78"和"图像 0.90"排序。
 *
 * ⚠️ 这些阈值是**暂定**的（依据 spike 实测：图像自检索 ~1.0、文本→图像 top-1 0.74–0.80），
 *    需要按 SPEC-acceptance 的流程在真实查询集上复核后再冻结。
 */
export const BANDS = Object.freeze({
  text: { high: 0.72, mid: 0.65 },
  image: { high: 0.90, mid: 0.80 },
});

/**
 * 按模态取档位。
 *
 * ⚠️ **未知模态不再静默回退到 text 阈值**（2026-10-12 独立复核实测的 R-3）。
 * 原来的写法是 `BANDS[mode] || BANDS.text` —— 于是 `bandOf(0.85, 'vector')` 会返回 `'high'`，
 * 而 `vector` 根本不该用文本阈值（图像查询的分数区间完全不同）。
 * 这与 F-02 是**同一根因**：一个不懂模态的东西擅自替分数下结论。
 *
 * 现在的行为：不认识的模态 ⇒ 返回 `'unknown'`，**不下档位判断**。
 * 调用的界面（`ui/Score.jsx`）对未知档位**只显示分数、不显示档位文案** —— 诚实降级。
 * `'unknown'` 是**新增**的返回值，契约 §1.3 的"新增=兼容"同样适用于此。
 */
export function bandOf(score, mode) {
  // ⚠️ 必须用 `Object.hasOwn`，**不能**写 `const b = BANDS[mode]; if (!b)`。
  // 后者会让**原型键**蒙混过关：`BANDS['toString']` 取到的是 `Object.prototype.toString`（真值！），
  // 于是 `bandOf(0.85,'toString')` ⇒ `b.high` 为 undefined ⇒ 返回 `'low'` ——
  // **又替一个不认识的模态编了档位**，与 R-3 同根因。测试用例集若只列 'vector'/'hybrid'
  // 这类普通字符串，会恰好绕开全部原型键（独立复核实测 I-5）。
  if (!Object.hasOwn(BANDS, mode)) return 'unknown';
  const b = BANDS[mode];
  if (score >= b.high) return 'high';
  if (score >= b.mid) return 'mid';
  return 'low';
}

/** L2 归一化。索引里的行已是 L2（SPEC-identity §6.2 `normalization:"l2"`），点积即余弦。 */
export function l2norm(v) {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (!(n > 0)) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

/** 索引在应用数据目录下的位置：<dataDir>/libraries/<libId>/ */
export function indexPathFor(dataDir, libId) {
  return path.join(dataDir, 'libraries', libId);
}

/**
 * 取件目标目录：**按名字配置**，不是按路径传。
 *
 * 契约 §2.5 的入参是 `targetDirName`（名字），这里把它解析成真实目录。
 * 这样白名单是**结构性**的 —— 渲染进程连"传一个白名单外的路径"都做不到，
 * 只能传一个已配置的名字。比"传路径再校验"更不容易出错。
 */
export function resolveCollectDir(targetDirName, collectCfg) {
  const dirs = (collectCfg && collectCfg.dirs) || {};
  const name = targetDirName || (collectCfg && collectCfg.default) || Object.keys(dirs)[0];
  const dir = name ? dirs[name] : undefined;
  if (!dir) {
    throw fail(ERR.COLLECT_DIR_NOT_ALLOWED,
      `取件目标不在允许列表：${targetDirName || '(未指定)'}`,
      { name: targetDirName || null, allowed: Object.keys(dirs) });
  }
  return { name, dir: path.resolve(dir) };
}

/** 取件时复制哪一份：有包取包，无包取图（契约 §2.5 的 auto 语义）。 */
export function pickCollectSource(item, target = 'auto') {
  const rel = relOf(item);
  const arc = item.archiveRelPath || null;
  if (target === 'archive') {
    if (!arc) throw fail(ERR.ITEM_MISSING_ON_DISK, `该素材没有同名包：${rel}`, { rel });
    return { rel: arc, kind: 'archive' };
  }
  if (target === 'image') return { rel, kind: 'image' };
  return arc ? { rel: arc, kind: 'archive' } : { rel, kind: 'image' };
}

export function createEngine({
  config = {},
  encoder = null,                 // { encodeText(text) -> Float32Array, encodeImage(absPath) -> Float32Array }
  indexDir = null,                // 索引根；缺省 <config.data_dir>/libraries
  onEvent = () => {},
  now = () => Date.now(),
  shell = null,                   // { reveal(absPath) } —— P2 注入（Electron shell.showItemInFolder）
} = {}) {
  const registry = new LibraryRegistry(config);
  const idxRoot = indexDir || path.join(config.data_dir || path.join(process.cwd(), 'data'), 'libraries');
  const cache = new Map();        // libId -> { header, items, vectors, meta, byUid, rowToRel }
  const jobs = new Map();         // jobId -> { kind, libId, cancelled }

  function dirOf(libId) {
    return path.join(idxRoot, libId);
  }

  /** 懒加载并缓存某库索引；任何损坏都抛 INDEX_*（由 envelope 转信封）。 */
  function load(libId, { reload = false } = {}) {
    if (!reload && cache.has(libId)) return cache.get(libId);
    registry.requireExistingRoot(libId);
    const d = dirOf(libId);
    const bin = path.join(d, 'index.bin');
    const itemsP = path.join(d, 'items.json');
    const metaP = path.join(d, 'meta.json');
    const { header, vectors, count, dim } = readIndexBin(bin);
    const items = readItems(itemsP);
    const meta = readMeta(metaP);
    const byUid = new Map();
    const rowToRel = new Map();
    for (const it of items) {
      const rel = relOf(it);
      byUid.set(it.uid, it);
      if (it.vectorRow != null) rowToRel.set(it.vectorRow, rel);
    }
    const entry = { libId, dir: d, header, vectors, count, dim, items, meta, byUid, rowToRel };
    cache.set(libId, entry);
    return entry;
  }

  /** 兼容性基准：以第一个请求的库为准；其余不等的库进 skipped 并附结构化原因。 */
  function pickCompatible(libIds) {
    const ids = libIds && libIds.length ? libIds : registry.list().map((l) => l.libId);
    const loaded = [];
    const skipped = [];
    let base = null;
    for (const id of ids) {
      let e;
      try {
        e = load(id);
      } catch (err) {
        skipped.push({ libId: id, reason: { kind: 'unavailable', code: err.code,
                                           userMessage: undefined, detail: err.message } });
        continue;
      }
      if (!compatComplete(e.header)) {
        skipped.push({ libId: id, reason: { kind: 'compat-incomplete',
                                            missing: ['model_repo'], userMessage: '这个库的索引元数据不完整。' } });
        continue;
      }
      if (base === null) { base = e; loaded.push(e); continue; }
      if (compatEqual(base.header, e.header)) loaded.push(e);
      else skipped.push({ libId: id, reason: compatReason(base.header, e.header, registry.get(id).label) });
    }
    return { loaded, skipped, base };
  }

  async function doSearch(req = {}) {
    const mode = req.mode || 'text';
    const topK = Math.max(1, Math.min(200, Number(req.topK) || 50));
    if (!encoder) throw fail(ERR.MODEL_MISSING, '引擎未注入编码器');

    const t0 = now();
    // ---- 查询向量 ----
    let qvec;
    if (mode === 'text') {
      const text = String(req.text || '').trim();
      if (!text) throw fail(ERR.BAD_REQUEST, '查询文本为空');
      qvec = await encoder.encodeText(text);
    } else if (mode === 'image') {
      // 两种来源：库内条目（libId+uid）或用户临时挑的库外图（queryImagePath，唯一例外）
      let abs;
      if (req.queryImagePath) {
        abs = resolveQueryImage(req.queryImagePath);
      } else if (req.imageRef && req.imageRef.libId && req.imageRef.uid) {
        const e = load(req.imageRef.libId);
        const it = e.byUid.get(req.imageRef.uid);
        if (!it) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${req.imageRef.uid}`);
        abs = resolveInLibrary(registry.get(req.imageRef.libId).root, relOf(it));
      } else if (req.vector) {
        qvec = Float32Array.from(req.vector);
      } else {
        throw fail(ERR.BAD_REQUEST, '图像查询需要 imageRef / queryImagePath / vector 之一');
      }
      if (!qvec) qvec = await encoder.encodeImage(abs);
    } else if (mode === 'vector') {
      if (!req.vector) throw fail(ERR.BAD_REQUEST, 'vector 模式需要 vector');
      qvec = Float32Array.from(req.vector);
    } else {
      throw fail(ERR.BAD_REQUEST, `未知 mode：${mode}`);
    }
    if (!qvec || !qvec.length) throw fail(ERR.INTERNAL, '查询向量为空');

    // 查询向量**统一归一到 L2**：索引行已是 L2，两边都归一后点积就是余弦。
    // 这一步是防御性的 —— 编码器是注入的端口，若它忘了归一化，
    // 所有分数会被静默缩放（排序仍对、band 全错），很难发现。768 次乘加的代价可忽略。
    qvec = l2norm(qvec);

    // ---- 逐库打分并合并 ----
    const { loaded, skipped } = pickCompatible(req.libIds);
    if (!loaded.length) throw fail(ERR.INDEX_MISSING, '没有可检索的库', { skipped });

    const filters = req.filters || {};
    const folders = filters.folders ? new Set(filters.folders) : null;
    const exts = filters.exts ? new Set(filters.exts) : null;

    const scored = [];
    for (const e of loaded) {
      const { vectors, dim, items } = e;
      for (const it of items) {
        if (it.vectorRow == null) continue;
        if (folders && !folders.has(it.folder)) continue;
        if (exts && !exts.has(String(it.imageExt || '').toLowerCase())) continue;
        const off = it.vectorRow * dim;
        let dot = 0;
        for (let i = 0; i < dim; i++) dot += vectors[off + i] * qvec[i];
        scored.push({ libId: e.libId, item: it, score: dot });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK);

    return ok({
      libsUsed: loaded.map((e) => e.libId),
      libsSkipped: skipped,
      tookMs: now() - t0,
      results: top.map((r) => {
        const it = r.item;
        const rel = relOf(it);
        return {
          libId: r.libId,
          uid: it.uid,
          score: Number(r.score.toFixed(6)),
          band: bandOf(r.score, mode),
          relPath: rel,
          folder: it.folder,
          stem: it.stem,
          imageExt: it.imageExt,
          imageSize: it.imageSize,
          archive: it.archiveRelPath
            ? { relPath: it.archiveRelPath, ext: it.archiveExt, size: it.archiveSize }
            : null,
          thumbKey: `${r.libId}/${it.uid}`,
        };
      }),
    });
  }

  function doIndexStatus() {
    const libs = [];
    for (const l of registry.list()) {
      let rootOk = true;
      try { registry.requireExistingRoot(l.libId); } catch { rootOk = false; }
      let e = null;
      const problems = [];
      try { e = load(l.libId); } catch (err) { problems.push({ code: err.code, message: err.message }); }
      libs.push({
        libId: l.libId,
        label: l.label,
        root: l.root,
        rootExists: rootOk,
        indexed: e ? e.items.length : 0,
        encoded: e ? e.count : 0,
        dim: e ? e.dim : null,
        compat: e && compatComplete(e.header) ? compatKey(e.header) : null,
        builtAt: e ? (e.header.built_at || null) : null,
        failed: e && e.meta && Array.isArray(e.meta.failed) ? e.meta.failed.length : 0,
        healthy: rootOk && !!e && problems.length === 0 && (e.items.length === e.count),
        problems,
      });
    }
    return ok({ libs });
  }

  /** 差分扫描：新增 / 消失 / 变化。**只读**。 */
  function doScan({ libId } = {}) {
    registry.requireExistingRoot(libId);
    const e = load(libId);
    const root = registry.get(libId).root;

    const disk = new Map();          // relPath -> { size, mtimeMs }
    const walk = (dir) => {
      for (const de of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, de.name);
        if (de.isDirectory()) { walk(full); continue; }
        if (!de.isFile()) continue;
        const st = fs.statSync(full, { bigint: true });
        disk.set(path.relative(root, full),
                 { size: Number(st.size), mtimeMs: Number(st.mtimeNs / 1_000_000n) });
      }
    };
    walk(root);

    const known = new Map();         // relPath -> item
    for (const it of e.items) {
      const rel = relOf(it);
      if (rel) known.set(rel, it);
    }

    const fresh = [];
    const changed = [];
    for (const [rel, s] of disk) {
      const it = known.get(rel);
      if (!it) { fresh.push({ relPath: rel, stem: path.basename(rel, path.extname(rel)) }); continue; }
      const what = [];
      if (it.imageSize != null && Number(it.imageSize) !== s.size) what.push('size');
      if (it.imageMtime != null && Number(it.imageMtime) !== s.mtimeMs) what.push('mtime');
      if (what.length) changed.push({ relPath: rel, uid: it.uid, what });
    }
    const missing = [];
    for (const [rel, it] of known) if (!disk.has(rel)) missing.push({ relPath: rel, uid: it.uid });

    const fp = fingerprintV1(root);
    return ok({
      new: fresh, missing, changed,
      fingerprintV1: fp.fingerprint,
      counts: fp.counts,
      filesTotal: fp.counts.files,
    });
  }

  /** 取件：把选中的包（或图）复制到**已配置的**目标目录。库侧零写入。 */
  function doCollect({ libId, uids, targetDirName, target = 'auto' } = {}) {
    registry.requireExistingRoot(libId);
    const e = load(libId);
    const root = registry.get(libId).root;
    const list = Array.isArray(uids) ? uids : [];
    if (!list.length) throw fail(ERR.BAD_REQUEST, 'uids 为空');
    if (list.length > 200) throw fail(ERR.BAD_REQUEST, `一次最多取 200 件，收到 ${list.length}`);

    const { name, dir } = resolveCollectDir(targetDirName, config.collect);
    fs.mkdirSync(dir, { recursive: true });

    // 先算总量并做**空间预检**（不要复制到一半才发现不够）
    const plan = [];
    const failed = [];
    const skipped = [];
    let totalBytes = 0;
    for (const uid of list) {
      const it = e.byUid.get(uid);
      if (!it) { failed.push({ uid, error: { code: ERR.UID_NOT_FOUND, message: 'uid 不在索引中' } }); continue; }
      let src;
      try {
        src = pickCollectSource(it, target);
      } catch (err) {
        failed.push({ uid, error: { code: err.code, message: err.message } });
        continue;
      }
      const abs = resolveInLibrary(root, src.rel);          // 含库根包含 + 链接校验
      if (!fs.existsSync(abs)) {
        failed.push({ uid, error: { code: ERR.ITEM_MISSING_ON_DISK, message: '源文件不存在', rel: src.rel } });
        continue;
      }
      const size = fs.statSync(abs).size;
      const dest = path.join(dir, path.basename(abs));
      if (fs.existsSync(dest)) { skipped.push({ uid, reason: 'already-exists', path: dest }); continue; }
      plan.push({ uid, abs, dest, size, kind: src.kind, rel: src.rel });
      totalBytes += size;
    }

    if (plan.length) {
      try {
        const st = fs.statfsSync(dir);
        const free = Number(st.bavail) * Number(st.bsize);
        if (free < totalBytes) {
          throw fail(ERR.DISK_FULL,
            `目标盘可用 ${free} 字节，需要 ${totalBytes} 字节`,
            { free, need: totalBytes, dir });
        }
      } catch (err) {
        if (err && err.code === ERR.DISK_FULL) throw err;
        // statfs 不可用（老平台）→ 不阻断，交给写入时报错
      }
    }

    const jobId = `j-${Math.random().toString(16).slice(2, 6)}`;
    const succeeded = [];
    for (const p of plan) {
      try {
        fs.copyFileSync(p.abs, p.dest, fs.constants.COPYFILE_EXCL);   // EXCL：绝不覆盖
        succeeded.push({ uid: p.uid, kind: p.kind, path: p.dest, bytes: p.size });
      } catch (err) {
        const code = err && err.code === 'EEXIST' ? ERR.COLLECT_TARGET_EXISTS : ERR.INTERNAL;
        if (code === ERR.COLLECT_TARGET_EXISTS) {
          skipped.push({ uid: p.uid, reason: 'already-exists', path: p.dest });
        } else {
          failed.push({ uid: p.uid, error: { code, message: err.message } });
        }
      }
    }
    return ok({ jobId, targetDirName: name, targetDir: dir, bytesTotal: totalBytes,
                succeeded, failed, skipped });
  }

  // ---------------- 公开接口（每个都套信封） ----------------
  const api = {
    registry,
    /** 供测试与诊断：强制重新读索引 */
    reload(libId) { cache.delete(libId); return load(libId); },
    /**
     * 解析某条素材的绝对路径。**仅供主进程内部使用**（`thumb://` 协议处理器），
     * 刻意**不经 IPC 暴露** —— 契约 §0 要求"路径只能由 lib_id+uid 解析"，
     * 把这个结果交给渲染进程就等于把绝对路径泄出去了。
     * 仍走完整的包含校验与符号链接校验。
     */
    absPathFor(libId, uid) {
      const e = load(libId);
      const it = e.byUid.get(uid);
      if (!it) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${uid}`, { libId, uid });
      return resolveInLibrary(registry.get(libId).root, relOf(it));
    },
    search: (req) => envelope(() => doSearch(req)),
    indexStatus: () => envelope(async () => doIndexStatus()),
    scan: (req) => envelope(async () => doScan(req)),
    collect: (req) => envelope(async () => doCollect(req)),
    item: ({ libId, uid } = {}) => envelope(async () => {
      const e = load(libId);
      const it = e.byUid.get(uid);
      if (!it) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${uid}`, { libId, uid });
      const rel = relOf(it);
      const abs = resolveInLibrary(registry.get(libId).root, rel);
      const arcAbs = it.archiveRelPath
        ? resolveInLibrary(registry.get(libId).root, it.archiveRelPath) : null;
      return ok({
        libId, uid, relPath: rel, folder: it.folder, stem: it.stem,
        imageExt: it.imageExt, imageSize: it.imageSize, imageMtime: it.imageMtime,
        vectorSource: it.vectorSource || 'native',
        archive: it.archiveRelPath
          ? { relPath: it.archiveRelPath, ext: it.archiveExt, size: it.archiveSize, mtime: it.archiveMtime }
          : null,
        exists: { image: fs.existsSync(abs), archive: arcAbs ? fs.existsSync(arcAbs) : false },
      });
    }),
    reveal: ({ libId, uid, target = 'archive' } = {}) => envelope(async () => {
      const e = load(libId);
      const it = e.byUid.get(uid);
      if (!it) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${uid}`, { libId, uid });
      const rel = target === 'archive' ? (it.archiveRelPath || relOf(it)) : relOf(it);
      const abs = resolveInLibrary(registry.get(libId).root, rel);
      if (!fs.existsSync(abs)) throw fail(ERR.ITEM_MISSING_ON_DISK, `文件不存在：${rel}`, { rel });

      // ⚠️ **未注入端口必须显式失败，不许返回 ok**（F-01，契约 §2.4 第 2 条）。
      //
      // 原来的写法是 `if (shell && …) shell.reveal(abs); return ok({revealed:true})` ——
      // 端口缺失时**照样**报成功。那不是"降级"，是**谎报**：界面会显示「已在资源管理器中定位」，
      // 而资源管理器毫无动静，用户与排障者都会往错的方向找。
      //
      // 而且这条**没有第二道防线**：`ok({revealed:true})` 的语义就是"已经定位了"，
      // 调用方无法区分"真定位了"和"什么都没做"。
      if (!shell || typeof shell.reveal !== 'function') {
        throw fail(ERR.PORT_MISSING,
          `未注入 shell 端口（reveal 需要外壳提供 { reveal(absPath) }；当前 ${shell ? '形状不对' : '未提供'}）`,
          { port: 'shell', got: shell === null || shell === undefined ? 'none' : typeof shell });
      }
      // Electron 的 `shell.showItemInFolder` **返回 void、不报告失败**，所以这里**不能**
      // 断言"资源管理器一定弹出来了"。我们只保证：端口被调用了，且目标文件确实在盘上
      // （上面那条 existsSync 已证）。这个边界必须如实写在契约里，不得声称更强的保证。
      shell.reveal(abs);
      return ok({ revealed: true, path: abs });
    }),
    /** 长任务的通用取消入口（P1 只登记；实际编码在 indexStart 实现） */
    _jobs: jobs,
    _cache: cache,
    _onEvent: onEvent,
  };
  return api;
}
