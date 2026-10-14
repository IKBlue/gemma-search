// packages/engine/src/scanner.ts —— 素材库扫描器（SPEC §1/§2；T-13a）
//
// 三件事，缺一不可：
//   ① **跳过库内产物与隐藏项**（SPEC §1：「所有条目扫描（浏览、体检、入库差分）**必须跳过**
//      `.gs-*` 与隐藏项」）。`.gs-index.bin`/`.gs.db` 是**派生数据**，`.gs-staging/` 是
//      **未完成事务的暂存区** —— 而它会被建在**任意子目录**下（`executor.stagingPathFor` 用的是
//      `<目标目录>/.gs-staging/<txnId>/…`）⇒ 跳过必须按**名字在每一层**生效，不能只处理库根。
//      ⚠️ 判据**不是** `.gs-` 前缀：`.gs.db` 的第 4 个字符是 `.`（U11）⇒ 用 gs-names.ts 的唯一实现。
//   ② **缺包登记**（SPEC §1：「缺包是合法状态（登记为 `missing-archive`），不是错误」）。
//   ③ **魔数检测**（SPEC §7 体检 ⑥）：名 .jpg 实为 BMP 的必须如实标注 —— 实测 20 张，另有 68 张
//      .png 实为 JPEG、17 张 .jpg 实为 PNG。**不许按扩展名假装**。
//
// ⚠️ **只读**：本模块只用 readdir / stat / open(…,'r')+read / close，**绝不写素材目录**（AGENTS P4）。
//    `tests/transactions-write-path.test.mjs` 的 TX-W1（破坏性写）与 TX-W4（写文件 API）在机械地守这一条。
//
// 复用（不做第二份实现，P1）：
//   · 图片/压缩包扩展名集合 ← `fingerprint.ts`（引擎里已有的一份）
//   · staging 目录名 ← `transactions/steps.ts` 的 `STAGING_DIRNAME`（不在这里再写一次字面量）
//   · uid 公式 ← `uid.ts`
import fs from 'node:fs';
import path from 'node:path';

import { IMG_EXT, ARCHIVE_EXT } from './fingerprint.ts';
import { detectImageFormat, readImageHead, extMatchesFormat } from './magic.ts';
import type { ImageFormat } from './magic.ts';
import { normRelDir, uidOf } from './uid.ts';
import { messageOf } from './errors.ts';
// ⚠️ 「库内产物」的判据**只有一份**：engine/src/gs-names.ts（U11：'.gs-' 前缀不够，.gs.db 家族不匹配）
import { isReservedLibraryName } from './gs-names.ts';

/** 配对到的压缩包 */
export interface ScannedArchive {
  relPath: string;
  ext: string;
  size: number;
  mtime: number;
}

/** 一条素材（= 一张预览图 + 可选的同名压缩包） */
export interface ScannedItem {
  uid: string;
  /** 图相对库根的路径 */
  relPath: string;
  /** relPath 的目录部分；库根下为空串 */
  relDir: string;
  /** 顶层分类目录（库根下为空串）—— 与构建器一致 */
  folder: string;
  stem: string;
  imageExt: string;
  /** **真实**格式（读魔数得到） */
  imageFormat: ImageFormat;
  /** 扩展名与真实格式是否一致（false ⇒ 体检 ⑥ 的"扩展名与内容不符"） */
  extMatchesMagic: boolean;
  imageSize: number;
  imageMtime: number;
  /** 缺包 ⇒ null（**合法状态**，不是错误） */
  archive: ScannedArchive | null;
}

/** scanLibrary() 的计数汇总 */
export interface ScanCounts {
  images: number;
  paired: number;
  missingArchive: number;
  missingImage: number;
  formatMismatch: number;
  zeroByte: number;
  /** 被「保留命名空间」判据挡掉的条目数（.gs-* / .gs.db 家族 / staging） */
  skippedReserved: number;
  /** 点开头但不是保留名的隐藏项数（SPEC §1 要求一并跳过） */
  skippedHidden: number;
  unreadable: number;
}

/** scanLibrary() 的返回 */
export interface ScanResult {
  root: string;
  libId: string;
  items: ScannedItem[];
  /** 有图无包 —— SPEC §1：**登记**成 missing-archive */
  missingArchive: Array<{ uid: string; relPath: string; stem: string }>;
  /** 有包无图 —— 无法编码（SPEC §7 体检 ④），**登记**不静默丢 */
  missingImage: Array<{ relPath: string; ext: string }>;
  /** 魔数 ≠ 扩展名（SPEC §7 体检 ⑥） */
  formatMismatch: Array<{ relPath: string; imageExt: string; actual: ImageFormat }>;
  /** 读不动的目录/文件 —— 如实列出，**不静默跳过** */
  unreadable: Array<{ relPath: string; error: string }>;
  /** 被跳过的库内产物/隐藏项（计数始终真实，明细最多列 maxSkippedListed 条） */
  skipped: { total: number; reservedCount: number; hiddenCount: number; reserved: string[]; hidden: string[] };
  counts: ScanCounts;
}

/** scanLibrary() 的入参 */
export interface ScanOptions {
  /** 算 uid 用的库 id（SPEC-identity §2 的种子之一；空串也可以，只是换一个种子域） */
  libId?: string;
  /** 跳过明细最多列几条（计数不受影响） */
  maxSkippedListed?: number;
}

interface Slot {
  img?: { ext: string; full: string };
  arc?: { ext: string; full: string };
}

/**
 * 扫描一个素材库根（**只读**）。
 *
 * 配对规则（SPEC §1，与构建器逐字一致）：同目录 · 同主干 · 扩展名在 `{.rar,.zip,.7z}` 内。
 * 同主干有多个时取**先遇到的**那个（与构建器一致；不重复登记）。
 */
