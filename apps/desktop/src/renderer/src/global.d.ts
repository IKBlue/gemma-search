// src/renderer/src/global.d.ts —— 渲染层的**环境声明**（只声明「外部世界长什么样」，不含运行时代码）
//
// 为什么需要：转 .tsx 之后 `tsc` 才开始检查渲染层，于是两类「一直存在、只是以前没被检查」的事情暴露出来：
//   ① CSS 的副作用 import（`import './renderer.css'`）没有类型 ⇒ TS2882；
//   ② `import.meta.glob` 是 **Vite** 提供的（只在构建/开发期由 Vite 注入），不是标准 ESM 的一部分。
//
// ⚠️ 这两条都**不是**用逃逸注释糊过去的：声明的类型与真实实现一一对应 ——
//    CSS 模块确实只有副作用（Vite 会把它变成 <style>），glob 确实返回
//    「构建期固化的路径 → 动态 import」的映射。
declare module '*.css' {
  /** Vite 处理 CSS：模块本身无导出，只有副作用（注入样式） */
  const css: void
  export default css
}

/**
 * Vite 的 `import.meta.glob`（**构建期**替换成静态映射）。
 *
 * 类型刻意写得比 Vite 的完整签名**窄而准**：本仓库只用它挂载 `pages/` 与 `ui/` 下的组件，
 * 所以返回值就是「源码相对路径 → () => Promise<模块>」。
 * `eager` 等选项本仓库没有用到，不在这里铺开（YAGNI，也不必假装支持）。
 */
interface ImportMeta {
  glob(pattern: string): Record<string, () => Promise<unknown>>
}
