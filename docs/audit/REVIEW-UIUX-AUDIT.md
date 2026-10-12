# REVIEW-UIUX-AUDIT · 独立复核 ②

- 复核人：`review-2`（任务 `task-4`），**未参与** `UIUX-AUDIT.md` 的写作
- 复核对象：`UIUX-AUDIT.md`（作者 `uiux-auditor`，任务 `task-2`）；实测 **86,906 B / 676 行**（`node` 读取；任务书上写的「414 行」不准确，我按全文 676 行复核）
- 证据附录：`docs/audit/uiux-evidence.md`（660 行，已通读）
- 判据：`docs/audit/01-acceptance-criteria.md` §2 G1-G7、§3 严重度、§5 U1-U10、§7 独立复核
- 共同事实基准：`docs/audit/00-current-state.md`
- 复核环境：Windows / Node v24.14.0；仓库工作区与本轮审查一致（`UIUX-AUDIT.md` / `uiux-evidence.md` 为未跟踪新增文件）
- 复核方式：**自己 `read`/`read_image` 回原文件**、**自己重跑守卫**、**自己复算 WCAG**、**自己查字体注册表**、**自己 `web_fetch` 原 URL 与镜像**
- 只读声明：本次复核**只创建本文件**；未修改 `UIUX-AUDIT.md`、`docs/audit/uiux-evidence.md` 或任何源码/静态资源/配置。

---

## 0. verdict

**`verdict: pass-with-issues`**

> **第二轮复核已完成（作者已处置 B1-B4 + m1-m5）→ `verdict_round2 = pass`，`blockers_round2 = []`。见文末 §10。**
> 本节 §0–§9 是**第一轮**的原始记录，保留不改，以便追溯每条 blocker 的发现与处置过程。

**一句话**：这份报告是我这轮见过证据密度最高的一份 —— 我抽查的 **10 组引用行号全部逐字命中**，我独立复算的 **7 组对比度全部精确到小数点后两位**，我独立验证的 **Apple 官方色值 8 组全部与镜像逐位一致**（含 `#FF383C` / `#0088FF` 这类不凭记忆能写对的值）。**没有任何实质性结论被推翻**，所以不是 `fail`。

但存在 **4 条必须修正的 blocker**，其中 3 条是**同一类问题**：报告在正文里使用了它自己的"出处清单"声称不存在的来源（§4.2 的 Apple 字号数值），或把计数口径写错（U-13 的"21 个**不同**字面量"），或漏掉了这条问题真正的契约层（U-01 未引 `CONTRACT-engine-v1.md:107`，且给出的修法仍然违反该契约）。按判据 §7，blockers 清零前本报告不能记为 `pass`。

| 维度 | 结论 |
|---|---|
| 实质性结论是否成立 | **全部成立**（U-01/U-03/U-04/U-05/U-06/U-13/U-16/U-17/U-20 均核实） |
| Apple/HIG 出处是否真实 | **真实且数值一致**（详见 §7） |
| 是否用主观形容词替代证据 | **没有**（U9 通过，见 §5 G2/G7 与 §6 R6） |
| 行号可追溯性 | **抽查 10/10 命中** |
| 计数准确性 | 2 处口径错误（U-13、U-20）+ 1 处标题数字（U-02） |

---

## 1. blockers[]

> 「必须修正才能通过」= 结论/证据链上确有错误，或修复方向本身是错的。已按严重度排序。

### B1 · §4.2 的 Apple 字号数值在报告内**无出处**，且它的出处被报告自己描述成"没有数值表"

- **报告位置**：`UIUX-AUDIT.md:130-139`（§4.2 字号阶梯表的"有无 Apple 阶梯依据"列），配合 `:616`（证据附录 §9 "未取到的"段）与 `docs/audit/uiux-evidence.md:612`（M4 行）。
- **为什么不成立**：§4.2 逐档写下 **"HIG macOS `Large Title` 常见为 26pt"、"macOS body 为 13pt，iOS body 为 17pt"、"macOS **Body = 13pt**"、"macOS Callout = 12pt，iOS = 16pt"、"HIG 里 11pt 属 Caption 系列"** —— 这是 5 个具体的 Apple 官方 pt 值。而：
  - 证据附录 §9 的 M4 行把 `typography.md` 描述为「条文版（**无字号数值表**）」；
  - 证据附录 §9 的"未取到的"段又写「本报告**没有**把 macOS 文本样式的具体 pt 值当作"Apple 官方数值"来断言」；
  - §4.2 的表格却把它们当作官方依据在与仓库值逐档对差。
  三处互相矛盾。**数值本身是对的**（我核对了 `typography.md`，见 §3 S6 / §7，26/13/17/12/16/11 全部命中），但报告正文没有为它们写出来源，读者无法判断这是镜像转述还是凭记忆 —— 判据 U2 要求的正是"Apple 那一侧数值**有没有出处**"。
- **必须怎么改**：① 把 §4.2 每个 HIG pt 值标注到 B2（`developer.apple.com/…/typography`）+ 镜像 `hig-doctor/skills/hig-foundations/references/typography.md`；② 把证据附录 §9 M4 行的「无字号数值表」改成如实描述（该文件含 iOS/macOS/tvOS/watchOS 的完整文本样式规格表与 tracking 表）；③ 删掉或改写 §9「没有把 macOS 文本样式的具体 pt 值当作 Apple 官方数值来断言」这句 —— 与 §4.2 直接冲突。

### B2 · U-01 漏掉了这条问题真正的契约层，且给出的**修复方向本身违反契约**

- **报告位置**：`UIUX-AUDIT.md:203-218`（U-01 全文），尤其 `:217`（"改哪里"）。
- **为什么不成立**：
  - 全篇 **没有一处引用 `docs/spec/CONTRACT-engine-v1.md`**（我 grep `CONTRACT|契约`，只有 `:326` 的 `MetricsRow` 下标与 `:664` 的 D5 两处，都与本问题无关）。而该契约 **`:107` 明文**规定：`"band": "high" | "mid" | "low",  // 分数区间由共享常量定义，**界面不自己算阈值**`；**`:114`** 又规定「`band` 由引擎按**同一模态内**的区间给出」。引擎确实照做了（`core/engine.mjs:226` `band: bandOf(r.score, mode)`）。所以这不是"四套阈值谁对谁错"的选型问题，而是**渲染层违反了一处书面契约、并且完全无视引擎已经算好的 `band`**（`item.band` 在源码中 0 命中 —— 我独立核实：全仓源码 0 处，仅 4 处在 `.md` 里被引用为该发现本身）。
  - 更关键：报告 `:217` 的修法是「把单一阈值换成带 `mode` 的档位表：图→图用 0.88，文本→图用 0.74~0.80 三段」。**这仍然是"界面自己算阈值"**，换汤不换药，`item.band` 依旧不被消费。按此修完，`CONTRACT-engine-v1.md:107` 依然被违反。判据 G5 要的是可执行**且方向正确**的建议。
- **必须怎么改**：① 在 U-01 的"证据"里补 `CONTRACT-engine-v1.md:107` 与 `:114` 两行原文，把问题定性从"四套定义并存"升级为"**契约违反 + 引擎产出被丢弃**"；② 把"改哪里"改成 `Score.jsx` 改为**消费 `item.band`**（`high|mid|low` 映射到文案），阈值表留在引擎侧的共享常量里；③ 对应地把 U-01 的验收断言从"fixture 的 band 改成 same|like|weak"改成"**界面不再出现任何数值阈值判断，score=0.80 且 band='high' 时渲染文本不得含『较弱』**"。现有 `tools/verify_renderer_dom.mjs:78,80,83` 的 fixture 本来就已经给了 `band`，正是为此准备的。

### B3 · U-13 / §4.1 把"**21 次出现**"写成"**21 个不同字面量**"，且证据附录自身自相矛盾

- **报告位置**：`UIUX-AUDIT.md:124`（§4.1「合计 **21 个不同颜色字面量**」）、`:338-347`（U-13，标题「原型 **21 个**硬编码色值」、正文「合计 **21 个不同字面量**」）、`:589`（§11.3「21 个硬编码色值」）；证据 `docs/audit/uiux-evidence.md:355-362`。
- **为什么不成立**（我重跑，原始输出见 §3 S7）：
  - `static/prototype/*.html`（7 个文件）里的颜色字面量：**出现 21 次**，但**去重后只有 6 个不同值**：`#858aff / #8b91a0 / #8b91ff / #c4c7d0 / #a56a12 / #454b58`。
  - 证据附录 §4.1 自己列出的是**逐页明细**（每页的值列表），其逐页计数之和 = 5+5+4+3+2+1+1 = **21（次数）**，紧接着却写「合计**去重后**不同字面量： 21」—— **同一行的两个概念打架**。
  - 主报告 §4.1 的枚举（`#858aff`4页 + `#8b91ff`5页 + `#c4c7d0`7页 + `#a56a12`2页 + `#454b58`2页）合计 **20 次**，**漏了 `#8b91a0`**（证据附录其实列了它：`语义搜索.html`）。
