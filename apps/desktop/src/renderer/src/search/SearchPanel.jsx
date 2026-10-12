// SearchPanel —— 检索面板（原型：.panel > .row + .filter-row）
import Button from '../ui/Button.jsx'
import Chip from '../ui/Chip.jsx'
import Field from '../ui/Field.jsx'
import SearchBox from '../ui/SearchBox.jsx'
import { CHIPS } from '../hooks/useSearch.js'

const SORTS = [
  { value: 'score', label: '相关度优先' },
  { value: 'name', label: '文件名' },
  { value: 'recent', label: '最近添加' },
]

export default function SearchPanel({
  query, onQueryChange, onSubmit, busy, placeholder, inputRef,
  folder, onFolderChange, sort, onSortChange,
  mode, onPickImage, imageName,
}) {
  return (
    <div className="panel">
      <div className="row wrap">
        <SearchBox
          ref={inputRef}
          value={query}
          onChange={onQueryChange}
          onKeyDown={(e) => { if (e.key === 'Enter') onSubmit() }}
          placeholder={placeholder}
          ariaLabel="自然语言搜索"
        />
        <Button onClick={onPickImage} title="选一张库外参考图，按图搜图">
          ◫ {mode === 'image' && imageName ? '换参考图' : '以图搜图'}
        </Button>
        <Button variant="primary" disabled={busy} onClick={onSubmit}>
          搜索图片 →
        </Button>
      </div>

      {mode === 'image' ? (
        <div className="muted small filter-hint">
          当前为以图搜图：{imageName ? `已选 ${imageName}` : '尚未选择参考图'}；在输入框里打字会自动切回文字检索。
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
        <Field className="auto" value={sort} onChange={(e) => onSortChange(e.target.value)} aria-label="排序方式">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </Field>
      </div>
    </div>
  )
}
