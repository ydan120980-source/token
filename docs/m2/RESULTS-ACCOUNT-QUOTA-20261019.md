# 账号额度扩展验收（2026-10-19）

本轮承接所有者“额度可读能力做全”，不是再次安装恢复或启动 GitHub 功能。实施合同见 [ACCOUNT-QUOTA-EXPANSION](ACCOUNT-QUOTA-EXPANSION-20261019.md)。实际账号与合成测试分开记录，不能以 UI 有连接按钮代替真实服务验收。

## 已实施

- 官方 DeepSeek 按币种余额、WorkBuddy 已授权个人积分；OpenCode Go 订阅窗口；试验 Z.ai / BigModel 个人 Coding Plan。
- Gemini 官方 CLI 内部只读 retrieveUserQuota，显式 OAuth token + 项目 ID；按模型/单位保留约束，非普通 API key，一键 OAuth 未实施。
- 所有者批准的可选 MiMo / Cursor 手动本站会话。默认未连接，窗口另行确认试验风险；后端只发白名单 Cookie 到固定本站额度路径。MiMo API 金额与 Credits 分离，Cursor 个人/团队/按需约束分离并标部分覆盖。
- Claude 官方状态栏 rate_limits 被动白名单导出，现有页面复制配置片段，由本人合入现有状态栏；不改独立网络治理或 settings。没有独立后台查询。重复回调保持观测年龄，缺字段替换旧观测为未知。
- 新服务凭据与 Google 项目上下文仅存内存；重启需重新提供。串行、取消、移除、重试退避、错误受控、存盘后发布；错误保留上次成功额度。来源状态与 V2 资源展示对齐，支持仅余额账号。
- Codex 优先选择当前字节可核验的应用管理原生程序，缺失/变化时回退已有官方客户端；登录和显式刷新前在空闲时重新选择，不固定 Pro 的五小时窗口。
- 十进制金额/计数从 JSON 数字词法保真；不同窗口/池/币种/总额组成不相加，不补未知为零，不按会员名称推测容量或到期。V2 可选 incomplete 表达覆盖缺口，兼容旧缓存。

## 真实只读验收

所有者允许已安装官方客户端内部使用自身当前登录，各做一次已核实只读查询；本程序不直接读取认证文件、不自动登录、不发模型请求。

- **Codex：通过。** 由已安装官方 Desktop 附带 CLI，对一个既有应用独立连接执行一次 account/rateLimits/read，得到一个资源池、两个窗口、一个余额。未更改缓存，未发模型请求。证据 `artifacts/account-quota-20261019/real-codex-read.json`，仅保留计数与时间，不保存原始账号返回。单次额度请求未重复执行。
- 本机旧应用管理 Codex active 记录指向的程序现在缺失；此前被忽略的下载/验收产物也不在当前磁盘。原因未查实，不推定杀毒或删除行为。新选择逻辑会拒绝该无效目标，实际单次读取使用现存官方客户端。
- Antigravity 自动元数据发现只找到桌面程序，没有 CLI，未执行 /usage。协议、程序身份/版本和启动时配置/插件副作用边界仍未满足；Job Object 不是读写/网络沙箱。该来源保持未接入查询，已有安装/恢复引导继续可用。
- 其他新 API / 网站会话路线没有用户在本地提供的真实凭据，未向其发送请求。Claude 未修改设置，未收到真实客户端回调。它们只有合成/进程/界面验收，不代表真实当前账号通过。

## 当前已通过的检查

- npm run verify：ESLint clean、fail 0；包括资源金额、HTTP 固定端点/只读 POST/Cookie 白名单、超时/拒绝重定向、失败保留、撤销竞态、内存上下文与被动导出。
- npm run audit:runtime：唯一产品入口，无退役路径或开发脚本依赖。
- npm run test:native、test:stress、experiment:crypto：通过；均使用本轮自有合成目录。压力覆盖大 SQLite、重复采集、队列和 RPC，不表示真实服务商负载测试。
- 受影响源码 UI：provider-quota 在 100/150%；source-quota 在 100/125/150%；既有 quota 在 100/150% 通过。接口保留业务/Codex 缓存字节，API 密钥不落盘，无真实服务请求。
- Windows 构建和 audit:package：通过，源文件与 ASAR 逐字节一致，PowerShell 辅助脚本在 unpacked，tokscale 哈希匹配。
- 实际打包程序的 provider-quota 已通过，包括真实 Electron-as-Node 子进程和 PowerShell 导出链路（输入是自有合成回调）。最初原生 PowerShell 管道发生 EPIPE；改为显式 ProcessStartInfo 重定向与等待，重新验收通过。没有把源码 Node 单测当打包成功。

- 本代次全部 29 个 `scripts/m1/*-ui-test.js` 在打包程序上通过；包括安装/恢复、来源与额度、费用、项目、会话、动效、窄屏和交互回归。证据 `artifacts/account-quota-20261019/packaged-ui/suite-results.json`。
- 最终扩展的 provider-quota 流程分别在源码、打包程序、中文空格解压副本上通过：Google 项目参数送达且不落盘，MiMo/Cursor 默认未勾选、勾选后成功读取合成响应、非白名单 Cookie 未传给 worker、移除连接有效。两种缩放均通过。证据 `final-flow-results.json` 与相应 final 目录。
- 候选 ZIP CRC 及解压副本每个文件 SHA-256 与构建目录匹配。副本路径为 `artifacts/account-quota-20261019/中文 空格验收/win-unpacked`，在该副本上运行 agent-recovery 实际采集套件，OpenCode / MiMo 首归属和 100/150% 均通过，源夹具哈希不变。还在此副本运行了实际 Electron/PowerShell 被动导出链路。

## 复核与交付

主会话逐项复核固定网络端点、主 frame IPC 守卫、凭据/上下文不落盘、保存后发布、失败保留、移除竞态、资源有效期和单位、运行程序字节验证、ASAR 辅助文件位置以及实际子进程退出。CodeGraph 在本环境不可用，使用定向当前源码、差异、编译/测试和打包字节校验，未调用子 Agent，也未声称独立安全审计。

Windows 验收版位于 `dist/account-quota-20261019/win-unpacked`，整目录保留；源码 ZIP、交付 manifest 和 SHA256SUMS 在同代次目录。交付 manifest 的 implementationCommit / localMergeCommit 记录本轮实际提交与本地合入信息；只在本地 main 合入，不触发远端同步。忽略的证据目录不进入源码 ZIP，缓存、认证文件、真实响应和本机数据目录不作为打包输入。

## 外部条件与覆盖限制

WorkBuddy 大众一键连接仍缺审核应用与安全服务端，发布者 secret 不进入桌面。Gemini 的 OAuth 获取尚非产品一键流程。网站/内部接口均可能变化，认证失效提示重新提供；403 不证明会员过期。平台未返回逐包有效期、套餐或某些新计划资源时保持未知，不能承诺彻底覆盖服务方未公开信息。Antigravity 缺失 CLI/启动隔离证据仍是实际阻塞项。

本轮不读浏览器/认证文件，不自动登录或轮询新 API，不改代理/防火墙，不向 GitHub 推送或打开 PR。界面为现有页面最小入口，后续视觉完善仍由 Claude 范围承担。
