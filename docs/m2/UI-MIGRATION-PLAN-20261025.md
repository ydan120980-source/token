# 前端迁移执行计划（给 Codex）· 2026-10-25

**读者**：执行迁移的 Codex 会话。
**作者和审核人**：Claude。
**批准**：项目所有者，2026-10-25。

**本轮审核顺序补充（所有者，2026-10-25）**：所有者在 M1 实现交付后明确要求“继续完成M2,然后统一给Claude审核”。本轮允许 M2 保留未审 M1 的完整提交继续实现，M1/M2 完成后一起交审；不表示 M1 已审核通过，不授权合入 main，也不扩展到 M3。以下逐步审核要求在 M1/M2 之间仅按本补充执行，后续步骤仍照原计划。

这是一份执行计划，不是设计讨论。所有设计决定已经写在 `docs/m2/UI-SPEC-20261025.md`（下称“规范”）。你的工作是按步骤把现有页面搬到 React 层，做到**外观符合规范、行为与现在完全一致**。每一步做完都停下来交给 Claude 审核，审核通过前不得开始下一步。

---

## 0. 开始前必读

### 0.1 按顺序读完

1. `AGENTS.md`、`CONTRIBUTING.md`（尤其是“数据语义铁律”和“测试分层”）
2. `docs/m2/UI-STACK-MIGRATION-20261024.md`：迁移方向和测试门槛
3. `docs/m2/UI-REACT-FOUNDATION-20261025.md`：构建、新旧共存、挂载接口
4. `docs/m2/UI-SPEC-20261025.md`：规范，每一条都是硬性要求
5. 本计划

### 0.2 角色

- **Codex**：按本计划实现，产出代码、测试、截图和记录。
- **Claude**：
  - 维护规范；
  - 审核每一步的产出；
  - 修改 `tokens.css`、`ui/src/theme/`、`ui/src/design/`、`ui/design-guard-allow.json`；
  - 必要时直接优化你的实现；
  - 审核通过后合入 `main`。
- **所有者**：裁决规范没有覆盖的问题。

### 0.3 铁律（违反任何一条即视为该步不合格）

1. **不自行设计**：
   - 规范没写的颜色、尺寸、间距、圆角、字号、动效、图标、布局、文案、交互，一律不得自己决定；
   - 不得“顺手优化”，也不得按你的审美调整。
2. **行为与现在一致**：
   - 迁移后的页面要和旧页面做同样的事：同样的数据、同样的文案、同样的操作、同样的悬停行为（规范第 7 节），状态和边界情况也一样；
   - 差异只允许来自规范规定的外观统一，并且要逐项写进对照清单。
3. **数据语义**：
   - 未知不显示成 0；不跨 Agent 相加；不重新实现格式化、定价、换算，一律调用现有全局模块（第 2.4 节）；
   - 不新增 IPC，不改主进程和 preload。
4. **只改允许的文件**：每一步列出了可以改的文件，范围外的文件不碰。
   - 必须动范围外的文件时，停下来说明原因。
   - 后端（`src/m1`、`src/quota`）和 `design/desktop-reference/tokens.css` 永远不改。
5. **设计检查不能绕过**：
   - `tests/m1/ui-design-guard.test.js` 必须通过；
   - 不得修改它，不得修改 `ui/design-guard-allow.json`，不得用字符串拼接、变量间接引用等方式规避它。
6. **不降低测试**：不得删除或放宽测试来让它通过。旧套件的断言只能按第 5 节的映射流程迁移或退役。
7. **本地 git**：
   - 不 push，不开 PR，不合入 `main`（由 Claude 合入）；
   - 不恢复 `git stash@{0}`；
   - 不读真实来源、凭据或认证文件；
   - 只用合成数据和独立的 usage/quota 目录，不跑 `validate:local`。

### 0.4 什么时候停下来提问

遇到以下任何情况，在当步的记录里写一节“待决问题”，然后停止，不要猜：

- 规范里找不到对应的视觉规定；
- 旧行为和规范冲突，或者旧行为本身看起来像缺陷；
- 需要新的 kit 组件、新的颜色或 token，或者需要设计检查的例外；
- 需要改范围外的文件、后端或 preload；
- 一条旧测试断言无法在新实现里保持；
- 发现数据语义问题，例如旧页面显示了 0 或做了相加。只记录，不要修。

---

## 1. 目录和归属

