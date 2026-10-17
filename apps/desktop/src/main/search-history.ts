// apps/desktop/src/main/search-history.ts —— 搜索历史的**唯一写入口**（FR-012）
//
// 为什么单独一个模块：
//   · `recent_query` 是**应用级**表（B2-5FIX 从库级搬来），写入入口只有 `app-db.ts` 的
//     `insertRecentQuery`；这里负责"什么算一次该记的检索 + 记不上怎么办"这一层业务判断；
//   · 主入口 `main/index.ts` import 了 electron ⇒ `node:test` 加载不了它 ⇒ 把可测的逻辑搬到这里
//     （与 `collect-ledger.ts` / `history-ipc.ts` 同一条理由）。
//
// 三条口径（每条都有前车之鉴）：
//   ① **只记成功的 text/image 检索**：`vector` 是低层通道（直接给向量），没有可重放的输入 ⇒ 记了也没用；
//      空文本 / 非 text|image 的 mode ⇒ **不记**（不编一条假历史）。
//   ② **记历史失败绝不改判检索结果**：检索是否成功由引擎裁决；这里**永不抛**，
//      失败只写日志 + 返回非空 warning，由 IPC 层挂到信封 `warnings`（照抄 WIRE-B 取件留痕的纪律）。
//   ③ **存 uid 不存绝对路径**（`image_ref`）：路径会变，uid 不会；库外图片没有 uid ⇒ NULL 是如实。
import crypto from 'node:crypto';

import { insertRecentQuery, openAppDb } from './app-db.ts';
import type { RecentQueryKind } from './app-db.ts';
import { log } from './log.ts';

export interface RecordSearchHistoryInput {
  /** `app.getPath('userData')` —— app.db 的落点根（为 null ⇒ 记不了，返回警告） */
  userDataDir: string | null;
  /** 引擎 `search` **成功**的信封 data（本模块只取命中数；形状不认识 ⇒ result_count = null） */
  data: unknown;
  /** 该次调用的 params（契约层已 zod 校验过；这里只按需取字段） */
  params: unknown;
}

function stackText(e: unknown): string {
  if (e instanceof Error) return e.stack ?? e.message;
  return String(e);
}

/** 命中数：只在 `data.results` 真的是数组时取长度；取不到就 **null**（不编 0） */
function resultCountOf(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  const results = (data as { results?: unknown }).results;
  return Array.isArray(results) ? results.length : null;
}

/** `params.imageRef` 是 `{libId, uid}`（契约）；只有 uid 是字符串才当参考图身份 */
function imageRefOf(params: Record<string, unknown>): string | null {
  const ref = params.imageRef;
  if (!ref || typeof ref !== 'object') return null;
  const uid = (ref as { uid?: unknown }).uid;
  return typeof uid === 'string' && uid ? uid : null;
}

/**
 * 把一次**成功的**检索记入 `recent_query`。
 *
 * @returns `null` = 已记录（或按口径**不需要**记录）；非空字符串 = 要挂到信封 `warnings` 的说明
 */
export function recordSearchQuery(input: RecordSearchHistoryInput): string | null {
  const params =
    input.params && typeof input.params === 'object'
      ? (input.params as Record<string, unknown>)
      : {};
  const mode = params.mode;
  // 契约里 `search.mode` 有 text / image / vector 三种；vector 不是用户输入（见文件头 ①）。
  if (mode !== 'text' && mode !== 'image') return null;
  const kind: RecentQueryKind = mode;

  const text = typeof params.text === 'string' ? params.text.trim() : '';
  if (kind === 'text' && !text) return null; // 防御性：空文本不该走到这里，但也绝不记一条空历史

  const libIds = Array.isArray(params.libIds)
    ? params.libIds.filter((x): x is string => typeof x === 'string' && Boolean(x))
    : [];
  // 范围单库才记具体 libId；多库/未指定 = "全部库" ⇒ NULL（与 DDL 注释一致）
  const scopeLibId = libIds.length === 1 ? libIds[0] : null;
  const imageRef = kind === 'image' ? imageRefOf(params) : null;

  if (!input.userDataDir) {
    // 应用还没准备好 —— 检索照常返回，历史如实说没记
    return '检索成功，但搜索历史没有记录（应用数据目录未就绪）';
  }

  let app;
  try {
    app = openAppDb({ userDataDir: input.userDataDir });
  } catch (e) {
    log('!! [搜索历史] 打开 app.db 失败（**检索结果不受影响**）:', stackText(e));
    return '检索成功，但搜索历史没有写入（应用数据库打不开，详见日志）';
  }

  try {
    insertRecentQuery(app.db, {
      queryId: crypto.randomUUID(),
      kind,
      text: kind === 'text' ? text : null,
      imageRef,
      scopeLibId,
      resultCount: resultCountOf(input.data),
    });
    return null;
  } catch (e) {
    log('!! [搜索历史] 写入 recent_query 失败（**检索结果不受影响**）:', stackText(e));
    return '检索成功，但搜索历史没有写入（详见日志）';
  } finally {
    app.db.close();
  }
}
