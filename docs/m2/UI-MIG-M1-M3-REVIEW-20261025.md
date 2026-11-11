# M1 / M2 审核与 M3 盘点裁决 · 2026-10-25

**审核人**：Claude（规范和计划的作者）。本记录对 Codex 和后续步骤具有约束力，与 `UI-SPEC-20261025.md`、`UI-MIGRATION-PLAN-20261025.md` 同级；三者冲突时以本记录为准。

## 1. 结论

| 对象 | 结论 |
|---|---|
| M1 kit（`f5f27ca`） | **通过**。组件 API 与计划一致，外观符合规范，深浅两色和关闭动效截图齐全，clean-room 差异为空。Q1、Q3 的 vendor / 测试改动范围与授权一致。有 2 处行为缺口，并入 M3k 修复（见第 3 节第 1、2 条）。 |
| M2 数据层（`d09357f`） | **通过**。桥接类型与 preload 一致，`useBridge` 的串行、作用域切换、迟到结果和卸载处理正确；`shell.ts` 用既有 `ui-view-change` 事件，比我原来的 MutationObserver 方案更直接，采纳。 |
| M3 盘点（`2b7ba6c`） | **通过**，作为 M3 的验收清单（F1–F38、C1–C16、测试映射 T-*）。Q1–Q9 按第 4 节裁决。 |

审核时 Claude 补的修改（在合入提交里）：

- `.gitignore` 的 `data/` 规则把 `ui/src/data/` 也忽略了。我在 6f6b288 写的 `shell.ts` 因此没有入库；Codex 在 M2 用 `git add -f` 绕过了。现已加 `!ui/src/data/`，以后正常 `git add` 即可。
- 头像的三种色调原来写死在 `style.css`。现已移进 `tokens.css` 的 `--avatar-*`，并映射成 `bg-avatar-*` 等工具类，供 M3k 的 `Avatar` 使用。旧侧栏改用同一组变量，像素不变。

合入后在 main 上已跑：`verify` fail 0、`audit:runtime`、foundation、kit-gallery、页面模板、style-alignment，全部通过。

## 2. M3 拆成两步

设置页同时带着价格编辑器，而价格编辑器费用页也在用，一次做完风险太大。所以拆成：

1. **M3k**：kit 扩展（第 3 节）+ 展示页 + 展示页测试。单独交审、单独合入。
2. **M3**：设置页本身，即计划里的子步骤 b–e。从合入 M3k 之后的 main 新建分支。

两步都照计划第 2.1 节交付，审核通过前不开始下一步。

## 3. M3k：kit 扩展（接口和取值都已定，不得自行增减）

**可以改的文件**：`ui/src/kit/**`、`ui/src/dev/kit-gallery.tsx`、`scripts/m1/ui-kit-gallery-ui-test.js`、构建产物、记录。不改 vendor、theme、tokens、设计检查。实现中发现必须改这些文件时，停下来提问。

### 已有组件的修改

1. **`Toast`**：每条消息显示 4500 ms 后自动消失。这和旧版 `preview.js:294` 一致；新消息到来时重新计时。时长写成 `data-display.tsx` 里的具名常量，并注明出处。（M1 缺口）
2. **`SearchField`**：
   - 清除按钮的标签改为“清空搜索”，旧页面全部用这个文案。（M1 缺口）
   - 新增 `maxLength?: number`。
   - 有内容时，按普通 Escape 清空并保持焦点。
   - 输入法组字期间（`isComposing` 或 `keyCode === 229`）按 Escape 什么都不做。
3. **`TextField`**：
   - 新增 `required?`、`maxLength?`、`min?`、`max?`、`step?: number | "any"`、`disabled?`、`readOnly?`、`inputMode?: "text" | "decimal" | "numeric"`、`name?`，原样传给 fluid `InputField`（它会把原生属性展开到 input 上）。
   - 用 `forwardRef` 把 ref 指到原生 input，供页面“聚焦第一个出错的输入框”。
