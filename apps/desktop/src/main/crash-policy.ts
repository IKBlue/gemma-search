// apps/desktop/src/main/crash-policy.ts —— 未捕获异常 / 未处理 rejection 的策略（DF-6）
//
// 缺陷（review-dev.html §01）：index.ts 原先两行都只 log ⇒
//   `uncaughtException` 之后进程可能停在**半初始化/半写状态**（引擎没装配完、库打开一半），
//   继续跑会把这半截状态当成正常 —— 与本项目「最怕静默」的哲学直接冲突。
//
// Lead 裁决（2026-10-15，口径唯一落点就是本文件，别再散写）：
//   ① `uncaughtException` ⇒ **先把原因与"即将退出"落盘（log 同步写盘）→ 再 exit(1)**；
//   ② `unhandledRejection` ⇒ **记日志 + 标记全局不健康**（诊断可读），**不退出**
//      —— 良性 rejection 不该杀掉应用；
//   ③ 不健康标记**可被测试观测**：本模块导出进程内只读态（isUnhealthy / unhealthyReason /
//      unhealthyCount / crashUnhealthyState），并每次落一行日志。
//      **为什么不用 app_meta**：app_meta 是**迁移账本**，唯一写入口是迁移（DESIGN §2.3）；
//      运行期往里写会同时破坏"唯一写入口"和"账本只属于迁移"两条口径。而且"不健康"是
//      **进程生命周期内**的事实 —— 进程没了它也没意义，落库只会留下一个下次启动必然过期的标记。
//
// ⚠️ `exit` 与 `target` 都是注入点：**测试不许真的杀进程**，所以退出钩子可替换
//    （单测传入记录式钩子；生产传 `app.exit`）。
//
// 关于 "flush"：`log.ts` 的 log() 是**同步** appendFileSync（没有缓冲写入器），
//   所以每行 log 调用返回时已经落盘。deps.flush 仍保留为**显式的顺序点**：
//   将来若换成异步日志，就在这里接 drain；在此之前测试用它证明 log → flush → exit 的次序。

/** uncaughtException 的退出码（非 0：异常退出必须能被外部脚本区分出来） */
export const CRASH_EXIT_CODE = 1;

/** 只注入本模块用到的两个事件，避免把整个 process 类型拖进来（也让单测能塞假对象） */
export type CrashEvent = 'uncaughtException' | 'unhandledRejection';

export interface ProcessLike {
  on(event: CrashEvent, listener: (e: unknown) => void): unknown;
  removeListener(event: CrashEvent, listener: (e: unknown) => void): unknown;
}

export interface CrashPolicyDeps {
  /** 生产传 log.ts 的 log（同步写盘） */
  log: (...args: unknown[]) => void;
  /** 退出钩子（生产传 (code) => app.exit(code)；测试传记录器） */
  exit: (code: number) => void;
  /** 已打包？（写进退出日志，便于分辨"用户机器"与开发机） */
  isPackaged: boolean;
  /** 可选的落盘 drain（生产不需要，理由见文件头）；在 exit **之前**调用 */
  flush?: () => void;
  /** process 本体（默认真 process；单测可注入假对象） */
  target?: ProcessLike;
}

/** 进程内只读态（诊断可读） */
export interface CrashUnhealthyState {
  unhealthy: boolean;
  /** **第一条**原因（根因优先；后续原因只计数） */
  reason: string | null;
  count: number;
}

export interface CrashPolicy {
  onUncaughtException(e: unknown): void;
  onUnhandledRejection(e: unknown): void;
  isUnhealthy(): boolean;
  unhealthyReason(): string | null;
  unhealthyCount(): number;
  /** 注册到 target（幂等：重复调用只注册一次） */
  install(): void;
  /** 摘掉监听器（幂等；单测收尾必须调，别把处理器漏进测试进程） */
  dispose(): void;
}

/** unknown → 可读一行（永不抛；Error 优先给 stack） */
export function reasonText(e: unknown): string {
  if (e instanceof Error) {
    const stack = typeof e.stack === 'string' ? e.stack : '';
    return stack.length > 0 ? stack : e.name + ': ' + e.message;
  }
  if (typeof e === 'string') return e;
  try {
    const json = JSON.stringify(e);
    return json === undefined ? String(e) : json;
  } catch {
    return String(e);
  }
}