| 路径 | 归属 | 说明 |
|---|---|---|
| `ui/src/vendor/fluid/**` | 上游（只读） | 改动必须经 Claude 同意，并写进 `VENDOR.md` |
| `ui/src/theme/**`、`ui/src/design/**` | Claude | 规范的代码形式 |
| `ui/design-guard-allow.json` | Claude | 设计检查的例外 |
| `ui/src/kit/**` | Codex（M1 建立，后续按需扩展） | kit 组件；新增组件要先过审 |
| `ui/src/data/**` | Codex | 桥接适配和全局模块的类型声明，不含视觉 |
| `ui/src/pages/<page>/**` | Codex | 页面，只能组合 kit 组件 |
| `ui/src/islands/index.ts` | Codex | 注册页面 |
| `ui/src/dev/**` | Codex | 只给测试和审核用的组件（kit 展示页） |
| `design/desktop-reference/index.html` | Codex（每页只改自己的 `<section>` 和退役的 `<script>`） | |
| `design/desktop-reference/<旧页面脚本和样式>` | Codex（只在该页“退役”子步骤里删） | |
| `scripts/m1/*-ui-test.js`、`tests/m1/*.test.js` | Codex | 按第 5 节迁移或退役 |
| `design/desktop-reference/ui/**` | 生成物 | 只能通过 `npm run build:ui` 生成，不手改 |

---

## 2. 通用做法

### 2.1 每一步的流程

1. 从本地 `main` 建分支 `ui/mig-<步骤>-<简称>`，例如 `ui/mig-m3-settings`。
2. 先做“盘点”子步骤（页面步骤都有），交审，**等 Claude 审核通过**。
3. 实现，构建（`npm run build:ui`），把产物和源码一起提交。
4. 跑通第 2.5 节的门槛。
5. 截图，存到 `artifacts/ui-mig/<步骤>/`。
6. 写记录 `docs/m2/UI-MIG-<步骤>-<日期>.md`（模板见第 7 节）。
7. 提交。提交信息结尾加 Codex 的署名，正文列出跑了什么、没跑什么。
8. 停止，汇报分支名、提交号和记录路径。

### 2.2 页面怎么接进旧外框（M3 至 M8）

- **挂载**：在 `index.html` 里保留该页的 `<section id="<page>" …>` 元素本身（包括 `hidden`、`data-motion-surface` 等属性），把里面的内容换成：

  ```html
  <div data-island-host="<page>"></div>
  ```

  `islands.js` 在页面加载后自动挂载已注册的同名组件。
- **注册**：在 `ui/src/islands/index.ts` 里写 `<page>: <Page>Page`。
- **页面切换**：仍由旧外框负责。页面用 `useViewActive("<page>")`（`ui/src/data/shell.ts`）判断自己是否可见，第一次可见时再加载数据，和旧页面一样。
- **主题**：用 `useDarkTheme()` 判断深浅色。颜色由 token 自动切换，页面不需要分两套写。
- **其他代码依赖本页时**：旧外框或别的页面引用了本页的 DOM（例如 `preview.js` 读取 `#themeSelect`），盘点时列出来。实现时由本页暴露一个窄的全局接口（`window.<page>Ui`），或者调用旧代码已有的接口；不得让旧代码去查 React 生成的 DOM。

### 2.3 kit 的使用

- 页面只能从 `@ui/kit` 引入组件，用 `@ui/data` 获取数据。
- 页面里的 `className` 只能做布局：`flex`、`grid`、`gap-*`、`p-*`、`w-*`，以及规范允许的文字和颜色类名。
- 不得写动效、悬停和内联样式。
- kit 里缺组件时，停下来提问，不要在页面里拼一个。

### 2.4 数据和格式化

- **桥接**：
  - 统计用 `window.usageBridge`，额度用 `window.quotaBridge`，窗口用 `window.windowBridge`；
  - 在 `ui/src/data/bridges.ts` 里给**用到的方法**写类型和薄封装，签名以 `src/quota/preload.js` 和旧页面的调用为准；
  - 不新增任何 IPC。
