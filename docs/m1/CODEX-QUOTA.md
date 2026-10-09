# Codex 账号额度功能

2026-10-03 用户追加授权：支持登录不同 agent 账号、用量额度与更新时间。用户随后选择 **首批只接 Codex，跑通后逐个扩展**。这条授权只覆盖 Windows Codex 账号连接与额度，不授权云服务、iOS、账号切换、消费额度重置或读取既有认证文件。

## 启动与使用

源代码运行：`npm.cmd start`（`start:quota` 为兼容别名）。唯一 Electron 入口是 `src/quota/main.js`，额度数据仍在 `%APPDATA%\AgentUsage-M1-Quota`，各连接的独立 CODEX_HOME/keyring 保持原样。旧 M1 窗口和旧 ZIP 已按用户指令删除。

当前窗口保留 Nowdex Mac 风格，默认打开“额度监控”。用户已批准将九来源离线采集接入“用量”页：刷新、每 15 秒采集、暂停/恢复、选择目录、原生保存对话框导出、确认清空并暂停。统计沿用 `%APPDATA%\AgentUsage-M1`，不迁移或清除已有历史；账号额度存储独立。统计导出不包含账号或凭据。关闭窗口会退出并停止两个服务；旧版托盘界面已移除。2026-10-04 已接入全局动效，设置支持“跟随系统／减少动态／关闭”，默认跟随系统。动效不延迟请求、取消或焦点恢复。

1. 应用只查找 Codex Desktop 的 `bin/*/codex.exe`，不读取现有账号和配置；也可用“选择 Codex CLI”选取官方 `codex.exe`。
2. 点击“连接 Codex 账号”，填写个人/工作等备注，再点击“打开官方登录”。系统浏览器打开官方授权 URL，由用户本人完成授权。
3. 官方登录成功后读取套餐和额度。再次连接可加入其他账号，请在官方页面选对账号。多个连接分别展示剩余额度；其他 Codex 应用的登录隔离需要在真实验收时确认。
4. 手动刷新单个/全部账号；可选择每 5 分钟刷新，每次启动默认关闭，关闭应用后停止。刷新由主进程统一顺序排队，同一连接不会重叠。普通错误冷却 60 秒；仅明确结构化限流冷却 15 分钟，手动刷新也不能跳过冷却。登录超时 5 分钟会取消。读取失败保留最后有效值，界面区分最近尝试、最后成功和历史状态。
5. “移除连接”确认后对该连接执行官方 logout，再移除缓存；不影响其他连接。系统凭据存储不可用时不降级到明文认证文件。

浏览器 `node design/desktop-reference/serve.js --saved-m1` 只供界面评审，不提供真实账号 HTTP API；“查看示例卡片”明确使用合成数据，登录与刷新禁用。

## 接口与数据边界

使用官方 CLI App Server stdio JSON RPC，当前本机核对版本 `codex-cli 0.160.0`。方法白名单：initialize、config/read（只校验有效凭据存储配置）、account/read、account/login/start（仅 chatgpt）、account/login/cancel、account/rateLimits/read、account/logout。不发起 thread/turn、工具调用、账号切换、额度重置、邮件或付费操作。官方 CLI 采用标准 Codex 登录授权；应用的 RPC 限制不等于 OAuth 本身拥有专用的只读额度 scope。

每个连接为随机 ID，独立 `CODEX_HOME` 位于本应用 `codex-homes/<id>`。传入 `cli_auth_credentials_store="keyring"`，不使用 file/auto 降级；授权由官方 CLI 管理。应用不读写 auth.json、不解析 JWT、不复制已有凭据。子进程不继承 API key、代理、旧 CODEX_HOME 等变量；analytics/feedback/更新关闭。主进程与 renderer 阻止联网，登录/额度网络由用户触发的专用 CLI 子进程完成。这里没有宣称子进程的全部实际域名请求已完成抓包验收。

缓存 `quota-cache.json` 白名单：随机连接 ID、provider、用户备注、套餐、各额度窗口已用/剩余百分比、窗口分钟数、重置时间、最近成功读取时间、重置额度数，以及最近尝试、受控错误枚举、可重试时间。无邮箱、服务账号 ID、access/refresh token、登录 URL、对话内容。服务端账号 ID 仅在主进程内存用于当前运行的重复/变化判断，未知不推断。renderer 不接收授权 URL/凭据。日志不输出原始 CLI stdout/stderr/服务错误。

`AccountQuotaV1` 与 `UsageSnapshotV1` 分开。优先 `rateLimitsByLimitId`，否则兼容 `rateLimits`；同一 bucket 的 primary/secondary 分别展示，剩余=100-已用（最低0），不是 token 推算。null/缺失显示未知。重置时间经过不会自动置满，必须重新读取。超过10分钟或重启缓存标记需要刷新。各窗口不能相加；本地 token 历史无法确定账号时不做归属。

## 依据

- [官方 App Server 账号接口](https://learn.chatgpt.com/docs/app-server)：ChatGPT managed 登录、account/rateLimits/read、取消、logout。
- [官方配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)：CODEX_HOME / cli_auth_credentials_store / keyring。
- 本机生成协议类型位于被忽略的 `.cache/codex-schema`，仅核对结构，不打包。

## 验收口径

真实账号授权和服务端额度核对必须由用户完成一次官方登录后验收；合成测试、CLI 空目录握手、桌面缓存展示都不能代替这一项。API 按量账单/余额、Claude/Cursor/其他 agent、iPhone、云同步仍未接入。

以下为初始额度版本的历史执行记录；2026-10-03 稳定性实施和新交付证据见 [QUOTA-STABILITY-20261003.md](QUOTA-STABILITY-20261003.md)：

| 检查 | 结果与证据边界 |
| --- | --- |
| `npm run verify` | ESLint 覆盖 m1/quota/自有预览代码，28 个行为测试通过；Chart.js 原版 vendor 排除 lint |
| 独立官方 CLI | 0.160.0 初始化、有效 keyring 配置、空账号查询、启动及取消 ChatGPT 登录通过；未打开浏览器、未登录真实账号、未创建 auth.json |
| Windows 原 M1 | `test:native`、`test:ui`（100%/150%）与两进程 crypto 检查通过 |
| 新额度 Windows UI | 已执行新打包 exe 100%/150%：缓存/未知字段、路由、弹窗；隔离测试进程用合成适配器通过真实 IPC/事件/持久化验证连接、刷新、移除。合成适配器只在测试进程内替换，不进入产品 |
| 浏览器外观 | CUA 检查默认窗口、480px、深色、详情展开；无页面错误，无整页横向溢出；示例带明确标签 |
| 仍未执行 | 用户真实登录、操作系统凭据写入/重启恢复、真实剩余额度对照、完整子进程网络抓包、真实多个账号核对；不能宣称真实账号端到端已验收 |

可执行目录 ZIP 为本地未签名测试构建。Codex CLI 使用当前机器已有的官方安装，不捆绑或自动下载 CLI。桌面额度窗口的官方登录必须由用户本人完成；不要把密码、授权码或 token 发到聊天。
