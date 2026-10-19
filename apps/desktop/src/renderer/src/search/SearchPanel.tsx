// SearchPanel —— 检索面板（原型：.panel > .row + .filter-row）
import type { KeyboardEvent, RefObject } from 'react';

import Button from '../ui/Button.tsx';
import Chip from '../ui/Chip.tsx';
import Field from '../ui/Field.tsx';
import SearchBox from '../ui/SearchBox.tsx';
import { CHIPS } from '../store/search.ts';

// ⚠️ 值域与 store 的排序语义一一对应（`sortResults`）：score=相关度、name=文件名、recent=最近添加。
const SORTS = [
  { value: 'score', label: '相关度优先' },
  { value: 'name', label: '文件名' },
  { value: 'recent', label: '最近添加' },
];

export type SearchPanelProps = {
  query?: string;
  onQueryChange: (v: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  folder?: string;
  onFolderChange: (folder: string) => void;
  sort?: string;
  onSortChange: (sort: string) => void;
  mode?: string;
  /** PRD-1：检索来源。`local` = L0 本地检索（零模型，默认）；`smart` = 语义/以图搜图（可选，需模型+索引） */
  source?: 'local' | 'smart';
  onSourceChange?: (source: 'local' | 'smart') => void;
  onPickImage: () => void;
  imageName?: string;
};

export default function SearchPanel({
  query,
  onQueryChange,
  onSubmit,
  busy,
  placeholder,
  inputRef,
  folder,
  onFolderChange,
  sort,
  onSortChange,
  mode,
  source = 'local',
  onSourceChange,
  onPickImage,
  imageName,
}: SearchPanelProps) {
  const local = source === 'local';
  return (
    <div className="panel">
      {/* PRD-1（所有者 2026-10-19）：默认「本地检索」（ID / 文件名 / 路径，零模型、离线即时）；
          「智能检索」是可选层 —— 缺模型/索引时由页面接到设置引导（M3），这里只负责切换。 */}
      <div className="filter-row" data-testid="search-source">
        <span className="muted small">检索方式</span>
        <Chip active={local} onClick={() => onSourceChange?.('local')}>
          本地检索
        </Chip>
        <Chip active={!local} onClick={() => onSourceChange?.('smart')}>
          智能检索
        </Chip>
        <span className="muted small">
          {local ? 'ID / 文件名 / 路径关键词 · 不需要模型' : '语义文本 / 以图搜图 · 需要模型与索引'}
        </span>
      </div>
      <div className="row wrap">
        <SearchBox
          ref={inputRef}
          value={query}
          onChange={onQueryChange}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') onSubmit();
          }}
          placeholder={placeholder}
          ariaLabel={local ? '本地检索' : '自然语言搜索'}
        />
        {local ? null : (
          <Button onClick={onPickImage} title="选一张库外参考图，按图搜图">
            ◫ {mode === 'image' && imageName ? '换参考图' : '以图搜图'}
          </Button>
        )}
        <Button variant="primary" disabled={busy} onClick={onSubmit}>
          {local ? '检索' : '搜索图片'} →
        </Button>
      </div>

      {mode === 'image' ? (
        <div className="muted small filter-hint">
          当前为以图搜图：{imageName ? `已选 ${imageName}` : '尚未选择参考图'}
          ；在输入框里打字会自动切回文字检索。
        </div>
      ) : null}

      <div className="filter-row">
        <span className="muted small">渲染器分类</span>
        {CHIPS.map((name) => (
          <Chip
            key={name}
            active={folder === name}
            title={name === '未分类' ? '入库默认目录；当前索引里可能还没有这类素材' : undefined}
            onClick={() => onFolderChange(name)}
          >
            {name}
          </Chip>
        ))}
        <span className="u-flex1" />
        <span className="muted small">排序</span>
        <Field
          className="auto"
          value={sort}
          onChange={(e) => onSortChange(e.target.value)}
          aria-label="排序方式"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Field>
      </div>
    </div>
  );
}
