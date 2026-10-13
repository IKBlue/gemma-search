// docs/design/ui-kit/build.mjs —— 从外部解包的 **macOS UI Kit** 抽取基线数据，
// 生成 docs/design/ui-kit/kit-data.json、docs/design/ui-kit/index.html，
// 并把 Markdown 文档里的生成区块（<!-- BEGIN GENERATED --> … <!-- END GENERATED -->）重写。
//
// 用法：
//   node docs/design/ui-kit/build.mjs --kit "<Apple macOS <版本> UI Kit 目录>"   # 抽取 + 生成
//   node docs/design/ui-kit/build.mjs                                        # 只用已入库的 kit-data.json 重新生成
//
// 纪律（AGENTS.md）：
//   · **不写本机绝对路径** —— kit 目录只能由 --kit 传入；缺参数且无 kit-data.json 时退出 1。
//   · 本目录下的产物是**参照物**（值本身就是内容），不是应用 UI ⇒ 不消费 tokens.css，
//     也不受「渲染层零色值字面量」那条断言约束（它只扫 apps/desktop/src/renderer）。
//   · 不内嵌任何 Apple 字体或图像 —— 只记录数值与名称（授权边界见 UI-KIT.md）。
import fs from 'node:fs'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const DATA_FILE = path.join(HERE, 'kit-data.json')
const HTML_FILE = path.join(HERE, 'index.html')
const DOC_FILE = path.join(HERE, '..', 'UI-KIT.md')
const TOKENS = path.join(HERE, '..', '..', '..', 'packages', 'design-tokens', 'tokens.css')

// ---------------------------------------------------------------- 颜色工具
const hex = (c) => c ? '#' + [c.red, c.green, c.blue].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('') : null
const chan = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
const lum = (c) => 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b)
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const toRGB = (c) => ({ r: c.red * 255, g: c.green * 255, b: c.blue * 255 })
const over = (c, bg) => ({ r: c.red * 255 * c.alpha + bg.r * (1 - c.alpha), g: c.green * 255 * c.alpha + bg.g * (1 - c.alpha), b: c.blue * 255 * c.alpha + bg.b * (1 - c.alpha) })
const a2 = (n) => Math.round(n * 100) / 100

/** 去掉页名里的 SF Symbol 私用区字形（HTML 里会渲染成豆腐块） */
const clean = (s) => [...String(s)].filter((ch) => { const c = ch.codePointAt(0); return c <= 0xffff && !(c >= 0xe000 && c <= 0xf8ff) }).join('').trim()