- **为什么仍要列为 blocker**：这不是措辞问题 —— 一个以"精确计数"立身的报告，在一条编号问题里把"出现次数"与"去重值个数"混为一谈，并且该数字被 §4.1 / U-13 / §11.3 / §12 四处复用。**结论方向不受影响**（原型确有硬编码色值，`UI-REVIEW:271` 的"0 处"确实是假的，守卫确实不含 `static/prototype/`），U-13 的 Low 定级也可复算，所以不构成 `fail`。
- **必须怎么改**：四处统一为「**21 处**（出现）· **6 个**不同字面量」，并在 §4.1 枚举里补上 `#8b91a0`；证据附录 §4.1 末行改为「出现 21 处 / 去重 6 个」。

### B4 · G3 自称"与基线零冲突"，但 U-01 的定级与基线 §5.1.1 明文冲突且未处置

- **报告位置**：`UIUX-AUDIT.md:655`（§14 G3 自检行：「**未发现与基线冲突的结论**」）。
- **为什么不成立**：基线 `docs/audit/00-current-state.md:146` 对**同一个**发现明写：
  > 定级：契约违反 + 用户可感知的错误结论 ⇒ **High（Score 6）**。
  而报告 U-01 判 **Critical 9**。两者对同一事实给出不同等级，报告没有提到这句话、也没有说明为什么上调。更麻烦的是基线自身不一致：`:115`（D11 行）又写「第②条审查独立发现同一处，判 **Critical 9**，含截图实证」。所以基线里"High 6"与"Critical 9"并存，**报告有义务显式指出并请 Lead 裁决**（`00-current-state.md` 只有 Lead 能改），而不是在 G3 里宣称零冲突。
- **我自己的复算见 §4 S-R1：我独立得出 9 / Critical**，与报告一致，与基线 `:146` 不一致。所以这是**基线需要 Lead 回写**，而**报告需要如实登记分歧**。
- **必须怎么改**：§14 G3 行改为「部分满足」，并新增一条"与基线的定级分歧"，指明 `00-current-state.md:146`（High 6）与 `:115`（Critical 9）互相矛盾，请 Lead 统一。

---

## 2. minor_issues[]（不阻塞通过，但应一并修正）

| # | 位置 | 问题（已独立核实） |
|---|---|---|
| m1 | `UIUX-AUDIT.md:220`（U-02 标题）、`:66`（§2.4） | 标题写「文档要求 **6 项**，实现 1 项」，但 `UI-REVIEW-and-migration.md:211` 实际列 **5 项**（`↑↓←→` 选 · `Enter` 定位 · `Ctrl+C` 复制包路径 · `Esc` 清空 · `空格` 预览），`DESIGN-app-details.md:75-83` 表格是 **7 行**（+ `:85-86` 的拖放/粘贴 2 条），而 U-02 正文自己又列了 **7 项**、§7 写「**6-7** 项」。4 个数字互不相等，应统一为"UI-REVIEW 5 项 / DESIGN-app-details 7 项 + 2 条（拖放/粘贴）"。 |
| m2 | `UIUX-AUDIT.md:413` | 「其余 30 个属结构性未使用：…（**13 个**旧变量桥接）」——`tokens.css:135-150` 的旧变量桥接实为 **16 个**（`--bg/--panel/--text/--muted/--line/--line-strong/--accent/--accent-soft/--green/--green-soft/--amber/--amber-soft/--warning/--danger/--danger-soft/--ink-2`）。报告自己的证据附录 `uiux-evidence.md:510` 写的是正确的 **16**。另"其余 30 个"与其后枚举（13+4+1+3+1+4=26）不能加总。 |
| m3 | `UIUX-AUDIT.md:298,326,386,390` 等 | `useSearch.js` 一律只写 basename。该文件实际在 `src/renderer/src/hooks/useSearch.js`（**不是** `search/`；`src/renderer/src/search/useSearch.js` 不存在，`node` 报 ENOENT）。basename 全仓唯一故仍可检索到，但同报告其它条目都给全路径，此处不一致，建议补全。 |
| m4 | `UIUX-AUDIT.md:216,298` | 「全仓 grep `item.band` 0 命中」措辞过宽：源码 0 命中属实，但 `.md` 里另有 4 处（`AUDIT-FINAL.md:77,118`、`00-current-state.md:115,142`）。建议写"源码 0 命中"。（结论不受影响。） |
| m5 | `UIUX-AUDIT.md:223` | 「`DESIGN-app-details.md:75-83` 同样 7 条（**另加 `Ctrl+Shift+C` 取件**、整窗拖放、`Ctrl+V` 粘图）」——`Ctrl+Shift+C` **本来就在** `:75-83` 的表内（`:81`），不是"另加"。 |

---

## 3. spot_checks[]（我跑的命令 / 我读的文件行 / 原始输出 / 是否支持）

### S1 · U-01「四套互不相同的阈值定义」——**支持**

- 读 `src/renderer/src/ui/Score.jsx:2-7`：

```js
export function bandOf(score) {
  const s = Number(score)
  if (s >= 0.97) return 'same'
  if (s >= 0.93) return 'like'
  return 'weak'
}
```
→ 与报告「`≥0.97` same / `≥0.93` like / else weak」**逐字一致**。

- 读 `tools/verify_renderer_dom.mjs:78,80,83`：

```js
78:  score: 0.9312, band: 'high', …
80:  score: 0.81,   band: 'mid', …
83:  score: 0.5,    band: 'low', …
```
→ 与报告「fixture `0.9312`=high / `0.81`=mid / `0.5`=low」**逐字一致**；`high|mid|low` 与 `same|like|weak` 两个值域确实不相交。

- 读 `static/_archive/app-ui-mockup.html:592-603`（报告引 594 / 600）：

```js
592: function band(score, m) {
593:   if (m === 'text') {
594:     if (score >= 0.78) return ['same','很接近'];
595:     if (score >= 0.74) return ['like','同类'];
596:     if (score >= 0.65) return ['weak','较弱'];
597:     return ['weak','可能没有'];
598:   }
599:   if (score >= 0.999) return ['same','同一张'];
600:   if (score >= 0.88)  return ['same','同款区间'];
601:   if (score >= 0.84)  return ['like','接近'];
602:   return ['weak','较弱'];
603: }
```
→ 报告引用的 `≥0.88 → 同款区间`(:600) 与 `≥0.78 → 很接近`(:594) **均在行**。注意这里是个**按 `mode` 分流的函数**（正是报告建议实现层去做的形态），把它算作"第四套定义"成立。

- 读 `static/prototype/index.html:124`：

```
余弦 **0.74~0.94**，且分区间有意义（同款 ≥0.88 / 文本 0.74~0.80）
```
→ **支持**。

- 读 `docs/design/UI-REVIEW-and-migration.md:38`（用 `read` 与 `node` 双重确认行号，见 §8 方法学备注）：

```
| `98% 匹配` | **`0.9396` + 区间标签**（同款区间/同类区间） | 我们的分数是余弦相似度，实测区间有明确语义（图→图 ≥0.88 为同款；文本→图 0.74~0.80） |
```
→ **支持**。

- 读 `docs/spec/SPEC-acceptance.md:71`：

```
| 余弦 < 0.97 的条目 | **不参与判定**，但必须在报告里给出**数量与分位数**（`p0.1` / `p1` / `p5`） | 下调 min 后的**观察项**（原为硬底线，见下方变更记录） |
```
配合 `:68`「逐条余弦**最小值** ≥ 0.700（2026-10-10 由项目所有者下调，**原 0.970**）」→ 报告称 `SPEC-acceptance.md:71` 的 `0.97` 是"**向量等价性观察线（内部质量门）**，与用户档位不是同一概念" —— **完全支持，且判断准确**。

**S1 结论：5 处引用全部支持；"四套定义"这个论断成立。**

### S2 · U-01 的截图实证（`read_image`）——**支持，且精确到数字**

- 我打开 `reports/G-D-p2-electron/ui-final.png`（1432×863，`sha256:64533cb9…`），肉眼读到 4 张结果卡：

| 卡 | 包名 | 标签 | 分数文本 |
|---|---|---|---|
| 1 | `ID-15690457.zip` | CR | **0.8147 · 较弱** · 12 MB |
| 2 | `ID-104617637.rar` | VR | **0.7985 · 较弱** · 79 MB |
| 3 | `ID-853074.rar` | VR | **0.7975 · 较弱** · 1.9 MB |
| 4 | `ID-717502.zip` | CR+VR | **0.7943 · 较弱** · 13 MB |

→ 与报告 `:216`「`0.8147 / 0.7985 / 0.7975 / 0.7943`，**全部显示「较弱」**」**逐位一致**。"每一次文本检索的全部结果都被标成较弱"这一用户可见后果，**有图有数**。
→ 该图同时为我另外两项独立观察提供了旁证：品牌副标题 `LOCAL IMAGE / INTELLIGENCE` **确实折成两行**（U-15 成立）；右缘**确实有常驻浅灰滚动条**（U-07 第 2 项成立）。

### S3 · U-03 对比度：我**自己用 WCAG 官方公式复算 7 组**（含任务指定 3 组）——**全部精确命中**

公式（逐字取自 `https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html`，我本轮已取全文；其 Note 2 另说明 0.04045 与旧值 0.03928 在实践上无差别）：
`L = 0.2126·R + 0.7152·G + 0.0722·B`，`C = (L_hi + 0.05) / (L_lo + 0.05)`，
`s = c/255`，`c ≤ 0.04045 ? s/12.92 : ((s+0.055)/1.055)^2.4`。

