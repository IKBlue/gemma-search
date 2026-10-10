# Apple 风格设计令牌 · gemma-search

> 本文档把此前两份成品（审查意见页、搜索结果界面）里实际用到的视觉值整理成令牌。
> 风格参照 Apple 的界面语言，**不是 Apple 官方规范**。标注“建议”的值是为补全体系新增的，页面里没有用到。

## 1. 设计原则

- **靠底色分层，少用阴影。** 白底与浅灰底交替，卡片用填充色差区分，阴影只留给需要“浮起”的控件。
- **一个强调色。** 蓝色只用于可操作的元素和选中态，红/橙只表示状态。
- **大标题、紧字距、宽留白。** 标题用 700 字重并收紧字距，正文保持 1.6 左右的行高。
- **材质克制。** 毛玻璃只用于吸顶导航，不做装饰。

## 2. 颜色

### 2.1 语义颜色

| 令牌 | 浅色 | 深色 | 用途 |
|---|---|---|---|
| `color.bg.primary` | `#ffffff` | `#000000` | 页面与主内容区底色 |
| `color.bg.secondary` | `#f5f5f7` | `#161617` | 交替分区、侧栏、输入框、胶囊 |
| `color.bg.elevated` | `#ffffff` | `#1d1d1f` | 卡片（放在 secondary 之上时） |
| `color.text.primary` | `#1d1d1f` | `#f5f5f7` | 标题、正文 |
| `color.text.secondary` | `#6e6e73` | `#a1a1a6` | 说明文字、元信息、次要导航 |
| `color.separator` | `#d2d2d7` | `#424245` | 分割线、导航底线 |
| `color.separator.subtle` | `#e5e5ea` | `#2c2c2e`（建议） | 卡片描边、侧栏右边线 |
| `color.accent` | `#0071e3` | `#2997ff` | 链接、按钮文字、相关度分数、选中态 |
| `color.selection` | `#e4e4ea` | `#2c2c2e`（建议） | 侧栏当前项底色 |
| `color.status.critical` | `#ff3b30` | `#ff453a`（建议） | 高优先级标记、错误 |
| `color.status.warning` | `#ff9f0a` | `#ff9f0a` | 中优先级标记、警告 |
| `color.status.success` | `#34c759`（建议） | `#30d158`（建议） | 完成、通过 |
| `color.glass` | `rgba(255,255,255,.72)` | `rgba(22,22,23,.72)` | 吸顶导航底色，配合模糊 |

### 2.2 组件级颜色

| 令牌 | 值 | 说明 |
|---|---|---|
| `color.chip.active.bg` / `.fg` | `#1d1d1f` / `#ffffff` | 选中的分类胶囊，深色模式下反相 |
| `color.on-accent` | `#ffffff` | 蓝色实心圆（步骤序号）上的文字 |
| `color.window.close` / `.min` / `.max` | `#ff5f57` / `#febc2e` / `#28c840` | 窗口三色点，仅桌面壳使用 |

### 2.3 缩略图占位色（仅原型）

`#dfe7ee` · `#ece6dc` · `#e3ebe4` · `#eadfe6` · `#e6e6ea` · `#f0e3d8` · `#dce6ea` · `#e9e9dd`

低饱和平色块，真实缩略图接入后删除。

### 2.4 对比度

- `text.secondary` 在白底约 4.9:1，`accent` 在白底约 4.7:1，均满足正文 4.5:1。
- 在 `bg.secondary` 上，次要文字对比度会略降，字号不要小于 13px。
- 状态只靠颜色区分不够，红/橙标记旁必须有文字。

## 3. 字体

### 3.1 字体族

