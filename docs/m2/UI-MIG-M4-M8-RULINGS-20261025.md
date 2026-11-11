# M4–M8 统一裁决与组件接口 · 2026-10-25

**状态**：Claude 已审核 Codex 的 M3 收尾项 1 和 M4–M8 五份盘点（合入 main `9bdf973`），本记录给出全部待决问题的裁决和新增组件接口。它是计划第 9.3 节阶段二的开始条件之一。

**效力顺序**：本记录 > M3 示范（`UI-MIG-M3-20261025.md`）> 执行计划。本记录没有覆盖的问题，按计划第 9.4 节处理。

## 0. 审核结论

- **收尾项 1 通过**。五页、深浅两色、共十组对比均无差异。首轮的 mask-image 误报及校准复跑的过程已如实记录，证据完整。
- **五份盘点通过**：功能、数据、耦合、kit 映射和逐断言映射都可以直接作为实现清单；每项待决问题都在本记录里有答复。
- **行号已过期**：盘点的行号固定在 `4f77437`。阶段二开始时 main 是 `9bdf973` 之后的版本，`preview.js`、`index.html` 等共享文件的行号要重新核对。

## 1. 阶段二顺序与授权

| 步骤 | 内容 | 提交前缀 |
|---|---|---|
| MK-a | 第 3 节的控件扩展（M4、M5 要用） | `MK-a:` |
| M4 | 来源管理 | `M4:` |
| M5 | 会话 | `M5:` |
| MK-b | 第 4 节的图表和其余组件（M6–M8 要用） | `MK-b:` |
| M6 | 额度 | `M6:` |
| M7 | 用量 | `M7:` |
| M8 | 费用 | `M8:` |

- **授权范围**：Codex 可以修改 kit、theme 和 tokens，但只限于第 3、4 节逐条列出的接口和 token。
  - 接口名、属性名、取值和行为必须与本记录一致。
  - 如果某个接口不够用，或需要本记录以外的 kit / vendor / theme / token / 设计检查改动，按第 9.4 节停止全部工作并提问。
  - 不新增 `ui/design-guard-allow.json` 条目。
  - 不修改 `ui/src/vendor/`。
- **组件门槛**：MK-a 和 MK-b 的每个新组件或新属性都要满足：
  - 在组件展示页（kit gallery）加示例；
  - kit gallery 测试加对应断言：渲染、键盘、深浅两色、off / reduced 下直接到终态、未知值不画成 0；
  - 通过 `verify` 和 foundation 测试。
- **页面**：照 M3 结构写在 `ui/src/pages/<页面>/`。旧代码提供 `window.<页面>Host`，类型写在 `ui/src/data/<页面>-host.ts`；页面注册 `window.<页面>Ui`。

## 2. 共通裁决

### G1 旧接口的所有者与退役顺序（对应 M4 Q2/Q6、M5 Q5、M6 Q2、M7 Q6、M8 Q7）

规则：数据和动作留在旧代码一侧（Host），页面只负责渲染。被其他页面调用的旧全局对象，由新页面以同名注册兼容层，保证调用方不改。

| 旧模块 | 去向 |
|---|---|
| `insights-ui.js` | 改为唯一的 Host，`window.insightsHost`，不再渲染 DOM。<br>• 状态：`get()`<br>• 事件：`insights-change`<br>• 事项：`attention(kind?)`、`acknowledge(id)`、`restore(id)`、`openAttention(kind)`<br>• 页面数据：`capability(agent)`（返回数据，不返回 HTML）、`notices(page)`<br>• M8 起增加 `budget.save/remove`、`projects.load/export`<br>渲染随页面迁移逐步移走：M4 取走来源事项和解析能力，M5 取走会话提示，M8 取走项目与预算。一份 `general/version/busy` 状态不拆。侧栏计数留到 M9。 |
| `sourceCostInsights.capability` | M4 起改为返回数据，HTML 版本删除。 |
| `preview.js` | 保留 M9 外框、`settingsHost` 和 `usageData`（数据发布）。M7 只取走用量页的渲染和页面状态；`usageData` 的方法、事件和发布时机不变。 |
| `sessions-ui.js` | 摘要服务（`sessionSummary` 缓存、`count`、`sessions-change`、8 条缓存、epoch）移到新的旧侧文件 `sessions-host.js`，提供 `window.sessionsHost`：`list()`、`summary(date, model)`、`count(...)`、`openFolder(key)`、`copyResume(key)`、`copyText(text)`。<br>其余部分退役。React 注册 `window.sessionsUi = { drillDown, loaded, reload }`。 |
| `quota-ui.js`、`provider-quota-ui.js`、`quota-cards.js` | 状态、请求串行、节流、偏好读写和动作合并为 `window.quotaHost`，新文件 `quota-host.js`；渲染和 HTML 函数退役。<br>`window.quotaUi.state`、`window.providerQuotaUi.state/codex` 作为 `quotaHost` 的兼容别名保留到 M8；M8 改为直接读 `quotaHost` 后删除。`quotaUi.openSource` 由 React 注册。 |
| `source-connections-ui.js` | 读取逻辑并入 `sourcesHost.connections()`。`sourceConnectionsUi.reload` 由 React 来源页注册同名兼容层，供 provider 流程调用。30 秒内存定时器归来源页，只在该页可见时运行。 |
| `agent-install-ui.js`、`agent-setup-ui.js`、`config-*-ui.js`、`custom-sources-ui.js`、`sources-ui.js` | M4 起，纯计算按 G4 提取，动作并入 `sourcesHost`，渲染退役。安装状态只保留一份（`sourcesHost.installers()` 加 `installer-change`）。 |
| `sourceDialog`（来源目录演示选择） | 与 M4 一起迁移为来源页的 Sheet；演示模式不打开真实选择器。 |
| `window-shell.js` 直接定位 `#sourceRefresh` / `#quotaRefreshAll` | 改为调用 `sourcesUi.refresh()` / `quotaUi.refreshAll()`；只改这两处。 |
| `ui-carousel.js` | M6 改用 kit Carousel，旧文件继续给 `cost-hero.js` 用；M8 完成后再全局检索确认，删除文件及其 script 引用。 |
| Chart.js（`assets/vendor/chart.umd.min.js`） | M7 改用 kit LineChart；检索确认无其他使用后，删除 vendor 文件和 script 引用（同时检查 `audit:runtime` 与 `build.files`）。 |
| `interactions.js`、`motion.js`、`segmented.js`、`select-ui.js`、`scroll-fade.js`、`focus.js`、`morph.js`、`detail-interactions.js`、`date-range.js` | 每迁移一页，只删除该页自己的入口和选择器；文件本身留到 M9。`date-range.js` 在 M7 后检索，若已无使用者就删除。 |

