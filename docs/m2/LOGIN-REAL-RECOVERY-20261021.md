# 真实登录失败修复决定（2026-10-21）

所有者提供 OpenCode、WorkBuddy、Antigravity、ZCode、DeepSeek 的失败截图，要求继续修复。已确认当前运行的是 `client-login-20261021`，合成 UI 验收没有覆盖真实辅助与网络边界，不能把上一轮通过解释为真实账号可用。继续使用日常 Chrome，不修改 CSS／布局／tokens，不读取现有浏览器 profile／Cookie、不安装扩展，GitHub 写操作暂停，主线程实施。

WorkBuddy 5.7.7：固定当前认证文件存在，腾讯签名有效，安装元数据与原生 build-key getter 单独验证均可用。真实失败来自 Windows PowerShell 5 对多候选 JSON 数组的嵌套处理，以及中文错误输出与严格 UTF-8 解码不一致。显式展开候选并设置目标 PowerShell 的 UTF-8 输出；保持签名、映像 hash、Job Object、超时和解密完整性检查。修复后当前客户端凭据读取成功，并对刚才失败的同一当前连接补做一次只读积分接口验证，返回可识别资源包。原始凭据、build key、账号标识和余额没有输出／保存到诊断；不修改官方认证文件、不轮换外部 refresh token。覆盖仍为第一页，标为不完整。

ZCode：原来的设备授权直接运行在调用 `disableNetwork` 的主进程，导致 Chrome 打开前被禁止网络。新增专用设备授权 IPC 子进程，由它发起固定 HTTPS 初始化／轮询，主进程只核对并打开 Chrome 白名单 URL；取消／断连／超时会终止等待，不向主进程解除网络限制。合成验证必须执行真实 fork 边界，不再仅用替换 `clientLogin` 的 UI 夹具证明此路线。

Antigravity：应用管理的真实 CLI 为 1.4.2，旧门槛上限 1.2.11，错误提示“请更新”也不适用于较新版本。核对官方 [CHANGELOG](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md)、本机隔离 home 的 `--version` 与 `--help` 后，把核对上限扩展至 1.4.2，保留上限、固定 `/usage` 命令与零模型 turn 证明。帮助文本在 stderr，未把空 stdout 当作没有命令。没有启动实际账号登录、额度命令、桌面守护进程或系统凭据库扫描。

所有者明确 OpenCode 使用 Console／Zen 按量计费，不能用 Go 订阅代替。新增 `opencode-zen` 显式来源并优先显示：通过固定 Console 设备授权，在 Chrome 登录后自动接收本次 access／refresh grant；仅访问固定授权初始化／token、必要时组织列表及余额接口。不复制已有浏览器、外部 refresh token、模型或远程配置。所选组织从服务端授权确定；不擅自选多个组织之一。只续期本应用创建并加密保存的 grant，组织发生变化拒绝更新旧连接。Go key 与旧网站 Go 约束来源继续单独保留。

OpenCode 设备协议依据官方 [anomalyco/opencode 4d5965762ec5e0d1a0b14630553fc62b51a11fba](https://github.com/anomalyco/opencode/blob/4d5965762ec5e0d1a0b14630553fc62b51a11fba/packages/core/src/plugin/provider/opencode.ts) 的固定 `opencode-cli` 公共 device client 与 `supports_org_scope`，不是自建 OAuth broker。按量余额依据 [Console 读取路线](https://github.com/slkiser/opencode-quota/blob/main/src/lib/opencode-zen.ts) 与 [CodexBar OpenCode](https://github.com/steipete/CodexBar/blob/main/docs/opencode.md)：只读 `console/api/billing/status` 的 `balanceMicroCents`，精确除以 100,000,000 转 USD，不用 `availableMicroCents` 代替，不推算 Go、月预算或到期日。负余额作为待结清金额而非可用余额。缺失或接口失败仍为未知。

API key 来源明确命名为“复用本机已配置的 API key”；找不到 key 会转入本地输入并保留错误码，不伪装官方登录或诱导反复点击。DeepSeek API 平台与聊天网站账号不同，实际账号类型待所有者说明，不能把聊天登录当作 API key。既有手动来源及加密连接兼容。

公开源码只做静态核对，未安装或执行引用项目。新增维护验收仍使用独立合成 home／usage／quota；真实验证与合成测试单独记录，后续真实登录只在可见应用的明确动作中进行，秘密不进入聊天。
