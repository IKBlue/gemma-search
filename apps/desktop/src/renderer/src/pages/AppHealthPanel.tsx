// pages/AppHealthPanel.tsx —— 诊断页上的「应用自身健康」面板（U27 · 2026-10-16）
//
// 为什么单独一个文件、而不是塞进 DiagnosticsPage：
//   U12（main-migrator）同期要在 DiagnosticsPage 里加「孤包」一段 ⇒ 少改一个共享文件、少一处将来会撞的地方。
//   本面板只负责**渲染**：数据来自 `appHealth`（恒成功的只读方法），文案判据在 `store/app-health.ts`。
//
// ── 三条渲染纪律 ──────────────────────────────────────────────────────────
//   ① **健康时也写一行**（不是空白）：空白会被读成「没做这件事」；
//   ② 不健康时给**三样事实**：次数 / 首条原因 / 首条时间 —— 全部来自主进程，界面**不补充猜测**；
//   ③ **不给「打开日志」按钮**：契约里没有「打开日志文件」的方法（`reveal` 只接受 libId+uid，是素材坐标），
//      硬塞一个按钮就得先造接口或猜日志路径 ⇒ **宁可不显示，也不猜**（口径与 appHealth 不含 sessionExit 同源）。
//      日志位置在下面的说明里**以文字给出**（它是主进程 `data/_app.log` 的约定，不是猜出来的）。
import Button from '../ui/Button.tsx';
import useAppHealth from '../hooks/useAppHealth.ts';
import { firstAtText, healthLine } from '../store/app-health.ts';

export default function AppHealthPanel() {
  const { data, error, loading, refresh } = useAppHealth();
  const bad = data !== null && data.unhealthy === true;
  return (
    <div className="panel mt-4" data-testid="app-health-panel" data-unhealthy={bad ? 'yes' : 'no'}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">应用自身健康</span>
        <span className="tag" data-health-state={bad ? 'bad' : 'ok'}>
          {bad ? '本次运行出过事' : '正常'}
        </span>
        <Button size="sm" onClick={refresh} disabled={loading} data-action="app-health-refresh">
          {loading ? '正在读取…' : '重新读取'}
        </Button>
      </div>

      {/* 健康时**也有这一行**（不是空白） */}
      <p className="muted small" data-testid="app-health-line">
        {healthLine(data)}
      </p>

      {bad ? (
        <ul className="mt-2 text-caption text-ink-muted">
          <li>
            次数：
            <span className="mono" data-testid="app-health-count">
              {String(data.count)}
            </span>
          </li>
          <li>
            首条原因：
            <span className="mono break-all" data-testid="app-health-reason">
              {data.reason ?? '—'}
            </span>
          </li>
          <li>
            首条时间：
            <span className="mono" data-testid="app-health-firstat">
              {firstAtText(data.firstAt)}
            </span>
          </li>
        </ul>
      ) : null}

      {error ? (
        <p className="err small mt-2" role="alert" data-testid="app-health-error">
          {error.userMessage}
        </p>
      ) : null}

      {/* 这是「上个会话异常退出」的唯一去处：**日志**（界面不持久化、不猜） */}
      <p className="muted small mt-2">
        这里只显示<strong>本次运行</strong>的事实；「上个会话是不是异常退出」以及退出前的最后几行，
        请直接看应用日志（主进程日志文件 <span className="mono">data/_app.log</span>）。 界面刻意
        <strong>不保存</strong>「上次崩溃」这类标记 —— 那会在下次启动时变成过期信息。
      </p>
    </div>
  );
}
