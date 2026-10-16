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
  const css: void;
  export default css;
}

/**
 * Vite 的 `import.meta.glob`（**构建期**替换成静态映射）。
 *
 * 类型刻意写得比 Vite 的完整签名**窄而准**：本仓库只用它把 `pages/` 与 `ui/` 下的组件
 * 收集成「源码相对路径 → 模块」，**两种形态各对应一条腿**（见 `main.tsx` 的 glob 分组注释）：
 *
 *   · **非 eager**（默认）⇒ `路径 → () => Promise<模块>`：**按需加载**。
 *     现用于**路由页**（`ROUTE_PAGES`），配合 `router/index.tsx` 的 `React.lazy` 切出 route chunk。
 *   · **eager: true** ⇒ `路径 → 模块`：构建期就求值好（**静态**，进主 chunk）。
 *     现用于**非路由页**（`STATIC_PAGES`）与被各页静态引用的 `ui/*`（`COMPONENTS`）。
 *
 * ⚠️ 两种形态**同时**存在不是"类型放宽"，而是**如实描述两个不同的 glob**——
 *    谁用哪一种由「这个模块的另一条腿是静态还是动态」决定，规则见 main.tsx 的长注释。
 *    声明与实现不符时 `tsc` 会当场红（BUILD-2 改 eager 时就先红在这里：TS2554），
 *    这正是这条声明该有的作用。
 */
interface ImportMeta {
  /** 非 eager（默认）：按需加载 —— 返回「路径 → () => Promise<模块>」 */
  glob(pattern: string | string[]): Record<string, () => Promise<unknown>>;
  /** eager：构建期求值 —— 返回「路径 → 模块」 */
  glob(pattern: string | string[], options: { eager: true }): Record<string, unknown>;
}
