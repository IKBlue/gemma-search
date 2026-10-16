// packages/engine/src/transactions/states.ts —— 事务状态机（纯函数，规格 §2/§4/§5）
//
// 本文件**只做判定，不碰文件系统**。理由：状态机是这套东西的安全核心，
// 而"某状态该前进/回退/停下问人"这类判断只有抽成纯函数才进得了 `npm test`（本仓库反复栽在这上面）。
//
// 规格出处：`SPEC.md` §2.1（写入不变式）
//   §2 状态机（含每个状态恢复时怎么处理）
//   §4 启动恢复（判定表）
//   §5 并发与取消（**COMMITTED 之后不可取消**）

/** 全部状态。⚠️ 字符串必须与规格 §2 的表**逐字一致** —— 它们会写进日志文件。 */
export const S = Object.freeze({
  PREPARED: 'PREPARED',
  STAGED: 'STAGED',
  VERIFIED: 'VERIFIED',
  COMMITTED: 'COMMITTED',
  CLEANED: 'CLEANED',
  ABORTED: 'ABORTED',
  RECOVERY_NEEDED: 'RECOVERY_NEEDED',
});

/**
 * 状态名。这些函数接的是**日志里读回来的字符串**（可能是任何东西，甚至是损坏的日志），
 * 所以参数类型必须是宽泛的 string，而不是 `(typeof S)[keyof typeof S]` ——
 * 从日志读回来的值在运行期本来就不受类型约束，收窄参数类型只会在调用点制造假断言。
 */
export type StateName = string;

/**
 * 前进路径（§2 的主链）。**顺序即语义**，不要当普通数组用。
 * 标注成 readonly string[] 是为了让 `FORWARD.indexOf(st)`（st: string）能编译 ——
 * 若保留字面量元组类型，indexOf 会退化成只接受那几个字面量。
 */
export const FORWARD: readonly string[] = Object.freeze([
  S.PREPARED,
  S.STAGED,
  S.VERIFIED,
  S.COMMITTED,
  S.CLEANED,
]);

/** 终态：到了就不该再动文件（§4「归档日志，不动文件」） */
export const TERMINAL: readonly string[] = Object.freeze([S.CLEANED, S.ABORTED]);

/** 中间态：进程被杀后需要恢复介入的状态 */
export const NON_TERMINAL: readonly string[] = Object.freeze([
  S.PREPARED,
  S.STAGED,
  S.VERIFIED,
  S.COMMITTED,
  S.RECOVERY_NEEDED,
]);

/** S 的值集合（同 FORWARD 的理由：让 string 参数能查） */
const KNOWN_STATES: readonly string[] = Object.values(S);

export const isTerminal = (st: StateName): boolean => TERMINAL.includes(st);
export const isKnown = (st: StateName): boolean => KNOWN_STATES.includes(st);

/** 主链上的下一步；终态或认不出的状态返回 null（**不猜**） */
export function nextOf(st: StateName): string | null {
  const i = FORWARD.indexOf(st);
  if (i < 0) return null;
  return i === FORWARD.length - 1 ? null : FORWARD[i + 1];
}

/**
 * 是否允许从 `from` 跃迁到 `to`。
 *
 * 允许的只有三类（§2）：
 *   ① 主链**前进一步**（不许跳步：`PREPARED → VERIFIED` 会把 STAGED 的校验整段跳过）
 *   ② 从**任意非终态**进入 `RECOVERY_NEEDED`（"判定不唯一"时）
 *   ③ 进入 `ABORTED`：只允许从 `PREPARED` / `STAGED` / `VERIFIED`（§2 的图里这三处有回退箭头）
 *      —— ⚠️ **`COMMITTED` 不许 ABORT**：那时目标已是最终名，只能"完成它"（§3 第 5 条的注释）
 */
export function canTransition(from: StateName, to: StateName): boolean {
  if (!isKnown(from) || !isKnown(to)) return false;
  if (from === to) return false; // 原地不动不算跃迁
  if (isTerminal(from)) return false; // 终态不可再变（幂等恢复的前提）
  if (to === S.RECOVERY_NEEDED) return !isTerminal(from);
  if (to === S.ABORTED) return from === S.PREPARED || from === S.STAGED || from === S.VERIFIED;
  return nextOf(from) === to; // 其余只允许主链前进一步
}

