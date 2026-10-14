// apps/desktop/src/main/single-flight.ts —— 「进行中的那一次」只允许一次（T-41）
//
// 为什么需要它：ensureEncoder() 原先只挡「已经有 encoder」，**不挡「正在加载」**。
// 于是并发调用（启动预热 + 用户检索）会各自走完整个载入流程 —— 实测（data/_t41/run-concurrent.mjs）：
// 并发 3 次检索 ⇒ 日志里出现 **3 行「载入完成」**（5.0s / 5.6s / 6.4s），每次加载约 1.7 GB 的模型
// ⇒ 内存峰值翻倍 + 首次检索变慢。这不是观感问题，是真的多吃了资源。
//
// 语义（刻意收窄，只做一件事）：
//   · 进行中 ⇒ 复用同一个 Promise（并发 N 次只调用 factory 一次）；
//   · settle 之后清空 ⇒ 下一次调用会**重新**调用 factory。
//     要不要「失败后不重试」由调用方决定（ensureEncoder 用自己的 encoderError 维持既有语义），
//     本模块不替它决定 —— 那样会变成第二份缓存策略（P1）。
//   · 失败不吞：同一个 Promise 的拒绝原样交给所有并发调用方；内部挂的 then 会把它标记为已处理，
//     所以**不会**产生 unhandledRejection。
export interface SingleFlight<T> {
  run(factory: () => Promise<T>): Promise<T>;
  /** 现在有没有进行中的那一次（日志 / 测试用） */
  inFlight(): boolean;
}

export function createSingleFlight<T>(): SingleFlight<T> {
  let current: Promise<T> | null = null;
  return {
    inFlight: () => current !== null,
    run(factory: () => Promise<T>): Promise<T> {
      if (current) return current;
      const p = factory();
      current = p;
      // 用 then(两个回调) 而不是 finally：顺手把「这个拒绝已经有人处理」也做掉，
      // 否则调用方只挂自己的 catch 时，这里会留下一次 unhandledRejection。
      p.then(
        () => { if (current === p) current = null; },
        () => { if (current === p) current = null; },
      );
      return p;
    },
  };
}
