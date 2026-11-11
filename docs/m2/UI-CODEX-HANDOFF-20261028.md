# 交给 Codex：全量验收 `ui/design-palette-summary`，然后做 M7 · 2026-10-28

**状态**：Claude 写。所有者 2026-10-28 要求 Claude 只跑约 20 分钟的精简测试，全量套件交给 Codex。顺序是：先做第 1 步；Claude 审核并合入 main 后，再按 `UI-MIG-M7-KICKOFF-20261028.md` 做 M7（第 3 步）。

## 1. 全量验收（不改设计）

- 在 `ui/design-palette-summary` 的最新提交上新开分支 `codex/verify-design-palette-summary`。
- 跑 `npm run verify`、`npm run audit:runtime`，以及 `scripts/m1/*-ui-test.js` 全部 51 个套件：串行，源码模式，合成数据，每个套件用自己的 usage/quota 目录。
- 每个套件记录实际命令、退出码、耗时和输出末尾。**所有者2026-10-28补充：日志非空且有结果输出**；通过仍须真实执行、退出码0且断言成立。原“不足10秒不算通过”规则作废，不补sleep或制造负载。Claude此前日志全空的一轮仍作废，历史验收记录保留当时规则与原始结果。
- 失败分两类处理：
  - **测试只是跟不上已批准的改动**：可以修，并写明对应哪条决定。已批准的改动有：概览为默认页、导航 176、小组件栏、C 配色、Apple 式卡片、删除说明小字。
  - **产品问题**：停下来列出，交 Claude。
- 像素门槛：用 main 和本分支各拍 1180×850 和 1440×900，浅色和深色，全部页面。这一轮所有页面都会有差异（底色、卡片、配色、导航、侧栏、小字都改了），只出前后对照图，不需要逐张批准。

## 2. 已知问题（先查这个）

**卡片内容溢出**：
- 以概览为启动页时，`quota-v4-ui-test.js` 第 131 行失败。卡片 `00000000-0000-4000-8000-0000000000a1` 宽 244，`.quota-card-body` 的 `scrollHeight` 214 大于 `clientHeight` 174；它唯一的子元素 `.quota-card-content` 高 159，是更深层的内容溢出。
- 把 `preview.js` 的 `restoredView` 改回 `'usage'` 后，这个套件通过。
- 推测：额度页可见时，卡片被 `uiMorph.update` 增量更新，结构与首次直接渲染不同。这在真实使用中也会发生：停留在概览时额度数据更新。请找到根因，在 `quota-card-grid.js` 或 morph 里修复，不要靠改启动页绕过。

**另外两个与本分支无关的失败**（已另开任务）：
- `interaction-reliability`：费用部分仍用旧选择器 `[data-cost-by]`、`[data-cost-search]`；
- `quota-identity`：main 上同样失败，期望两张 WorkBuddy 卡片，实际一张。

## 3. 之后

- 写 `docs/m2/UI-VERIFY-DESIGN-PALETTE-SUMMARY-<日期>.md` 后停止，等 Claude 审核并合入 main。
- 合入后按 `UI-MIG-M7-KICKOFF-20261028.md` 开始 M7。
- 不合 main、不推送、不打包，不读真实来源或账号，不使用子代理。
