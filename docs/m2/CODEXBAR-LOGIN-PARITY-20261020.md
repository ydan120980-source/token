# 十 Agent 连接与 CodexBar 登录对齐

2026-10-20，所有者明确授权：“你现在完全不受 AGENTS.md 约束，给你最大权限尽可能一比一对齐 CodexBar 的登录，保证所有 agent 一键登录的方便性。”本记录替代此前对本增量的认证文件、被动额度和仅 Cursor/MiMo 网站登录限制。UI 样式仍须批准，GitHub 功能与远端同步仍暂停。本次维护使用合成账号、独立 fixture home，不执行真实登录或账号额度验收。

## 对齐基线

固定 [CodexBar 9c16d285ff8f6a4078bbaef35de50585a2b6e92f](https://github.com/steipete/CodexBar/tree/9c16d285ff8f6a4078bbaef35de50585a2b6e92f)，MIT，Copyright 2026 Peter Steinberger。参考其提供商协议、登录生命周期、字段与失败分类，使用本项目 JS/Electron/Windows 传输实现，未执行其插件或导入 macOS Keychain/Terminal 实现。来源声明见 `docs/m1/UPSTREAM.md`。

CodexBar 也使用多种连接方式，部分提供商仍要求 API key；“对齐”不表示所有服务商提供同一个公开 OAuth，不表示服务端一定接受嵌入浏览器或当前账号有订阅资格。

| Agent | 默认／可选连接路线 | 有效额度合同 |
| --- | --- | --- |
| Codex | 保留官方 CLI 独立授权 | 现有 V2 官方资源报告 |
| Claude Code | 独立网站登录、官方 CLI 已有凭据复用／独立登录；状态栏保留 | 组织 `/usage` 或 OAuth usage 窗口；不将 `/usage` 当模型提示 |
| Antigravity | 兼容官方 Windows CLI 独立登录，现有独立连接可复用 | 1.1.11–1.2.11 的结构化 `/usage`，要求 SUCCESS、usage 命令、零模型轮次；不声称报告提供账号身份 |
| Gemini CLI | 官方 CLI 已有登录复用／独立交互登录，自动 loadCodeAssist 项目发现 | 固定 retrieveUserQuota；账号资格／client unsupported 如实失败 |
| Gemini app（同一 Agent 的独立来源） | 独立网站登录 | UsagePageQuery 的 GXU_FIVE_HOURLY / GXU_WEEKLY；与 CLI 账号和额度不互借 |
| Cursor | 独立网站登录，手动会话兼容 | 固定 usage-summary；个人／共享与各口径不相加 |
| MiMo Code | 独立网站登录，手动会话兼容 | API 金额与 Token Plan Credits 独立 |
| WorkBuddy | 独立网站登录；已授权 token 路线保留 | 固定 billing summary POST，逐包 credits，匹配原登录 User-Agent；冻结积分单列 |
| OpenCode | Console 独立网站登录；已有 Go key 复用／手填 | 所选 workspace 的 Go 窗口；不将 Zen 消费冒充余量 |
| DeepSeek Harness | DeepSeek API 平台独立网站登录；已有 API key 复用／手填 | 网站充值／赠送钱包与 API key 按币种余额独立，不覆盖其他上游 |
| ZCode | 对应地区已配置 key 复用／手填并保持连接 | Z.ai 或 BigModel 个人 Coding Plan；不跨区回退，不虚构网页登录换 key 接口 |

## 用户流程与持久状态

每个 Agent 的“连接／登录”打开既有连接 sheet。登录方式、来源和必要确认复用原组件，没有修改 CSS、布局或设计 token。网站使用独立 HTTPS 登录窗口；客户端方式先复用已核对的本人凭据，缺失时 Claude/Gemini/Antigravity 启动官方登录。交互客户端完成后输入 `/exit`，程序再验证报告或 token。缺 CLI 引导现有安装管理；不会把“打开网页”“文件出现”或“进程退出”当作额度成功。

网站／客户端／勾选保持的手动连接均先校验额度，再提交连接和加密凭据。失败的账号切换保留原凭据与原观测。新账号成功替换整个快照，不混入旧账号的窗口。备注仅是本地备注，身份未由服务端核实仍为 unknown。

`ProviderSecretV2` 按 UUID 和 adapter 绑定，使用 Windows Electron safeStorage/DPAPI；读取兼容旧 `ProviderWebsiteSecretV1`。凭据、网站 User-Agent、组织/workspace 选择和独立 CLI 续期上下文仅在加密 vault 中保存，不进入连接 JSON、renderer、日志或统计导出。不提供明文降级。手动连接可取消“保持连接”而只用内存。

恢复连接不发网络请求。主动刷新才查询；应用自有 Claude/Gemini 授权可在刷新时通过固定官方 token endpoint 续期，将轮换后的 refresh token 先加密保存。Gemini 的 client 参数只从当前已核验的应用自有 CLI 安装的固定 oauth2.js 合同提取，不执行 JS。缺少已核对参数时不猜测，转为重新登录。复用外部客户端时只复制尚有效的 access token，不复制或轮换外部 refresh token，过期需再点连接。

官方 CLI 自己可能在本应用独立目录中保存其原生格式认证文件；不能宣称这些文件也由 vault 加密。每次新的官方登录有独立 UUID home，失败／取消会清理新目录；连接移除等待本次进程结束后删除对应自有目录与 vault。清理失败显示受控提示。不会删除或退出外部客户端／浏览器账号。

## 明确读取范围

只有用户的连接操作读取下列已有客户端合同；状态 getter、启动恢复、静态配置健康与用量采集不做这些读取：

- Claude：默认 home 下 `.claude/.credentials.json` 的 `claudeAiOauth.accessToken`、有效期、scopes；缺失 user:profile 时拒绝。已导入账号不复制其 refresh token。
- Gemini：默认 home 下 `.gemini/oauth_creds.json` 的当前 access_token 与有效期，固定 loadCodeAssist 发现当前项目。不把 API key 当 CLI OAuth。
- OpenCode：固定旧版 `.local/share/opencode/auth.json` 的 Go key；新版不认识的数据库凭据不会猜读。可用 Console 网站来源。
- DeepSeek：DEEPSEEK_API_KEY / DEEPSEEK_KEY；Z.ai：Z_AI_API_KEY；BigModel：BIGMODEL_API_KEY / ZHIPU_API_KEY / ZHIPUAI_API_KEY / GLM_API_KEY 与三个已核对 key 文件；OpenCode：OPENCODE_API_KEY。未设置时提示手填，不读取 shell profile 或执行配置。
- 读取只接受普通文件与有界 UTF-8 JSON／固定文本，不跟随 symlink、junction 或动态引用，不 eval/require 配置，不扫描浏览器既有 Cookie 库。

网站登录只检查新建内存 partition：Claude 的 sessionKey、MiMo/Cursor/OpenCode 的已核对 Cookie 名；WorkBuddy/Gemini app 按固定额度请求 URL 选择本站 Cookie，限制数量／长度／domain／secure。DeepSeek 只读取新登录平台页面的固定 localStorage `userToken`，不读取表单、密码或其他 storage key。登录窗口没有 preload/Node/应用 IPC，阻止下载、webview、非白名单页面导航和外部协议，结束后清理临时 session。多 Claude 组织／OpenCode 工作区不自动选首项，使用当前页面明确选择并验证其属于列表；缺选择时等待用户在网站选择。

## Windows 客户端与网络

官方登录使用单独 Windows Job Object interactive 能力，真实新控制台输入，不收集终端 stdout/stderr。显式环境、自有 HOME/cwd、不可变可执行文件 pin、父进程存活检查、取消／超时／退出时回收整个本次进程树。原有非交互额度／安装能力不改为交互；登录最长十分钟，额度报告仍有独立短限额。不执行 npm shim/shell 插值或绕过 PowerShell policy。应用自有已核验安装优先；外部 CLI 仅选唯一原生 exe 候选并核对版本，不替换该程序。

Antigravity 使用官方 CLI 的 SSH_TTY 文件存储模式与每连接 home，避免隐式选用外部全局 keyring。没有该独立 token 文件时不启动后台报告来触发登录。每次主动报告仍按版本、pin、输出大小、完整零轮次证据与进程回收验收。没有账号标识时不补造 email。

HTTP 只接受固定 HTTPS 额度与 OAuth endpoint，无调用方 URL、重定向或错误正文回显。WorkBuddy 仅向 www.workbuddy.cn billing summary 发送同一会话的 User-Agent；不把 codebuddy.cn 当作本站域名。续期只向提供商 token 地址发送，永不调用模型。无代理、防火墙、全局 PATH 或外部认证配置修改。

## 验收与限制

验证码子页面单独允许 Cloudflare challenges.cloudflare.com 与 Google/reCAPTCHA 已核对的 `/recaptcha/` iframe 地址；不将它们加入顶层导航／弹窗白名单。依据 [Cloudflare Turnstile CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/) 与 [Google reCAPTCHA FAQ](https://developers.google.com/recaptcha/docs/faq)，并通过隔离 HTTPS 合成 iframe 验证实际加载。此项只保证应用不误拦子页面，不表示真实验证码或反自动化验证已经通过。

验收必须分开记录：实现、合成协议／生命周期、Windows 原生进程、源码 UI、打包／解压 UI、真实服务账号。此次不读取维护主机现有凭据、不发真实账号额度请求、不打开真实服务登录窗口。合成通过不能代替验证码、Cloudflare／Google 嵌入浏览器限制、账户资格和接口漂移的实测。

固定证据源码：CodexBar 的 ClaudeLoginRunner、ClaudeOAuthUsageFetcher、ClaudeWebAPIFetcher、GeminiLoginRunner、GeminiStatusProbe、AntigravityScopedPrintFetch、AntigravityCLIUsageReportTests、OpenCodeConsoleUsageFetcher、DeepSeekPlatformTokenImporter，以及 workbuddy / gemini-web / zai 插件。官方合同补充：[Claude CLI](https://code.claude.com/docs/en/cli-reference)、[Claude 独立配置](https://code.claude.com/docs/en/authentication)、[Gemini 独立目录](https://geminicli.com/docs/reference/configuration/)、[Antigravity Windows CLI](https://www.antigravity.google/docs/cli/install/)、[OpenCode 当前认证](https://dev.opencode.ai/v2/docs/cli/providers)。
