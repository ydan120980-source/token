# Agent Usage M1

Windows 本地 agent 用量统计，个人测试版 **0.1.0**。固定 token-monitor v0.65.0 与官方 Tokscale 4.17.0。默认简体中文。

## 运行已打包版本

将 `AgentUsage-M1-Windows-x64.zip` 解压到一个普通本地目录，运行 `Agent Usage M1.exe`。不要只复制 exe；整个目录中的 resources、DLL 等文件都需要保留。

默认启动读取五类本地用量来源；自己的状态放在 `%APPDATA%\AgentUsage-M1`。首次采集通常数秒。关闭窗口后保留托盘；托盘“退出并停止采集”或设置页退出才会结束进程。

提供今日、最近 7 天、最近 30 天、累计；agent/model 筛选、每日趋势、来源状态、暂停/恢复、手动刷新、统计 JSON 导出和清空自己的统计。费用为 USD API 等价估算，未知价格/字段不算免费。

支持来源：Codex Desktop/CLI、Claude Code、OpenCode、WorkBuddy、MiMo Code/共享数据库中的 Desktop 入口。只有明确元数据才区分入口；显示“入口未知”是有效结果。Cursor、Trae 等留在后续目录。

只读取本机用量文件/数据库，源数据库只在内存解析。不读取认证，不修改 agent 配置，不上传统计。产品入口关闭账号、额度、切换、Hub/Worker、iCloud、Discord、汇率、更新和自动启动功能。

本阶段没有 iPhone、外网同步或真实订阅额度。独立未签名本地构建，未公开发布。

## 源码运行与检查

Windows x64，Node 24、npm、Git。以下使用 `npm.cmd` 避免本机 PowerShell 的 npm.ps1 策略冲突。

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
npm.cmd run verify
npm.cmd run test:native
npm.cmd run test:upstream
npm.cmd run experiment:crypto
npm.cmd run test:ui
npm.cmd start
```

安装 Electron 与依赖需要联网；运行应用时不联网。不执行上游 vendored Tokscale 覆盖/更新脚本。`node:sqlite` 只用于生成合成测试库；产品读库使用 sql.js，仍不新增业务 SQLite 存储。

真实来源验收已经在开发机完成；重新验证时先运行 verify/test:native，再运行 `npm.cmd run validate:local`。只输出脱敏统计，并将验收标记写入自身目录；它不会复制原始输入。尚未通过本机样本验证的其他机器默认显示未验证。

打包：

```powershell
npm.cmd run dist:win:dir
$env:M1_PACKAGED_EXE = (Resolve-Path 'dist/win-unpacked/Agent Usage M1.exe').Path
npm.cmd run test:ui
Remove-Item Env:M1_PACKAGED_EXE
```

应用目录在 `dist/win-unpacked`。源码 ZIP 使用提交后的 Git archive，不包含 node_modules、dist、真实输入、日志、缓存、规划临时文件或测试产物。

治理检查使用本机 bundled Python：

```powershell
& 'C:/Users/yudan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -X utf8 scripts/m1/governance.py
```

## 文档与评审

- [验收记录与未执行项](docs/m1/ACCEPTANCE.md)
- [统计合同与去重](docs/m1/DATA-CONTRACT.md)
- [来源固定与实现调整](docs/m1/UPSTREAM.md)
- [本地加密实验](docs/m1/CRYPTO-EXPERIMENT.md)
- 研究资料保存在 `research/agent-usage/`，不因实现阶段覆盖。

原上游源码仍在仓库供参考；运行入口和打包清单仅包含 M1 安全路径。请使用这里列出的命令，不启动旧的 account/sync/hub/worker 入口。M1 交付后停在用户评审点。