**① 任务指定 · `.score.like` `#ff9f0a` on `#ffffff`（报告：2.06:1）**
```
R: 255/255=1.000000 → 1.000000
G: 159/255=0.623529 → ((0.678529)/1.055)^2.4 = 0.643155^2.4 = 0.346555
B:  10/255=0.039216 < 0.04045 → /12.92 = 0.003035
L_fg = .2126(1.000000) + .7152(0.346555) + .0722(0.003035) = 0.212600+0.247857+0.000219 = 0.460676
L_bg = 1.000000
C = (1.0+0.05)/(0.460676+0.05) = 1.05/0.510676 = 2.0561  → 报告 2.06 ✔
```
**② 任务指定 · `.tag.VR` `#2f6feb` on `#e8effe`（报告：3.96:1）**
```
fg: R 47→0.028437 | G 111→0.158972 | B 235→0.830752
L_fg = .2126(0.028437)+.7152(0.158972)+.0722(0.830752) = 0.006046+0.113697+0.059980 = 0.179723
bg: R 232→0.806982 | G 239→0.863136 | B 254→0.991102
L_bg = .2126(0.806982)+.7152(0.863136)+.0722(0.991102) = 0.171564+0.617315+0.071558 = 0.860437
C = (0.860437+0.05)/(0.179723+0.05) = 0.910437/0.229723 = 3.9633  → 报告 3.96 ✔
```
**③ 任务指定 · `.tag.CRVR` 深色 `#1a7f37` on `#203627`（报告：2.55:1）**
先验算那个"合成值"是否真能由 `tokens.css` 推出：深色下 `--color-success: #30d158`（`tokens.css:166`），`--cat-crvr-bg = color-mix(in srgb, var(--color-success) 14%, transparent)`（`:75`），叠在 `--color-bg-elevated: #1d1d1f`（`:158`）上：
```
R: .14×48  + .86×29  = 6.72  + 24.94 = 31.66 → 32 = 0x20
G: .14×209 + .86×29  = 29.26 + 24.94 = 54.20 → 54 = 0x36
B: .14×88  + .86×31  = 12.32 + 26.66 = 38.98 → 39 = 0x27
→ #203627，与报告/app 附录 §3.2 给出的合成值完全一致
fg: R 26→0.010335 | G 127→0.212190 | B 55→0.038234
L_fg = 0.002197+0.151758+0.002760 = 0.156715
bg: R 32→0.014469 | G 54→0.036909 | B 39→0.020279
L_bg = 0.003076+0.026398+0.001464 = 0.030938
C = (0.156715+0.05)/(0.030938+0.05) = 0.206715/0.080938 = 2.5540  → 报告 2.55 ✔
```
**④–⑦ 我额外复算的 4 组（报告值 → 我的值）**
```
.score.same  #34c759/#ffffff        → 2.220  (报告 2.22) ✔
.metric-note.good #34c759/#ffffff   → 2.220  (报告 2.22) ✔
.tag.CR      #8250df/#f1e9fd        → 4.281  (报告 4.28) ✔
.tag.other   #69707d/#eceef2        → 4.289  (报告 4.29) ✔
.tag.uncat   #a56a12/#fff0d8        → 4.006  (报告 4.01) ✔  且 .16×#ff9f0a+.84×#ffffff = #fff0d8 与报告一致
```
→ **7/7 精确命中**。U-03 的「8 处 < 4.5:1」有 7 处已被我独立复现（第 8 处 `.toast.err` `#ffffff`/`#ff3b30`，我算得 3.548 → 报告 3.55，亦命中）。**这是本报告最强的一块。**

### S4 · U-05 / §2.4「`aria-pressed|aria-current|aria-selected|tabIndex` 全仓 0 处」——**支持**

第一次用 `Select-String -Recurse` 的写法**是无效的**（PowerShell 的 `Select-String` 没有 `-Recurse` 参数，命令报 `NamedParameterNotFound`，`(0 hits)` 是脚本分支假象）。我改用 `grep` 工具重跑：

```
$ grep -E "aria-pressed|aria-current|aria-selected|tabIndex|tabindex" src/renderer/src
Found 1 match
src/renderer/src\ui\Chip.jsx
Line 1: // Chip —— 筛选胶囊（原型：.chip / .chip.active，选中态是 `active` 而不是 aria-pressed）

$ grep -E "aria-pressed|aria-current|aria-selected" static/prototype
No matches found
```
→ 与报告 `:263`「只命中 **1 行，且是注释**（`ui/Chip.jsx:1`）」**完全一致**；原型侧同样 0 处。报告 `:264` 引 `UI-REVIEW:16`「`aria-label`/`aria-pressed`/…都有」——我读该行确认，`aria-pressed` 这一项在当前磁盘上确实不存在。**支持。**

### S5 · U-01「`item.band` 0 命中」——**支持（源码）**，措辞见 m4

```
$ node（全仓遍历，排除 node_modules/.git/out/data）literal "item.band"
AUDIT-FINAL.md:77
AUDIT-FINAL.md:118
docs\audit\00-current-state.md:115
docs\audit\00-current-state.md:142
→ 源码（.js/.jsx/.mjs/.css/.html）0 处
```
→ 结论"**引擎算好的 band 从未被界面消费**"**成立**；`band` 只在 `tests/engine.test.mjs:179,342` 被断言（测的是引擎），与基线 `00-current-state.md:144` 的说法一致。

### S6 · U-06 字体栈：我**自己查字体注册表**——**逐项一致**

```
$ HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts  （共 929 条）
SF Pro                  -> 0 项
SFPro                   -> 0 项
PingFang                -> 0 项
Hiragino                -> 0 项
Helvetica               -> 0 项
Segoe UI Variable       -> 0 项
Menlo                   -> 0 项
Segoe UI                -> 15 项
Microsoft YaHei         -> 3 项
Arial                   -> 11 项
```
→ 与报告 `:277`「SF Pro / PingFang / Hiragino / Helvetica / Segoe UI Variable / Menlo 均未安装；已安装 Segoe UI(15) / Microsoft YaHei(3) / Arial(11)」**完全一致**（报告另列 Consolas(4)，我未逐条核，不影响结论）。
→ `tokens.css:36-38` 的栈我逐候选人肉走了一遍：`-apple-system`（Apple 平台别名，Windows 无效）→ `BlinkMacSystemFont`（同）→ `SF Pro Text`✗ → `PingFang SC`✗ → `Hiragino Sans GB`✗ → `Segoe UI Variable Text`✗ → **`Segoe UI` ✔** → `Microsoft YaHei ✔`。**"前 6 个候选全部落空"成立**，报告 U4 的答案（西文落 Segoe UI、中文逐字形回退 Microsoft YaHei）**成立**。

### S7 · §4.3 / U-17：我**重跑守卫**并复算行号偏移——**支持**（U-13 的计数除外）

```
$ node tools\verify_renderer_styles.mjs      → EXIT=0
--- 4) 裸 px 报告（对照 §4.1 的 4pt 阶梯；仅提示）---
  裸 px 共 29 处；不在 4pt 阶梯上的：
  · src\renderer\src\renderer.css 有 2 处不在阶梯上的 px：291:1100px, 294:760px
```
→ 报告 §4.3 引用的「29 处裸 px，2 处不在阶梯上」**逐字命中**。
→ `tools/verify_renderer_styles.mjs:104` 原文（我读源确认）：
```js
const SCALE = new Set([0, 1, 2, 3, 4, 6, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 64, 72, 96, 1500, 44, 999]);
```
含 `6/28/36/40/1500` —— 与报告 U-17「白名单并非 4pt 阶梯」**一致**。
→ 真实行号：我读 `renderer.css:303` = `@media (max-width: 1100px) {`、`:306` = `@media (max-width: 760px) {` → 守卫的 `291/294` 与真实 `303/306` **差 12**，证据附录 §2.1 的表格**正确**。机制也对（`stripComments` 把开头 1-13 行注释块删成空串，13 行塌成 1 个空行 → 净损失 12 行；报告写"差 12 = 开头 13 行注释块"，数字对，措辞把净损失 12 说成 13，属可接受的近似）。
→ §4.3 补充的另两处阶梯外值 `renderer.css:104`（`6px`）、`:259`（`2px`）我读源确认存在（`6px` 与 `2px` 恰好在被放宽的 `SCALE` 里，所以守卫不报 —— 报告的论证链自洽）。

**但同一次核查发现 U-13 的计数口径错误（见 B3）**，我独立重跑：
```
$ static/prototype/*.html （7 个文件）
literal occurrences = 21     DISTINCT = 6
values: #454b58, #858aff, #8b91a0, #8b91ff, #a56a12, #c4c7d0
per-file: 图库与索引任务 5 / 操作记录与设置 5 / 语义搜索 4 / 图片详情 3 / 入库与增量 2 / index 1 / 文件操作确认 1
per-literal pages: #858aff=4 ✔  #8b91ff=5 ✔  #c4c7d0=7 ✔  #a56a12=2 ✔  #454b58=2 ✔   #8b91a0=1（报告未提）
```
→ **报告点名的 5 个字面量的页数分布全部正确**；错的是"21 **个不同**字面量"这个说法（21 是次数，去重是 6）。另外证据附录 §4.1 说 `style.css` 有 `#0002` ×2 —— 我核实**属实**（`style.css:2` 的 `box-shadow:0 1px 3px #0002`，是 4 位 hex，我第一版正则 `{6}|{3}\b` 漏掉了它，特此说明）。

