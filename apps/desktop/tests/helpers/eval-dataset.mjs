// apps/desktop/tests/helpers/eval-dataset.mjs —— EVAL-1：召回评测集的**采样 / 评分 / 校验**（唯一实现）
//
// 为什么采样规则要写死在代码里（而不是手挑 50 条）：
//   手挑的集合**不可复现**，也无法回答「为什么偏偏是这 50 张」。这里用「按 uid 排序 + 固定步长 + 按文件夹配额」
//   ⇒ 同一份 items.json 跑一万次都得到同一批 uid（test 里有**逐 uid 相等**的断言钉住）。
//
// 查询图 = 源图的**中心裁剪**（默认 60%）⇒ 不是「原图查原图」那种自证；crop 是归一化矩形，
//   将来做框选时只要把这个矩形换成用户框即可，schema 不用改。
//
// ⚠️ 本模块**只测量**：不含检索逻辑、不改索引。

/** 图片扩展名白名单（与 engines/fingerprint 的 IMG_EXT 同义；这里只需要能解码的常见格式） */
export const EVAL_IMG_EXT = Object.freeze(['.jpg', '.jpeg', '.png']);

/** 采样配额（合计 50 条真查询；文件夹分布按真实库 2809/630/78/77 的比例取整 + 小类保底） */
export const DEFAULT_QUOTA = Object.freeze({ VR: 28, CR: 15, 'CR+VR': 5, 其他: 2 });

/** 默认裁剪：中心 60% × 60%（归一化；给将来的框选留位） */
export const DEFAULT_CROP = Object.freeze({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 });

/** 「应无匹配」样例：确定性合成图（同参数永远同一张 ⇒ 可复现） */
export const NO_MATCH_KINDS = Object.freeze([
  'solid-gray',
  'solid-red',
  'checker',
  'gradient',
  'noise',
]);

function isImageExt(ext) {
  return EVAL_IMG_EXT.includes(String(ext || '').toLowerCase());
}

function stridePick(list, want) {
  if (want <= 0 || list.length === 0) return [];
  const stride = Math.max(1, Math.floor(list.length / want));
  const off = stride >> 1;
  const out = [];
  for (let i = 0; i < want && i * stride + off < list.length; i++) out.push(list[i * stride + off]);
  return out;
}

/**
 * 确定性采样：按 (folder, uid) 排序 + 固定步长 + 文件夹配额。
 * @returns {{ entries: Array, skipped: Array }} entries = 真查询（含 source uid / relPath / crop）
 */
export function sampleEvalSet(items, { quota = DEFAULT_QUOTA, crop = DEFAULT_CROP } = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('sampleEvalSet: items 为空');
  const byFolder = new Map();
  const skipped = [];
  for (const it of items) {
    const uid = String(it.uid || '');
    if (!uid) {
      skipped.push({ why: 'no-uid', relPath: it.relPath ?? null });
      continue;
    }
    if (!isImageExt(it.imageExt)) {
      skipped.push({ why: 'ext', uid });
      continue;
    }
    if (!it.relPath) {
      skipped.push({ why: 'no-relPath', uid });
      continue;
    }
    const f = String(it.folder ?? '其他');
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f).push(it);
  }
  const entries = [];
  let seq = 0;
  for (const folder of Object.keys(quota)) {
    const list = (byFolder.get(folder) || [])
      .slice()
      .sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
    for (const it of stridePick(list, quota[folder])) {
      seq += 1;
      entries.push({
        id: 'q' + String(seq).padStart(3, '0'),
        kind: 'image',
        folder,
        sourceUid: String(it.uid),
        sourceRelPath: String(it.relPath),
        crop: { ...crop },
        expect: { uids: [String(it.uid)] },
      });
    }
  }
  return { entries, skipped };
}

/** 「应无匹配」样例（合成图；expect.none = true） */
export function makeNoMatchEntries(kinds = NO_MATCH_KINDS, startSeq = 0) {
  return kinds.map((k, i) => ({
    id: 'n' + String(startSeq + i + 1).padStart(3, '0'),
    kind: 'synthetic',
    synthetic: k,
    crop: null,
    expect: { none: true },
  }));
}

/**
 * 评分（**纯函数**，便于用合成数据做能红）。
 * @param rankings 每条查询的排序结果：Array<Array<{uid:string, score:number}>>（降序）
 * @param evalSet  与 rankings 一一对应的评测条目
 */
export function scoreEval(rankings, evalSet) {
  if (!Array.isArray(evalSet) || evalSet.length === 0) {
    throw new Error('scoreEval: 评测集为空 —— 0 条也报 100% 是假绿（EVAL-1 能红要求）');
  }
  if (!Array.isArray(rankings) || rankings.length !== evalSet.length) {
    throw new Error(
      'scoreEval: rankings 与 evalSet 条数不一致（' +
        String(rankings?.length) +
        ' vs ' +
        String(evalSet.length) +
        '）',
    );
  }
  let top1 = 0,
    top5 = 0,
    top10 = 0,
    n = 0,
    noneN = 0;
  const margins = [];
  const noneMax = [];
  for (let i = 0; i < evalSet.length; i++) {
    const e = evalSet[i];
    const rank = rankings[i] || [];
    if (e.expect && e.expect.none) {
      noneN += 1;
      noneMax.push(rank.length ? rank[0].score : 0);
      continue;
    }
    const want = new Set(e.expect.uids || []);
    const hitAt = (k) => rank.slice(0, k).some((r) => want.has(String(r.uid)));
    n += 1;
    if (hitAt(1)) top1 += 1;
    if (hitAt(5)) top5 += 1;
    if (hitAt(10)) top10 += 1;
    // 分离度：正确件的最高分 − 非正确件的最高分（越大越容易区分；负数=有干扰件压过它）
    const bestCorrect = rank
      .filter((r) => want.has(String(r.uid)))
      .reduce((m, r) => Math.max(m, r.score), -Infinity);
    const bestOther = rank
      .filter((r) => !want.has(String(r.uid)))
      .reduce((m, r) => Math.max(m, r.score), -Infinity);
    if (Number.isFinite(bestCorrect) && Number.isFinite(bestOther))
      margins.push(bestCorrect - bestOther);
  }
  const ratio = (x, d) => (d === 0 ? null : Number((x / d).toFixed(4)));
  const sorted = margins.slice().sort((a, b) => a - b);
  return {
    n,
    top1: ratio(top1, n),
    top5: ratio(top5, n),
    top10: ratio(top10, n),
    separation: {
      mean: margins.length
        ? Number((margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(6))
        : null,
      median: sorted.length ? Number(sorted[Math.floor(sorted.length / 2)].toFixed(6)) : null,
      min: sorted.length ? Number(sorted[0].toFixed(6)) : null,
      negatives: margins.filter((m) => m < 0).length,
    },
    noMatch: {
      n: noneN,
      maxScoreMean: noneMax.length
        ? Number((noneMax.reduce((a, b) => a + b, 0) / noneMax.length).toFixed(6))
        : null,
    },
  };
}

/** 能红用：把每条查询的排序倒过来（分数不动） */
export function reverseRankings(rankings) {
  return rankings.map((r) => r.slice().reverse());
}
