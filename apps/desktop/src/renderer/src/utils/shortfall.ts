// apps/desktop/src/renderer/src/utils/shortfall.ts —— 「库里没有很接近的」短名单判定（NOMATCH-1 · U38 口径 A）
//
// 口径来自所有者 2026-10-19 的裁定（见 TASKS U38）：**不硬判 `no_close_match`**。
// 基线数据证明两种"硬判"都不干净：
//   · 绝对分数阈值：正确件最低 0.878 < 错件最高 0.967 ⇒ 空档 −0.089（EVAL-1 基线）；
//   · 单纯间隔：正确查询的 top1−top2 最小 0.001（12/50 <0.02），与合成无匹配的间隔 0.005–0.061 **重叠**。
// ⇒ 只做「**弱匹配提示 + shortfall 列表**」：档位继续由**引擎**给（界面不得自算阈值，
//   SPEC §3 F1），当第一条的 band 是 `low` 时提示"仅供参考"，并只保留最近 N 条。
//
// 为什么抽成纯函数：判定与文案是业务规则，写进 .tsx 就只能在真窗口里验；这里可直接 node:test。
export type ShortfallRow = { band?: string };

export interface ShortfallDecision {
  /** 是否进入 shortfall 形态（= 最相关的一条也只是 `low`） */
  show: boolean;
  /** 展示条数上限（show=false 时为 0，调用方据此决定是否截断） */
  limit: number;
  /** 可显示的提示（show=false 时为空串） */
  note: string;
}

/** shortfall 时最多展示多少条（"最近 N 条仅供参考"里的 N） */
export const SHORTFALL_LIMIT = 10;

/**
 * 判定是否进入 shortfall。
 * ⚠️ 只看**引擎给的 band**，不看分数、不自己算阈值（SPEC §3 F1：界面不得自算档位）。
 */
export function decideShortfall(
  results: ReadonlyArray<ShortfallRow> | null | undefined,
  limit: number = SHORTFALL_LIMIT,
): ShortfallDecision {
  if (!Array.isArray(results) || results.length === 0) return { show: false, limit: 0, note: '' };
  const topBand = results[0]?.band;
  if (topBand !== 'low') return { show: false, limit: 0, note: '' };
  const n = Math.max(1, Math.min(Math.trunc(limit) || SHORTFALL_LIMIT, results.length));
  return {
    show: true,
    limit: n,
    note: `库里没有很接近的结果，以下最近 ${n} 条仅供参考`,
  };
}