**注册时机**：所有页面的 island 在启动时挂载（与 M3 相同），并在挂载时注册 `window.<页面>Ui`。较重的读取（完整会话列表、配置检查等）要等页面可见后才开始：读 `currentView()`，或监听视图变化。旧侧调用写成 `window.xUi?.method()`。

### G2 未知、没有记录、未定价（对应 M5 Q4、M6 Q5、M7 Q5 后半、M8 Q6 后半）

所有界面上的 “—” 一律按下表替换。替换属于文案改动，记入该页记录。

| 含义 | 显示 |
|---|---|
| 有记录，但值未报告 / 无法计算（命中率分母不全、字段未报告、费率缺失） | `Value` → “未知”（加 `data-value="unknown"`） |
| 没有价格 | `Value unknown="未定价"`；有用量但未计价的地方，沿用旧文案“未计入” |
| 该 Agent / 该月 / 该时段没有任何记录 | 文字“没有记录” |
| 没有读到额度（`!item.quota`） | `Value` → “未知”，旧说明“还没有读到额度”保留 |
| 服务没有返回额度项 | 文字“没有额度项”，旧说明“这不代表额度为 0”保留 |
| 会话缺 ID 或工作目录 | 文字“未记录” |
| 月费未填写 | 文字“未填写月费” |

### G3 数据语义修正（对应 M4 Q5、M5 Q4、M7 Q5、M8 Q6）

以下几处是旧代码违反“未知不填 0”铁律的地方，迁移时一并修正。修正在提取出来的 UMD 里做，每条配一个单元测试，并在该页记录的“行为差异”中列出。

| 编号 | 位置（`4f77437`） | 修正 |
|---|---|---|
| S1 | `insights.js` 时段面板的费用求和，初值为 0 | 没有任何已知费用时，结果为 `null`，显示“未定价”；部分未知时，显示已知部分的和，并加旧的部分标记 `+`。 |
| S2 | `preview.js` 趋势分项桶，初值为 0 | 某日某字段没有任何记录报告时，该字段为 `null`，图上画成缺口；费用沿用 `hasCost`，没有已知费用就是 `null`。 |
| S3 | `preview.js` 趋势说明里的 `coverage ?? 0` | `coverage` 为 `null` 时写“定价覆盖 未知”。 |
| S4 | `preview.js` 的 `sum` / `aggregate` 总 Token | 所有行的 `totalTokens` 都是 `null` 时，总量为 `null`；只有部分为 `null` 时，取已知部分的和，并标 `partial`（按旧的部分显示规则）。记录数等计数字段不变。 |
| S5 | `sessions-ui.js` 页摘要 `costText(cost, cost, …)` | 上界改为各组 `group.upper` 之和（组上已有这个字段）。 |
| S6 | `sources-ui.js` 的 `observedRecords \|\| 0` | 值是 `null` 或 `undefined` 时不显示这一项；明确的 0 照常显示。 |
| S7 | `sources-ui.js` 来源摘要的记录文件数相加 | 只加已知值；只要有一个已启用来源的文件数是 `null`，就写成“至少 N 个记录文件”。 |
| S8 | `cost-page.js` 首屏 C 的 `lower ?? 0` / `upper ?? 0` | 把 `null` 原样传给 GaugeChart；`null` 时只画底轨，读数显示 `Value`。 |
| S9 | 会话“活跃”判定（结束时间在未来） | 保持旧规则，不改；只在记录中注明。 |

M6 的 `tileOf` 和时间针按 G2 处理。M8 的 `quotaSummary` 保持旧规则：只取首个账号，再加“共 N 个账号”；不扩展适配器，也不补时效。M8 费用 CSV 的导出口径维持“范围 + 分组”，不跟随表格的筛选、搜索和排序；在 M8 记录中写明这一点。

### G4 纯计算提取

- 原样提取为 UMD，按盘点列出的函数逐个提取（M4 §6、M5 §2、M6 §2、M7 §2、M8 §2）。
- 文件名格式：`<页面>-model.js`，例如 `sources-model.js`、`sessions-model.js`、`quota-model.js`、`usage-model.js`、`cost-model.js`。已有的 UMD 原地保留：`cost-table`、`cost-insights`、`usage-math`、`insights-math`、`connection-state`、`display-values`、`pricing-labels`。
- 每个函数先让旧页面改调新模块，证明输出相同，再交给 React 使用。
- 单元测试放在 `tests/m1/<页面>-models.test.js`。

### G5 文案改动

除 G2、G3 之外，只批准以下改动：

| 编号 | 位置 | 旧 | 新 |
|---|---|---|---|
| T1 | 来源 · 解析能力（`insights-ui.js`） | “账户额度另由 Codex 连接提供。” | “账号额度在“额度”页按 Agent 单独连接读取。” |
| T2 | 额度详情 · 读取方式（`quota-cards.js` 非 Codex 分支） | “凭据只保存在本次运行的内存里，重启后需重新提供；” | “选择记住的凭据用 Windows 加密保存在本机，其余只在本次运行的内存里；” |
| T3 | 费用 · 订阅对照（`cost-page.js`） | “已回本” / “还没回本” | “API 估算高于月费” / “API 估算低于月费”（仍按下界判断） |
| T4 | 额度摘要复制的代码注释 | “页上卡片” | “未隐藏的全部卡片，不跟随筛选”（只改注释，行为不变） |