### S8 · U-20「102 个令牌 / 35 个从未被 `renderer.css` 引用」——**精确命中**

```
$ node 独立复算（解析 tokens.css 的 --x: 定义，再在 renderer.css 查 var(--x)）
defined(distinct)=102  referenced-by-renderer.css=70  unused=35
```
→ 报告 `:406-407`「总数 **102** / 从未引用 **35**（34%）」**逐位一致**（35/102 = 34.3%）。
→ 报告点名的死令牌我逐条确认在 unused 列表里：`--shadow-outline` ✔、`--shadow-control` ✔、`--cat-uncat-bg` ✔、`--cat-uncat-fg` ✔、`--scrim` ✔、`--scrim-media` ✔、`--scrim-media-strong` ✔、`--hairline-on-media` ✔。
→ `Tag.jsx:4` `const CLASS = { VR:'VR', CR:'CR', 'CR+VR':'CRVR' }`（不含 `'未分类'`）与 `useSearch.js:9` `CHIPS = ['全部', ...FOLDERS, '未分类']` 我读源确认 → 「未分类」落到默认 `.tag` 与「其他」同色，**成立**。
→ 顺带确认 `tools/verify_renderer_styles.mjs:98` 确实只断言 `used → defined`（单向），报告 `:414` 对守卫方向性缺口的描述**成立**。

### S9 · U-02 / U-04 / U-11 / U-16 / §1.1 / §4.5 的抽查——**支持**

| 结论 | 我的取证 | 结果 |
|---|---|---|
| U-02 键盘只命中 3 行 | `grep onKeyDown\|ArrowUp\|…\|ctrlKey\|metaKey` | `SearchPanel.jsx:26`、`SearchBox.jsx:6`、`SearchBox.jsx:17` —— **与报告逐字一致** |
| U-02 参考条文 | 读 `UI-REVIEW:211` | `键盘：↑↓←→ 选 · Enter 定位 · Ctrl+C 复制包路径 · Esc 清空 · 空格 预览` ✔（**但只有 5 项，见 m1**） |
| U-04 载入态无文字且对 AT 隐藏 | 读 `Gallery.jsx:6-27` | loading 分支只渲染 `SkeletonCard`，`:8` `aria-hidden="true"`，分支内**无任何文字节点** ✔；`DESIGN-app-details.md:97`「**绝不**把"等待模型加载"做成白屏…必须有文字反馈」逐字在行 ✔ |
| U-11 `seq140` 硬编码 | 读 `SearchPage.jsx:140` + `MetricsRow.jsx:24-25` | 页脚写死 `` `seq140` ``；指标卡 `compat.split('|')[4]` 动态取 —— **同屏两源，成立** ✔ |
| U-16 `.loading` 无样式 | 读 `Gallery.jsx:8` + grep `renderer.css` 的 `.loading` | `className="photo-card loading"` 在行；`renderer.css` **无 `.loading` 规则** ✔ |
| §1.1 截图时间线 | `Get-ChildItem` mtime | `electron-window 16:47:09 / ui-components 17:19:50 / ui-prototype 17:30:11 / ui-tokens 17:32:53 / ui-final 17:35:57`；`out/` 三个产物均 **17:35:44** —— **与报告表格逐项一致** ✔ |
| §4.5 `--touch-min` 用了 3 处 | grep `touch-min` in `renderer.css` | 直接命中 **2** 处（`:76`、`:152`）；第 3 处确为**间接**（`:194` `--control-search-height` ← `tokens.css:127` `= var(--touch-min)`），报告在表格里**如实写出了这条链路** ✔（仅 `:164` 的"grep 输出见附录"措辞略强于 grep 本身） |
| §4.2 `--type-micro` 用了 9 次 | `node` 计数 | `count = 9` ✔（与报告列的 9 个行号一致） |
| §2.2 守卫覆盖 23 个文件 | 重跑守卫 | `CSS 1 个 · JSX 22 个`，23 个 `[OK]` ✔ |
| G2 关键词计数 | `Select-String` | `【代码事实】`22 · `【文档声称】`10 · `【判断，非实测】`6 · `【行业做法】`**1**（仅 §14 自检行 654，见 §5 G2） |

---

## 4. severity_recheck[]（我独立判 影响面 × 触发可能性）

| 问题 | 报告 | 我独立判 | 是否一致 | 理由 |
|---|---|---|---|---|
| **U-01** 档位阈值四套并存 / 引擎 band 被弃用 | **3 × 3 = 9 → Critical** | **3 × 3 = 9 → Critical** | ✅ 一致 | 影响面 3：被改坏的是**唯一诚实的信号**（`DESIGN-app-details.md:66`）且 `ui-final.png` 证明**每一项结果**都被误标；触发 3：**每一次文本检索**都发生，无需特殊条件，且用户无从察觉（界面不报错、分数照显示，只是结论错）。符合判据 §3「功能静默失败且用户无感」。**但见 B4：基线 `00-current-state.md:146` 对同一发现写 High(6)，基线自身 `:115` 又写 Critical(9)，报告必须登记这处分歧。** |
| **U-03** 8 处文字对比度 < 4.5:1 | **3 × 2 = 6 → High** | **3 × 2 = 6 → High** | ✅ 一致 | 影响面 3：含主信号分数徽标（2.06/2.22）与 4 个分类标签，11px 中文按 WCAG 1.4.3 属正文（CJK 等价尺寸条款我已取到原文）；触发 2：浅色是默认档，深色档另计（且深色多数达标）。 |
| **U-06** 字体栈前 6 候选在唯一目标平台落空 | **2 × 3 = 6 → High** | **2 × 3 = 6 → High** | ✅ 一致 | 影响面 2：是排版/观感与设计意图失真，不是功能不可用（Segoe UI + Microsoft YaHei 仍可正常阅读）；触发 3：**每次渲染**都发生且永久。 |
| **U-13** 原型 21 处硬编码色值 / 无守卫 | **1 × 3 = 3 → Low** | **1 × 3 = 3 → Low** | ✅ 一致 | 影响面 1：`static/prototype/` 是"设计验证文件，不是正式应用"（不随应用发布），危害限于设计资产纪律与文档失真；触发 3：静态恒真。**注意：B3 的计数错误不改变本级别。** |

**复算小结**：4/4 与报告一致。报告没有出现"只写高/中/低"或因子与乘积不符的情况（判据 G4 要求）。

---

## 5. gates（G1-G7 逐门）

