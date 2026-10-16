// packages/engine/tests/lib-root.mjs —— 取"要拿来做真实盘面断言的库根"
//
// 为什么需要它（D2 的连带修正）：
//   有两条约集成性质的测试原先直接读 `config.json` 拿 `library_root`，而**那个文件
//   早已随 Python 档退役被删除**，于是它们永久 skip。D2 还改了「库从哪来」这件事本身：
//   主进程现在按 `GEMMA_LIB_ROOT` > 注册表 > `config.json` > **索引自举** 解析，
//   而**索引自举**才是本机的实际来源（`data/libraries/<id>/meta.json` 里存着 `lib_root`）。
//
//   ⇒ 测试若继续只认 `config.json`，就会**一直跳过**，等于把"整库唯一性"和
//      "指纹与 Python 侧逐字节一致"这两条真实有价值的一致性断言长期挂在门外。
//      这不是代码坏了，而是**测试在检一个生产已不再使用的主机制**。
//
// 本模块与 `apps/desktop/src/main/library-config.ts` 的解析顺序**刻意保持一致**
// （环境变量 → config.json → 索引自举）。引擎包**零第三方依赖**的纪律不受影响：
// 这里只用 Node 内置模块，且它是测试夹具、不是引擎的运行时依赖。
import fs from 'node:fs';
import path from 'node:path';

/** 读 `data/libraries/<id>/meta.json` 自举出的库根（可多个，取第一个存在的） */
function fromIndexMeta(root) {
  const base = path.join(root, 'data', 'libraries');
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const meta = path.join(base, d.name, 'meta.json');
    if (!fs.existsSync(meta)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(meta, 'utf8').replace(/^\uFEFF/, ''));
      if (m.lib_root) out.push({ libId: m.lib_id || d.name, root: String(m.lib_root) });
    } catch {
      /* 坏 meta 跳过：这里不负责报错，只负责"有就用" */
    }
  }
  return out;
}

/**
 * 解析出可用于真实盘面断言的库根。
 * @returns {{root:string, source:string, libId?:string}|null} null = 本机确实没有可用库
 */
export function resolveTestLibraryRoot(repoRoot) {
  const env = process.env.GEMMA_LIB_ROOT;
  if (env && fs.existsSync(env)) return { root: env, source: 'env' };

  // config.json：仍在分辨率里，但**只是回退**（D2 之后它不再是主来源）
  const cfgPath = path.join(repoRoot, 'config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
      if (cfg.library_root && fs.existsSync(cfg.library_root)) {
        return { root: cfg.library_root, source: 'config.json' };
      }
    } catch {
      /* 坏 config 就当没有 */
    }
  }

  for (const l of fromIndexMeta(repoRoot)) {
    if (fs.existsSync(l.root)) return { root: l.root, source: 'index-meta', libId: l.libId };
  }
  return null;
}
