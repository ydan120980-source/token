# ChartLegend 补充裁决 · 2026-10-26

MK-b 接口核对发现旧图例的 active 联动、未计价解释行、原生 title 和完整可访问名称缺少对应接口。按计划 §9.4 停止后，所有者明确答复：允许上述五字段补充并记录裁决，继续 MK-b–M8。

在统一裁决 §4.5 的原 ChartLegend 接口上，仅补充：

```ts
active?: string | null; // 默认 null，父级受控
onActiveChange?: (key: string | null) => void;
// 每个 items 项：
disabled?: boolean; // 默认 false
title?: string;
ariaLabel?: string; // 未提供时沿用可见文本的无障碍名称
```

指向/聚焦报告 key，离开/失焦/Escape 报告 null；图例与图表共享受控 active。disabled 只阻止显示/隐藏切换，用 aria-disabled 标记，保留焦点和解释读数。原 minVisible 与旧 UMD 的至少一个已计价正值项保护保持。激活反馈沿旧 fill 对应的规范语义 token，不新增颜色、尺寸、文案、布局或动效档位。原生 title 和完整读数由调用方原样提供，不新增悬停卡或业务格式化。

其它 kit/theme/token/vendor/guard 范围仍以原统一裁决为准。新增例外仍按 §9.4 停止提问。验证并入 MK-b 的双主题、键盘、off/reduced、未知语义和 gallery/几何/verify/foundation 门槛。

署名：Codex
