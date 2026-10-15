// apps/desktop/e2e/helpers/fixture-lib.mjs —— E2E 的**合成夹具库**（P4-2）
//
// 为什么要有它（2026-10-15 · P4-2 第 2 段，Lead 批准）：
//   原先 `browse.spec.mjs` 拿 `data/_schema100/lib` 当夹具 —— 那是 **6.3 GB / 205 个文件**的地面真相
//   （storage-worker 的产物）。实测：单文件拷贝都是毫秒级，但**整目录递归拷贝 = 307,177 ms（5 分 7 秒）**，
//   光一个 `CR+VR/` 子目录就要 **131,583 ms**。而 `makeLib()` **每个测试都递归拷一次**、
//   Playwright 单测时上限 **60s** ⇒ **拷贝还没结束测试就超时** ⇒ `electron.launch` **根本没被执行到**。
//   现象极具误导性：`_app.log` 没有新增行、`electron` 进程数 0、只有 `Test timeout`。
//   ⇒ 夹具必须**自足且小**：不依赖 `data/_schema100`，不再拷 GB 级目录。
//
// 三条硬要求（Lead 批准文书）：
//   ① **走生产入口建库**：`openGsDb` + `importItemsFromJson`（与 S2 的 `build.mjs` 同款）——
//      不手写第二份 DDL（AGENTS P1），也顺带证明生产入口真的能用；
//   ② **不再依赖** `data/_schema100`（那是别人的地面真相，e2e 不该绑住它）；
//   ③ **行数要够**（虚拟滚动那条断言否则恒真）+ **区分度要够**（两个分类以上、两种扩展名以上、
//      有包/缺包都要有）—— 见下面的 SYNTH_PLAN。
//
// 确定性：不读时钟、不用随机数 ⇒ 同一条 `seed` 永远生成同一份（行数/uid/大小/顺序都可复现）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { openGsDb, importItemsFromJson } from '../../src/main/db/index.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

// ---------------------------------------------------------------- 极小但**合法**的 PNG（1×1，RGBA）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
/** 1×1 RGBA PNG（合法字节，能被真解码器读出来；大小只有 ~70B） */
function tinyPng(rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = zlib.deflateSync(Buffer.from(rgba), { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 合成计划（**显式**保证维度齐全）
/**
 * 每个分类的条数 / 扩展名 / 有没有包 —— **写死在这张表里**，期望值从同一张表推出来（只此一处）。
 * 维度覆盖：分类 3 个 · 扩展名 3 种 · 有包/缺包都有 ⇒ E14-d 的筛选与 E14-e 的空态才有的可分。
 */
export const SYNTH_PLAN = Object.freeze({
  folders: Object.freeze([
    Object.freeze({ folder: 'CR', count: 60, exts: Object.freeze(['.png', '.jpg']) }),
    Object.freeze({ folder: 'CR+VR', count: 45, exts: Object.freeze(['.jpg', '.jpeg']) }),
    Object.freeze({ folder: 'VR', count: 15, exts: Object.freeze(['.png']) }),
  ]),
  /** 每第 N 条**没有包**（缺包），其余有包 —— 确定性（不看随机数） */
  noArchiveEvery: 5,
});

/** 从 SYNTH_PLAN 推出**期望值**（测试只许用这里算出来的，不许手抄数字） */
export function synthExpectations() {
  const all = [];
  let i = 0;
  for (const f of SYNTH_PLAN.folders) {
    for (let k = 0; k < f.count; k++) {
      const ext = f.exts[k % f.exts.length];
      const hasArchive = i % SYNTH_PLAN.noArchiveEvery !== 0;
      all.push({ index: i, folder: f.folder, ext, hasArchive });
      i++;
    }
  }
  const countBy = (key) => {
    const m = {};
    for (const it of all) m[it[key]] = (m[it[key]] ?? 0) + 1;
    return m;
  };
  return {
    total: all.length,
    folders: countBy('folder'),
    exts: countBy('ext'),
    withArchive: all.filter((x) => x.hasArchive).length,
    withoutArchive: all.filter((x) => !x.hasArchive).length,
  };
}

/**
 * 造一份自足夹具库：目录 + 素材文件 + items.json + `.gs.db`（走**生产**建库入口）。
 * @returns {{ root: string, expectations: object, items: object[], cleanup: () => void }}
 */
export function buildSynthLibrary() {
  const root = fs.mkdtempSync(path.join(ROOT, 'data', '_t46synth-'));
  const items = [];
  const expect = synthExpectations();
  let i = 0;
  for (const f of SYNTH_PLAN.folders) {
    const dir = path.join(root, f.folder);
    fs.mkdirSync(dir, { recursive: true });
    for (let k = 0; k < f.count; k++) {
      const ext = f.exts[k % f.exts.length];
      const stem = f.folder.replace(/[+]/g, '_') + '-' + String(k + 1).padStart(3, '0');
      const relPath = path.join(f.folder, stem + ext);
      const absPath = path.join(root, relPath);
      const png = tinyPng([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255]);
      fs.writeFileSync(absPath, png);
      const hasArchive = i % SYNTH_PLAN.noArchiveEvery !== 0;
      const rec = {
        uid: (0x100000000000 + i * 7919).toString(16).slice(-12).padStart(12, '0'),
        libId: 'L1',
        folder: f.folder,
        stem,
        name: stem + ext,
        relPath,
        absPath,
        imageExt: ext,
        imageSize: png.length,
        imageMtime: 1_700_000_000_000 + i * 1000,
        archiveName: null,
        archiveRelPath: null,
        archiveAbsPath: null,
        archiveExt: null,
        archiveSize: null,
        archiveMtime: null,
        vectorRow: i,
        vectorSource: 'native',
      };
      if (hasArchive) {
        const arcRel = path.join(f.folder, stem + '.zip');
        const arcAbs = path.join(root, arcRel);
        const zipBytes = Buffer.concat([
          Buffer.from([0x50, 0x4b, 0x03, 0x04]),
          Buffer.alloc(64 + i, i % 251),
        ]);
        // 包内容不重要（e2e 不读包），但**必须存在**：库口径是「缺包 = 少一行」
        // ⚠️ zipBytes 的前四字节是**真的** PK\x03\x04（数值写法，不靠字符串转义）
        rec.archiveName = stem + '.zip';
        rec.archiveRelPath = arcRel;
        rec.archiveAbsPath = arcAbs;
        rec.archiveExt = '.zip';
        rec.archiveSize = zipBytes.length;
        rec.archiveMtime = 1_700_000_000_000 + i * 1000 + 1;
      }
      items.push(rec);
      i++;
    }
  }
  const itemsJsonPath = path.join(root, 'items.json');
  fs.writeFileSync(itemsJsonPath, JSON.stringify(items), 'utf8');

  // 走生产建库入口（不手写第二份 DDL）
  const opened = openGsDb({ dbPath: path.join(root, '.gs.db') });
  try {
    importItemsFromJson({
      db: opened.db,
      library: { libId: 'L1', root },
      itemsJsonPath,
      expectedCount: items.length,
    });
  } finally {
    opened.db.close();
  }

  return {
    root,
    items,
    expectations: expect,
    cleanup: () => {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* 临时目录 */
      }
    },
  };
}
