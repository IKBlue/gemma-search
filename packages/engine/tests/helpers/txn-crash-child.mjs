// packages/engine/tests/helpers/txn-crash-child.mjs —— 「跑到注入点就挂住、等父进程把我杀掉」的子进程
//
// ⚠️ 这个文件的**存在理由**就是规格 §8 那句话：「必须**真的杀进程**，不能只做代码评审」。
//
// 为什么不能"在同一个进程里抛个异常假装被杀"（我第一版就是这么写的，结果被骗了）：
//   抛异常会被调用点的 `catch` 接住 —— 例如 rename 循环的 catch 会把它变成 `RECOVERY_NEEDED`；
//   而**进程真被杀**时日志停在被杀前的那个状态、**没有任何 JS 收尾** ⇒ 恢复才能按 §4 前进。
//   这两者在盘上留下的状态是**不一样**的。
//
// 所以这里 `onCrash` 做两件事：
//   ① 写一个 `boundary` 标记文件（证明"确实杀在这个边界上"，父进程据此马上动手）；
//   ② **挂住不返回**（`setInterval` 空转），让父进程用 kill 终结本进程。
//   绝不 `process.exit()` —— 那会让 `finally`/`exit` 钩子有机会跑，就不是"被杀"了。
//
// 用法：node txn-crash-child.mjs <libRoot> <journalDir> <crashPoint> <markerDir> <srcRel> <dstRel>
import fs from 'node:fs';
import path from 'node:path';

import { createTxnExecutor } from '../../src/transactions/executor.ts';

const [libRoot, journalDir, crashPoint, markerDir, srcRel, dstRel] = process.argv.slice(2);

const boundaryFile = path.join(markerDir, 'boundary.json');
const doneFile = path.join(markerDir, 'done.json');
const indexFile = path.join(markerDir, 'index-called.json');

const src = path.join(libRoot, srcRel);
const dst = path.join(libRoot, dstRel);

const onCrash = (point) => {
  // ① 证明到达了边界（同步写，挂死之前一定落盘）
  fs.writeFileSync(
    boundaryFile,
    JSON.stringify(
      {
        point,
        pid: process.pid,
        at: new Date().toISOString(),
        journalFiles: fs.existsSync(journalDir) ? fs.readdirSync(journalDir) : [],
      },
      null,
      2,
    ),
    'utf8',
  );

  // ② **永不返回** —— 这才是"进程被杀"而不是"抛异常"。
  //
  // ⚠️ 这里踩过两次坑，都不是理论问题：
  //   · 用 `setInterval(()=>{},1000)` **不管用**：它只是让事件循环别空，`onCrash` 本身**照样返回**，
  //     于是 `executor.hit()` 里那句 `throw` 就生效了 ⇒ 子进程**崩溃退出（code 1）**、不是被杀；
  //     而父进程是每 15ms 轮询标记文件的 ⇒ 谁先谁后全看运气，有的用例过、有的不过（实测如此）。
  //   · `process.exit()` 也不行：那会给 `exit` 钩子机会跑收尾，语义上就不是"中途被杀"。
  //   ⇒ 用 `Atomics.wait` **同步挂死主线程**（Node 允许在主线程上这么干，浏览器不允许）。
  //     进程仍然活着、仍然停在那个边界上，等父进程用 kill 终结它。
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};

const ex = createTxnExecutor({
  journalDir,
  indexPort: {
    update: (call) => {
      // 索引端口被调过就要留痕（父进程据此断言"索引更新了 / 没更新"）
      const prev = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
      prev.push({
        at: new Date().toISOString(),
        txnId: call.txnId,
        op: call.op,
        files: call.files.length,
      });
      fs.writeFileSync(indexFile, JSON.stringify(prev, null, 2), 'utf8');
    },
  },
  crashAt: crashPoint,
  onCrash,
});

const r = ex.runMove({
  libId: 'lib-a',
  uid: 'a1',
  op: 'move-folder',
  files: [
    { role: 'image', src, dst },
    { role: 'archive', src: src.replace(/\.[^.]+$/, '.rar'), dst: dst.replace(/\.[^.]+$/, '.rar') },
  ],
});

// 只有**正常跑完**才会写到这 —— 父进程断言它**不存在**，就是"被杀"的最强证据。
fs.writeFileSync(
  doneFile,
  JSON.stringify({ outcome: r.outcome, txnId: r.txnId, detail: r.detail }, null, 2),
  'utf8',
);
