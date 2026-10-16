// DiagnosticsPage —— 诊断页：库体检结论 + 一键重建元数据（T-15b · 2026-10-15）
//
// ── 这个页面存在的理由（SPEC A11「用户能自救」）────────────────────────────
//   T-15a 把两条 IPC 接好了（`libraryHealth` 只读体检 · `libraryRebuild` 删 .gs.db 家族重建），
//   但**用户点不到**。差的就是这一层界面：库坏了的时候，用户要能自己看清「坏在哪、点了会发生什么」。
//
// ── 它**不做**的三件事（都是刻意的）─────────────────────────────────────────
//   ① **不自算健康度**：`ok` / `needsDbRebuild` / `needsIndexRebuild` 全部由主进程给（契约），
//      界面只做两个映射：显示名（`store/health.ts` 的 `checkLabel`）与分组。
//   ② **不编进度**：契约不发事件 ⇒ 重建期间只能显示忙碌态「正在重建元数据…」并禁用按钮；
//      编一个百分比就是谎报（同 `store/tasks.ts` 对未知 total 的处理）。
//   ③ **不写第二份文案**：坏项的「为什么」直接渲染主进程给的 `reason`（人话），
//      失败弹的是 Adapter 归一后的 `userMessage`；界面里**没有**任何兜底句子（L6 会抓）。
//
// ── 破坏性操作两段式（AGENTS §5.3）─────────────────────────────────────────
//   「重建元数据」按钮**不直接执行**：它只调 `requestRebuild`（把请求记进 store）⇒ 弹 `ConfirmDialog`。
//   取消 ⇒ `cancelRebuild`（**一个 IPC 都不发**）；确认 ⇒ `confirmRebuild`（先清状态再发）。
import { useCallback, useEffect } from 'react';
import { Link } from 'react-router';

import AppShell from '../layout/AppShell.tsx';
import Main from '../layout/Main.tsx';
import PageHead from '../layout/PageHead.tsx';
import Topbar from '../layout/Topbar.tsx';
import Button from '../ui/Button.tsx';
import ConfirmDialog from '../ui/ConfirmDialog.tsx';
import Toast from '../ui/Toast.tsx';
import SearchSidebar from '../search/SearchSidebar.tsx';
import { LABELS } from '../router/paths.ts';
import { useDocumentTitle } from '../utils/useDocumentTitle.ts';
import { resolveLibrary } from '../utils/library-root.ts';
import useLibraryConfig from '../hooks/useLibraryConfig.ts';
import useToast from '../hooks/useToast.ts';
import AppHealthPanel from './AppHealthPanel.tsx';
import { useHealthStore, checkLabel, decideRebuildGate, rebuildSummary } from '../store/health.ts';
import type { HealthCheck, LibraryHealthReport, RebuildReport } from '../store/health.ts';

/** 一项体检结论。**只渲染主进程给的三样**：ok / code / reason */
function CheckRow({ check }: { check: HealthCheck }) {
  return (
    <li
      className="border-b border-line py-2 last:border-b-0"
      data-check={check.id}
      data-ok={check.ok ? 'yes' : 'no'}
      data-code={check.code || undefined}
    >
      <div className="flex items-center gap-2 text-caption">
        <span className={check.ok ? 'tone-ok' : 'tone-err'} aria-hidden="true">
          {check.ok ? '✓' : '✕'}
        </span>
        <span className="text-ink">{checkLabel(check.id)}</span>
        <span className="mono muted">{check.id}</span>
        {check.code ? <span className="tone-err mono">{check.code}</span> : null}
      </div>
      {/* 人话理由**原样**显示（主进程保证 ok 时也非空）—— 界面不摘要、不改写 */}
      <p className="muted small break-all">{check.reason}</p>
      {!check.ok ? (
        <p className="small muted">
          {check.rebuildable
            ? '这一项可以由「重建元数据」修好'
            : '这一项重建元数据修不好（需要重新建索引）'}
        </p>
      ) : null}
    </li>
  );
}

/**
 * 结论徽标：**只说它真正测的东西**。
 *
 * ⚠️ 徽标量的是 `report.ok` = **检查项**是否全过；孤包（orphanArchive）是**信息**不是失败项
 *   ⇒ 有孤包时**并列**显示中性提示，不换失败样式、也**不进 bad 计数**（U12 · Lead 2026-10-16 裁定）。
 *   旧文案是笼统的「全部通过」—— 标签说得比它测的多：一个带 60 个孤包的库会顶着「全部通过」。
 */