| 令牌 | 值 |
|---|---|
| `font.family.sans` | `-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei", Helvetica, Arial, sans-serif` |
| `font.family.mono` | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` |

注意：

- 此前两个页面的字体栈没有 `Segoe UI` 两项。目标环境是 Windows 上的 Electron，`-apple-system` 和 SF Pro 在 Windows 上都不存在，加上 Segoe UI 能让西文更接近 SF 的观感。
- SF 字体有授权限制，不要随应用分发，只让它在 Apple 平台上作为系统字体自然生效。

### 3.2 字号阶梯

| 令牌 | 字号 | 行高 | 字重 | 字距 | 用途 |
|---|---|---|---|---|---|
| `type.display` | `clamp(40px, 8vw, 80px)` | 1.05 | 700 | -0.025em | 页面主标题 |
| `type.title1` | `clamp(30px, 5vw, 48px)` | 1.1 | 700 | -0.02em | 分区标题 |
| `type.title2` | 24px | 1.25 | 600 | -0.01em | 卡片标题 |
| `type.lede` | `clamp(19px, 2.6vw, 24px)` | 1.4 | 500 | 0 | 标题下的导语 |
| `type.body` | 17px | 1.6 | 400 | 0 | 文档正文 |
| `type.body.app` | 16px | 1.5 | 400 | 0 | 搜索框输入 |
| `type.callout` | 14px | 1.4 | 400 / 600 | 0 | 导航项、卡片包名 |
| `type.caption` | 13px | 1.4 | 400 | 0 | 元信息、胶囊、小按钮 |

字重只用 400 / 500 / 600 / 700 四档。中文字距收紧要谨慎：只对大标题使用负字距，14px 以下一律为 0。

## 4. 间距与布局

### 4.1 间距阶梯（4pt 基准）

| 令牌 | 值 | 常见用法 |
|---|---|---|
| `space.1` | 4px | 图标与文字的最小间隙 |
| `space.2` | 8px | 胶囊之间、窗口三色点之间 |
| `space.3` | 12px | 导航项内边距、卡片内小间隙 |
| `space.4` | 16px | 卡片内边距、控件之间 |
| `space.5` | 20px | 卡片之间、页面左右边距 |
| `space.6` | 24px | 卡片内边距（中） |
| `space.8` | 32px | 工具栏左右边距、大卡片内边距 |
| `space.12` | 48px | 小分区上下间距 |
| `space.16` | 64px | 移动端 hero 上下间距 |
| `space.18` | 72px | 桌面分区上下间距 |
| `space.24` | 96px | 桌面 hero 顶部间距 |

现有页面里还出现了 14、18、22 这类不在阶梯上的值，接入时建议就近取整到 16、20、24。

### 4.2 布局

| 令牌 | 值 |
|---|---|
| `layout.content.max` | 980px（文档类页面） |
| `layout.page.padding` | 22px，≤640px 时 18px |
| `layout.section.padding` | 72px，≤640px 时 56px |
| `layout.sidebar.width` | 220px |
| `layout.nav.height` | 48px（吸顶导航） |
| `layout.grid.min-card` | 240px，`auto-fill` 列，间距 20px |

## 5. 圆角

| 令牌 | 值 | 用途 |
|---|---|---|
| `radius.sm` | 8px | 导航项、文字按钮 |
| `radius.md` | 10px | 分段控件外框（内部按钮 8px） |
| `radius.lg` | 12px | 搜索框 |
| `radius.xl` | 16px | 结果卡片 |
| `radius.2xl` | 24px，≤640px 时 20px | 文档页大卡片 |
| `radius.pill` | 999px | 分类胶囊 |
| `radius.circle` | 50% | 状态圆点、序号圆、窗口三色点 |

规则：容器圆角大于其内部元素，层级越高圆角越大。

## 6. 描边、阴影与材质

| 令牌 | 值 | 用途 |
|---|---|---|
| `shadow.outline` | `0 0 0 1px var(--color-separator-subtle)` | 卡片的 1px 描边，代替投影 |
| `shadow.control` | `0 1px 2px rgba(0,0,0,.12)` | 分段控件里被选中的白色滑块 |
| `material.glass` | `backdrop-filter: saturate(180%) blur(20px)` | 吸顶导航，叠加 `color.glass` 和 1px 底线 |

没有其他阴影。需要浮起（弹窗、菜单）时再新增，不要给每张卡片都加。

## 7. 控件尺寸

| 令牌 | 值 |
|---|---|
| `control.touch.min` | 44px（所有可点击元素的最小高度） |
| `control.search.height` | 44px，圆角 `radius.lg` |
| `control.segment.height` | 38px，外框内边距 3px |
| `control.chip.padding` | 9px 16px |
| `control.focus.ring` | `2px solid var(--color-accent)`，偏移 3px |
| `control.icon.size` | 18px，描边 2px，圆头线帽，颜色 `text.secondary` |

## 8. 动效

- 不做进入动画和悬停位移，只有响应操作的变化（展开、选中）才用动效。
- 锚点滚动用 `scroll-behavior: smooth`。
- 必须尊重 `prefers-reduced-motion: reduce`，此时关闭平滑滚动和所有过渡。

## 9. 可访问性约定

- 可点击的一律用真实的 `button` 或 `a`，不在 div 上挂点击。
- 只有图标的按钮必须有 `aria-label`；装饰图标加 `aria-hidden="true"`。
- 键盘焦点必须可见，使用 `control.focus.ring`。
- 浅色、深色两套都要过一遍对比度，不要只检查浅色。

## 10. 可直接使用的 CSS 变量

```css
:root {
  /* color */
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #f5f5f7;
  --color-bg-elevated: #ffffff;
  --color-text-primary: #1d1d1f;
  --color-text-secondary: #6e6e73;
  --color-separator: #d2d2d7;
  --color-separator-subtle: #e5e5ea;
  --color-accent: #0071e3;
  --color-selection: #e4e4ea;
  --color-critical: #ff3b30;
  --color-warning: #ff9f0a;
  --color-success: #34c759;
  --color-glass: rgba(255, 255, 255, .72);

  /* type */
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC",
    "Hiragino Sans GB", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei",
    Helvetica, Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  /* space */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-12: 48px;
  --space-16: 64px; --space-18: 72px; --space-24: 96px;

  /* radius */
  --radius-sm: 8px;  --radius-md: 10px; --radius-lg: 12px;
  --radius-xl: 16px; --radius-2xl: 24px; --radius-pill: 999px;

  /* shadow & control */
  --shadow-outline: 0 0 0 1px var(--color-separator-subtle);
  --shadow-control: 0 1px 2px rgba(0, 0, 0, .12);
  --touch-min: 44px;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg-primary: #000000;
    --color-bg-secondary: #161617;
    --color-bg-elevated: #1d1d1f;
    --color-text-primary: #f5f5f7;
    --color-text-secondary: #a1a1a6;
    --color-separator: #424245;
    --color-separator-subtle: #2c2c2e;
    --color-accent: #2997ff;
    --color-selection: #2c2c2e;
    --color-critical: #ff453a;
    --color-success: #30d158;
    --color-glass: rgba(22, 22, 23, .72);
  }
}