- **格式化和计算**：直接调用旧页面已经加载的全局模块，在 `ui/src/data/globals.ts` 里声明类型。可用的有：

  | 全局模块 | 用途 |
  |---|---|
  | `displayValues` | 数值显示 |
  | `pricingLabels`、`uiPricing`、`uiPricingView` | 定价文案和展示 |
  | `costTable`、`costInsights`、`costChart` | 费用计算和图表数据 |
  | `usageMath`、`insightsMath`、`usageInsights` | 用量统计 |
  | `agentCatalog` | Agent 名称和元数据 |
  | `connectionState` | 连接状态 |
  | `snapshotCodec` | 快照解码 |
  | `chartUi` | 图表辅助 |

- **页面专有计算**：只存在于旧页面脚本里的数据计算（例如 `quota-cards.js` 的 `heroModel`、`cost-page.js` 里的汇总），先原样搬进 `design/desktop-reference/` 下一个新的 UMD 模块：
  - 只搬计算，不带任何 DOM；
  - 旧页面先改用这个模块，证明结果一致；
  - 给它加 `tests/m1/*.test.js` 单元测试；
  - React 页面再通过全局对象使用它。
  - 不得在 TypeScript 里重写这些计算。

### 2.5 门槛（每一步都要全部通过）

```bash
npm run build:ui
```

```bash
npm run verify
```

```bash
npm run audit:runtime
```

```bash
node scripts/m1/ui-foundation-ui-test.js
```

```bash
node scripts/m1/<page>-smoke-ui-test.js
```

- `npm run verify` 要求失败数为 0，其中包括类型检查、产物逐字节一致、设计检查。
- 最后一条只在页面步骤（M3 至 M8）跑。

另外按第 5 节，跑本页影响到的旧套件（源码模式）。打包验收不在每一步做，由 Claude 在 M9 统一做。

### 2.6 截图（每步必交）

- 1280×900，深浅色各一套。
- 内容：
  - 页面的每个主要状态：默认、空、加载、错误、部分数据、未知值；
  - 每个弹窗和下拉菜单的打开态；
  - 每个旧页面已有的悬停读数。
- 旧页面在同样状态下的截图，放进同一目录的 `before/`，作为对照。
- 截图脚本放在 `scripts/m1/` 或 `.cache/ui-tools/`，只用合成数据。

---

## 3. MVP 步骤总览

| 步骤 | 内容 | 产出可见变化 | 审核重点 |
|---|---|---|---|
| M1 | kit 组件和展示页 | 无（只有展示页） | 每个组件是否严格符合规范 |
| M2 | 数据适配层和页面冒烟模板 | 无 | 类型、只调用不重写 |
| M3 | 设置 | 设置页换成 React | 第一个完整页面，确立模式 |
| M4 | 来源管理 | 来源页 | 展开收起、状态、操作 |
| M5 | 会话 | 会话页 | 列表、搜索、详情弹窗 |
| M6 | 额度 | 额度页（含首屏三页、卡片、详情、连接登录） | 悬停读数、轮播、数据语义 |
| M7 | 用量 | 用量页（含热力图、趋势） | 图表视觉一致 |
| M8 | 费用 | 费用页（含首屏、环形图、按月柱图、明细、预算） | 图表、精确金额 |
| M9 | 外框和收尾 | 侧栏、标题栏、提示条；移除 legacy 层 | 打包验收（Claude） |

前一步审核通过才能开始下一步。M3 至 M8 的顺序不得调整。

---

## 4. 各步骤细则

### M1 kit 组件

**目标**：在 `ui/src/kit/` 实现规范第 4 节的组件（图表组件除外，图表放到用到它的页面步骤里做），并做一个展示页，供 Claude 一次性审核全部组件。

**可以改的文件**：
- `ui/src/kit/**`
- `ui/src/dev/kit-gallery.tsx`
- `ui/src/islands/index.ts`（注册 `kit-gallery`）
- `scripts/m1/ui-kit-gallery-ui-test.js`（新建）
- `scripts/m1/ui-foundation-ui-test.js`（所有者于 2026-10-25 针对 M1 待决问题 Q1 补充授权：注册 `kit-gallery` 时，仅把完整 API 断言中的预期注册清单从 `['probe']` 更新为 `['probe', 'kit-gallery']`；保留 `deepEqual`、版本和冻结状态检查，以及其余全部断言。此项不扩展 vendor、规范、设计检查或其他步骤的权限。）
- 所有者于 2026-10-25 针对 M1 记录 Q3 明确授权的 vendor 适配：`ui/src/vendor/fluid/components/select.tsx`、`dropdown.tsx`、`accordion.tsx` 仅将弹出层 / 内容开合的主 transition 及相关退出兜底改为既有 `spring.moderate` / `.exit`（Accordion 移除独立 opacity 时长，保留初始 / 减少动效分支），同步注释；并在 `ui/src/vendor/fluid/VENDOR.md` 登记。不扩展到其他 vendor、规范、token 或设计检查。
- 构建产物
- 记录

