// core/compat.ts —— 兼容性判定键（SPEC.md §1.4 向量与索引 / §5 契约）
//
// 铁律：**device / ort_provider / gpu_model / gpu_driver 不参与 compat**。
// 否则 CPU 回退生成的索引会拒绝自己，或者换个显卡就"不兼容"。

/**
 * compat 的 8 个成员，**顺序即含义**（拼成字符串后要能逐段比）。
 * 改动这个数组 = 破坏性变更（`compat_key_version` 必须同时升）。
 */
export const COMPAT_FIELDS = Object.freeze([
  'model_repo',
  'model_revision',
  'model_weights_dtype',
  'preprocessing_version',
  'seq_length',
  'dim',
  'normalization',
  'pooling',
]);

/**
 * 索引 header。它是**外部 JSON**：引擎不假设字段的值类型（原样取出、原样比），
 * 所以值是 unknown —— 要比的是"是否相等"，不是"是不是某个类型"。
 */
export type CompatHeader = Record<string, unknown> | null | undefined;

/** 一项不符：哪一项 + 期望值 + 实际值（契约 §6 要求界面能显示这三件事）。 */
export interface CompatMismatch {
  field: string;
  expected: unknown;
  actual: unknown;
}

/** 由索引 header 算出 compat 串。缺字段会写成 "undefined" —— 调用方应先校验完整性。 */
export function compatKey(header: CompatHeader): string {
  return COMPAT_FIELDS.map((f) => (header == null ? undefined : header[f])).join('|');
}

/** header 里的 compat 字段是否齐全（缺任一即不可用于比对）。 */
export function compatComplete(header: CompatHeader): boolean {
  return (
    header != null &&
    COMPAT_FIELDS.every((f) => header[f] !== undefined && header[f] !== null && header[f] !== '')
  );
}

/**
 * 逐字段找差异（契约 §6 要求界面能显示"哪一项不符 + 期望值 + 实际值"）。
 */
export function compatMismatches(
  expectedHeader: CompatHeader,
  actualHeader: CompatHeader,
): CompatMismatch[] {
  const out: CompatMismatch[] = [];
  for (const f of COMPAT_FIELDS) {
    const e = expectedHeader == null ? undefined : expectedHeader[f];
    const a = actualHeader == null ? undefined : actualHeader[f];
    if (e !== a)
      out.push({
        field: f,
        expected: e === undefined ? null : e,
        actual: a === undefined ? null : a,
      });
  }
  return out;
}

export function compatEqual(a: CompatHeader, b: CompatHeader): boolean {
  return compatComplete(a) && compatComplete(b) && compatMismatches(a, b).length === 0;
}

/** compatReason() 的结构化结果（契约 §6 的原因对象）。 */
export interface CompatReason {
  kind: 'compat-mismatch';
  mismatches: CompatMismatch[];
  expectedCompat: string | null;
  actualCompat: string | null;
  userMessage: string;
}

/**
 * 契约 §6 的结构化原因。**界面必须能显示"哪一项不符"**，不许只说"不兼容"。
 * @param expected 当前库（基准）的 header
 * @param actual   被判不兼容的库的 header
 * @param userLabel 可选：给用户看的库名（不含路径）
 */
export function compatReason(
  expected: CompatHeader,
  actual: CompatHeader,
  userLabel?: string,
): CompatReason {
  const mismatches = compatMismatches(expected, actual);
  const human = mismatches
    .map((m) => `${m.field}（期望 ${String(m.expected)}，实际 ${String(m.actual)}）`)
    .join('、');
  return {
    kind: 'compat-mismatch',
    mismatches,
    expectedCompat: compatComplete(expected) ? compatKey(expected) : null,
    actualCompat: compatComplete(actual) ? compatKey(actual) : null,
    userMessage: mismatches.length
      ? `${userLabel ? userLabel + ' 的索引' : '这个库的索引'}档位不同：${human}，无法与当前库一起检索。`
      : '这个库的索引元数据不完整，无法确认兼容性。',
  };
}
