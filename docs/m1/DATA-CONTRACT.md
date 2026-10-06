# UsageSnapshotV1 / SourceCapability

`src/m1/store.js` 是合同实现。renderer 只通过白名单 preload 获得快照；没有文件系统访问权限或 HTTP API。

2026-10-04 桌面定价增量：`priceCatalog.billingSha256` 为可选计费配置 hash，私有映射和默认配置不进入公共快照；`pricingReasons` 新增固定枚举 `reasoning-unreported`。公开目录缓存与本应用偏好只在自身目录保存。详见 [桌面功能合同](../m2/DESKTOP-FUNCTIONAL-20261004.md)。

## 公共快照

顶层字段：`schemaVersion: UsageSnapshotV1`、随机 `deviceId`、整数递增 `sequence`、`collectedAt`、`generatedAt`、IANA `timezone`、`coverageStart`、`daily`、`priceCatalog`、`sources`、`deferred`。

每日条目：`date / agent / entry / provider / model`、`totalTokens`、`inputUncached / output / cacheRead / cacheWrite / reasoning`、`records / partialRecords / pricedRecords / pricedTokens`、`estimatedCostUsd`、`semantics`。

- `inputUncached` 不包含缓存；规范化 `output` 包含 reasoning，`reasoning` 是它的子集，总量不得再次加 reasoning。
- Codex/WorkBuddy inclusive 输入先扣已知缓存；Claude/OpenCode/MiMo 输入桶已排除缓存。
- OpenCode/MiMo source output 不包含 reasoning，进入合同前合并；原始语义保留在本地记录的 `semantics.sourceOutput`。
- 未观测到字段为 `null`，明示零保留零。必要价格字段缺失时费用为 `null`；价格覆盖仅计算已定价 token。来源报告总量与可计算的不重叠总量不一致时，使用可计算总量并标记 `total-mismatch`，不计价。
- 无法推断模型/入口/provider 时使用 `unknown`；不从当前账号推测历史归属。provider 优先明确元数据，缺失时仅使用模型前缀的 API 等价 provider。
- 统计时区来自系统。最近 7/30 天包含今天，不包含未来；累计表示已保存及仍可读取的历史。更换系统时区会重新划分日期。

不包含会话标题、正文、代码、原始标识、绝对路径、机器名、邮箱、认证或账单。合法短 model/provider 标识也可能是自定义名称；只同步统计并不意味着统计本身没有敏感性。

## 来源能力

`schemaVersion: SourceCapability`；类型/显示名、parserVersion、检测结果、状态、字段观测覆盖、coverageStart/End、lastAttempt/Success、错误代码、malformedLines、durationMs、nativeVerification、realSampleVerified。

状态包括 `verified / partial / unverified / not-detected / error`。verified 只表示本机选定样本已核对，不是跨版本认证。真实来源验证标记存于自身目录 `validation.json`；不随应用分发。

## 私有持久化与去重

`statistics.json` 保存随机盐、设备标识、序号、统计记录和来源状态；`preferences.json` 保存采集开关与选定路径。只在自身目录原子写入，不自动裁剪历史。私有 `id / sessionKey / sharedKey` 为 HMAC，不进入公共快照。

同一累计观察替换稳定记录，不逐轮相加；同一消息的 JSON/SQLite 迁移副本去重。共享 OpenCode/MiMo 格式以相同原始 id、时间、模型和用量的匿名指纹合并，首次归属 OpenCode；不同记录不按“用量相等”合并。WorkBuddy 按会话用详细日志替代 aggregate fallback。失败/部分记录保留已有有效历史；清空只修改自己的 JSON，随后暂停。

来源读取使用 O_RDONLY，拒绝 UNC、符号链接、认证/配置名称和非白名单文件。SQLite 主库与 WAL 的稳定性检查、盐与 checksum 验证后，将已提交页覆盖到内存映像；不打开源库 SQLite 连接，不读取 SHM，不 checkpoint。不支持加密库/未知结构会报错误。

刷新间隔 15 秒；任何时刻只运行一轮。采用整轮 60 秒硬超时（比逐来源 60 秒更严格），中断保留历史；30/60/120 秒退避。规模显著扩大时需重新测量，可能触发整轮超时。

## 2026-10-03 定价与维护修订

现行费用合同及 Codex v2 解析以 [USAGE-PRICING-20261003.md](USAGE-PRICING-20261003.md) 为准：Codex 优先逐请求 last usage；费用支持上界与原因，已知部分保留独立小计。`estimatedCostUsd` 为可匹配规则部分的下界，`estimatedCostUpperUsd` 为对应上界，`boundedTokens` 标识范围估算；缺规则部分仍未知且不进入费用。`pricingReasons`、`knownUsage`、`knownRecords` 仅包含固定枚举和计数。价格版本及内置/手动规则 hash 进入公共投影，费率编辑不改原始统计记录。Codex 维护用预览票据、原生确认、独立备份与原子应用；其他来源及不可重读历史保留。旧 parser 的真实验收标记不能证明 v2 已验收。
