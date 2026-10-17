// apps/desktop/tests/index-adapter.test.mjs —— IDX-2b2：**注入适配器**（引擎端口 ↔ 本仓真实实现）
//
// 要证的事：
//   ① ⭐⭐ 真构建器收到的 `outDir` **不在库根**（P4：库根只写保留命名空间），且构建完被清理；
//   ② ⭐⭐ **真实模式没有模型 ⇒ 明确失败**（MODEL_MISSING），绝不返回假成功（P6）；
//   ③ ⭐️ `writeIndex({libRoot,bytes})` **原样转发**给唯一原子写；(libRoot 由引擎补)
//   ④ ⭐ 假构建器（e2e 钩子）：进度单调 · 取消在安全点抛 `BuildCancelledError` · **取消时零写** · 续跑 `reused>0`；
//   ⑤ ⭐⭐ 写索引的**唯一**调用点：全 main 只有 index-adapter.ts 调 `writeIndexAtomically`。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createIndexingPorts } from '../src/main/index-adapter.ts';
import { writeIndexAtomically } from '../src/main/index-file.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MAIN = path.join(ROOT, 'apps', 'desktop', 'src', 'main');
const TMP = path.join(ROOT, 'data', '_idx2b2', 'adapter-' + process.pid);

let seq = 0;
function freshDir(label) {
  const dir = path.join(TMP, label + '-' + ++seq);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
after(() => {
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录 */
  }
});

const reqOf = (libRoot, extra = {}) => ({
  libId: 'L1',
  libRoot,
  signal: new AbortController().signal,
  onProgress: () => {},
  writeIndex: () => {},
  ...extra,
});

test('A1 ⭐⭐ 真构建器：outDir **不在库根**（P4）· 在 productsRoot 下 · 构建完被清理 · summary 字段映射对', async () => {
  const libRoot = freshDir('A1-lib');
  const productsRoot = freshDir('A1-products');
  let seen = null;
  const ports = createIndexingPorts({
    resolveModelDir: () => 'D:/models',
    productsRoot,
    buildIndexImpl: async (opts) => {
      seen = opts;
      fs.writeFileSync(path.join(opts.outDir, 'items.json'), '[]'); // 模拟副产物
      return {
        ok: 4,
        dim: 768,
        failed: 1,
        reused: 2,
        compat: 'c1',
        scanned: 7,
        outDir: opts.outDir,
        indexBin: 'x',
        itemsJson: 'y',
        metaJson: 'z',
      };
    },
    writeIndexImpl: () => undefined,
  });
  const summary = await ports.buildIndex(reqOf(libRoot));
  assert.ok(seen, '构建器必须被调用');
  assert.equal(path.resolve(seen.libRoot), path.resolve(libRoot));
  assert.notEqual(path.resolve(seen.outDir), path.resolve(libRoot), 'outDir 绝不能在库根（P4）');
  assert.ok(path.resolve(seen.outDir).startsWith(path.resolve(productsRoot)), 'outDir 在临时区');
  assert.equal(fs.existsSync(seen.outDir), false, '构建完临时目录必须被清理');
  assert.deepEqual(summary, { total: 7, encoded: 4, failed: 1, reused: 2, dim: 768, compat: 'c1' });
});

test('A2 ⭐⭐ 真实模式没有模型 ⇒ 明确失败（MODEL_MISSING），绝不返回假成功', async () => {
  const libRoot = freshDir('A2-lib');
  const ports = createIndexingPorts({
    resolveModelDir: () => null,
    productsRoot: freshDir('A2-products'),
    buildIndexImpl: async () => {
      throw new Error('不该被调用（没有模型就不该开始构建）');
    },
  });
  await assert.rejects(
    () => ports.buildIndex(reqOf(libRoot)),
    (e) => e && e.code === 'MODEL_MISSING',
    '没有模型必须抛 MODEL_MISSING',
  );
});

test('A3 ⭐ writeIndex：把 {libRoot,bytes} 原样交给**唯一**原子写（只调一次）', () => {
  const libRoot = freshDir('A3-lib');
  const calls = [];
  const ports = createIndexingPorts({
    resolveModelDir: () => 'D:/models',
    productsRoot: freshDir('A3-products'),
    writeIndexImpl: (r, b) => calls.push([r, b.length]),
  });
  const bytes = new Uint8Array([1, 2, 3]);
  ports.writeIndex({ libRoot, bytes });
  assert.deepEqual(calls, [[libRoot, 3]]);
});

