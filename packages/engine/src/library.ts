// core/library.ts —— 库注册表 + 安全路径解析
//
// 这是 SPEC.md §5 的落点，也是 G-C 要求的**引擎层安全不变量**：
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
  if (/^[A-Za-z]:/.test(rel)) return false; // C:\... 或 C:foo
  if (rel.startsWith('\\\\') || rel.startsWith('//')) return false; // UNC
  const parts = rel.split(/[\\/]+/).filter((s) => s.length > 0);
  if (parts.length === 0) return false;
  if (parts.some((s) => s === '..')) return false;
  return true;
}

/**
 * 「路径必须在基目录内」的逐段校验结果。**B 与 DF-9 共用同一份实现**（P1：不许复制第二份）。
 */
export interface InsideCheck {
  ok: boolean;
  /** 失败类别：'lexical' 词法就越界 · 'unresolvable' 存在但拿不到真实路径（悬挂链接/权限） · 'escapes' 真实路径在基目录外 */
  kind: 'lexical' | 'unresolvable' | 'escapes' | null;
  /** 通过时：目标最终路径（目标存在 ⇒ **真实路径**；不存在 ⇒ 词法路径） */
  resolved: string;
  /** 失败上下文（放进错误 details，便于排障） */
  detail: Record<string, unknown>;
}

/**
 * **唯一一份**「逐段下行 + 真实路径包含校验」。消费方：`resolveInLibrary`（库根边界，DF-7 B）
 * 与 `assertCollectDirAllowed`（取件白名单，DF-9）—— 两者语义同口径，**不许各写一份**。
 *
 * 为什么必须逐段 lstat（DF-7/DF-9 都栽在这）：`existsSync` **跟随链接**，悬挂/不可 stat 的链接返回 false，
 * 于是「找最深已存在祖先」会**静默跳过那个链接组件**，去校验更上层目录，最后放行一条带链接组件的词法路径
 * —— 实测能真的写到基目录外。逐段 `lstat` 才能**看见**悬挂链接。
 *
 * 三条纪律：① `lstat` 不跟随 → 看得见悬挂链接；② 每段 `realpath` 并校验包含；
 * ③ **拿不到结论就拒**（fail-closed，由调用方映射成自己的错误码）。
 *
 * ⚠️ 基目录本身**连 lstat 都不存在**时（例如白名单只在某台机器上有的盘符、或库根还没建）：
 *    它下面**不可能有链接可穿越** ⇒ 词法结论就是全部，返回 ok —— 这条规则 B 与 DF-9 共享，
 *    否则「配置了但当前不存在的白名单目录」会被误拒（既有用例 ② 会红）。
 */
