// apps/desktop/tests/gs-names-single-source.test.mjs —— U11 的**防复发断言**
//
// 守什么：库根「保留命名空间」（`.gs-*` / `.gs.db` 家族 / staging）的**判据与名字只能有一份**，
// 它在引擎侧（`packages/engine/src/gs-names.ts`）；主进程侧只许 re-export。
//
// 为什么需要它（2026-10-15 的真实事故）：两处判据曾经各写一份，于是**同时**漏掉
// `'.gs.db'.startsWith('.gs-') === false` —— 症状是扫描器把元数据当素材、以及
// 「重建前后素材摘要一致」把 SQLite 的 WAL 变化算成「素材被改」。**两处都不报错，只是结果不对。**
// 修完之后如果没人守，第二份实现会悄悄长回来（P1 的典型复发形态）—— 这条断言就是那道门。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { maskComments } from './helpers/source-scan.mjs';
import {
  isReservedLibraryName as fromEngine,
  GS_DB_NAME as dbFromEngine,
} from '../../../packages/engine/src/gs-names.ts';
import {
  isReservedLibraryName as fromMain,
  GS_DB_NAME as dbFromMain,
} from '../src/main/gs-names.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (p) => maskComments(read(p)); // ⚠️ 必须剥注释：注释里正当地引用了旧实现

const MAIN_GS_NAMES = 'apps/desktop/src/main/gs-names.ts';
const MAIN_STORAGE_ROOTS = 'apps/desktop/src/main/storage-roots.ts';
const ENGINE_GS_NAMES = 'packages/engine/src/gs-names.ts';

test('S1 ⭐ 主进程入口与引擎实现**行为完全一致**（re-export 不是"另写一份同义实现"）', () => {
  // 名字表刻意含反例：.gs.db 家族（U11 的洞）、隐藏项、能配对的真实素材名
  const names = [
    '.gs.db',
    '.gs.db-wal',
    '.gs.db-shm',
    '.gs.db-journal',
    '.gs-index.bin',
    '.gs-journal',
    '.gs-staging',
    '.gs-write-probe-4711',
    'ID-1.jpg',
    '.gitignore',
    'VR',
    '',
    null,
    undefined,
    42,
    {},
  ];
  for (const n of names) {
    assert.equal(fromMain(n), fromEngine(n), `两边对 ${JSON.stringify(n)} 的判断必须一致`);
  }
  assert.equal(dbFromMain, dbFromEngine, '文件名常量必须同值');
});

test('S2 ⭐ U11 的洞被钉住：.gs.db 家族必须被判为"保留名"（不是素材）', () => {
  for (const n of ['.gs.db', '.gs.db-wal', '.gs.db-shm', '.gs.db-journal']) {
    assert.equal(fromEngine(n), true, `${n} 必须不是素材`);
  }
  // 反例现实检查：这就是当初那个洞 —— 只按 .gs- 前缀会漏掉它们
  assert.equal('.gs.db'.startsWith('.gs-'), false, '前提：.gs.db 不匹配 .gs- 前缀');
  assert.equal('.gs.db-wal'.startsWith('.gs-'), false, '前提：边车同样不匹配');
});

test('S3 ⭐ 主进程不许再自建判据 / 自定义名字常量（第二份实现会当场红）', () => {
  for (const f of [MAIN_GS_NAMES, MAIN_STORAGE_ROOTS]) {
    assert.doesNotMatch(
      code(f),
      /startsWith\(\s*['"]\.gs-/,
      `${f} 不许自己判 .gs- 前缀（用引擎的判据）`,
    );
    assert.doesNotMatch(
      code(f),
      /(const|let|var)\s+\w+\s*(:[^=]+)?=\s*['"]\.gs/,
      `${f} 不许自定义 .gs-* 名字字面量`,
    );
  }
  // 主进程入口必须实际引用引擎模块（re-export 的证据，而不是"恰好没写"）
  assert.match(
    code(MAIN_GS_NAMES),
    /from '.*packages\/engine\/src\/gs-names\.ts'/,
    'main/gs-names.ts 必须从引擎 re-export',
  );
  assert.match(
    code(MAIN_STORAGE_ROOTS),
    /from '.*packages\/engine\/src\/gs-names\.ts'/,
    'storage-roots.ts 必须从引擎引名字常量',
  );
});

test('S4 名字与判据的定义只在引擎侧各出现一次', () => {
  const eng = code(ENGINE_GS_NAMES);
  for (const [name, value] of [
    ['GS_INDEX_NAME', '.gs-index.bin'],
    ['GS_DB_NAME', '.gs.db'],
    ['GS_JOURNAL_NAME', '.gs-journal'],
    ['GS_WRITE_PROBE_PREFIX', '.gs-write-probe-'],
  ]) {
    const hit = new RegExp(`export const ${name}[^=]*= '${value.replace(/\./g, '\\.')}'`);
    assert.match(eng, hit, `引擎必须定义 ${name}`);
  }
  assert.match(eng, /export function isReservedLibraryName/, '引擎必须导出判据本体');
});