| 门 | 判定 | 依据 + 例句 |
|---|---|---|
| **G1** 不声称未验证的能力（可追溯到 `文件:行号` 或命令+输出） | **部分满足** | **正面**：我抽查的 10 组引用（S1/S3/S4/S6/S7/S9）**行号与内容全部逐字命中**，原始输出也确在 `docs/audit/uiux-evidence.md` 里。例：`UIUX-AUDIT.md:253`「`Gallery.jsx:21-27` 的 loading 分支只渲染 8 个 `<SkeletonCard>`，每个 `aria-hidden="true"`（`Gallery.jsx:8`），**分支里没有任何文字节点**」——我读源逐条对上。**扣分**：§4.2 的 5 个 Apple 官方 pt 值（`UIUX-AUDIT.md:132,136,137,138,139`）在报告内**无出处**，且其唯一可能的来源在证据附录 `uiux-evidence.md:612` 被写成「条文版（**无字号数值表**）」→ 见 B1。 |
| **G2** 区分 代码事实 / 文档声称 / 行业做法 / Apple 官方规范 | **满足** | 每条问题头部都有「类别：」行，例：`UIUX-AUDIT.md:205`「**【代码事实】**冲突 + **【文档声称】**三方一致」、`:394`「**【代码事实】** + **【判断，非实测】**」、`:273`「**【代码事实】**（本机字体注册表实测）+ **【判断，非实测】**（字形落点的光学结果）」。全文计数：`【代码事实】`22 / `【文档声称】`10 / `【判断，非实测】`6。`【行业做法】`这个**字面标签**只在 `:654` 的自检行出现 1 次，其余场合报告改用**指名到条款的外部标准**（HIG Color / Materials / Typography、WCAG 1.4.3 / 2.5.5 / 2.5.8）来表达，属于比标签更强的形式；§3.1 `:88-91` 另把"Apple 官方 / W3C 标准 / 第三方镜像"三分声明清楚。**判定满足。** |
| **G3** 与基线零冲突 | **部分满足** | **对齐的部分我核实无误**：1 页实现（§1 引基线 §1）、`renderer.css` 只消费 `var()` 且有守卫（§2 引基线 §2，我重跑守卫确认）、D6 只提用户可见面未重复主张（§14 G3 行）、Electron 未实跑写入 N-1（引基线 §6）。**冲突的部分**：基线 `00-current-state.md:146` 对 U-01 明写「定级 ⇒ **High（Score 6）**」，报告给 Critical 9 却未处置，而 `:655` 只写「未发现与基线冲突的结论」→ 见 B4。（基线 `:115` 与 `:146` 本身也互相矛盾，需 Lead 裁决。） |
| **G4** 严重度可复算 | **满足** | U-01~U-20 **20 条全部**给出「影响面 × 触发可能性 = Score」两个因子与乘积（如 `:204` `Score = 3 × 3 = 9 → Critical`、`:288` `2 × 2 = 4 → Medium`、`:296` `1 × 3 = 3 → Low`）；我复算 4 条（§4）**全部一致**。§11 另用独立的 0/1/2 六维口径，并在 §11.1 `:553-559` **先声明每档的通过条件**再打分（例：`2` = 有代码级证据且与 §3 引用的 HIG/WCAG 条款一致），不属于"只写高/中/低"。 |
| **G5** 有可执行建议（改哪里 + 怎么验） | **部分满足** | **正面**：20 条每条都有"改哪里"与"怎么验"两行，且 §12 把"怎么验"落成**可执行断言**。例 `:328` U-11「怎么验：`verify_renderer_dom.mjs` 加断言「lib.compat 设为 `a|b|fp32|c|seq280` 时，页脚文本含 `seq280` 且不含 `seq140`」」——具体、可跑。`:293` U-07「守卫断言「`:root` 里每个在浅色块出现的 `--cat-*` 前景令牌，必须在深色块里也出现」（当前会精确报出 `--cat-crvr-fg` 缺失）」同理。**扣分**：U-01 的"改哪里"（`:217`）方向错误 —— 建议界面再自建一张 mode 档位表，仍然违反 `CONTRACT-engine-v1.md:107`「界面不自己算阈值」，且 `item.band` 仍不被消费 → 见 B2。 |
| **G6** 诚实列未覆盖 | **满足** | `:633-645` §13 共 **9 项**（N-1~N-9），每项都写了"为什么没覆盖"**与**"影响哪些结论"。例 N-2「我只能实测"哪些字体已安装"…**无法**测量 Chromium 在 `backdrop-filter`/`letter-spacing` 组合下的实际字形宽度与光学效果」→「U-06 的落点是**实测**；"负字距不符合设计意图"是**【判断，非实测】**」；N-7 还主动交代「U-01 的论断有真实检索截图支撑，但**样本量只有一次查询**」。 |
| **G7** 中文 | **满足** | 全文中文叙述；仅代码标识符、文件路径、CSS 变量名、`file:line`、以及 HIG/WCAG 原文引述保留英文（例 `:89` 引 `"Avoid hard-coding system color values in your app."` 保留英文原文并给出结论的中文解释）——与仓库既有文档（如 `docs/design/UI-REVIEW-and-migration.md`）一致。 |

---

## 6. rebuttals[]（主动反驳）

我按"报告说 A，磁盘是不是 B"逐个反推，**找到 4 处可成立的反驳 + 3 处试过但不成立**，如实列出。

### R1 ✅ 成立（→ B3）· 报告说"21 个**不同**字面量"，磁盘是"21 **次**出现 / 6 个不同值"
我原本怀疑报告又犯了"漏扫描根"的错误（`verify_renderer_styles.mjs:29` 的 `SRC` 不含 `static/prototype/`）。重跑后**扫描范围这一层报告是对的**：它确实手工扫了 7 个原型 HTML。但计数口径错了 —— `DISTINCT = 6`。而且报告自己的证据附录把"逐页次数之和（21）"标成"**去重后**不同字面量： 21"，属**自证矛盾**。详见 §3 S7 与 B3。

### R2 ✅ 成立（→ B1）· 报告声称"没有把 macOS 文本样式的具体 pt 值当作 Apple 官方数值来断言"，但 §4.2 用了 5 个
`uiux-evidence.md:616` 原话：「本报告**没有**把 macOS 文本样式的具体 pt 值当作"Apple 官方数值"来断言；§4.2 的对照只用 `DESIGN-tokens.md` 自己的阶梯 + 已取到的 CJK 说明」。但 `UIUX-AUDIT.md:132-139` 的第三列明明逐档写了 `HIG macOS Large Title 常见为 26pt` / `macOS Body = 13pt` / `iOS body 为 17pt` / `macOS Callout = 12pt，iOS = 16pt` / `HIG 里 11pt 属 Caption 系列`。**两者不能同时为真。**
更讽刺的是：我打开镜像后确认这些值**全部正确**（§7），也就是说报告比它自己声称的**更**扎实 —— 需要修的只是"补上出处 + 改掉那句自我否认"，不是数值本身。

### R3 ✅ 成立（→ B2）· U-01 只把它当"阈值选型"，漏了它同时是"契约违反 + 引擎产出被丢弃"
判据 U 系列没点名契约，但基线 `00-current-state.md:136-147`（§5.1.1）是把它当**契约一致性**问题处理的，并列出了 `CONTRACT-engine-v1.md:107` / `:114` 两行原文。我独立读了该文件：
```
107:      "band": "high" | "mid" | "low",       // 分数区间由共享常量定义，界面不自己算阈值
114: - **分数不可跨模态比大小**（SPEC-acceptance §2.2）：界面**不得**把"文本查询的 0.78"与
     "图像查询的 0.90"排序比较。`band` 由引擎按**同一模态内**的区间给出。
```
**Lead 的角度更准确**：它同时抓住了"有书面契约"和"引擎已经算好 `band` 却被丢掉"两条，而报告只呈现为"四套定义谁对"。因此报告的**修复方向也偏了**（自建 mode 档位表 = 换个地方继续自己算阈值）。报告的角度**并非错误**，是**不完整且导致修法失效**。

### R4 ✅ 成立（→ m2）· 报告说"13 个旧变量桥接"，磁盘是 16 个
`tokens.css:135-150` 我逐个数了：`--bg, --panel, --text, --muted, --line, --line-strong, --accent, --accent-soft, --green, --green-soft, --amber, --amber-soft, --warning, --danger, --danger-soft, --ink-2` = **16**。报告 `:413` 写 13，而它自己的证据附录 `uiux-evidence.md:510` 写 16。**主报告与自身附录不一致。**

### R5 ❌ 试过但不成立 · "U-01 的截图是历史图，不能证明当前代码" 
我一度想从 §1.1 的时间线下手反驳（若 `ui-final.png` 早于最终构建，则"全部标较弱"就只是旧版本的证据）。核查后**反驳不成立，反而加强**：`out/` 三个产物 mtime 全是 `17:35:44`，`ui-final.png` 是 `17:35:57`（晚 13 秒），其它 4 张图分别早 3/14/35/48 分钟 —— 与报告表格**逐项一致**；且报告已把"未重新实跑 Electron"诚实登记为 N-1。**报告在这一处是严谨的。**

### R6 ❌ 试过但不成立 · "U9 零主观形容词"这条要求被违反
我按任务点名的词表搜了 `精致|美观|粗糙|好看|不够 Apple|不够Apple|漂亮|优雅|丑|劣质|高级感|不精致`，命中 3 行，**全部是报告在主动拒绝主观化**：
```
:67  这不是"不够 Apple"的形容词判断，是可测量的字体解析结果（§6 / U-06）。
:426 落差性质：不是"字体不好看"，而是**字体栈的 5/11 个候选在唯一目标平台上是无效项**…
:587 理由不是"粗糙"，而是 `DESIGN-tokens.md:100` 明写「接入时建议就近取整到 16、20、24」…
```
→ **U9 通过**（这正是判据 §5 U9 要求的写法：把形容词替换成 X 处用了 Y / 条目要求 Z）。**未找到违反。**

### R7 ❌ 试过但不成立 · "`verify_renderer_styles.mjs` 的 `[OK]` 是假的 / 扫描根漏了原型"
`static/prototype/` 确实无守卫（报告 U-13 主张成立，我复核 `verify_renderer_styles.mjs:29-30`：`SRC` = `src/renderer/src`，`TOKENS` 只被当**定义源**读）。但"23 个文件全 `[OK]`"也**是真的**——我重跑 exit=0、23 个文件全过。所以不能反过来指责守卫吹牛，只能说它**扫描范围不含原型**（报告正是这么说的）。**反驳不成立。**

### R8 ❌ 试过但不成立 · "`--touch-min` 只用了 2 处，报告说 3 处是凑数"
grep `renderer.css` 直接命中 2 处（`:76`、`:152`），第 3 处是经 `--control-search-height` ← `tokens.css:127` 的**间接**使用。但报告在 §4.5 表格里**明确写出了这条链路**（`:170` 一整行），并未把它冒充成直接使用。**反驳不成立**（仅 `:164` 的"grep 输出见附录"说法略强，见 §3 S9）。

---

## 7. hig_source_check[]（报告引用的每个 Apple 出处）

