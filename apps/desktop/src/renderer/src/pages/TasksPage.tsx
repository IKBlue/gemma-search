// pages/TasksPage.tsx —— 索引任务：**开始 / 取消 / 续跑 / 进度**（IDX-3）
//
// ⚠️ 2026-10-17 · IDX-3：**不再是诚实态了**。旧注释说「契约里已经没有 indexStart / indexCancel /
//   indexResume」——**已过期**：U35 已把三个方法恢复登记（shared/ipc.ts），IDX-2a/2b 接了真实实现，
//   真窗口 e2e 已能 start → 进度 → cancel（停在边界、索引文件不出现）→ resume（reused>0）→ 索引文件出现。
//   ⇒ 本页的职责是让用户**点得到、看得见**。
//
// ⚠️ 外壳（AppShell + SearchSidebar + Topbar + 返回搜索链接）**必须保留**：
//   实测（S6 全量 e2e）—— 第一版把整页换成一段裸文本，侧栏就此消失，
//   于是 a11y E5-b / uiux E12-e / routing E2-e / E6-b 全红。页面改内容，外壳不许动。
//
// ── 三个**容易糊过去**的点（都在本文件/useIndexTasks 里落成注释）────────────────
//   ① indexStart 返回的 total 是 **0（未知）** ⇒ 总数以**首条 progress** 为准，别显示 0 再跳变；
//   ② 无任务时 indexCancel 返回 {cancelled:false} 是**诚实结果**，不是失败（这里如实说一句）；
//   ③ 「重新编码这一条」在 item-actions 里**保持禁用** —— 契约里只有**整库** indexStart。
import { Link } from 'react-router';

import AppShell from '../layout/AppShell.tsx';
import Main from '../layout/Main.tsx';
import PageHead from '../layout/PageHead.tsx';
import Topbar from '../layout/Topbar.tsx';
import Button from '../ui/Button.tsx';
import SearchSidebar from '../search/SearchSidebar.tsx';
import { LABELS } from '../router/paths.ts';
import { useDocumentTitle } from '../utils/useDocumentTitle.ts';
import useLibraryConfig from '../hooks/useLibraryConfig.ts';
import { resolveLibrary } from '../utils/library-root.ts';
import useToast from '../hooks/useToast.ts';
import useIndexTasks from '../hooks/useIndexTasks.ts';
import {
  etaText,
  phaseLabel,
  progressPercent,
  outcomeSummary,
  useTaskStore,
} from '../store/tasks.ts';

