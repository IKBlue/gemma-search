// apps/desktop/src/main/errors.ts —— main 侧的错误提取小工具（T-16b）
//
// 为什么单独一个文件：`unknown → code` 与 `unknown → 文案` 这两件事在 main 里出现了好几处
// （storage-roots 私有一份 · library-health 私有一份 · T-16b 的端口还要一份）。
// 与其继续复制，不如给新代码一个共同的家（AGENTS P2）。
//
// ⚠️ storage-roots.ts 里那份私有的 codeOf **本轮没动**（storage-worker 正在改那个文件，Lead 已明确要求不碰）；
//    等它那边稳定后可以收敛到这里。这里只服务**新写的**模块。

/**
 * unknown → 机器可读的 error code。
 * 拿不到就是 'UNKNOWN' —— **不猜**（猜出来的 code 会让调用方按错的分支处理）。
 */
export function codeOf(e: unknown): string {
  if (e !== null && typeof e === 'object' && 'code' in e) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && c) return c;
  }
  return 'UNKNOWN';
}

/** unknown → 可读文案（非 Error 的东西也要给出确定文本，不许变成 [object Object]） */
export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