function HealthBadge({ report }: { report: LibraryHealthReport }) {
  const bad = report.checks.filter((c) => !c.ok).length;
  const orphans = report.orphanArchive.count;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="tag" data-health={report.ok ? 'ok' : 'bad'}>
        {report.ok ? '检查项全部通过' : '有问题 ' + String(bad) + ' 项'}
      </span>
      {orphans > 0 ? (
        <span className="tag muted" data-orphan-badge={String(orphans)}>
          {'· 另有 ' + String(orphans) + ' 个孤包'}
        </span>
      ) : null}
    </span>
  );
}

/** 重建报告：删了什么 / schema / 导入了多少 / 索引保留了还是重写了 */
function RebuildReportView({ report }: { report: RebuildReport }) {
  const schema = report.schema;
  return (
    <div className="panel mt-4" data-testid="rebuild-report">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-semibold text-ink">重建报告</span>
        <span className={report.ok ? 'tone-ok' : 'tone-err'} data-testid="rebuild-ok">
          {report.ok ? '复检通过' : '复检仍有问题'}
        </span>
      </div>
      {/* 主进程的 reason 已经是一句人话总结，原样显示 */}
      <p className="muted small break-all" data-testid="rebuild-reason">
        {report.reason}
      </p>
      <p className="text-caption text-ink break-all" data-testid="rebuild-summary">
        {rebuildSummary(report)}
      </p>
      <ul className="mt-2 text-caption text-ink-muted">
        <li>
          删掉的 .gs.db 文件：
          {report.removedDbFiles.length ? report.removedDbFiles.join('、') : '（没有需要删的）'}
        </li>
        <li>.gs.db 是本次新建的：{report.created ? '是' : '否'}</li>
        <li>
          schema：v{String(schema?.fromVersion ?? '—')} → v{String(schema?.toVersion ?? '—')}
        </li>
        <li>
          索引处置：{report.index?.action ?? '—'}（{report.index?.detail ?? '无说明'}）
        </li>
        <li>
          元数据（db-*）检查：{report.dbOk ? '通过' : '未通过'} · 索引检查：
          {report.indexOk ? '通过' : '未通过'}
        </li>
      </ul>
    </div>
  );
}

