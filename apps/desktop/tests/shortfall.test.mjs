// apps/desktop/tests/shortfall.test.mjs —— NOMATCH-1（U38 口径 A）：弱匹配提示的判定
//
// 口径（所有者 2026-10-19 裁定）：**不硬判 `no_close_match`**；只按**引擎给的 band** 判断
// "最相关的一条也很弱" ⇒ 显示"仅供参考"并只保留最近 N 条。
// 本文件钉住：① 只用 band（不看分数、不自算阈值）；② 边界（空/高/中/低）；③ N 有上限且不撒谎。
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideShortfall, SHORTFALL_LIMIT } from '../src/renderer/src/utils/shortfall.ts';

test('S1 空/未检索 ⇒ 不提示（null 与 [] 都不许误报）', () => {
  for (const input of [null, undefined, []]) {
    const r = decideShortfall(input);
    assert.equal(r.show, false);
    assert.equal(r.limit, 0);
    assert.equal(r.note, '');
  }
});

test('S2 ⭐ 只有 band=low 才提示：high / mid 都按正常结果处理', () => {
  assert.equal(decideShortfall([{ band: 'high' }]).show, false);
  assert.equal(decideShortfall([{ band: 'mid' }]).show, false);
  const low = decideShortfall([{ band: 'low' }]);
  assert.equal(low.show, true);
  assert.match(low.note, /仅供参考/);
  assert.match(low.note, /1 条/, '只有 1 条结果时说 1 条（不许写 10）');
});

test('S3 ⭐⭐ 判定只看 band：行里没有 score 也照样工作（界面不自算阈值）', () => {
  // 如果实现偷偷拿 score 算阈值，这条会拿到 undefined 而炸/误判
  const r = decideShortfall([{ band: 'low' }, { band: 'low' }]);
  assert.equal(r.show, true);
  assert.equal(r.limit, 2);
});

test('S4 ⭐ 条数上限：结果很多 ⇒ 只保留最近 N 条；少 ⇒ 按实际条数（不虚报）', () => {
  const many = Array.from({ length: 60 }, () => ({ band: 'low' }));
  const r = decideShortfall(many);
  assert.equal(r.show, true);
  assert.equal(r.limit, SHORTFALL_LIMIT);
  assert.match(r.note, new RegExp(String(SHORTFALL_LIMIT) + ' 条'));
  // 自定义上限
  assert.equal(decideShortfall(many, 3).limit, 3);
  assert.equal(
    decideShortfall(many, 0).limit,
    SHORTFALL_LIMIT,
    '非法上限回落默认值，不许变成 0 条',
  );
});

test('S5 第一条不是 low（即使后面有 low）⇒ 不进入 shortfall（"最相关的"不弱）', () => {
  const r = decideShortfall([{ band: 'mid' }, { band: 'low' }, { band: 'low' }]);
  assert.equal(r.show, false);
  assert.equal(r.limit, 0);
});