### G6 悬停、标题提示和读数（对应 M6 Q4、M7 Q4、M8 Q3/Q5 的悬停部分）

- **原生 `title`**：原样保留，写在 kit 组件的 `title` 属性或页面元素上。
- **图表内的悬停读数**：读数所在位置（上方、中心、指针旁）和触发方式都不变，由第 4 节的图表组件负责。每个悬停读数都要有键盘焦点上的等价方式。
- **费用上下界的悬停 / 聚焦 / 点击展开**（用量首屏、日明细、费用首屏）：改用 MK-b 的 `Reveal`。
- **余额阶梯**：旧版只有指针读数。新版在 StepChart 内加左右键在菱形之间移动（规范第 8 节要求），记入 M6 的行为差异。

### G7 测试

- **旧实现形态的断言（第 iv 类）可以退役**，并用指定证据替代：

  | 旧断言类型 | 替代证据 |
  |---|---|
  | `.motion-indicator` 的几何 | `aria-selected` 加上指示器与选中项的矩形在 1 px 以内对齐 |
  | 固定毫秒时长 | 终态，加上中途改目标后停在新目标 |
  | canvas 像素 | 图表组件的 `data-*` 状态和 SVG 几何 |
  | 内部类名 / ID | 角色加可访问名称，或页面提供的 `data-*` |

  每条退役都在该页记录的测试映射里注明替代证据。
- **不得退役的断言**：数值、未知、隐私、精确小数、副作用（不登录、不查询、不写入）、键盘、焦点、无错误。
- **图表几何**：新增 `tests/m1/chart-geometry.test.js`，用 `typescript.transpileModule` 加载 `ui/src/kit/charts/geometry.ts`，与旧函数逐值比较。
  - 能直接引用的 UMD（如 `costChart.curve`）直接对比；
  - 写在 IIFE 内部的函数，把从旧页面采到的期望值写进测试，并注明出处行。
- **cost-ui 的不稳定（M8 Q8）**：
  - 等待一律改用 `until`，等页面公开的状态（`data-active`、`data-ready` 等）；
  - 除动效专项外，断言阶段使用 `motion off`；
  - 验收标准：同一 fixture 连续通过 3 次。
  - 新旧对比在同一 fixture、同一主题、同一动效设置、同一窗口下截图。

## 3. MK-a：控件扩展（M4、M5 之前）

| 组件 | 接口 | 行为 |
|---|---|---|
| `TextField`（扩展） | 新增：<br>• `type: "text" \| "password" \| "number"`<br>• `pattern?: string`<br>• `autoComplete?: "off" \| "new-password"`<br>• `spellCheck?: boolean`<br>• `onCommit?: (value: string) => void` | • `password` 不回显已有值，组件不显示“显示密码”按钮。<br>• `onCommit` 在两种情况下触发：值改变后失焦；按 Enter（输入法组字中不触发）。<br>• Escape 恢复到获得焦点时的值。 |
| `TextArea`（新） | `{ label, value, onChange, rows: 3 \| 6, maxLength?, placeholder?, disabled?, error?, mono?: boolean, spellCheck?: boolean }` | 外观与 TextField 一致，`rounded-lg`；`mono` 用等宽字体。Enter 换行，不提交表单；输入法保护与 TextField 相同。 |
| `Combobox`（扩展） | 新增：<br>• `allowCustom?: boolean`<br>• `customLabel?: (text: string) => string`，默认 `使用 “${text}”` | 输入的文字不在列表里时，第一项显示 customLabel，选中后把输入原文作为值。 |
| `Disclosure`（扩展） | 新增 `actions?: ReactNode` | 放在触发区右侧，与触发按钮是兄弟元素，不嵌套在里面；点击不会展开或收起。 |
| `AgentFilter`（新） | `{ agents: { id: string; name: string; recorded: boolean }[]; value: string; onChange; display: "icon" \| "chip"; allLabel?: string; "aria-label": string }`，`value` 为 `"all"` 时表示全部 | • radiogroup，roving 焦点，支持方向键 / Home / End，选中指示器用 `spring.moderate`；可以换行。<br>• `icon`：只显示 AgentMark，带 `title` 和可访问名称；“全部”保留文字。<br>• `chip`：AgentMark 加名称。<br>• `recorded: false` 时显示为 `text-muted-foreground`，但仍然可选。<br>• 选中项变化不改变布局几何。<br>• 顺序由页面决定。 |
| `CopyButton`（新） | `{ label: string; onCopy: () => Promise<boolean>; size?: "default" \| "compact" }` | IconButton。成功后图标换成 Tabler check，保持 1600 ms 后恢复；失败时不显示 check，提示由页面发出。忙时禁用。 |
| `StackBar`（新） | 见第 4.2 节 | M4 的安装进度、M5 的会话消耗条要用，所以放进 MK-a。 |
| `StatusDot`（新） | `{ tone: "active"; label: string }` | 8 px 圆点，`bg-success`，静止，**不加脉冲**（规范禁止无限动画），带 `title` 和可访问名称。 |

## 4. MK-b：图表和其余组件（M6 之前）

### 4.1 图表共同约定

- **位置和导出**：放在 `ui/src/kit/charts/`，从 `@ui/kit` 导出。几何计算放在 `ui/src/kit/charts/geometry.ts`，照旧函数移植，并按 G7 做对比测试：
  - 单调曲线：`cost-chart.js` 的 `curve`；
  - `niceStep` 和刻度：`cost-stack.js`、`cost-bars.js`；
  - 圆弧：`cost-donut.js` 的 `arcPath`；
  - 柱子路径：`cost-bars.js` 的 `barPath`；
  - 圆环半径：`quota-hero.js`；
  - 提示定位：`chart-ui.js` 的 `positionTooltip`。
