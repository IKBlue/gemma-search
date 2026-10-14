// core/library.ts —— 库注册表 + 安全路径解析
//
// 这是 docs/spec/CONTRACT-engine-v1.md §7 的落点，也是 G-C 要求的**引擎层安全不变量**：
//   ① 路径只能由 lib_id + uid 解析，不接受客户端给的绝对路径
//   ② 取件目标目录白名单
//   ③ 库根包含校验（解析后必须仍在库根内）
//   ④ 符号链接 / 联接点越界即拒绝
//   ⑤ 只读操作绝不写库
//
// 这些不是"实现细节"：P2 的 thumb:// 协议与 IPC 白名单都要靠它们兜底。
import fs from 'node:fs';
import path from 'node:path';
import { ERR, fail, messageOf } from './errors.ts';
import { relOf } from './index.ts';
import type { IndexItem } from './index.ts';

/** 路径规范化（只做词法 resolve，不碰盘） */
const norm = (p: string): string => path.resolve(p);

/** Windows 下比较路径要忽略大小写（NTFS 默认不区分）。 */
function sameOrUnder(child: string, parent: string): boolean {
  const a = process.platform === 'win32' ? child.toLowerCase() : child;
  const b = process.platform === 'win32' ? parent.toLowerCase() : parent;
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
}

/**
 * 判断一个"客户端给的相对路径"是否是安全的相对路径。
 * 拒绝：绝对路径、盘符、UNC、含 `..` 段、含 NUL。
 *
 * 参数类型是 unknown 而不是 string：**这个函数就是那道收窄**（调用方拿到的可能是
 * 任何东西）。写成类型谓词后，调用点跟着它一起收窄，不必再在别处补一个断言。
 */
export function isSafeRelPath(rel: unknown): rel is string {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  if (rel.includes('\0')) return false;
  if (path.isAbsolute(rel)) return false;
  if (/^[A-Za-z]:/.test(rel)) return false;            // C:\... 或 C:foo
  if (rel.startsWith('\\\\') || rel.startsWith('//')) return false;  // UNC
  const parts = rel.split(/[\\/]+/).filter((s) => s.length > 0);
  if (parts.length === 0) return false;
  if (parts.some((s) => s === '..')) return false;
  return true;
}

/**
 * 把一个库内相对路径解析成绝对路径，并做**包含校验 + 链接校验**。
 *
 * @param root 库根（**来自注册表，不是客户端**）
 * @param rel  库内相对路径（来自索引或扫描结果）；传 null/非字符串会被 isSafeRelPath 拦下
 * @throws EngineError(PATH_ESCAPES_LIB | SYMLINK_REJECTED)
 */
export function resolveInLibrary(root: string, rel: unknown): string {
  if (!isSafeRelPath(rel)) {
    throw fail(ERR.PATH_ESCAPES_LIB, `不安全的相对路径：${String(rel).slice(0, 120)}`,
      { rel: String(rel).slice(0, 120) });
  }
  const rootAbs = norm(root);
  const target = norm(path.join(rootAbs, rel));

  // ③ 词法包含校验（先做：便宜且能拦住绝大多数越界）
  if (!sameOrUnder(target, rootAbs)) {
    throw fail(ERR.PATH_ESCAPES_LIB, `解析后越出库根：${rel}`, { rel, target, root: rootAbs });
  }

  // ④ 真实路径包含校验（拦住符号链接 / 联接点 / 8.3 短名等）
  if (fs.existsSync(target)) {
    let realRoot: string;
    let realTarget: string;
    try {
      realRoot = fs.realpathSync.native(rootAbs);
      realTarget = fs.realpathSync.native(target);
    } catch (e) {
      throw fail(ERR.PATH_ESCAPES_LIB, `路径无法解析真实路径：${rel}`, { rel, why: messageOf(e) });
    }
    if (!sameOrUnder(realTarget, realRoot)) {
      throw fail(ERR.SYMLINK_REJECTED,
        `目标真实路径在库根之外（符号链接/联接点）：${rel}`,
        { rel, realTarget, realRoot });
    }
    return realTarget;
  }

  // 不存在时：找到最深的已存在祖先，同样做真实路径校验（防止"经由链接到达的位置"）
  let probe = target;
  for (;;) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
    if (fs.existsSync(probe)) break;
  }
  if (fs.existsSync(probe)) {
    let realRoot: string;
    let realProbe: string;
    try {
      realRoot = fs.realpathSync.native(rootAbs);
      realProbe = fs.realpathSync.native(probe);
    } catch {
      return target;
    }
    if (!sameOrUnder(realProbe, realRoot)) {
      throw fail(ERR.SYMLINK_REJECTED,
        `目标的祖先目录真实路径在库根之外（符号链接/联接点）：${rel}`,
        { rel, realProbe, realRoot });
    }
  }
  return target;
}

