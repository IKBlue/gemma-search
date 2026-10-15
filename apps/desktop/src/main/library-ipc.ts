// apps/desktop/src/main/library-ipc.ts —— 体检 / 重建 两个 IPC 方法的主进程实现（T-15a · 2026-10-15 所有者批准）
//
// ⚠️ **为什么不写在 index.ts 里**：index.ts import 了 electron ⇒ node:test **加载不了**它，
//    于是"信封组装 + 错误码映射 + 永不抛"这三件最该有测试的事会变成零自动化覆盖。
//    抽到这里之后它是**可直接单测的**，index.ts 只留一句"把已解析的库清单递进来"
//    —— 与当初把 thumb-url.ts 抽出去的理由完全一样（那次的教训写在 index.ts:520 附近）。
//
// 契约（SPEC §5，2026-10-15 批准 · 只批了这两个方法，**不发事件**）：
//   libraryHealth  { libId }  只读 ⇒ 结构化体检结论（每项 ok + 错误码 + 人话理由）
//   libraryRebuild { libId }  删 .gs.db 家族并从 items.json 重建 ⇒ 重建报告；**不碰素材**
import path from 'node:path';

import { ERR, USER_MESSAGE } from '../../../../packages/engine/src/errors.ts';
import type { Envelope } from '../shared/ipc.ts';
import { codeOf, messageOf } from './errors.ts';
import { checkLibraryHealth } from './library-health.ts';
import { rebuildLibraryDb } from './library-rebuild.ts';
import { log } from './log.ts';
import { asEngineError, createLibraryResolverPort } from './storage-ports.ts';
import type { LibraryRootInput } from './storage-roots.ts';

export interface LibraryMethodInput {
  libId: string;
  /** 已解析的库清单（index.ts 从 library-config 拿）——本模块**不自己**解析"库从哪来" */
  libraries: LibraryRootInput[];
  /** T-04 的 userData 回退落点；null = 没有 */
  userDataDir: string | null;
  /**
   * 旧布局的 libraries 根（`<dataDir>/libraries`）。给了 ⇒ 索引查找会**回退到旧布局**（T-44）。
   * 省略 = 只认新布局（迁移完成后可以不再传）。
   */
  legacyLibrariesDir?: string | null;
}

/** 引擎契约码集合（唯一来源 = 引擎的 ERR） */
const ENGINE_CODES: ReadonlySet<string> = new Set(Object.values(ERR));

/** 引擎 USER_MESSAGE 表里没有的码（main 私有码：MKDIR_FAILED / DB_PATH_REQUIRED…）的兜底文案 */
const FALLBACK_USER_MESSAGE: string = '处理这个素材库时出了点问题，详情见日志。';

/**
 * 用户文案：**唯一来源是引擎的 USER_MESSAGE**（AGENTS P1：同一概念不许两份定义）。
 *
 * 导入族 IMPORT_* 的文案自 T-45 起写在 `packages/engine/src/errors.ts` 里；
 * 这里以前自己抄了一份 MAIN_USER_MESSAGE —— 两份文案会各自漂移，已删除（T-45）。
 */
function userMessageFor(code: string): string {
  const m = (USER_MESSAGE as Record<string, string>)[code];
  return typeof m === 'string' && m ? m : FALLBACK_USER_MESSAGE;
}

/**
 * 错误码归一：**先把已经是引擎契约码的原样透出**，其余才走既有的映射表。
 *
 * ⚠️ 顺序不能反：`asEngineError()` 会把**未知**码归成 INTERNAL，而 `.gs-index.bin` 的损坏
 *    抛的是 IndexFileError('INDEX_CORRUPT') —— 那个码**本来就是契约要的**，
 *    交给映射表会变成 INTERNAL（T-15a 明文禁止："坏索引仍报 INDEX_CORRUPT，不许归成 INTERNAL"）。
 *    只有 main 侧私有码（DB_OPEN_FAILED / IMPORT_* / MKDIR_FAILED…）才需要映射
 *    （那张表把"元数据坏了"归到 INDEX_CORRUPT —— 也是契约要的处置码）。
 */
function normalizeCode(e: unknown): string {
  const raw = codeOf(e);
  if (ENGINE_CODES.has(raw)) return raw;
  // ② 其余 main 私有码（DB_OPEN_FAILED / MKDIR_FAILED / DB_PATH_REQUIRED…）才走映射表。
  //    T-42 时这里还需要一条 `PASS_THROUGH_PREFIXES = ['IMPORT_']` —— 那时 IMPORT_* **不在**引擎码表里。
  //    T-45 把它们收进引擎码空间后，那条前缀分支成了死代码，已删：
  //    真因果由**码空间**承担，不靠调用方约定前缀。
  return asEngineError(e, '库操作').code;
}

/** 错误 → 失败信封。三条纪律：**永不抛** · userMessage 恒非空 · 不把已知码吞成 INTERNAL */
function failure(e: unknown, what: string, libId: string): Envelope {
  const code = normalizeCode(e);
  const message = messageOf(e);
  log('!! ' + what + '失败 [' + code + ']', message);
  return {
    ok: false,
    error: {
      code,
      message,
      userMessage: userMessageFor(code),
      details: { libId, rawCode: codeOf(e) },
    },
  };
}

function resolverFor(input: LibraryMethodInput) {
  return createLibraryResolverPort({
    libraries: input.libraries,
    userDataDir: input.userDataDir ?? undefined,
    // 索引落点判据的唯一来源是引擎的 resolveIndexLocation；这里只把旧布局根递进去（T-44）
    legacyLibrariesDir: input.legacyLibrariesDir ?? null,
    // ⚠️ 写探测保持关闭：体检/重建的**每一次调用**都会走到这里，开着会在库根反复写删探针文件。
    //    "能不能写"由 T-04 的启动期解析负责（storage-roots 自己会探），这里只消费它的结论。
  });
}

/** 体检（只读）。**永不抛**：库不存在/库根缺失/索引坏了都变成结构化结论或带码信封。 */
export function runLibraryHealth(input: LibraryMethodInput): Envelope {
  let storage;
  try {
    storage = resolverFor(input).storageOf(input.libId);
  } catch (e) {
    return failure(e, '体检', input.libId);
  }
  try {
    const report = checkLibraryHealth({
      libId: input.libId,
      root: storage.root,
      dbPath: storage.dbPath,
      itemsJsonPath: path.join(storage.root, 'items.json'),
      legacyLibrariesDir: input.legacyLibrariesDir ?? null,
    });
    log('[体检]', input.libId, report.ok ? 'ok' : '有问题', '·', report.reason);
    return { ok: true, data: report };
  } catch (e) {
    return failure(e, '体检', input.libId);
  }
}

/** 删 .gs.db 家族并重建（**不碰素材**）。**永不抛**。 */
export function runLibraryRebuild(input: LibraryMethodInput): Envelope {
  let storage;
  try {
    storage = resolverFor(input).storageOf(input.libId);
  } catch (e) {
    return failure(e, '重建', input.libId);
  }
  try {
    const report = rebuildLibraryDb({
      libId: input.libId,
      root: storage.root,
      dbPath: storage.dbPath,
      itemsJsonPath: path.join(storage.root, 'items.json'),
      legacyLibrariesDir: input.legacyLibrariesDir ?? null,
    });
    log(
      '[重建]',
      input.libId,
      '· dbCount=' + String(report.import.dbCount),
      '· 索引处置=' + report.index.action,
      '·',
      report.reason,
    );
    return { ok: true, data: report };
  } catch (e) {
    return failure(e, '重建', input.libId);
  }
}
