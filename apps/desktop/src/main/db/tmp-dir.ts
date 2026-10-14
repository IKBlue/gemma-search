// apps/desktop/src/main/db/tmp-dir.ts —— 把**进程临时目录**指到一个应用自有、可写的位置（T-42）
//
// ── 为什么需要（实测的根因，不是猜的）────────────────────────────────────────
//   `importItemsFromJson` 在**写入阶段**（BEGIN IMMEDIATE + 3594 行 upsert + 幽灵行 DELETE）会让 SQLite
//   需要临时文件。临时目录不可写时，SQLite 报的是 **"unable to open database file"**（SQLITE_CANTOPEN），
//   整条导入回滚成 `IMPORT_FAILED` —— 用户看到的是"重建失败"。
//
//   ⚠️ 到底认哪个环境变量（本机实测，**四组对照**，同一份代码只改 env）：
//     A) TEMP=可写 TMP=不可写                      ⇒ **失败**   ← 说明它**不**回退到 TEMP
//     B) TEMP=不可写 TMP=可写                      ⇒ 成功
//     C) TEMP=不可写 TMP=不可写 SQLITE_TMPDIR=可写 ⇒ **失败**   ← **SQLITE_TMPDIR 被忽略**（node:sqlite 这个构建）
//     D) TEMP=不可写 TMP=不可写                    ⇒ 失败（对照组）
//   ⇒ 这个构建看的是 **TMP**（Windows 上），而且**不会**从不可用的 TMP 回退到 TEMP。
//     所以只设 SQLITE_TMPDIR 是**没用的**（我第一版就是这么写的，被 ST3 抓出来）。
//
// ── 怎么修 ──────────────────────────────────────────────────────────────────
//   把 TMP / TEMP / TMPDIR / SQLITE_TMPDIR **一起**指到 `<userData>/tmp`（都指向同一个应用自有目录：
//   Windows 看 TMP，POSIX 看 TMPDIR，将来 SQLite 版本认 SQLITE_TMPDIR 时直接生效）。
//   ⚠️ 这是**进程级**改动：Chromium 早已初始化完自己的临时目录（不受影响），
//      而本应用自己的临时写入从"系统 TEMP"变成"应用私有目录" —— 只会更可控。
//   显式覆盖 `GEMMA_TEMP_DIR` 优先（运维/测试可指到别处，也能故意指到不可用位置来复现）。
//   建目录失败就**大声记日志并保持原样**（不假装成功；那时 SQLite 仍用系统临时目录，行为与今天一致）。
import fs from 'node:fs';
import path from 'node:path';

import { log } from '../log.ts';

/** 显式覆盖（运维/测试用；指到不可用位置可复现"导入写不进去"的失败路径） */
export const TEMP_DIR_OVERRIDE = 'GEMMA_TEMP_DIR';

/** 会被设置的四个环境变量（一次设全，别再出现"只设了一个、另一个才是真正被读的"这种事） */
export const TEMP_ENV_KEYS: readonly string[] = ['TMP', 'TEMP', 'TMPDIR', 'SQLITE_TMPDIR'];

export interface TempDirResult {
  /** 最终生效的目录；null = 没有改动环境（沿用系统临时目录） */
  dir: string | null;
  /** 人读：为什么是这个结果（日志可直接用） */
  why: string;
}

/** 幂等：重复调用只是再写一遍同一批 env */
function applyTempDir(dir: string): void {
  for (const k of TEMP_ENV_KEYS) process.env[k] = dir;
}

/**
 * 配置**进程临时目录**。必须在任何 SQLite 写入之前调用（Electron 侧在 app ready 后立刻调，见 index.ts）。
 * ⚠️ node:test 可以直接调它（不 import electron）—— 这就是它单独成文件的原因。
 */
export function configureProcessTempDir(userDataDir: string | null): TempDirResult {
  const override = (process.env[TEMP_DIR_OVERRIDE] ?? '').trim();
  if (override) {
    try {
      fs.mkdirSync(override, { recursive: true });
      applyTempDir(override);
      log('[temp] 进程临时目录 =', override, '（来源：', TEMP_DIR_OVERRIDE, '显式覆盖）· keys =', TEMP_ENV_KEYS.join('/'));
      return { dir: override, why: TEMP_DIR_OVERRIDE + ' 显式覆盖：' + override };
    } catch (e) {
      // 显式指定却建不出来：**不吞**。保持环境原样 —— 让失败在原来的地方响。
      log('!! [temp] ' + TEMP_DIR_OVERRIDE + ' 指定的目录不可用（保持系统临时目录）：', override,
          '·', e instanceof Error ? e.message : String(e));
      return { dir: null, why: TEMP_DIR_OVERRIDE + ' 不可用：' + override };
    }
  }

  const base = typeof userDataDir === 'string' ? userDataDir.trim() : '';
  if (!base) {
    log('[temp] 未配置临时目录（userData 未知）——沿用系统临时目录；若它不可写，元数据导入会以 IMPORT_FAILED 失败');
    return { dir: null, why: 'userData 未知 ⇒ 沿用系统临时目录' };
  }

  const dir = path.join(base, 'tmp');
  try {
    fs.mkdirSync(dir, { recursive: true });
    applyTempDir(dir);
    log('[temp] 进程临时目录 =', dir, '（应用私有：系统 TEMP/TMP 不可写时导入才不会莫名失败）· keys =', TEMP_ENV_KEYS.join('/'));
    return { dir, why: 'userData/tmp：' + dir };
  } catch (e) {
    log('!! [temp] 临时目录创建失败（保持系统临时目录）：', dir, '·', e instanceof Error ? e.message : String(e));
    return { dir: null, why: '创建失败：' + dir };
  }
}
