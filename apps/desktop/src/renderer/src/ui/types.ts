// ui/types.ts —— UI 层的**共享 props 形状**（纯类型，无运行时代码）
//
// 为什么单独一个文件（而不是每个组件各写一份，也不是从 store 里 import 类型）：
//   · 这些 props 形状在 Button / Chip / Field / … 之间反复出现，写在各自文件里就是 P2（复制粘贴）；
//     写一份、被 import，才是「同一件事一处定义」。
//   · 也**不从 store/ 拿类型**：那会让 UI 层反向依赖 Operation 层的数据结构。
//     这里声明的是**最小结构类型** —— Operation 层传来的数据天然满足它，不需要断言、也不需要转换。
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';

// 组件名（HTML 属性类型在 @types/react 里是接口，import 后可直接当类型用）
export type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes };

/**
 * 组件自己的属性 **全部可选**。
 *
 * 为什么必须这么写：HTML 属性类型里有 `defaultChecked` / `value` 这类**必填**成员，
 * 直接写 `Props & ButtonHTMLAttributes<…>` 会让「不传这些属性」变成类型错误 —— 而那正是这些组件最常见的用法。
 * `Partial<>` 保留全部合法属性、只把必填降为可选。
 */
export type UiAttrs<T> = Partial<T> & { children?: ReactNode };

/** `<select>` / `<input>` 这类原生控件被 Field 包一层时的属性形状 */
export type UiFieldAttrs = UiAttrs<SelectHTMLAttributes<HTMLSelectElement>> &
  Partial<InputHTMLAttributes<HTMLInputElement>>;

/** 索引状态徽标：`{key,label,tone,hint}`（判定在 utils/index-state.ts，UI 只吃结果） */
export type UiIndexState = { key: string; label: string; tone: string; hint: string };

/** 侧栏导航项 */
export type UiNavItem = {
  key: string;
  icon: string;
  label: string;
  to?: string;
  /** 未实现项的阶段说明（`P3d` 这类），有 `to` 时不用 */
  phase?: string;
};
