// MetricsRow —— 四个指标卡（原型：.metrics > .metric × 4）
//
// 数值全部来自引擎（indexStatus / encoder 事件），不是原型里的示例值；取不到就如实写读取中。
import Metric from '../ui/Metric.tsx';
import type { LibStatus } from '../hooks/useEngine.ts';

const n = (v: unknown): string => Number(v || 0).toLocaleString('en-US');

export type MetricsRowProps = {
  lib: LibStatus | null;
  indexLoading?: boolean;
  device?: string;
};

export default function MetricsRow({ lib, indexLoading, device }: MetricsRowProps) {
  if (indexLoading && !lib) {
    return (
      <div className="metrics">
        <Metric label="图库图片" icon="▧" value="读取中…" variant="text" />
        <Metric label="已建立索引" icon="✓" value="读取中…" variant="text" />
        <Metric label="索引状态" icon="◴" value="读取中…" variant="text" />
        <Metric
          label="本地隐私"
          icon="⌑"
          value="离线可用"
          variant="text"
          note="图片与向量保存在本机"
        />
      </div>
    );
  }

  const indexed = Number(lib?.indexed || 0);
  const encoded = Number(lib?.encoded || 0);
  const pct = indexed > 0 ? Math.round((encoded / indexed) * 100) : 0;
  const compat = String(lib?.compat || '');
  const precision = compat.split('|')[2] || '—';
  const seq = (compat.split('|')[4] || '').trim();
  const healthy = Boolean(lib?.healthy);

  return (
    <div className="metrics">
      <Metric
        label="图库图片"
        icon="▧"
        value={n(indexed)}
        note={`预览图 ${n(indexed)} · 压缩包 ${n(indexed)}`}
      />
      <Metric
        label="已建立索引"
        icon="✓"
        value={n(encoded)}
        note={`${pct}% · 可参与语义检索`}
        good={pct >= 100}
      />
      <Metric
        label="索引状态"
        icon="◴"
        value={healthy ? '运行正常' : '需要处理'}
        variant="text"
        note={`${precision} · seq${seq || '—'} · ${device || '待载入'}`}
      />
      <Metric
        label="本地隐私"
        icon="⌑"
        value="离线可用"
        variant="text"
        note="图片与向量保存在本机"
      />
    </div>
  );
}
