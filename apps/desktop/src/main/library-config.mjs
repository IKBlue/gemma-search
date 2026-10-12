// apps/desktop/src/main/library-config.mjs —— 库与配置的解析（D2 修复）
//
// 背景（为什么需要这个模块）：
//   主进程原先只从 `config.json` / `GEMMA_CONFIG` 读库根，而**那个文件早已随 Python 档退役被删除**，
//   仓库里也没有模板 ⇒ 库列表恒为空 ⇒ 界面永远 `LIB_NOT_FOUND`，开箱跑不出任何检索结果。
//   这是审查确认的缺陷 D2（`docs/audit/AUDIT-FINAL.md` §4 F-03），也是一切界面工作的前置。
//
// 本模块的定位：
//   把「库从哪来」这条链从 `index.mjs` 里拆出来，做成**纯逻辑 + 可单测**的形态。
//   它**不依赖 Electron**（`userDataDir` 由调用方注入，主进程传 `app.getPath('userData')`），
//   这样它也能被 `node --test` 直接跑。
//
// 解析优先级（高 → 低，逐条都记 `source`，便于排障时直接看清"库是从哪来的"）：
//   1. `GEMMA_LIB_ROOT` 环境变量          —— 显式覆盖；仓里 7 个守卫/tools 都用这个惯例
//   2. `userData/library-registry.json`   —— **决策 9 的正规存储**（应用内注册表，本模块新建）
//   3. `config.json` / `GEMMA_CONFIG`     —— 兼容回退；**不是要求用户去配它**，只为不丢老用法
//   4. `data/libraries/*/meta.json` 自举  —— **本机已有索引时零配置可用**
//
//   第 4 条是关键：索引的 `meta.json` 里本就存着 `lib_id` 与 `lib_root`
//   （实测：`{"lib_id":"L1","lib_root":"G:\\model"}`）。既然索引知道自己描述哪个库，
//   就不该再让用户手工把同一事实抄一遍。⇒ 有索引的机器**开箱即用**。
//
// 取件白名单（`collect.dirs`，同时解掉缺陷 F-04）：
//   原先恒为 `{}` ⇒ 任何 `collect` 都返回 `COLLECT_DIR_NOT_ALLOWED`。
//   这里按 `docs/spec/SPEC-app.md` §9（默认 `E:\素材待用\`）与
//   `docs/spec/SPEC-transactions.md` §7（移出走 `E:\移出素材\`）给默认值。
//
// ⚠️ **本模块只读 + 只在显式调用时写**。启动路径上**绝不写** userData，
//    以免"只是启动了一下"就产生副作用。写注册表只发生在 `saveRegistry()` 被调用时。
import fs from 'node:fs';
import path from 'node:path';

/** 注册表格式版本（结构变更时递增，读端据此判断） */
export const REGISTRY_VERSION = 1;
export const REGISTRY_FILE = 'library-registry.json';

/** libId 形状：与 `apps/desktop/src/shared/ipc.mjs` 的 `LibId` 保持一致 */
const LIB_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** 取件目录默认值（来自 SPEC-app §9 与 SPEC-transactions §7，不是本项目现编的） */
export const DEFAULT_COLLECT = Object.freeze({
  dirs: Object.freeze({
    素材待用: 'E:\\素材待用',
    移出素材: 'E:\\移出素材',
  }),
  default: '素材待用',
});

export function registryPath(userDataDir) {
  return path.join(userDataDir, REGISTRY_FILE);
}

/**
 * 读注册表。**任何异常都返回 null 而不是抛** ——
 * 配置坏了不该让应用起不来，调用方会退到下一优先级并把原因报出来。
 */
export function loadRegistry(userDataDir) {
  if (!userDataDir) return null;
  const p = registryPath(userDataDir);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    return { path: p, data: raw, error: null };
  } catch (e) {
    return { path: p, data: null, error: e.message };
  }
}

