# GitHub 绑定、数据同步、应用更新和试验路线 · 2026-11-04

**状态：界面和本地逻辑完成，只用合成数据和假的 GitHub 验证。真实连接没有做，交给 Codex。没有推送，没有发布。** 所有者（2026-11-04）：按建议来，目前由 Claude 做，GitHub App 注册只需把界面做好，真实的 GitHub 连接由 Codex 做。

## 所有者的决定

| 项 | 决定 |
|---|---|
| 账号绑定 | GitHub App 的设备码登录。连接后左下角显示 GitHub 头像和名字，可以断开 |
| 数据同步 | 到本人的私有仓库，只在点击时发送，只发每日聚合数据。**这一项放开 `AGENTS.md` 里“不上传数据”的限制，仅限这个范围** |
| 应用更新 | 手动检查，有新版本时打开下载页。有证书之前不做自动安装 |
| 非官方额度路线 | 默认关闭，标为试验。已经连接的保留并照常工作 |
| 证书 | 先发未签名预览版 |
| 推送方式 | 清理完后在 `origin/main` 上只推一个合并提交。**这是方式，不是现在就推。** `AGENTS.md` 的“不推送”仍然有效，到验收后再由所有者说推 |

## 同步什么

`src/m1/github-sync-payload.js` 是白名单：日期、Agent、模型、Token 各项、记录数、估算费用上下限。未知保持 null。不发对话、路径、会话 ID、项目名和本人添加的来源。每台电脑写自己的文件 `agent-usage/<随机 ID>.json`，互不覆盖。没有端到端加密，界面已说明 GitHub 和协作者能看到。

为什么不用 Gist：GitHub 文档说明 secret gist 不是私有的，拿到链接就能看。

## 给 Codex 的接口

只需实现 `src/quota/github-transport.js` 的 `create()`，文件头写了每个方法的入参、返回和错误码。其余（状态、轮询节奏、令牌加密保存、同步内容、版本比较、哪些网址能打开）已在 `github-service.js`，有单元测试。要点：

- 官方文档已核对：设备码流程只需 client ID，不需要 client secret；要在 App 设置里打开设备码流程；用户令牌默认 8 小时过期，刷新令牌 6 个月，设备码令牌刷新不需要 secret；令牌权限受 App 和用户共同限制。
- 建议 App 权限：Contents 读写、Metadata 只读，由用户选择安装到哪个仓库。
- `user()` 的头像要转成 data: URL，窗口的内容安全策略不加载远程图片。
- `latestRelease()` 只读公开 Release，不需要令牌。
- GitHub App 由所有者注册，client ID 不是密钥，可以写进代码或构建配置。

## 安装包

`npm run dist:win:setup` 打 NSIS 安装包（不是一键安装，可选目录，卸载不删数据）。electron-updater 在 Windows 只支持 NSIS，所以这是以后自动更新的前提。签名配置不变，还是 `NOT_CONFIGURED`。

2026-11-04 用同样的参数打过一次，输出到临时目录：能生成约 120 MB 的未签名安装包，之后已删除。**没有运行安装包**，所以安装、升级和卸载都还没验证。

## 试验路线怎么算

`provider-catalog.js` 的 `experimental`：来源标为 `undocumented-api`、网站登录、Google 内部接口，或者名字已写“试验”。目前只有官方 API、官方 CLI 和被动状态栏不算。关闭时，新连接在后端被拒绝（`PROVIDER_EXPERIMENTAL_OFF`），连接窗口不提供；只有试验路线的服务会说明并指向设置。

合成运行（`--m1-fixture-root`）默认打开，因为已有的连接套件都走这些路线；默认关闭由单元和界面套件单独检查。

## 还没验证

真实 GitHub 账号、真实仓库写入、真实 Release、安装包的安装和升级、已有用户升级后的数据保留。

## 验证

只用合成数据，源码模式，GitHub 是假的传输层。

| 项 | 状态 |
|---|---|
| `npm run verify`（fail 0）、`npm run audit:runtime` | 通过；第一轮 18 个单元测试失败：16 个额度测试需要显式打开试验路线，2 个还在断言 ZCode 等不能阅读，改后通过 |
| `account-update`、`cost-details`（都是新增）、`agents-batch1` | 通过；`account-update` 开发时发现并修了：空值 Select 让整个应用崩溃、同步取错了快照字段、源码模式下版本号是 Electron 的 |
| `cost-smoke`、`cost-composition`、`cost-layout`、`usage-smoke`、`sources-cards`、`source-quota`、`session-reader`、`overview`、`app-shell`、`ui-geometry` | 第一轮通过 |
| `cost-ui`、`cost-rebuild`、`settings-smoke`、`provider-quota`、`sessions`、`interaction-reliability`、`ui-kit-gallery` | 第一轮失败，修后通过。其中 `ui-kit-gallery` 是真问题：没有目录时已知 Agent 也变成圆点；其余是测试写死旧结构或需要打开试验路线 |
| `sessions-reader-extras` | 未运行。上一轮的不稳定原因仍未查明 |
| 真实 GitHub、真实记录、打包、内存 | 未执行 |
