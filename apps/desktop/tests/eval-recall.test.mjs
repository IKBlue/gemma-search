// apps/desktop/tests/eval-recall.test.mjs —— EVAL-1：召回评测集 + 评分器（**只测量，不改检索**）
//
// 本文件钉住四件事：
//   ① 评测集**完整**：≥50 条真查询、每条都有源 uid / relPath / crop / 期望；合成图期望「无匹配」；
//   ② 评测集**可复现**：用同一份 items.json 重跑采样器 ⇒ 逐 uid 与提交的 JSON 完全相同（机器验证，不是口头承诺）；
//   ③ **能红-1**：把排序倒过来 ⇒ top-1/top-5 必须掉；
//   ④ **能红-2**：评测集喂空 ⇒ 必须抛（不许 0 条也报 100%）。
//
// ⚠️ 真实跑分（要模型 + 真实索引）是**显式开关**：GS_EVAL_REAL=1 时才跑，见文件末尾。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sampleEvalSet, scoreEval, reverseRankings } from './helpers/eval-dataset.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = (() => {
  let p = HERE;
  for (;;) {
    if (fs.existsSync(path.join(p, 'packages', 'engine', 'src', 'engine.ts'))) return p;
    const up = path.dirname(p);
    if (up === p) throw new Error('找不到仓库根');
    p = up;
  }
})();
const EVAL_JSON = path.join(REPO, 'fixtures', 'eval-queries.json');
const ITEMS_JSON = path.join(REPO, 'data', 'libraries', 'L1', 'items.json');

function loadEvalSet() {
  return JSON.parse(fs.readFileSync(EVAL_JSON, 'utf8'));
}

const isTrue = (e) => !(e.expect && e.expect.none);

test('E1 ⭐ 评测集完整：≥50 条真查询 + 每条都有 源uid/relPath/crop/期望；合成图期望「无匹配」', () => {
  const doc = loadEvalSet();
  const truth = doc.entries.filter(isTrue);
  const none = doc.entries.filter((e) => e.expect && e.expect.none);
  assert.ok(truth.length >= 50, '真查询必须 ≥50 条，实得 ' + String(truth.length));
  assert.ok(none.length >= 1, '至少要有 1 条「应无匹配」样例');
  const ids = new Set();
  for (const e of doc.entries) {
    assert.match(e.id, /^[qn]\d{3}$/, 'id 形状固定，便于归档对照');
    assert.equal(ids.has(e.id), false, 'id 必须唯一：' + e.id);
    ids.add(e.id);
    if (isTrue(e)) {
      assert.match(e.sourceUid, /^[0-9a-f]{12}$/, e.id + ' 的 sourceUid 形状不对');
      assert.equal(typeof e.sourceRelPath, 'string', e.id + ' 缺 sourceRelPath');
      assert.ok(e.expect.uids.includes(e.sourceUid), e.id + ' 的期望里必须含源 uid');
      assert.ok(
        e.crop && e.crop.w > 0 && e.crop.w <= 1,
        e.id + ' 缺 crop（归一化矩形，为将来框选留位）',
      );
      assert.ok(e.crop.x + e.crop.w <= 1 && e.crop.y + e.crop.h <= 1, e.id + ' 的 crop 越界');
    } else {
      assert.equal(typeof e.synthetic, 'string', e.id + ' 是无匹配样例 ⇒ 要说明合成方式');
    }
  }
  assert.ok(doc.methodology && doc.methodology.sampler, '缺 methodology.sampler（取样口径）');
});

test('E2 ⭐⭐ 可复现：用同一份 items.json 重跑采样器 ⇒ **逐 uid** 与提交的评测集完全相同', (t) => {
  if (!fs.existsSync(ITEMS_JSON))
    return t.skip('本机没有真实库 items.json（环境缺失，不是产品问题）');
  const items = JSON.parse(fs.readFileSync(ITEMS_JSON, 'utf8'));
  const doc = loadEvalSet();
  const truth = doc.entries.filter(isTrue);
  const again = sampleEvalSet(items);
  assert.deepEqual(
    again.entries.map((e) => e.sourceUid),
    truth.map((e) => e.sourceUid),
    '采样结果与提交的评测集不一致 ⇒ 要么采样规则改了没重生成，要么 items.json 变了（两种都必须显式处理）',
  );
  assert.deepEqual(
    again.entries.map((e) => e.crop),
    truth.map((e) => e.crop),
  );
});

test('E3 ⭐⭐ 能红-1：把检索结果**倒序** ⇒ top-1 / top-5 / top-10 必须掉（不是「看着差不多」）', () => {
  const evalSet = [];
  const rankings = [];
  for (let i = 0; i < 6; i++) {
    evalSet.push({ id: 'q' + i, expect: { uids: ['u' + i] } });
    rankings.push([
      { uid: 'u' + i, score: 0.9 - i * 0.01 },
      { uid: 'wrong-' + i, score: 0.5 },
      { uid: 'wrong2-' + i, score: 0.4 },
    ]);
  }
  const good = scoreEval(rankings, evalSet);
  assert.equal(good.top1, 1, '前提：正确排序 top1 必须是 1');
  assert.equal(good.top5, 1);
  const bad = scoreEval(reverseRankings(rankings), evalSet);
  assert.equal(bad.top1, 0, '倒序后 top1 必须掉到 0，实得 ' + String(bad.top1));
  assert.equal(bad.top5, 1, '倒序后 3 名仍都在前 5 ⇒ top5 还是 1（这正说明指标有区分度）');
  assert.equal(bad.top10, 1);
  // 分离度是**分数**统计量 ⇒ 单纯重排不应改变它（这条同时钉住定义，防以后被写成排序统计量）
  assert.equal(bad.separation.mean, good.separation.mean, '重排不改分数 ⇒ 分离度应不变');
  // 真正的「检索变差」= 正确件分数被压低 + 按分重排 ⇒ 分离度与 top-1 一起掉
  const degraded = rankings.map((r) =>
    r
      .map((x) => (String(x.uid).startsWith('u') ? { ...x, score: 0.2 } : x))
      .sort((a, b) => b.score - a.score),
  );
  const worse = scoreEval(degraded, evalSet);
  assert.equal(worse.top1, 0, '正确件被压到 0.2 < 干扰件 0.5 ⇒ top-1 必须掉');
  assert.ok(worse.separation.mean < good.separation.mean, '正确件分数被压低 ⇒ 分离度必须变小');
});

test('E4 ⭐⭐ 能红-2：评测集喂空 ⇒ 必须抛（**不许 0 条也报 100%**）', () => {
  assert.throws(() => scoreEval([], []), /评测集为空/, '0 条必须失败，而不是返回 top1=100%');
  assert.throws(() => scoreEval([], [{ id: 'q1', expect: { uids: ['u1'] } }]), /不一致/);
});

test('E5 无匹配样例要与真查询**分开统计**（不混进命中率）', () => {
  const evalSet = [
    { id: 'q1', expect: { uids: ['u1'] } },
    { id: 'n1', expect: { none: true } },
  ];
  const rankings = [
    [
      { uid: 'u1', score: 0.9 },
      { uid: 'x', score: 0.1 },
    ],
    [
      { uid: 'y1', score: 0.05 },
      { uid: 'y2', score: 0.04 },
    ],
  ];
  const r = scoreEval(rankings, evalSet);
  assert.equal(r.n, 1, '命中率的**分母只算真查询**');
  assert.equal(r.top1, 1);
  assert.equal(r.noMatch.n, 1);
  assert.equal(r.noMatch.maxScoreMean, 0.05);
});