| 编号 | 出处（报告 `:76-86` / 证据 §9） | 我的核对动作 | 状态 | 数值/条文是否一致 |
|---|---|---|---|---|
| **B1** | HIG · Layout `developer.apple.com/design/human-interface-guidelines/layout` | 未单独打开（同域 SPA 行为已由 B2/B3 两次证实） | **未逐条打开** | 报告只引 URL、不引数值（`UIUX-AUDIT.md:91`「凡镜像给不出数值的条目（如 HIG Layout 的具体 pt 数），本报告不编数值」），**无编造风险** |
| **B2** | HIG · Typography `…/typography` | `web_fetch` → **HTTP 200，正文只有标题**：`Typography \| Apple Developer Documentation` | **已打开，确认正文取不到** | 报告引用的条文我经 M4 镜像核对：`Consider using the built-in text styles.` ✔、`Minimize the number of typefaces you use…` ✔、`Adjust font weight, size, and color as needed…` ✔ **逐字在行** |
| **B3** | HIG · Color `…/color` | `web_fetch` → **HTTP 200，正文只有标题**：`Color \| Apple Developer Documentation` | **已打开，确认正文取不到**（报告 `:88` 的 SPA 声明**属实**） | 见下方「Apple 官方色值逐项核对」 |
| **B4** | HIG · Materials `…/materials` | `web_fetch` 三路（`raw.githubusercontent.com`、`cdn.jsdelivr.net`、`cdn.statically.io`）**均 `TypeError: fetch failed`**；`github.com/.../blob/main/…` 返回 GitHub 外壳但正文被截断 | **打不开（本环境网络限制）** | **未能核对**。报告引用的 3 句（`Use materials and effects sparingly` / `Help ensure legibility by using vibrant colors on top of materials` / `Consider contrast and visual separation…`）我**无法证实也无法证伪**。旁证：同仓库同 commit 的 `color.md`、`typography.md` 我都成功取到且**头部都带 `source: https://developer.apple.com/…` attribution**，与报告对 M3 的描述一致 |
| **B5** | HIG · Motion `…/motion` | 未单独打开 | **未逐条打开** | 报告 `:604` 自称"**未凭记忆引用 HIG Motion 条文**"，reduced-motion 判据改挂 WCAG/项目自定文档 —— 与我看到的一致（§10 的动效判定全部挂在 `tokens.css:228` / `renderer.css:298` 与 `DESIGN-tokens.md:150` 上）。**无编造风险** |
| **B6** | HIG · Accessibility `…/accessibility` | 未单独打开 | **未逐条打开** | §7 的 aria/键盘判定实际挂在 WCAG 4.1.2 与项目文档上，未虚构 HIG 条文 |
| **B7** | W3C WCAG 2.2 SC 1.4.3 `…/contrast-minimum.html` | `web_fetch` → **HTTP 200，全文可取** | **已打开核对** | 报告 `:84` 声称的三点**全部逐字命中**：`at least 4.5:1` ✔；`14pt` and `18pt` ≈ `18.5px` / `24px` ✔；**CJK 等价尺寸**（`large scale` 定义含「or font size that would yield equivalent size for Chinese, Japanese and Korean (CJK) fonts」）✔。我并据此确认 11px 中文标签属"正文"、需 4.5:1 |
| **B8** | W3C WCAG 2.2 SC 2.5.5 `…/target-size-enhanced.html` | `web_fetch` → **HTTP 200，全文可取** | **已打开核对** | 报告 `:85` 声称的 `at least 44 by 44 CSS pixels` **逐字在行** ✔ |
| **B9** | W3C WCAG 2.2 SC 2.5.8 `…/target-size-minimum.html` | 未单独打开（同目录、同结构；B7/B8 已核） | **未逐条打开** | 报告用它判"32/36px 控件已过 AA 未过 AAA"，与 B8 的 44×44 互为补充，方向自洽 |
| **M1** | 镜像 `hig-doctor …/color.md`（main） | `raw.githubusercontent.com` **fetch failed** | **打不开** | — |
| **M2** | 镜像 `hig-doctor …/color.md@ea8e93e`（**含 Specifications 官方 RGB 表**） | `raw.githubusercontent.com` fetch failed；**改走 `cdn.jsdelivr.net/gh/…@ea8e93e0cc3a877cf90d49d8f6fc55991ed29701/…/color.md` → HTTP 200，全文取到** | **已打开核对（等价 CDN 路由）** | 头部 attribution 属实：`--- title: "Color \| Apple Developer Documentation" / source: https://developer.apple.com/design/human-interface-guidelines/color`；**并含报告所述的 Specifications 四列表**。见下方逐项数值核对 |
| **M3** | 镜像 `hig-doctor …/materials.md` | 同上三路**均 fetch failed** | **打不开** | 未能核对（同 B4） |
| **M4** | 镜像 `hig-doctor …/typography.md`（报告称"条文版，**无字号数值表**"） | `cdn.jsdelivr.net/gh/…@ea8e93e0…/…/typography.md` → **HTTP 200，全文取到** | **已打开核对 —— 报告的描述不实** | 该文件**含完整数值表**：macOS built-in text styles（Large Title **26** / Title 1 22 / Title 2 17 / Title 3 15 / Headline 13 / **Body 13** / Callout **12** / Subheadline **11** / Footnote 10 / Caption 10）、iOS Dynamic Type（Body **17** / Callout **16** / Caption **11**）、tvOS/watchOS 各档、以及 4 张 tracking 表。→ 这正是 B1 |

### 7.1 Apple 官方色值逐项核对（报告 §4.1 `:110-118` / 证据 §9.1 `:620-635` vs M2 镜像原文）

我从镜像的 `## Specifications` → `System colors` 表逐格对照报告给出的十六进制：

| 报告 | 镜像原文（R/G/B） | 换算 | 一致？ |
|---|---|---|---|
| Green light `#34C759` / dark `#30D158` | R-52,G-199,B-89 / R-48,G-209,B-88 | 34C759 / 30D158 | ✅ **完全一致** |
| Red light `#FF383C` / dark `#FF4245` | R-255,G-56,B-60 / R-255,G-66,B-69 | FF383C / FF4245 | ✅ **完全一致**（注意**不是** iOS 常见的 `#FF3B30`/`#FF453A` —— 报告没有凭记忆写） |
| Orange light `#FF8D28` / dark `#FF9230` | R-255,G-141,B-40 / R-255,G-146,B-48 | FF8D28 / FF9230 | ✅ **完全一致** |
| Blue light `#0088FF` / dark `#0091FF` | R-0,G-136,B-255 / R-0,G-145,B-255 | 0088FF / 0091FF | ✅ **完全一致**（**不是** `#007AFF` —— 同样排除了凭记忆） |
| Indigo light `#6155F5` / dark `#6D7CFF` | R-97,G-85,B-245 / R-109,G-124,B-255 | 6155F5 / 6D7CFF | ✅ 一致 |
| Purple light `#CB30E0` / dark `#DB34F2` | R-203,G-48,B-224 / R-219,G-52,B-242 | CB30E0 / DB34F2 | ✅ 一致 |
| Pink light `#FF2D55` / dark `#FF375F` | R-255,G-45,B-85 / R-255,G-55,B-95 | FF2D55 / FF375F | ✅ 一致 |
| `systemGray6` light `#F2F2F7` | R-242,G-242,B-247 | F2F2F7 | ✅ 一致 |

**规范性条文核对**（镜像 `color.md` 原文逐字）：
- `Avoid hard-coding system color values in your app.` ✅ 在行（报告 U-13 `:345` 与 §4.6 `:192` 引用）
- `Make sure all your app's colors work well in light, dark, and increased contrast contexts.` ✅ 在行（报告 U-07 `:290` 引用）
- `If you define a custom color, make sure to supply light and dark variants, and an increased contrast option for each variant…` ✅ 在行（同上）
- 报告 §9.3 `:529` 说实现"完整做双主题"比文档规划更符合 HIG —— 镜像里还有一句更强的话我读到了：`Even if your app ships in a single appearance mode, provide both light and dark colors to support Liquid Glass adaptivity in these contexts.` ✅ **报告的判断有据**。

### 7.2 hig_source_check 结论
**报告对"取用方式"的披露是诚实且可复现的**：Apple 侧确认只有标题（我两次独立复现），数值全部来自带 `source:` attribution 的第三方镜像，且**镜像里每一个数值/条文都与报告写的完全一致**。唯一不实之处是**证据附录 §9 对 M4 的描述**（称"无字号数值表"，实际有完整表），以及正文 §4.2 用了这些数值却没写出处 —— 即 **B1**，属"披露遗漏"，**不是编造**。按任务判定规则，这仍落在"Apple 数值（在报告内）无出处"一档，故 verdict 至少为 `pass-with-issues`。

---

## 8. 未覆盖 / 无法验证（我这一侧的诚实登记）+ 方法学备注

