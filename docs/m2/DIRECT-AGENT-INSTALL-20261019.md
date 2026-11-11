# 程序直接安装与更新（2026-10-19）

后续修复 [INSTALLER-RECOVERY-20261019.md](INSTALLER-RECOVERY-20261019.md) 替代本文的 Codex npm 可选依赖路线，补充 Claude 原路径治理授权例外、下载恢复和原生执行大小上限；其余合同保留。

所有者明确要求采用 CC Switch 式安装逻辑：看到版本、未安装或故障状态后，能直接点击安装/升级，同时保留官方下载路径。这取代上一轮“只提供安装命令和官方网页”的主流程。最小界面仍由本轮实现，后续由 Claude 美化；本轮继续本地合入和正式打包，不恢复远端 Git 同步。

## 可执行合同

`usage:installers` 只读内存；打开页面不启动检查。`usage:installerAction` 只接受固定 Agent、动作及最新 revision，不接收 URL、路径、命令或 npm 包名。主窗口与顶层 frame 校验沿用既有 IPC 护栏。显式检查/安装任务全局串行，进度推送到界面；取消使用已拥有的 Job Object 清理树，清理无法确认就停止后续任务并要求重启排查。

十个内置 Agent 有独立后端安装计划。自定义来源没有任意程序安装器，继续原有格式/路径引导。

| Agent | 安装路线 | 成功证据 |
| --- | --- | --- |
| Codex | npm `@openai/codex`，包含官方可选平台二进制 | 本应用安装入口 `--version` 与目标版本一致 |
| Claude Code | `@anthropic-ai/claude-code-win32-{arch}` 平台包 | 同上 |
| OpenCode | `opencode-windows-{arch}` 平台包 | 同上 |
| MiMo Code | `@mimo-ai/mimocode-windows-{arch}` 平台包 | 同上 |
| Gemini CLI | npm `@google/gemini-cli` | 同上 |
| DeepSeek Harness | npm `@deepseek-ai/dsh` | 同上 |
| Antigravity CLI | 官方 Windows manifest，按其 SHA-512 核验 exe | 同上；不以桌面程序替代 CLI |
| WorkBuddy | 官方 `/v2/update` + SHA-256 + Tencent Authenticode 签名 | 用户完成安装界面后，再从固定安装位置/PE 元数据复检版本 |
| Cursor | 官方 update 接口；失败可用固定官方下载 URL，必须核验 Anysphere 签名和目标版本 | 同上 |
| ZCode | 官方页当前 Windows 下载地址 + Zhipu/智谱 Authenticode 签名 | 同上 |

Windows x64 为交付目标。代码为存在对应包的 CLI 保留 arm64 路线；未进行 arm64 验收。WorkBuddy 当前官方适配路线是 x64 安装器。

## 安装与恢复

CLI 安装在额度应用数据目录下 `agent-tools/{agent}/{generation}`。首次从 Node 官方站点获取 Node 24 Windows ZIP，并按同源官方 SHASUMS256 核验；安全解压限制条目、展开大小和目录穿越，并处理 Windows 长路径。npm 固定公共 registry、独立前缀、独立缓存、空 user/global npmrc，禁用生命周期脚本。Claude/OpenCode/MiMo 直接装官方平台包，避免依赖 postinstall 链接二进制。

安装子进程不继承账号 HOME、API Key、NODE_OPTIONS、代理凭据或 npm 设置；HOME/APPDATA 指向本应用的 `runtime-home`。版本检查也只执行本应用来源已知且哈希复核的程序；外部程序仅检查有界路径/固定 App Paths 键、PE 版本及固定 npm 包元数据，不执行任意 PATH 入口。

新版本通过运行核验前不替换 active.json；失败或取消保留旧版本，重装用新目录修复缺失文件。磁盘上的旧代次和失败任务暂保留供排查，不自动清理。复制启动命令可在 PowerShell 启动应用内 CLI；不修改系统 PATH，不接管外部安装。安装目录可加入本应用后续元数据发现，但不自动登录或采集额度。

桌面程序只在校验官方来源和有效发行者签名后打开安装界面。此时状态为“等待完成安装界面”，不是安装成功。用户完成后复检目标或更高版本才清除待确认状态；若取消了官方界面，可点击“安装界面已关闭”清除待复检标记后重试。本应用不伪造已安装、不强杀独立桌面安装界面。

检查版本失败保留本地已知状态、显示受控故障和官方下载入口。官方接口结构或签名不符合合同则停止；不绕过系统 PowerShell 策略、TLS 或签名。旧 `agentSetup`/Antigravity 引导 API 仍是只读/打开/复制/扫描，不因新增安装器改变权限。缺数据不推导成未安装、会员过期或零额度。

## 参考依据与实测边界

- [CC Switch 当前公开安装逻辑](https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/commands/misc.rs)：参考其安装来源与版本检查、可选依赖故障恢复，未复制实现代码。GitHub 公共 API 受限时只取公开 codeload 源码，没有使用凭据。
- 官方包元数据：[Codex](https://registry.npmjs.org/@openai/codex/latest)、[Claude Code](https://registry.npmjs.org/@anthropic-ai/claude-code/latest)、[OpenCode](https://registry.npmjs.org/opencode-ai/latest)、[MiMo Code](https://registry.npmjs.org/@mimo-ai/cli/latest)、[Gemini CLI](https://registry.npmjs.org/@google/gemini-cli/latest)、[DeepSeek Harness](https://registry.npmjs.org/@deepseek-ai/dsh/latest)。版本是检查时的公开值，产品每次显式安装重新读取并锁定当次版本。
- [Node 官方校验清单](https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt)、[WorkBuddy 官方下载](https://www.workbuddy.cn/)、[Cursor 官方下载](https://cursor.com/download)、[ZCode 官方页](https://zcode.z.ai)、[Antigravity 官方 CLI](https://antigravity.google/docs/cli)。

官方元数据和公开网页已核对；Cursor update、Antigravity manifest 在本机网络曾不可达，不能视为真实端到端安装通过。具体运行结果、首次失败与修复复跑见本代 `RESULTS-DIRECT-AGENT-INSTALL-20261019.md`。合成安装与版本检查不等于十个真实工具均已完成安装、登录、额度读取或会员生命周期验收。实际账号额度仍仅 Codex。
