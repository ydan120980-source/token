# 共用动效切换收尾修正 · 2026-10-26

## 授权与范围

M4 最终截图复核发现共用 React Sheet 在动效切换后透明但仍保持模态。按迁移计划 §9.4 停止并报告后，项目所有者明确回复“授权并继续”，授权上一条问题列明的最小修复、必要合成验证/记录、独立提交，再恢复 M4–M8。

该修正只改 `design/desktop-reference/motion.js`，新增 `scripts/m1/ui-motion-mode-ui-test.js` 与本记录。无需修改曾列为可选的 `ui/src/providers.tsx`。不修改 spring、模式、kit 接口、vendor、theme、token、guard、allow、后端或 IPC。没有真实数据、账号、配置管理、安装、远程或 main 操作；没有子代理。

本分支已有未提交的 M4 草稿；本修正按明确路径独立提交，不把 M4 删除/源码/生成物一并纳入。验证在该工作树当前合成产品上完成，专项只使用 main 已存在的 M3 设置页，不依赖 M4 新接口。

## 原因与修正

原 `motion.js` 在偏好/系统媒体变化时取消 document timeline 的全部 Web Animations。Motion 的 WAAPI 效果被直接 cancel 后，可能重新露出初始 opacity=0，而 React/Radix 的打开状态和焦点锁仍然存在。原 main `f2b6b8d` 和 M4 工作树均有独立复现，包含真实系统 reduced-motion 路径。证据保留在 `artifacts/ui-mig/M4/motion-cancel-diagnosis/`；不是新迁移页面独有的问题。

增加唯一内部收尾函数 `endDocumentAnimations()`：

- 滚动时间线不处理，保留位置提示。
- React root/portal 内可完成的有限动画用 `finish()` 到既有目标，让 Motion 保留提交最终样式和执行完成回调的机会；不读取/重写业务状态、焦点或样式目标。
- legacy、无限动画及不可 finish 的零速情况仍取消，保持此前的处理。
- 偏好/系统媒体变化与同文件的 Page Visibility 取消点共用该函数，避免相同外部取消路径再次破坏 React 目标。

没有新尺寸、颜色、时长、动效模式或组件公开属性。模式变化打断入场时到达原目标，不增加新的视觉设计。

## 合成验证

专项通过实际 `uiMotion.setPreference` 和 Playwright 的系统媒体模拟，验证深浅色的 Sheet 入场/退出中分别切换 off、reduced、system-reduced。切换前必须捕获真实中间 opacity，不能只测切换已完成的面板。检查打开终态 opacity=1、off 下下一次绘制到目标、Tab 焦点仍在面板，退出后面板卸载、焦点回触发按钮且 body 指针锁解除；另验证完整入场后再次切换。

Page Visibility 分支采用本测试会话内临时 hidden 标志加原生 visibilitychange 事件，驱动真实处理函数，随后恢复属性。原测试框架保持后台绘制，hide() 没有产生 hidden 状态；不能将此项称作真实窗口隐藏验收。

验证日志：`.cache/ui-motion-build.log`、`ui-motion-verify.log`、`ui-motion-runtime.log`、`ui-motion-mode-final.log`、`ui-motion-foundation.log`、`ui-motion-settings.log`、`ui-motion-regression.log`、`ui-motion-gallery.log`；专项截图/结果在 `artifacts/ui-motion-mode/`，gallery 同目录子目录。最终 build、verify（fail 0）、runtime、专项、foundation、设置页冒烟、原 motion 套件与完整 gallery 全部通过。

首轮记录：新测试多声明了 ESLint 已内置的 performance 全局，lint 失败后移除声明；专项最初尝试真实 hide()，但当前测试框架下 document.hidden 没变化而超时，改为明确标记的合成事件分支。没有放宽已复现的真实偏好和系统媒体路径、opacity、焦点、指针或退出断言。

## 交接

本修正与 M4 草稿独立交 Claude 审核。后续恢复 M4 最终配置 Sheet 截图与页面冒烟；仍需 M4 提交后才进入 M5。没有打包、合入 main 或远程发布。

署名：Codex