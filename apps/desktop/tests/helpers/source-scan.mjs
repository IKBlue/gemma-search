// apps/desktop/tests/helpers/source-scan.mjs —— 源码扫描：**只在代码里**找模式
//
// 为什么需要这个文件（这是本仓库栽过的坑，别删）：
//   朴素的 `grep window.api` 会把**注释里的**提法也算成违例。实测（2026-10-13）：
//     · `pages/FirstRunWizard.jsx:13` 是注释 "只用 `window.api.invoke`（…）"
//     · `main.jsx:34` 是注释 "渲染层本来就只有 window.api"
//     · `hooks/useEngine.js:3,4` 是注释 "渲染进程只有 `window.api`"
//   ⇒ 4 处**假阳性**。而反向的坑更危险：**"注释掉一行"正是禁用接线的常见手法**
//   （`AGENTS.md` §7 记录：`verify_app_build` 早年的剥注释器让被注释掉的接线重新可匹配）。
//
// 所以这个扫描器必须同时做对两件事：① 注释里的**不算** ② 被注释掉的**也不能算**。
// 它还要**认识正则字面量** —— 含引号的正则（如 `/["']/g`）会让朴素实现误入字符串模式。
//
// ⚠️ **两种掩码，用途不同，别混**（这是 2026-10-13 双向验证抓到的真坑）：
//   · `maskNonCode`   —— 注释**和字符串内容**都抹掉。用于"某段代码有没有调用某函数"这类判断。
//   · `maskComments`  —— **只**抹注释，**保留字符串内容**。
//     为什么必须有它：**色值与类名这类违例，真实写法就在字符串里** ——
//     `style={{ color: '#ff0071e3' }}`、`className="btn"`、Tailwind 任意值 `bg-[#0071e3]`。
//     用 `maskNonCode` 去查它们 ⇒ **永远查不到**，断言变成剧场。
//     （实测：往 `.jsx` 注入 `const x = '#ff0000'`，用 `maskNonCode` 的版本**不会变红**。）

/**
 * 扫描核心。两种掩码共用同一套状态机 —— **不要**为第二种掩码另写一份（P2）。
 *
 * @param {string} src
 * @param {boolean} maskStrings `true` = 连字符串内容一起抹掉；`false` = 保留字符串内容
 * @returns {string} 与输入**等长**的串（逐字符替换为空格，绝不移动位置 ⇒ 行号列号仍准确）
 */
function scan(src, maskStrings) {
  /** @type {string[]} */
  const out = []
  const n = src.length
  let i = 0

  // 上一个"有意义的"非空白字符 —— 用来判断 `/` 是除法还是正则起始
  let prev = ''

  const space = (k) => { for (let j = 0; j < k; j++) out.push(' ') }
  /** 按掩码方式输出一个字符：抹掉时保留换行、其余换空格；保留时原样 */
  const emit = (ch) => out.push(maskStrings ? (ch === '\n' ? '\n' : ' ') : ch)

  while (i < n) {
    const c = src[i]
    const c2 = src[i + 1]

    // ---- 行注释 ----
    if (c === '/' && c2 === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      space(j - i)
      i = j
      continue
    }

    // ---- 块注释 ----
    if (c === '/' && c2 === '*') {
      let j = i + 2
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++
      const end = Math.min(n, j + 2)
      // 保留块注释内部的换行，否则后续行号会错
      for (let k = i; k < end; k++) out.push(src[k] === '\n' ? '\n' : ' ')
      i = end
      continue
    }

    // ---- 字符串 / 模板 ----
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      out.push(c)                       // 起始引号留着（它本身是代码）
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { emit(src[j]); emit(src[j + 1]); j += 2; continue }
        if (quote === '`' && src[j] === '$' && src[j + 1] === '{') {
          // 模板插值：里面的内容是**代码**，交给主循环处理
          break
        }
        if (src[j] === quote) break
        emit(src[j])
        j++
      }
      if (j >= n) { i = n; continue }
      if (quote === '`' && src[j] === '$' && src[j + 1] === '{') {
        out.push('$', '{')
        i = j + 2
        // 递归处理插值内部（按代码走），这里用一个简化的括号配对
        let depth = 1
        while (i < n && depth > 0) {
          const d = src[i]
          if (d === '{') depth++
          else if (d === '}') depth--
          if (depth === 0) { out.push('}'); i++; break }
          // 插值内部整段当作代码：原样交给主循环更稳，这里直接输出
          out.push(d)
          i++
        }
        continue
      }
      out.push(quote)
      i = j + 1
      prev = quote
      continue
    }

    // ---- 正则字面量 ----
    // 判据：`/` 且上一个有意义字符不是"值"（标识符/数字/右括号/引号）
    if (c === '/' && /(^|[=(,:[!&|?{};+\-*%~^<>]|\breturn\b|\btypeof\b|\bcase\b)/.test(prev || '(')) {
      let j = i + 1
      let inClass = false
      let closed = false
      while (j < n) {
        const d = src[j]
        if (d === '\\') { j += 2; continue }
        if (d === '\n') break                    // 正则不跨行 ⇒ 这不是正则
        if (d === '[') inClass = true
        else if (d === ']') inClass = false
        else if (d === '/' && !inClass) { closed = true; break }
        j++
      }
      if (closed) {
        let k = j + 1
        while (k < n && /[a-z]/.test(src[k])) k++   // flags
        for (let m = i; m < k; m++) out.push(' ')
        i = k
        prev = '/'
        continue
      }
      // 不是正则 ⇒ 当除法算子
      out.push('/')
      i++
      prev = '/'
      continue
    }

    out.push(c)
    if (!/\s/.test(c)) prev = c
    i++
  }

  return out.join('')
}

