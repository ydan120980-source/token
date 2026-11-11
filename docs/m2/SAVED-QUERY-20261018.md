# 已保存聚合查询：CLI 与 stdio MCP（2026-10-18）

状态：已实现并以合成数据验证；Node 源码与 Windows EXE + ASAR 路径均经过外部 SDK 客户端启动、initialize、tools/list、tools/call。不是实际 Agent 客户端配置验收，不是正式发布候选。范围依据：[实施决定](QUERY-BILLING-SCOPE-20261018.md)。

## 启动

开发环境（PowerShell 7，仓库根目录）：

```powershell
node src/m1/query-entry.js query --json '{"groupBy":["agent","model"],"from":"2026-10-01","to":"2026-10-18"}'
node src/m1/query-entry.js mcp
```

缺省使用 `%APPDATA%\AgentUsage-M1`，也可在上述命令尾部加 `--data-dir '<所选应用数据目录>'`。这个路径只能在启动时选择，工具参数不接收路径。没有账本则返回 `QUERY_SNAPSHOT_MISSING`，不会建目录、采集或用空结果掩盖缺失。

打包版直接使用自己的 Node 运行时，无需另装 Node（完整保留 win-unpacked 目录）：

```powershell
$queryPreviousRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
  $env:ELECTRON_RUN_AS_NODE = '1'
  & 'C:\Apps\Agent Usage\Agent Usage Quota.exe' 'C:\Apps\Agent Usage\resources\app.asar\src\m1\query-entry.js' mcp
} finally { $env:ELECTRON_RUN_AS_NODE = $queryPreviousRunAsNode }
```

通用外部 MCP 客户端启动配置示意；本应用不会代写任何 Agent 配置：

```json
{
  "command": "C:\\Apps\\Agent Usage\\Agent Usage Quota.exe",
  "args": ["C:\\Apps\\Agent Usage\\resources\\app.asar\\src\\m1\\query-entry.js", "mcp"],
  "env": {"ELECTRON_RUN_AS_NODE": "1"}
}
```

外层配置键随客户端而异。本轮实测的是官方 SDK `Client`/`StdioClientTransport` 启动上述 EXE 形态，不是 Codex、Claude、Cursor 等每个产品的安装与模型调用。没有把任何本机聚合数据上传给模型。

## 工具与字段

唯一工具为 `usage_query`。`inputSchema` 与 `outputSchema` 均在工具枚举中提供，readOnly/idempotent 为 true，destructive/openWorld 为 false。

| 参数 | 口径 |
| --- | --- |
| `from`, `to` | 可选，真实 `YYYY-MM-DD`，含首尾，按输出的本机 timezone；同时提供时相距最多 36600 天，from 不得晚于 to |
| `agent`, `model`, `provider`, `entry` | 可选的精确标识数组，每项最多 180 字符，每组最多 50 项；空数组表示空选择；大小写敏感 |
| `groupBy` | 只允许上述五个维度（加 `date`），无重复；缺省 `[]` 表示全部汇总 |
| `offset`, `limit` | 稳定的维度键排序；缺省 0/100，offset 最大 100000、limit 1–500；`nextOffset` 为 null 表示本次结果结束 |
| `revision` | 第一页可不传；offset > 0 必须传上一页返回值，格式为不透明 uq1_ 版本串。可在 offset=0 显式校验版本 |

顶层仅含 schemaVersion、revision、账本 sequence、有效 collectedAt、系统 timezone、API 等价估算标记、全范围 total、当前分页 rows、totalRows 与 nextOffset。每行的 dimensions 只含请求分组键。total 覆盖筛选后的全部记录，分页只影响 rows。sequence 仍只描述用量账本，价格编辑不一定改变它。

2026-10-19 起继续分页须带 revision。它绑定计算合同、sequence、时区、计价依据指纹、规范化筛选/分组及全部公开聚合结果，不哈希原始账本字节、路径、会话/记录身份或会话元数据。价格/倍率/映射、用量或查询选择变化返回 QUERY_SNAPSHOT_CHANGED，调用方从第一页重新查询；缺版本的后续页返回 QUERY_REVISION_REQUIRED。分页大小可改变，过滤数组和 groupBy 的不同排列按相同语义规范化。版本不保存历史快照，也不锁定写入；相同版本保证本次返回的金额与指标属于相同计算结果，不能代替跨文件事务。

例如第一页 `{ "groupBy": ["model"], "limit": 20 }` 返回 revision 与 nextOffset；下一页发送相同筛选、groupBy，以及 `{ "offset": 20, "limit": 20, "revision": "<上一页实际返回值>" }`。版本字符串不可自行构造。

