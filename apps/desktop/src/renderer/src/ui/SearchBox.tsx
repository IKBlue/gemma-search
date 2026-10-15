// SearchBox —— 搜索输入（原型：.search-box > 放大镜 + input#query）
//
// `id="query"` 与 `.search-box` 是渲染层守卫的契约（它按 #query 定位输入框）。
//
// 2026-10-14 转 TSX：`forwardRef` 的 ref 是**回调 ref 也能用**的那种，所以类型写成
// `Ref<HTMLInputElement>`；调用点（SearchPanel）传 `useRef<HTMLInputElement>(null)` 即可。
import { forwardRef } from 'react';
import type { KeyboardEventHandler, Ref } from 'react';

export type SearchBoxProps = {
  value?: string;
  onChange: (value: string) => void;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  placeholder?: string;
  ariaLabel?: string;
};

const SearchBox = forwardRef(function SearchBox(
  { value, onChange, onKeyDown, placeholder, ariaLabel }: SearchBoxProps,
  ref: Ref<HTMLInputElement>,
) {
  return (
    <div className="search-box">
      <span aria-hidden="true" className="search-ico">
        ⌕
      </span>
      <input
        ref={ref}
        id="query"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
});

export default SearchBox;