- **数据**：页面传入的是 UMD 已算好的业务数值和完整文案，组件不格式化金额或 Token。可能未知的值类型都是 `number | null`；`null` 一律画成缺口、空底轨或不画，**不得当作 0**。
- **颜色**：属性 `tone: ChartTone`，取值是以下字符串字面量：
  - `agent:<id>` → `--agent-*`，只用于额度页；
  - `series:<id>` 或 `series:other` → `--series-*`，只用于费用页；
  - `category:input|output|cacheRead|cacheWrite|reasoning`；
  - `heat:0`–`heat:4`；
  - `neutral`、`muted`、`accent`、`warn`。

  kit 内用静态查表映射到 `fill-*` / `stroke-*` / `bg-*` 类名。`warn` 只用于真正耗尽的窗口，或旧版本来就是警示的地方。颜色不表示好坏。
- **token 和 theme 改动**（本记录授权的全部改动，只有这些）：
  - `tokens.css` 新增 `--category-input`、`--category-output`、`--category-cache-read`、`--category-cache-write`、`--category-reasoning`。浅色取 `preview.js` 中 categories 的五个值；深色取 `categoryColor` 的深色分支。旧代码改为读这些 token。
  - `ui/src/theme/index.css` 新增：
    - `--color-category-*` → 上述 token；
    - `--color-heat-0`…`--color-heat-4` → 旧的 `--heat0`…`--heat4`。四套配色仍由旧侧在根元素上写入，入口移到 `usageHost.setHeatPalette`。
  - `ui/src/theme/fluid-helpers.css` 新增三个辅助类：
    - `ff-grid-quota`：`grid-template-columns: repeat(auto-fill, minmax(var(--quota-card-min), 1fr))`；
    - `ff-quota-who`、`ff-quota-val`：宽度分别取 `--quota-hero-who`、`--quota-hero-val`。
- **动效**：
  - 首次进入视口（IntersectionObserver，阈值 0.25）时用 `data.enter`，兄弟元素用 `staggerDelay(i)`；
  - 数据变化时用 `data.update`，从当前已画出的值过渡到新值（同一路径结构，用 Motion 插值）；
  - `dataKey` 改变（范围、Agent、指标切换）时重新入场；
  - 普通数据刷新不重播入场；
  - reduced 只淡入，几何直接到终态；off 一切直接到终态；
  - 卸载时取消所有 observer、RAF 和进行中的动画。
- **交互**：
  - `active` / `onActiveChange(key | null)` 受控，读数文字由页面渲染进组件的 `readout` 槽或 `center` 槽；
  - `onSelect(key)` 对应点击和 Enter；
  - 每个图表是一个带 `aria-label` 摘要的可聚焦组，内部用 roving 焦点；Escape 清除 active。
  - 指针离开后恢复到静止读数。
- **尺寸**：只能用下面各组件列出的档位，档位对应旧几何。页面不传像素值。组件内部的几何（路径、半径、按容器宽度算出的尺寸）写在 SVG 属性或组件内的 `style` 里，与 M3 的 Meter 相同；不用 Tailwind 任意值。

### 4.2 StackBar（横向构成条，MK-a 交付）

```ts
StackBar({
  segments: { key: string; value: number; tone: ChartTone; pattern?: "solid" | "hatched" | "light"; label: string }[],  // value 是 0–1 的长度占比
  height: 4 | 6 | 8 | 12 | 18,
  width?: "full" | "inline",          // inline = 44px（会话消耗条）
  steps?: 16 | 30,                    // 额度卡的分段条
  markers?: { key: string; at: number; kind: "time" | "fee" | "today"; label: string }[],
  unknown?: boolean,                  // 只画底轨，aria-valuetext “未知”
  active?: string | null; onActiveChange?: (key: string | null) => void;
  "aria-label": string,
})
```

用途：
- 额度卡的主条、子行和余额条（`steps` 加 `time` 标记）；
- 钱包的组成条，以及 7 天 / 30 天 / 更久 / 不限期四段到期分段（height 6）；
- 用量的 Token 分类堆叠（`category:*`）；
- 费用首屏 A 的构成条（`series:*`；未计价段用 `hatched`，只作命名）；
- 订阅对照（下界 `solid`、上界 `hatched`、月费 `fee` 标记）；
- 缓存命中条、明细行内的构成微条；
- 会话消耗条（`inline` + `accent`，即旧版的强调色）；
- 安装进度（单段 `muted`，进度未知时 `unknown`）。

不用它的地方：M3 的 `Meter` 不改，继续只用于定价覆盖。

### 4.3 RingChart

```ts
RingChart({
  variant: "concentric" | "donut" | "gauge",
  size: "dial" | "card" | "donut" | "donutCompact" | "gauge" | "mini" | "coverage",
  // concentric：1–3 圈，外圈在前
  rings?: { key: string; value: number | null; tone: ChartTone; state: "normal" | "stale" | "unknown" | "out"; tick?: number | null; label: string }[],
  // donut：只放已计价的正数；隐藏项由页面过滤后传入，其余项重新排布
  segments?: { key: string; value: number; tone: ChartTone; label: string }[],
  shape?: "full" | "half",
  // gauge
  gauge?: { lower: number | null; upper: number | null; projection: number | null; max: number },
  center?: ReactNode,
  active?: string | null; onActiveChange?; onSelect?;
  dataKey?: string; "aria-label": string,
})
```

**尺寸档位**（均来自旧几何）：

| 档位 | 用途 | 旧几何 |
|---|---|---|
| `dial` | 额度首屏 | viewBox 140；1 / 2 / 3 圈半径 [56] / [58,42] / [60,47,34]；线宽 11（3 圈时 9）；显示 112–136 px，随容器宽 |
| `card` | OpenCode 卡片圆环 | SVG 72，r30，显示 64 px |
| `donut` | 费用“花在哪” | D240，T16，激活 20，间隙 3.5，显示 208 px |
| `donutCompact` | 窄面板 | 显示 168 px |
| `gauge` | 费用首屏 C | 240×132，r96，cx120，cy116，线宽 16 |
| `mini` | 费用首屏缓存 | 36 px，r13 |
| `coverage` | 计价覆盖 | 112 px，r46 |