4. **`Select`**：新增 `disabled?`。
5. **`Button`**：
   - 新增 `type?: "button" | "submit"`，默认 `"button"`；
   - `type="submit"` 时 `onClick` 可省略。
6. **`Sheet`**：输入法组字期间按 Escape 不关闭（在 `onEscapeKeyDown` 里 `preventDefault`）。
7. **`Segmented`**：`items` 的每一项新增 `disabled?: boolean`。
8. **`SectionHeader`**：新增 `description?: string`，显示在标题下方，`text-caption text-muted-foreground`，与标题间隔 `gap-2`。
9. **`Card`**：新增 `title?: string`、`meta?: ReactNode`。
   - 头部一行：标题用 `text-subtitle font-semibold`，meta 在右侧，用 `text-caption text-muted-foreground`。
   - 头部与内容间隔 `gap-3`。
10. **`DataTable`**：
    - 新增 `rowKey(row): string`（必填）；
    - 新增 `onRowClick?(row)`。它只是指针的便捷入口，键盘入口仍是行内的 `Button`；
    - `Column` 新增 `title?(row): string | undefined`，渲染成单元格的原生 `title`（规范第 7 节：保留原有悬停读数）；
    - `Column` 新增 `headerTitle?: string`。

### 新组件

11. **`Form({ onSubmit(): void, children, "aria-label"? })`**
    - 渲染原生 `<form>`。
    - 提交时 `preventDefault`：`checkValidity()` 不通过，就调用 `reportValidity()`，并且不调用 `onSubmit`。
    - 输入法组字期间的 Enter 不提交。
12. **`SettingRow({ title: string, description?: ReactNode, control?: ReactNode })`**
    - 一行设置项：`flex items-center justify-between gap-3`，`min-h-9 py-3`。
    - 行与行之间 `border-b border-border`，最后一行没有分隔线。
    - 标题 `text-body text-foreground`；说明 `text-caption text-muted-foreground`，放在标题下方；控件放在右侧。
13. **`Avatar({ initials: string, label: string, tone: "indigo" | "teal" | "coral", photo?: string | null, size: 24 | 40 | 64 })`**
    - 圆形 `rounded-full`。
    - 底色和文字色：`bg-linear-135 from-avatar-<tone>-from to-avatar-<tone>-to text-avatar-<tone>-text`。
    - 尺寸 `h-6 w-6` / `h-10 w-10` / `h-16 w-16`；字母分别用 `text-micro` / `text-subtitle` / `text-title`，`font-semibold`。
    - 有照片时显示 `<img alt={label}>`（`object-cover`），否则显示字母，并加 `role="img"` 和 `aria-label={label}`。
    - 字母由页面通过 `profile-model.js` 计算后传入，kit 不计算。
14. **`FileButton({ label: string, accept: string, onFile(file: File): void, disabled?: boolean, busy?: boolean })`**
    - 外观是 `secondary` 的 `Button`。点击时触发一个带 `hidden` 属性的原生 file input。
    - 每次选完把 input 的值清空，这样同一个文件可以再选一次。
    - `busy` 映射到 `Button` 的 `loading`。
15. **`CodeBlock({ text: string, "aria-label": string })`**：只读的多行文本，用于 JSON 预览。
    - 渲染成 `<pre tabIndex={0}>`，类名：`rounded-xl bg-surface-2 p-4 text-caption font-mono max-h-64 overflow-auto whitespace-pre-wrap break-all`。
16. **`Meter({ segments: { value: number; tone: "done" | "warn" | "muted"; label: string }[], "aria-label": string })`**
    - 轨道：`flex h-1.5 overflow-hidden rounded-full bg-surface-2`。
    - 段的颜色：`done` → `bg-success`，`warn` → `bg-warn`，`muted` → `bg-muted-foreground`。旧版的斜纹改成纯色。
    - `value` 是 0–1 的比例，由现有模块算好再传入；比例未知的段，页面不传，并在旁边用 `Value` 显示“未知”。
    - 宽度变化：首次出现用 `data.enter`，之后用 `data.update`；减少动效或关闭动效时直接显示终值。
    - 整体 `role="img"`，`aria-label` 由页面传入现有说明文案。
    - **规范补充**：`bg-success` 只允许用于 `Meter` 的 `done` 段，即“已计价”的覆盖比例。它说明覆盖状态，不评价用量多少。
