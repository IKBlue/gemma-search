// App —— 应用根
//
// 加页面的方式见 apps/desktop/src/renderer/README.md：写 pages/XxxPage.jsx，共用 ui/ 与 layout/。
//
// 这里先过一道 LibraryGate（D2 修复）：**没有库就先显示首启向导**，
// 而不是把用户丢进一个必然报 LIB_NOT_FOUND 的检索界面。
import LibraryGate from './pages/LibraryGate.tsx';

export default function App() {
  return <LibraryGate />;
}