**状态**：
- `stale`：虚线；
- `unknown`：只画底圈；
- `out`：警示色底圈；
- `tick`：时间刻线，用背景色（`stroke-background`，即旧版的白色刻线）；
- concentric 内圈的不透明度沿用旧值 .66。

**donut**：
- 激活段加粗到 20，同时中心显示读数；不压暗其他段；
- 隐藏时外框逐帧按弧的最低点计算高度，避免下弧被裁掉；
- 半环用 `shape: "half"`。

**gauge**：下界画实色，`lower`–`upper` 画浅色，`projection` 画虚线；任一值为 `null` 时不画该段。

### 4.4 BarChart（纵向柱）

```ts
BarChart({
  variant: "columns" | "months",
  height: "strip" | "hours" | "days" | "pair" | "months",
  // columns
  bars?: { key: string; value: number | null; state: "value" | "zero" | "unobserved" | "unpriced" | "future"; tone: ChartTone; mark?: "peak" | "today"; label: string }[],
  // months
  groups?: { key: string; label: string; series: { key: string; lower: number | null; upper: number | null; tone: ChartTone }[]; projection?: { lower: number; upper: number } | null }[],
  layout?: "grouped" | "stacked", hidden?: string[],
  ticks?: { value: number; label: string }[],   // 刻度文字由页面用 UMD 算好
  readout?: ReactNode,                          // 显示在图上方
  active?; onActiveChange?; onSelect?; dataKey?; "aria-label": string,
})
```

**高度档位**：

| 档位 | 用途 | 旧几何 |
|---|---|---|
| `strip` | 用量近 30 天条带 | 132 + 封面余量；≤760 px 时 96 |
| `hours` | 选中日的 24 小时柱 | 156，最小可见 8，未来小时画轮廓 |
| `days` | 费用首屏 C 的每日柱 | 已计价 8–64，未计价 20，没有记录 4，未来画框 |
| `pair` | 费用首屏“每百万与前期”双柱 | 44×36 |
| `months` | 费用按月 | 最小 240×160，默认最小高 150 |

**状态**：
- `unobserved`：虚线短桩；
- `zero`：已观测的 0，画贴底细线；
- `unpriced`：有用量但未计价，按旧样式画；
- `future`：未来，不可交互。

**months**：
- 顶部圆角不超过 6；
- stacked 时柱宽 4–52，柱间隔 1.5；grouped 时柱宽 3–30，间隙 3；
- 上下界区间画斜纹，推算部分画虚框，只在 stacked 且没有隐藏全部系列时显示；
- 切换 layout 或隐藏系列时，从当前路径过渡。

### 4.5 LineChart

```ts
LineChart({
  variant: "trend" | "stack" | "detail" | "spark",
  x: { key: string; label: string; partial?: boolean; missing?: boolean }[],
  series: { key: string; label: string; tone: ChartTone; values: (number | null)[]; style?: "line" | "area" | "dashed"; axis?: "left" | "right" }[],
  stacked?: boolean,
  ticks?: { left: { value: number; label: string }[]; right?: { value: number; label: string }[]; x?: { index: number; label: string }[] },
  active?: number | null; onActiveChange?: (index: number | null) => void,
  pinned?: number | null; onPinnedChange?: (index: number | null) => void,     // 仅 stack
  range?: [number, number] | null; onRangeChange?; onApplyRange?: (range: [number, number]) => void,
  onSelect?: (index: number) => void,
  tooltip?: (index: number) => ReactNode,    // 仅 trend：跟随指针，并在图的边界内避让
  readout?: ReactNode,                       // 仅 stack：显示在图上方，图内只放顶部小胶囊
  size?: "row" | "hero",                     // 仅 spark
  dataKey?: string; "aria-label": string,
})
```

**曲线和缺口**：
- 曲线一律用单调 Hermite 插值，不越过相邻值；
- `x.missing`（缺日期）用虚线桥接，但不画点；
- `values[i] === null`（有记录，但值未知）是硬缺口；
- `x.partial` 在轴下画部分刻线；
- 累计和移动平均由页面用 UMD 算好后传入。

**各变体对应的旧图**：

| 变体 | 对应旧图 | 尺寸 / 样式 |
|---|---|---|
| `trend` | 用量趋势（替代 Chart.js） | 线宽 2.4；费用线 2 加虚线 5,5，走右轴，右轴宽固定 56；单点时画半径 4 的点，悬停点半径 5；十字线虚线 3,4 |
| `stack` | 费用走势 | 高 272，top 34，bottom 240，日期行 y 262；最多 6 个日期；宽 <560 时左右边距 46/14，否则 52/20 |
| `detail` | 费用详情的每日 Token | 框高 176，top 26，bottom 146；最多 90 点；悬停时隐藏终点标签 |
| `spark` | 明细行和首屏小趋势 | `row` 108×32，30 点；`hero` 96×36，14 天缺日断开；单点也可见 |

**键盘**：
- Left / Right / Home / End 移动 `active`；
- Enter：有 `range` 时应用范围，否则 `onSelect`；
- Space：固定当前点（stack）；
- Shift + 方向键：扩展范围；
- Escape：清除。

**指针**：拖动超过 5 px 视为选范围，并抑制随后的点击；`pointercancel` 时收尾。

**图例**：用独立组件 `ChartLegend({ items: { key, label, tone, hidden, note? }[], onToggle, minVisible: 0 | 1 })`。
- 用量趋势：`minVisible: 0`，可以全部隐藏；
- 费用：`minVisible: 1`；
- 图例行的悬停 / 聚焦与图中的 `active` 联动。

**宽度**：按容器实际宽度用 ResizeObserver 重画；只改布局，不重播入场。

### 4.6 Heatmap

