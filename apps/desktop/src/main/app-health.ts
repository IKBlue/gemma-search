// apps/desktop/src/main/app-health.ts —— `appHealth` 的第 22 个只读方法（U27 · 2026-10-16）
//
// ── 它解决什么（设计稿：reports/2026-10-15-wave3/appHealth-demo.html）─────────
//   DF-6 之后 `unhandledRejection` 会**标记进程内不健康态**（crash-policy.ts），但那个标记只活在主进程里：
//   用户遇到的是「应用有点怪，但没有任何提示」—— 与本项目「最怕静默」的口径冲突。
//   本方法把**同一份事实**接到界面上：只暴露，不修复。
//
// ── 三条硬口径（Lead 2026-10-16 裁定，别改）─────────────────────────────────
//   ① **只放进程内事实**：数据唯一来源是 `crash-policy.ts` 的 `snapshot()`，**不产生第二份真相**；
//   ② **不含** `sessionExit`、**不持久化**「上次崩溃」：不写 `app_meta`（那会留下一个下次启动必然过期的假标记）。
//      「上个会话异常退出」由**日志**说明，界面只给「打开日志」入口 —— **宁可不显示，也不猜**；
//   ③ **不含路径 / 用户名 / 堆栈正文**，**不上报**，**恒成功**（查不到事实本身就是事实 ⇒ ok 恒 true）。
//
// ⚠️ 为什么不写在 index.ts 里：index.ts import 了 electron ⇒ node:test 加载不了它，
//    于是「信封组装 + 摘要清洗」这两件最该有测试的事会变成零覆盖（同 library-ipc.ts 的理由）。
import type { Envelope } from '../shared/ipc.ts';

/** `appHealth` 的载荷（SPEC §6 · 第 22 个方法） */
export type AppHealthData = {
  /** 本次**进程内**是否出现过未处理异常（uncaughtException / unhandledRejection） */
  unhealthy: boolean;
  /** 次数（含未捕获异常；进程内累计） */
  count: number;
  /** **第一条**原因的摘要（根因优先）；健康时 null */
  reason: string | null;
  /** **第一条**出事的时刻（ISO 8601）；健康时 null */
  firstAt: string | null;
};

/** 摘要上限：够看清是什么事，又不至于把一整段堆栈搬到界面上 */
export const REASON_MAX = 160;

/** 路径被抹掉之后留下的占位（**看得见「这里有路径被省略」**，而不是留一串用户名） */
export const PATH_PLACEHOLDER = '<路径已省略>';

/**
 * 摘要清洗（**这是「不含路径 / 用户名 / 堆栈正文」的唯一落点**）。
 *
 * 三步（顺序有讲究）：
 *   ① 只留**第一行** —— 堆栈正文全在后续行，第一行才是「什么事」；
 *   ② **整段抹掉看起来像路径的连续串**（详见 maskPaths）；
 *   ③ 折叠空白 + 截断到 REASON_MAX。
 *
 * ⚠️ 这里最容易做成「声称脱敏」而实际漏：只抹分隔符**不够** ——
 *    `D:/Users/zhangsan-9f2c/AppData/...` 抹完就变成 `D: Users zhangsan-9f2c AppData ...`，
 *    **用户名还在**（AH3d 就是钉这一条的「能红」断言：注入含用户名/绝对路径的原因，
 *    断言输出里不含它，并且用未清洗的原串做自检证明这条断言不是恒真）。
 */
export function summarizeReason(text: string | null): string | null {
  if (typeof text !== 'string') return null;
  const lines = text.split(/\r?\n/);
  const firstLine = (lines.length > 0 ? lines[0] : '').trim();
  if (!firstLine) return null;
  const cleaned = maskPaths(firstLine).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= REASON_MAX) return cleaned;
  return cleaned.slice(0, REASON_MAX - 1) + '…';
}

/**
 * 把**看起来像文件系统路径的连续串**整段换成 `PATH_PLACEHOLDER`。
 *
 * 判据（宁多勿漏）：一段以盘符（`D:`）、UNC（`\\server\`）或根斜杠（`/`）开头，
 * 且**后续没有空白**的连续串 —— 统一抹掉。
 * 为什么是「抹整段」而不是「抹分隔符」：分隔符抹掉之后 `Users/某人/AppData` 变成
 * 三个普通单词，**用户名就混在里面了** —— 那是「看起来脱敏了、其实没脱」。
 * ⚠️ 只抹「成段」的：`Error: x/y` 这种不带盘符、根斜杠的短片段不动（否则会把普通文案也吃掉）。
 */
function maskPaths(line: string): string {
  // ⚠️ 必须要求**盘符后面紧跟分隔符**：只写 `[A-Za-z]:` 会把文案里的 `Error:` / `code:` 当成盘符 ——
  //    实测把 'Error: x' 抹成了 'Erro<路径已省略> x'（真实事故，不是理论担忧）。
  //    `C:\` 里 `\` 之后不跟反斜杠 ⇒ 不会把 UNC 的第二个反斜杠当成段首，两条规则不打架。
  const masked = line
    // ⚠️ 必须先整段吃掉 URL（`https://…` 的字母+冒号与盘符同形 —— 不先吃会把 `https` 抹成 `http<…>`）
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]*/gi, PATH_PLACEHOLDER)
    .replace(/[A-Za-z]:\\[^\s]*/g, PATH_PLACEHOLDER)
    .replace(/[A-Za-z]:\/[^\s]*/g, PATH_PLACEHOLDER)
    .replace(/\\\\[^\s]*/g, PATH_PLACEHOLDER);
  // 根斜杠开头的绝对路径：连同它前面的分隔符一起匹配，但**保留**那个分隔符
  return masked.replace(/(^|[\s(（])\/[^\s]*/g, (whole, before) => before + PATH_PLACEHOLDER);
}

/**
 * 组装 `appHealth` 的信封。**恒成功**（`ok` 恒 true）—— 「查不到事实」本身就是一条事实。
 * @param state `crash-policy.ts` 的进程内快照（唯一数据来源）
 */
export function queryAppHealth(state: {
  unhealthy: boolean;
  reason: string | null;
  count: number;
  firstAt: string | null;
}): Envelope {
  const unhealthy = state.unhealthy === true;
  const count =
    typeof state.count === 'number' && Number.isFinite(state.count) && state.count > 0
      ? Math.floor(state.count)
      : 0;
  const data: AppHealthData = {
    unhealthy,
    count,
    // 健康时**必须**是 null，而不是空串：空串会被界面画成「有原因但内容为空」
    reason: unhealthy ? summarizeReason(state.reason) : null,
    firstAt: unhealthy && typeof state.firstAt === 'string' && state.firstAt ? state.firstAt : null,
  };
  return { ok: true, data };
}
