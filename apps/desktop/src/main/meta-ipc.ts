// apps/desktop/src/main/meta-ipc.ts —— 条目标注（评分/备注/收藏）两个 IPC 方法的主进程实现（WIRE-C）
//
// 为什么不写在 index.ts 里：index.ts import 了 electron ⇒ node:test 加载不了它 ⇒
//   「信封组装 + 错误码映射 + 永不抛」会零覆盖。抽出来可直接单测（与 library-ipc.ts 同一条理由）。
//
// 三条**打开方式**的纪律（E2E-RED-1 的 warmup 回归是同族问题）：
//   ① `metaGet` **只读打开**（readOnly:true）——读一下不许顺手把库建出来/升个版；
//   ② `metaGet` 遇到 `.gs.db` 不存在 ⇒ **根本不打开**，返回"没有标注"的空值（不代建）；
//   ③ `metaSet` 遇到 `.gs.db` 不存在 ⇒ **明确失败 DB_MISSING**（不代建；先重建元数据再改标注）。
import fs from 'node:fs';

import type { Envelope } from '../shared/ipc.ts';
import { openGsDb } from './db/open.ts';
import { getUserMeta, setUserMeta } from './db/user-meta.ts';
import { codeOf, messageOf } from './errors.ts';
import { log } from './log.ts';
import { createLibraryResolverPort } from './storage-ports.ts';
import type { LibraryRootInput } from './storage-roots.ts';

export interface MetaMethodInput {
  libId: string;
  uid: string;
  /** 已解析的库清单（index.ts 从 library-config 拿）——本模块不自己解析"库从哪来" */
  libraries: LibraryRootInput[];
  userDataDir: string | null;
  legacyLibrariesDir?: string | null;
}

export interface MetaSetParams extends MetaMethodInput {
  rating?: number | null;
  note?: string | null;
  isFavorite?: boolean;
}

function failure(code: string, message: string, what: string, libId: string): Envelope {
  log('!! ' + what + '失败 [' + code + ']', message);
  return {
    ok: false,
    error: {
      code,
      message,
      userMessage: what + '失败：这次改动没有生效。详情见日志。',
      details: { libId },
    },
  };
}

/** 解析该库 `.gs.db` 的落点（判据唯一来源 = storage 端口；解析不到就明确失败，不猜路径） */
function resolveDbPath(
  input: MetaMethodInput,
): { ok: true; dbPath: string } | { ok: false; why: string } {
  try {
    const port = createLibraryResolverPort({
      libraries: input.libraries,
      userDataDir: input.userDataDir ?? undefined,
      legacyLibrariesDir: input.legacyLibrariesDir ?? null,
    });
    const storage = port.storageOf(input.libId);
    return { ok: true, dbPath: storage.dbPath };
  } catch (e) {
    return { ok: false, why: messageOf(e) };
  }
}

/** `metaGet`：**只读**读取标注；库元数据不存在 ⇒ 空值（且**不代建**） */
export function runMetaGet(input: MetaMethodInput): Envelope {
  const r = resolveDbPath(input);
  if (!r.ok) return failure('LIB_NOT_FOUND', r.why, '读取标注', input.libId);
  try {
    // ② 不存在 ⇒ **根本不打开、明确 DB_MISSING**（与 metaSet 对称）。
    //   ⚠️ 为什么**不**返回空标注（2026-10-17 Lead 裁定 · 选 (a)）：
    //     `rating:null` 的语义是「**用户没评过**」，缺库的语义是「**我读不到、不知道**」；
    //     `isFavorite:false` 更糟 —— 界面会显示"未收藏"，真相却是"不知道"，用户会放心点下去、
    //     把 false 真的写进库 ⇒ **把「未知」说成「没有」**（本项目反复在打的同一类问题）。
    //     加 `available` 字段也能区分，但那要每个 UI 调用点都多判一次（多一次误用机会）；
    //     `DB_MISSING` 与 `metaSet` 对称 ⇒ 界面只有"标注不可用"一个分支，**少一个字段、少一次误用**。
    if (!fs.existsSync(r.dbPath)) {
      return failure(
        'DB_MISSING',
        '库元数据（.gs.db）不存在：读不到标注（本方法不会凭一次读取把库造出来）',
        '读取标注',
        input.libId,
      );
    }
    // ① **只读打开**：读取动作不该产生任何写入（连迁移都不跑）
    const opened = openGsDb({ dbPath: r.dbPath, readOnly: true });
    try {
      const m = getUserMeta(opened.db, input.uid);
      return {
        ok: true,
        data: {
          rating: m.rating,
          note: m.note,
          isFavorite: m.isFavorite,
          updatedAt: m.updatedAtMs,
        },
      };
    } finally {
      opened.db.close();
    }
  } catch (e) {
    return failure(codeOf(e) ?? 'INTERNAL', messageOf(e), '读取标注', input.libId);
  }
}

/** `metaSet`：部分更新（不传不动、null 清空）；库元数据不存在 ⇒ **明确失败**（不代建） */
export function runMetaSet(input: MetaSetParams): Envelope {
  const r = resolveDbPath(input);
  if (!r.ok) return failure('LIB_NOT_FOUND', r.why, '保存标注', input.libId);
  // ③ 缺库 ⇒ 不代建（先重建元数据再改标注；否则等于在"没有元数据的库"里凭空造一份账本）
  if (!fs.existsSync(r.dbPath)) {
    return failure(
      'DB_MISSING',
      '库元数据（.gs.db）不存在：先重建元数据，再保存标注（本方法不会凭一个写动作把库造出来）',
      '保存标注',
      input.libId,
    );
  }
  try {
    const opened = openGsDb({ dbPath: r.dbPath });
    try {
      const out = setUserMeta(opened.db, input.uid, {
        rating: input.rating,
        note: input.note,
        isFavorite: input.isFavorite,
      });
      log('[标注] 已保存：', input.libId, input.uid, '字段 =', out.applied.join(',') || '(无)');
      return { ok: true, data: { applied: out.applied } };
    } finally {
      opened.db.close();
    }
  } catch (e) {
    return failure(codeOf(e) ?? 'INTERNAL', messageOf(e), '保存标注', input.libId);
  }
}
