// core/errors.mjs —— 错误码与结果信封（docs/spec/CONTRACT-engine-v1.md §1）
//
// 契约要求：**按 code 分支，绝不按 message 分支**。
// 所以错误码在这里集中定义一次，界面与测试都从这里取。

/** 契约 §1.3 的 19 个错误码。冻结后新增=兼容，改名=破坏性。 */
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
});

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
});

/** 引擎内部的类型化错误。**不直接抛给调用方** —— 由 envelope() 转成 §1.1 的信封。 */
export class EngineError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
  }
}

export const fail = (code, message, details) => new EngineError(code, message, details);

/** 成功信封 */
export const ok = (data, warnings = []) => ({ ok: true, data, warnings });

/** 失败信封（§1.1） */
export function err(code, message, details = {}) {
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
 * 把任意函数包成"永不抛异常给调用方"的形态（契约 §1.1）。
 * 内部异常一律转成信封：EngineError 保留 code，其余归为 INTERNAL。
 */
export async function envelope(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EngineError) return err(e.code, e.message, e.details);
    return err(ERR.INTERNAL, e && e.message ? String(e.message) : 'unknown');
  }
}