**组件和接口**：
- 组件命名和下面一致，统一从 `ui/src/kit/index.ts` 导出。
- 各组件的属性只能是下面列出的这些；fluid 组件原有、但这里没列出的属性，一律不透传。

```ts
Button({ variant: "primary" | "secondary" | "tertiary" | "ghost", tone?: "danger", size?: "default" | "compact",
         leadingIcon?, trailingIcon?, loading?, disabled?, onClick, children, "aria-label"? })
IconButton({ icon, label /* aria-label，必填 */, onClick, size?: "default" | "compact", disabled? })
Segmented<T extends string>({ value: T, onChange(v: T), items: { value: T; label: string; icon? }[], size?, "aria-label" })
SubTabs({ value: number, onChange(i: number), items: string[], idPrefix })
Select<T extends string>({ value: T, onChange(v: T), options: { value: T; label: string }[], placeholder?, size?, "aria-label" })
Menu({ trigger: ReactElement, items: { label: string; onSelect(): void; tone?: "danger"; disabled?: boolean }[] })
Switch({ checked, onChange(next: boolean), label, disabled? })
CheckboxGroup / RadioGroup：按 fluid 原接口包一层，只保留 value/onChange/items/disabled
Slider({ value: number, onChange(v: number), min, max, step, label, format?(v: number): string })
TextField({ value, onChange(v: string), label, placeholder?, type?: "text" | "number", error?: string })
SearchField({ value, onChange(v: string), placeholder, "aria-label" })     // 带清除按钮
Sheet({ open, onOpenChange, title, description?, size?: "sm" | "lg" | "xl", footer?: ReactNode, children })
Disclosure({ open?, defaultOpen?, onOpenChange?, summary: ReactNode, children })
Badge({ tone: "neutral" | "warn", children })      // 只映射到 fluid 的 gray 和 amber
Banner({ tone: "info" | "warn" | "error", title?, children, action?: ReactNode })
DataTable：按 fluid Table 包一层，增加 columns 和 rows 两个属性
ListRow({ leading?: ReactNode, title: ReactNode, meta?: ReactNode, trailing?: ReactNode, onClick?, selected? })
Card({ children, compact?: boolean })          // bg-surface-3 rounded-2xl p-6；compact 时用 p-4
PageHeader({ title, description?, actions?: ReactNode })
SectionHeader({ title, actions?: ReactNode })
Value({ value: string | null | undefined, unknown?: "未知" | "未定价", className? })   // value 为 null 或 undefined 时显示 unknown 文案，并加 data-value="unknown"
Figure({ text: string | null, unit?: string, size: "xl" | "lg" | "md" | "sm", unknown?: "未知" | "未定价" })  // 逐位滚动，用 data.enter / data.update
AgentMark({ agent: string, variant: "icon" | "dot", size?: 16 | 20 | 24 })
EmptyState({ message: string, action?: ReactNode })
Toast：toast.show(message: string, { tone?: "neutral" | "warn" })，同一时间只显示一条
CarouselDots：按 fluid 原接口包一层
```

**做法**：
- **视觉**：
  - kit 组件内部用 fluid 组件，加上规范允许的类名；
  - `Card`、`PageHeader`、`SectionHeader`、`ListRow`、`Value`、`Figure`、`AgentMark`、`EmptyState`、`Toast` 用 Tailwind 类名组合，所有取值都出自规范。
- **`Figure` 的数字滚动**：参照 `design/desktop-reference/ui-carousel.js` 的 `roll()` 的行为（逐位、从右往左错开、位数变化时淡入），用 Motion 和 `data.*` 实现；动效设为关闭时直接显示终值。
- **`AgentMark`**：图标 `<img src>` 写相对于 `index.html` 的路径 `assets/agents/<文件名>`（文件在 `design/desktop-reference/assets/agents/`），文件名和 Agent 的对应关系沿用旧页面的取法（以 `window.agentCatalog` 和旧代码为准），不得新增或重画图标。
- **展示页 `kit-gallery`**：每个组件的每种变体和状态都展示一次（默认、禁用、加载、错误、未知值、选中），用中文示例文字，数据全部是合成的。
- **截图脚本** `scripts/m1/ui-kit-gallery-ui-test.js`：
  - 挂载展示页，截取深浅两套整页图；
  - 截取每个下拉、菜单、弹窗、提示条的打开态；
  - 用 `ui-smoke.js` 的 `cleanRoomDiff`、`isolationViolations`、`semanticViolations` 检查，结果都必须为空；
  - 断言 `Value` 在未知时显示“未知”并带 `data-value="unknown"`。