/**
 * 写注册表（**只在用户明确注册/改设置时调用**）。
 * 返回 `{ok, path, error}`，不抛 —— 写失败要能让界面显示出来，而不是崩。
 */
export function saveRegistry(userDataDir, data) {
  if (!userDataDir) return { ok: false, path: null, error: '无 userData 目录' };
  const p = registryPath(userDataDir);
  const payload = { version: REGISTRY_VERSION, ...data };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    return { ok: true, path: p, error: null };
  } catch (e) {
    return { ok: false, path: p, error: e.message };
  }
}

/** 校验并归一一组库条目；非法条目**丢弃并记录**，不静默改造 */
export function normalizeLibraries(input) {
  const kept = [];
  const dropped = [];
  for (const l of Array.isArray(input) ? input : []) {
    const libId = l && typeof l.libId === 'string' ? l.libId.trim() : '';
    const root = l && typeof l.root === 'string' ? l.root.trim() : '';
    if (!LIB_ID_RE.test(libId)) { dropped.push({ item: l, why: `libId 形状不合法：${JSON.stringify(libId)}` }); continue; }
    if (!root) { dropped.push({ item: l, why: 'root 为空' }); continue; }
    kept.push({ libId, root: path.resolve(root), label: (l.label && String(l.label)) || libId });
  }
  return { kept, dropped };
}

/**
 * 从 `data/libraries/<id>/meta.json` 自举库列表。
 *
 * 这是"零配置可用"的来源：索引自己记着它属于哪个库、库根在哪。
 * 索引目录名（如 `L1`）就是 libId；`meta.lib_id` 若存在则以它为准（两者不一致时记 warning）。
 */
export function discoverLibrariesFromIndex(dataDir) {
  const base = path.join(dataDir, 'libraries');
  const out = [];
  const notes = [];
  if (!fs.existsSync(base)) return { libraries: out, notes };
  for (const dir of fs.readdirSync(base, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const metaFile = path.join(base, dir.name, 'meta.json');
    if (!fs.existsSync(metaFile)) { notes.push(`跳过 ${dir.name}：没有 meta.json`); continue; }
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      notes.push(`跳过 ${dir.name}：meta.json 解析失败（${e.message}）`);
      continue;
    }
    const libId = (meta.lib_id && String(meta.lib_id)) || dir.name;
    if (!LIB_ID_RE.test(libId)) { notes.push(`跳过 ${dir.name}：meta.lib_id 形状不合法`); continue; }
    if (libId !== dir.name) notes.push(`注意 ${dir.name}：目录名与 meta.lib_id（${libId}）不一致，以 meta 为准`);
    const root = meta.lib_root ? String(meta.lib_root) : '';
    if (!root) { notes.push(`跳过 ${dir.name}：meta 里没有 lib_root`); continue; }
    out.push({
      libId,
      root: path.resolve(root),
      label: '主库',
      count: Number(meta.count) || 0,
      source: 'index-meta',
      indexPath: path.join(base, dir.name),
    });
  }
  return { libraries: out, notes };
}

/**
 * 解析出最终的库列表 + 取件白名单 + 一份**可读的诊断报告**。
 *
 * @param {object} o
 * @param {string} o.dataDir        应用数据目录（`data/`）
 * @param {string} [o.userDataDir]  `app.getPath('userData')`；缺省则跳过注册表这一层
 * @param {object} [o.config]       已读到的 `config.json`（可选）
 * @param {string} [o.configPath]   上面那份 config 的来源路径（仅用于报告）
 * @param {string} [o.envLibRoot]   `process.env.GEMMA_LIB_ROOT`
 * @returns {{libraries:Array, collect:object, diagnostics:Array<string>, warnings:Array<string>}}
 */
