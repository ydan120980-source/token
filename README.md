# Agent Usage

Windows 本地用量统计与 Codex 账号额度。当前保留版为 0.1.0，本地未签名构建。

唯一入口为 `src/quota/main.js`。旧的深色 Agent Usage M1 窗口和已替代的包已删除；五来源采集功能已接入新版“用量”“来源管理”“设置”。`src/m1/` 是共享统计库，不是第二个应用。

## 运行当前版本

当前一代为 `dist/overview-20261005/`：顶部概览统一筛选范围，紧凑摘要与七日活动；日明细隐藏空模型行、保留未报告字段；趋势浮层透传鼠标与滚轮，拖动不会误开详情；额度再次进入动效有一分钟冷却。完整验收见 [OVERVIEW-20261005.md](docs/m2/OVERVIEW-20261005.md)。上一代 `dist/continuity-20261005/` 保留。

本轮桌面升级：额度条加减速动效、开启后每分钟刷新、趋势缺日淡线连接与 Agent 图标筛选。完整合同及接入准备见 [CONTINUITY-20261005.md](docs/m2/CONTINUITY-20261005.md)。上一轮定价与趋势重整见 [DESKTOP-REFINEMENT-20261004.md](docs/m2/DESKTOP-REFINEMENT-20261004.md)。上一轮公共价格同步与映射合同见 [DESKTOP-FUNCTIONAL-20261004.md](docs/m2/DESKTOP-FUNCTIONAL-20261004.md)。

直接运行 `dist/overview-20261005/win-unpacked/Agent Usage Quota.exe`。必须保留整个 `win-unpacked/` 目录，不能只复制 exe。上一轮 `dist/refinement-20261004/` 与 `dist/functional-20261004/` 保留；`dist/pricing-20261004/` 的成本定价与设置页调整说明见 [PRICING-RESULTS-20261004.md](docs/m2/PRICING-RESULTS-20261004.md)；`dist/m2-desktop-20261004/` 的桌面性能、包与验收说明见 [DESKTOP-RESULTS-20261004.md](docs/m2/DESKTOP-RESULTS-20261004.md)。更早一代 `dist/polish-20261004/` 保留；其动效、滚轮与顶栏实现记录见 [UI-POLISH-20261004.md](docs/m1/UI-POLISH-20261004.md)。

`dist/` 下每代交付自成一个目录（`win-unpacked/` + 源码 ZIP + manifest + `SHA256SUMS.txt`），互不覆盖。默认不额外保留内容相同的 Windows ZIP，需要时加 `scripts/m1/package-quota.py --windows-zip`。实际目录大小以各代 manifest 为准；旧文档约 156 MB 的估算已过时。逐路径、逐字节/hash 相同的运行时文件可用 `npm run dist:share` 跨代硬链接共用，每代仍有完整可运行目录；`npm run dist:share:verify` 校验共用状态。2026-10-04 接手时实际只存在 `dist/polish-20261004/`，旧 README 列出的其他代不在当前磁盘中；不自动恢复。

M2 当前聚焦桌面端，手机版延期。范围、同步白名单、配对/密钥候选、持久防回放与只读权限边界见 [DESKTOP-SCOPE-20261004.md](docs/m2/DESKTOP-SCOPE-20261004.md)。这些同步设计尚未接入生产服务。

- “用量”：五来源只读采集，每 15 秒刷新；今日/7 天/30 天/累计、agent/model 筛选、趋势、模型明细、分类与质量说明。
- “来源管理”：五类来源状态、添加本地目录。添加后暂停采集，确认后在设置恢复。拒绝 UNC、认证路径和产品数据目录重叠。
- “设置”：暂停/恢复（暂停保留已保存统计）、导出、个人资料和浅色/深色。界面动效支持跟随系统／减少动态／关闭，默认跟随系统；系统减少动态优先。暂停与历史保留只影响用量统计，不影响原始来源及额度连接。
- “额度监控”：用户在官方页面完成 Codex 授权，显示套餐、剩余窗口、更新时间、错误和冷却。自动刷新每次启动默认关闭，开启后每分钟读取一次，保留失败/限流冷却。真实多个账号尚未验收。

本地采集不读取认证、不修改源数据库或其他 agent 的配置，也不上传统计。额度只通过独立官方 CLI 子进程读取，不发送推理/工具调用或消费重置额度。没有云/iOS、其他 provider、开机自启或公开发布。

已有数据沿用原位置，维护清理未删除这些目录：

