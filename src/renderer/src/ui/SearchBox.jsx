// SearchBox —— 搜索输入（原型：.search-box > 放大镜 + input#query）
//
// `id="query"` 与 `.search-box` 是渲染层守卫的契约（它按 #query 定位输入框）。
import { forwardRef } from 'react'

const SearchBox = forwardRef(function SearchBox({ value, onChange, onKeyDown, placeholder, ariaLabel }, ref) {
  return (
    <div className="search-box">
      <span aria-hidden="true" className="search-ico">⌕</span>
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
  )
})

export default SearchBox
