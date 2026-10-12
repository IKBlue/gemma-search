// cx —— 极小 class 合并（不值得为此引 clsx）
export default function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}
