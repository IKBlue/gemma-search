// Field —— 原生控件包一层（原型：.field，用于排序下拉）
export default function Field({ as: Tag = 'select', className, children, ...rest }) {
  return (
    <Tag className={['field', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Tag>
  )
}