/**
 * 能否取消（§5）：「只在**状态边界**生效：`PREPARED`/`STAGED`/`VERIFIED` 可取消并回退；
 * **`COMMITTED` 之后不可取消** —— 必须把索引更新完，否则就制造了半完成状态」。
 */
export const canCancel = (st: StateName): boolean =>
  st === S.PREPARED || st === S.STAGED || st === S.VERIFIED;

/**
 * §4 的**恢复判定表**：对每个非终态，恢复时该做什么。
 *
 * ⚠️ 这是本模块里最要紧的一张小表 —— 它决定"进程被杀之后到底前进还是回退"。
 * 返回值刻意是**动作名**而不是函数：这样它可断言、可双向验证，也不会在判定阶段就动文件。
 */
export const ACTION = Object.freeze({
  ROLLBACK: 'rollback', // 清 staging，源不动
  VERIFY: 'verify', // 比对 stagedSha1：一致→前进；不一致→回退
  ADVANCE: 'advance', // 继续把它做完（rename / 索引 / 清源）
  ASK_HUMAN: 'ask-human', // 判定不唯一 ⇒ 停下问人，绝不猜
  ARCHIVE: 'archive', // 终态 ⇒ 归档日志，不动文件
});

/** ACTION 的取值联合 */
export type RecoveryAction = (typeof ACTION)[keyof typeof ACTION];

export function recoveryActionOf(st: StateName): RecoveryAction {
  switch (st) {
    case S.PREPARED:
      return ACTION.ROLLBACK; // §4「PREPARED → 回退（删 staging）」
    case S.STAGED:
      return ACTION.VERIFY; // §4「STAGED → 校验 staging；一致则前进，不一致则回退」
    case S.VERIFIED:
      return ACTION.ADVANCE; // §4「VERIFIED / COMMITTED → 前进」
    case S.COMMITTED:
      return ACTION.ADVANCE;
    case S.RECOVERY_NEEDED:
      return ACTION.ASK_HUMAN;
    case S.CLEANED:
      return ACTION.ARCHIVE;
    case S.ABORTED:
      return ACTION.ARCHIVE;
    default:
      return ACTION.ASK_HUMAN; // 认不出的状态**不许猜**，交给人（同 §2 的"判定不唯一"精神）
  }
}

/**
 * 判定不唯一的两种情形（§4 原文）：
 *   「源与目标都存在且字节不同，或 staging 丢失但源已不在」⇒ `RECOVERY_NEEDED`
 *
 * 这里只给**判据**，不读盘 —— 调用方把 exists/hash 的结果传进来。
 *
 * ⚠️⚠️ 第二条**必须再加一个条件**，否则会把"正常完成"误判成"不唯一"：
 *    `staging` 丢失 + 源不在，**既可能是数据不知去向**（该问人），
 *    **也可能是 rename 已经成功**（目标正拿着这份内容 —— 那是正常前进，不是歧义）。
 *    区分它们只能看**目标是否就是期望的那份字节**。本仓库实测踩过：
 *    `COMMITTED` 状态（已完成 rename、只差索引）在旧判据下会被判成 `RECOVERY_NEEDED`，
 *    ⇒ 恢复流程永远停住问人，正常事务再也走不完（测试 `RC-6`/`RC-9` 抓到）。
 */
export interface AmbiguityFacts {
  srcExists: boolean;
  dstExists: boolean;
  sameBytes: boolean | null;
  stagingExists: boolean;
  dstHasExpectedBytes?: boolean | null;
}

/** @returns true = 必须停下问人 */
export function isAmbiguous(f: AmbiguityFacts): boolean {
  // 源与目标都在，且字节不同 ⇒ 谁也说不清该保留哪个
  if (f.srcExists && f.dstExists && f.sameBytes === false) return true;
  // staging 丢了、源也没了 ⇒ 得看目标是不是"就是它"；是 ⇒ rename 成功了，不是歧义
  if (!f.stagingExists && !f.srcExists) return f.dstHasExpectedBytes !== true;
  return false;
}
