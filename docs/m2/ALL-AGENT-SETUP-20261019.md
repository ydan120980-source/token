# 全 Agent 安装与故障恢复引导（2026-10-19）

## 决定与产品行为

所有者要求“所有 agent 都做这一套安装与故障恢复引导，做完后打包验收”，并明确选择由本会话补现有页面最小可用入口，Claude 后续美化。本轮覆盖 agent-catalog 中十个内置来源，个人 JSONL/NDJSON 来源另提供规则及路径排查。第三方仅目录发现但暂不支持的 Agent 不被提升为支持来源，未启动配置健康、MCP 或其他 Backlog。

来源管理和额度页每个支持来源都有“安装与故障恢复”。沿用现有 inspector sheet，显示程序入口、用量诊断、账号额度能力和官方步骤；不新增独立页面。打开引导只读取保存事实，显式点击“重新扫描”才检查 PATH/固定安装位置的文件元数据。安装指南、复制命令、发现文件均不证明安装/登录/额度成功。

没有执行安装器、远程脚本或发现的程序，没有自动登录、改 PATH/策略/权限、读取认证/配置、扫描 WSL、请求其他 Agent 额度或重试模型调用。Codex 仍是唯一 live quota；Antigravity 保留上一轮无模型调用协议的独立复核门槛及旧 API，不因安装引导启用真实采集。

## 官方依据与各自限制

2026-10-19 实际打开以下官方来源，安装命令由主进程固定；UI 不传 URL 或命令。指南随官方更新可能变化，程序不下载动态执行脚本。

| Agent | 官方依据 | 本轮引导与限制 |
| --- | --- | --- |
| Codex | [CLI](https://learn.chatgpt.com/docs/codex/cli) | 提供官方安装及登录说明入口。文档的不同平台选项不能凭 macOS 示例推断 Windows 命令，故本轮不提供未经核对的复制命令；额度读取仍需额度页选定官方 codex.exe |
| Claude Code | [安装](https://code.claude.com/docs/en/setup)、[故障排查](https://code.claude.com/docs/en/troubleshooting) | 官方 Windows PowerShell 原生安装命令；本地 assistant 用量不等于会员额度 |
| OpenCode | [安装](https://opencode.ai/docs/)、[故障排查](https://opencode.ai/docs/troubleshooting/) | Windows npm 选项 `npm install -g opencode-ai`；官方推荐 WSL 不意味着本应用扫描 WSL |
| WorkBuddy | [Windows 安装及登录](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Win-Guide) | 桌面安装引导，无臆造 CLI；token 和积分分开，未接入积分余额 |
| MiMo Code | [官方安装、授权与 Windows FAQ](https://mimo.mi.com/docs/zh-CN/tokenplan/integration/mimo-code) | Windows npm 选项 `npm install -g @mimo-ai/cli`、Node.js 18+；不采用仓库另一条含执行策略 Bypass 的命令；余额和 Token Plan 由用户在官方端检查 |
| Gemini CLI | [安装](https://geminicli.com/docs/get-started/installation/)、[故障排查](https://geminicli.com/docs/resources/troubleshooting/) | `npm install -g @google/gemini-cli`、Node.js 20+，系统要求见官方说明；本地 chats 不等于账号额度 |
| Cursor | [下载](https://cursor.com/download)、[SDK](https://cursor.com/docs/sdk/typescript) | 桌面下载；明确普通聊天未必提供可计量数据，仅接 SDK 或合规逐请求导出 |
| ZCode | [官方文档](https://zcode.z.ai/en/docs/welcome) | 官方安装/更新说明，不推测 CLI 安装命令；本地 model_usage 和账号额度分开 |
| DeepSeek Harness | [官方仓库](https://github.com/deepseek-ai/deepseek-harness)、[使用指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.md) | 官方 npx 示例会运行 Web 服务，不能伪装为仅安装命令，因此只开指南；仅既有 v2–v4 日志支持 |
| Antigravity | [安装](https://antigravity.google/docs/getting-started)、[排查](https://antigravity.google/docs/cli/troubleshooting/) | 沿用既有扫描/版本/协议恢复合同，桌面用量与 CLI /usage 分开；模型额度、积分、会员到期不按 token 推算 |

只有完整扫描未发现入口、且保存事实没有已有用量观测或停用读取时，通用引导才提供已核对的安装命令复制；复制前再次扫描，发现文件/权限失败/不完整会撤回旧建议。其他状态仍可打开官方安装说明。安装和授权在用户自己的终端/官方应用完成，本程序没有执行命令的接口。

## 后端与 UI 合同

`usageBridge.agentSetup(agent)` → `{ok:true,state:AgentSetupV1}`。仅接已知内置 Agent 或运行时注册的 custom UUID，不接受任意路径/品牌/错误。状态含 `agent/name/revision/reason/title/steps`、`usage`、`providerNote`、`quotaDescription`、`runtime/checkedAt`、`installation/actions/notice`。无 I/O；保存事实变化使 revision 更新。

`usageBridge.agentSetupAction({agent,actionId,revision})` → `{ok:true,outcome,state}` 或 `{ok:false,errorCode,message,state}`。拒绝额外字段与参数，检查主窗口及主 frame，动作仅固定的 `installation-guide` / `troubleshooting-guide` / `copy-install-command` / `rescan`；Antigravity 可按原合同提供认证指南。返回新的 state 完整替换显示。过期/并发/不可用/扫描/复制/浏览器失败分别返回固定代码和中文反馈；原始异常不进 UI。个人来源没有 installer/外链/扫描动作，提供编辑规则和已有来源设置入口。

运行时扫描是 `AgentRuntimeDiscoveryV1`：Windows 的 PATH、固定 home/APPDATA/npm、scoop shim 和部分常见桌面目录，128 个目录、1024 个文件元数据及 2 秒响应预算。只对固定文件名 lstat，不读取内容/枚举未知目录/执行程序；.cmd/.ps1 和链接只报未核验的入口。UNC/相对路径/未知环境变量跳过，受限或拒绝访问保持 incomplete。Antigravity 继续使用其更严格独立扫描器。扫描结果是有限范围证据，找不到不等于整机未安装。

源诊断使用保存的 enabled、status、错误码，按已知规则说明写入中/权限/超时/格式/冲突/未报告字段/CSV 模式/未来版本等问题，未知错误不泄露原文。Codex 额度仅投影固定错误提示，不返回 alias、账号 ID 或凭据。运行时结果不能覆盖用量历史；会员状态未知时不推断过期、补零或刷新余额。

## 验证方式与交付

CodeGraph 工具未提供，定向复核 catalog → metadata scanner → setup controller → main/preload → existing sheet，并以固定目标和副作用测试覆盖。Browser 插件及 browser 技能未提供，沿用项目 Electron Playwright；渲染验证使用 frontend-testing-debugging 技能，流程为来源/额度入口 → 引导 → 显式扫描 → 固定动作反馈 → 窄窗暗色。所有测试使用隔离合成 usage/quota/home，浏览器与剪贴板使用替身。

本轮进行正式 Windows 打包验收，结果记录单列 [交付验收](RESULTS-ALL-AGENT-SETUP-20261019.md)，区分首轮失败与复跑、源码与打包版、真实账号与合成验证。用户检查是最终人工验收，不提前代用户确认通过。
