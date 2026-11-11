# 客户端登录复用与便利接入 — 2026-10-21

所有者要求先实现 XDTrees/dsh-xdpool 的第一类能力：复用已登录 WorkBuddy 桌面客户端；随后继续完善其他 Agent 登录方式，缺少依据时只读检索可复用的 GitHub 实现。此决定扩展此前手动输入路线的客户端读取范围，不授权浏览器 Cookie／profile 读取或扩展安装。继续使用日常 Chrome，UI 样式修改须单独批准，GitHub 写操作暂停。

WorkBuddy 仅在用户显式连接／刷新时读取当前 `CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info` 的必要字段；不收集历史账号或所有快照，不修改官方认证文件。加密字段参考固定版本的客户端兼容方式，执行解密辅助前核对官方程序身份，绑定所选可执行文件。查询只用固定国内账单接口，按资源包保留精确积分及有效期；国际版不跨域回退或误报国内套餐。

账号验证成功才加密保存必要凭据。客户端自行续期后的新 token 仅在显式刷新时复用；账号发生变化需重新连接，旧观测不接到新账号。外部 refresh token 不复制或轮换。启动恢复、用量与静态配置检查不触发认证读取或账号网络请求。

参考源码固定到 [XDTrees/dsh-xdpool 2def4d0](https://github.com/XDTrees/dsh-xdpool/tree/2def4d01509784c7ebc4fe9b5d860f12a398a64f)：`src/accounts.ts`、`src/at-rest.ts`、`src/upstream.ts`、`vendor/channel-pack/pack.js`。MIT，相关兼容实现另注明 dingminhua/dsh-connect-workbuddy（LaoDing）和 corrinehu/dsh-workbuddy-connect（Corrine Hu）来源。上游功能和实测说明不构成本产品真实账号验收。

后续便利路线及当前真实结果在本轮结果记录中分别列明。新授权协议只由明确连接动作启动；浏览器打开、发起授权、获得 token 和获得真实额度是不同验收阶段。

## 其他 Agent 的便利路线

- Cursor：仅在明确连接／刷新时，以只读字节和内存 SQLite 查询 `%APPDATA%/Cursor/User/globalStorage/state.vscdb` 的 `ItemTable` 固定键 `cursorAuth/accessToken`；读取已提交 WAL、不创建 shm 或修改源数据库。JWT 的账号／有效期只作绑定和过期提示，服务端额度查询成功后才保存。连接前不读，客户端换号要求重新连接，不轮换外部 refresh token。来源：[CodexBar CursorAppAuth.swift](https://github.com/steipete/CodexBar/blob/9093308f0b79645f6794c2f28f020d87fe06386b/Sources/CodexBarCore/Providers/Cursor/CursorAppAuth.swift)，Windows 路径参照 [ham0806/ai-usage-bar](https://github.com/ham0806/ai-usage-bar)。
- ZCode：新建独立 `zcode-device` 来源。固定 `zcode.z.ai` 的 `oauth/cli/init → authorize_url → oauth/cli/poll`，Chrome 完成授权后自动接收主登录 token，仅读取 `zcode-plan/billing/balance`。不复制额外返回的 Z.ai／BigModel token，不兑换 API key、不领取积分或调用模型。返回的浏览器地址只接受已核对的 HTTPS 站点；随机 flow secret 不落盘。额度桶保留精确 token 数与到期日，账面／可用额度不相加；与原有 API key 路线分开。
- Claude、Gemini、OpenCode、DeepSeek：默认优先现有客户端／配置 key 复用，网站手动来源明确作为备用。Claude／Gemini／Antigravity 保留官方独立 CLI 授权，不承诺当前机器已安装兼容版本。
- MiMo：参考 [CodexBar MiMo](https://github.com/steipete/CodexBar/blob/9093308f0b79645f6794c2f28f020d87fe06386b/docs/mimo.md)，其便利路线依赖浏览器 Cookie；本轮不扩展现有浏览器读取，继续保留网站登录后手动连接。DeepSeek 的平台网站 token 也与 API key 来源分离；没有核对到同样的设备授权协议时不伪造自动回调。

没有改动 CSS、设计 token 或界面布局。新增来源和默认选择使用原有连接对话框及组件。合成测试不读取真实客户端凭据，真实验收另用用户显式点击的可见窗口。
