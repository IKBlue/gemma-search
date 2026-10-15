// core/errors.ts —— 错误码与结果信封（docs/spec/CONTRACT-engine-v1.md §1）
//
// 契约要求：**按 code 分支，绝不按 message 分支**。
// 所以错误码在这里集中定义一次，界面与测试都从这里取。

/**
 * 契约 §1.3 的错误码（SPEC §5 的**唯一来源**）。
 * 20 个原始 + 2026-10-12 F-01 的 PORT_MISSING + 2026-10-15 T-45 的 7 个 IMPORT_*
 * + 2026-10-15 S7a 的 DB_OPEN_FAILED = **28**。
 * 冻结后新增 = 兼容，改名 = 破坏性。
 */
export const ERR = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  LIB_NOT_FOUND: 'LIB_NOT_FOUND',
  LIB_ROOT_MISSING: 'LIB_ROOT_MISSING',
  INDEX_MISSING: 'INDEX_MISSING',
  INDEX_CORRUPT: 'INDEX_CORRUPT',
  UID_NOT_FOUND: 'UID_NOT_FOUND',
  ITEM_MISSING_ON_DISK: 'ITEM_MISSING_ON_DISK',
  COMPAT_MISMATCH: 'COMPAT_MISMATCH',
  PATH_ESCAPES_LIB: 'PATH_ESCAPES_LIB',
  SYMLINK_REJECTED: 'SYMLINK_REJECTED',
  COLLECT_DIR_NOT_ALLOWED: 'COLLECT_DIR_NOT_ALLOWED',
  COLLECT_TARGET_EXISTS: 'COLLECT_TARGET_EXISTS',
  DISK_FULL: 'DISK_FULL',
  JOB_NOT_FOUND: 'JOB_NOT_FOUND',
  JOB_BUSY: 'JOB_BUSY',
  RECOVERY_NEEDED: 'RECOVERY_NEEDED',
  UNDO_EXPIRED: 'UNDO_EXPIRED',
  MODEL_MISSING: 'MODEL_MISSING',
  INTERNAL: 'INTERNAL',
  // 2026-10-12 新增（F-01）：引擎依赖一个**由外壳注入的能力端口**，而该端口没接上。
  // 契约 §1.3 明写「新增=兼容，改名=破坏性」，所以新增是安全的。
  PORT_MISSING: 'PORT_MISSING',
  // 2026-10-15 新增（T-45）：元数据导入 / 重建一族（SPEC §5，20 → 27 码）。
  // 为什么必须进**引擎码空间**：main 侧 storage-ports.engineCodeOf 把这些码归成 INDEX_CORRUPT ⇒
  // **假因果** —— 用户看到「索引文件已损坏」，而同一时刻体检说索引是好的（T-15b / T-42 实测）。
  // SPEC §5 明写这一族「**不得**归成 INDEX_CORRUPT」；走引擎端口（search/item/collect）那条路
  // 只有它们也在引擎码表里，main 的映射才能"引擎契约码原样透出"而不必再抄一份前缀表。
  IMPORT_FAILED: 'IMPORT_FAILED',
  IMPORT_INPUT_INVALID: 'IMPORT_INPUT_INVALID',
  IMPORT_SOURCE_INVALID: 'IMPORT_SOURCE_INVALID',
  IMPORT_INDEX_UNREADABLE: 'IMPORT_INDEX_UNREADABLE',
  IMPORT_RECORD_INVALID: 'IMPORT_RECORD_INVALID',
  IMPORT_DUPLICATE_UID: 'IMPORT_DUPLICATE_UID',
  IMPORT_COUNT_MISMATCH: 'IMPORT_COUNT_MISMATCH',
  // 2026-10-15 新增（S7a）：`.gs.db` 打不开（损坏 / 被占用）时**唯一**的名字。
  // SPEC §5.2 明写「库坏 ≠ 索引坏」并且**不得**归成 INDEX_CORRUPT —— 索引可能完好，
  // 让用户去「重建索引」是**指错方向**（T-45 实测：同一个坏库，经引擎端口那条路报
  // INDEX_CORRUPT、体检那条路报 DB_OPEN_FAILED ⇒ 一颗坏库两个名字）。
  DB_OPEN_FAILED: 'DB_OPEN_FAILED',
});

/** ERR 的取值联合。有了它，`USER_MESSAGE[code]` 这类查表在编译期就能被检查（不必用 any）。 */
export type ErrorCode = (typeof ERR)[keyof typeof ERR];

/**
 * 错误信封里的 details：调用方塞进去的诊断信息。
 * **故意是 unknown**：引擎只负责把它原样搬到信封里，不假装知道各家调用方塞了什么形状。
 */
export type ErrorDetails = Record<string, unknown>;

/**
 * 用户可见文案。**不含绝对路径**（界面可能显示、可能被截图外发）。
 * 契约 §1.3 的表格逐条对应。
 */
