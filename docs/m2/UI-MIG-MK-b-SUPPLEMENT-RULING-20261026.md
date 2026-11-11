# MK-b 五组最小补充裁决 · 2026-10-26

所有者对 `UI-MIG-MK-b-INTERFACE-AUDIT-20261026.md` 的统一裁决问题明确答复：**“批准全部五组，记录后继续”**。只批准下列补充，证据和旧行为见该核对记录。

1. **A**：`RingChart.gauge.projection` 改为 `{ lower: number | null; upper: number | null } | null`。保留旧虚线推算区间，任一端未知就不画。
2. **B**：`BarChart`、`Heatmap` 新增 `tooltip?: (key: string) => ReactNode`；`StackBar` 新增 `tooltip?: (key: string | null) => ReactNode`；`LineChart` 现有 `tooltip?: (index: number) => ReactNode` 允许用于 stack/detail/spark。完整内容来自旧 UMD，位置、触发、层次和避让沿核对记录所列旧实现；未传入时不增加提示。pointer/focus 共用读数并保留 aria-describedby、离开/失焦/Escape 收尾；图表未知语义和受控状态不变。
3. **C**：`Card` 新增 `onClick?: () => void`，仅处理非交互区域且未选中文字的点击；独立详情按钮保留键盘入口；Sortable 继续抑制拖动后的点击，不嵌套 button。
4. **D**：`PaneGroup.panes[]` 新增 `actions?: ReactNode`。保留标题同行的费用构成/订阅对照切换，收起和窄屏规则沿旧实现。
5. **E**：`DateRangePopover` 新增 `triggerLabel?: string`、`marks?: string[]`，传入旧可见范围文字和已记录日期；原范围、校验、动作及焦点规则不变。

其它规范、文件范围和每页门槛均保留。新增组件/属性补 gallery 与相应测试，通过 MK-b 门槛后再进入 M6。每一步单独提交，M6 → M7 → M8 完成后写统一交付并停止，等 Claude 审核。不授权其它 kit/vendor/theme/token/设计检查修改，不合 main、不操作远程、不打包或读取真实来源/账号。

署名：Codex