export function createCrashPolicy(deps: CrashPolicyDeps): CrashPolicy {
  const target: ProcessLike = deps.target ?? process;
  let installed = false;
  /** 状态挂在实例上（单测可拿到互不干扰的实例）；模块槽只保存"已安装的那个" */
  const state: CrashUnhealthyState = { unhealthy: false, reason: null, count: 0 };

  function mark(reason: string): void {
    state.unhealthy = true;
    state.count += 1;
    // 第一条原因优先：后面的多半是同一根因的余波，覆盖它反而丢掉根因
    if (state.reason === null) state.reason = reason;
  }

  function onUncaughtException(e: unknown): void {
    const why = reasonText(e);
    mark('uncaughtException: ' + why);
    // ⚠️ 顺序是契约：先落盘，再退出。log() 同步 ⇒ 这几行返回即已写入 data/_app.log。
    deps.log('!! 未捕获异常：进程处于半初始化/半写状态，继续运行会把异常当成正常 ⇒ 即将退出');
    deps.log('!! 未捕获异常原因：', why);
    deps.log('!! 即将 exit code=' + String(CRASH_EXIT_CODE), '· 打包态 =', deps.isPackaged, '· 不健康次数 =', state.count);
    if (deps.flush !== undefined) deps.flush();
    deps.exit(CRASH_EXIT_CODE);
  }

  function onUnhandledRejection(e: unknown): void {
    const why = reasonText(e);
    mark('unhandledRejection: ' + why);
    // 不退出：良性 rejection（例如一次已失败的 IPC 回包）不该杀掉整个应用。
    // 但必须**可见** —— 落一行日志 + 全局标记；诊断面据此提示"本次运行出过未处理 rejection"。
    deps.log('!! 未处理的 rejection（不退出；已标记全局不健康，诊断可见）：', why);
  }

  return {
    onUncaughtException,
    onUnhandledRejection,
    isUnhealthy: (): boolean => state.unhealthy,
    unhealthyReason: (): string | null => state.reason,
    unhealthyCount: (): number => state.count,
    install(): void {
      if (installed) return;
      installed = true;
      target.on('uncaughtException', onUncaughtException);
      target.on('unhandledRejection', onUnhandledRejection);
    },
    dispose(): void {
      if (!installed) return;
      installed = false;
      target.removeListener('uncaughtException', onUncaughtException);
      target.removeListener('unhandledRejection', onUnhandledRejection);
    },
  };
}

// ---------------------------------------------------------------- 已安装策略（生产入口 + 诊断读口）

let installedPolicy: CrashPolicy | null = null;

/** 创建并注册到 process（生产入口）。重复调用会**替换**上一个（旧监听器先摘掉） */
export function installCrashPolicy(deps: CrashPolicyDeps): CrashPolicy {
  if (installedPolicy !== null) installedPolicy.dispose();
  installedPolicy = createCrashPolicy(deps);
  installedPolicy.install();
  return installedPolicy;
}

/** 诊断读口：当前进程的不健康态（没有安装过 ⇒ 全 false/0，不编一个"健康"的假象） */
export function crashUnhealthyState(): CrashUnhealthyState {
  if (installedPolicy === null) return { unhealthy: false, reason: null, count: 0 };
  return {
    unhealthy: installedPolicy.isUnhealthy(),
    reason: installedPolicy.unhealthyReason(),
    count: installedPolicy.unhealthyCount(),
  };
}

// ---------------------------------------------------------------- 生产态 DevTools（同一条策略边界）

/**
 * 生产态**不自动打开** DevTools —— 本函数是这条口径的唯一落点，返回值**恒 false**。
 *
 * 为什么"不自动开"而不是"关掉 DevTools"：
 *   · SPEC-security §9 决定 3 保留了 `devTools: true` + **F12 手动开关**（本机自用工具，
 *     排障收益 > 风险）⇒ 关掉能力会把排障路也关掉；
 *   · 但**自动打开**不一样：它把开发者界面直接推给最终用户，并拖慢启动。
 *   ⇒ 结论：能力保留、**自动打开禁止**。
 *
 * 任何"打包态自动开 DevTools"的实现都必须先改这里，并同步删掉
 * crash-policy.test.mjs 的源码扫描断言（那道断言会当场变红）。
 */
export function shouldAutoOpenDevTools(): boolean {
  return false;
}
