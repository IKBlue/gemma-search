// Score —— 分数徽标（"分数 · 档位文案 · 包体积"）
//
// ⚠️ **档位只来自引擎，界面绝不自算阈值**（F-02 修复点）。
//
// 为什么这条是硬规矩而不是风格偏好：
//   · 引擎的 `band` 是**按模态分别定义**的（见 `packages/engine/src/engine.mjs` 的 `BANDS`）：
//     同一条分数在"文本查询"与"图像查询"里含义完全不同。
//   · 分数**不可跨模态比大小**（契约 §2.1）：图像自检索能到满分附近，
//     而文本→图像的 top-1 落在低得多的区间。界面原先自写了一套更严的阈值，
//     于是**每一次文本检索的全部结果都被标成「较弱」** —— 系统性错报，不是审美问题。
//   · 所以 `band` 缺失时**宁可少一行信息，也不猜**：没有 band 就说明我们不知道模态，
//     此时任何本地阈值都必然有一半场景是错的。
//
// 契约依据：`docs/spec/CONTRACT-engine-v1.md` §2.1「界面只能用引擎给的 band，不得自己算阈值」。
//
// 本文件**刻意不含任何分数阈值常量**（连注释里也不写数值），这样
// `grep -nE '0\.[789][0-9]'` 对本文件恒为空 —— 让"又有人开始自算阈值"这件事
// **在守卫里一眼可见**，而不是要靠人读注释判断。

/** 引擎 band → 中文文案。集中在这里，避免同一个概念散落多处。 */
const BAND_TEXT = { high: '同款区间', mid: '很接近', low: '较弱' }

/** 把字节数写成人类可读（与原型示例里的 "2.3 MB" 一致） */
export function humanSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1 }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/**
 * @param {object} props
 * @param {number} props.score  引擎给的分数（原样显示，界面不做任何判定）
 * @param {'high'|'mid'|'low'} [props.band]  引擎给的档位。**缺失时只显示分数**，不猜。
 * @param {number} [props.size] 包体积（字节）
 */
export default function Score({ score, band, size }) {
  // 用引擎给的 band 直接做 CSS 类，**不再经过任何本地换算**。
  // 未知值（引擎将来加了新档位）同样只显示分数 —— 诚实降级，不假装认识它。
  const known = !!band && Object.prototype.hasOwnProperty.call(BAND_TEXT, band)
  const cls = known ? `score ${band}` : 'score'
  const tail = [known ? BAND_TEXT[band] : '', humanSize(size)].filter(Boolean).join(' · ')
  return (
    <span className={cls} data-band={known ? band : undefined}>
      {Number(score).toFixed(4)}{tail ? ` · ${tail}` : ''}
    </span>
  )
}
