// packages/indexer/tests/build-index-api.test.mjs —— IDX-1：构建器**可被 import**、能报进度/取消、产物格式不变
//
// 为什么单列一组：本卡之前 `build_index_onnx.ts` 是**无导出、顶层就跑 main() 的 CLI** ——
// 主进程 import 它会当场把 CLI 跑起来（没有 --out 就崩）。于是「把索引接到界面」连第一步都迈不出去。
// 本组钉四件事：
//   ① import 零副作用（顶层不再执行构建）；
//   ② 字节组装仍是 SPEC 的 GSIDX 格式（用**引擎的 readIndexBin** 校验，不造第二份解析器）；
//   ③ 取消 = 明确抛 BuildCancelledError 且**不落盘**（不许静默返回半成品）；
//   ④ 进度信号在模型之前就开始发（scan / uid / selftest / model），字段对应 progress_done / progress_total。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  buildIndex,
  buildIndexBinBytes,
  writeIndexBinFile,
  BuildCancelledError,
} from '../src/build_index_onnx.ts';
import { readIndexBin } from '../../engine/src/index.ts'; // 引擎的 GSIDX 解析（唯一权威，P1）

const SRC = fileURLToPath(new URL('../src/build_index_onnx.ts', import.meta.url));
// ⚠️ 动态 import 在 Windows 上必须收 **file:// URL**（传 D:\… 会 ERR_UNSUPPORTED_ESM_URL_SCHEME）
const SRC_URL = new URL('../src/build_index_onnx.ts', import.meta.url).href;

function mkdtemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gs-idx1-'));
}

/** 迷你库：1 组配对（只用到扩展名与 stat，不解码 ⇒ .jpg 内容无所谓） */
function miniLib(dir) {
  const lib = path.join(dir, 'lib');
  fs.mkdirSync(path.join(lib, 'VR'), { recursive: true });
  fs.writeFileSync(path.join(lib, 'VR', 'a.jpg'), 'not-really-a-jpeg');
  fs.writeFileSync(path.join(lib, 'VR', 'a.rar'), 'not-really-a-rar');
  return lib;
}

test('IDX-1 ⭐⭐ import 本模块**零副作用**：顶层不再跑 CLI（无参数 import 必须干净退出）', () => {
  // 子进程里只 import、不给任何 --model/--lib/--out。重构前：顶层立刻 main() ⇒ 参数缺失/崩 ⇒ 退出码非 0。
  const code = 'await import(' + JSON.stringify(SRC_URL) + '); console.log("IMPORTED");';
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(out, /IMPORTED/, 'import 应当正常返回（实得输出：' + out.slice(0, 200) + '）');
});

test('IDX-1 ⭐⭐ 产物字节仍是 GSIDX：引擎 readIndexBin 能读回（截断必须被拒）', () => {
  const dir = mkdtemp();
  try {
    const file = path.join(dir, 'index.bin');
    const header = { format_version: 1, dim: 2, count: 2, compat: 'selftest' };
    const src = [0.5, -0.5, 1, 2];
    const bytes = buildIndexBinBytes(header, src, 2, 2);
    writeIndexBinFile({ dir, file, bytes, header, count: 2, dim: 2 });
    const back = readIndexBin(file);
    assert.ok(back, '引擎必须能解析我们写的字节（五道校验全过）');
    assert.equal(back.header.count, 2, 'count 一致');
    assert.equal(back.header.dim, 2, 'dim 一致');
    for (let i = 0; i < src.length; i++) {
      assert.ok(Math.abs(back.vectors[i] - src[i]) < 1e-6, '第 ' + i + ' 位一致');
    }
    // 反例：截断（模拟写了一半）必须被引擎拒掉 —— 这就是 footer 存在的理由。
    // ⚠️ 引擎的 readIndexBin 在这条路径上**抛类型化错误**（INDEX_CORRUPT），不是返回 null
    //    （返回 null 是本文件里 CLI 自带的那个本地读回器；两者的契约不同，别混）
    fs.writeFileSync(file, bytes.subarray(0, bytes.length - 5));
    assert.throws(
      () => readIndexBin(file),
      (e) => e && e.code === 'INDEX_CORRUPT',
      '截断文件不许被当成有效索引（必须是 INDEX_CORRUPT）',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('IDX-1 ⭐⭐ 取消：signal 已置位 ⇒ 抛 BuildCancelledError，且**不落盘**', async () => {
  const dir = mkdtemp();
  try {
    const lib = miniLib(dir);
    const outDir = path.join(dir, 'out');
    const ac = new AbortController();
    ac.abort();
    const events = [];
    await assert.rejects(
      buildIndex({
        modelDir: path.join(dir, 'no-such-model'),
        libRoot: lib,
        outDir,
        signal: ac.signal,
        onProgress: (p) => events.push(p),
      }),
      (e) => e instanceof BuildCancelledError && /取消/.test(e.message),
      '预置取消信号必须抛 BuildCancelledError（而不是去载模型或静默返回）',
    );
    assert.equal(fs.existsSync(outDir), false, '取消时连 outDir 都不该建（更不该落盘半个索引）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('IDX-1 ⭐⭐ 进度：模型之前就发 scan/uid/selftest/model，且 done/total 如实', async () => {
  const dir = mkdtemp();
  try {
    const lib = miniLib(dir);
    const outDir = path.join(dir, 'out');
    const events = [];
    // 模型目录是垃圾 ⇒ 必然在 model 阶段失败；这正是我们要的：只看**在此之前**发了什么信号
    await assert.rejects(
      buildIndex({
        modelDir: path.join(dir, 'no-such-model'),
        libRoot: lib,
        outDir,
        onProgress: (p) => events.push(p),
      }),
    );
    const phases = events.map((e) => e.phase);
    assert.deepEqual(
      phases.slice(0, 4),
      ['scan', 'scan', 'uid', 'uid'],
      '阶段顺序（实得 ' + phases.join(' → ') + '）',
    );
    assert.ok(
      phases.includes('selftest') && phases.includes('model'),
      '自检与载模型的信号也要有（实得 ' + phases.join(',') + '）',
    );
    const scanEnd = events.filter((e) => e.phase === 'scan').pop();
    assert.equal(scanEnd.done, 1, '扫描结束应报 done=1（实得 ' + scanEnd.done + '）');
    assert.equal(scanEnd.total, 1, '扫描结束应报 total=1');
    const uidEnd = events.filter((e) => e.phase === 'uid').pop();
    assert.equal(uidEnd.done, 1, 'UID 阶段结束应报 done=1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('IDX-1 ⭐ 进度回调抛异常**不许**毁掉构建（进度是旁路）', async () => {
  const dir = mkdtemp();
  try {
    const lib = miniLib(dir);
    const outDir = path.join(dir, 'out');
    const ac = new AbortController();
    ac.abort();
    // onProgress 直接抛：若没被吞掉，抛出的会是 onProgress 的错，而不是 BuildCancelledError
    await assert.rejects(
      buildIndex({
        modelDir: path.join(dir, 'no-such-model'),
        libRoot: lib,
        outDir,
        signal: ac.signal,
        onProgress: () => {
          throw new Error('进度回调自己炸了');
        },
      }),
      (e) => e instanceof BuildCancelledError,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