17. **`ScrollArea({ children, maxHeight: "sm" | "md" | "lg", "aria-label": string })`**
    - 包装 fluid `ScrollArea`；`sm` / `md` / `lg` 分别为 `max-h-64` / `max-h-96` / `max-h-128`。
    - 边缘淡化（helper `ff-scroll-fade`）：
      - 只在该方向还有内容时出现；
      - 没有溢出时不出现；
      - 尺寸或内容变化后重新计算；
      - 焦点在区域内时去掉淡化（`focus-within`）。
    - 滚到边界后，继续滚动会带动页面滚动：不要加 `overscroll-contain`。
18. **`Combobox<T extends string>({ value: T | null, onChange(v: T), options: { value: T; label: string; description?: string }[], placeholder: string, searchPlaceholder: string, emptyText: string, "aria-label": string, disabled?: boolean, size?: "default" | "compact" })`**
    - 基于 fluid `DropdownMenu` + `DropdownSearch` + `MenuItem`；触发器的外观和 kit `Select` 的触发器完全相同。
    - 过滤：对 label、description 和 value 做不区分大小写的子串匹配。
    - 长列表在弹出层内滚动；没有匹配项时显示 `emptyText`。
    - 键盘：
      - 打字进入搜索框，上下方向键移动，Enter 选中；
      - 在 `Sheet` 里使用时，Escape 只关闭弹出层，`Sheet` 保持打开；
      - 输入法组字期间的方向键、Enter、Escape 都不生效。

### 展示页和测试

- 每个新组件、每个新属性都要在 `kit-gallery` 里出现。
- 在展示页测试中为下列行为写断言：
  - Toast 4.5 秒后自动消失；
  - Form 的原生校验，校验不通过时不提交；
  - SearchField、Sheet、Form、Combobox 的输入法保护；
  - Combobox 嵌在 Sheet 里时 Escape 的分层；
  - ScrollArea 的上下淡化、聚焦后去掉淡化、滚到边界后带动页面；
  - 关闭动效时，Meter 直接显示终值宽度；
  - FileButton 可以重复选择同一个文件；
  - Avatar 的三种色调和照片两种状态。
- 截图照计划第 2.6 节，深浅两色。

## 4. M3 盘点 Q1–Q9 裁决

### Q1 范围：批准，限定在下列文件和接口

- **旧代码向 React 提供的接口**：在 `preview.js` 里新增全局对象 `window.settingsHost`，由旧代码拥有。现有逻辑原样搬进这些函数，包括其中的提示文案。
  - `theme.get()` 返回 `"system" | "light" | "dark"`；`theme.set(v)` 调用现有的 `setTheme`。`applyTheme` 不再写 `#themeSelect`。
  - `collection.get()` 返回 `{ mode: "desktop" | "snapshot" | "demo", enabled, collecting, intervalMs, error }`。
  - `collection.setEnabled(v)`、`collection.setInterval(ms)`：搬入现有的事件处理逻辑，包括原有提示和失败后恢复显示。
  - `profile.get()`；`profile.save(p)` 返回 `{ ok: true } | { ok: false, error: "storage" }`。
  - `demo.get()` / `demo.set(state)`。
  - `exportPayload({ range: "all" | "current", sources: boolean })`：返回现有构建函数生成的导出对象。没有桥接时，现有的 Blob 下载逻辑也搬成 `download(payload)`。
  - 以上任何一项变化后，派发 `window` 事件 `settings-host-change`。