```ts
Heatmap({
  variant: "calendar" | "weekHour",
  rows: number, cols: number,
  cells: { key: string; row: number; col: number; level: 0 | 1 | 2 | 3 | 4 | null; disabled?: boolean; highlighted?: boolean; label: string }[],
  colLabels?: { col: number; label: string }[], rowLabels?: { row: number; label: string }[],
  selected?: string | null; onSelect?: (key: string) => void;
  active?; onActiveChange?; dataKey?; "aria-label": string,
})
```

- **`level`**：`null` 表示未观测（淡底）；`0` 表示已观测且为 0；`disabled` 用于首尾补位和未来的日子，不可交互。
- **calendar**：7 行，周一开始，最小宽 620，间隙 3。格子是 SVG `rect`，`rx` 4，与旧版的 4 px 圆角相同（图表内部几何，见 4.1“尺寸”）。
- **weekHour**：每格 24×最大 20，间隙 3，左侧是 22 px 宽的周标签。
- **提示**：kit 内部共用一个提示层，按窗口避让；`aria-describedby` 指向它；指针离开、失焦或 Escape 时关闭。
- **键盘**：
  - calendar：左右键按日移动，上下键按周移动；
  - weekHour：四个方向循环移动；
  - Enter / Space 选中。
- **入场**：按列错开，`staggerDelay(col)`。总时长上限 0.24 s，短于旧版的约 0.37 s，是规范要求，记入 M7 的行为差异。

### 4.7 Timeline（额度“接下来”）

```ts
Timeline({
  start: number, end: number, step: number,       // step = 每次按方向键移动的毫秒数：1h / 6h / 1d
  axis: { at: number; label: string }[],
  lanes: { key: string; leading: ReactNode; markers: { key: string; at: number | null; kind: "reset" | "expiry"; tone: ChartTone; state: "normal" | "stale" }[]; value: ReactNode }[],
  needle: number | null; onNeedleChange: (at: number | null) => void,   // null = 现在
  preview: number | null; onPreviewChange: (at: number | null) => void, // 悬停时的 ghost
  "aria-label": string,
})
```

- 尺寸照旧：lane 高 44，轨道 8；名称列、数值列用 `ff-quota-who`、`ff-quota-val`（见 4.1）。
- 轨道是 `role="slider"`，`aria-valuetext` 给出时刻和其中重置的数量。
- 交互：指针拖动或点击固定；点击标记吸附到该时刻；Home / End 到两端。
- 行内的值随针变化，由页面用 UMD 计算后传入 `value`。
- `at: null`（时间未报告）只在左侧图标列显示，不画在轴上。
- 轨道带 `data-carousel-ignore`，在上面拖动不会翻页。

### 4.8 StepChart（余额阶梯）

```ts
StepChart({
  steps: { key: string; at: number; amount: number; packs: number; label: string }[],  // amount 只用于几何；label 是精确金额文字
  unlimited?: { amount: number; label: string } | null,
  start: number, end: number, tone: ChartTone,
  active?; onActiveChange?; "aria-label": string,
})
```

- 几何照旧：高 150；宽取 max(240, 实际宽)；左右边距 46 / 10；绘图区 y 10–124；三条水平刻度，四段时间刻度；菱形 12×12，`rx` 2.5。
- 横向距离小于跨度 1/20 的到期点合并为一个菱形。
- 不限期部分画虚线。
- 窗口高度变化不逐帧重建几何。
- 键盘：左右键在菱形之间移动（G6）。

### 4.9 其余组件

| 组件 | 接口 | 行为 |
|---|---|---|
| `Carousel` | `{ slides: { key: string; label: string; node: ReactNode }[]; index: number; onIndexChange; "aria-label": string }` | • 箭头按钮加带文字的圆点（内部用 CarouselDots）。<br>• 方向键翻页；拖动、触摸、横向滚轮翻页，到边界有阻力；以 `data-carousel-ignore` 内开始的拖动不翻页。<br>• 非当前页 `inert` 加 `aria-hidden`。<br>• 外框高度跟随当前页，用 `spring.slow`；翻页用 `spring.slow`。<br>• 第一次入场只播一次；resize 时保持当前页。 |
| `Sortable` | `{ items: { key: string; node: ReactNode; label: string }[]; onReorder: (keys: string[]) => void; "aria-label": string }` | • 长按 350 ms 且移动不超过 6 px 时拿起；之后按实际布局位置放置，位移用 `spring.moderate`。<br>• 松开时提交；Escape 或 `pointercancel` 复原，并抑制随后的点击。<br>• Alt + 四个方向键移动一位，焦点留在原项。<br>• 隐藏或被筛掉的项由页面保留原位置后传入。 |
| `Reveal` | `{ trigger: ReactNode; content: ReactNode; "aria-label": string }` | 悬停、聚焦或点击时显示弹层（`rounded-xl`，`spring.fast`）；Escape 或失焦关闭。只用于 G6 列出的费用上下界。 |
| `Ticket` | `{ tone: ChartTone; title: ReactNode; figure: ReactNode; caption?: ReactNode; muted?: boolean }` | 额度钱包票据：照旧版的弯口 SVG 轮廓，背景 `bg-surface-2`，**不是 Card**，可以放在 Card 内。一张卡最多 2 张，由页面控制。`muted` 用于不可用项，文字仍用规范 token，保证对比度。 |
| `PaneGroup` | `{ panes: { key: string; title: string; node: ReactNode }[]; collapsed: string \| null; onCollapsedChange }` | 费用“花在哪 / 按月”两栏：两栏等高；收起的一栏变成窄标题条，内容 `inert`；宽度变化用 `spring.slow`；窄屏时上下排列。 |
| `RangeCalendar` | `{ value: { from: string; to: string } \| null; min: string; max: string; onChange; commit: "second-click" \| "draft"; marks?: string[]; "aria-label": string }` | • 42 格，周一开始，`min` / `max` 以外的日子禁用。<br>• 第一次点击选单日，第二次点击成区间；悬停和聚焦时预览。<br>• 方向键按日移动，跨月时自动翻月；PageUp / PageDown 翻月。<br>• `marks` 是有记录的日子，画小点。 |
| `DateRangePopover` | `{ value; presets: { key: string; label: string }[]; preset: string; onApply; onReset; maxDays: number; min; max; "aria-label": string }` | • 锚定在触发按钮上的弹层，上下自动择位；内含 RangeCalendar（`commit: "draft"`）。<br>• 校验：必填、先后顺序、不超过 `maxDays`。<br>• 有“重置 / 应用 / 跟随页面”三个按钮。<br>• 打开时焦点进入弹层，关闭时回到触发按钮；输入法保护。 |
| `Sheet`（扩展） | 新增：<br>• `placement?: "center" \| "left" \| "right"`<br>• `dismissDrag?: boolean` | • 侧边 Sheet 占满高度，宽度按 `size`（sm 400 / lg 540）。<br>• `dismissDrag`：朝边缘拖动超过宽度 1/3，或速度超过 500 px/s 时关闭；中途 `pointercancel` 复原。 |
| `EdgeTrigger` | `{ side: "left" \| "right"; label: string; onOpen: () => void }` | 窗口边缘 24 px 的热区。指针进入或获得焦点时显示按钮，`spring.fast`。这是旧版已有的悬停显露，由 kit 负责。 |
| `ListRow`（扩展） | 新增 `level?: 0 \| 1` | `level: 1` 时在左侧画中性树枝线，替代旧版 34×18 的 SVG。 |