| 数据 | 位置 |
| --- | --- |
| 用量历史和采集偏好 | `%APPDATA%\AgentUsage-M1` |
| 额度连接、缓存和独立 CLI home | `%APPDATA%\AgentUsage-M1-Quota` |
| 上次独立真实验收连接 | `%APPDATA%\AgentUsage-M1-Quota-Acceptance-20261003` |

关闭窗口会退出并停止采集/额度服务。原 M1 托盘界面已删除。

## 开发与验证

Windows x64，Node 24、npm、Git。PowerShell 使用 `npm.cmd`。

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
npm.cmd start
```

```powershell
npm.cmd run verify
npm.cmd run test:native
npm.cmd run test:ui
npm.cmd run test:quota:ui
npm.cmd run test:motion:ui
npm.cmd run test:detail:ui
npm.cmd run test:polish:ui
npm.cmd run test:desktop:performance
npm.cmd run test:stress
npm.cmd run test:stress:ui
npm.cmd run experiment:crypto
npm.cmd run pricing:check
```

UI/压力测试均使用独立合成来源和存储目录，不连接真实账号。临时数据位于系统 TEMP，结束后自动清理；脱敏证据保存在被忽略的 `artifacts/`。只有 `validate:local` 读取真实用量来源，须遵循项目隐私验收边界，不作为例行测试自动执行。

构建与实际 exe 验证：

```powershell
npm.cmd run dist:win:dir -- --config.directories.output=dist/m2-desktop-20261004
$env:QUOTA_PACKAGED_EXE = (Resolve-Path 'dist/m2-desktop-20261004/win-unpacked/Agent Usage Quota.exe').Path
npm.cmd run test:ui
npm.cmd run test:quota:ui
npm.cmd run test:stress:ui
npm.cmd run test:visual:ui
Remove-Item Env:QUOTA_PACKAGED_EXE
node scripts/m1/audit-package.js dist/m2-desktop-20261004/win-unpacked
& 'C:/Users/yudan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -X utf8 scripts/m1/package-quota.py --windows-dir dist/m2-desktop-20261004/win-unpacked --output-dir dist/m2-desktop-20261004 --acceptance-doc docs/m2/DESKTOP-RESULTS-20261004.md
npm.cmd run dist:share -- --anchor-generation polish-20261004
npm.cmd run dist:share:verify
```

构建新一代应使用新的 `--config.directories.output`，不能原地重建已交付或已共享的目录。`audit:package` 默认读 `dist/win-unpacked`，指定代时直接向脚本传位置参数。`package-quota.py` 默认只写源码 ZIP、manifest 和 `SHA256SUMS.txt` 并记录目录形态；`--acceptance-doc` 指定这一代验收文档，需先实际完成验收再打包。需要传统 Windows ZIP 时加 `--windows-zip`。`dist:share` 在新增一代后运行；它对 90 秒内被写入的树会拒绝执行（`--quiet-seconds` 可调），应先确认构建完成，且从不处理 ZIP。

源码 ZIP 按白名单打包当前工作树，不要求提交，也不自动提交用户修改；排除认证、真实输入、统计/账号缓存、日志、依赖和运行产物。ZIP 校验 CRC，并生成 SHA-256 清单。`package:source` 仅创建源码包。

## 维护与证据

- [M2 桌面端范围与同步边界](docs/m2/DESKTOP-SCOPE-20261004.md)
- [M2 桌面端第一批实现、性能与验收](docs/m2/DESKTOP-RESULTS-20261004.md)
- [当前交付的界面范围与已执行检查](docs/m1/NOWDEX-UI-20261003.md)
- [本轮审计、压力测试、删除依据和剩余验收](docs/m1/MAINTENANCE-20261003.md)
- [Codex 登录与额度边界](docs/m1/CODEX-QUOTA.md)
- [统计合同与去重](docs/m1/DATA-CONTRACT.md)
- [内置定价快照与构建期同步](docs/m1/PRICING-SYNC-20261004.md)
- [依赖来源与上游保留方式](docs/m1/UPSTREAM.md)
- [本地加密实验](docs/m1/CRYPTO-EXPERIMENT.md)

研究仍在 `research/agent-usage/`。历史审计在 `docs/m1/history/`，原上游参考文档在 `docs/upstream/`。被删除的上游实现可从本仓库基线提交 `f156470` 恢复，不属于当前运行或打包路径。

维护构建的合成验收不能替代新构建的真实账号、多个真实账号、物理显示器 DPI、系统对话框和休眠唤醒验收。上次真实连接保留，真实 logout 仍按用户选择延期。