export const USER_MESSAGE = Object.freeze({
  BAD_REQUEST: '请求参数不合法。',
  LIB_NOT_FOUND: '找不到素材库，可能已被移动或移除。',
  LIB_ROOT_MISSING: '素材库目录不存在（可能盘符变了或盘未挂载）。',
  INDEX_MISSING: '这个库还没有索引，先建一次索引。',
  INDEX_CORRUPT: '索引文件已损坏，需要重建。',
  UID_NOT_FOUND: '这条素材已不在索引中（可能已被移出库）。',
  ITEM_MISSING_ON_DISK: '素材文件找不到了，可能被移动或删除。',
  COMPAT_MISMATCH: '这个库与当前库的索引不兼容，无法一起检索。',
  PATH_ESCAPES_LIB: '拒绝访问：目标超出了素材库范围。',
  SYMLINK_REJECTED: '拒绝访问：检测到指向库外的链接。',
  COLLECT_DIR_NOT_ALLOWED: '不允许写入该目录，请在设置里选择允许的目录。',
  COLLECT_TARGET_EXISTS: '目标目录已有同名文件。',
  DISK_FULL: '目标磁盘空间不足。',
  JOB_NOT_FOUND: '任务不存在或已结束。',
  JOB_BUSY: '这个库已经在执行同类任务了。',
  RECOVERY_NEEDED: '上次操作未完成，需要先恢复。',
  UNDO_EXPIRED: '这次操作已超过可撤销期限。',
  MODEL_MISSING: '还没有准备好模型文件，先下载一次。',
  INTERNAL: '出了点问题，详情见日志。',
  // ⚠️ 文案**不含绝对路径**（界面可能显示、可能被截图外发），也不假装是"文件问题" ——
  // 这是**能力没接上**，与用户的操作无关。故意说得保守：我们只知道端口没被注入，
  // 不知道资源管理器那边会怎样。
  PORT_MISSING: '这个功能在当前环境里不可用（缺少所需的系统接口）。',
  // 2026-10-15 新增（T-45）：导入 / 重建一族。**用户文案的唯一来源就是本表** ——
  // main 侧 library-ipc.ts 曾自己抄一份（MAIN_USER_MESSAGE），T-45 已删掉那份副本（AGENTS P1：
  // 同一概念不许有两份定义）。文案要讲清"本次没有改动任何数据"，否则用户会以为库里留了半份。
  IMPORT_FAILED: '重建元数据时写不进去（临时目录或库根不可写），本次没有改动任何数据。',
  IMPORT_INPUT_INVALID: '重建的输入不完整（缺条目表或落点不可用），修好之后再来一次。',
  IMPORT_SOURCE_INVALID: '条目表读不动或格式不对，重建没有开始。',
  IMPORT_INDEX_UNREADABLE: '索引读不动，重建没有开始（可以先重新建一次索引）。',
  IMPORT_RECORD_INVALID: '条目表里有不合法的条目，重建没有开始（详情见日志）。',
  IMPORT_DUPLICATE_UID: '条目表里有重复的 uid，重建没有开始（详情见日志）。',
  IMPORT_COUNT_MISMATCH: '条目表与索引的条数对不上，重建没有开始（详情见日志）。',
  // SPEC §5.2 的用户文案（唯一来源）。
  // ⚠️ SPEC 原文用 Markdown 加粗标了「索引文件没坏」几个字 —— 那是文档的强调标记，
  //    不是用户可见字符（本仓库 V-40/CP-2：非注释里的加粗标记会按字面显示给用户）
  //    ⇒ 这里去掉标记，文字逐字相同。
  DB_OPEN_FAILED: '这个库的元数据打不开（文件可能损坏或被占用）。索引文件没坏 —— 先试「重建元数据」，不行再看诊断。',
});

/** 引擎内部的类型化错误。**不直接抛给调用方** —— 由 envelope() 转成 §1.1 的信封。 */
export class EngineError extends Error {
  code: ErrorCode;
  details: ErrorDetails;

  constructor(code: ErrorCode, message?: string, details: ErrorDetails = {}) {
    super(message || code);
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
  }
}

export const fail = (code: ErrorCode, message?: string, details: ErrorDetails = {}): EngineError =>
  new EngineError(code, message, details);

/** 成功信封 */
export interface OkEnvelope<T = unknown> {
  ok: true;
  data: T;
  warnings: string[];
}

/** 失败信封（§1.1） */
export interface ErrEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    userMessage: string;
    details: ErrorDetails;
  };
}

export type Envelope<T = unknown> = OkEnvelope<T> | ErrEnvelope;

/** 成功信封 */
export const ok = <T>(data: T, warnings: string[] = []): OkEnvelope<T> => ({ ok: true, data, warnings });

/** 失败信封（§1.1） */
export function err(code: ErrorCode, message?: string, details: ErrorDetails = {}): ErrEnvelope {
  return {
    ok: false,
    error: {
      code,
      message: message || code,
      userMessage: USER_MESSAGE[code] || USER_MESSAGE.INTERNAL,
      details,
    },
  };
}

/**
 * 把 catch 到的 unknown 变成可读文案。
 * catch 的变量现在是 unknown（useUnknownInCatchVariables），**不许直接取属性** ——
 * 所以这里显式收窄：Error 取 message，长得像 { message } 的取 message，其余给 'unknown'。
 * 语义与原 JS 版一致：message 为空/假值时仍回落到 'unknown'。
 */
export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message || 'unknown';
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (m) return String(m);
  }
  return 'unknown';
}

/**
 * 把任意函数包成"永不抛异常给调用方"的形态（契约 §1.1）。
 * 内部异常一律转成信封：EngineError 保留 code，其余归为 INTERNAL。
 */
export async function envelope<T>(fn: () => T | Promise<T>): Promise<T | ErrEnvelope> {
  try {
    // ⚠️ **原样返回**，不要再包一层 `ok()`：被包的都是引擎自己已经返回信封的方法
    //    （`doSearch`/`doCollect`/… 都 return `ok({...})`）。这里再包一次 = 双层信封，
    //    调用方读 `res.data.results` 会拿到 undefined —— 实测就是这么被 fake 用例抓到的。
    return await fn();
  } catch (e) {
    if (e instanceof EngineError) return err(e.code, e.message, e.details);
    return err(ERR.INTERNAL, messageOf(e));
  }
}