/**
 * 把注释与字符串**内容**替换成空格（保留换行与列位置，这样行号仍然准确）。
 *
 * 保留代码骨架：标识符、运算符、括号都原样留下 —— 只有"非代码文本"被抹掉。
 * 模板字符串里的 `${...}` **按代码处理**（那里可以出现真的表达式）。
 *
 * 用途：判断"某段代码有没有调用某函数"。**查字符串里的东西请用 `maskComments`。**
 *
 * @param {string} src
 * @returns {string} 与输入**等长**的串
 */
export function maskNonCode(src) {
  return scan(src, true)
}

/**
 * **只**把注释替换成空格，**字符串内容原样保留**。
 *
 * 用途：查"写在字符串里的东西" —— 色值字面量、类名、路径、任意值语法。
 * 这些都是**真实违例的常见形态**，而 `maskNonCode` 会把它们一起抹掉、导致断言永远不红。
 *
 * ⚠️ 它仍然会正确**跳过字符串内部**的 `//`（不会把 `'http://x'` 当成行注释），
 *    因为字符串分支在掩码与否两种模式下都照常走。
 *
 * @param {string} src
 * @returns {string} 与输入**等长**的串
 */
export function maskComments(src) {
  return scan(src, false)
}

/**
 * 在**代码**里找模式（注释与字符串内容不算）。
 *
 * @param {string} src
 * @param {RegExp} re 必须是**全局**正则（带 g），否则会漏匹配
 * @returns {{line:number, col:number, text:string}[]}
 */
export function findInCode(src, re) {
  return findAll(maskNonCode(src), re)
}

/**
 * 在**非注释**部分找模式（字符串内容**算**）。查色值 / 类名 / 任意值语法用这个。
 *
 * @param {string} src
 * @param {RegExp} re 必须是**全局**正则（带 g）
 * @returns {{line:number, col:number, text:string}[]}
 */
export function findOutsideComments(src, re) {
  return findAll(maskComments(src), re)
}

/** 共用的匹配 + 行号列号计算（`findInCode` / `findOutsideComments` 都用它） */
function findAll(masked, re) {
  const re2 = re.global ? re : new RegExp(re.source, re.flags + 'g')
  const hits = []
  let m
  while ((m = re2.exec(masked)) !== null) {
    const upto = masked.slice(0, m.index)
    const line = upto.split('\n').length
    const col = m.index - (upto.lastIndexOf('\n') + 1) + 1
    hits.push({ line, col, text: m[0] })
    if (m.index === re2.lastIndex) re2.lastIndex++   // 防零宽死循环
  }
  return hits
}