## 5. 逐页裁决

### M4 来源管理

| 问题 | 裁决 |
|---|---|
| Q1 kit 缺口 | JSON 过滤用 `TextArea`（`rows: 6`，`mono`）；字段建议用 `Combobox allowCustom`；配置字段用 `TextField autoComplete="off"`，敏感字段加 `type="password"`。 |
| Q2 跨页边界 | 照 G1：`insightsHost` 是唯一的事项状态；`window-shell.js` 只改刷新调用那一处。 |
| Q3 视觉与布局 | • **来源行**：一行一个 `ListRow`。左侧 AgentMark；标题是名称；meta 是读取状态和程序状态；右侧依次是 Switch 和“管理”按钮。<br>• **行下方**：一个 `Disclosure`，触发区写“读取位置 · 解析能力”，展开后分两个小节——读取位置（每个路径一行 ListRow，复制用 `CopyButton`，完整路径放 `title`）和解析能力（`SettingRow` 风格的键值行）。<br>• **Sheet 尺寸**：管理 `lg`，安装与更新 `xl`，配置管理 `xl`，添加我的 Agent `lg`。后三个的动作按钮放 `footer`，始终可见。<br>• **需要处理**：`SubTabs` 筛选加 ListRow 列表，live 采集失败置顶；“显示已知悉”用 Switch。<br>• **静态健康状态**：用 `Badge`，有问题时 `warn`，其他 `neutral`。<br>• **配置检查结果**：每个文件一个 Disclosure，里面每个定位一行 ListRow。<br>• **五步向导**：标题写“第 n / 5 步 · 步骤名”，`footer` 放上一步 / 下一步 / 保存；不加步骤条。 |
| Q4 安装进度 | StackBar 单段 `muted`；进度未知时 `unknown`；阶段和百分比文字用 `Value`。不用 success 色。 |
| Q5 语义 / 文案 | 照 G3 的 S6、S7 和 G5 的 T1。 |
| Q6 退役范围 | 照 G1；`sourceDialog` 一起迁移。 |

### M5 会话

| 问题 | 裁决 |
|---|---|
| Q1 视觉映射 | • **项目**：一个 `Disclosure`。触发区放项目名、会话数（活跃数用 StatusDot 加数字）、Agent 标记、Token、费用，完整路径放 `title`；复制路径和打开目录放 `actions`。<br>• **会话**：项目内用 `DataTable`，列依次为 Agent、时间、时长、模型、ID、Token（含 inline StackBar）、费用、操作。<br>• **窄屏**：在旧版隐藏列的同一断点，隐藏模型和 ID 两列。<br>• **前 5 个会话以外**：第二层 Disclosure，触发区写“展开其余 N 个会话”。<br>• **Agent 筛选**：`AgentFilter display="icon"`。<br>• **详情**：Sheet `lg`；统计数字用 Figure `sm`，两列排布，`lg` 宽度下保持两列；复制和打开目录放 `footer`。 |
| Q2 kit / 图形 | 头部独立动作放 `Disclosure actions`；消耗条用 StackBar（`inline`、`accent`），带 `title`；复制反馈用 `CopyButton`。 |
| Q3 活跃视觉 | StatusDot，不加脉冲；时长图标用 Tabler `IconClock`（14 px），放在 Badge 里。 |
| Q4 语义冲突 | 照 G2 和 G3 的 S5、S9。允许保留旧版已有的同组和整页合计，不新增合计。 |
| Q5 共享接口 | 照 G1 的 `sessions-host.js`。首屏摘要不依赖 React 页面，也不触发完整列表读取。 |
| Q6 断言替代 | 批准：`:112` 的旧 motion-indicator 断言按 G7 的指示器对齐证据替代。 |

### M6 额度