1. **B4 / M3（materials.md）打不开**：三路 URL 在本环境均 `fetch failed`，报告引用的 3 句 Materials 条文**我无法证实也无法证伪**。这不构成 blocker（报告对 M3 的"条文版"描述与 B2/M2/M4 的实际形态吻合，且 Materials 相关结论 U-19 本来就被报告自己标为"只挂账、不作缺陷定性"）。
2. **未逐条打开** B1/B5/B6/B9 的原始页面。已核的 B2/B3 两次证实 SPA 只返回标题、B7/B8 证实 W3C 页全文可取；且报告在 B1/B5 上**主动声明不引数值/不凭记忆引条文**，风险很低。
3. **未做屏幕阅读器实跑、未重新运行 Electron 截图、未做深色系统切换截图** —— 与报告 §13 N-1/N-5/N-9 的自我声明一致；我对 U-05/U-07 的判定同样是**静态**判定（grep + 代码事实），与报告同级。
4. **方法学备注（重要，防止后来者误判）**：本轮 `Get-Content` 读这些 UTF-8 中文 `.md` 时会**按 ANSI/GBK 误解码并合并行**，导致行号整体偏移（如 `DESIGN-tokens.md` 被读成 225 行，实为 **260** 行；`UI-REVIEW-and-migration.md` 被读成 223 行，实为 **303** 行）。
   - 我一开始据此得出"报告行号偏移 20~34 行"的怀疑，**随后用 `read` 工具 + `node`（`fs.readFileSync(...,'utf8')`）双重复核，两者一致，且报告引用的 `DESIGN-tokens.md:64/141/159`、`UI-REVIEW:16/38/211` **全部逐字命中**。**
   - **结论：报告的行号是正确的**，本文所有行号结论均以 `read` 工具与 `node` 为准，`Get-Content` 的输出已全部作废。特此记录，避免后续审查者重复踩坑。
5. **未覆盖**：`U-10` 的原型 `app.css:36-39` scrim 规则、`U-15` 的折行宽度推算、`U-18` 的排序逻辑细节，我只做了"引用的行号与关键条件是否在行"的抽验（已通过），**未**逐项重跑 CSS 解析或做像素级量测。

---

## 9. 给作者的最小修正清单（按修改成本排序）

| 成本 | 动作 | 对应 |
|---|---|---|
| 1 行 | §4.2 的 5 个 HIG pt 值补注来源（B2 + M4 镜像） | B1 |
| 1 行 | 证据附录 §9 M4 行「无字号数值表」→ 如实描述；删 §9「没有把 macOS pt 值当作 Apple 官方数值」那句 | B1 |
| 4 处 | 「21 个不同字面量」→「21 处 · 6 个不同值」，枚举补 `#8b91a0` | B3 |
| ~6 行 | U-01 补 `CONTRACT-engine-v1.md:107,114` 两行原文；"改哪里"改为**消费 `item.band`**；验收断言改为"界面不含数值阈值判断" | B2 |
| 3 行 | §14 G3 改"部分满足"+ 新增"与基线定级分歧"（`00-current-state.md:146` High 6 vs `:115` Critical 9），请 Lead 裁决 | B4 |
| 5 行 | m1（6/5/7 项统一）、m2（13→16）、m3（补 `hooks/` 路径）、m4（"源码 0 命中"）、m5（去掉多余的"另加"） | minor |

**处置完 B1-B4 后，本文 `verdict` 可升为 `pass`。**（按判据 §7：`pass-with-issues` 且 blockers 已被作者处置并回写即通过；本文不修改 `UIUX-AUDIT.md`，回写由作者执行。）

---

# 10. 第二轮复核（B1-B4 + m1-m5 处置验收）

- 触发：`uiux-auditor` 已重写 `UIUX-AUDIT.md` / `docs/audit/uiux-evidence.md` 并新增 §16 处置记录；Lead 要求验收。
- 复核对象版本：`UIUX-AUDIT.md` **102,970 B / 781 行**（原 86,906 B / 676 行）；`docs/audit/uiux-evidence.md` **42,777 B / 677 行**（原 660 行）。
- 复核范围（按 Lead 要求**只核 blocker 是否清零 + 有无新增错误**，不重做全篇）：逐一**实读**被改位置，**不采信 §16 自述**；对新增/变更的每一个数字**重新独立算了一遍**。
- 复核手段：`read`（行号以上轮已确认可靠的 `read` + `node` 为准）、`node` 独立复算、`git diff`、mtime 比对、`web_fetch`。

## 10.1 `verdict_round2` 与 `blockers_round2`

**`verdict_round2 = pass`**
**`blockers_round2 = []`（4 条 blocker 全部真清零，未发现新增 blocker）**

| ID | 第一轮要求 | 我的验收结论 | 关键证据（我实读/实算的） |
|---|---|---|---|
| **B1** | Apple pt 值补出处；附录 M4 行改如实；删自我否认句 | ✅ **清零** | §4.2 `:131-135` 新增出处段（B2 URL + **M4 的 jsDelivr 路由** + HTTP 200 + 点名两张表）；附录 §9 M4 行（`:627`）改为如实描述（**"12 张 Dynamic Type 表"我核为 7 档 ×Small + AX1-AX5 = 12 ✔**）；`:631` 的自我否认句已改为事实陈述。我经**该 jsDelivr 路由**取到全文，26/22/17/15/13/13/12/11/10/10/10 与 iOS 17/11、macOS 13/10 **逐格命中** |
| **B2** | 定性升级到契约层；**修法必须真的不再让界面自算阈值** | ✅ **清零**（核心问题答：**是**） | 契约两行 `CONTRACT-engine-v1.md:107/:114` 我上轮已逐字核过；**新增的** `core/engine.mjs:18-20`（引擎注释「界面只能用引擎给的 band，不许自己拿"文本 0.78"和"图像 0.90"排序」）我实读**逐字在行**，是真发现；`BANDS` `:25-28` ✔、`bandOf` `:30-35` ✔、`band: bandOf(r.score, mode)` **`:227`** ✔（**且此处在纠正基线 `:141` 的 `:226` —— 基线那行实际是 `score:`，报告是对的**）；修法 `:244` = **删除 `bandOf()` 与两个数字，改为 `{high,mid,low}→文案` 查表，「不含任何数值比较」** → **这条路径下界面不再有任何阈值判断** ✔；§12 P0 行 `:656` 与 §14 G5 行 `:705` 已同步，并各自注明"原写…仍违反 `:107`"；`PhotoCard.jsx:38` 我实读 = `<Score score={item.score} … />` —— **正是该加 `band={item.band}` 的位置**，引用准确 |
| **B3** | 口径统一为「21 处 · 去重 6 个」；补 `#8b91a0`；附录自证矛盾消除 | ✅ **清零** | U-13 标题 `:382`「21 处…去重 6 个」；正文 `:388`；§4.1 正文 `:125`「21 **处**…去重后 6 个不同值」并**已补 `#8b91a0`×1**；§11.3 `:637`；§12 `:667` —— 四处统一。附录 §4.1 `:364-365` 改为**两行分开**（`合计 = 5+5+4+3+2+1+1 = 21 次（出现）` / `去重后不同字面量 = 6 个`）+ 新增"每个字面量出现的页数"块（`#8b91a0 ×1（语义搜索.html）`）+ 口径更正说明。**我独立复算 21/6 不变**，且 `#8b91a0` 的用途描述（"搜索框放大镜图标的内联 `color`"）我实读 `语义搜索.html:3` = `<span style="color:#8b91a0…">⌕</span>` **准确** |
| **B4** | G3 改部分满足 + 登记定级分歧 | ✅ **清零** | §14 G3 行 `:703` 已改「⚠️ **部分满足**（B4 修正）」并拆成"对齐 4 处 / 冲突 1 处"；新增 `§14.2 :714-726` 五方对照。**我实读更正后的基线** `00-current-state.md:146-151`：确为「**定级：Critical（Score 3×3 = 9）**」+ 更正说明（"本行曾写「High（Score 6）」…由第②条审查的独立复核发现（blocker B4）…Lead 复核后统一为 Critical 9"）→ **§14.2 对基线的引述与更正后的基线一致** ✔ |

## 10.2 minor m1-m5 验收

| ID | 我的验收 | 证据 |
|---|---|---|
| **m1** | ✅ 清零 | 标题 `:247` 改为「UI-REVIEW 要求 **5** 项 / DESIGN-app-details 要求 **7** 项 + 2 条，实现 1 项」；正文 `:251-253` 分文档列计数；散文枚举换成 **9 行对照表** `:257-267`。我核并集：UI-REVIEW 的 5 项 ⊂ DESIGN 的 7 行，7 + `:85-86` 的 2 条 = **9** ✔，与表格 9 行一致 |
| **m2** | ✅ 清零（**配平式算术成立**） | `:461` 改「旧变量桥接 **16 个**」并注明"原写 13…已更正"；`:460` 配平「8 + 27 = 35」、`:462` 列 11 个结构性预留。**我独立重算**：unused=35；16 个桥接全在；8 个真死令牌全在；余 **11** 个 = `--color-bg-secondary`、`--space-12/16/18/24`、`--radius-2xl`、`--type-title2/-lh/-ls`、`--type-callout-lh`、`--control-segment-height` —— **与报告所列逐字相同**；`8+16+11 = 35` ✔ |
| **m3** | ✅ 清零 | 全文 `useSearch.js` 引用**已全部带全路径** `src/renderer/src/hooks/useSearch.js`（`:299/342/343/431/434/457/673/703`）。唯一残留的裸 basename 在 `§16 m3` 行的**问题陈述**里（"`useSearch.js` 只写 basename…"），属合法自述 |
| **m4** | ✅ 清零 | U-01 `:235` 改为「**源码里** `item.band` 0 命中」✔ |
| **m5** | ✅ 清零 | "另加"现在只出现在**否定句**里：`:252`「在本表内、非"另加"」、`§16 m5`「已去掉"另加"」✔ |
| 附带（我上轮 §3 S9 提的 `--touch-min` 措辞） | ✅ 已改 | `:171` 改为「用了，3 处（其中 **2 处**是直接 `var(--touch-min)`，**第 3 处**是间接经 `--control-search-height`）」——比原来准确 |

