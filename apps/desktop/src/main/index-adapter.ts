// apps/desktop/src/main/index-adapter.ts —— **真实索引构建的唯一适配器**（IDX-2b2）
//
// 职责：把引擎的 `IndexingPorts`（`{ buildIndex, writeIndex }`，见 packages/engine/src/index-ports.ts）
//   接到本仓的两个真实实现上：
//   · `buildIndex` → `packages/indexer` 的 `buildIndex(opts)`（补 `modelDir`/`outDir`：引擎**故意**拿不到这两个路径）；
//   · `writeIndex` → `index-file.writeIndexAtomically(libRoot, bytes)`（**全仓唯一**的索引字节落盘入口，P1）。
//
// 两条硬纪律：
//   ① **库根只写保留命名空间**（SPEC §2.1 / AGENTS §5）⇒ 构建器的副产物（items.json / meta.json）
//      落 `productsRoot` 下的**临时目录**，构建完即删；真正的索引字节只经 `writeIndex` 原子落盘。
//   ② **真实模式不许假装成功**（P6）：模型目录解析不到 ⇒ **明确抛错**（`MODEL_MISSING`），不返回空成功。
//
// 测试钩子（`fake:true`）只给 e2e 用：不依赖 ONNX，按阶段发进度、检查取消、写一份合法的空索引。
//   它**不在产品默认路径上**（默认 `fake:false`），且它的"复用"标记只写 `productsRoot`（不碰库根）。
import fs from 'node:fs';
import path from 'node:path';

import type { IndexingPorts } from '../../../../packages/engine/src/index-ports.ts';
import {
  buildIndex as realBuildIndex,
  buildIndexBinBytes,
} from '../../../../packages/indexer/src/build_index_onnx.ts';

import { writeIndexAtomically } from './index-file.ts';

export interface IndexingAdapterOptions {
  /** 模型目录（"用户指定 → 程序目录 → userData"的唯一解析点在 storage-roots；这里只消费结论） */
  resolveModelDir: () => string | null;
  /** 构建器副产物的根（**必须是临时区**，绝不能是库根：库根只接受保留命名空间） */
  productsRoot: string;
  log?: (...a: unknown[]) => void;
  /** e2e 专用：假构建器（不依赖 ONNX）。**默认 false** —— 产品路径永远是真实构建器 */
  fake?: boolean;
  /** 测试注入（默认 = indexer 的真实 buildIndex） */
  buildIndexImpl?: typeof realBuildIndex;
  /** 测试注入（默认 = index-file.writeIndexAtomically） */
  writeIndexImpl?: (libRoot: string, bytes: Uint8Array) => unknown;
}

