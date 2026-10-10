// core/compat.mjs —— 兼容性判定键（SPEC-identity §6.3 / CONTRACT-engine-v1.md §6）
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

/** 由索引 header 算出 compat 串。缺字段会写成 "undefined" —— 调用方应先校验完整性。 */
export function compatKey(header) {
  return COMPAT_FIELDS.map((f) => (header == null ? undefined : header[f])).join('|');
}

/** header 里的 compat 字段是否齐全（缺任一即不可用于比对）。 */
export function compatComplete(header) {
  return header != null && COMPAT_FIELDS.every((f) => header[f] !== undefined && header[f] !== null && header[f] !== '');
}

/**
 * 逐字段找差异（契约 §6 要求界面能显示"哪一项不符 + 期望值 + 实际值"）。
 * @returns {Array<{field:string, expected:any, actual:any}>}
 */
export function compatMismatches(expectedHeader, actualHeader) {
  const out = [];
  for (const f of COMPAT_FIELDS) {
    const e = expectedHeader == null ? undefined : expectedHeader[f];
    const a = actualHeader == null ? undefined : actualHeader[f];
    if (e !== a) out.push({ field: f, expected: e === undefined ? null : e, actual: a === undefined ? null : a });
  }
  return out;
}

export function compatEqual(a, b) {
  return compatComplete(a) && compatComplete(b) && compatMismatches(a, b).length === 0;
}

/**
 * 契约 §6 的结构化原因。**界面必须能显示"哪一项不符"**，不许只说"不兼容"。
 * @param {object} expected 当前库（基准）的 header
 * @param {object} actual   被判不兼容的库的 header
 * @param {string} [userLabel] 可选：给用户看的库名（不含路径）
 */
export function compatReason(expected, actual, userLabel) {
  const mismatches = compatMismatches(expected, actual);
  const human = mismatches
    .map((m) => `${m.field}（期望 ${m.expected}，实际 ${m.actual}）`)
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