// ---------------------------------------------------------------- tokens.css（应用侧现值）
function appTokens() {
  const css = fs.readFileSync(TOKENS, 'utf8')
  const block = (marker) => { const i = css.indexOf(marker); const s = css.indexOf('{', i); let d = 0; for (let j = s; j < css.length; j++) { if (css[j] === '{') d++; else if (css[j] === '}') { d--; if (!d) return css.slice(s + 1, j) } } return '' }
  const parse = (t) => { const o = {}; const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi; let m; while ((m = re.exec(t))) o[m[1]] = m[2].trim(); return o }
  const light = parse(block(':root {'))
  const dark = { ...light, ...parse(block('@media (prefers-color-scheme: dark) {')) }
  const resolve = (name, vars, depth = 0) => {
    if (depth > 12) return null
    const raw = vars[name]
    if (!raw) return null
    const v = raw.match(/^var\((--[a-z0-9-]+)\)$/i)
    if (v) return resolve(v[1], vars, depth + 1)
    const h = raw.match(/^#([0-9a-f]{6})$/i)
    if (h) { const n = h[1]; return { r: parseInt(n.slice(0, 2), 16), g: parseInt(n.slice(2, 4), 16), b: parseInt(n.slice(4, 6), 16) } }
    return null
  }
  const pick = ['--color-accent', '--color-critical', '--color-warning', '--color-success', '--color-text-primary', '--color-text-secondary', '--color-bg-primary', '--color-bg-secondary', '--color-bg-elevated', '--color-separator']
  const out = {}
  for (const k of pick) out[k] = { light: resolve(k, light), dark: resolve(k, dark) }
  const type = Object.entries(light).filter(([k]) => k.startsWith('--type-') && !k.endsWith('-lh') && !k.endsWith('-ls')).map(([k, v]) => [k, v])
  return { colors: out, type }
}

// ---------------------------------------------------------------- 从 kit 抽取
function extract(kitDir) {
  const meta = JSON.parse(fs.readFileSync(path.join(kitDir, 'meta.json'), 'utf8'))
  const doc = JSON.parse(fs.readFileSync(path.join(kitDir, 'document.json'), 'utf8'))
  const objs = (x) => Array.isArray(x) ? x : (x && x.objects) || []
  const on = (a) => (a || []).filter((x) => x && x.isEnabled !== false)
  const pages = Object.entries(meta.pagesAndArtboards).map(([id, p]) => ({ id, name: p.name, artboards: Object.values(p.artboards || {}).length }))
  const load = (p) => JSON.parse(fs.readFileSync(path.join(kitDir, 'pages', p.id + '.json'), 'utf8'))
  const comps = (p) => (load(p).layers || []).filter((l) => l._class === 'symbolMaster' || l._class === 'artboard')
  const mode = (a) => { const m = new Map(); for (const x of a) m.set(x, (m.get(x) || 0) + 1); return [...m].sort((p, q) => q[1] - p[1])[0] }
  const SIZE = /(\d)\s(Mn|Sm|Rg|Lg|XL)/

  // 色板
  const swatches = objs(doc.sharedSwatches).map((s) => {
    const v = s.value || s.color || {}
    return { name: s.name, hex: hex(v), alpha: v.alpha === undefined ? 1 : v.alpha, rgb: toRGB(v) }
  })

  // 文字样式
  const textStyles = objs(doc.layerTextStyles).map((s) => {
    const v = s.value || {}, a = (v.textStyle && v.textStyle.encodedAttributes) || {}
    const f = a.MSAttributedStringFontAttribute && a.MSAttributedStringFontAttribute.attributes
    const para = a.paragraphStyle || {}
    const col = a.MSAttributedStringColorAttribute
    return { name: s.name, size: f && f.size, font: f && f.name, lineHeight: para.maximumLineHeight || para.minimumLineHeight || null, color: col ? hex(col) : null }
  }).filter((x) => x.size)

  // 图层样式
  const layerStyles = objs(doc.layerStyles).map((s) => {
    const v = s.value || {}
    const fills = on(v.fills), borders = on(v.borders), shadows = on(v.shadows), blurs = on(v.blurs)
    return {
      name: s.name,
      fills: fills.map((f) => hex(f.color) + (f.fillType === 1 ? ' grad' : '')),
      borders: borders.map((b) => (b.thickness || 0) + 'px ' + hex(b.color)),
      shadows: shadows.map((x) => x.offsetX + ',' + x.offsetY + ' ' + x.blurRadius + ' ' + hex(x.color)),
      blur: blurs.map((x) => x.radius),
      opacity: (v.contextSettings || {}).opacity,
    }
  })

  const sharedById = new Map(objs(doc.layerStyles).map((s) => [s.do_objectID, s]))
  // 共享样式的名字就是组件变体路径（如 Content Area/Light/01 - Bordered/01 - Idle）
  // ⇒ 用「最后两段」做名称匹配比按 ID 稳（实测：按 ID 命中 0 个）
  const sharedTails = objs(doc.layerStyles).map((s) => ({ name: s.name, tail: s.name.split('/').slice(-2).join('/'), value: s.value }))

  // 控件尺寸
  const btn = pages.find((p) => clean(p.name) === 'Buttons')
  const bySize = {}
  if (btn) for (const c of comps(btn)) { const m = SIZE.exec(c.name || ''); if (!m) continue; (bySize[m[2]] = bySize[m[2]] || []).push(Math.round(c.frame.height)) }
  const buttons = ['Mn', 'Sm', 'Rg', 'Lg', 'XL'].filter((k) => bySize[k]).map((k) => { const [h, n] = mode(bySize[k]); return { size: k, height: h, n, distinct: [...new Set(bySize[k])].sort((a, b) => a - b) } })

  const sb = pages.find((p) => clean(p.name) === 'Sidebars')
  const sidebar = sb ? (() => { const c = comps(sb); return { rowHeight: mode(c.map((x) => Math.round(x.frame.height)))[0], panelWidth: mode(c.map((x) => Math.round(x.frame.width)))[0], n: c.length } })() : null

  const al = pages.find((p) => clean(p.name) === 'Alerts')
  const alerts = al ? comps(al).filter((c) => /Buttons/.test(c.name)).map((c) => {
    const fills = [], texts = []
    const walk = (n) => { for (const l of n.layers || []) { const f = on((l.style || {}).fills)[0]; if (f && f.color) fills.push(hex(f.color)); if (l.attributedString && l.attributedString.string) texts.push(String(l.attributedString.string)); walk(l) } }
    walk(c)
    return { name: (c.name || '').replace(/^.*?\//, ''), w: Math.round(c.frame.width), h: Math.round(c.frame.height), fill: [...new Set(fills)][0] || null, text: texts[0] || null }
  }) : []

  const fonts = [...new Set(objs(doc.fontReferences).map((f) => f.fontFamilyName))]

  return {
    kit: { version: meta.version, appVersion: meta.appVersion, build: meta.build, app: meta.app, pages: pages.length, fontReferences: objs(doc.fontReferences).length, embeddedFonts: undefined },
    pages,
    swatches,
    textStyles,
    layerStyles: {
      total: layerStyles.length,
      withShadow: layerStyles.filter((s) => s.shadows.length).length,
      withBlur: layerStyles.filter((s) => s.blur.length).length,
      withBorder: layerStyles.filter((s) => s.borders.length).length,
      recipes: ['Global/Focus Ring', 'Content Area/Light/04 - Prominent (Default)/01 - Idle', 'Content Area/Light/03 - Bordered Destructive/01 - Idle']
        .map((n) => layerStyles.find((s) => s.name === n) || layerStyles.find((s) => (s.name || '').includes(n.split('/').slice(-2).join('/'))))
        .filter(Boolean),
    },
    controls: { buttons, sidebar, alerts },
    fonts,
    app: appTokens(),
    components: extractComponents(kitDir, pages, clean, hex, on, sharedById, sharedTails),
  }
}

// ---------------------------------------------------------------- 逐组件样式（全量 symbolMaster → 去重后的配方）
// 为什么这么做：4679 个组件去重后只剩 264 种外观 ⇒ 变体多、配方少。
// 所以数据分两层：variants（每个组件的 家族/外观/表面/尺寸档/状态/宽高/配方号）+ recipes（去重后的配方）。
function extractComponents(kitDir, pages, clean, hex, on, sharedById, sharedTails) {
  const SIZE = /(\d)\s(Mn|Sm|Rg|Lg|XL)/
  const areaOf = (n) => (n.frame ? (n.frame.width || 0) * (n.frame.height || 0) : 0)
  /** 背景层 = 面积最接近 master、且优先引用共享样式的那一层 */
  const bgOf = (sym) => {
    const ma = areaOf(sym) || 1
    let best = null, bestScore = -1
    const walk = (n) => {
      for (const l of n.layers || []) {
        const s = l.style
        const styled = s && (on(s.fills).length || on(s.borders).length || on(s.shadows).length || on(s.blurs).length)
        if (styled) {
          const score = Math.min(areaOf(l) / ma, 1) * 2 + (s.sharedStyleID ? 1 : 0) + (on(s.fills).length ? 0.3 : 0)
          if (score > bestScore) { bestScore = score; best = l }
        }
        walk(l)
      }
    }
    walk(sym)
    return best
  }
  const recipeOf = (sym) => {
    let nested = 0
    const walkN = (n) => { for (const l of n.layers || []) { if (l._class === 'symbolInstance') nested++; walkN(l) } }
    walkN(sym)
    const b = bgOf(sym)
    const nm = String(sym.name || '')
    let shared = b && b.style && b.style.sharedStyleID ? sharedById.get(b.style.sharedStyleID) : null
    if (!shared) {
      let hit = null
      for (const t of sharedTails) { if (t.tail && nm.includes(t.tail) && (!hit || t.name.length > hit.name.length)) hit = t }
      if (hit) shared = hit
    }
    const s = shared ? shared.value : (b ? b.style : null)
    if (!s) {
      let txt = null
      const walkT = (n) => { for (const l of n.layers || []) { if (!txt && l._class === 'text') txt = l; walkT(l) } }
      walkT(sym)
      if (txt) {
        const a = ((txt.style || {}).textStyle || {}).encodedAttributes || {}
        const f = a.MSAttributedStringFontAttribute && a.MSAttributedStringFontAttribute.attributes
        const col = a.MSAttributedStringColorAttribute
        return { kind: 'glyph', radius: 0, fills: [], borders: [], shadows: [], blur: 0, opacity: 1, nested, shared: '', glyph: String((txt.attributedString || {}).string || '').slice(0, 2), size: f ? f.size : 0, color: col ? hex(col) : '', count: 0 }
      }
      return { kind: 'empty', radius: 0, fills: [], borders: [], shadows: [], blur: 0, opacity: 1, nested, shared: '', count: 0 }
    }
    return {
      kind: 'shape',
      radius: b && b._class === 'oval' ? 999 : Math.round((b && b.fixedRadius) || 0),
      fills: on(s.fills).map((f) => hex(f.color) + (f.fillType === 1 ? ' → 渐变' : '')).slice(0, 3),
      borders: on(s.borders).map((x) => (x.thickness || 0) + 'px ' + hex(x.color)).slice(0, 2),
      shadows: on(s.shadows).map((x) => 'x' + x.offsetX + ' y' + x.offsetY + ' blur' + x.blurRadius + ' ' + hex(x.color)).slice(0, 2),
      blur: on(s.blurs).length ? on(s.blurs)[0].radius : 0,
      opacity: (s.contextSettings || {}).opacity === undefined ? 1 : (s.contextSettings || {}).opacity,
      nested,
      shared: shared ? shared.name : '',
      count: 0,
    }
  }
  const recipes = [], index = new Map(), variants = [], families = []
  const stList = [], stIdx = new Map(), suList = [], suIdx = new Map(), apList = [], apIdx = new Map()
  const idxOf = (list, map, v) => { let i = map.get(v); if (i === undefined) { i = list.length; map.set(v, i); list.push(v) } return i }
  pages.forEach((p, pi) => {
    let page
    try { page = JSON.parse(fs.readFileSync(path.join(kitDir, 'pages', p.id + '.json'), 'utf8')) } catch { return }
    const syms = (page.layers || []).filter((l) => l._class === 'symbolMaster')
    const distinct = new Set()
    for (const s of syms) {
      const nm = String(s.name || '')
      const parts = nm.split('/').map((x) => x.trim())
      const appearance = parts.includes('Light') ? 'Light' : parts.includes('Dark') ? 'Dark' : '—'
      const surface = parts.find((x) => /Content Area|Over-glass/.test(x)) || '—'
      const sm = SIZE.exec(nm)
      const state = parts.length > 1 ? parts[parts.length - 1] : ''
      const r = recipeOf(s)
      const key = JSON.stringify(r)
      let ri = index.get(key)
      if (ri === undefined) { ri = recipes.length; index.set(key, ri); recipes.push(r) }
      recipes[ri].count++
      distinct.add(ri)
      variants.push([pi, idxOf(apList, apIdx, appearance), idxOf(suList, suIdx, surface), sm ? sm[2] : '—', idxOf(stList, stIdx, state), Math.round(s.frame.width), Math.round(s.frame.height), ri])
    }
    families.push({ page: clean(p.name), count: syms.length, distinct: distinct.size })
  })
  return {
    total: variants.length,
    families,
    variants,
    recipes,
    states: stList,
    surfaces: suList,
    appearances: apList,
  }
}

// ---------------------------------------------------------------- main
const args = process.argv.slice(2)
const ki = args.indexOf('--kit')
const kitDir = ki >= 0 ? args[ki + 1] : (process.env.MACOS_UIKIT_DIR || '')

let data
if (kitDir) {
  if (!fs.existsSync(path.join(kitDir, 'document.json'))) { console.error('✗ --kit 指向的目录里没有 document.json：' + kitDir); process.exit(1) }
  data = extract(kitDir)
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 1))
  console.log('✓ 已抽取 → kit-data.json  (' + data.swatches.length + ' 色板 · ' + data.textStyles.length + ' 文字样式 · ' + data.layerStyles.total + ' 图层样式 · ' + data.pages.length + ' 页 · ' + data.kit.fontReferences + ' 字体引用)')
} else {
  if (!fs.existsSync(DATA_FILE)) { console.error('✗ 没有 --kit，也没有已入库的 kit-data.json。用法见文件头。'); process.exit(1) }
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  console.log('· 复用已入库的 kit-data.json（未接触外部 kit）')
}
console.log('✓ 数据就绪：' + DATA_FILE)


// ---------------------------------------------------------------- 渲染：静态 HTML（无 JS、无外链、不内嵌 Apple 字体与图像）
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function renderHTML(d) {
  const sw = d.swatches
  const byName = (re, appearance) => sw.find((s) => re.test(s.name) && (!appearance || new RegExp(appearance, 'i').test(s.name)))
  const winLight = byName(/Window Background/, 'Light') || { rgb: { r: 255, g: 255, b: 255 } }
  const winDark = byName(/Window Background/, 'Dark') || { rgb: { r: 0, g: 0, b: 0 } }
  const sys = (n) => sw.filter((s) => new RegExp('^System Colors/(Light|Dark)/' + n + '$').test(s.name))
  const SEM = [['1 Red', 'critical'], ['2 Orange', 'warning'], ['4 Green', 'success'], ['8 Blue', 'accent']]

  const chip = (s, bg) => {
    const eff = s.alpha < 1 ? over({ red: s.rgb.r / 255, green: s.rgb.g / 255, blue: s.rgb.b / 255, alpha: s.alpha }, bg) : s.rgb
    const r = ratio(eff, bg)
    return '<div class="c"><span class="dot" style="background:' + s.hex + (s.alpha < 1 ? ';opacity:' + s.alpha : '') + '"></span>' +
      '<code>' + esc(s.hex) + (s.alpha < 1 ? '@' + a2(s.alpha) : '') + '</code>' +
      '<small>' + (s.alpha < 1 ? '合成 ' + ('#' + [eff.r, eff.g, eff.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')) + ' · ' : '') + a2(r) + ':1</small></div>'
  }

  // 官方 12 色全渲染；只有被应用令牌映射到的 4 个才出"应用/判定"两列
  const APP_MAP = { '1 Red': '--color-critical', '2 Orange': '--color-warning', '4 Green': '--color-success', '8 Blue': '--color-accent' }
  const sysNames = [...new Set(sw.filter((s) => /^System Colors\/Light\//.test(s.name))
    .map((s) => s.name.replace(/^System Colors\/Light\//, '')))]
    .sort((a, b) => Number(a.split(' ')[0]) - Number(b.split(' ')[0]))
  const NAMED = ['Red', 'Orange', 'Yellow', 'Green', 'Mint', 'Teal', 'Cyan', 'Blue', 'Indigo', 'Purple', 'Pink', 'Brown']
  const systemGrid = sysNames.map((n) => {
    const l = sys(n).find((s) => /Light/.test(s.name)), k = sys(n).find((s) => /Dark/.test(s.name))
    const appKey = APP_MAP[n] || null
    const appL = appKey && d.app.colors[appKey] && d.app.colors[appKey].light
    const appD = appKey && d.app.colors[appKey] && d.app.colors[appKey].dark
    const appHexL = appL ? hex({ red: appL.r / 255, green: appL.g / 255, blue: appL.b / 255, alpha: 1 }) : null
    const appHexD = appD ? hex({ red: appD.r / 255, green: appD.g / 255, blue: appD.b / 255, alpha: 1 }) : null
    const verdict = (a, h) => !a ? '<small>未映射</small>' : (a.toLowerCase() === h.toLowerCase() ? '<b class="ok">一致</b>' : '<b class="no">不一致</b>')
    const token = appKey ? '<br><small>应用令牌 ' + esc(appKey) + '</small>' : ''
    return '<tr><th>' + esc(n) + token + '</th>' +
      '<td>' + chip(l, winLight.rgb) + '</td><td>' + chip(k, winDark.rgb) + '</td>' +
      '<td>' + (appHexL ? '<code>' + appHexL + '</code> ' : '') + verdict(appHexL, l.hex) + '</td>' +
      '<td>' + (appHexD ? '<code>' + appHexD + '</code> ' : '') + verdict(appHexD, k.hex) + '</td></tr>'
  }).join('')
  void NAMED

  const group = (re, bg, appearance) => sw.filter((s) => re.test(s.name) && new RegExp(appearance, 'i').test(s.name)).map((s) => chip(s, bg)).join('')

  const officialSizes = [...new Set(d.textStyles.map((t) => t.size))].sort((a, b) => b - a)
  const typeRows = officialSizes.map((size) => {
    const t = d.textStyles.find((x) => x.size === size && /Default$/.test(x.name)) || d.textStyles.find((x) => x.size === size)
    const names = [...new Set(d.textStyles.filter((x) => x.size === size).map((x) => clean(x.name).split('/')[0].trim()))].join(' · ')
    return '<tr><td><code>' + size + 'px</code></td><td>' + (t.lineHeight || '—') + '</td><td>' + esc(names) + '</td>' +
      '<td style="font-size:' + size + 'px">The quick brown fox 中文示例</td></tr>'
  }).join('')

  const appTypeRows = d.app.type.map(([k, v]) => '<tr><td><code>' + esc(k) + '</code></td><td>' + esc(v) + '</td></tr>').join('')

  const ruler = d.controls.buttons.map((b) => '<div class="ruler"><span class="lbl">' + b.size + '</span><span class="bar" style="height:' + b.height + 'px"></span><code>' + b.height + 'px</code><small>n=' + b.n + (b.distinct.length > 1 ? ' · 集合 ' + b.distinct.join(',') : ' · 无歧义') + '</small></div>').join('')

  const alerts = d.controls.alerts.map((a) => '<div class="btn ' + (/Destructive/.test(a.name) ? 'destructive' : /Preferred/.test(a.name) ? 'preferred' : '') + '">' + esc(clean(a.name).split('/').filter(Boolean).pop()) + ' <small>' + (/Dark/.test(a.name) ? 'Dark' : 'Light') + ' · ' + a.w + '×' + a.h + (a.fill ? ' · ' + a.fill : '') + '</small></div>').join('')

  const recipes = d.layerStyles.recipes.map((r) => '<tr><td><code>' + esc(r.name) + '</code></td><td>' + (r.fills.length ? r.fills.map((f) => '<code>' + esc(f) + '</code>').join(' ') : '—') + '</td><td>' + (r.borders.length ? r.borders.map((b) => '<code>' + esc(b) + '</code>').join(' ') : '—') + '</td><td>' + (r.shadows.length ? r.shadows.map((s) => '<code>' + esc(s) + '</code>').join(' ') : '—') + '</td><td>' + (r.blur.length ? r.blur.join(',') : '—') + '</td><td>' + (r.opacity !== undefined ? a2(r.opacity) : '—') + '</td></tr>').join('')

  const pickA = (ap, nm) => d.controls.alerts.find((a) => new RegExp(ap).test(a.name) && /Destructive/.test(a.name)) || {}
  const dEST = { l: pickA('Light').fill || '—', d: pickA('Dark').fill || '—', t: pickA('Light').text || pickA('Dark').text || '—' }
  const pageRows = [...d.pages].sort((a, b) => b.artboards - a.artboards).slice(0, 14).map((p) => '<tr><td>' + esc(clean(p.name)) + '</td><td>' + p.artboards + '</td></tr>').join('')
  // ---- 全量画廊：每个组件都要出现（用户要求），所以按族全渲染，配方内联成 300 个 CSS 类压缩体积
  const cssColor = (s) => { const m = /^#([0-9a-f]{6})(?:@([\d.]+))?/i.exec(String(s || '')); if (!m) return '#c7c7cc'; const a = m[2] ? Number(m[2]) : 1; const R = parseInt(m[1].slice(0, 2), 16), G = parseInt(m[1].slice(2, 4), 16), B = parseInt(m[1].slice(4, 6), 16); return a < 1 ? 'rgba(' + R + ',' + G + ',' + B + ',' + a + ')' : '#' + m[1] }
  const recipeCss = (r) => {
    const s = ['background:' + (r.fills[0] && !/→ 渐变/.test(r.fills[0]) ? cssColor(r.fills[0]) : r.fills[0] ? 'linear-gradient(135deg,#d1d1d6,#a1a1a6)' : 'transparent')]
    if (r.borders[0]) { const m = /^([\d.]+)px (.+)$/.exec(r.borders[0]); s.push(m ? 'border:' + m[1] + 'px solid ' + cssColor(m[2]) : 'border:1px solid rgba(0,0,0,.08)') } else s.push('border:1px solid rgba(0,0,0,.08)')
    if (r.shadows[0]) { const m = /^x(-?[\d.]+) y(-?[\d.]+) blur([\d.]+) (.+)$/.exec(r.shadows[0]); if (m) s.push('box-shadow:' + m[1] + 'px ' + m[2] + 'px ' + m[3] + 'px ' + cssColor(m[4])) }
    if (r.blur) s.push('backdrop-filter:blur(' + r.blur + 'px)')
    s.push('border-radius:' + (r.radius >= 900 ? 900 : r.radius) + 'px')
    return s.join(';')
  }
  const recipeClasses = d.components ? d.components.recipes.map((r, i) => '.r' + i + '{' + recipeCss(r) + '}').join('') : ''
  const fams = d.components ? d.components.families.filter((f) => f.count > 0).sort((a, b) => b.count - a.count) : []
  const toc = fams.map((f, i) => '<tr><td><a href="#fam' + i + '">' + esc(f.page) + '</a></td><td>' + f.count + '</td><td>' + f.distinct + '</td></tr>').join('')
  const gallery = fams.map((f, i) => {
    const pi = d.pages.findIndex((p) => clean(p.name) === f.page)
    const vs = d.components.variants.filter((v) => v[0] === pi)
    const body = vs.map((v) => {
      const cap = [d.components.appearances[v[1]], d.components.surfaces[v[2]], v[3], d.components.states[v[4]]].filter((x) => x && x !== '—').join(' · ')
      const sh = (d.components.recipes[v[7]] || {}).shared || ''
      const rc = d.components.recipes[v[7]] || {}
      const w2 = Math.min(v[5], 168), h2 = Math.min(v[6], 56)
      const box = rc.kind === 'shape'
        ? '<i class="r' + v[7] + '" style="width:' + w2 + 'px;height:' + h2 + 'px"></i>'
        : '<i class="gbox" title="' + esc(rc.glyph || '') + '" style="width:' + w2 + 'px;height:' + h2 + 'px">' + (rc.kind === 'glyph' ? 'SF Symbol 字形' + (rc.size ? ' ' + Math.round(rc.size) + 'px' : '') : '无外观层') + '</i>'
      return '<figure class="gcell" title="' + esc(cap + ' · ' + sh) + ' ' + v[5] + '×' + v[6] + '">' + box + '<figcaption>' + esc(cap.slice(0, 44)) + '<small>' + v[5] + '×' + v[6] + (sh ? '<br>' + esc(sh.replace('Content Area/', '').slice(0, 30)) : '') + '</small></figcaption></figure>'
    }).join('')
    return '<details open id="fam' + i + '"><summary><b>' + esc(f.page) + '</b> <small>' + f.count + ' 个组件 · ' + f.distinct + ' 种样式</small></summary><div class="gal">' + body + '</div></details>'
  }).join('')
  const recipeCells = d.components ? d.components.recipes.map((r, i) => '<div class="rcell">' + (r.kind === 'shape' ? '<i class="r' + i + '"></i>' : '<i class="gbox" style="height:30px">' + (r.kind === 'glyph' ? '字形' : '空') + '</i>') + '<small>' + (r.fills[0] ? esc(r.fills[0].replace(' → 渐变', '(渐变)')) : '无填充') + '<br>r=' + r.radius + ' · ×' + r.count + '</small></div>').join('') : ''
  const extraCss = '.gal{display:flex;flex-wrap:wrap;gap:10px;margin:6px 0 14px}.gcell{margin:0;width:150px}.gcell i{display:block;margin-bottom:4px}.gcell figcaption{font-size:11px;color:var(--fg2);line-height:1.35}.gcell figcaption small{display:block;color:#8e8e93}' +
    'details{margin:10px 0;border-bottom:1px solid #ececf0;padding-bottom:8px}summary{cursor:pointer;padding:6px 0}' +
    '.rgrid{display:flex;flex-wrap:wrap;gap:6px}.rcell{width:96px;text-align:center;font-size:10px}.rcell i{display:block;height:30px;margin-bottom:3px}' +
    '.gbox{display:flex;align-items:center;justify-content:center;text-align:center;border:1px dashed #c7c7cc;border-radius:6px;color:#8e8e93;font-size:9px;line-height:1.15;box-sizing:border-box}' + recipeClasses


  return '<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>macOS UI Kit 基线 · gemma-search</title>' +
    '<style>' +
    ':root{--fg:#1d1d1f;--fg2:#6e6e73;--bg:#fff;--bd:#d2d2d7;--soft:#f5f5f7;--accent:#0088ff}' +
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);' +
    'font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}' +
    'main{max-width:1180px;margin:0 auto;padding:32px 24px 96px}' +
    'h1{font-size:26px;letter-spacing:-.02em;margin:0 0 4px}h2{font-size:17px;margin:40px 0 12px;padding-top:16px;border-top:1px solid var(--bd)}' +
    'h3{font-size:13px;margin:20px 0 8px;color:var(--fg2)}' +
    'p,li{color:#3a3a3c}code{font:12px/1.4 ui-monospace,Consolas,monospace;background:var(--soft);padding:1px 5px;border-radius:5px}' +
    'small{color:var(--fg2)}table{border-collapse:collapse;width:100%;margin:8px 0 4px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #e5e5ea;vertical-align:middle;font-weight:400}' +
    'th{color:var(--fg2);font-size:12px}thead th{border-bottom:1px solid var(--bd)}' +
    '.grid{display:flex;flex-wrap:wrap;gap:8px}.c{display:flex;align-items:center;gap:7px;border:1px solid #e5e5ea;border-radius:10px;padding:5px 9px;min-width:196px}' +
    '.dot{width:20px;height:20px;border-radius:5px;border:1px solid rgba(0,0,0,.12);flex:none}' +
    '.ok{color:#1a7f37;font-weight:600}.no{color:#d70015;font-weight:600}' +
    '.ruler{display:flex;align-items:center;gap:10px;margin:4px 0}.ruler .lbl{width:26px;color:var(--fg2)}' +
    '.ruler .bar{background:var(--accent);border-radius:3px;width:44px;display:inline-block}' +
    '.btn{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;min-width:96px;padding:6px 12px;margin:4px;border-radius:6px;border:1px solid var(--bd);background:#fff;font-size:12px}' +
    '.btn.preferred{background:#0088ff;color:#fff;border-color:#0088ff}.btn.destructive{background:#ff383c;color:#fff;border-color:#ff383c}' +
    '.note{background:var(--soft);border-radius:10px;padding:12px 14px;margin:12px 0}' +
    '.darkbox{background:#1d1d1f;border-radius:10px;padding:14px;margin:8px 0;color:#f5f5f7}.darkbox .c{border-color:#3a3a3c;color:#f5f5f7}.darkbox small{color:#a1a1a6}.darkbox code{background:#2c2c2e;color:#f5f5f7}.darkbox .dot{border-color:rgba(255,255,255,.18)}' +
    extraCss + '</style></head><body><main>' +
    '<h1>macOS UI Kit 基线</h1>' +
    '<p><small>由 <code>docs/design/ui-kit/build.mjs</code> 从外部解包的 Apple UI Kit 生成 · Sketch v' + d.kit.version +
    ' · appVersion ' + esc(d.kit.appVersion) + ' · build ' + d.kit.build + ' · ' + d.kit.pages + ' 页 · ' + d.kit.fontReferences + ' 个字体引用。' +
    '<b>本页不含任何 Apple 字体或图像</b>，只有数值与名称。</small></p>' +

    '<div class="note"><b>为什么有这一页</b>：审查报告里凡涉及「Apple 官方数值」的结论，此前都只能标【判断，非实测】（HIG 页面是 SPA，抓不到正文）。' +
    '现在这些值从官方 UI Kit 里直接读出来，可复算、可回归。应用侧现值同表并列，差多少一眼可见。</div>' +

    '<h2>1 · 系统色（官方 12 色 × Light/Dark）</h2>' +
    '<table><thead><tr><th>色</th><th>Light</th><th>Dark</th><th>应用（浅色）</th><th>应用（深色）</th></tr></thead><tbody>' + systemGrid + '</tbody></table>' +
    '<p><small>比值是与官方窗口底色的 WCAG 对比度。<b>不一致</b>不等于"错"——强调色可能是刻意的品牌选择；但它必须是登记过的偏离，而不是被当成系统色。</small></p>' +

    '<h2>2 · 语义层：Labels / Fills / Separators / Grays</h2>' +
    '<h3>Labels（Light，压在官方浅色窗口底上）</h3><div class="grid">' + group(/^Labels\/Light\//, winLight.rgb, 'Light') + '</div>' +
    '<h3>Labels（Dark）</h3><div class="grid">' + group(/^Labels\/Dark\//, winDark.rgb, 'Dark') + '</div>' +
    '<h3>Fills（内容填充，1 Primary → 5 Quinary）</h3><div class="grid">' + group(/^Fills\/Light\//, winLight.rgb, 'Light') + '</div>' +
    '<div class="darkbox"><div class="grid">' + group(/^Fills\/Dark\//, winDark.rgb, 'Dark') + '</div></div>' +
    '<h3>Separators / Grays</h3><div class="grid">' + group(/^(Separators|Grays)\/Light/, winLight.rgb, 'Light') + '</div>' +
    '<p><small>注意 Labels 是<b>半透明黑</b>（@0.85 → @0.03 六档）而不是实色；应用用的是实色 #1d1d1f / #6e6e73，' +
    '这是「网页调色板 vs 原生语义色」的量化差别：换底色时半透明层会自动适配，实色不会。</small></p>' +

    '<h2>3 · 文字阶梯</h2>' +
    '<table><thead><tr><th>官方字号</th><th>行高</th><th>样式名</th><th>示例</th></tr></thead><tbody>' + typeRows + '</tbody></table>' +
    '<h3>应用现值（tokens.css）</h3><table><thead><tr><th>字号令牌</th><th>值</th></tr></thead><tbody>' + appTypeRows + '</tbody></table>' +
    '<div class="note"><b>⚠️ 本机没有 SF Pro</b>（已查字体注册表）：上面的字号示例会用回退字体渲染。字<b>号</b>是准的，字<b>形</b>不是。</div>' +

    '<h2>4 · 控件尺寸</h2>' +
    '<h3>Buttons：五档实测高度</h3>' + ruler +
    '<h3>Sidebars</h3><p>行高众数 <code>' + (d.controls.sidebar ? d.controls.sidebar.rowHeight + 'px' : '—') + '</code> · 面板宽众数 <code>' +
    (d.controls.sidebar ? d.controls.sidebar.panelWidth + 'px' : '—') + '</code>（' + (d.controls.sidebar ? d.controls.sidebar.n : 0) + ' 个组件）。' +
    '应用现状：侧栏 <code>220px</code>、导航行 <code>min-height:44px</code>。</p>' +
    '<h3>Alerts：按钮变体</h3><div>' + alerts + '</div>' +
    '<p><small>破坏性按钮在官方 kit 里是<b>填充红</b>（Light <code>' + dEST.l + '</code> / Dark <code>' + dEST.d + '</code>）+ 动词标签（' + dEST.t + '）；应用的「移出素材库」目前是蓝色描边。</small></p>' +

    '<h2>5 · 样式配方（共享图层样式 ' + d.layerStyles.total + ' 个：带阴影 ' + d.layerStyles.withShadow + ' · 带模糊 ' + d.layerStyles.withBlur + ' · 带描边 ' + d.layerStyles.withBorder + '）</h2>' +
    '<table><thead><tr><th>样式</th><th>填充</th><th>描边</th><th>阴影</th><th>模糊</th><th>不透明度</th></tr></thead><tbody>' + recipes + '</tbody></table>' +
    '<p><small>焦点环是<b>两层描边</b>（3.5px @0.25 + 1px @0.15），应用用的是单层 <code>outline:2px solid</code>——方向一致、配方不同。</small></p>' +

    '<h2>6 · 样式配方总目录（' + (d.components ? d.components.recipes.length : 0) + ' 条去重配方）</h2>' +
    '<p><small>' + (d.components ? d.components.total : 0) + ' 个组件去重后只剩 ' + (d.components ? d.components.recipes.length : 0) + ' 种外观 —— 变体多、配方少。下面是全部配方。</small></p>' +
    '<div class="rgrid">' + recipeCells + '</div>' +
    '<h2>7 · 组件家族（' + fams.length + ' 族 · 点名称跳到全量画廊）</h2>' +
    '<table><thead><tr><th>家族</th><th>组件数</th><th>不同样式</th></tr></thead><tbody>' + toc + '</tbody></table>' +
    '<h2>8 · 组件全量画廊（每一个组件都在这里）</h2>' +
    '<p><small>共 ' + (d.components ? d.components.total : 0) + ' 个组件，按族分组并全部展开。卡片为等比展示（宽高上限 168×56），真实尺寸写在每张卡片右下角。</small></p>' +
    gallery +
    '<h2>9 · kit 页清单（按 artboard 数，前 14）</h2>' +
    '<table><thead><tr><th>页</th><th>artboard</th></tr></thead><tbody>' + pageRows + '</tbody></table>' +

    '<h2>10 · 边界</h2><ul>' +
    '<li>这是 <b>UI Kit（外观与尺寸）</b>，不是 HIG 条款文本 —— 能替代"数值类"参照，不能替代"规则类"条文。</li>' +
    '<li>kit 内嵌的 SF 字体与图形资产<b>不得再分发</b>；本页只记录数值与名称，不含二进制资产。</li>' +
    '<li>材质页给的是<b>设计稿的透明实色</b>，不等于运行时 <code>backdrop-filter</code> 的合成结果。</li>' +
    '<li>控件尺寸取的是 symbolMaster 的 frame 众数；同一档若有多个取值会在表里列出，不四舍五入。</li>' +
    '</ul>' +
    '</main></body></html>\n'
}

// ---------------------------------------------------------------- 渲染：Markdown 生成区块
function renderDocBlock(d) {
  const sw = d.swatches
  const find = (re, ap) => sw.find((s) => re.test(s.name) && (!ap || new RegExp(ap, 'i').test(s.name)))
  const winL = find(/Window Background/, 'Light'), winD = find(/Window Background/, 'Dark')
  const hx = (c) => c ? '#' + [c.red, c.green, c.blue].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('') : '—'
  const SEM = [['1 Red', '--color-critical'], ['2 Orange', '--color-warning'], ['4 Green', '--color-success'], ['8 Blue', '--color-accent']]
  const sysRow = SEM.map(([n, tok]) => {
    const l = sw.find((s) => new RegExp('^System Colors/Light/' + n + '$').test(s.name))
    const k = sw.find((s) => new RegExp('^System Colors/Dark/' + n + '$').test(s.name))
    const app = d.app.colors[tok] || {}
    const ah = (x) => x ? hx({ red: x.r / 255, green: x.g / 255, blue: x.b / 255 }) : '—'
    return '| ' + n.replace(/^\d /, '') + ' | ' + tok + ' | ' + (l ? l.hex : '—') + ' | ' + (k ? k.hex : '—') + ' | ' + '\`' + ah(app.light) + '\` | ' + '\`' + ah(app.dark) + '\` | ' +
      (l && ah(app.light).toLowerCase() === l.hex ? '一致' : l && ah(app.light).toLowerCase() === k.hex ? '**用了深色档**' : '不一致') + ' |'
  }).join('\n')

  const sizes = [...new Set(d.textStyles.map((t) => t.size))].sort((a, b) => b - a)
  const typeRow = sizes.map((s) => {
    const t = d.textStyles.find((x) => x.size === s && /Default$/.test(x.name)) || d.textStyles.find((x) => x.size === s)
    const names = [...new Set(d.textStyles.filter((x) => x.size === s).map((x) => clean(x.name).split('/')[0].trim()))].join(' · ')
    return '| ' + s + 'px | ' + (t.lineHeight || '—') + ' | ' + names + ' |'
  }).join('\n')

  const kindCount = (k) => d.components.variants.filter((v) => (d.components.recipes[v[7]] || {}).kind === k).length
  const stSet = [...new Set(d.components.states.map((s) => (s.split(', ').pop() || '').trim()))].filter(Boolean).sort()
  const modSet = [...new Set(d.components.states.map((s) => s.split(', ').slice(0, -1).join(', ').trim()).filter(Boolean))].sort()
  const btnRow = d.controls.buttons.map((b) => '| ' + b.size + ' | ' + b.height + 'px | ' + b.n + ' | ' + b.distinct.join(',') + ' |').join('\n')
  const recRow = d.layerStyles.recipes.map((r) => '| ' + '\`' + r.name + '\`' + ' | ' + (r.fills.join(' ') || '—') + ' | ' + (r.borders.join(' ') || '—') + ' | ' + (r.opacity !== undefined ? a2(r.opacity) : '—') + ' |').join('\n')
  const alertRow = d.controls.alerts.map((a) => '| ' + clean(a.name).replace(/^[^A-Za-z]*/, '').replace(/\//g, ' / ') + ' | ' + a.w + '×' + a.h + ' | ' + (a.fill || '—') + ' |').join('\n')

  return [
    '<!-- BEGIN GENERATED：由 docs/design/ui-kit/build.mjs 生成，勿手改 -->',
    '',
    '**数据源**：Sketch v' + d.kit.version + ' · appVersion ' + d.kit.appVersion + ' · build ' + d.kit.build + ' · ' + d.kit.pages + ' 页 · ' +
      d.kit.fontReferences + ' 个字体引用 · 共享色板 ' + sw.length + ' · 共享文字样式 ' + d.textStyles.length + ' · 共享图层样式 ' + d.layerStyles.total + '。',
    '',
    '### A. 系统色（官方 vs 应用）',
    '',
    '| 色 | 应用令牌 | 官方 Light | 官方 Dark | 应用 Light | 应用 Dark | 判定 |',
    '|---|---|---|---|---|---|---|',
    sysRow,
    '',
    '### B. 文字阶梯（官方 8 档）',
    '',
    '| 字号 | 行高 | 样式名 |',
    '|---|---|---|',
    typeRow,
    '',
    '### C. 控件尺寸（官方实测）',
    '',
    '| 档 | 高度（众数） | n | 取值集合 |',
    '|---|---|---|---|',
    btnRow,
    '',
    '侧栏：行高众数 ' + (d.controls.sidebar ? d.controls.sidebar.rowHeight + 'px' : '—') + ' · 面板宽众数 ' + (d.controls.sidebar ? d.controls.sidebar.panelWidth + 'px' : '—') + '。',
    '',
    '### D. Alerts 按钮变体',
    '',
    '| 变体 | 尺寸 | 填充 |',
    '|---|---|---|',
    alertRow,
    '',
    '### E. 样式配方',
    '',
    '| 样式 | 填充 | 描边 | 不透明度 |',
    '|---|---|---|---|',
    recRow,
    '',
    '',
    '### F. 组件家族（' + d.components.total + ' 个组件 → ' + d.components.recipes.length + ' 种样式）',
    '',
    '| 外观来源 | 组件数 | 说明 |',
    '|---|---|---|',
    '| 形状（填充/描边/阴影） | ' + kindCount('shape') + ' | HTML 里可直接画出 |',
    '| SF Symbol 字形 | ' + kindCount('glyph') + ' | 外观是字形，本机无 SF 字体 ⇒ 无法可视化（HTML 里标为字形） |',
    '| 无外观层 | ' + kindCount('empty') + ' | 纯容器/嵌套符号 |',
    '',
    '| 家族 | 组件数 | 不同样式 |',
    '|---|---|---|',
    d.components.families.filter((f) => f.count > 0).sort((a, b) => b.count - a.count)
      .map((f) => '| ' + clean(f.page) + ' | ' + f.count + ' | ' + f.distinct + ' |').join('\n'),
    '',
    '### G. 状态与修饰词（原样保留，不归一）',
    '',
    '| 维度 | 取值 |',
    '|---|---|',
    '| 外观 | ' + d.components.appearances.join(' · ') + ' |',
    '| 表面 | ' + d.components.surfaces.join(' · ') + ' |',
    '| 尺寸档 | Mn · Sm · Rg · Lg · XL |',
    '| 状态段（去重 ' + stSet.length + ' 种） | ' + stSet.slice(0, 30).join(' · ') + (stSet.length > 30 ? ' …' : '') + ' |',
    '| 修饰词组合（去重 ' + modSet.length + ' 种） | ' + modSet.slice(0, 24).join(' · ') + (modSet.length > 24 ? ' …' : '') + ' |',
    '',
    '> **全量画廊在 HTML 里**：`docs/design/ui-kit/index.html` 的第 8 节把 **' + d.components.total + ' 个组件逐个**渲染出来（按族分组、全部展开）。',
    '',
    '<!-- END GENERATED -->',
  ].join('\n')
}

// ---------------------------------------------------------------- 写盘
const html = renderHTML(data)
fs.writeFileSync(HTML_FILE, html)
console.log('✓ 已生成 ' + HTML_FILE + '  (' + Math.round(html.length / 1024) + 'KB，静态、无 JS、无外链)')

let md = fs.readFileSync(DOC_FILE, 'utf8')
const block = renderDocBlock(data)
const BEGIN = '<!-- BEGIN GENERATED'
const END = '<!-- END GENERATED -->'
const b = md.indexOf(BEGIN), e = md.indexOf(END)
if (b >= 0 && e > b) {
  md = md.slice(0, b) + block + md.slice(e + END.length)
} else {
  md = md.replace(/\n?$/, '\n') + '\n' + block + '\n'
}
fs.writeFileSync(DOC_FILE, md)
console.log('✓ 已重写生成区块 → ' + DOC_FILE)
console.log('✓ 完成：kit-data.json / index.html / UI-KIT.md')