export default function DiagnosticsPage() {
  useDocumentTitle(LABELS.health);
  const {
    data: configData,
    loading: configLoading,
    error: configError,
    refresh,
  } = useLibraryConfig();
  const { message, tone, show } = useToast();
  const {
    phase,
    report,
    error,
    rebuildPhase,
    pendingRebuild,
    reportAfterRebuild,
    rebuildError,
    run,
    requestRebuild,
    cancelRebuild,
    confirmRebuild,
  } = useHealthStore();

  // 库从哪来：唯一来源是主进程的 libraryConfig（与 LibraryGate 同一条路，不另开一份）
  const lib = resolveLibrary(configData);
  const libId = lib?.libId ?? '';

  // ⚠️ **不自动体检**：跑一次要读索引 + 只读开 .gs.db（大库上是重活），
  //    用户没要求时不该发生 —— 同 ItemPage 的「检查变更」（**既有设计态度**：用户没要求时不自动动它）。
  const onCheck = useCallback(() => {
    if (!libId) {
      show('还没有可体检的库', 'err');
      return;
    }
    void run(libId, show);
  }, [libId, run, show]);

  const gate = decideRebuildGate({ report, rebuildPhase });
  const busy = rebuildPhase === 'running';

  // 让「正在重建元数据」在窗口标题上也看得见（切走后回来仍然知道它在跑）
  useEffect(() => {
    if (!busy) return;
    const prev = document.title;
    document.title = '正在重建元数据… · ' + prev;
    return () => {
      document.title = prev;
    };
  }, [busy]);

  return (
    <>
      <AppShell sidebar={<SearchSidebar lib={null} indexLoading={false} indexError={null} />}>
        <Main>
          <Topbar
            crumb={
              <>
                工作区 <span className="crumb-sep">/</span> <strong>诊断</strong>
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
              eyebrow="DIAGNOSTICS"
              title="诊断与重建"
              subtitle="体检只读：它读索引、只读打开元数据，不会改任何文件。重建元数据会删掉 .gs.db 家族并重新导入 —— 素材目录一个字都不动。"
              actions={
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={onCheck}
                    disabled={phase === 'checking' || !libId}
                    data-action="health"
                  >
                    {phase === 'checking' ? '正在体检…' : '运行体检'}
                  </Button>
                  <Button size="sm" onClick={refresh} disabled={configLoading}>
                    重新读取库配置
                  </Button>
                </div>
              }
            />

            {/* ── 当前库（体检/重建都只对它生效）──────────────────────── */}
            <div className="panel" data-testid="diagnostics-library">
              <div className="mb-1 font-semibold text-ink">当前库</div>
              {lib ? (
                <div className="text-caption text-ink">
                  <div>
                    <span className="mono">{lib.libId}</span>
                    <span className="muted"> · </span>
                    <span className="mono break-all">{lib.root || '（库根未知）'}</span>
                    {lib.available ? null : (
                      <span className="err" data-testid="diagnostics-library-unavailable-badge">
                        {' '}
                        · 不可用
                      </span>
                    )}
                  </div>
                  {/* U18：诊断页是用户"出事时"会来看的地方 ⇒ 原因写在这里，别让他去翻日志 */}
                  {lib.available ? null : (
                    <p className="err small mt-1" data-testid="diagnostics-library-unavailable">
                      {lib.unavailableReason || '库根不可访问'}
                      。库的登记没有被改动，也不会自动清理或重建。
                    </p>
                  )}
                </div>
              ) : (
                <p className="muted small">
                  {configLoading
                    ? '正在读取库配置…'
                    : '还没有可体检的库（先去首启向导添加一个素材库）。'}
                </p>
              )}
              {configError && !configLoading ? (
                <p className="err small mt-2" data-testid="diagnostics-config-error">
                  {configError}
                </p>
              ) : null}
            </div>

            {/* ── 重建：破坏性操作，两段式 ─────────────────────────────── */}
            <div className="panel mt-4" data-testid="rebuild-panel">
              <div className="mb-1 font-semibold text-ink">重建元数据</div>
              <p className="muted small">
                会删掉库根里的 .gs.db 家族（.gs.db / -wal / -shm / -journal）并从 items.json
                重新导入；
                <strong>不会碰素材目录</strong>，也不会重建索引。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  onClick={() => requestRebuild(libId)}
                  disabled={!gate.allowed || !libId}
                  title={gate.allowed ? '先弹确认框，确认后才真的执行' : gate.reason}
                  data-action="rebuild"
                >
                  重建元数据…
                </Button>
                {/* 忙碌态：**不许装作没事**（SPEC §2.3）。契约不发事件 ⇒ 只有这一句，没有百分比 */}
                {busy ? (
                  <span className="tone-warn small" role="status" data-testid="rebuild-busy">
                    正在重建元数据…（跑完会自动复检一次）
                  </span>
                ) : null}
                {!busy && !gate.allowed && libId ? (
                  <span className="muted small" data-testid="rebuild-gate">
                    {gate.reason}
                  </span>
                ) : null}
              </div>
            </div>

            {/* ── 体检结论 ─────────────────────────────────────────────── */}
            <div className="mt-4">
              {phase === 'checking' ? (
                <div className="panel">
                  <p className="muted small">正在体检…</p>
                </div>
              ) : null}
              {phase === 'error' && error ? (
                <div className="panel" role="alert" data-testid="health-error">
                  <p className="err">{error.userMessage}</p>
                  {error.code ? <p className="mono muted small">{error.code}</p> : null}
                </div>
              ) : null}
              {phase === 'idle' ? (
                <div className="panel" data-testid="health-idle">
                  <p className="muted small">
                    还没有跑过体检。点右上角「运行体检」看这个库现在是不是好的。
                  </p>
                </div>
              ) : null}
              {phase === 'ready' && report ? (
                <div
                  className="panel"
                  data-testid="health-report"
                  data-health-ok={report.ok ? 'yes' : 'no'}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <HealthBadge report={report} />
                    <span className="mono muted small break-all">
                      {report.root || '（库根未知）'}
                    </span>
                  </div>
                  {/* reason 是主进程给的一行总结；checks[] 是逐项结论 */}
                  <p className="muted small break-all" data-testid="health-reason">
                    {report.reason}
                  </p>
                  <ul className="mt-3" data-testid="health-checks">
                    {report.checks.map((c) => (
                      <CheckRow key={c.id} check={c} />
                    ))}
                  </ul>

                  {/* ── 孤包（只有包、没有图）：**独立异常类别**，不是失败项、不是损坏（U12）──
                      · 不进 checks、不翻 report.ok（缺的是素材本身 ⇒ 它是「不完整」，不是「坏」）；
                      · 所以必须常驻可见、不许进折叠区 —— 藏起来就等于静默；
                      · 三句口径文案不许改写：不算素材 · 不是损坏 · 重建修不好；
                      · 路径只显示文本（select-all 便于复制）：按路径 reveal 要新契约方法，本卡不开
                        （理由：按路径 reveal 要新契约方法，本卡不开；将来做法同此）。 */}
                  <div
                    className="mt-4 border-t border-line pt-3"
                    data-testid="orphan-archive"
                    data-orphan-count={String(report.orphanArchive.count)}
                    data-orphan-scanned={report.orphanArchive.scanned ? 'yes' : 'no'}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-caption">
                      <span
                        className={report.orphanArchive.count > 0 ? 'tone-warn' : 'tone-ok'}
                        aria-hidden="true"
                      >
                        {report.orphanArchive.count > 0 ? '!' : '✓'}
                      </span>
                      <span className="text-ink">孤包（只有包、没有图）</span>
                      <span className="mono muted">{String(report.orphanArchive.count)} 个</span>
                      <span className="muted small">不算素材 · 不是损坏 · 重建修不好</span>
                    </div>
                    <p className="muted small">
                      素材
                      {report.materialCount === null
                        ? '（未扫描）'
                        : ' ' + String(report.materialCount) + ' 个'}
                      （孤包不计入）
                      {report.orphanArchive.count > 0
                        ? '；这些包没有对应的预览图，无法作为素材检索或取用。'
                        : ''}
                    </p>
                    {!report.orphanArchive.scanned ? (
                      <p className="tone-warn small">
                        孤包未扫描或扫描失败：{report.orphanArchive.error ?? '未知原因'}
                        —— 这里的 0 不代表没有孤包（是「不知道」）。
                      </p>
                    ) : null}
                    {report.orphanArchive.samples.length > 0 ? (
                      <ul className="mt-1">
                        {report.orphanArchive.samples.map((f) => (
                          <li
                            key={f.relPath}
                            className="mono small muted break-all select-all"
                            data-testid="orphan-path"
                          >
                            {f.relPath}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {report.orphanArchive.truncated ? (
                      <p className="muted small">
                        只列出前 {String(report.orphanArchive.samples.length)} 个（共{' '}
                        {String(report.orphanArchive.count)} 个）。
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            {reportAfterRebuild ? <RebuildReportView report={reportAfterRebuild} /> : null}

            {/* ── 应用自身健康（U27）：与体检并列，但说的是**应用**而不是**库** ────── */}
            <AppHealthPanel />

            {rebuildPhase === 'error' && rebuildError ? (
              <div className="panel mt-4" role="alert" data-testid="rebuild-error">
                <p className="err">重建失败：{rebuildError.userMessage}</p>
                {rebuildError.code ? <p className="mono muted small">{rebuildError.code}</p> : null}
              </div>
            ) : null}
          </div>
        </Main>
      </AppShell>

      <Toast message={message} tone={tone} />

      {/* 破坏性操作的确认（两段式的第二段）。取消 ⇒ cancelRebuild ⇒ **零 IPC** */}
      <ConfirmDialog
        open={Boolean(pendingRebuild)}
        onOpenChange={(next) => {
          if (!next) cancelRebuild();
        }}
        title="重建这个库的元数据？"
        description="会删掉 .gs.db 家族并从 items.json 重新导入。素材目录不会被改动，索引也不会被重建。这一步不可撤销，但元数据是可重建的派生数据。"
        confirmText="重建元数据"
        onConfirm={() => {
          void confirmRebuild(show);
        }}
      />
    </>
  );
}
