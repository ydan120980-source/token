# 来源与复用边界

本项目是个人本地测试分支 Agent Usage M1 0.1.0，不沿用上游发布者身份、签名、更新或发布服务。

- token-monitor：MIT，版权 Javis，固定 [v0.65.0](https://github.com/Javis603/token-monitor/tree/db325fdf46ea7f7328feeb47a4f2005fe339909f)，提交 `db325fdf46ea7f7328feeb47a4f2005fe339909f`。保留根 LICENSE、研究文档和 Windows 图标。2026-10-03 用户授权维护清理后，未使用的上游账号/同步/更新/Hub/Worker/macOS/site 实现及对应测试已移除；原始源码仍可从本仓库基线提交 `f156470` 恢复。上游 instruction 文件与 GitHub workflows 未导入为当前执行规则。
- Tokscale：MIT，junhoyeo，官方 npm 4.17.0，tag 提交 `dcf8d3656bbcecf05d112c6f35f9be328e4f66b7`。Windows 原生程序从锁文件安装的 `@tokscale/cli-win32-x64-msvc` 获取；原生包的 LICENSE 随依赖保留。
- 原上游 vendored Tokscale 指向另一个 fork，覆盖脚本已清理。本项目仅使用锁定的官方 npm 4.17.0。
- 固定公共价格来源：[LiteLLM 公开 JSON](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json)，属于 Tokscale 同类的公共定价输入；快照取得时间、原文件 SHA-256 和精确 provider/model 条目保存在 `src/m1/prices.json`。只提取明确 USD token 价格，不推测缺失缓存价格、不做模糊模型别名映射。
- sql.js 1.14.2（MIT）：源 SQLite 字节及已提交 WAL 页读入内存；数据库引擎只在内存运行。
- Playwright 1.63.0（Apache-2.0）仅用于开发验收；Electron 43.4.0 保留上游锁定版本。

## 与原计划的实现调整

上游采集与账号发现、正文、配置和网络功能耦合，最初采用独立 M1 入口。用户已明确弃用旧 M1 窗口并选择保留采集功能。当前唯一入口为 `src/quota/main.js`；`src/m1/` 继续提供九来源离线统计服务，账号额度由独立 CLI/keyring 连接处理。旧 M1 窗口和未使用的上游入口已删除。

复用 Tokscale 的方式是：先按字段白名单生成匿名统计投影，再让固定版本原生 CLI 做独立聚合校验。它没有接触真实 home 或原始数据库；不代表每个原始来源都通过原生解析器验证。原始提取另有独立样本账本。

本地会话去重与永久历史使用新建的原子 JSON 统计层，没有直接复用上游会数值强制转换和裁剪历史的缓存。这个调整必须在 M1 评审时明确核对；不得声称直接复用了完整上游采集/归档实现。

OpenCode/MiMo 的源 `output` 排除 reasoning；M1 输出合同中的 `output` 包含 reasoning，避免在总量中重复相加。依据 [OpenCode getUsage](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/session.ts) 和固定 Tokscale 的 [OpenCode schema](https://github.com/junhoyeo/tokscale/blob/v4.17.0/crates/tokscale-core/src/sessions/opencode_schema.rs)。Codex 的输出本身包含 reasoning；缓存输入也属于原始输入。

Tokscale 离线定价依据：[固定源码 cache-only 分支](https://github.com/junhoyeo/tokscale/blob/v4.17.0/crates/tokscale-core/src/lib.rs#L5117)。调用显式设置 `TOKSCALE_PRICING_CACHE_ONLY=1`、独立配置目录和统计投影 home；不执行登录、配置、更新子命令。此证据与入口防护、合成测试组合使用，不冒充系统级全网络抓包。