/** 假构建器的"已编码行"标记（只在 productsRoot 里；库根不碰） */
function resumeMarker(productsRoot: string, libId: string): string {
  return path.join(productsRoot, 'fake-index-' + libId + '.resume');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 取消错误的形状与 IDX-1 一致（`name` 是引擎的判据） */
function cancelledError(phase: string): Error {
  const e = new Error('构建已取消（阶段 ' + phase + '）');
  e.name = 'BuildCancelledError';
  return e;
}

/**
 * 假构建器（e2e 用）：走与真实构建器**同一条**注入接口（`onProgress`/`signal`/`writeIndex`），
 * 于是 main 侧的接线（job 行、事件转发、原子写）被**真的**走一遍，只是不加载 ONNX。
 */
async function fakeBuild(
  req: Parameters<IndexingPorts['buildIndex']>[0],
  productsRoot: string,
  log: (...a: unknown[]) => void,
): Promise<Awaited<ReturnType<IndexingPorts['buildIndex']>>> {
  const phases = ['scan', 'uid', 'selftest', 'encode', 'persist'];
  const total = 6;
  // "复用"真相来源在真实世界里是构建器读现有索引/已编码行；假构建器用 productsRoot 的标记模拟，
  // 且 `rebuild:true` 时**不复用**（与真实语义一致）。
  // ⚠️ 必须先把目录建出来：假构建器也要写复用标记（真 e2e 第一次跑就是栽在这里 —— ENOENT
  //    被引擎变成 index.failed，症状是"续跑永远完不成"）。
  fs.mkdirSync(productsRoot, { recursive: true });
  const marker = resumeMarker(productsRoot, req.libId);
  const markerThere = fs.existsSync(marker);
  // ⚠️ 复用标记的**判定口径**要在日志里看得见：e2e 曾出现 reused=0 说不清是"没标记"还是"rebuild"
  const reused = !req.rebuild && markerThere ? 2 : 0;
  log(
    '[fake-index] rebuild=' +
      String(req.rebuild) +
      ' marker=' +
      String(markerThere) +
      ' reused=' +
      String(reused),
  );
  // ⚠️ **进循环前**就落复用标记（模拟"已编码行已持久化"）：
  //   e2e 实测踩到 —— 取消是在 `onProgress` 回调里触发的，而引擎的进度包装在 abort 后会**抛**，
  //   于是"循环里写标记"那一行被跳过 ⇒ 续跑永远 reused=0。真构建器也是**边编码边落盘**，同理。
  if (!req.rebuild && !markerThere) fs.writeFileSync(marker, '0', 'utf8');
  let done = reused;
  for (let i = 0; i < phases.length; i++) {
    if (req.signal.aborted) throw cancelledError(phases[i]);
    await sleep(90);
    if (req.signal.aborted) throw cancelledError(phases[i]);
    done = Math.min(total, Math.max(done, Math.round(((i + 1) / phases.length) * total)));
    req.onProgress({
      phase: phases[i],
      done,
      total,
      reused,
      failed: 0,
      ...(reused > 0 ? { message: '复用 ' + String(reused) + ' 条' } : {}),
    });
    // 标记已在进循环前落好（见上面那段：abort 后 `onProgress` 会抛，循环里的写入会被跳过）。
  }
  const dim = 768;
  const count = 2;
  const vectors = new Float32Array(count * dim);
  req.writeIndex({
    bytes: buildIndexBinBytes(
      { dim, count, compat: 'fake-index', built_at: new Date(0).toISOString() },
      vectors,
      count,
      dim,
    ),
  });
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, String(reused), 'utf8');
  return {
    total,
    encoded: Math.max(0, total - reused),
    failed: 0,
    reused,
    dim,
    compat: 'fake-index',
  };
}

/**
 * 组装注入端口。⚠️ `writeIndex` 是**全仓唯一**调用 `writeIndexAtomically` 的地方（源码扫描断言钉住）。
 */
export function createIndexingPorts(opts: IndexingAdapterOptions): IndexingPorts {
  const log = opts.log ?? (() => {});
  const writeImpl =
    opts.writeIndexImpl ??
    ((libRoot: string, bytes: Uint8Array) => writeIndexAtomically(libRoot, bytes));

  return {
    async buildIndex(req) {
      if (opts.fake === true) return fakeBuild(req, opts.productsRoot, log);
      const modelDir = opts.resolveModelDir();
      if (!modelDir) {
        // P6：真实模式没有模型 ⇒ **明确失败**（引擎会把它变成 index.failed + 终态 failed）
        const e = new Error(
          '模型文件缺失：没有可用的模型目录（先用设置指定，或放到程序目录 models/）',
        );
        (e as Error & { code?: string }).code = 'MODEL_MISSING';
        throw e;
      }
      const impl = opts.buildIndexImpl ?? realBuildIndex;
      fs.mkdirSync(opts.productsRoot, { recursive: true });
      // 副产物（items.json / meta.json）进**临时目录**：库根只允许保留命名空间（P4）
      const outDir = fs.mkdtempSync(path.join(opts.productsRoot, 'idx-build-'));
      try {
        const s = await impl({
          modelDir,
          libRoot: req.libRoot,
          outDir,
          libId: req.libId,
          device: req.device,
          seq: req.seq,
          rebuild: req.rebuild,
          signal: req.signal,
          onProgress: (p) => {
            req.onProgress({
              phase: p.phase,
              done: p.done,
              total: p.total,
              reused: p.reused,
              failed: p.failed,
            });
          },
          // 构建器的写者注入点：**只把 bytes 交回引擎绑好的写者**（libRoot 由引擎补）
          writeIndex: (input) => {
            req.writeIndex({ bytes: input.bytes });
          },
        });
        return {
          total: s.scanned,
          encoded: s.ok,
          failed: s.failed,
          reused: s.reused,
          dim: s.dim,
          compat: s.compat,
        };
      } finally {
        // 副产物不留在盘上：它们不是真相来源（真相 = 素材 + 索引文件 + journal）
        try {
          fs.rmSync(outDir, { recursive: true, force: true });
        } catch (e) {
          log('[索引] 清理构建临时目录失败（不影响索引本身）:', String(e));
        }
      }
    },
    writeIndex(input) {
      writeImpl(input.libRoot, input.bytes);
    },
  };
}