export function scanLibrary(root: string, { libId = '', maxSkippedListed = 50 }: ScanOptions = {}): ScanResult {
  const items: ScannedItem[] = [];
  const missingImage: Array<{ relPath: string; ext: string }> = [];
  const unreadable: Array<{ relPath: string; error: string }> = [];
  const reservedListed: string[] = [];
  const hiddenListed: string[] = [];
  let reservedCount = 0;
  let hiddenCount = 0;
  let zeroByte = 0;

  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      // 不可读目录：**记下来**再继续（静默跳过会让"少了几条"永远查不出来）
      unreadable.push({ relPath: path.relative(root, dir) || '.', error: messageOf(e) });
      continue;
    }

    const byStem = new Map<string, Slot>();
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      const rel = path.relative(root, full);
      // ① 跳过库内产物（唯一判据）与隐藏项 —— **目录也不进**（`.gs-staging` 里的暂存图不是素材）
      if (isReservedLibraryName(ent.name)) {
        reservedCount += 1;
        if (reservedListed.length < maxSkippedListed) reservedListed.push(rel);
        continue;
      }
      if (ent.name.startsWith('.')) {
        hiddenCount += 1;
        if (hiddenListed.length < maxSkippedListed) hiddenListed.push(rel);
        continue;
      }
      if (ent.isDirectory()) { stack.push(full); continue; }

      const ext = path.extname(ent.name).toLowerCase();
      if (!IMG_EXT.has(ext) && !ARCHIVE_EXT.has(ext)) continue;
      const stem = ent.name.slice(0, ent.name.length - ext.length);
      let slot = byStem.get(stem);
      if (!slot) { slot = {}; byStem.set(stem, slot); }
      if (IMG_EXT.has(ext)) { if (!slot.img) slot.img = { ext, full }; }
      else if (!slot.arc) slot.arc = { ext, full };
    }

    // ⚠️ 这里规范化的是**目录路径**，不是文件 relPath ⇒ 用 normRelDir（dirname 会把最后一段目录名吃掉）
    const relDir = normRelDir(path.relative(root, dir));
    const folder = relDir === '' ? '' : relDir.split(path.sep)[0];

    for (const [stem, slot] of byStem) {
      if (!slot.img) {
        // 只有包、没有图 ⇒ 无法编码。**登记**（体检 ④），不当成素材塞进 items。
        if (slot.arc) missingImage.push({ relPath: path.relative(root, slot.arc.full), ext: slot.arc.ext });
        continue;
      }
      const imgRel = path.relative(root, slot.img.full);
      let st: fs.BigIntStats;
      try {
        st = fs.statSync(slot.img.full, { bigint: true });
      } catch (e) {
        unreadable.push({ relPath: imgRel, error: messageOf(e) });
        continue;
      }
      let imageFormat: ImageFormat = 'unknown';
      try {
        imageFormat = detectImageFormat(readImageHead(slot.img.full));
      } catch (e) {
        // 读不出头部 ⇒ 格式如实记 'unknown'，但**不假装没这条素材**，同时把原因记下来
        unreadable.push({ relPath: imgRel, error: messageOf(e) });
      }
      const imageSize = Number(st.size);
      if (imageSize === 0) zeroByte += 1;

      let archive: ScannedArchive | null = null;
      if (slot.arc) {
        try {
          const ast = fs.statSync(slot.arc.full, { bigint: true });
          archive = {
            relPath: path.relative(root, slot.arc.full),
            ext: slot.arc.ext,
            size: Number(ast.size),
            mtime: Number(ast.mtimeNs / 1_000_000n),
          };
        } catch (e) {
          unreadable.push({ relPath: path.relative(root, slot.arc.full), error: messageOf(e) });
        }
      }

      items.push({
        uid: uidOf(libId, relDir, stem),
        relPath: imgRel,
        relDir,
        folder,
        stem,
        imageExt: slot.img.ext,
        imageFormat,
        extMatchesMagic: extMatchesFormat(slot.img.ext, imageFormat),
        imageSize,
        // ⚠️ 用 BigInt 纳秒**截断**（不是 mtimeMs）：mtimeMs 自带未文档化的舍入，
        //    与 Python/整数的截断可差 1ms（见 fingerprint.ts 的实测注释）。本库 400 条抽样上两者一致。
        imageMtime: Number(st.mtimeNs / 1_000_000n),
        archive,
      });
    }
  }

  items.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));

  const missingArchive = items
    .filter((i) => i.archive === null)
    .map((i) => ({ uid: i.uid, relPath: i.relPath, stem: i.stem }));
  const formatMismatch = items
    .filter((i) => !i.extMatchesMagic)
    .map((i) => ({ relPath: i.relPath, imageExt: i.imageExt, actual: i.imageFormat }));

  const counts: ScanCounts = {
    images: items.length,
    // 「配对」= 有包的条目数。**只有一个名字**（原先还并列一个同值的 archives —— 同一个数两个字段，
    // 迟早各自漂移）
    paired: items.filter((i) => i.archive !== null).length,
    missingArchive: missingArchive.length,
    missingImage: missingImage.length,
    formatMismatch: formatMismatch.length,
    zeroByte,
    skippedReserved: reservedCount,
    skippedHidden: hiddenCount,
    unreadable: unreadable.length,
  };

  return {
    root,
    libId,
    items,
    missingArchive,
    missingImage,
    formatMismatch,
    unreadable,
    skipped: { total: reservedCount + hiddenCount, reservedCount, hiddenCount, reserved: reservedListed, hidden: hiddenListed },
    counts,
  };
}
