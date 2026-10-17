// apps/desktop/src/renderer/src/ui/MetaBlock.tsx —— 详情页「组织」块：评分 / 备注 / 收藏（WIRE-C 第 2 段）
//
// 分层：本文件是 **UI 层** —— 只渲染与触发。所有 IPC 都走 **Operation 层的 useEngine().invoke**
//   （= adapter 的唯一入口），组件里**不出现** window.api（AGENTS §2 的 UI 禁令）。
//
// ⚠️ 缺库分支（Lead 2026-10-17 裁定）：metaGet 缺库 ⇒ 信封 `DB_MISSING` ⇒ 显示「标注不可用（库不可用）」+
//   **禁用**评分/备注/收藏按钮；**绝不**渲染成"未评分/未收藏"（那是把「未知」说成「没有」）。
import { useCallback, useEffect, useState } from 'react';

import Button from './Button.tsx';
import { useEngine } from '../hooks/useEngine.ts';

interface MetaData {
  rating: number | null;
  note: string | null;
  isFavorite: boolean;
  updatedAt: number | null;
}

type MetaState =
  | { phase: 'loading' }
  | { phase: 'unavailable'; reason: string }
  | { phase: 'ready'; meta: MetaData };

const RATINGS = [1, 2, 3, 4, 5] as const;

export default function MetaBlock({ libId, uid }: { libId: string; uid: string }) {
  const { invoke } = useEngine();
  const [state, setState] = useState<MetaState>({ phase: 'loading' });
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await invoke<MetaData>('metaGet', { libId, uid });
    if (!r.ok) {
      // 缺库 = 「读不到、不知道」；界面必须说"不可用"，而不是"未评分/未收藏"
      setState({ phase: 'unavailable', reason: r.error.userMessage });
      return;
    }
    setState({ phase: 'ready', meta: r.data });
    setNote(r.data.note ?? '');
  }, [invoke, libId, uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (patch: { rating?: number | null; note?: string | null; isFavorite?: boolean }) => {
      setSaving(true);
      const r = await invoke<{ applied: string[] }>('metaSet', { libId, uid, ...patch });
      setSaving(false);
      if (!r.ok) return;
      if (r.data.applied.length === 0) return;
      // 用**服务端回写的字段**更新本地（不整行假设；与"部分更新"语义一致）
      setState((s) =>
        s.phase === 'ready'
          ? {
              phase: 'ready',
              meta: {
                ...s.meta,
                ...('rating' in patch ? { rating: patch.rating as number | null } : {}),
                ...('note' in patch ? { note: patch.note as string | null } : {}),
                ...('isFavorite' in patch ? { isFavorite: patch.isFavorite as boolean } : {}),
                updatedAt: Date.now(),
              },
            }
          : s,
      );
      if ('note' in patch) setNote(patch.note ?? '');
    },
    [invoke, libId, uid],
  );

  if (state.phase === 'loading') {
    return (
      <div className="panel mt-4" data-testid="meta-block">
        <div className="muted small">正在读取标注…</div>
      </div>
    );
  }
  if (state.phase === 'unavailable') {
    return (
      <div className="panel mt-4" data-testid="meta-block" data-meta-unavailable="yes">
        <div className="mb-1 font-semibold text-ink">组织</div>
        <div className="muted small" data-testid="meta-unavailable">
          标注不可用（库不可用）：{state.reason}
        </div>
      </div>
    );
  }
  const m = state.meta;
  return (
    <div className="panel mt-4" data-testid="meta-block">
      <div className="mb-1 font-semibold text-ink">组织</div>

      {/* 评分：1..5；NULL = **未评分**（不是 0） ⇒ 未评分时不点亮任何星，并显示"未评分" */}
      <div className="mb-2 flex items-center gap-1" data-testid="meta-rating">
        <span className="mr-2 text-caption text-ink-muted">评分</span>
        {RATINGS.map((n) => (
          <button
            key={n}
            type="button"
            data-testid={'meta-rate-' + String(n)}
            aria-pressed={m.rating === n}
            disabled={saving}
            className="px-1 text-lg"
            onClick={() => void save({ rating: n })}
            title={'评 ' + String(n) + ' 分'}
          >
            {m.rating !== null && n <= m.rating ? '★' : '☆'}
          </button>
        ))}
        <button
          type="button"
          data-testid="meta-rate-clear"
          disabled={saving || m.rating === null}
          className="ml-2 text-caption"
          onClick={() => void save({ rating: null })}
        >
          清除评分
        </button>
        <span className="ml-2 text-caption text-ink-muted" data-testid="meta-rating-text">
          {m.rating === null ? '未评分' : String(m.rating) + ' / 5'}
        </span>
      </div>

      {/* 备注：空串 ≠ NULL —— 空串显示为空、但"保存空串"会真的写 ''（不是 null） */}
      <div className="mb-2" data-testid="meta-note-row">
        <div className="mb-1 text-caption text-ink-muted">
          备注{m.note === null ? '（从未填写）' : m.note === '' ? '（已清空）' : ''}
        </div>
        <textarea
          data-testid="meta-note"
          className="w-full border border-line bg-surface p-2 text-body"
          rows={2}
          value={note}
          disabled={saving}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          type="button"
          data-testid="meta-note-save"
          disabled={saving}
          onClick={() => void save({ note })}
        >
          保存备注
        </Button>
        <Button
          type="button"
          data-testid="meta-note-clear"
          disabled={saving || m.note === null}
          onClick={() => void save({ note: null })}
        >
          清为未填写
        </Button>
      </div>

      {/* 收藏：false = 取消；按钮 disabled 只在保存中 */}
      <div className="flex items-center gap-2" data-testid="meta-favorite-row">
        <Button
          type="button"
          data-testid="meta-favorite"
          aria-pressed={m.isFavorite}
          disabled={saving}
          onClick={() => void save({ isFavorite: !m.isFavorite })}
        >
          {m.isFavorite ? '★ 已收藏' : '☆ 收藏'}
        </Button>
      </div>
    </div>
  );
}
