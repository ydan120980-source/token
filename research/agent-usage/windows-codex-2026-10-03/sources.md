# 来源与证据边界

核查日期：2026-10-03，Asia/Shanghai。主线链接是该日的可变快照；固定版本用于当前基线。无需为了研究安装或运行候选。

## 公共一手来源

| 来源 | 链接 | 支持的判断 |
|---|---|---|
| token-monitor v0.65.0 | [发布页](https://github.com/Javis603/token-monitor/releases/tag/v0.65.0)、[固定源码](https://github.com/Javis603/token-monitor/tree/db325fdf46ea7f7328feeb47a4f2005fe339909f) | 已有 Windows 分发与当前项目固定基线；不证明定制版本继承签名或全部上游功能。 |
| Tokscale 4.17.0 | [发布](https://github.com/junhoyeo/tokscale/releases/tag/v4.17.0)、[当前 README](https://github.com/junhoyeo/tokscale) | 固定发行与 Windows 支持设计；主线能力不能算到锁定包。 |
| AgentHub 候选 | [固定 README](https://github.com/BLACKIELF/AgentHub-AiGoodBro/blob/d03430a81a4dca5b3967864d79064b2590165955/README.md)、[PR 13](https://github.com/BLACKIELF/AgentHub-AiGoodBro/pull/13) | 2.2/1003v1 候选、macOS 定位、Token Monitor v0.62.0 来源及未覆盖的实机行为。 |
| AgentHub Windows | [固定 README](https://github.com/BLACKIELF/AgentHub-AiGoodBro/blob/d03430a81a4dca5b3967864d79064b2590165955/windows/README.md)、[reader](https://github.com/BLACKIELF/AgentHub-AiGoodBro/blob/d03430a81a4dca5b3967864d79064b2590165955/windows/crates/codexu-core/src/readers/codex_app_server.rs)、[测试](https://github.com/BLACKIELF/AgentHub-AiGoodBro/blob/d03430a81a4dca5b3967864d79064b2590165955/windows/crates/codexu-core/tests/codex_app_server_quota.rs) | Windows Tauri/Rust/React、账号读取与协议异常案例；不证明此主机运行成功。 |
| AgentHub 额度与范围 | [CLI 文档](https://github.com/BLACKIELF/AgentHub-AiGoodBro/blob/d03430a81a4dca5b3967864d79064b2590165955/docs/local-cli-accounts.md)、[发布说明](https://github.com/BLACKIELF/AgentHub-AiGoodBro/blob/d03430a81a4dca5b3967864d79064b2590165955/docs/source-publication-1003v1.md) | 失败缓存、身份核对、限流与连接范围；Windows 后续工作暂停。 |
| Win-CodexBar | [README](https://github.com/nesszer/Win-CodexBar/blob/main/README.md)、[0.60.3 发布](https://github.com/nesszer/Win-CodexBar/releases/tag/v0.60.3) | Windows 托盘、provider 路径、凭据保护及分发；README 内历史版本说明可能滞后。 |
| CodexBar | [仓库](https://github.com/steipete/CodexBar) | Win-CodexBar 所引用的 macOS 原实现。 |
| ccusage | [实际 README](https://github.com/ccusage/ccusage/blob/main/apps/ccusage/README.md) | 本地多来源报告、JSON、缓存价格离线选项。根 README 是指向该路径的链接。 |
| TokenTracker | [README](https://github.com/xiufengsun/TokenTracker)、[隐私政策](https://github.com/xiufengsun/TokenTracker/blob/main/docs/PRIVACY.md) | 本地 Dashboard、hooks、默认 heartbeat/页面分析、可选云功能；不能由 local-first 推断完全离线。 |
| 官方 Codex App Server | [文档](https://learn.chatgpt.com/docs/app-server) | managed 登录、账号查询、额度窗口和可选字段；文档能力与本机版本支持分开。 |
| 官方 Codex 认证 | [文档](https://learn.chatgpt.com/docs/auth) | keyring/file/auto/ephemeral 存储行为；keyring 不可用会失败，auto 可回退文件。 |
| SQLite WAL | [官方说明](https://sqlite.org/wal.html) | WAL 持久性、只读与 SHM 条件、活跃数据库一致性。 |
| token-monitor 同步 | [v0.65.0 Worker](https://github.com/Javis603/token-monitor/blob/v0.65.0/worker/src/index.js) | getStats 在服务端调用 aggregateDevices；不能把既有协议视为统计内容 E2EE。 |

## 当前工作区依据

- [AGENTS.md](../../../AGENTS.md)：M1 与 2026-10-03 Codex 额度追加范围。
- [.planning/M1-WINDOWS-LOCAL/task_plan.md](../../../.planning/M1-WINDOWS-LOCAL/task_plan.md)：原 M1 完成评审状态；旧冻结范围不覆盖后来的明确额度追加。
- [DATA-CONTRACT.md](../../../docs/m1/DATA-CONTRACT.md)：不重叠桶、去重、未知、只读与全量扫描限制。
- [UPSTREAM.md](../../../docs/m1/UPSTREAM.md)：固定来源和实际复用差异。
- [ACCEPTANCE.md](../../../docs/m1/ACCEPTANCE.md)：已有 M1 检查、异常记录与未完成手工验收。
- [CODEX-QUOTA.md](../../../docs/m1/CODEX-QUOTA.md)：可选入口、官方协议、keyring、缓存与实连缺口。
- [DESKTOP-UI-BASELINE.md](../../../docs/m1/DESKTOP-UI-BASELINE.md)：当前 Nowdex 视觉目标，动画关闭。
- [CRYPTO-EXPERIMENT.md](../../../docs/m1/CRYPTO-EXPERIMENT.md)：合成实验边界；不代表生产 E2EE。
- [quota/rpc.js](../../../src/quota/rpc.js)、[quota/service.js](../../../src/quota/service.js)、[quota/contract.js](../../../src/quota/contract.js)、[quota UI](../../../design/desktop-reference/quota-ui.js)、[quota tests](../../../tests/m1/quota.test.js)：本轮只读对照。
- 原 [requirements.md](../requirements.md)、[research.md](../research.md)、[outline.yaml](../outline.yaml)、[fields.yaml](../fields.yaml)：长期需求与字段来源，保留原内容。

## 方法与限制

采用网页检索/直接打开、公共原始源码读取和定向本地文件检查。GitHub 最新版本 API 查询本轮未成功，因此不把旧的 stars 或 latest 字段作为刷新后的事实；固定发布页已直接打开。AgentHub 固定提交及 PR 状态来自前一轮同日检查，并再次读取固定文档。

计划数据提到的 .planning/M1-WINDOWS-LOCAL/findings.md 未找到；没有用缺失文件补造结论。CodeGraph 当前没有可调用工具，以定向源码核对替代。

没有写产品代码或研究执行脚本，没有安装依赖、运行候选、跑产品测试、真实来源扫描、登录或读取认证。仅新增本目录研究文档。既有验收记录没有冒充本轮重跑结果；完整安全扫描和真实账号验收未执行。

文档验证：六份文件已读回，本地 Markdown 链接无断链，范围与排除项已复核；Git 状态差异仅新增本目录。Bundled Python 未包含 PyYAML，当前 Node 环境未提供 yaml 包，两次解析检查均未成功。未为文档校验安装依赖；YAML 采用文本结构、字段保留和条目计数检查，不宣称解析器验证通过。
