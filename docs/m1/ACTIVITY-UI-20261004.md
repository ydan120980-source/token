# 活动热力图与今日统计修复 · 2026-10-04

## 授权范围与实现

仅修改现有 Windows 统一界面的今日统计和活动热力图。用户提供的 Codex 个人资料截图是视觉参考：实心圆角方格、橙色强度、下方月份，以及悬停动画和 Token 用量。沿用现有年份、配色、筛选、日期点击与键盘操作；没有新增截图中的作品展示或任务时长统计。

- 今日日期采用统计快照的时区，渲染时重新计算。每 30 秒及窗口恢复焦点/可见时检查跨日；新年同步年份选项，不需要重启。
- 没有今日记录时，Token/费用/记录显示“—”，不用“未定价”代替缺少记录。分别提示未采集、暂停或读取失败，桌面空白日提供“刷新今日”。手动刷新不自行开启定时采集。
- 热力图使用实心灰色未知格和橙色活动格，月份位于网格下方。未知日和已记录的零值仍分别展示。
- 悬浮提示显示日期及完整 Token 数；未知日显示“未观测到记录”。指针和键盘聚焦均可打开，Escape/离开/滚动/路由切换可关闭。提示限制在窗口内。
- 方格与提示有 140 ms 过渡，只对请求的热力图生效；减少动态效果设置下关闭动画。点击选中不重建网格，保留键盘焦点。

主要文件：design/desktop-reference/preview.js、usage-math.js、activity.css、index.html、serve.js；新增 calendar.test.js、activity-ui-test.js 和 test:activity:ui 命令。依赖没有变动。CodeGraph 工具不可用，使用相关源码与测试验证跨文件更新链路。

## 真数据诊断及证据边界

仅只读本应用 statistics.json 中的用量统计，不读取认证文件、不修改来源文件、不执行真实账号操作。

- 00:21:35 的本机统计：Asia/Shanghai，2026-10-04 已有 4 条记录、381,329 Token。
- 00:33:48 的统计快照：2026-10-04，18 条记录、2,044,089 Token。只读预览的今日卡片及悬浮提示与该快照一致，证据 artifacts/activity/real-preview-results.json、real-today.png、real-hover.png。
- 用户截图时刻与当前统计不同，无法证明截图空白只由跨日日期固定造成。源码确有页面打开时固定日期的问题，已修复并独立测试。没有把昨天记录挪到今天，也没有填充不存在的用量。
- 真数据验证是 localhost 只读渲染预览，不是新 Windows 包真实账号验收。使用独立的无账号 Edge 无头进程；默认 Playwright Chromium 未安装，改用已安装 Edge，没有下载浏览器。预览服务与浏览器已关闭。

## 验证

所有 Electron 维护测试指定独立 usage/quota 目录及合成 fixture home。未执行真实登录、额度刷新、logout 或账号切换。旧连接与真实 logout 待验状态不变。

| 检查 | 结果 |
| --- | --- |
| npm run verify | lint 与 49 个单元测试通过 |
| npm run test:native | 6 条合成记录、694 Token，Tokscale 4.17.0，通过 |
| npm run test:stress | 六类压力任务通过：160,000 SQLite 记录、队列/RPC/投影等 |
| npm run experiment:crypto | 合成进程间加密、错误密钥、篡改、重放拒绝通过 |
| npm run test:ui | 源码与 Windows 包 100%/150% 通过 |
| npm run test:quota:ui | 源码与 Windows 包 100%/150% 通过 |
| npm run test:visual:ui | 源码与 Windows 包的固定组件、费用详情、深浅色和 800×600 窗口通过 |
| npm run test:stress:ui | 20,000 条聚合、100 模型、200 天，两个缩放通过 |
| npm run test:activity:ui | 源码与 Windows 包 100%/150%：精确悬浮值、未知/零、点击/焦点、午夜/新年、IPC 今日刷新、减少动态效果、提示边界通过 |
| ASAR 审计 | 68 个源文件/资源与构建内容逐字节一致 |
| ZIP 解压验证 | 中文和空格路径下，活动图、用量页、额度页均在 100%/150% 通过；68 个源文件/资源审计通过 |

Windows 包 test:ui 首次在合成来源增长等待中报 Target page/context/browser has been closed。随后带诊断日志的完整测试通过，再次不带诊断参数的完整测试通过。未定位首次关闭的原因，保留为自动化运行的间歇问题，不能宣称根因已修复。诊断日志 artifacts/activity/packaged-usage-debug.log。活动专项和视觉检查未复现。

与参考的差异：保留 Windows 应用现有侧栏和白色卡片体系，深色模式仍跟随应用主题；未复制参考页面的作品模块，也未新增每天/每周/累计切换。颜色、网格布局、月份位置和悬停交互已对照最新渲染截图检查。手工 Windows 系统 DPI、真实鼠标跨日长时间观察、新构建真实额度操作未执行。

## 交付

构建目录 dist/activity-20261004/win-unpacked；Windows ZIP、源代码 ZIP 和 SHA-256 清单同在 dist/activity-20261004。源代码包排除凭据、真实用量、运行目录、测试证据、node_modules、dist 和临时文件。未发布、未更改启动项、未覆盖旧版本。使用新界面需关闭旧窗口并打开该目录中的 Agent Usage Quota.exe。

> 交付形态更新（2026-10-04 后续）：本代 Windows ZIP 已删除，运行时与其它代硬链接共用；本目录现为 `win-unpacked/` + 源码 ZIP + manifest + `SHA256SUMS.txt`。详见 `docs/m1/MAINTENANCE-20261003.md` 的「交付形态调整」一节。

解压验证临时目录保留，未包含用户数据；合成 fixture 目录由各测试清理。真实预览仅在本机回环地址运行，端口 4178 已停止。
