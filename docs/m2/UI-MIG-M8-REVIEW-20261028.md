# M8 审核 · 2026-10-28

**结论：M8（`ui/mig-m7-m8` 交付提交 `999014f`，产品候选 `7167d3f`）通过审核，满足本地合入门槛。下面列出的两项是后续债务，不阻塞合入。**

## 1. 复核结果（Claude 在该工作区独立执行）

| 检查 | 结果 |
|---|---|
| `npm run verify` | 退出 0，fail 0 / cancelled 0 / skipped 0 |
| `npm run audit:runtime` | PASS：152 reachable product modules |
| `scripts/m1/cost-smoke-ui-test.js`（源码模式，合成数据） | PASS |
| 裁决 §4（不交费用摘要、不改颜色值） | 没有 cost-summary、SummarySection 或预览岛。`tokens.css` 只追加 figure 行高、字距、`--cost-ref-*` 命名映射和两个字重，原有颜色值没有改动。 |
| 数据语义 | 页面和图表中的 `?? 0` 只用于坐标和比例尺计算，显示值仍为 null 或未知标记；CSV 口径没有变。 |
| 未改页面 | 交付记录中 40 对截图有 38 对零差异；另外 2 张设置页顶栏只有窗口焦点造成的文字差异。我接受这一残余，它来自截图工具，不是产品回归。 |

没有复跑完整像素图组和 motion 记录器，以交付记录的原始报告为准。打包版、真实来源和真实账号都没有验证。

## 2. 后续债务（不阻塞）

1. **费用参考模式是一套双实现。** `ui/src/theme/cost-reference.css` 有 1594 行旧样式；kit 的 controls、surfaces 和 charts 里约 200 处参考分支，其中 7 处按中文 `aria-label` 选择样式（如 `"导出费用 CSV"`、`"圆环形状"`）。改文案就会悄悄丢样式。这是所有者要求费用页 1:1 对标的直接代价，作为过渡状态接受。费用页换 C 配色、删说明小字的时候，一并退出参考模式，改回 kit 默认分支。届时删除这些分支和 `cost-reference.css`，不再新增按文案判断的分支。
2. **费用页说明小字和后来的“无小字”规则冲突。** M8 按所有者批准的 1:1 对标恢复了原说明文字；所有者同日另一项决定（`UI-PALETTE-QUOTA-SUMMARY-PROPOSAL-20261027.md`）要求所有页面删除说明小字。处理顺序：M8 作为与旧版一致的迁移基线先合入；删除小字和换 C 配色作为 Claude 的后续改动，附前后截图对照。这样迁移和改版分开验证，互不冲突。

## 3. 合入说明

- 与 `ui/design-palette-summary` 重叠的文件只有 `design/desktop-reference/index.html` 和构建产物 `ui/agent-ui.js`。后者合入后重新执行 `npm run build:ui`。
- M7 未开始；下一步由所有者安排。