export default function TasksPage() {
  useDocumentTitle(LABELS.tasks);

  // 库从哪来：唯一来源是主进程的 libraryList（与 LibraryGate 同一条路，不另开一份）
  const { data: configData, loading: configLoading } = useLibraryConfig();
  const lib = resolveLibrary(configData);
  const libId = lib?.libId ?? '';
  const { show } = useToast();
  const { start, cancel, resume, error } = useIndexTasks(show);

  const running = useTaskStore((s) => s.running);
  const phase = useTaskStore((s) => s.phase);
  const done = useTaskStore((s) => s.done);
  const total = useTaskStore((s) => s.total);
  const ratePerSec = useTaskStore((s) => s.ratePerSec);
  const etaSec = useTaskStore((s) => s.etaSec);
  const deviceFallback = useTaskStore((s) => s.deviceFallback);
  const resumeNote = useTaskStore((s) => s.resumeNote);
  const failed = useTaskStore((s) => s.failed);
  const outcome = useTaskStore((s) => s.outcome);

  const percent = progressPercent({ done, total });
  const summary = outcomeSummary({ outcome });
  const cancelled = Boolean(outcome && outcome.cancelled);

  return (
    <AppShell sidebar={<SearchSidebar lib={null} indexLoading={false} indexError={null} />}>
      <Main>
        <Topbar
          crumb={
            <>
              工作区 <span className="crumb-sep">/</span> <strong>索引任务</strong>
            </>
          }
          actions={
            <Button variant="icon" asChild>
              <Link to="/" aria-label="返回搜索" title="返回搜索">
                ←
              </Link>
            </Button>
          }
        />

        <div className="content">
          <PageHead
            eyebrow="TASKS"
            title={LABELS.tasks}
            subtitle="索引整库：开始后可取消（会停在边界，不会留下半个索引文件），之后再续跑。"
          />

          <div className="panel" data-testid="tasks-panel">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                data-action="index-start"
                data-testid="tasks-start"
                disabled={running || !libId}
                title={
                  libId ? '开始索引当前库' : configLoading ? '正在读取库配置…' : '还没有可索引的库'
                }
                onClick={() => void start(libId)}
              >
                开始索引
              </Button>
              <Button
                size="sm"
                data-action="index-cancel"
                data-testid="tasks-cancel"
                disabled={!running}
                title={running ? '取消当前任务（停在边界）' : '当前没有正在运行的任务'}
                onClick={() => void cancel()}
              >
                取消
              </Button>
              <Button
                size="sm"
                data-action="index-resume"
                data-testid="tasks-resume"
                disabled={running || !libId}
                title="续跑（能复用的会被复用，复用条数在完成摘要里）"
                onClick={() => void resume(libId)}
              >
                续跑
              </Button>
              {lib ? <span className="muted small">{'库 ' + lib.libId}</span> : null}
            </div>

            {/* ── 进度 ─────────────────────────────────────────────────── */}
            <div className="mt-3" data-testid="tasks-progress">
              <div className="text-caption text-ink">
                <span>{running ? '进行中' : '空闲'}</span>
                {phase ? <span className="muted">{' · ' + phaseLabel(phase)}</span> : null}
                {' · '}
                <span data-testid="tasks-count">
                  {/* total=0 表示未知（indexStart 的 total 恒为 0）⇒ 只说已处理，不假装有分母 */}
                  {total ? done + '/' + total : '已处理 ' + done}
                </span>
                {percent === null ? null : (
                  <span data-testid="tasks-percent">{' · ' + percent + '%'}</span>
                )}
                {ratePerSec ? (
                  <span className="muted">{' · ' + ratePerSec.toFixed(1) + ' 条/秒'}</span>
                ) : null}
                {' · '}
                {/* ⚠️ ETA 只显示**引擎给出的**那个值（index.progress.etaSec），界面**不自己外推**：
                    速率抖动时自算的 ETA 会每秒跳，那是**假精确**；引擎没给（样本还不够）就**整段不显示**，
                    而不是显示一个猜的数字或「预计 —」。见 store/tasks.ts 的 etaText()。 */}
                {Number.isFinite(Number(etaSec)) ? (
                  <span className="muted">{'预计 ' + etaText({ etaSec })}</span>
                ) : null}
              </div>
              {percent === null ? null : (
                <div
                  className="mt-1 h-2 w-full rounded bg-line"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="h-2 rounded bg-accent" style={{ width: percent + '%' }} />
                </div>
              )}
            </div>

            {/* GPU 回退**不静默**（契约 §3 要求界面必须显示） */}
            {deviceFallback ? (
              <p className="tone-warn small mt-2" data-testid="tasks-device-fallback">
                {'注意：本任务发生过设备回退 ' + JSON.stringify(deviceFallback)}
              </p>
            ) : null}
            {resumeNote ? (
              <p className="muted small mt-2" data-testid="tasks-resume-note">
                {String(resumeNote)}
              </p>
            ) : null}

            {/* 终态：完成 / 已取消 / 失败 */}
            {outcome ? (
              <div className="mt-2 text-caption" data-testid="tasks-outcome">
                {outcome.error ? (
                  <p className="err">
                    索引失败：
                    {String(
                      (outcome.error as { userMessage?: string }).userMessage ?? '引擎没给原因',
                    )}
                  </p>
                ) : cancelled ? (
                  <p className="tone-warn">已取消（停在 ' + done + ' 条；索引文件未写入）</p>
                ) : null}
                {summary ? (
                  <p className="text-ink">
                    {'完成：复用 ' +
                      summary.reused +
                      ' · 新编码 ' +
                      summary.encoded +
                      ' · 失败 ' +
                      summary.failed}
                  </p>
                ) : null}
                {failed.length ? (
                  <ul className="muted small mt-1">
                    {failed.slice(0, 5).map((f, i) => (
                      <li key={i}>
                        {String((f as { relPath?: string }).relPath ?? JSON.stringify(f))}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="err small mt-2" data-testid="tasks-error">
                {error.userMessage}
              </p>
            ) : null}
          </div>
        </div>
      </Main>
    </AppShell>
  );
}
