# Codex 安装故障与 Claude 独立治理（2026-10-19）

所有者报告安装/升级异常，要求单独核对 Claude 的网络治理，并提供既有治理工作区。读其 README、ARCHITECTURE 和启动包装/策略代码后，所有者明确选择“沿现有受控路径原地升级，先备份并支持回滚，不改代理与防火墙规则”。这是一项针对现有受控 Claude 原生程序的授权例外；不允许任意外部路径、配置修改或安装脚本。

## 已确认的原因

1. 实际 Codex npm 日志显示：主包安装 exit 0，但 `@openai/codex-win32-x64` 可选依赖失败并被移除。只装好 JS 包装器不是装好 Codex。旧实现虽会通过 `--version` 阻止错误启用，却把长时间下载与缺二进制统一呈现为“正在安装/进程失败”。
2. 当前官方 Codex 0.163.0 原生 exe 为 341,270,320 字节，超过旧 256 MiB 指纹上限；Claude 2.1.303 原生包展开也超过该上限。保持流式哈希、重解析点拒绝和不可变 pin 核验，将有限上限提高到 512 MiB。
3. Windows PE 版本 `2.1.285.0` 与 CLI 输出 `2.1.285` 等价。Claude PE 的末尾零进行规范化；版本探测按既有版本比较语义处理缺省的零，不把可运行的 Claude 误判损坏。

## Codex 原生安装

从官方主包读取当次版本，再读取精确 `@openai/codex@{version}-win32-{arch}` 平台元数据，验证包名、版本、OS/CPU、官方 HTTPS tarball 地址和 SHA-512 SRI。原生包是必需项，不再让 npm 以 optional failure 的形式吞掉二进制下载错误。保留旧 JS 代次的读取兼容，新安装启用原生 exe。

下载报告字节数/总量，最多三次尝试。恢复请求校验 Content-Range 起点，服务端忽略 Range 时只重写本次应用所有的 partial 文件；最终哈希覆盖完整前缀和新数据。下载、大小、超时和取消均有界；断点不豁免完整性校验。

验证后流式展开 gzip/tar，限制条目与总大小，检查 tar 头校验和，仅接收 `package/` 下普通文件/目录；拒绝链接、设备、穿越、ADS、Windows 保留名和不支持的扩展头。整个官方 vendor 目录保留，成功执行原生 `--version` 才切换应用内 active。无全局 PATH 改动。

## Claude 治理合同

当前识别的配置名为 `ClaudeNetworkPolicy`：既有 CLI 固定在 `%APPDATA%/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe`，专用 HTTP CONNECT 入口为 `127.0.0.1:17898`。预检使用 Windows 元数据确认：全防火墙 Profile 开启、该原路径有启用的出站 Any 阻断规则、监听仅 loopback 且所有者为 verge-mihomo。不得以“查不到规则”自动绕过已记录的治理要求。

这不等于实时住宅 IP 或任意工具树隔离验收；这些由原治理系统负责。本程序不读取其控制器凭据，也不执行 apply/restore、防火墙修改或启动包装脚本。规则与启动包装沿原样使用。

识别治理后，安装元数据和包下载全部通过专用 CONNECT，TLS 证书验证保持开启，没有 DIRECT 或普通代理降级。未治理的普通 Claude 安装仍走独立应用目录。受控路线必须先检查并显示出来，由明确的“受控升级”动作确认，初次误点普通安装只提示并检查，不覆盖已有程序。

受控升级只替换固定的原生 exe，不修改 npm 包装器元数据、Agent 配置或数据库。实际版本取原生 PE/运行结果；不以可能滞后的 npm package.json 取代实际版本。先把旧 exe 和哈希备份到应用目录，写入恢复记录；原路径旁暂存已验证新文件，Windows ReplaceFile 原子替换并保留目标安全属性。新程序在原防火墙覆盖路径中、隔离 HOME 和指定代理环境下执行 `--version`；不得从尚未被治理的暂存位置启动 Claude。

复检失败按原哈希恢复旧文件并复检。目标已被其他更新改变时拒绝覆盖；恢复无法确认则停止队列并保留记录。替换后的有限验证/恢复阶段完成前不强行中断，晚到取消不会把已经确认完成的安装误报成“旧版本仍启用”。

“回滚上一版本”只接受本应用本地保存且哈希核验的备份、原路径和当前版本，复检通过才报告回滚成功；它不能写任意程序。更新会使先前 PE/路径预检缓存失效，避免同一次引擎复检拿旧版本比较新文件。

## 实测与来源

实际 Codex 已安装到应用内目录并通过 0.163.0 原生版本检查。实际 Claude 从 2.1.285 原路径升级到 2.1.303，通过版本检查；真实回滚到 2.1.285 后再次升级到 2.1.303 的往返也通过，原始备份保留。治理工作区四个说明/启动/策略文件在该往返前后哈希一致，未进行代理/防火墙写入、登录、模型或额度请求。

初次实际替换遇到 Win32 code 3：PowerShell 将 string `$null` 转成空字符串，导致 ReplaceFile 误收 backup 路径。改用 `IntPtr.Zero`，补充实际 Windows 文件替换测试并复跑通过。原程序在失败时保持原字节。完整验收与交付见 [本代 RESULTS 记录](RESULTS-INSTALLER-RECOVERY-20261019.md)。

官方依据：[Codex CLI](https://learn.chatgpt.com/docs/codex/cli)、[官方 Codex npm 元数据](https://registry.npmjs.org/@openai/codex/latest)、[官方 Claude npm 元数据](https://registry.npmjs.org/@anthropic-ai/claude-code/latest)。版本按请求时锁定，不保证未来版本及接口永久相同。没有新增账号额度能力。