## 10.3 新增错误的排查（重点项）

逐项重算本轮新增/变更数字，**未发现新增 blocker**，仅 3 处 cosmetic 计数瑕疵 + 1 处观察。

**① 新数字「68 处 / 37 个值」——我复算后确认为真（且我一度误判，见 §10.6）**
报告在附录 §4.1 `:382` 与 §16 `:755` 的**边界声明**里说：原型 **CSS** 里另有 `--token: #hex` 形式的定义 **68 处 / 37 个值**，属合法令牌定义、不计入硬编码。
我独立复算（"`--x:` 值部内的 **6 位 hex**"这一口径）：
```
occurrences = 68   distinct = 37   -> MATCH（与报告逐位一致）
```
→ 与报告的 `21 处 / 6 个`（非令牌定义）**互不重叠、口径自洽**：HTML 里的 21/6 + CSS 令牌定义里的 68/37 是两组不相交的计数。**新增数字成立。**

**② `§16 m3` 行称"共 6 处"——计数不准（cosmetic）**
`:764` 写「全文统一为全路径…（**共 6 处**：§7 U-04、§5 U-08 两处、§5 U-18 两处、§5 U-20、§12 P3/U-18）」，但该括号自己列出的就已 **1+2+2+1+1 = 7** 处，实际全路径化出现在 **8 行**（另有 `:703` §14 G3 一处未列入）。不影响任何结论，建议改为"7 处（另 §14 G3 一处）"。

**③ 附录 §9 M4 行称"5 组 tracking 表"却列了 6 个名字，实际有 7 张（cosmetic）**
`:627` 写「**5 组 tracking 表**（SF Pro / SF Pro Rounded / New York / tvOS / SF Compact / SF Compact Rounded）」——"5 组"与所列 6 个名字已经不等；我按镜像原文清点实为 **7 张**：`SF Pro`、`SF Pro Rounded`、`New York`、**`macOS tracking values`**、`tvOS tracking values`、`SF Compact`、`SF Compact Rounded`（macOS 那张被漏列）。同行的「12 张 Dynamic Type 表」**是准确的**（7 档 ×Small + AX1–AX5 = 12）。纯描述性计数，零影响。

**④ 一处旧措辞未同步（cosmetic）**
`§9.1` 的 D-1 行 `:552` 仍写「原型 HTML 仍有 **21 个**颜色字面量」——未同步 B3 的新口径（应为"**21 处**"）。数字本身作为"出现次数"读也不错，但既然全文已统一为"处 / 个"二分，此处建议一并改。**注**：全文另两处 `21 个不同字面量`（`:388`、`:755`）是**引用被更正前的错误原文**，属合法自述，不算残留。

**⑤ 观察（非缺陷，供 Lead 判断）——"raw.githubusercontent.com 只给条文"这一说法我无法复现**
作者向 Lead 报告：最初 `web_fetch` `raw.githubusercontent.com` 的 `typography.md` **只拿到条文、没有规格表**，故改用 jsDelivr。
- 我在本环境对该主机共尝试 **5 次**（`color.md` main / `color.md@ea8e93e` / `typography.md` main ×2 / `typography.md@ea8e93e`），**全部 `TypeError: fetch failed`**（传输层失败，非 404）→ **该说法我无法证实，也无法证伪**。
- 另有一处**内部张力**：附录 §9 的 M1/M2 行仍断言 `raw.githubusercontent.com` 的 `color.md` **HTTP 200 且"含 Specifications 官方 RGB 表"**；同一个主机在同一个会话里对 `color.md` 给全文、对 `typography.md` 只给条文，前后不一致。
- **但这对 B1 的处置有效性没有影响**：报告现在**明确写出用的是 jsDelivr 路由**，而该路由我独立取到全文并**逐值核对通过**。B1 要的是"数值有可核对的出处"，这一点已满足。
- 建议（可选）：要么删掉"raw 只给条文"这个无法举证的说法，要么在 M4 行补一句"本环境下 raw 路由返回内容不完整/不可用，故改用 jsDelivr"。

## 10.4 只读合规声明核查（Lead 点名要我自己验）

作者声称：`git diff` 对 `src/ static/ docs/design/ docs/spec/ tools/ core/ package.json` 全部为空，且他人文件 mtime 早于它本轮编辑。**我独立验证：两项均属实。**

```
$ git diff --stat -- src/ static/ docs/design/ docs/spec/ tools/ core/ package.json
（无输出）exit=0
```
→ 这些路径**都已被 git 跟踪**（在 HEAD 里），因此空 diff **就是**"未修改"的证明（不是"因为是新文件所以查不到"）。

```
$ git status --short
?? AGENTS.md          ?? AUDIT-FINAL.md      ?? STACK-AUDIT.md      ?? UIUX-AUDIT.md
?? docs/audit/        ?? docs/plan/DOCS-*.md ?? docs/plan/README.md …
```
→ **无任何 ` M `（modified）条目**；全部为新交付物的 `??`。

| 文件 | mtime | 与"作者编辑窗口 10:19–10:21"的关系 |
|---|---|---|
| `docs/audit/01-acceptance-criteria.md` | 09:58:27 | 早于窗口 ✅（Lead 冻结件，未被触碰） |
| `STACK-AUDIT.md` | 10:14:44 | 早于窗口 ✅ |
| `docs/audit/REVIEW-UIUX-AUDIT.md`（我的） | 10:17:07 | 早于窗口 ✅（本轮我回读后未改写正文） |
| `docs/audit/00-current-state.md` | 10:17:42 | 早于窗口 ✅（Lead 的更正先于作者本轮编辑） |
| `docs/audit/uiux-evidence.md` | **10:21:01** | 在窗口内 ✅（作者自己的文件） |
| `UIUX-AUDIT.md` | **10:21:03** | 在窗口内 ✅（作者自己的文件） |
| `AUDIT-FINAL.md` | 10:21:48 | 晚于窗口 —— 但那是 **Lead** 的文件，非作者所写 |

→ **合规声明成立**：作者本轮只写了自己的两个文件，未触碰任何源码/静态资源/他人文件。

## 10.5 门状态（第二轮）

| 门 | 第一轮 | 第二轮 | 说明 |
|---|---|---|---|
| G1 | 部分满足 | **满足** | B1 补齐 §4.2 全部 Apple pt 值的双出处（B2 + M4）；附录 M4 行如实。新增引用 `core/engine.mjs:18-20/25-28/30-35/227`、`PhotoCard.jsx:38` 我全部实读命中 |
| G2 | 满足 | **满足** | 未变 |
| G3 | 部分满足 | **满足** | §14 G3 改"部分满足"并登记分歧；§14.2 与更正后的基线一致 |
| G4 | 满足 | **满足** | 未改等级；U-01 仍 3×3=9，与我独立复算一致 |
| G5 | 部分满足 | **满足** | U-01 修法改为消费 `item.band`；§12/§14 同步 |
| G6 | 满足 | **满足** | §13 N-1~N-9 未变 |
| G7 | 满足 | **满足** | 未变 |

## 10.6 方法学备注：我自己的一次**险情**（记录以备后人）

本轮我第一遍用正则 `(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b`（要求 hex **紧跟**在冒号后）复算令牌定义，得到 **62 处 / 34 个值**，与报告的 68/37 不符，**我几乎据此把"新的数字错误"写进复核**。改用"`--x:` 值部内任意位置的 **6 位** hex"后得到 **68 / 37，完全吻合**。
差异来源：① 我的正则要求 hex 紧跟冒号，漏掉了 `--scrim: color-mix(in srgb, #000 60%, …)`、`--thumb-fallback: linear-gradient(…, #eceef4, …)` 这类"值部中段"的 hex；② 3 位/4 位短写（`#000`/`#fff`/`#0002`）会各自改变计数。
**教训**：复核者自己的正则比被复核的数字更容易出错；**数字对不上时，先穷举"这句计数在什么口径下成立"，再判错**。本轮的 62/34 已作废，不作为对报告的指控。

---

## 10.7 第二轮结论

- **4 条 blocker 全部真清零**（逐条实读原文验证，非采信 §16 自述）；**5 条 minor 全部清零**，含我上轮顺带提的 `--touch-min` 措辞。
- **未发现新增 blocker**；仅 **3 处 cosmetic 计数瑕疵**（§16 m3「共 6 处」、§9 M4「5 组 tracking 表」、§9.1 D-1「21 个」）+ **1 处不可复现的观察**（raw 只给条文）。全部不影响任何结论、等级或证据链，**建议顺手修，不构成阻塞**。
- **只读合规已独立验证通过**（空 `git diff` + 无 ` M ` + mtime 时序一致）。
- 结论方向未被改动：U-01 仍 Critical 9（与我的独立复算一致），U-03/U-06/U-13 定级不变。

**`verdict_round2: pass` · `blockers_round2: []`** —— 按判据 §7，`UIUX-AUDIT.md` 已具备通过独立复核的条件。