| 问题 | 裁决 |
|---|---|
| Q1 kit 控制能力 | 密码字段、`pattern`、`autocomplete`、`spellcheck` 用 MK-a 的 TextField 扩展；拖动排序用 `Sortable`；首屏用 `Carousel`。 |
| Q2 图表和共享边界 | • 首屏圆环：RingChart `concentric dial`；卡片圆环：RingChart `card`。<br>• 卡片条和钱包分段：StackBar。<br>• 接下来：Timeline。<br>• 余额：StepChart；钱包票据：Ticket。<br>• 左侧大数字：Figure `xl`。<br>• Host 照 G1；`ui-carousel.js` 保留到 M8。 |
| Q3 视觉映射 | • **卡片**：Card，方形，最小宽 260。网格用 `ff-grid-quota`（见 4.1）。<br>• **主读数**：Figure `md`；首屏 Figure `xl`。<br>• **失败提示**：卡内用 `Banner warn`（Banner 不是卡片）。<br>• **合并的同账号卡**：一张卡，标题处写账号数，详情 Sheet 列出每个连接。<br>• **Sheet 尺寸**：详情 `lg`，Codex 登录 `sm`，其他连接 `lg`；动作按钮放 `footer`。<br>• **颜色**：生命周期状态用 Badge `neutral`；真正耗尽或登录失败用 `warn`；过期或不可用项用 `text-muted-foreground`，不用透明度。<br>• **字重**：旧版 700 字重改为 `font-semibold`。 |
| Q4 悬停与无障碍 | 照 G6：圆环、时间针、票据的读数保留，并有键盘等价方式；StepChart 加方向键。翻页和图内拖动的冲突用 `data-carousel-ignore` 处理；长按排序只在卡片网格内生效，与翻页互不影响。 |
| Q5 旧数据 / 文案 | 照 G2；摘要复制的行为不变，只改注释（T4）；详情文案改为 T2。 |
| Q6 旧测试形态 | 照 G7。方形、命中区域、稳定节点、性能（相同通知不重建、阶梯几何不随高度逐帧重绘）的目的都保留，换成新组件的 `data-*` 证据。 |

### M7 用量

| 问题 | 裁决 |
|---|---|
| Q1 图表 | • 近 30 天条带：BarChart `strip`；选中日的小时柱：BarChart `hours`。<br>• 活跃日历和周×小时：Heatmap。<br>• 趋势：LineChart `trend`，配 ChartLegend `minVisible: 0`；Chart.js 退役。<br>• Token 分类：StackBar `category:*`；今日树：ListRow `level`。<br>• 日明细仍在页内展开，不改成 Sheet。 |
| Q2 日期范围 | 趋势范围用 `DateRangePopover`（`maxDays: 3660`），其中 presets 为“今天 / 7 天 / 30 天 / 跟随页面”。 |
| Q3 Agent 筛选 | `AgentFilter display="chip"`。顺序为全部在前，其余按已记录 Token 排序；没有记录的 Agent 设 `recorded: false`。当前筛选通过 `usageUi.filters()` 和事件 `usage-filter-change` 公开，供 M3 导出、M8 和侧栏使用。 |
| Q4 上下界 | 照 G6 用 `Reveal`：触发是 Figure 或 Value 显示的下界，弹层显示完整上下界和覆盖率，`aria-label` 是完整值；首屏、今日、日明细用同一个组件，只是 Figure 档位不同（首屏 `xl`，今日 `md`，日明细 `sm`）。旧的“缩字适配宽度”断言退役，换成“不裁切”的几何检查。 |
| Q5 聚合疑点 | 照 G3 的 S1–S4。 |
| Q6 共享接口 | 照 G1；`preview.js` 分层剥离，不整文件删除。 |

### M8 费用

| 问题 | 裁决 |
|---|---|
| Q1 图表 | • 首屏 A 构成条：StackBar `series:*`；A 的三个小图：LineChart `spark hero`、BarChart `pair`、RingChart `mini`。<br>• 首屏 C：RingChart `gauge` 加 BarChart `days`。<br>• 走势：LineChart `stack`，配 ChartLegend `minVisible: 1`。<br>• 花在哪：RingChart `donut` / `donutCompact`，`shape` 为全环或半环。<br>• 按月：BarChart `months`。<br>• 明细：行内用 StackBar 和 LineChart `spark row`；详情用 LineChart `detail`。<br>• 覆盖：RingChart `coverage`；缓存和订阅用 StackBar。<br>• 首屏翻页：Carousel。 |
| Q2 范围侧栏 | Sheet `placement`，方向与旧版侧栏相同，`size="sm"`。内容依次为：范围 `Segmented`、月份选择、`RangeCalendar commit="second-click"`（带 `marks`）。入口是工具条按钮加 `EdgeTrigger`。<br>键盘跨月翻页，比旧版“只在当月内移动”更宽，记入行为差异。<br>费用的范围状态仍独立于用量页。 |
| Q3 表格与布局 | • **明细**：DataTable，第一格的按钮打开详情；行内微图自己可以聚焦，不嵌在行按钮里。<br>• **“其它”合计行**：第一格按钮改为展开 / 收起成员，不打开详情。<br>• **两栏**：PaneGroup。 |
| Q4 月费输入 | TextField `inputMode="decimal"`、`maxLength={9}`，用 `onCommit` 保存。规则不变：空值移除，非法值或保存失败恢复原值，输入法组字时不提交。预算仍然通过 Form 提交。 |
| Q5 详情 | Sheet `placement="left"`、`size="lg"`（540，规范档位，取代旧的 440）、`dismissDrag`；动作放 `footer`。六个指标排成 3×2 网格，每格是 `bg-surface-2 rounded-xl` 子块，含 caption 和 Figure `sm`。旧的 22 px 圆角和 420 ms 时长退役（G7）。 |
| Q6 疑点 | S8；`quotaSummary` 和 CSV 口径照 G3 末段；“回本”改为 T3；“—”照 G2。 |
| Q7 共享状态 | 照 G1：预算和项目的写入都经 `insightsHost`；`ui-carousel` 在 M8 删除。如果到 M8 时 M6 的首屏仍有某项按 9.4 保留旧实现，`ui-carousel` 也一起保留，并在交付记录中写明。 |
| Q8 cost-ui 不稳定 | 照 G7。 |

## 6. 不变的要求

- 计划第 0.3 节的铁律、第 2.5 节的门槛、第 2.6 节的截图，以及规范全文，全部照旧。
- 合成数据，独立的 usage / quota 目录；不读真实来源、凭据或账号；不登录，不查询。
- 打包验收留到 M9，由 Claude 做。
- 全部完成后，写 `docs/m2/UI-MIG-M4-M8-DELIVERY-<日期>.md`，然后停止。