**完成标准**：
- 门槛（第 2.5 节）全部通过；
- `kit-gallery` 截图齐全；
- 记录里每个组件都有一行，说明用了哪个 fluid 组件、固定了哪些选项。

---

### M2 数据适配层和页面冒烟模板

**目标**：
- 页面需要的桥接方法和全局模块都有类型；
- 有一个可以复制的页面冒烟测试模板。

**可以改的文件**：
- `ui/src/data/**`
- `scripts/m1/ui-page-smoke-template.js`（新建）
- 记录

**做法**：
1. **`ui/src/data/bridges.ts`**：
   - 盘点所有旧页面脚本对 `usageBridge`、`quotaBridge`、`windowBridge` 的调用（`rg "usageBridge\.|quotaBridge\.|windowBridge\."`）；
   - 为每个方法写返回值类型（以实际数据结构为准，对照 `src/quota/preload.js` 和 `src/m1`），并提供 `useBridge` 类的 hook：加载中、出错、数据三种状态，并支持订阅 `onUpdate`；
   - 不改变任何调用参数。
2. **`ui/src/data/globals.ts`**：为第 2.4 节列出的全局模块写类型声明，只声明页面会用到的函数，签名以源码为准。
3. **`scripts/m1/ui-page-smoke-template.js`**：基于 `ui-smoke.js` 的模板，包含：
   - 启动合成环境，切换到该页；
   - 深浅两色截图；
   - `isolationViolations`、`semanticViolations` 都为空；
   - 对每个弹窗：打开、焦点进入、Esc 关闭、焦点返回；
   - 没有控制台错误；
   - 动效设为关闭后再截一次图，确认没有停在半途的动画。

**完成标准**：
- 门槛全部通过；
- 记录里列出每个桥接方法的类型来源（文件和行号）。

---

### M3 至 M8 页面迁移（每页同一套子步骤）

| 步骤 | 页面 | 旧代码（盘点时以实际为准） | 旧套件（至少） |
|---|---|---|---|
| M3 | 设置 `#settings` | `settings-ui.js`、`settings.css`、`pricing-*.js`（定价分区）、`maintenance-ui.js`、`codex-maintenance.js`，`#profileDialog`、`#exportDialog` | `billing-query`、`unpriced-guidance`、`style-alignment`、`interaction-reliability`、`custom-sources`、`workbench` 的设置部分 |
| M4 | 来源管理 `#sources` | `sources-ui.js`、`source-connections-ui.js`、`agent-setup-ui.js`、`agent-install-ui.js`、`config-health-ui.js`、`config-manager-ui.js`、`custom-sources-ui.js`，以及对应的 css，`#sourceDialog` | `agent-install`、`agent-setup`、`config-health`、`collection-diagnostic`、`agent-conflict`、`source-quota`、`custom-sources` 和多页套件的来源部分 |
| M5 | 会话 `#sessions` | `sessions-ui.js`、`sessions.css`，`#sessionDetailDialog` | `sessions` 和多页套件的会话部分 |
| M6 | 额度 `#quota` | `quota-ui.js`、`quota-cards.js`、`quota-hero.js`、`quota-progress.js`、`provider-quota-ui.js`、`ui-carousel.js`（费用页仍在用，等 M8 再删），`#quotaSheet`、`#quotaLoginDialog` | `quota`、`quota-v4`、`quota-identity`、`provider-quota`、`provider-login`、`provider-client`、`continuity`、`overview`、`motion`（额度部分）、`visual`、`render-performance`（额度部分） |
| M7 | 用量 `#usage` | `preview.js` 里的用量部分（外框部分留到 M9）、`usage.css`、`rhythm.css`、`chart-ui.js`，热力图和趋势 | `usage`、`activity`、`agent-recovery`、`statistics-worker`、`layout`、`detail` 等 |
| M8 | 费用 `#cost` | `cost-*.js`、`cost.css`、`insights*.js`、`integrated-insights.css`、`ui-carousel.js` | `cost`、`cost-layout`、`cost-compact`、`cost-composition`、`cost-rebuild`、`budget-overview`、`renderer-lifecycle`、`render-performance`（费用部分） |

