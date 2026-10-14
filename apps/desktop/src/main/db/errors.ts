// apps/desktop/src/main/db/errors.ts —— .gs.db 层的**类型化错误**（T-11a）
//
// 为什么不用裸 Error：
//   .gs.db 会坏、会来自未来版本、会在迁移中途失败。调用方（T-15 的自检/重建入口、
//   T-11b 的导入）必须能**按机器可读的 code 分流**，而不是去 match 中文文案
//   （文案会漂移，且让断言变成猜字符串）。
//
// 为什么 code 是**联合字面量**而不是 string：
//   拼错 code 是编译期错误；新增 code 时 TS 会指出所有需要处理的分支。

/** .gs.db 层能抛出的全部错误码（每一种都对应一个明确的处置建议，见 message） */
export type GsDbErrorCode =
  /** dbPath 为空 / 不是字符串能表达的东西 */
  | 'DB_PATH_REQUIRED'
  /** 父目录建不出来（盘没了 / 权限不足 / 路径被文件占着） */
  | 'MKDIR_FAILED'
  /** 驱动打开失败：文件不是 SQLite、被别的进程锁死、readOnly 而文件不存在 …… */
  | 'DB_OPEN_FAILED'
  /** 删除 .gs.db（或其 -wal/-shm/-journal 边车）失败 —— 通常是连接还没关 */
  | 'DB_REMOVE_FAILED'
  /** 元表 schema_version 里没有 id=1 那一行（建表逻辑被绕过或文件被外部改过） */
  | 'META_ROW_MISSING'
  /** 迁移清单本身不合法：版本号非正整数 / 重复 / 不递增 */
  | 'MIGRATION_LIST_INVALID'
  /** 某一条迁移执行失败（已回滚，版本号保持在上一条） */
  | 'MIGRATION_FAILED'
  /** 库里的版本**高于**本程序知道的版本 ⇒ 不许降级瞎改，提示删库重建（SPEC §2.1） */
  | 'SCHEMA_TOO_NEW'
  /** 迁移清单出现断代（v_n 之后直接是 v_{n+2}）—— 历史只能追加，不许挖洞 */
  | 'SCHEMA_GAP'
  /** 从 SQLite 读回来的值不是本层认识的类型（理论上到不了；到了也**不许静默**） */
  | 'UNEXPECTED_SQL_VALUE';

/**
 * .gs.db 层的统一错误类型。
 *
 * `cause` 必须保留原始错误（node:sqlite 的报错里带 SQLite 的错误码与 SQL 片段，
 * 丢掉它排查成本会翻倍）。
 */
export class GsDbError extends Error {
  readonly code: GsDbErrorCode;

  constructor(code: GsDbErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GsDbError';
    this.code = code;
  }
}

/**
 * unknown → 可读文案。
 *
 * ⚠️ 不复用 storage-roots.ts 里的私有同名函数：那个模块与本模块没有别的依赖关系，
 *    为了三行格式化把 db 层绑到"存储落点"模块上不划算（反过来也一样）。
 *    这里唯一的约定是：**非 Error 的东西也要给出确定文本**，不许变成 "[object Object]"。
 */
export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
