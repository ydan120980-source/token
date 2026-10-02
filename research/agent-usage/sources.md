# 来源与证据快照

日期：2026-10-02（Asia/Shanghai）。所有项目数据均为查询时快照，后续选型应重新核对。查询命令为 GitHub CLI 的只读 `gh api repos/<owner>/<repo>`、`releases/latest` 与 `contents/<path>?ref=<ref>`；没有打印认证 token。

## 项目版本快照

| GitHub 仓库 | Stars | License | Latest release | 发布日期（UTC） |
|---|---:|---|---|---|
| [Javis603/token-monitor](https://github.com/Javis603/token-monitor) | 2554 | MIT | [v0.65.0](https://github.com/Javis603/token-monitor/releases/tag/v0.65.0) | 2026-10-02T06:28:04Z |
| [junhoyeo/tokscale](https://github.com/junhoyeo/tokscale) | 5602 | MIT | [v4.17.0](https://github.com/junhoyeo/tokscale/releases/tag/v4.17.0) | 2026-09-15T04:45:36Z |
| [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker) | 1943 | MIT | [v1.1.8](https://github.com/xiufengsun/TokenTracker/releases/tag/v1.1.8) | 2026-10-02T11:04:53Z |
| [ccusage/ccusage](https://github.com/ccusage/ccusage) | 18838 | MIT | [v20.0.26](https://github.com/ccusage/ccusage/releases/tag/v20.0.26) | 2026-09-27T16:26:00Z |
| [nesszer/Win-CodexBar](https://github.com/nesszer/Win-CodexBar) | 1132 | MIT | [v0.60.3](https://github.com/nesszer/Win-CodexBar/releases/tag/v0.60.3) | 2026-09-15T16:44:06Z |
| [missuo/tokens](https://github.com/missuo/tokens) | 198 | MIT | [v27.1.1](https://github.com/missuo/tokens/releases/tag/v27.1.1) | 2026-09-17T16:20:09Z |
| [slopus/happy](https://github.com/slopus/happy) | 23980 | MIT | [cli-1.2.3](https://github.com/slopus/happy/releases/tag/cli-1.2.3) | 2026-09-05T10:11:46Z |
| [tiann/hapi](https://github.com/tiann/hapi) | 5160 | AGPL-3.0 | [v0.30.7](https://github.com/tiann/hapi/releases/tag/v0.30.7) | 2026-09-15T01:10:06Z |

上述八个仓库的 API 元数据均显示未归档。ccusage 的 API license.spdx_id 返回 NOASSERTION，但实际读取 LICENSE 内容为 MIT，因此以实际文件为准。[ccusage LICENSE](https://github.com/ccusage/ccusage/blob/main/LICENSE)。没有核查每个依赖或商业附加功能的许可证。

## 关键源码锚点

| 对象 | 锚点 | 本轮核查内容 |
|---|---|---|
| token-monitor v0.65.0 | commit `db325fdf46ea7f7328feeb47a4f2005fe339909f` | 发布 tag 对应 commit |
| token-monitor desktop package | [package.json](https://github.com/Javis603/token-monitor/blob/v0.65.0/package.json)、[package-lock.json](https://github.com/Javis603/token-monitor/blob/v0.65.0/package-lock.json) | Electron 43.4.0；Node >=22.15；声明 tokscale ^4.17.0；lockfile 固定 4.17.0；未运行 |
| token-monitor Worker | [worker/src/index.js](https://github.com/Javis603/token-monitor/blob/v0.65.0/worker/src/index.js) | 45-54 请求密钥读取；73 授权函数；130 云端聚合；268 数据路由授权；308 ingest；317 保存设备记录；378-380 删除记录。源代码只读，未执行 |
| token-monitor iPhone / backend | [Worker README](https://github.com/Javis603/token-monitor/blob/v0.65.0/worker/README.md)、[API](https://github.com/Javis603/token-monitor/blob/v0.65.0/docs/API.md) | Scriptable / Widgy、共享 secret、header 与兼容 URL 参数、Durable Object SQLite、权限与 wire shape |
| Tokscale main | commit `fe72e1f9b5a2b1a927108b353a9730a5c631a196` | 当前支持矩阵与来源；与 v4.17.0 分开记录 |
| Tokscale WorkBuddy | [workbuddy.rs](https://github.com/junhoyeo/tokscale/blob/fe72e1f9b5a2b1a927108b353a9730a5c631a196/crates/tokscale-core/src/sessions/workbuddy.rs) | JSONL 解析委托与 SQLite fallback；fallback 把汇总 used 放入 input，不能因此声称有真实输入/输出拆分 |
| TokenTracker main | commit `6f3cb02018a36fec4c03f3405b2188bc66cb0cf9` | 仓库快照 SHA；README、隐私与 Trae 文档只读核查 |
| TokenTracker privacy | [PRIVACY.md](https://github.com/xiufengsun/TokenTracker/blob/6f3cb02018a36fec4c03f3405b2188bc66cb0cf9/docs/PRIVACY.md) | 默认匿名遥测、云同步字段、项目/会话留本机与关闭开关 |
| TokenTracker Trae | [trae.md](https://github.com/xiufengsun/TokenTracker/blob/6f3cb02018a36fec4c03f3405b2188bc66cb0cf9/docs/trae.md) | 国际版本地 SQLCipher、缓存/推理局部信息与费用不完整 |

## 官方与专项资料

- [Nowdex 中文官网](https://nowdex.app/zh-hans/)：直接 HTTP 获取并提取正文；确认当前包含 tokens.ci 支持的 token 历史。搜索引擎旧缓存不代表当前页面。
- [Codex app-server](https://learn.chatgpt.com/docs/app-server)：官方 account/rateLimits/read、account/usage/read、thread/tokenUsage/updated；新字段/方法是否在用户当前安装版本可用未测试。
- [Claude Code Monitoring](https://code.claude.com/docs/en/monitoring-usage)：官方 OpenTelemetry、指标和事件范围。
- [OpenCode Server](https://opencode.ai/docs/server/)：官方 API / 事件文档，不能将完整 agent server 直接等同于本产品只读接口。
- [WorkBuddy-Switch](https://github.com/koi128bit/WorkBuddy-Switch)：WorkBuddy / Trae CN / TRAE Work 数据口径参考。
- [LiteLLM](https://github.com/BerriAI/litellm)：API 网关和价格数据参考。
- [Langfuse](https://github.com/langfuse/langfuse)：需要 ingest / instrumentation 的应用观测方案。
- [HAPI FAQ](https://github.com/tiann/hapi/blob/main/docs/guide/faq.md)：定位、Windows PTY 与许可证说明；未以作者对其他项目的评价替代独立证据。
- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)：Windows 工具链、WebView2、iOS 需 macOS / Xcode。
- [shadcn/ui](https://ui.shadcn.com/docs)：桌面/网页 UI 组件参考。
- [Tamagui](https://tamagui.dev/docs/intro/introduction)：React Native 与 web 组件/样式。
- [Expo EAS Build](https://docs.expo.dev/build/introduction/)：云端 binary 构建及项目上传路径。
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)：iOS Keychain、卸载/重装与生物识别变化的边界。
- [WidgetKit update budgets](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date?changes=la&language=objc)：小组件更新时间由系统预算与时间线决定。
- [Hono](https://hono.dev/docs/)：Worker / Node 等 runtime。
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)：SQLite 存储及不同方案能力；[定价与限制](https://developers.cloudflare.com/durable-objects/platform/pricing/)在部署前再次核对。
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)：访问控制；不是端到端加密。
- [SQLite WAL](https://sqlite.org/wal.html)：活跃数据库读取与 WAL 的一致性边界。
- [libsodium](https://doc.libsodium.org/)：认证加密与成熟密码库参考；跨端绑定未测试。

## 方法与未验证项

官网搜索、GitHub 连接器搜索与 GitHub CLI 内容读取结合使用。匿名 GitHub API 遇到 403 rate limit，改用已配置的 GitHub CLI 只读查询。个别网页打开超时/缓存不完整时，用 contents API 核对实际文件；不把失败当作成功测试。

仅检查几个标准本机数据目录存在性，未读取聊天正文、真实 usage 数值、auth.json、Cookie 或 API key。未克隆运行项目、未修改本机 provider 设置、未创建服务、未执行完整安全扫描、未测试真机或蜂窝网络。

研究结论分为“资料/源码确认”“架构推断”“待本机验证”。完整可用性、打包启动、准确计数、隐私协议、端到端加密和 iPhone 真机体验仍需下一阶段实测。