:root[data-theme="dark"] {
  --color-bg-primary: #000000;
  --color-bg-secondary: #161617;
  --color-bg-elevated: #1d1d1f;
  --color-text-primary: #f5f5f7;
  --color-text-secondary: #a1a1a6;
  --color-separator: #424245;
  --color-separator-subtle: #2c2c2e;
  --color-accent: #2997ff;
  --color-selection: #2c2c2e;
  --color-critical: #ff453a;
  --color-success: #30d158;
  --color-glass: rgba(22, 22, 23, .72);
}
```

## 11. 映射到 Tailwind + shadcn/ui

任务计划书选定的技术栈是 Tailwind + shadcn/ui。shadcn/ui 通过一组固定名字的 CSS 变量取色，可以按下表把令牌接进去。颜色格式（hex、HSL 或 oklch）按所用版本的约定填写。

| shadcn/ui 变量 | 令牌 |
|---|---|
| `--background` | `color.bg.primary` |
| `--foreground` | `color.text.primary` |
| `--card` | `color.bg.elevated` |
| `--card-foreground` | `color.text.primary` |
| `--muted` | `color.bg.secondary` |
| `--muted-foreground` | `color.text.secondary` |
| `--primary` | `color.accent` |
| `--primary-foreground` | `color.on-accent` |
| `--accent` | `color.selection` |
| `--accent-foreground` | `color.text.primary` |
| `--destructive` | `color.status.critical` |
| `--border` / `--input` | `color.separator-subtle` |
| `--ring` | `color.accent` |
| `--radius` | `radius.lg`（12px），其余圆角由它推导 |

## 12. 使用与维护

- 新增值之前先找最近的现有令牌，找不到再加，并标注来源。
- 改令牌只改本文件和变量表，不要在组件里写死十六进制。
- 本文件与 `UI-REVIEW-and-migration.md` 的关系：UI 评审说“做什么界面”，本文件说“长什么样”。二者冲突时以评审文档的信息架构为准、以本文件的视觉值为准。