export function resolveLibraries({ dataDir, userDataDir, config = {}, configPath = null, envLibRoot = '' } = {}) {
  const diagnostics = [];
  const warnings = [];
  let libraries = [];
  let chosen = null;

  // 1) 环境变量显式覆盖
  if (envLibRoot && String(envLibRoot).trim()) {
    const root = path.resolve(String(envLibRoot).trim());
    const libId = (config.lib_id && String(config.lib_id)) || 'L1';
    libraries = [{ libId, root, label: '主库（GEMMA_LIB_ROOT）', source: 'env' }];
    chosen = 'env';
    diagnostics.push(`库来自环境变量 GEMMA_LIB_ROOT = ${root}`);
  }

  // 2) 应用内注册表（决策 9 的正规存储）
  if (!chosen) {
    const reg = loadRegistry(userDataDir);
    if (reg && reg.error) {
      warnings.push(`注册表读取失败（会退到下一优先级）：${reg.path} — ${reg.error}`);
    } else if (reg && reg.data) {
      const { kept, dropped } = normalizeLibraries(reg.data.libraries);
      for (const d of dropped) warnings.push(`注册表里丢弃了一条库：${d.why}`);
      if (kept.length) {
        libraries = kept.map((l) => ({ ...l, source: 'registry' }));
        chosen = 'registry';
        diagnostics.push(`库来自应用内注册表：${reg.path}（${kept.length} 个）`);
      } else if (Array.isArray(reg.data.libraries) && reg.data.libraries.length) {
        warnings.push(`注册表存在但没有任何合法库条目：${reg.path}`);
      }
    }
  }

  // 3) config.json 兼容回退
  if (!chosen) {
    const fromCfg = [];
    if (Array.isArray(config.libraries) && config.libraries.length) fromCfg.push(...config.libraries);
    else if (config.library_root) {
      fromCfg.push({ libId: config.lib_id || 'L1', root: config.library_root, label: '主库' });
    }
    const { kept, dropped } = normalizeLibraries(fromCfg);
    for (const d of dropped) warnings.push(`config 里丢弃了一条库：${d.why}`);
    if (kept.length) {
      libraries = kept.map((l) => ({ ...l, source: 'config' }));
      chosen = 'config';
      diagnostics.push(`库来自 ${configPath || 'config'}（兼容回退）`);
    }
  }

  // 4) 从已有索引自举（本机零配置可用的关键）
  if (!chosen) {
    const disc = discoverLibrariesFromIndex(dataDir);
    for (const n of disc.notes) diagnostics.push(n);
    if (disc.libraries.length) {
      libraries = disc.libraries;
      chosen = 'index-meta';
      diagnostics.push(`库由已有索引自举（${disc.libraries.map((l) => `${l.libId}=${l.root}`).join(', ')}）—— 无需手工配置`);
    }
  }

  if (!chosen) {
    diagnostics.push('未找到任何库：环境变量 / 注册表 / config.json / 已有索引 四条路都没有结果');
  }

  // 取件白名单：注册表 > config > 默认值（默认值来自规格，见文件头）
  const regDirs = (() => {
    const reg = loadRegistry(userDataDir);
    return reg && reg.data && reg.data.collect && typeof reg.data.collect === 'object' ? reg.data.collect : null;
  })();
  const collect = (() => {
    for (const src of [regDirs, config.collect]) {
      if (src && src.dirs && Object.keys(src.dirs).length) {
        return { dirs: { ...src.dirs }, default: src.default || Object.keys(src.dirs)[0] };
      }
    }
    return { dirs: { ...DEFAULT_COLLECT.dirs }, default: DEFAULT_COLLECT.default };
  })();

  // 库根存在性：**如实报**，但不在这里判失败（引擎的 indexStatus 会给出结构化状态）
  for (const l of libraries) {
    if (!fs.existsSync(l.root)) {
      warnings.push(`库根不存在：${l.libId} → ${l.root}（盘符变了或盘未挂载？）`);
    }
  }

  return { libraries, collect, chosen, diagnostics, warnings, registryPath: registryPath(userDataDir) };
}
