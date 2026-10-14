# 证据 · radix-ui 统一包 spike（T-02）

> 日期：2026-10-14 · 类型：**本轮实测** · 结论：**通过，采用统一包**
> 原始输出：`npm-test.txt` · `build.txt` · `e2e-dialog-a11y-styles.txt`

## 要解决什么

旧代码装的是**分散包** `@radix-ui/react-alert-dialog` + `@radix-ui/react-slot`（裸用 Radix，不是 shadcn 封装）。
shadcn/ui v4 的模板统一定义在**一个包** `radix-ui` 上，因此改为统一包并删除分散包 —— 避免"装了一堆却零 import"的老毛病。

## 做了什么

1. `npm install radix-ui@1.8.1`；`npm uninstall @radix-ui/react-alert-dialog @radix-ui/react-slot`
2. `ui/Button.jsx`：`import { Slot } from 'radix-ui'`
3. `ui/ConfirmDialog.jsx`：`import { AlertDialog } from 'radix-ui'`（`AlertDialog.Root` 等用法不变）
4. 更新断言 `dom-validity.test.mjs` 的 V3：改钉 `radix-ui`，并**新增两条**（不许回去引分散包；必须渲染 `Slot.Root`）

## ⚠️ 过程中抓到一个真 BUG（这条是本次 spike 最有价值的产出）

第一版把 `<Slot>` 直接渲染 ⇒ **React #130（Element type is invalid … got: object）⇒ 任务页整页白屏**，
a11y 的 **E5-b** 稳定复现（不是 flake）。

**根因**：统一包把每个原语导出成**命名空间对象**，实测：
`~
typeof Slot        = object  keys = Root, Slot, Slottable, createSlot, createSlottable
typeof AlertDialog = object  keys = Root, Trigger, Portal, Overlay, Content, Title, Description, Action, Cancel …
`~
⇒ `<Slot>` 渲染的是那个对象本身。**正确写法是 `<Slot.Root>`**（AlertDialog 那边因为一直用 `AlertDialog.Root`，反而没事）。
已修复，并把这条写成断言（`<Slot.Root>` 必须存在、`<Slot >` 不许出现）——**它当场就能红**。

## 结果

| 门禁 | 结果 |
|---|---|
| `npm test` | ✅ **313 · 312 · 0 · 1**，EXIT=0 |
| `npm run build` | ✅ EXIT=0（单 chunk **1174.13 → 1161.43 KB，−12.7 KB**） |
| `npm run e2e -- a11y confirm-dialog styles` | ✅ **15 passed**（含 E5-b 白屏用例、确认框 ESC/焦点陷阱/焦点归还、样式令牌） |

## 结论

采用 `radix-ui@1.8.1`，`package.json` 不再有分散的 `@radix-ui/react-*`。
