// packages/engine/src/index-layout.ts —— 向量索引落点的**唯一**解析（T-44）
//
// 为什么必须有它：2026-10-15 T-15b 真窗口实测发现 —— `data/libraries/L1` 是**旧布局**
//   （`<dataDir>/libraries/<libId>/index.bin`），而体检按**新布局**找 `<库根>/.gs-index.bin`
//   ⇒ 体检报 `index(INDEX_MISSING)`，可引擎在旧布局下**明明有索引**（那份索引过得了五道校验，实测 count=3594）。
//   两边说法相反，根因是**两处各自判断『索引在哪』**（AGENTS P1）。
//
// ⇒ 本文件是那一处的**唯一实现**，被两个地方消费：
//   · 主进程的索引端口（`main/storage-ports.ts` 的 storageOf → VectorIndexPort）—— 引擎真正读索引的那条路
//   · 主进程的体检（`main/library-health.ts`）—— 之前的第二份判断
//
// 三条纪律（照 T-44 的要求）：
//   ① **只读**：只做 existsSync（可注入），不建目录、不写、不迁移；
//   ② 结论**如实说明用的是哪套布局**（`layout`），不把「旧布局」说成「缺失」；
//   ③ 两处都没有时 layout='none'（那才是真的 `INDEX_MISSING`）—— 不许拿它冒充别的因果。
import path from 'node:path';
import fs from 'node:fs';

import { GS_INDEX_NAME } from './gs-names.ts';

/** 旧布局的索引文件名（新布局用 `GS_INDEX_NAME`） */
export const LEGACY_INDEX_FILENAME = 'index.bin';

/** 索引落在哪套布局上；'none' = 两处都没有 */
export type IndexLayout = 'library-root' | 'legacy' | 'none';

/** 一个候选落点（带存在性 —— 排障时要能看见「找过哪些路径」） */
export interface IndexLocationCandidate {
  layout: 'library-root' | 'legacy';
  indexPath: string;
  exists: boolean;
}

/** 解析结果 */
export interface IndexLocation {
  /** 命中的布局；'none' = 两个候选都不存在 */
  layout: IndexLayout;
  /** 命中的那个文件；'none' 时为 null */
  indexPath: string | null;
  /**
   * 首选路径（新布局：`<库根>/.gs-index.bin`）。'none' 时它就是「按规矩应该放在哪」，
   * 供错误信息与界面直接显示 —— 调用方**不要再自己拼一次**路径（那就是第二份判断）。
   */
  preferredPath: string;
  /** 按查找顺序的候选（新 → 旧） */
  candidates: IndexLocationCandidate[];
  /** 人话：用了哪套布局 / 都找过但都没有 */
  reason: string;
}

export interface ResolveIndexLocationInput {
  libId: string;
  /** 库根（新布局：`<库根>/.gs-index.bin`）。空/null ⇒ 不考虑新布局 */
  libraryRoot?: string | null;
  /** 旧布局的 libraries 根（`<dataDir>/libraries`）⇒ `<该目录>/<libId>/index.bin`。空/null ⇒ 不考虑旧布局 */
  legacyLibrariesDir?: string | null;
  /** 存在性检查（默认 fs.existsSync；测试可注入） */
  exists?: (p: string) => boolean;
}

/**
 * 解析某个库的向量索引落点。**顺序 = 新布局 → 旧布局**（迁移期必须两边都认）。
 */
export function resolveIndexLocation(input: ResolveIndexLocationInput): IndexLocation {
  const exists = input.exists ?? ((p: string) => fs.existsSync(p));
  const libId = String(input.libId ?? '');
  const root = input.libraryRoot ? path.resolve(input.libraryRoot) : null;
  const legacyDir = input.legacyLibrariesDir
    ? path.join(path.resolve(input.legacyLibrariesDir), libId)
    : null;

  const candidates: IndexLocationCandidate[] = [];
  if (root !== null) {
    const p = path.join(root, GS_INDEX_NAME);
    candidates.push({ layout: 'library-root', indexPath: p, exists: exists(p) });
  }
  if (legacyDir !== null) {
    const p = path.join(legacyDir, LEGACY_INDEX_FILENAME);
    candidates.push({ layout: 'legacy', indexPath: p, exists: exists(p) });
  }

  const hit = candidates.find((c) => c.exists) ?? null;
  const preferredPath = candidates.length > 0 ? candidates[0].indexPath : '';
  const tried = candidates.length > 0
    ? candidates.map((c) => c.layout + '=' + c.indexPath + (c.exists ? '(有)' : '(无)')).join(' · ')
    : '(没有可查的候选：库根与旧布局目录都没给)';

  if (hit === null) {
    return {
      layout: 'none',
      indexPath: null,
      preferredPath,
      candidates,
      reason: '两处都没有索引：' + tried,
    };
  }
  return {
    layout: hit.layout,
    indexPath: hit.indexPath,
    preferredPath,
    candidates,
    reason: (hit.layout === 'legacy'
      ? '用**旧布局**（迁移期回退）：' + hit.indexPath
      : '用**新布局**（库根）：' + hit.indexPath) + ' —— 查找顺序 ' + tried,
  };
}