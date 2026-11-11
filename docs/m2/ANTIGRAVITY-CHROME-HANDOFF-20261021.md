# Antigravity 完整授权地址交给 Chrome（2026-10-21）

所有者真实验收 1.4.2 时，手动复制终端链接后 Google 返回 `Required parameter is missing: response_type`／`400 invalid_request`。官方 [README 的认证合同](https://github.com/google-antigravity/antigravity-cli#authentication) 区分本机打开浏览器与 SSH 打印链接；本应用的 `SSH_TTY` 是选择隔离文件令牌存储的既有合同，也触发了远程手动流程。官方仓库 [issue 315](https://github.com/google-antigravity/antigravity-cli/issues/315) 有终端复制换行损坏 OAuth 参数的报告。这与截图／所有者操作一致，但没有读取 Chrome URL 或据此断言账号资格。

隔离空 home 的只读 `/usage` 登录前探测确认原始完整输出包含 `response_type=code`，`BROWSER` 测试程序未被调用；探测有超时并确认 Job 已回收，没有完成账号授权、额度请求或模型任务，本应用诊断未保存原始终端输出／URL。1.4.2 制品不含网上建议的 `GEMINI_FORCE_FILE_STORAGE`／`AGY_FORCE_FILE_STORAGE` 名称，不能用它们替换已核对 SSH 存储模式；产品没有使用这些未经支持验证的开关，也没有切换系统 keyring。

新增明确登录专用能力：Windows Job 主机仅在 Antigravity 交互登录显式请求时，附着本次已固定映像且仍受 Job 管理的子进程控制台，读取有上限的输出单元以识别 Google 授权 URL。读取只针对本次 Job 的 PID 列表中，经存活句柄、Job 成员关系、创建时间不早于根进程、完整程序路径与已固定映像一致核对的进程；每次最多核对 64 个 Job 成员、读取 8 个同映像控制台。1.4.2 启动器会派生同一映像的第二控制台，不能只监听最初 PID；不选择其他进程／窗口，不读取键盘输入、剪贴板或浏览器。控制台单元保持软换行连续；候选地址稳定后只发送一次专用 IPC 行，立即停止控制台读取并释放句柄。普通 CLI／安装／额度探测和其他登录没有该读取能力。

主进程再校验 HTTPS Google 固定授权路径、唯一参数、`response_type=code`、原始 state／S256 PKCE、官方远程回调和 client ID 形状；拒绝残缺地址、重复参数、额外 token／code 和第三方回调。使用现有 Chrome `shell:false` 参数数组打开完整地址，不改写或补全 OAuth 参数。终端的其他输出／输入不返回应用；URL 不进入结果、错误、日志或磁盘。系统浏览器进程由应用启动，位于 CLI Job 之外，结束／取消 CLI 不会按名称终止用户 Chrome。

官方 CLI 继续独立保存及管理应用专用目录里的登录，必要时用户按官方页面／终端提示提供一次性授权码；不将它发到聊天。后续额度报告仍为受版本约束的 `/usage`、JSON 与零模型轮次证明。此能力不复制 OAuth client secret、不自建授权 broker、不改变 Google redirect URI，不授予读取其他浏览器会话或外部账号文件的权限。没有 UI 样式改动。

首个真实重试没有自动打开 Chrome；只读元数据随后确认本次 CLI 有启动器及第二个同映像子进程控制台。补充同一 Job／固定映像后继控制台支持，并先用真实 1.4.2 在空 home 进行登录前只读 `/usage` 探测，完整 URL 成功交接一次并通过校验，随即取消且确认回收；没有打开浏览器、接收账号 grant 或发起真实额度／模型请求。证据只保存这些标志。

第二次真实交互重试仍未自动打开 Chrome。当前调用的只读诊断确认它已经显示地址并等待授权码，交互 TUI 在每行增加一格左右留白，原来的连续单元正则只取得第一行；先前登录前探测的输出格式不同，未覆盖这个问题。读取器新增按控制台行边界连接连续 URI 字符行，短尾行即结束，不合并行内空白或提示文字，后续仍严格校验原始 OAuth 参数。对尚在等待的同一调用作一次限定恢复：仅在进程路径、父链和创建时间核对后，用相同规则读出当前地址，在内存中校验并成功调用既有 Chrome 打开器，没有另发起登录或保存 URL。此恢复调用不是产品自动交接已通过的证据。

合成验收实际运行 Windows 新控制台，以及同一 Job 下的同映像第二控制台；另覆盖交互界面的逐行留白、编码参数跨行及后续纯 URI 字符提示不得附到 state。完整交接只发生一次，取消后 Job 回收，终端合成秘密和授权地址不出现在返回结果；另覆盖地址合同、CLI 环境隔离与浏览器调用分派。真实账号结果与最终运行包记录在 [RESULTS-LOGIN-REAL-RECOVERY-20261021.md](RESULTS-LOGIN-REAL-RECOVERY-20261021.md)，不能将合成测试或恢复打开器成功算作真实登录／额度成功。