每个聚合包含 totalTokens、五个 token 桶、records/partialRecords、pricedRecords、pricedTokens/unpricedTokens、pricingCoverage、estimatedCostUsd/estimatedCostUpperUsd、cacheHitRate、sessions/knownSessions/unattributedRecords。费用与 GUI 共用 valuation 的 estimate/resolvePrice 和 usage-projection；缓存命中沿用 src/m1 的 insights-math；日期口径共用 usage-math。2026-10-19 起读取器使用显式 usage-read-model，不再伪造 Store 或依赖采集/来源模块。

缺失桶为 null；空范围的桶、费用、会话数和比例为 null。已观测的显式零仍为 0。费用上下界仅累计已计价记录，并与未定价覆盖一起解释。会话基于已有不透明 sessionKey 做区间内去重，不返回该键；只要有缺标识记录，sessions 为 null、knownSessions 给已知下限，unattributedRecords 给缺失记录数。分组会话数不可相加得到总会话数（同一会话可能跨日/模型）。

## 封闭读取与一致性

只读取所选目录中的 `statistics.json`、`billing.json`、`model-pricing.json`、`pricing.json`。后面三项缺文件时采用 GUI 默认设置/嵌入目录；文件存在但损坏时受控失败，不隔离、不修复、不写盘。不访问 `statistics.sessions` 中的原始 ID/cwd，不读取 preferences、workbench、来源配置或每文件索引。自定义来源只取注册 ID 以识别聚合的 agent 维度，不输出名称、映射或定义。

每次整组读取两遍并比较字节，最多三次尝试；持续变化返回 `QUERY_SNAPSHOT_BUSY`。这证明稳定读取区间内的已保存文件组合，不承诺跨进程的多文件事务。statistics 上限 128 MiB，其余各 16 MiB，文件链接/非普通文件拒绝。输出逐字段重建，非标识字符串变为 unknown，无效元数据日期变为 null。

旧账本的 sharedKey 去重、首存所有权、完整快照选择、冲突保护和 WorkBuddy 明细替代会话总量，使用与 GUI 启动共享的 `ledger-view` 纯内存步骤。查询不创建备份、不持久化整理结果；因此既保留原字节，又不会因为跳过 Store 构造器而把历史副本重复计入。Cursor 用于之后导入的 csvIdentity 回填与查询聚合无关，查询不执行该写入迁移。

协议 UTF-8 NDJSON，输入缓冲最多 64 KiB；聚合 JSON 最多 480 KiB（MCP 同时提供 text 与 structuredContent，线上的响应低于 1 MiB）。非法或超长协议仅输出受控 stderr；stdout 只用于 MCP 帧。CLI 错误走 stderr 并以非零退出，MCP 工具错误用 `isError` 和受控码返回。错误不含文件名、堆栈、参数或原始内容。

独立查询进程还禁止 Node 网络连接/监听、子进程和常见文件写入 API。这个进程内护栏不等同于 OS 沙箱；主要边界仍是白名单读取、无执行入口及显式输出投影。没有 HTTP/TCP 服务，不触发采集、tokscale、Agent、价格下载或额度查询。

## 用户确认的计费交互

未计入估算列表中的建议来自本地价格目录与用户费率，仅匹配完整字母数字序列相同的大小写/分隔符/明确厂商前缀差异，保留日期、版本、latest、thinking、pro 等限定词；不做近似型号或最近发布日期猜测。最多展示八个候选，先同服务商，再按标识排序，不按价钱排序。展示原模型、目标完整标识、服务商、原因、来源与四项费率。候选多于一个时明确说明歧义；选择候选只预填 sheet，再点击“按此模型计费”才保存。目录无对应版本时不提供后续型号替代。

映射不能补齐来源缺失桶或消除冲突。价格单位为 USD / 百万 Token；缓存空白保持未知，0 为明确零。倍率范围 0–1000，空白拒绝，作用于对应 Agent 的全部历史与后续估算；恢复默认先形成草稿，再明确保存。未使用的自定义费率可再次打开编辑。移除手动费率按模型身份操作，不受无效草稿费率阻塞。映射/费率/倍率保存失败时保留草稿并支持重试，原子写失败尽力清理未提交临时文件、内存与原设置不变。

## 隐私与验收边界

应用自己不上传；外部调用 Agent 可能把这些聚合数字发给其模型服务商。用户应按该客户端的数据处理规则决定是否配置查询。不会返回路径、项目、会话/记录 ID、映射、配置或文件索引。查询不包含阶段 3 配置审计。

本轮证据在 `artifacts/query/`；命令和最终状态见同目录对应日志及结果记录。正式代次的全套打包/解压/采集验收、真实来源/账号核对、各真实 Agent 客户端接入和所有者最终人工验收未执行。