#### 子步骤 a：盘点（只出文档，交审后停止）

写 `docs/m2/UI-MIG-<步骤>-INVENTORY-<日期>.md`，包含以下内容：

1. **功能清单**：本页每个区块、控件、状态、弹窗、悬停读数、键盘操作、空状态、错误状态、加载状态，逐条编号（F1、F2 …），注明它在旧代码里的出处（文件和行号）。
2. **数据清单**：每条数据从哪个桥接方法或全局函数来，未知、部分、未定价时分别怎么显示。
3. **耦合清单**：
   - 别的脚本引用本页 DOM 或全局对象的地方（用 `rg` 搜本页所有 `id` 和 `window.<page>Ui`）；
   - 本页引用别处的地方；
   - 每一条写明迁移后怎么处理。
4. **kit 映射**：每个功能用哪个 kit 组件。kit 没有对应组件的，列入“待决问题”。
5. **外观差异**：按规范统一后，看起来会变化的地方，逐条列出（例如原生 `select` 变成 fluid 的选择框）。
6. **测试映射**：本页旧套件里涉及本页的每条断言，归到下面四类之一：
   - (i) 冒烟测试；
   - (ii) 单元测试；
   - (iii) 新的页面测试；
   - (iv) 退役，并写明理由。
7. **待决问题**。

#### 子步骤 b：实现

- 页面放在 `ui/src/pages/<page>/`，按区块拆文件。
- 页面计算按第 2.4 节处理。
- 覆盖功能清单上的每一条。

#### 子步骤 c：对照和测试

- 新建 `scripts/m1/<page>-smoke-ui-test.js`，以 M2 的模板为基础，加上测试映射里归入 (i) 和 (iii) 的断言。
- 把同一状态下旧页面（`before/`）和新页面的截图放在一起，逐条核对功能清单，写进记录。

#### 子步骤 d：退役旧代码

- 删除本页的旧脚本、样式和 `index.html` 里对应的内容。
- 同步更新 `legacy.css`、`serve.js` 白名单、`audit-runtime` 的资源列表和相关测试。
- 旧套件按测试映射处理：
  - 只测本页的套件整个删除；
  - 多页套件只删本页那一部分。
- 确认再也没有引用本页旧 id 的代码：`rg` 的搜索结果附在记录里。

#### 子步骤 e：记录并交付

按第 2.1 节交付。

#### 各页额外要求

- **M3 设置**：
  - **先读 `docs/m2/UI-MIG-M1-M3-REVIEW-20261025.md`**（2026-10-25 审核裁决）：M3 拆成 M3k（kit 扩展）和 M3（页面）两步，各自交审；Q1–Q9 的范围、接口、视觉映射和测试替换以该记录为准；
  - 主题和动效设置被外框和其他代码读取（`preview.js` 的 `applyTheme`、`motion.js`）。实现时要保持 `#themeSelect`、`#motionSelect` 的行为，或者改成调用旧代码已有的函数，盘点时说明方案；
  - 定价分区的数据和编辑逻辑全部沿用现有模块。
- **M6 额度**：
  - 首屏三页（现在、接下来、余额）的行为以 `docs/m2/UI-QUOTA-HERO-20261024.md` 为准，翻页用 `CarouselDots` 加拖动或滑动，动效 `spring.slow`；
  - 圆环、时间线、阶梯图做成 kit 图表组件，视觉和交互与现在一致；
  - 卡片拖动排序、筛选、需要处理一栏、本机偏好（`agentusage.quotaCards.v1`）的格式保持不变。
- **M7 用量**：热力图、趋势图的配色和交互沿用现在的样子；图表组件放进 kit。
- **M8 费用**：
  - 首屏两页、花在哪（环形和半环）、按月柱图、费用明细、订阅对照、预算，行为以 `UI-COST-V3-20261024.md` 和 `UI-COST-HERO-20261024.md` 为准；
  - 金额的上下界和“至多”文案保持不变；
  - 在本步骤删除 `ui-carousel.js`。