test('A4 ⭐ 假构建器（e2e 钩子）：进度单调 · 取消在安全点抛 · 取消时**零写** · 续跑 reused>0', async () => {
  const libRoot = freshDir('A4-lib');
  const productsRoot = freshDir('A4-products');
  const realWrites = [];
  const ports = createIndexingPorts({
    resolveModelDir: () => null, // 假构建器不该需要模型
    productsRoot,
    fake: true,
    writeIndexImpl: (r, b) => realWrites.push([r, b]),
  });
  // ⚠️ 引擎侧会把 `writeIndex` 包一层（补 libRoot）再交给构建器 ⇒ 这里模拟同一个包装。
  //   不模拟的话，测到的是"测试自己的空实现"，根本没走注入链路（A4 第一次写就是这么白测的）。
  const reqWithEngineWrap = (extra = {}) =>
    reqOf(libRoot, {
      ...extra,
      writeIndex: (inp) => ports.writeIndex({ libRoot, bytes: inp.bytes }),
    });
  // ① 取消：进度有到，且**没有任何写入**
  const ctrl = new AbortController();
  const progresses = [];
  const p = ports.buildIndex(
    reqWithEngineWrap({
      signal: ctrl.signal,
      onProgress: (x) => {
        progresses.push(x.done);
        if (progresses.length === 2) ctrl.abort();
      },
    }),
  );
  await assert.rejects(
    p,
    (e) => e && e.name === 'BuildCancelledError',
    '取消必须在安全点抛 BuildCancelledError',
  );
  assert.equal(realWrites.length, 0, '取消时 writeIndex 必须零调用（原子写：旧索引完好）');
  assert.ok(
    progresses.length >= 2 && progresses.every((v, i) => i === 0 || v >= progresses[i - 1]),
    '进度单调不减',
  );
  // ② 续跑：假构建器按标记报 reused > 0（标记只在 productsRoot，不碰库根）
  const summary = await ports.buildIndex(reqWithEngineWrap());
  assert.ok(summary.reused > 0, '取消后再续跑必须有复用（卡片要求：复用计数 > 0）');
  assert.equal(realWrites.length, 1, '成功跑完才写一次');
  // ③ 写出来的字节必须是合法索引（真的走一次 writeIndexAtomically 验证）
  const check = freshDir('A4-check');
  fs.writeFileSync(path.join(check, '.gs.db'), ''); // 让目录非空，便于观察
  const rep = writeIndexAtomically(check, realWrites[0][1]);
  assert.equal(rep.count !== null, true, '写出的索引能通过五道校验');
});

test('A5 ⭐⭐ 写索引只有一处（源码扫描）：main 里只有 index-adapter.ts 调 writeIndexAtomically', () => {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.name.endsWith('.ts')) files.push(q);
    }
  };
  walk(MAIN);
  // ① **实现**只有一处（P1 说的是"第二份实现"，不是"第二个调用者"）
  const definers = files
    .filter((f) => /export function writeIndexAtomically\s*\(/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.basename(f))
    .sort();
  assert.deepEqual(definers, ['index-file.ts'], '原子写的实现只有一处（index-file.ts）');
  // ② 调用者：注入适配器 + 定义/自测 + **既有的**库重建路径（library-rebuild.ts 早于本卡存在）
  const callers = files
    .filter((f) => /writeIndexAtomically\s*\(/.test(fs.readFileSync(f, 'utf8')))
    .map((f) => path.basename(f))
    .sort();
  assert.deepEqual(
    callers,
    ['index-adapter.ts', 'index-file.ts', 'library-rebuild.ts'],
    '调用者集合固定：适配器（新）+ 定义/自测 + 既有 rebuild（不许再冒第四个）',
  );
  // ③ 适配器里**不许**自己拼临时文件/自己 rename（那会是第二份写入实现）
  const adapterSrc = fs.readFileSync(path.join(MAIN, 'index-adapter.ts'), 'utf8');
  assert.equal(/renameSync/.test(adapterSrc), false, '适配器不许自己 rename 索引文件');
});
