// Chip —— 筛选胶囊（原型：.chip / .chip.active，选中态是 `active` 而不是 aria-pressed）
export default function Chip({ active = false, onClick, children, ...rest }) {
  return (
    <button type="button" className={active ? 'chip active' : 'chip'} onClick={onClick} {...rest}>
      {children}
    </button>
  )
}
