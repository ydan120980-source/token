# M11 发布验收待裁决外观 · 2026-10-29

基线 main 3d089bf，工作树 <codex-worktrees>/release-m11-20261029/token。仅合成 fixture。没有修改 UI 或 motion。

新 token-activity-ui-test.js 在 100% 浅色、150% 深色运行了 M11 第3节1–13的逐项交互/样式检查，核心行为全部成立；以下字面外观差异仍返回 VISUAL_REVIEW_REQUIRED，脚本整体退出1，不算验收通过。

| 项 | 记录要求 | 当前源码/渲染证据 | 待裁决 |
|---|---|---|---|
| 6 提示卡 | 深色胶囊 | 当前公共 WindowTooltip 采用 bg-surface-5；浅色主题 rgb(255,255,255)，深色主题为深灰。标题加粗、进场缩放、单一 aria-describedby 均已通过 | 是否保持主题跟随，或按原文统一深色 |
| 9 事实列表 | 可点击，悬停浅底 | 点击选中正确时段通过；ValueButton 仅 hover:underline，背景透明，两个主题相同 | 保持共享数值按钮下划线，或添加浅底 |
| 10 单日小时柱 | 第3节写淡色渐变底、细环和投影；第5节实现表只写淡底和细环 | 当前整列为纯色 SVG rect，有细环，无渐变/投影；饱和度、几何不缩放、高峰/空/未来状态均通过 | 第5节是否已替代第3节字面要求 |

证据：artifacts/token-activity/results.json、visual-review-required.json、tooltip-1.png、tooltip-1.5.png、fact-hover-1.png、fact-hover-1.5.png、hour-hover-1.png、hour-hover-1.5.png、activity-selected-1.png、activity-selected-1.5.png。原始日志在 artifacts/release-m11/headless/token-activity-geometry.log。

应由所有者或 Claude 明确裁决后固定本轮验收口径，不自行改设计或删除要求。其余发布文档已发现早期 Codex-only/绝不配置写入等承诺过时，需要按现行合同校正。用户已授权验收完成后正常推送源码；GitHub Release/tag 等待另行确认。

## 所有者裁决 · 2026-10-29

所有者选择“交 Claude 确认或修正，保留这些项为待决”。这不是接受当前视觉，也不授权 Codex 改 UI/motion。保留脚本 VISUAL_REVIEW_REQUIRED 失败门槛，不删除要求。其他不依赖该裁决的测试适配、检查及公开文档校正可以继续；最终验收、合入与推送仍须等待裁决关闭。所有者此前指定手动给 Claude 发消息，本记录为转交材料，未声称 Claude 已收到或审阅。

## 断言覆盖

1. 选中日期外圈与间隙、键盘焦点描边；2. 时段内外日期填充及细环；3. 零/未知/未来的独立填充；4. 月份标签扫入淡入；5. 刷新后同节点和焦点；6. 提示卡标题/字号/进场/单一 aria 关联与待决外观；7. 星期/小时标签反馈；8. 点击和 Escape 取消；9. 事实按钮选中时段与待决悬停；10. 小时柱几何/饱和度/整列反馈与待决绘制；11. 高峰/零/未来状态；12. 小时刻度中心；13. 日历/色阶配色过渡及重启后保存。reduced/off 另查无缩放格子动画。

本步完整 verify 为 fail 0、audit:runtime 通过；这两项不替代新增界面套件的视觉待决门槛。

## 可见窗口补充 · 2026-10-30

第 6 步另发现两项未通过：小组件真实悬停时阴影不变（components 层的 hover 阴影被 utilities 层 shadow-card 覆盖）；标题栏控件外框对齐，但额度文字比“已采集”文字高约 3.64px。深浅主题均复现。Agent 卡片悬停、两类卡片按下与回弹有实际渲染轨迹。详见 `UI-M11-WINDOW-REVIEW-20261030.md` 及 `artifacts/release-m11/window/visible-packaged/`。

这两项作为交接要求中的外观问题一并交 Claude，不自行改设计，不把已有三项裁决问题的保留决定当作五项已批准。最终审阅包会包含本文的更新和可见窗口证据。
