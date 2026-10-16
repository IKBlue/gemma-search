// apps/desktop/src/main/dialog-paths.ts —— 「绝对路径从哪来」的闸门（SEC-1 · 纵深防御第二道）
//
// ── 事实（第三份审查 S4 指出、Lead 核实）──────────────────────────────────────
//   契约里**有三处**接受渲染层传来的绝对路径：`search.queryImagePath`（只读 + 引擎侧扩展名白名单）、
//   `libraryAdd.root` 与 `collectDirAdd.absPath`（**两个写入口**）；而 `shared/ipc.ts` 的注释一度写成
//   「渲染进程传不进任何绝对路径」（旧措辞·已作废）⇒ **声明与实现不符**。
//   本模块管的是**两个写入口**这半边：`libraryAdd.root` 收紧到能兑现那句话；
//   `collectDirAdd.absPath` 退到「存在且是目录」并**如实标注缺口**。
//   "声明"那半边（三处例外 + 缓解）在同一批里改到 `shared/ipc.ts` 的文件头。
//
// ── 第一道防线是什么（本模块**不是**唯一防线，别误解）────────────────────────
//   `isTrustedSender`（只认自家窗口的 frame）+ 严格 CSP + 不加载任何远程内容 + zod `.strict()` 形状。
//   本模块是**第二道**：即便渲染层被 XSS 拿下，也只能登记「用户刚刚亲手选过」的目录。
//
// ── 口径（两条，别混）────────────────────────────────────────────────────────
//   · `libraryAdd.root`：必须与**本次会话里系统对话框真的返回过**的目录对账。
//     选择器就是 `libraryPickDir`（主进程弹 dialog）⇒ 它的返回值在这里 `rememberPicked`。
//     ⚠️ 刻意**不重弹一次对话框**：那是改交互（用户会看到两次选择框），而这里要防的是
//       「路径凭空出现」，不是「用户改主意」。也刻意**不落盘**：集合活在进程内 ——
//       重启后要再登记同一个目录就重新选一次（选择器就在旁边），这是刻意的，不是遗漏。
//     ⚠️ **存在不等于合法**：一个真实存在、但不是对话框选出来的目录（例如 `C:\Windows`）
//       一样被拒 —— 这正是"对账"相对"校验存在性"多出来的那部分。
//   · `collectDirAdd.absPath`：契约里**没有**对应的系统选择器（没有 `collectPickDir`）
//     ⇒ 拿不到"对话框来源"这个证据，只能退到第二条：**存在且是目录**。
//     这是**已知缺口**，写在这里而不是假装防住了。将来加选择器时，把它的返回值也喂进
//     `rememberPicked`，再把 `checkCollectDir` 换成与 `checkLibraryRoot` 同一条对账。
//
// ── 复用（P1：不写第二份判据）────────────────────────────────────────────────
//   · 规范化 ← `app-db.ts` 的 `normalizeRootPath`（Windows 真实大小写 / 长名 / 无尾分隔符，唯一实现）
//   · 「能不能用」← `library-availability.ts` 的 `classifyRootSync`（U18 的三种原因：不存在 / 不是目录 / 不可访问）
//
// ⚠️ 本模块 **import 不了 electron 的东西**，也不碰 fs 之外的进程状态 ⇒ `node:test` 能直接加载。
import { normalizeRootPath } from './app-db.ts';
import { classifyRootSync } from './library-availability.ts';
import type { RootAvailability } from './library-availability.ts';

/** 闸门失败时直接返回的信封（形状与其它 IPC 分支一致 ⇒ 调用点 `return gate` 就行） */
export interface GateRejection {
  ok: false;
  error: {
    code: 'BAD_REQUEST';
    message: string;
    userMessage: string;
    details: Record<string, unknown>;
  };
}

export type GateResult = { ok: true; normalized: string } | GateRejection;

/** 失败码的粒度（机器可读，别让调用方去解析中文）：写进 `details.reason` */
export type GateReason = 'empty-path' | 'not-from-dialog' | 'not-a-usable-directory';

export interface DialogPathGateDeps {
  /** 规范化（默认真实实现；注入只为单测可控） */
  normalize?: (p: string) => string;
  /** 「能不能用」判据（默认真实实现；注入只为单测可控） */
  classify?: (p: string) => RootAvailability;
}

