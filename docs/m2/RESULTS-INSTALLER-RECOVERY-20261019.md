# Codex 安装修复与 Claude 受控升级验收（2026-10-19）

实现提交：`472eccb`。合同与故障原因见 [INSTALLER-RECOVERY-20261019.md](INSTALLER-RECOVERY-20261019.md)。所有者已明确授权沿现有固定受控 Claude 路径原地升级、先备份并支持回滚，保留代理和防火墙规则。本轮不扩展账号、来源或 GitHub 范围。

## 实际安装验收

- Codex 官方原生平台包完整下载并核验 SHA-512，安装到实际应用管理目录；原生程序 `--version` 为 **0.163.0**，可运行。已有外部 Codex 未被覆盖。
- Claude 官方原生平台包全部经现有专用 `127.0.0.1:17898` CONNECT 下载，保留 TLS 校验和 SHA-512 校验。只沿原有 `%APPDATA%/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe` 替换程序。
- 实际 Claude 升级到 **2.1.303** 通过复检；随后真实回滚到 **2.1.285**，再次升级到 **2.1.303**，均通过原路径版本复检，原始备份仍有效。治理工作区选定四个说明/启动/策略文件往返前后哈希一致，未执行任何代理、防火墙或配置写入。
- 实际打包程序加载 ASAR 后独立复检：Codex 0.163.0、Claude 2.1.303 均可运行，Claude 的可回滚备份有效。
- 未登录、未读认证文件、未调用模型或额度接口。`--version` 与 Windows 元数据预检不等于账号连接、住宅出口 IP 或任意工具进程树隔离验收。

## 检查与回归

- `npm run verify` 最终 `fail 0`；`audit:runtime` 通过。
- `test:native`、`test:stress`、`experiment:crypto` 通过；均使用独立合成数据，未运行 `validate:local`。
- 合成/Windows 测试覆盖原生包必需项、断点 Range 与完整前缀哈希、服务端忽略 Range、受限重试、归档穿越/链接/大小拒绝、固定 CONNECT/TLS 与拒绝直连降级、固定目标备份/回滚、版本等价、失败恢复和更新后预检缓存失效。
- 实际 Windows 自有文件测试验证 ReplaceFile 的原生 NULL 参数与替换结果；未借测试覆盖其他软件。
- 受影响源码 `agent-install-ui-test.js` 的 100%、125%、150% 缩放通过；`agent-ui-test.js` 通过，并新增展开后立即重绘仍保持展开的回归断言。
- 最终 `dist:win:dir` 与 `audit:package` 通过；最终打包 worker/helper 通过。包内产品源码与资源、解包的 PS/C# helpers 均通过审计。
- 打包程序压缩后解压到中文和空格路径，87 个文件全部逐字节相同。
- 最终 `scripts/m1/*-ui-test.js` 全部 **28 个套件通过，无失败**。随后在逐字节核对过的 `artifacts/installer-recovery-20261019/验收 修复最终版/解压 程序` 上执行 `agent-recovery-ui-test.js` 通过：实际启动合成采集，OpenCode/MiMo 两种先归属顺序、100%/150% 缩放、来源文件哈希不变均通过。

## 本轮失败及修复

1. 实际 Codex 官方原生 exe 为 341,270,320 字节，旧 256 MiB 指纹上限拒绝它；改为有界 512 MiB 并保留流式哈希后，实际安装与版本复检通过。
2. 实际 Claude PE 版本的末尾 `.0` 曾被当作 CLI 版本不匹配；按现有版本比较语义规范化，实际复检通过。
3. 初次真实 ReplaceFile 返回 Win32 code 3：PowerShell string `$null` 被封送为空备份文件名。改为 `IntPtr.Zero` 并补充 Windows 文件测试后，真实升级/回滚往返通过；失败时旧文件字节保持。
4. 同一引擎更新后的复检缓存保留旧 PE 版本，曾误报损坏；替换后失效缓存，实际同引擎复检和回归测试通过。
5. 初次打包 `agent-ui-test.js` 暴露来源详情的展开状态与异步重绘竞争，路径按钮被收起。改为在 summary 点击时同步保存意图，增加立即重绘断言；源码和最终打包对应套件复跑通过。初次候选保留，交付只引用修复后的最终目录。

CodeGraph 不可用，本轮使用当前源码、定向调用路径、测试与实际打包进程核验。没有委派子 Agent。

## 交付与范围

交付目录：`dist/installer-recovery-20261019-final`。前代和本轮初次候选保留；本代没有执行跨代硬链接共享。

源码归档逐条字节核对、本地合入提交、目录树哈希与全部验收结果写入随包 `AgentUsage-CodexQuota-delivery.json`。本地合入使用干净共享 main、合作锁与 `--no-ff`；远端同步继续暂停，不 push、不创建 PR。

完整实机安装/回滚仅覆盖本轮 Codex 与上述 Claude 版本；其余 Agent 没有新增全量实机安装、桌面向导或会员过期验收。账号额度仍仅 Codex。治理预检只适配当前已核对的固定 Claude 路径/规则组/入口，未知治理不应自动套用。

用户交互验收待所有者打开最终版本检查。必须先完全退出旧版程序，再运行本代 `win-unpacked/Agent Usage Quota.exe`，避免单实例机制只激活旧版窗口。点击“检查版本与更新”可刷新实际版本，Claude 应显示原路径受控路线及备份回滚入口。

证据目录：`artifacts/installer-recovery-20261019/`。关键记录：`verify-final-source-state.log`、`runtime-final.log`、`native.log`、`stress.log`、`crypto.log`、`agent-source-ui.log`、`installer-ui-final.log`、`build-final.log`、`package-audit-final.log`、`packaged-helper-final.log`、`packaged-worker-final.log`、`real-codex-result.json`、`real-claude-roundtrip-result.json`、`packaged-real-cli-final.log`、`packaged-ui/status.json`、`extracted-byte-check.json`。
