// utils/clipboard.ts —— 「把文本复制到剪贴板」的**唯一实现**（Operation 层 · 可在 node:test 里跑）
//
// 为什么单独一个模块（UX-1b）：
//   详情页要把**两条绝对路径**复制给用户（之后粘进资源管理器 / 聊天 / 工单里）。
//   直接在每个组件里写 `navigator.clipboard`，会让「权限被拒 / 环境不支持 / 复制失败」各写一套判定与文案
//   —— 那是 P1/P2 的形状（同一概念第二份实现）。这里收成一份，组件只决定「复制哪一段文本」。
//
// 三条口径：
//   ① **失败必须可感知**：返回 `{ ok:false, reason }`，调用方据此给 err 提示；**绝不静默吞掉**
//      （P6：不许把没做到的事说成做到了）。成功才允许说"已复制"。
//   ② **不动 IPC 契约**：复制是渲染进程的本地能力。`navigator.clipboard.writeText` 在 Electron
//      renderer 里可用；权限被拒时退到 `document.execCommand('copy')`（老路径，Chromium 仍支持）。
//      → 不新增契约方法、也不往 preload 上再加通道（bridge 只暴露 invoke/onEvent/platform 的约束不变）。
//   ③ **依赖注入**：两条能力都从参数进（默认从全局解析）。这样 node:test 能直接断言
//      「现代路径成功 / 被拒后走降级 / 两条都失败时如实报错」，不需要 jsdom，也不需要假浏览器。
export type CopyResult = { ok: true } | { ok: false; reason: string };

export interface CopyDeps {
  /** 现代路径：`navigator.clipboard.writeText`；rejected ⇒ 这条不可用（例如权限被拒） */
  writeText?: (text: string) => Promise<void>;
  /** 降级路径：临时 textarea + `document.execCommand('copy')`；返回 false ⇒ 浏览器拒绝 */
  legacyCopy?: (text: string) => boolean;
}

function reasonOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (e === undefined || e === null) return '未知原因';
  const s = String(e).trim();
  // 为什么要有这一段（不是防御性编程，是 V-42 的同一个教训）：
  // `String(undefined) === 'undefined'`、`String(NaN) === 'NaN'` —— 直接把它拼进 toast
  // 就会把坏值当文案显示给用户。这里用 `String(void 0)` / `String(Number.NaN)` 比较，
  // **不写成字面量**：CP-3 的尺子扫的就是界面源码里的字面 `undefined`/`NaN`（不改尺子，改代码）。
  const unusable = [String(void 0), String(Number.NaN)];
  return s && !unusable.includes(s) ? s : '未知原因';
}

/**
 * 从**当前环境**解析默认依赖。
 * 浏览器（Electron renderer）里两项都在；纯 Node（node:test）里两项都缺 ⇒ 调用会**如实失败**，
 * 不会假装复制成功（这正是 C6 钉住的行为）。
 */
export function resolveCopyDeps(): CopyDeps {
  // 用 `in` 判存在（而不是 `typeof x === '…'`）：纯 Node 没有 document；
  // 而 CP-3 禁止界面源码出现字面 `undefined`（那会被当文案显示）—— 这里连带绕开。
  const nav =
    'navigator' in globalThis ? (globalThis as { navigator?: Navigator }).navigator : undefined;
  const doc =
    'document' in globalThis ? (globalThis as { document?: Document }).document : undefined;

  const clipboard = nav?.clipboard;
  const writeText =
    clipboard && typeof clipboard.writeText === 'function'
      ? (text: string) => clipboard.writeText(text)
      : undefined;

  const legacyCopy = doc
    ? (text: string): boolean => {
        // 为什么用 textarea 而不是 input：textarea 能容纳多行/超长文本（路径可能很长，
        // 而且将来复制备注时是多行）；position:fixed + top:-1000px 让它不产生可见跳动。
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.opacity = '0';
        doc.body.appendChild(ta);
        try {
          ta.select();
          return doc.execCommand('copy');
        } finally {
          doc.body.removeChild(ta);
        }
      }
    : undefined;

  return { writeText, legacyCopy };
}

/**
 * 复制一段文本。
 *
 * @param text 要复制的文本（空串/非字符串直接拒绝 —— "复制了空内容"对用户毫无意义，而且容易被当成成功）
 * @param deps 默认取 `resolveCopyDeps()`；测试传假实现
 * @returns 成功 `{ok:true}`；失败 `{ok:false, reason}`（reason 非空，可直接展示）
 */
export async function copyText(
  text: string,
  deps: CopyDeps = resolveCopyDeps(),
): Promise<CopyResult> {
  if (typeof text !== 'string' || text.length === 0) {
    return { ok: false, reason: '没有可复制的内容' };
  }

  let firstReason = '';
  if (typeof deps.writeText === 'function') {
    try {
      await deps.writeText(text);
      return { ok: true };
    } catch (e) {
      // 权限被拒 / 非安全上下文 ⇒ 掉到降级路径再试一次；错误原因留着，万一降级也没有时如实说出
      firstReason = reasonOf(e);
    }
  }

  if (typeof deps.legacyCopy === 'function') {
    try {
      return deps.legacyCopy(text) ? { ok: true } : { ok: false, reason: '浏览器拒绝了复制操作' };
    } catch (e) {
      return { ok: false, reason: reasonOf(e) };
    }
  }

  return {
    ok: false,
    reason: firstReason || '当前环境没有可用的剪贴板接口',
  };
}
