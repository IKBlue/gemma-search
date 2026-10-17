// src/renderer/src/global.d.ts —— 渲染层的**环境声明**（只声明「外部世界长什么样」，不含运行时代码）
//
// 为什么需要：转 .tsx 之后 `tsc` 才开始检查渲染层，于是 CSS 的副作用 import（`import './renderer.css'`）
// 没有类型 ⇒ TS2882。这里只做那一条声明。
//
// ⚠️ 2026-10-17（U33）：原文件还声明了 Vite 的 `import.meta.glob`（两种形态：非 eager / eager），
//    因为 `main.tsx` 用它给 `window.__DSH_RENDER` 收集组件。钩子已按所有者决定删除
//    （全仓零消费者，见 `main.tsx` 的注释）⇒ 该声明**也一并删除**，不留「零调用的能力声明」，
//    否则下一个读到这里的人会以为仓库里还有 glob。下次真要用 `import.meta.glob` 时按 Vite 文档重新声明即可。
declare module '*.css' {
  /** Vite 处理 CSS：模块本身无导出，只有副作用（注入样式） */
  const css: void;
  export default css;
}
