# 额度页（过渡版本）与圆角外框 · 2026-10-27

**状态**：**过渡版本**。所有者 2026-10-27 对额度页现状仍不满意，决定先保留接口和外排版，等新设计定下后再重做；在此之前不做设计改动（`UI-UNIFY-COST-REFERENCE-20261027.md` 第 6 节）。本记录写明现状、批准过的差异、套件和门槛结果，供重做时对照。额度页不是其他页面的版式参照（参照改为费用页）。

分支 `ui/quota-shell`，Claude 实现，合成数据、源码模式验证。打包和真实账号未验证。

## 1. 所有者决定（2026-10-26/27）

| 项 | 决定 |
|---|---|
| 分工 | Claude 从额度页开始重做渲染层（M6）；M7（用量）、M8（费用）仍由 Codex 做，先 M8 后 M7（`UI-MIG-M7-M8-KICKOFF-20261027.md`）。 |
| 外框 | 侧栏和标题栏在窗口底色上，每个页面放在一块圆角面板上（参考 Codetwo）。双层侧栏暂不做。几何见 `UI-LAYOUT-SPEC-20261027.md` 第 1 节。 |
| 摘要栏 | Codex 式弹出卡，从标题栏按钮（`#windowSummary`）打开：窗口宽 ≥ 1120 时固定在右上，页面让出位置；更窄时浮在页面上方，按 Esc、点击卡外或切换页面关闭。没有固定时，同样的内容显示在卡片下方。2026-10-27 起全站都有（设置页除外），其他页随各自迁移加入。 |
| 账号卡片 | “agent 卡片不要改，还用原来的”：卡片、筛选条和卡片移动用旧渲染 `design/desktop-reference/quota-card-grid.js`，位于 React 岛 `quota` 和 `quota-after` 之间。 |

## 2. 现状

| 部分 | 实现 |
|---|---|
| 页头、概览、接下来、所有 Sheet | React 岛 `quota`（`ui/src/pages/quota/index.tsx`、`overview.tsx`、`details.tsx`、`connections.tsx`）。 |
| 账号卡片 | 旧渲染 `quota-card-grid.js`（从 `quota-cards.js` 原样移出，只改了状态来源和打开 Sheet 的方式）加 `quota-progress.js`。 |
| 卡片下方 | React 岛 `quota-after`：摘要栏没有固定时显示需要处理、未连接的 Agent 和说明。 |
| 摘要栏 | React 岛 `quota-summary`：下一次恢复、需要处理、未连接的 Agent、说明。 |
| 状态和操作 | `quota-host.js`（`window.quotaHost`）和 `quota-model.js`：Codex M6 从旧逻辑提取，经 Claude 审核；测试 `tests/m1/quota-models.test.js`。 |
| 兼容接口 | React 注册 `window.quotaUi`（`state/refreshAll/add/openSource/connect/openDetails/locate`）和 `window.providerQuotaUi`（`state/codex`），费用页和来源页照旧使用。 |
| 退役 | `quota-cards.js`、`quota-hero.js`、`quota-ui.js`、`provider-quota-ui.js` 和旧的 Codex 登录对话框。 |

## 3. 批准过的差异（与 main 上的旧额度页相比）

- **首屏**：三页翻动的首屏（现在 / 接下来 / 余额，`UI-QUOTA-HERO-20261024.md`）连同圆环和阶梯图，换成两张概览卡（最紧的窗口、余额）加“接下来”时间线。翻页偏好（slide）不再保存。
- **Sheet**：详情、Codex 连接、其他服务连接改用 kit `Sheet`；连接表单的字段、方式、同意项和文案与旧版一致。
- **外框**：所有页面都套上圆角面板，标题栏多一个摘要按钮（只在已登记摘要的页面显示）。

## 4. 新增或调整的测试钩子

- 连接表单：`[data-provider-adapter]` / `[data-provider-method]`（`data-selection` 为当前值）、`[data-provider-field="credential|project|alias|user-agent|organization|workspace"]`、`[data-provider-remember]`、`[data-provider-consent]`、`[data-provider-connect-error]`。
- 详情 Sheet：`[data-quota-account]`、`[data-quota-sheet-refresh]`、`[data-quota-remove]`、`[data-quota-card-settings]`、`[data-quota-sheet-total]`（本次新增，替代旧 `.quota-sheet-total`）。
- 页面：`[data-quota-idle]` / `[data-quota-idle-agent]`、`[data-quota-attention]`、`[data-quota-refresh-all]`、`[data-quota-summary]`、`[data-quota-cadence]`、`[data-quota-copy]`、`[data-quota-overview]`、`[data-hero-tile]`。
- 套件统一经 `scripts/m1/quota-ui-helpers.js` 定位（`connection.*`、`detailAction`、`choose`）。

## 5. 套件改写（断言映射）

断言意图不变，只换定位方式，以下各项例外：

