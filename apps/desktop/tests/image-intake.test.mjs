// apps/desktop/tests/image-intake.test.mjs —— UX-1c：拖拽/粘贴入窗的**判定与拒绝理由**（纯函数）
//
// 为什么值得单测：这一段决定"什么东西会被当成查询图"。两类错误都很难在真窗口里发现：
//   · 收下了**没有路径**的剪贴板位图 ⇒ 后续 search 拿到空 path，报一个用户看不懂的错；
//   · 拒绝对了但**理由为空/技术黑话** ⇒ 用户不知道该怎么办（"请把截图存成文件"才是可行动的理由）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyImageFiles, looksLikeImage } from '../src/renderer/src/utils/image-intake.ts';
import { IMAGE_EXT, imageExtOf, isImageFileName } from '../src/shared/image-ext.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main');

test('U1 ⭐ 图片文件（有真实路径）⇒ 收下，name/path 原样返回；扩展名大小写不敏感', () => {
  for (const name of ['a.jpg', 'b.JPEG', 'c.Png', 'd.webp', 'e.bmp']) {
    const r = classifyImageFiles([{ name, type: '', path: 'X:\\tmp\\' + name }]);
    assert.equal(r.ok, true, name + ' 应被收下');
    if (r.ok) {
      assert.equal(r.path, 'X:\\tmp\\' + name, '路径必须原样（渲染层不许加工/猜测路径）');
      assert.equal(r.name, name);
    }
  }
});

test('U2 ⭐⭐ 剪贴板位图（是图片但没有文件路径）⇒ 明确拒绝 + 给可行动的理由', () => {
  const r = classifyImageFiles([{ name: 'image.png', type: 'image/png' }]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 'NO_PATH');
    assert.match(r.reason, /保存成文件/, '必须告诉用户下一步怎么做');
    assert.match(r.reason, /不是文件/, '必须说清"剪贴板位图 ≠ 文件"这件事');
    assert.ok(r.reason.length > 8);
  }
});

test('U3 ⭐⭐ 非图片 ⇒ NOT_IMAGE；理由里既说支持什么、也点名是哪个文件', () => {
  const r = classifyImageFiles([
    { name: 'notes.txt', type: 'text/plain', path: 'X:\\tmp\\notes.txt' },
  ]);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 'NOT_IMAGE');
    assert.match(r.reason, /jpg/, '要列出支持的类型');
    assert.match(r.reason, /notes\.txt/, '要点名被拒的文件（否则用户不知道是哪一个）');
  }
});

test('U4 空列表 / undefined ⇒ EMPTY（不静默"什么都没发生"）', () => {
  for (const input of [undefined, null, []]) {
    const r = classifyImageFiles(input);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.code, 'EMPTY');
      assert.ok(r.reason.length > 0);
    }
  }
});

test('U5 MIME 优先：扩展名缺失但 type=image/png + 有路径 ⇒ 收下（拖拽来源可靠时不必猜扩展名）', () => {
  const r = classifyImageFiles([{ name: 'blob', type: 'image/png', path: 'X:\\tmp\\blob' }]);
  assert.equal(r.ok, true);
  assert.equal(looksLikeImage({ name: 'x.png' }), true);
  assert.equal(looksLikeImage({ name: 'x.png', type: 'text/plain' }), true, '扩展名命中即可');
  assert.equal(looksLikeImage({ name: 'x', type: 'image/webp' }), true, 'MIME 命中即可');
  assert.equal(looksLikeImage({ name: 'x.pdf', type: 'application/pdf' }), false);
});

test('U6 ⭐⭐ 扩展名清单只有一份：main/encoder.ts 的 IMG_EXT 必须来自 shared/image-ext.ts', () => {
  const src = fs.readFileSync(path.join(MAIN, 'encoder.ts'), 'utf8');
  assert.match(
    src,
    /from '\.\.\/shared\/image-ext\.ts'/,
    'encoder.ts 必须 import shared/image-ext.ts（否则出现第二份清单，P1）',
  );
  // 反向：不许再出现一份字面量清单（旧写法就是 new Set(['.jpg', …])）
  assert.doesNotMatch(
    src,
    /new Set\(\s*\[\s*'\.jpg'/,
    'encoder.ts 不许自己再写一份扩展名清单（P1：同一概念第二份实现）',
  );
  assert.deepEqual(
    [...IMAGE_EXT].sort(),
    ['.bmp', '.jpeg', '.jpg', '.png', '.webp'],
    '白名单内容要显式可读（改动它 = 改行为，必须被看见）',
  );
  assert.equal(imageExtOf('A.JPG'), '.jpg');
  assert.equal(imageExtOf('noext'), '');
  assert.equal(imageExtOf('.hidden'), '', '点开头的隐藏文件不当扩展名');
  assert.equal(isImageFileName('a.PNG'), true);
});
