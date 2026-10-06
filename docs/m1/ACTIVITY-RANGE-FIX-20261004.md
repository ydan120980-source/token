# 活动图范围切换修复 · 2026-10-04

## 问题与改动

用户截图显示 09-05 至 10-04 的 30 张大日期卡片，但活动图范围控件仍写“最近一年”。原因是 renderHeat 将全局统计 period 与活动图区间混用，period 不为 all 时启用 compact-range 旧分支；该分支同时覆盖方格尺寸与填充颜色。上轮只处理了全年网格，因此遗漏了该状态。源码确认，无统计数据损坏证据。

本次移除活动图的大日期卡片分支。活动图只由自身的最近一年/年份控件决定日期，顶层累计/30 天/7 天/今天仍控制原有摘要和趋势。Agent/模型筛选继续应用于活动图。月份与方格下方对齐，始终使用方格；限制单格最大 16px，避免新年只有一列时放大。选择日期与键盘移动随活动图区间处理，保留准确提示、未知与零区分、140ms 动画和减少动态效果。

主要修改 design/desktop-reference/preview.js、activity.css、scripts/m1/activity-ui-test.js。新增四种全局范围下的日期一致性、尺寸、月份、控件可用性和年度只有一天的尺寸验证。CodeGraph 不可用，按相关渲染源码和测试检查。依赖、计价与用量采集逻辑没有改动。

## 验证与边界

沿用 frontend-testing-debugging 技能。Browser 插件/skill 不可用，使用项目现有 Playwright Electron 测试。所有维护窗口指定独立 usage/quota 目录、合成 fixture home。没有扫描真实来源、读取认证、执行真实账号操作。截图中的日期与金额均为合成验收输入。

- verify：lint 与 49 个单元测试通过。
- test:native：6 条记录、694 Token，Tokscale 4.17.0，通过。
- test:stress：六种压力工作负载通过。
- experiment:crypto：进程间合成实验通过。
- test:activity:ui：源码和 Windows 包在 100%/150% 通过；四个统计范围均保留全年小方格，准确悬浮值、月份、零与未知、键盘、新年、今日刷新、深色与 800×600 均通过。
- test:quota:ui：源码和 Windows 包在 100%/150% 通过。
- test:ui：可见源码窗口在 DEBUG=pw:browser 诊断参数下完整通过 100%/150%，用量、导出、清空、重启等检查通过。此前两次普通运行关闭问题仍未定位。
- 解压验证：中文/空格路径下的活动图专项与额度回归均在 100%/150% 通过，ASAR 逐字节审计通过。
- ASAR：68 个产品源码/资源逐字节一致。

此前两次可见窗口 test:ui 在合成清空验收阶段报告窗口关闭，关闭前定位器显示按钮不可见。原因未确定，不能归因于用户或本次活动图改动。曾尝试隐藏维护窗口，但 Playwright 点击稳定性等待超时，已撤回该测试脚本调整；没有采用强制点击来绕过验证。随后按原脚本使用 DEBUG=pw:browser 保存日志，完整测试通过，日志为 artifacts/activity-fix/source-usage-debug.log。没有确定普通运行窗口关闭的原因。可见人工 Windows 系统 DPI 验收未重复。

证据在 artifacts/activity-fix/；其中 heat-period-30-1.png 演示顶部选中最近 30 天、活动图继续使用最近一年小方格。

## 交付

新构建目录 dist/activity-fix-20261004/win-unpacked；Windows ZIP、源代码 ZIP 与 SHA-256 清单位于 dist/activity-fix-20261004。保留上一版，未覆盖正在运行的程序，未发布。源包排除真实统计、凭据、测试截图与临时目录。用户需打开新的 exe 才能看到修复。

> 交付形态更新（2026-10-04 后续）：每代 Windows ZIP 已删除（与同代 `win-unpacked/` 内容完全相同，可由 `scripts/m1/package-quota.py --windows-zip` 重建），各代相同的运行时改用 `npm run dist:share` 硬链接共用。本目录现为 `win-unpacked/` + 源码 ZIP + manifest + `SHA256SUMS.txt`，manifest 以目录形态记录。详见 `docs/m1/MAINTENANCE-20261003.md` 的「交付形态调整」一节。

解压用的临时程序目录保留，合成 fixture 输入已由测试清理；本轮未启动真数据预览服务，未操作真实账号连接。