/**
 * 查询图（**例外**）：用户临时挑的一张图，不在库内。
 * 契约 §2.1 明确允许它，但：只读、不写、且必须通过**扩展名白名单**。
 * 与 resolveInLibrary 分开写，是为了让"这是唯一的例外"在代码里显式可见。
 */
export function resolveQueryImage(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0) {
    throw fail(ERR.BAD_REQUEST, '查询图路径为空');
  }
  const ext = path.extname(p).toLowerCase();
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
  if (!allowed.has(ext)) {
    throw fail(ERR.BAD_REQUEST, `不支持的查询图格式：${ext || '(无扩展名)'}`,
      { ext, allowed: [...allowed] });
  }
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    throw fail(ERR.BAD_REQUEST, `查询图不存在或不是文件：${path.basename(p)}`, { ext });
  }
  return p;   // 原样返回：**只读使用**，不复制、不移动
}

/** 取件目标目录白名单（不变量 ②）。 */
export function assertCollectDirAllowed(targetDir: string, allowlist?: readonly string[] | null): string {
  const t = norm(targetDir);
  const hit = (allowlist || []).some((a) => sameOrUnder(t, norm(a)));
  if (!hit) {
    throw fail(ERR.COLLECT_DIR_NOT_ALLOWED, `取件目标不在白名单内：${targetDir}`,
      { targetDir: t, allowlist });
  }
  return t;
}

/** 注册表里的一条库登记（root 只在引擎内部出现） */
export interface LibraryEntry {
  libId: string;
  root: string;
  label: string;
}

/** config.json 里与库有关的部分（**外部 JSON**，字段可能缺失） */
export interface RegistryConfig {
  libraries?: Array<{ libId?: string; root?: string; label?: string }>;
  library_root?: string;
  lib_id?: string;
}

/** resolveByUid() 的返回 */
export interface ResolvedItem {
  lib: LibraryEntry;
  item: IndexItem;
  rel: string;
  abs: string;
}

/**
 * 库注册表。P1 从 config.json 派生单库；P5 扩为真正的多库注册表。
 * **root 只在这里出现** —— 这是"路径不能由客户端给"的实现方式。
 */
export class LibraryRegistry {
  /**
   * relOf 的注入点。**默认就是 index.ts 的那一份**（全仓唯一实现）——
   * 早先这里内联过一个同义 lambda，与 index.ts 的 relOf 构成第二份实现（P1 违规），
   * 类型化时顺手接回唯一实现：library.ts → index.ts 不构成环（index.ts 只 import errors.ts）。
   */
  static deps: { relOf: (item: unknown) => string | null } = { relOf };

  _libs: Map<string, LibraryEntry>;

  constructor(config: RegistryConfig = {}) {
    const libs = Array.isArray(config.libraries) && config.libraries.length
      ? config.libraries
      : (config.library_root
        ? [{ libId: config.lib_id || 'L1', root: config.library_root, label: '主库' }]
        : []);
    this._libs = new Map();
    for (const l of libs) {
      if (!l || !l.libId || !l.root) continue;
      this._libs.set(l.libId, { libId: l.libId, root: norm(l.root), label: l.label || l.libId });
    }
  }

  list(): LibraryEntry[] {
    return [...this._libs.values()].map((l) => ({ ...l }));
  }

  has(libId: string): boolean {
    return this._libs.has(libId);
  }

  /** @throws LIB_NOT_FOUND */
  get(libId: string): LibraryEntry {
    const l = this._libs.get(libId);
    if (!l) throw fail(ERR.LIB_NOT_FOUND, `库未注册：${libId}`, { libId, known: [...this._libs.keys()] });
    return { ...l };
  }

  /** @throws LIB_NOT_FOUND | LIB_ROOT_MISSING */
  requireExistingRoot(libId: string): LibraryEntry {
    const l = this.get(libId);
    if (!fs.existsSync(l.root) || !fs.statSync(l.root).isDirectory()) {
      throw fail(ERR.LIB_ROOT_MISSING, `库根不存在：${l.root}`, { libId, root: l.root });
    }
    return l;
  }

  /** 由 `lib_id + uid` 解析到库内条目（需要索引提供 relPath）。 */
  resolveByUid(libId: string, uid: string, items: IndexItem[]): ResolvedItem {
    const l = this.requireExistingRoot(libId);
    const { relOf: relOfItem } = LibraryRegistry.deps;
    const item = items.find((it) => it.uid === uid);
    if (!item) throw fail(ERR.UID_NOT_FOUND, `uid 不在索引中：${uid}`, { libId, uid });
    const rel = relOfItem(item);
    if (!rel) throw fail(ERR.INDEX_CORRUPT, `条目缺 relPath：${uid}`, { libId, uid });
    return { lib: l, item, rel, abs: resolveInLibrary(l.root, rel) };
  }
}