---

### M9 外框和收尾

**目标**：
- 侧栏、标题栏、页面切换、提示条、全局快捷键换成 React；
- 去掉 legacy 层。

**做法**：
1. 先盘点（同子步骤 a），对象是 `preview.js`（外框部分）、`window-shell.js`、`interactions.js`、`motion.js`、`focus.js`、`detail-interactions.js`、`segmented.js`、`select-ui.js`、`date-range.js`、`morph.js`、`scroll-fade.js` 和剩下的全部样式。
2. 外框实现成一个 `app` 组件，挂在 `body` 下唯一的根节点上，页面直接作为它的子组件，不再经过 `islands.js`。
3. 删除 `legacy.css` 和剩下的旧样式，`@layer legacy` 和 `ui-reset` 层也一起删掉；同步更新 `ui-bundle.test.js`、`audit-runtime`、`serve.js`。
4. Claude 做打包验收：`dist:win:dir`、`audit:package`，在打包版上跑全部冒烟测试，更新 `AGENTS.md`、`CONTRIBUTING.md`。

---

## 5. 旧测试的处理规则

- **最低要求**：每个页面步骤结束时，下面每一条都要成立。
  - 本页的冒烟测试通过；
  - 测试映射里的每条断言都已经落实，或者已经退役并写明理由；
  - 仍然存在的多页套件通过，或者已在记录里写明哪一条因为别的页面还没迁移而暂时失败（附原因）。
- **哪些断言不得退役**：
  - 数据语义：未知、未定价、部分数据、精确小数、不相加；
  - 隐私：不读真实数据；
  - 安全：CSP、桥接参数校验；
  - 键盘可达。
- **`cost-ui-test.js`**：它在 `main` 上已经失败（费用环形图中心悬停读数，2026-10-25）。M8 的测试映射要单独说明这一条怎么处理。

---

## 6. Claude 的审核清单（供你自查）

1. **设计检查**：设计检查通过，没有绕过；`className` 里只有规范允许的类名。
2. **组件**：页面只用 kit 组件；新增的 kit 组件已经过审。
3. **截图**：深浅两色和每个状态都有，和 `before/` 对比，差异全部在“外观差异”清单里。
4. **功能和数据**：功能清单逐条核对通过；数据清单中的未知值、部分数据、精确小数有截图证据。
5. **悬停**：悬停行为与旧页面一致（规范第 7 节）。
6. **动效**：只用规范的档位；动效设为关闭或减少时，没有半途停住的动画。
7. **键盘和焦点**：键盘可以走完全部操作，弹窗的焦点进出正确。
8. **测试**：测试映射没有遗漏，没有放宽测试。
9. **文件范围**：没有改动范围外的文件。

审核不通过时，Claude 会在记录后面追加“审核意见”，你按意见修改后重新交付；Claude 也可能直接修改并合入。

---

## 7. 记录模板 `docs/m2/UI-MIG-<步骤>-<日期>.md`

```markdown
# <步骤> <页面或主题> · <日期>

## 范围
- 分支 / 提交：
- 改动的文件（按目录）：

## 实现
- 页面结构（区块 → kit 组件）：
- 数据来源（桥接方法 / 全局函数）：
- 耦合处理：

## 对照
| 编号 | 功能 | 旧行为 | 新行为 | 截图 |
|---|---|---|---|---|

## 外观差异（按规范统一）
-

## 测试
- 门槛：build:ui / verify（失败数为 0）/ audit:runtime / ui-foundation / <page>-smoke
- 旧套件：跑了哪些，结果如何；没跑哪些，为什么
- 测试映射：(i) … (ii) … (iii) … (iv) 退役：…

## 没做 / 待决问题
-
```

---

## 8. 不在本计划范围内

- 新功能、新页面、新数据、新桥接方法。
- 改文案、改信息架构、改页面顺序。
- 统一或重新设计悬停交互（以后另立规范）。
- 后端、preload、主进程（M9 的外框不需要改主进程；如果需要，停下来提问）。
- 改依赖版本、升级 fluid。
- 打包发布（由发布负责人和 Claude 做）。

---

## 9. 连续执行模式（所有者 2026-10-25，替代 M3–M8 的逐步审核）

所有者决定：Claude 亲自做 M3k 和 M3，作为示范页；Codex 先完成 M4–M8 的全部盘点，再连续实现 M4–M8，最后统一交审。本节与前文冲突时以本节为准；第 0.3 节铁律、第 2.5 节门槛和规范全部照旧。

