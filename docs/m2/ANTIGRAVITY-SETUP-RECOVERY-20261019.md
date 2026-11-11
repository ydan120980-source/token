# Antigravity CLI 安装引导与读取恢复（2026-10-19）

## 所有者决定及范围

所有者要求：没有 CLI 或无法读取 `/usage` 时，加入安装功能或引导用户解决的功能。选择本轮交付官方安装引导与恢复动作的后端，renderer 继续由 Claude 接入。自动路径发现沿用 [自动发现合同](ANTIGRAVITY-AUTO-DISCOVERY-20261019.md)，不要求用户填写完整 `.exe` 路径。

这是已接主进程和 preload 的产品接口，不只是说明文档。主进程提供固定官方链接、固定 PowerShell 安装命令的复制与再次扫描，按事实返回下一步。没有执行远程安装脚本、下载或安装 CLI 二进制、修改 PATH/执行策略、提权、登录、读取认证/配置、重试 `/usage` 或开启后台轮询。当前 live quota 能力仍是 Codex-only。

## 官方依据及限制

2026-10-19 核对 [官方 Quickstart](https://antigravity.google/docs/getting-started)、[认证指南](https://antigravity.google/docs/install?tab=cli)、[CLI 故障排查](https://antigravity.google/docs/cli/troubleshooting/)，只读获取公开安装脚本，未执行。官方 Windows 安装命令为 `irm https://antigravity.google/cli/install.ps1 | iex`，默认目录 `%LOCALAPPDATA%\agy\bin`。应用只在用户请求时复制该固定文本，由用户在自己的 PowerShell 决定执行。

公开脚本按平台下载当前 manifest/二进制、核对 SHA-512、复制并执行 native install；已有文件与部分 native setup 失败也可能返回成功。因此命令复制、指南打开、安装器退出成功、文件存在、文件可信、版本兼容、已登录、额度可读是不同的事实，不能合并成“安装成功”。官方当前版本也可能超过适配器复核上限；不能为了适配旧解析器推荐用户降级。

只读脚本副本在忽略目录 `artifacts/antigravity-setup-recovery-20261019/public-install.ps1`，SHA-256 `51c2cb4fada22ce0228da71b9506370383d6544bfebcec85fe7616a52b805344`，用于本次研究证据，不被产品导入、打包或执行。脚本随官方更新可能变化，此散列不代表安装器的永久信任或发行认证。

## Claude 接入接口

| 方法 | 返回与作用 |
| --- | --- |
| `quotaBridge.antigravitySetup()` | `{ok:true,state:AntigravitySetupV1}`；只读内存，无参数，不扫描、不启动进程、不写文件 |
| `quotaBridge.discoverAntigravity()` | 原有元数据发现接口；现在与引导共用扫描控制器，成功/失败都会更新引导 revision |
| `quotaBridge.antigravitySetupAction({actionId,revision})` | 一次显式用户动作；仅接受这两个字段，revision 必须来自最新 state |

`AntigravitySetupV1` 提供 `reason/title/steps`、`checkedAt`、`lastDiscovery`、`cliVersion`、已复核版本上下界、`installation`、`actions`、`quota` 和 `notice`。`lastDiscovery` 仅本地使用，含候选路径，不得随报错上传或对外导出。初始 `scan-required` 表示尚未扫描；打开页面可以展示“检查 CLI”动作，由显式扫描进入实际状态。`quota.liveEnabled=false/ready=false/verificationRequired=true` 不因扫描、复制或浏览器打开而改变。

| actionId | 允许状态 | 实际效果与成功 outcome |
| --- | --- | --- |
| `installation-guide` | 缺少 CLI、只有桌面版、版本过低 | 打开固定官方 Quickstart，`guide-opened` |
| `copy-install-command` | 完整扫描未发现 CLI 或只有桌面版 | 复制固定官方命令，`command-copied` |
| `authentication-guide` | 可信后端探测报告通用请求失败 | 打开固定官方认证说明，`guide-opened`；不开始 OAuth |
| `troubleshooting-guide` | 所有状态 | 打开固定官方故障排查说明，`guide-opened` |
| `rescan` | 所有状态 | 仅元数据重扫，`metadata-rescanned`；不是重试 `/usage` |

UI 使用 `state.actions` 渲染可用按钮，不自行根据字符串拼命令、URL 或可执行文件路径。`installation.command` 仅缺少 CLI 时存在，配套显示 shell、默认目录和 notice；显示完整步骤，特别是当前最新版可能尚未被适配器复核。结果只提示“命令已复制／指南已打开／扫描已完成”，不提示“已安装／已登录／额度正常”。打开指南仅确认系统浏览器 API 接受请求，不证明远端页面加载成功。

动作返回 `{ok:true,outcome,state}` 或 `{ok:false,errorCode,message,state}`。失败 `message` 是固定中文反馈，不含原始异常；状态总以返回值替换。`AGY_SETUP_STALE` 要求重新获取引导后再让用户操作；`ACTION_UNAVAILABLE` 表示状态变化使旧操作失效；`BUSY` 等待当前动作结果；`COPY_FAILED/GUIDE_FAILED/SCAN_FAILED` 分别对应复制、打开浏览器和扫描失败。参数错误是 `AGY_SETUP_ARGUMENTS_REJECTED`。IPC 参数数量错误可返回 `state:null`，此时重新获取状态。调用方不得传 URL、命令、路径、errorCode、原始输出或登录信息。

### 状态与恢复逻辑

| reason | 含义及处理 |
| --- | --- |
| `scan-required` | 还未扫描，先检查安装位置 |
| `cli-missing` / `desktop-only` | 在有界完整扫描范围缺少独立 CLI；提供官方安装引导 |
| `launcher-only` | 只发现 .cmd/.ps1，说明需要 agy.exe，不执行脚本 |
| `scan-incomplete` / `scan-failed` | 无法判断缺失，不建议重复安装；保留最后成功发现结果和时间供参考 |
| `multiple-candidates` / `candidate-rejected` | 说明多版本或路径问题，不猜账号、不删除、不覆盖文件 |
| `platform-unsupported` | 当前 Windows 入口不扫描 WSL |
| `verification-required` | 已发现唯一路径，仍需独立文件及版本核验，不能直接宣告可读额度 |
| `version-too-old` | 明确低于最低版本，提供官方更新指南；不复制覆盖安装命令 |
| `version-unreviewed` | 高于复核上限，等待适配器更新，不要求降级或重装 |
| `version-unrecognized` | 版本无法识别或兼容性判定不一致，等待核对 |
| `request-failed` | 通用请求失败；提供登录与故障排查指南，可能涉及网络、权限、服务限制，不断言具体根因 |
| `timeout` / `canceled` | 保留已有数据，不自动恢复或重试请求 |
| `protocol-invalid` / `output-limit` | 需要核对输出协议或限制，不放宽边界、不收集完整私有输出 |
| `model-turn-detected` / `no-turn-unverified` | 停止发布额度，待复核无模型调用约定，不自动重试 |
| `cleanup-unconfirmed` | 清理未确认，先排查残留进程与应用环境，不自动重试或覆盖安装 |
| `binary-changed` / `host-unavailable` / `runtime-required` | 重新发现、核验程序或排查运行环境；不自动提权、改策略 |

`recordProbeFailure(result,expectedRevision)` 是控制器的后端接口，未暴露 IPC，也尚未连接真实 CLI 采集。它只接受当前唯一候选及同一 revision 的可信失败结果，保存白名单错误码与严格版本，丢弃 stdout/stderr/账号/额度字段。重新扫描会清除旧探测结论；扫描期间不能提交旧结论。现有探测器无法可靠细分登录、权限、限流、网络或会员过期，通用失败必须保留未知。不得根据此接口填额度 0、计算会员到期后的额度或添加推测性错误分类。

## 执行与失败边界

扫描并发合并，发现接口与恢复动作共享结果。缺少 CLI 的安装建议在复制/打开前再次扫描；新出现的候选、扫描不全或多候选会撤回安装动作，避免过期界面引导重复安装。旧版本更新指南仍可打开，不会因重扫清除版本结论而失效。相同动作并发只执行一次，其余返回 busy。状态读取使用独立副本，不能被 renderer 修改；失败不写额度缓存或用量账本。

主窗口与主 frame sender guard 延续现有边界。主进程固定目的地和命令，拒绝多余参数，不提供 shell/任意外链/安装器/登录入口。测试只替换系统浏览器与剪贴板动作，没有真正打开浏览器或改变系统剪贴板。无 CodeGraph 工具，使用定向源码、真实 preload/IPC 与运行时审计复核调用链。

## 验收与后续

详见 [本轮结果](RESULTS-ANTIGRAVITY-SETUP-RECOVERY-20261019.md)。本轮交付后端引导与合成验证；新 renderer 尚未由 Claude 接入。真实安装、真实登录、真实 `--version` 与 `/usage`、会员状态、打包版未验收。上一轮本机 desktop-only 是历史扫描结果，本轮没有新扫描真实安装目录，也不能宣称本机状态未变化。
