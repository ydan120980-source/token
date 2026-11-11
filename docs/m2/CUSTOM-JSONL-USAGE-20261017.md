# 添加个人 Agent 的用量来源

本功能在“来源管理 → 添加我的 Agent”中使用，仅支持本地 JSONL / NDJSON。现有十个内置来源继续按原契约采集；账户额度仍只有 Codex。

## 添加流程

1. 选择来源名称、格式和独立的用量目录。读取范围不能与内置来源或其他自定义来源重叠；停用、移除仍保留范围与历史。修改读取位置后，历史位置也继续保留为该来源的范围，不能由另一个来源重复接管。
2. 使用 Claude JSONL 或标准事件时，字段和计数规则固定。自定义映射可读取最多 200 行、1 MiB 的字段结构，不返回正文、原始调用或会话 ID。字段路径如 usage.input，只允许点分隔的 ASCII 属性名。
3. 自定义映射填写调用 ID、时间、至少一个用量字段；可填会话 ID、模型、服务商与各桶。时间选择带时区 ISO、Unix 秒或毫秒。过滤是字段路径及允许值数组，多个条件同时满足；不执行代码或正则。
4. 明确输入是否含缓存、输出是否含推理。首版只接受每次调用的独立用量，不支持把累计快照或会话总量相加。
5. 生成完整预览，核对记录、总量、重复、未知、冲突、增删替换与保留历史，再保存并启用。全局采集暂停时，仅启用来源不会擅自恢复全局采集。

同一来源重扫和改名不改变调用身份。修改映射会重算完整可读文件；丢失、忙碌、超限或未完成末行的文件保留旧观测，界面提示“部分历史使用旧规则”。回退上一版恢复该来源的上一代状态，不回滚其他来源。规则版本不因仅改名而升级。

来源停用或移除不删除历史。移除后的来源只保留历史展示及恢复所需信息，不再扫描；可用“回退上一版”撤销移除。新建另一个来源不能接管相同目录，避免历史叠加；需要改用该目录时请编辑原来源。

## 标准事件 AgentUsageEventV1

UTF-8，每次调用一条 JSON，行末写换行符。id 必须稳定；与 sessionId 联合标识调用。重复写同一调用仍按快照选择规则合并。

~~~json
{"schemaVersion":"AgentUsageEventV1","mode":"per-request","id":"request-001","sessionId":"session-demo","timestamp":"2026-10-17T00:00:00Z","provider":"openai","model":"gpt-5","inputTokens":100,"outputTokens":20,"cacheReadTokens":40,"cacheWriteTokens":0,"reasoningTokens":0,"totalTokens":120}
~~~

- inputTokens 已包含缓存读取与写入，outputTokens 已包含 reasoningTokens，因此上述总量为 120，不是 160。
- 输入、输出、缓存、推理与总量只接受非负安全整数。未提供或 null 表示未知；只有明确报告 0 才填 0。
- id、timestamp 必需；sessionId 可选。时间必须带时区。模型、服务商未报告时为未知。
- provider 是计费服务商，不是 Agent 品牌。来源未知、价格未知不会自动套用某家官方价格；可在费用设置中明确配置模型映射或手动价格。
- 总量与桶冲突、缓存超出输入、推理超出输出会保留质量诊断，暂停精确计价。
- 累计/汇总记录不支持；不记录或推算账号额度、实际账单和正文。

## 配置导入导出

配置版本为 CustomSourceV1，模板为 standard、claude、mapped。导出仅含名称、版本、模板、字段映射、过滤、计数和时间语义；不含本机目录、原始样本或身份。导入必须重新选择读取位置，并重新预览，不自动开始采集。

标准事件的最小配置：

~~~json
{"schemaVersion":"CustomSourceV1","name":"个人 Agent","template":"standard","mode":"per-request"}
~~~

自定义映射示例：

~~~json
{"schemaVersion":"CustomSourceV1","name":"个人映射来源","template":"mapped","mode":"per-request","mapping":{"id":"requestId","session":"sessionId","time":"timestamp","model":"model","provider":"provider","input":"usage.input","output":"usage.output","cacheRead":"usage.cacheRead","cacheWrite":"usage.cacheWrite","reasoning":"usage.reasoning","total":"usage.total"},"filters":[{"path":"role","values":["assistant"]}],"timeUnit":"iso","inputSemantics":"inclusive","outputIncludesReasoning":true}
~~~

配置拒绝未知字段、原型属性、脚本、命令和动态插件。只读取确认的目录，不上传，不改 Agent 配置或数据库。样本仅用于本地结构预览。

## 限制

每行最多 1 MiB，每个文件沿用 512 MiB 读取上限；目录深度、文件数和每来源用时沿用现有保护。预览有效期 5 分钟，草稿 30 分钟；文件、配置、账本或读取位置发生变化后需重新预览。采集忙碌时稍后重试。

原生 Tokscale 核对只证明规范投影总量一致，不证明原日志解释已用真实样本验证。自定义来源默认显示未完成真实样本验证。

## 旧版本与备份

首次保存自定义来源前，会在本应用 backups 下保存一份完整旧账本。旧版本（含 r15）不认识新增来源，不能保证读取新账本；若需降级，先保留当前统计目录，再使用首次接入前的备份恢复旧账本。来源级回退只撤销本来源的一代变化，不是整个应用版本降级。