export function checkPathInsideBase(baseAbs: string, targetAbs: string): InsideCheck {
  const base = path.resolve(baseAbs);
  const target = path.resolve(targetAbs);
  const probe = (p: string): fs.Stats | undefined => fs.lstatSync(p, { throwIfNoEntry: false });

  // ① 词法包含（便宜，且能拦住绝大多数越界；比较带分隔符，防同前缀兄弟目录）
  if (!sameOrUnder(target, base)) {
    return { ok: false, kind: 'lexical', detail: { target, base }, resolved: target };
  }

  // ② 基目录不存在 ⇒ 无链接可穿越（见函数头注释）
  if (probe(base) === undefined) return { ok: true, kind: null, detail: {}, resolved: target };

  let realBase: string;
  try {
    realBase = fs.realpathSync.native(base);
  } catch (e) {
    return {
      ok: false,
      kind: 'unresolvable',
      detail: { base, why: messageOf(e) },
      resolved: target,
    };
  }

  // ③ 自基目录逐段下行
  const parts = path
    .relative(base, target)
    .split(/[\\/]+/)
    .filter((s) => s.length > 0 && s !== '.');
  let cur = base;
  for (const part of parts) {
    cur = path.join(cur, part);
    const st = probe(cur);
    if (st === undefined) break; // 这一段（连 lstat 都）不存在 ⇒ 之后的更不存在，词法路径安全
    let realCur: string;
    try {
      realCur = fs.realpathSync.native(cur);
    } catch (e) {
      // 存在但拿不到真实路径（悬挂链接 / 权限拒绝）⇒ 无法证明在里面 ⇒ 拒
      return {
        ok: false,
        kind: 'unresolvable',
        detail: { component: cur, why: messageOf(e) },
        resolved: target,
      };
    }
    if (!sameOrUnder(realCur, realBase)) {
      return {
        ok: false,
        kind: 'escapes',
        detail: { component: cur, realCur, realBase },
        resolved: target,
      };
    }
    let isDir = false;
    try {
      isDir = fs.statSync(cur).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) break; // 组件是文件 ⇒ 后面的不可能存在
  }

  // ④ 目标本身存在 ⇒ 返回**真实路径**（与旧实现「目标存在就回真实路径」一致，调用方依赖它）
  if (probe(target) !== undefined) {
    try {
      return { ok: true, kind: null, detail: {}, resolved: fs.realpathSync.native(target) };
    } catch (e) {
      return {
        ok: false,
        kind: 'unresolvable',
        detail: { component: target, why: messageOf(e) },
        resolved: target,
      };
    }
  }
  return { ok: true, kind: null, detail: {}, resolved: target };
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
    throw fail(ERR.PATH_ESCAPES_LIB, `不安全的相对路径：${String(rel).slice(0, 120)}`, {
      rel: String(rel).slice(0, 120),
    });
  }
  const rootAbs = norm(root);
  const target = norm(path.join(rootAbs, rel));

  const chk = checkPathInsideBase(rootAbs, target);
  if (!chk.ok) {
    // 错误码与文案按**原语义**分流：词法越界/拿不到结论 ⇒ PATH_ESCAPES_LIB；真实路径在库外 ⇒ SYMLINK_REJECTED
    if (chk.kind === 'escapes') {
      throw fail(ERR.SYMLINK_REJECTED, `目标的真实路径在库根之外（符号链接/联接点）：${rel}`, {
        rel,
        ...chk.detail,
      });
    }
    throw fail(
      ERR.PATH_ESCAPES_LIB,
      chk.kind === 'lexical'
        ? `解析后越出库根：${rel}`
        : `路径组件存在但无法解析真实路径（链接悬挂或权限不足）：${rel}`,
      { rel, ...chk.detail },
    );
  }
  return chk.resolved;
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
    throw fail(ERR.BAD_REQUEST, `不支持的查询图格式：${ext || '(无扩展名)'}`, {
      ext,
      allowed: [...allowed],
    });
  }
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) {
    throw fail(ERR.BAD_REQUEST, `查询图不存在或不是文件：${path.basename(p)}`, { ext });
  }
  return p; // 原样返回：**只读使用**，不复制、不移动
}

/** 取件目标目录白名单（不变量 ②）。 */
export function assertCollectDirAllowed(
  targetDir: string,
  allowlist?: readonly string[] | null,
): string {
  const t = norm(targetDir);
  const hit = (allowlist || []).map((a) => norm(a)).find((a) => sameOrUnder(t, a));
  if (!hit) {
    throw fail(ERR.COLLECT_DIR_NOT_ALLOWED, `取件目标不在白名单内：${targetDir}`, {
      targetDir: t,
      allowlist,
    });
  }
  // ⚠️ DF-9：词法命中**不够** —— 白名单目录里塞一个 junction，`E:\取件\link\System32` 词法照样命中，
  //    而写入实际落在白名单外（与 DF-7 B 同根因）。⇒ 复用**同一份**逐段真实路径校验，拿不到结论就拒。
  //    触发条件只**收紧**不放宽：真不在白名单时，上面那条错误码与文案原样不变。
  const chk = checkPathInsideBase(hit, t);
  if (!chk.ok) {
    throw fail(ERR.COLLECT_DIR_NOT_ALLOWED, `取件目标不在白名单内：${targetDir}`, {
      targetDir: t,
      allowlist,
      why: chk.kind,
      ...chk.detail,
    });
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
    const libs =
      Array.isArray(config.libraries) && config.libraries.length
        ? config.libraries
        : config.library_root
          ? [{ libId: config.lib_id || 'L1', root: config.library_root, label: '主库' }]
          : [];
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
    if (!l)
      throw fail(ERR.LIB_NOT_FOUND, `库未注册：${libId}`, { libId, known: [...this._libs.keys()] });
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