export interface DialogPathGate {
  /** 记下系统对话框**真的返回过**的目录；返回规范形（便于日志/测试断言） */
  rememberPicked(dir: string): string;
  /** 记过几个（诊断/测试用；不暴露集合本身，避免调用方自己去查） */
  pickedCount(): number;
  /** `libraryAdd.root` 的闸门：只做**来源对账**；可用性由 index.ts 的 classifyRootSync 继续管（不重复） */
  checkLibraryRoot(root: string): GateResult;
  /** `collectDirAdd.absPath` 的闸门：没有选择器 ⇒ 只能校验**存在且是目录**（已知缺口，见文件头） */
  checkCollectDir(absPath: string): GateResult;
}

function rejection(
  reason: GateReason,
  message: string,
  userMessage: string,
  details: Record<string, unknown>,
): GateRejection {
  return {
    ok: false,
    error: { code: 'BAD_REQUEST', message, userMessage, details: { ...details, reason } },
  };
}

export function createDialogPathGate(deps: DialogPathGateDeps = {}): DialogPathGate {
  const normalize = deps.normalize ?? ((p: string): string => normalizeRootPath(p));
  const classify = deps.classify ?? ((p: string): RootAvailability => classifyRootSync(p));
  /** 集合的键 = 规范形；Windows 大小写不敏感 ⇒ 再折一次小写（realpath 通常已统一，这是兜底） */
  const keyOf = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p);
  const picked = new Set<string>();

  const tryNormalize = (raw: unknown): { ok: true; normalized: string } | null => {
    const s = typeof raw === 'string' ? raw : '';
    if (!s.trim()) return null;
    try {
      const n = normalize(s);
      return n.trim() ? { ok: true, normalized: n } : null;
    } catch {
      // normalizeRootPath 对空串会抛 ⇒ 这里翻成"拒绝"，绝不把异常抛给 IPC 分派
      return null;
    }
  };

  return {
    rememberPicked(dir: string): string {
      const n = tryNormalize(dir);
      if (n === null) {
        // 选择器给了空路径 = 调用方的 bug，不假装记住了（也就不会成为"合法来源"）
        return '';
      }
      picked.add(keyOf(n.normalized));
      return n.normalized;
    },

    pickedCount(): number {
      return picked.size;
    },

    checkLibraryRoot(root: string): GateResult {
      const n = tryNormalize(root);
      if (n === null) {
        return rejection(
          'empty-path',
          'libraryAdd.root 为空或无法规范化',
          '这个目录路径是空的，请重新选择。',
          { root: String(root ?? '') },
        );
      }
      if (!picked.has(keyOf(n.normalized))) {
        // ⚠️ 关键：**先判来源，再谈别的** —— 存在且是目录也救不了"不是对话框选的"。
        return rejection(
          'not-from-dialog',
          'libraryAdd.root 不是本次会话里由系统对话框选出的目录：' + n.normalized,
          '出于安全策略，只能登记你刚才在「选择文件夹」里亲手选过的目录。请重新选一次。',
          { root: n.normalized, picked: picked.size },
        );
      }
      return { ok: true, normalized: n.normalized };
    },

    checkCollectDir(absPath: string): GateResult {
      const n = tryNormalize(absPath);
      if (n === null) {
        return rejection(
          'empty-path',
          'collectDirAdd.absPath 为空或无法规范化',
          '这个目录路径是空的，请重新填写。',
          { absPath: String(absPath ?? '') },
        );
      }
      const a = classify(n.normalized);
      if (!a.available) {
        // 三种原因如实分开（不存在 / 不是目录 / 不可访问）—— 复用 U18 的唯一判据与文案
        return rejection(
          'not-a-usable-directory',
          'collectDirAdd.absPath 不是一个可用的目录：' + a.reason + '（' + n.normalized + '）',
          a.code === 'not-found'
            ? '这个取件目录不存在（盘没挂载或目录被删了）。'
            : a.code === 'not-a-directory'
              ? '这个路径不是文件夹。请选一个目录。'
              : '这个目录访问不了（权限或网络问题）。',
          { absPath: n.normalized, availability: a.code },
        );
      }
      return { ok: true, normalized: n.normalized };
    },
  };
}