- **React 页面对外的接口**：`window.settingsUi = { openProfile(), openExport(), openSection(name) }`。侧栏的头像和“编辑资料”、用量页的导出按钮、`insights-ui.js` 的“去定价”都改为调用它。
- **价格编辑器**：`window.uiPricingEditor` 保持原有的 `open` / `explain` / `model` 签名和返回值不变，改由 React 设置页的 island 注册。island 在页面加载时就会挂载，不论当前显示哪一页，所以 `cost-page.js` **一行都不改**。`uiPricingCtl` 退役，测试改为操作界面。
- **可以定向修改的旧文件**（只能去掉对设置页 DOM 的访问，改调上面的接口）：
  - `preview.js`；
  - `motion.js`：删除设置行的插入、`#motionSelect` 的同步，以及对设置状态的观察；React 改用 `uiMotion.preference` / `setPreference` 和 `ui-motion-change` 事件；
  - `design/desktop-reference/window-shell.js`：仅改 `theme-*` 命令，改调 `settingsHost.theme.set`；
  - `sessions-ui.js`：演示状态改调 `settingsHost.demo` 并监听事件；
  - `insights-ui.js`：只迁走重估相关的部分；
  - `scroll-fade.js`：删除 `#priceRows`。
- **随退役一起修改**：`pricing-controller.js`、`settings-ui.js`、`maintenance-ui.js`、`index.html`、各 CSS 文件中本页专用的选择器（逐条删除；混在共用文件里的规则不整文件删）、`legacy.css`、`serve.js`，以及测试映射里列出的测试。
- **其他文件**，包括 `cost-page.js`、`src/**` 和 preload：一律不改。确实需要改时，停下来提问。

### Q2 控件属性

按第 3 节第 2–5、11 条执行，表单统一走 kit `Form`。页面不得自己拼原生 `input` 或 `form`。

### Q3 新组件

按第 3 节第 13–17 条执行。侧栏头像属于外框，M9 前保持旧代码，用的是同一组 `--avatar-*` 变量。

### Q4 视觉映射

- **页面宽度**：内容列 `mx-auto w-full max-w-205`（820px，等于原 `--settings-width`）。`mx-auto` 和 `max-w-*` 只允许在页面最外层使用。
- **页头**：`PageHeader`，标题“设置”，说明沿用原文；左对齐，原来是居中，这是规范统一带来的差异。`actions` 放 `SearchField`（`w-64`，`maxLength={60}`）。
- **分类导航**：用 `Segmented`（带图标），不用 `SubTabs`，因为原来的外观就是分段控件。
  - 图标用 Tabler：常规 `IconSettings`、采集 `IconRefresh`、定价 `IconDatabase`、数据与安全 `IconShieldCheck`、关于 `IconInfoCircle`。
  - 当前分类由滚动位置决定（scroll-spy），滚到底部时选“关于”。
  - 点击分类时把对应区块滚到可见位置：完整动效时平滑滚动，减少或关闭动效时直接跳转。
  - 搜索期间，没有匹配项的分类设为 `disabled`。这取代了原来的变淡效果。
- **区块**：区块之间 `flex flex-col gap-8`。每个区块是 `SectionHeader`（带 `description`），间隔 `gap-3` 后接一个或多个带 `title` / `meta` 的 `Card`，卡片里是 `SettingRow`。
- **搜索结果**：不再给匹配行加高亮，只隐藏不匹配的行。这是外观差异，记录到页面记录里。
- **隐私三栏**：放在一个 `Card` 里，用 `grid grid-cols-1 gap-6 md:grid-cols-3`；每栏只有标题（`text-subtitle font-semibold`）和正文（`text-caption`），没有内层底色。
- **关于 / 支持的来源**：一个 `Card`，内部用 `grid grid-cols-1 gap-x-6 md:grid-cols-3` 排 `ListRow`。
  - 每个 `ListRow`：`leading` 为 `AgentMark` 图标（16），`title` 为名称，`trailing` 为 neutral 的 `Badge`，`onClick` 沿用原有的跳转。
