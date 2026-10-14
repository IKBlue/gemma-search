// apps/desktop/tests/helpers/source-scan.mjs —— 源码扫描：**只在代码里**找模式
//
// 为什么需要这个文件（这是本仓库栽过的坑，别删）：
//   朴素的 `grep window.api` 会把**注释里的**提法也算成违例。实测（2026-10-13）：
//     · `pages/FirstRunWizard.jsx:13` 是注释 "只用 `window.api.invoke`（…）"
//     · `main.jsx:34` 是注释 "渲染层本来就只有 window.api"
//     · `hooks/useEngine.js:3,4` 是注释 "渲染进程只有 `window.api`"
//   ⇒ 4 处**假阳性**。而反向的坑更危险：**"注释掉一行"正是禁用接线的常见手法**
//   （`TODO.md` C-12 记录：`verify_app_build` 早年的剥注释器让被注释掉的接线重新可匹配）。
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
  return scanCore(src, maskStrings, 0, false).text
}

/**
 * 扫描核心。**可以在任意位置开始，并可选地在配对的 `}` 处停下** —— 后者专为模板串插值而加。
 *
 * ── ⚠️⚠️ 2026-10-13 修的一个**假阴/假阳双向**的真缺陷（本函数原来是 `scan` 的全部）──────
 *   症状：**含 `${...}` 插值的模板串之后，整段文件"瞎了"** —— `maskNonCode` 把后面的
 *   代码骨架也全抹成空格。实测 `SearchPage.jsx:55+`、`TasksPage.jsx:76+`、`ItemPage.jsx:48+`
 *   都中招 ⇒ 基于本扫描器的 L1–L7 / T1–T6 断言在那些区域**恒为真**（剧场）。
 *   同时，注释里的反引号内容会**漏出来**再匹配一次 ⇒ 假阳性（L6 就被自己的注释绊倒过）。
 *
 *   根因：旧代码处理完 `${...}` 后 `continue` 回了**主循环**，从没回到模板串状态。
 *   于是模板的**收尾反引号被当成新模板的起始反引号**，一路吞到下一个反引号（甚至文件尾）。
 *
 *   修法：把"扫一段"变成可递归 —— 插值里的内容是**代码**，递归扫到配对的 `}` 就返回，
 *   然后**留在模板串里继续**。一份实现同时服务"整文件"与"插值"，不写第二套（P2）。
 *
 * @param {string} src
 * @param {boolean} maskStrings `true` = 连字符串内容一起抹掉；`false` = 保留字符串内容
 * @param {number} start        从哪个下标开始
 * @param {boolean} stopAtBrace `true` = 遇到配对的 `}` 就停（并把它含进去）
 * @returns {{text: string, end: number}} `end` 是扫完后的下标
 */
function scanCore(src, maskStrings, start, stopAtBrace) {
  /** @type {string[]} */
  const out = []
  const n = src.length
  let i = start
  // 只在 `stopAtBrace` 时有意义：`{` +1、`}` -1，减到 0 就是插值结束
  let depth = 1

  // 上一个"有意义的"非空白字符 —— 用来判断 `/` 是除法还是正则起始。
  // 插值内部从"表达式位置"开始，所以初始给一个 `(`（`/` 在它后面按正则处理）
  let prev = stopAtBrace ? '(' : ''

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
        // ⭐ 模板插值：里面是**代码** ⇒ 递归扫到配对的 `}`，然后**留在模板里继续**。
        //    旧代码这里 `continue` 回主循环 —— 那正是"模板之后整段失明"的根因（见 scanCore 头注释）。
        if (quote === '`' && src[j] === '$' && src[j + 1] === '{') {
          out.push('$', '{')
          const inner = scanCore(src, maskStrings, j + 2, true)
          out.push(inner.text)
          j = inner.end
          continue
        }
        if (src[j] === quote) { out.push(quote); j++; break }
        emit(src[j])
        j++
      }
      i = j
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

    // ---- 普通代码字符 ----
    // ⚠️ 花括号配平**只在这里**做 —— 必须在"真的当成代码输出"的那条路径上。
    //    放到循环开头会把字符串/注释/正则里的 `{` `}` 也算进去，那就又错位了。
    if (stopAtBrace) {
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          out.push('}')                       // 收尾的 `}` 是插值的一部分
          return { text: out.join(''), end: i + 1 }
        }
      }
    }

    out.push(c)
    if (!/\s/.test(c)) prev = c
    i++
  }

  return { text: out.join(''), end: i }
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
