# M11 可见窗口验收与补充问题 · 2026-10-30

对应 HANDOFF-20261029 第 2 节第 6 步。在真实可见的 Electron 打包窗口中，使用隔离合成 usage/quota/home、1280×900、100%、深浅主题和完整动效。显式采集只读取本次合成 fixture，窗口没有真实账号。可复现命令：设置 `QUOTA_PACKAGED_EXE` 为候选 EXE，运行 `node scripts/m1/release-window-check.js visible-packaged`。

**两项外观问题未通过，交 Claude 确认或修正。** 脚本保留 `VISUAL_REVIEW_REQUIRED`，退出 1；没有修改 UI/motion 产品源码。首轮在阴影断言处停止后，补全证据收集，使检查继续覆盖两个主题、两类卡片和标题栏，最后统一报告；这不是豁免。

## 标题栏

额度为 `5h 0% · 周 84%`，采集状态为 `已采集 · 刚刚`。两个控件外框都是 y=8、height=28，中心差 0；但额度文字行框 y≈9.3625、height=18，采集文字行框 y=13、height=18，中心差约 3.6375px。深浅主题相同，截图中额度读数偏高。不能只比较外框便判为文字对齐。

可核对 `ui/src/pages/widgets/index.tsx` 的 TitleReadout（kit compact Button），`ui/src/vendor/fluid/components/button.tsx` 标签的 `text-box: trim-both cap alphabetic`，以及普通 `#collectionStatus` 的布局。嵌套图标/inline-flex 标签的 trimming 是待 Claude 核对的可能原因，尚未声明已修复。

## 阴影与按压

- 小组件：真实 `:hover` 命中成立，但浅色与深色的 computed box-shadow 均与静止时完全相同，未达到 M11 要求的悬停加深。`ui/src/theme/index.css` 将 widgets.css 放在 components 层，WidgetCard 自带的 `shadow-card` 在更高优先级的 utilities 层，覆盖 `[data-widget-open]:hover` 的阴影声明。应由 Claude 修正层级/规则归属并保留原阴影 token，不需要新设计。
- Agent 卡片：深浅主题悬停阴影均变化，符合现有 token；没有悬停上浮要求或新增缩放。
- 按压与释放：小组件按下约为原宽的 98.2%–98.3%，Agent 卡片约 98.0%，释放后均回到原宽。650ms 逐帧采样观察到多个不同回弹状态；这证明实际渲染在变化，不代表人类已认可主观手感。

证据：`artifacts/release-m11/window/visible-packaged/results.json`、`light/dark-titlebar.png`、`light/dark-widget-idle.png`、`light/dark-widget-hover.png`、对应 Agent 和 released 截图；日志 `headless/visible-window*.log`。字体文件响应、loaded 字体面、自定义 Noto 中文字形也被保留。页面错误为空。

## 转交要求

本记录追加到原 Token 活动第 6/9/10 项之后，现共有五项外观问题等待闭环。34 对 M9→M11 静态图仍需完整审阅；静态 motion off 截图不能覆盖本文的按压轨迹。请反馈：文字对齐修正、widget hover 修正、原三项逐条裁决，以及改版前后图的通过/阻塞结论。所有者手动转交，不声称 Claude 已收到。