- **定价覆盖**：`Figure size="md"`，单位文字为原文“的用量已定价”；下方是 `Meter`（已计价 / 可补价格 / 用量缺失），再下面是说明。
- **弹窗尺寸**：资料 `sm`，导出 `lg`，价格编辑器 `lg`。
- **提示**：M9 前，React 页面的提示统一调用旧的 `window.usageData.toast(message)`，保证全应用只有一个提示宿主。页面不挂载 kit 的 `Toast`。

### Q5 搜索选择、表格、分类

- 目录、模板、默认模型三处的可搜索选择都用 `Combobox`（第 3 节第 18 条）。
- 已用模型表用 `DataTable`：
  - `rowKey` 用模型的 key；
  - `onRowClick` 打开编辑器；
  - 行内的模型名是一个 `Button`，作为键盘入口；
  - 费率、目标和缺口的原有 title 读数，用 `Column.title` 保留。
- 分类导航见 Q4。

### Q6 弹窗实现和测试替换

- 弹窗一律用 kit 的 `Sheet`（Radix）。焦点限制、返回、Escape 分层由 Radix 和第 3 节的输入法保护负责。
- 下列断言测的是旧的实现方式，批准退役，并换成新断言：
  - **T-F03**（backdrop blur）→ 弹出层背景不透明（计算后 alpha 为 1），且文字对比度 ≥ 4.5:1。
  - **T-MO02**（CSS 动画时长 ≤ 150）→ 减少动效时，弹窗在任何采样帧上 `transform` 都为 `none`，只有透明度变化。
  - **T-MO04**（280 ms 和固定帧）→
    - 完整动效：打开后 400 ms 内 `opacity` 为 1、`transform` 为 `none`，且焦点在弹窗内；
    - 关闭动效：下一帧即为终态。
  - **T-MO07**（180 ms）→ 关闭后 300 ms 内弹窗已移除，或不再拦截指针。
- 其余 T-* 照盘点的映射执行；数据、安全、隐私和键盘相关的断言一条都不退役。
- 计划第 2.6 节要求的 `before/` 截图，必须在 main 的检出上用旧页面截取；不能用模板在迁移后的构建里截。

### Q7 数据语义

- 覆盖比例为 null、缓存费率未知：React 页面用 `Value` 显示“未知”，带 `data-value="unknown"`（规范第 6 节）。
  - `uiPricingView` 的旧输出不改，费用页在 M8 之前仍在用它。
  - 对 null 不调用格式化函数。
- `stats.tokens || 0`：这是已观察到的 token 计数，没有记录就是 0，不属于“未知用量”。保留。
- 覆盖比例跨 Agent 计算：这是现有的汇总，不是新增的合计。照原逻辑保留，不得新增其他合计。

### Q8 文案

- M3 一律保留原文，不改字。
- 隐私三栏已由所有者决定改写，见 `UI-PRIVACY-COPY-20261025.md`。M3 照新文案原样搬入。

### Q9 纯展示模块

- React 只能调用 `uiPricingView` 中返回纯文本的函数：`short`、`percent`、`coverageNote`、`catalogLine`、`catalogTitle`、`countsText`。返回 HTML 的函数一律不用。
- HTML 生成函数里的文本判断（状态、建议、缺口说明等），按以下顺序处理：
  1. 在 `pricing-view.js` 内拆出一个返回文本或数据的函数；
  2. 旧的 HTML 函数改为调用它；
  3. 拆之前先保存旧输出，用单元测试证明拆分后 HTML 字节不变；
  4. React 调用拆出的函数。
- 新 UMD 模块的文件名定为：
  - `profile-model.js`：字母、校验、存储 key 和格式、照片类型与大小检查；
  - `pricing-editor-model.js`：表格筛选 / 排序 / 折叠、试算文案、规则校验；
  - `codex-maintenance-model.js`：从 `codex-maintenance.js` 中拆出维护差额的计算和文案。
- 每个新模块：在 `index.html` 中位于 `islands.js` 之前加载，加入 `serve.js` 白名单，并配套 `tests/m1/*.test.js`。顺序照计划第 2.4 节：先让旧页面改用模块并证明结果相同，再给 React 用。