| 套件 | 调整 |
|---|---|
| `provider-quota` | 连接表单关闭后不再读输入框（表单已卸载），改为下一次打开时凭据为空；读取挂起时先关闭表单，再在详情里点“取消”；未勾同意提交时检查有提示文字。 |
| `provider-login` | 同上；放弃输入后重开表单检查凭据为空。 |
| `provider-client` | 自动刷新的说明文字不被截断：检查新页头 `[data-quota-cadence]` 的说明和下拉框各自放得下、不重叠、说明只占一行（替代旧 `.quota-auto` 的原生 select 检查）。 |
| `quota-identity` | 复制摘要改为点页头“复制额度摘要”，在主进程里截获剪贴板文本（不写系统剪贴板）。 |
| `visual` | 同一行卡片等宽的容差改为一个布局单位（1/64 px）：圆角面板里列宽是小数。打开 Sheet 后卡片尺寸容差 0.5 px（Radix 滚动锁在 1.5× 下的亚像素位移）。 |
| `render-performance` | 首屏翻页的重绘计数随翻页一起删除；保留“未变化的通知连发不重建页面”（卡片按 morph 次数、React 部分按 DOM 变更批次计，各 ≤ 1，实测 0 / 0）、数据到达、轻微拖动仍算点击、静止后数字落在整位（1×、1.25×、1.5×）。 |
| `renderer-lifecycle` | 删除 `quotaHero` 的积分图重绘检查（组件已退役）。 |
| `continuity`、`motion`、`source-quota` | 只换定位（自动刷新下拉、Codex 连接 Sheet、详情移除）。 |

## 6. 验证结果（源码模式，合成数据，独立的 usage/quota 目录）

| 项 | 结果 |
|---|---|
| `quota`、`quota-v4`（1× 深色、1.5× 浅色）、`quota-identity`、`provider-quota`、`provider-login`、`provider-client`、`source-quota` | 通过 |
| `visual`、`motion`、`render-performance`、`interaction-reliability`、`renderer-lifecycle`、`continuity`、`overview` | 通过 |
| `settings-smoke`、`ui-kit-gallery`、`ui-mkb-gallery`、`ui-motion-mode`、`ui-disclosure-motion`（数据档改值后） | 通过 |
| `ui-foundation` | 通过。登记的岛列表补上 `quota`、`quota-after`、`quota-summary`（自 `153b0f3` 起就有，断言没跟上） |
| `cost-ui` | 通过（连续 3 次）。交接里记的 `cost-ui-test.js:77` 失败没有复现：在 `153b0f3` 上用临时 worktree 也通过，判断为偶发，未改代码。 |
| 其余全部 UI 套件（外框改变了每个页面的几何，合入前逐个跑过） | 通过。`polish` 把额度页标题的定位从 `#quota .page-heading` 改成 `#quota [data-quota-toolbar] h1` 后通过 |
| `npm run verify` | fail 0，ESLint 无问题 |
| `npm run audit:runtime` | 通过 |
| 打包、真实账号 | 未执行 |

## 7. 逐像素门槛（`scripts/m1/ui-pixel-gate.js`）

基线是 main `f2b6b8d`，候选是本分支 `804269b`；之后的提交只改文档，渲染与合入时相同。两种尺寸，浅色和深色，6 个页面，每个页面拍顶部和整页，每种尺寸 24 对，没有缺图。产物：`artifacts/ui-gate/quota-shell/`（`main-1440`、`after-1180`、`after-1440`、`diff-1180`、`diff-1440`）。1180 的基线用已有的 `artifacts/ui-shell/main-1180`。

| 页面 | 1180×850 差异比例 | 1440×900 差异比例 | 判断 |
|---|---|---|---|
| 额度 | 11.2%–29.7% | 9.2%–15.3% | 页面重做加外框（第 3 节） |
| 用量 | 3.8%–4.1% | 3.7%–4.8% | 只有外框 |
| 费用 | 1.3%–2.7% | 3.3%–3.9% | 只有外框 |
| 设置 | 2.1%–4.7% | 1.9%–3.8% | 只有外框 |
| 来源 | 0.8%–1.9% | 3.2%–4.4% | 只有外框 |
| 会话 | 0.3%–0.5% | 1.1%–1.3% | 只有外框 |

全部图对都超出 0.2% 预算，原因是外框改变了每个页面的几何。外框是所有者批准的变化，所以这些图对不列进 `approved.json`；以后的步骤以合入后的 main 为基线。逐张看过差异图，额度页以外的差异只有以下三类：
- **外框几何**：面板四周的底色和圆角，内容右移、变窄（右边距 8，面板内边距）。整页高度多 5–8 px（面板上下内边距）。
- **面板底色**：页面底从窗口灰变成面板白（深色 `#1e1e1e`）。半透明的填充在白底上显得更浅：用量页的柱子、今天的蓝柱和费用链接。
- **额度导航计数**：“额度监控”旁的“2”在每个页面都显示。main 上同样的计数（同一规则：需要处理的连接数）要等额度页渲染过才出现，所以 main 的其他页面截图里没有；现在额度数据一到就更新。

`motion.ts` 数据档的改动在门槛里看不到（截图时动效关闭）。