### 9.1 分工

| 谁 | 做什么 | 分支 |
|---|---|---|
| Claude | M3k（kit 扩展，见 `UI-MIG-M1-M3-REVIEW-20261025.md` 第 3 节）和 M3 设置页，合入 main 作为示范 | `ui/mig-m3k-kit`、`ui/mig-m3-page` |
| Codex 阶段一 | M4–M8 五页的盘点，只出文档，可与 Claude 的 M3 同时进行 | `ui/mig-m4-m8-inventory` |
| Claude | 一次性裁决五份盘点的待决问题，并写定 M6–M8 图表组件的接口，记录为 `docs/m2/UI-MIG-M4-M8-RULINGS-<日期>.md` | — |
| Codex 阶段二 | 连续实现 M4 → M5 → M6 → M7 → M8 | `ui/mig-m4-m8` |
| Claude | 统一审核、修改、逐页合入 | — |

### 9.2 阶段一：盘点（现在就可以开始）

- 从本地 main 新建 `ui/mig-m4-m8-inventory`，按第 4 节子步骤 a 的七项要求，写 `docs/m2/UI-MIG-M4-INVENTORY-<日期>.md` 到 `M8`，每页一个文件、一个提交。
- 盘点格式照 `UI-MIG-M3-INVENTORY-20261025.md`，它是合格的范例。
- 待决问题照实列出；不得在盘点里替 Claude 做选择。kit 已有的组件（包括 M3k 新增的，见审核记录第 3 节）直接映射，不必再问。
- 图表（圆环、柱图、折线、时间线、热力图、阶梯图等）在盘点里只描述现有行为：尺寸、数据、颜色、动效、悬停读数、键盘、空 / 未知 / 部分状态，并注明出处。接口由 Claude 定。
- `preview.js`、`index.html` 等共享文件会被 Claude 的 M3 改动，行号以盘点时的 main 为准；阶段二实现前重新核对。
- 五份写完后交付并停止。

### 9.3 阶段二：连续实现（裁决记录合入 main 后才开始）

- **开始条件**：本地 main 上同时存在 `docs/m2/UI-MIG-M4-M8-RULINGS-<日期>.md` 和 M3 设置页（`ui/src/pages/settings/`）。缺任何一个都不开始。
- **照着示范写**：页面结构、文件拆分、`window.<page>Host` / `window.<page>Ui` 接口的写法、UMD 提取方式、冒烟测试的写法和截图组织，一律照 M3 的做法。示范没覆盖的，照裁决记录；两者都没覆盖的，按 9.4 处理。
- **顺序以裁决记录为准**：`UI-MIG-M4-M8-RULINGS-20261025.md` 第 1 节在 M4 前加 MK-a、在 M6 前加 MK-b（kit 与图表扩展），并逐条授权其中的 kit / theme / token 改动。
- **分支和提交**：从当时的 main 新建 `ui/mig-m4-m8`，按 M4 → M8 的顺序在同一分支上实现。每页完成子步骤 b–d 后提交一次（可以拆成多个提交，但不同页面不混在一个提交里），提交信息以 `M4:` … `M8:` 开头。
- **每页都要过门槛**：第 2.5 节门槛全部通过后才进入下一页；截图照第 2.6 节放进 `artifacts/ui-mig/<步骤>/`。`before/` 截图在开始实现前从 main 检出上截取。
- **每页写记录**：`docs/m2/UI-MIG-<步骤>-<日期>.md`，模板见第 7 节。
- **全部完成后**写一份 `docs/m2/UI-MIG-M4-M8-DELIVERY-<日期>.md`，列出：每页的提交号、门槛结果、截图目录、跳过的项、待决问题，然后停止，等 Claude 审核。

### 9.4 遇到第 0.4 节的停止条件时

- **只影响当前页的某一项**：在该页记录的“待决问题”里写清楚，这一项保留旧实现（旧代码、旧 DOM、旧测试原样不动），继续做这一页的其余部分和后面的页面。
- **影响 kit、规范、vendor、theme、tokens、设计检查，或影响后面多页**：停止全部工作并提问。不得自己扩展 kit 接口、加设计例外或换写法。
- 不得以“示范页里没有”为由自己设计外观；外观问题一律按上面两条处理。
