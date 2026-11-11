# 费用页去掉参考模式，改用共用组件 · 2026-10-28

**状态**：Claude 实现，分支 `ui/shell-cost-ref`。所有者 2026-10-28 要求“开始去掉费用页参考模式”。本次只跑了约 20 分钟的精简测试，全量验收交给 Codex（见第 4 节）。分支还没合入 main。

## 1. 为什么要去掉

M8 为了让费用页和旧版一模一样，给费用页另写了一套样式，叫“参考模式”：
- 一个 1594 行的专用样式文件 `ui/src/theme/cost-reference.css`；
- 组件库（kit）里约 430 行“如果是费用页就换一种画法”的分支，有几处还按中文按钮文字挑样式；
- 一份单独的动效参数 `ui/src/design/cost-reference-motion.ts`。

这套东西用户看不出来，但维护成本高：改一个按钮的文字，它的样式就可能悄悄丢掉。M8 审核时已把它记为待还的债（`UI-MIG-M8-REVIEW-20261028.md` 第 2 节）。

## 2. 改了什么

- **删除的文件**：
  - `kit/cost-reference.tsx`（参考模式的入口和 `CostIcon`）；
  - `theme/cost-reference.css`；
  - `design/cost-reference-motion.ts`；
  - `tokens.css` 里只给参考模式用的 `--cost-ref-*` 变量；
  - 图表几何里只给参考模式用的 `costNiceMax` 和 `costStackFrame`；
  - 对应的测试：`tests/m1/cost-reference-motion.test.js`、`scripts/m1/cost-reference-motion-ui-test.js`、`scripts/m1/cost-reference-check.js`。
- **kit**：每个组件只保留一种画法。
  - 改动涉及按钮、分段控件、下拉、勾选、输入框、表单、表格、卡片、弹出面板、折叠、徽章、横幅、数字、走马灯、双栏、边缘触发，以及六种图表。
  - `PageHeader` 原来只有参考模式会显示 `inlineActions`，现在默认画法也会显示。
  - 折线图的纵轴：调用方给的刻度可以不到顶。例如费用详情只给 0 和中点两个刻度；数据超过最高刻度时，改为按数据重新取上限，曲线不再越出图框。
- **费用页**（`ui/src/pages/cost/*`）：
  - 141 处 `ff-ref-*` 样式类全部换成 kit 组件和 Tailwind 的 token 类。
  - 图标改用 Tabler 图标，和其他页面一样。
  - 明细表每行末尾多一个“详情”按钮，键盘能直接打开详情；原来这个入口是参考模式下整行的按钮。
  - 原来贴在各区块外面的标题（花在哪以外的“计价覆盖”“缓存”“费用明细”）改为卡片标题。
- **没改的**：数据、计算、文案、数据语义（未知不填 0、未定价不算 0）都没动。M8 对“说明小字”的删除结果保持不变。

## 3. 外观上的区别

- 整体：卡片、控件、字号都和概览、设置、小组件一致。
- 走势图：堆叠面积只给最上面一层铺浅色，各层之间不再用渐变区分。
- 详情、日期范围：参考模式下是从左侧滑出的整高侧栏，现在是 kit 的左侧面板。日期范围的快捷选项、日历、“只看未计入”都还在。
- 数字动效：参考模式的数字滚动、环形图入场和图表跟随动画，改用 kit 统一的 0.8s / 0.5s 数据档。

前后对照截图在本机 scratchpad，没有提交。

## 4. 测试

**已跑**（源码模式，合成数据，独立目录）：
- `npm run verify` fail 0；`npm run audit:runtime` 通过。
- 通过：`cost-smoke`、`widgets`、`cost-live-readout`。

**没通过或没跑的，交给 Codex 全量验收**：
- `cost-compact`：详情面板打开时，“页面不能横向溢出”这一项失败。手动打开详情检查时没有溢出，怀疑只在面板打开过程中的某一刻出现，需要查清。
- `cost-layout`：分段控件的选择器已改，没重跑。
- `cost-ui`：选择器已改了一部分，参考模式专属的断言已删。仍有 `group`、`button`、`aria-pressed` 写法要换成 `tablist`、`tab`、`aria-selected`；面板宽度 440、日期范围 `position: fixed` 这类参考模式的几何断言要按 kit 面板重写。
- `cost-composition`、`cost-rebuild`（含 `cost-reference-cases.js`）、`style-alignment`、`ui-m8-gallery`、`renderer-lifecycle`、`render-performance`：都没跑。
- 其余 51 个套件：没跑。

**改测试的规则**：只能按 kit 的真实结构换选择器，或删掉只属于参考模式的断言（例如数字逐位滚动、整高侧栏的几何）。数据语义、键盘可达、焦点回到触发按钮、窄窗不溢出这些断言必须保留。

## 5. 和 M7 的关系

- M7 从 `d079ae5` 开工，那时参考模式还在，但开工指令本来就不许 M7 使用它，所以不受影响。
- 本分支改了 kit 的图表和控件，M7 如果也改了这些文件，后合入的一方需要变基并解决冲突。
