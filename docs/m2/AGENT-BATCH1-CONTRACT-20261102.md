# 首批新增 Agent：后端读取与记录合同 · 2026-11-02

所有者在本会话要求批量接入新 Agent，明确 Codex 只负责后端数据库/日志读取与应用内记录，前端 UI、交互与表达由 Claude 负责；允许研究成熟 GitHub 项目的实现。对推荐的分组回复“开始”后，本增量先实施 Copilot、Cline、Pi。基线为本地 main `8cff8bb`，分支 `codex/agents-batch1-20261102`。

只进行合成数据验证，不读真实来源、凭据或账号，不改 Agent 数据、配置和遥测开关，不启动 Agent，不联网查询额度，不推送、不打包。不自动开始 Continue、Kilo、Qwen、Kimi 或历史 UI/性能待办。

## 支持范围

| ID | 默认读取位置 | 接受的文件 | 当前边界 |
|---|---|---|---|
| `copilot` | `${COPILOT_HOME}/session-state` 及默认 `~/.copilot/session-state` | `session-state/<session>/events.jsonl` | CLI `session.shutdown` 的逐模型累计 token；不读 session-store.db、data.db、账号配置或 credits |
| `copilot` 可选 | 仅用户选入已有本地文件/目录 | `otel/**/*.jsonl` | 仅 `type=span`、`gen_ai.operation.name=chat` 的逐调用记录；不自动启用 OTel，不包含 IDE 全覆盖承诺 |
| `cline` | `%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/tasks` | `tasks/<task>/ui_messages.json` | 仅 `say/api_req_started` 的用量及该行 `modelInfo`；其他编辑器、Insiders/远端根需明确选择并满足同一文件合同 |
| `cline` CLI | `~/.cline/data/sessions` | `<session>/<session>.messages.json` | `sessionId`、assistant 行 `metrics`、`id`、`ts` 和 `modelInfo`；不读旁边的 manifest |
| `pi` | `~/.pi/agent/sessions` | `*.jsonl` | 当前核对的 v3 会话头及 assistant message usage；v1/v2、未来版本和衍生产品未适配 |

显式 fixture home 的 APPDATA 缺省映射为该 fixture 的 `AppData/Roaming`，不会取真实机器环境。已有自选路径机制保持。Pi 的非默认 home 可显式选入，不在本批增加环境变量/外部配置发现。

所有读取沿用 `policy.filesUnder/readBytes`：拒绝根及后代链接/越界别名、UNC、认证与配置文件名；目录深度、文件数及单文件大小沿用现有上限。只在内存解码包含其他内容的 JSON 容器，解析器仅访问本合同列出的字段。不会为了模型识别读取 prompt、正文、工具参数、conversation history 或 manifest。错误只返回固定码。

## 计量、身份和保存

### Cline

- IDE 的 `tokensIn`、`tokensOut`、`cacheReads`、`cacheWrites` 是互斥桶，规范总量将它们相加；reasoning 未报告则为 null。
- CLI 的 `metrics.inputTokens` 含缓存，规范非缓存输入扣除 `cacheReadTokens/cacheWriteTokens`；总量为 inclusive input + output。
- IDE 身份为 task ID + 请求行 `ts`；CLI 身份为 session ID + assistant message ID，均经应用 salt HMAC，不以文件位置、模型或增长计量值作为身份。
- 模型只取该行 `modelInfo.modelId/providerId`（IDE）或 `modelInfo.id/provider`（CLI）。旧记录无模型时保持 unknown；不从正文猜模型，不把记录的 cost 当真实账单。
- IDE 与 CLI 来源分别保留 `entry=desktop/cli`，当前没有证明二者间的迁移/拷贝对应关系；不宣称跨格式去重已验收。

### Pi

- `input/output/cacheRead/cacheWrite` 为互斥桶；reasoning 是 output 子集，不再次相加。`totalTokens` 用于现有冲突校验。
- v3 entry ID + 原调用时间组成 HMAC 请求身份；不使用子会话/文件路径或模型作请求身份。fork 拷贝的同一 entry 去重，新增 entry 仍计入；存储维持首次归属。
- 只保存带用量的会话头 ID/cwd 到现有独立会话元数据，不存标题、parentSession 路径或正文；这些元数据不进入统计导出/保存查询。

### Copilot

- session ID 取 `session-state` 下的规范会话目录名，逐模型读取 `usage.inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens`。
- input 含缓存、reasoning 已含 output。多个 shutdown 按时间排序，将逐模型累计快照转换为相邻增量；首个快照作为已有累计用量。记录数是“会话/模型关闭区间”数，不等于请求数，时间表示区间的 shutdown 时间，不是原调用发生时间。
- 应用私有账本每个区间保留 `copilotCumulative`，只含上述规范数值及 quality，作为差分依据；不保存 credits、账号、请求体或原始响应。`accountingKind=session-model-interval`。两者均不进入 UsageSnapshotV1/CSV/保存查询。
- Store 合并已保存检查点与本次观测后重建区间，处理重复扫描、重启、旧前缀消失及旧检查点迟到。旧区间需要修正时先走现有备份，投影/持久化成功才发布；保存失败不暴露重分配。未改变的检查点不额外生成备份。
- 累计桶下降报告 `SOURCE_USAGE_REGRESSION`，不猜测 reset 或新的消费；保留已接受的历史。旧版本 reset、崩溃未 shutdown 的调用、空/部分 modelMetrics 可能导致覆盖不足，不以此补零或推算。
- OTel 只接受单次 chat span、明确 session ID、响应 ID或 trace+span ID及时间；优先用响应 ID去重复制 span。缺少可验证身份的记录跳过并报告 `SOURCE_ROW_INVALID`。不从 span 正文推断 session/model，不计 invoke_agent/turn 汇总、inference log 或 metric 导出，不推断 reasoning 是否在输出之外。
- session-state 与 OTel 的重叠没有在本批建立逐调用对应，**同次扫描混入两模式即拒绝计入 Copilot**，并报告 `COPILOT_SOURCE_MODE_CONFLICT`；重启/切换路径后也检查已保存模式并保留历史。其他 Agent 继续采集。默认只选 session-state，不自动选 OTel。

### 通用规则

未知桶保留 null，明确报告的 0 保留 0。非法非负安全整数不转字符串数字/零，记录报告 `SOURCE_ROW_INVALID` 并降低质量或跳过；总量/缓存/推理冲突继续走现有保护与定价规则。不修改价格表、汇率、订阅规则或账本格式版本。

## 能力与前端接口

- `agent-catalog` 新增 `copilot/cline/pi`，标记 `usageOnly:true`、`quota:false`，暂用现有通用图标。旧十 Agent 的能力保持。
- `provider-catalog.capabilities()` 排除 usageOnly，避免新来源获得默认 API-key 登录描述。没有新增额度连接、安装计划、runtime 探测或 setup 动作。现有 setup getter 对三个新来源仍不支持，Claude 应避免把旧内置安装入口直接套用到它们。
- 复用 `StatisticsService` → collection worker → `scanSources` → `Store.ingestCollection` → `statistics.json` → 白名单投影，不新建前端 IPC，不改变现有响应形状。
- `SOURCE_FORMAT_UNSUPPORTED`、`COPILOT_SOURCE_MODE_CONFLICT` 已加入统计投影码表和采集固定提示分类；未知值、partial/error、lastSuccess 与历史保留沿用现有协议。
- 会话阅读器、resume 命令、跨会话正文搜索没有扩展到三个新 Agent。Cline/Copilot 的本地会话 ID仅作现有列表元数据；cwd 未读取则为未知。

## 格式依据与源码来源

本实现是适配现有 CommonJS/Store 的独立 usage-only 投影，没有升级原生 tokscale，也没有引入 SDK/新依赖。参照下列固定公开源码树核对结构和边界；没有复制它们的账号读取、联网、正文提取、缺字段补零或价格回退策略。表内 SHA 来自 GitHub Git Trees API，是 Git tree 对象，不能称为 commit SHA；按这些 tree SHA 取得的原始文件已用于核对。补查 commit 对应关系时公共 API 限流，未使用账号或凭据绕过，也未猜测 commit。

| 项目 / 许可证 | 固定源码树（Git tree SHA） | 参考文件 |
|---|---|---|
| [tokscale / MIT](https://github.com/junhoyeo/tokscale/blob/b26c433d03f23a2255ad9f212512ce83ede83da3/LICENSE) © Junho Yeo | `b26c433d03f23a2255ad9f212512ce83ede83da3` | [`cline.rs`](https://github.com/junhoyeo/tokscale/blob/b26c433d03f23a2255ad9f212512ce83ede83da3/crates/tokscale-core/src/sessions/cline.rs)、同目录 `roocode.rs`、`pi.rs`、`copilot.rs` |
| [ccusage / MIT](https://github.com/ccusage/ccusage/blob/c4177eeb6f037bcfcdfe948c78699fb437399b41/LICENSE) © ryoppippi | `c4177eeb6f037bcfcdfe948c78699fb437399b41` | [`rust/adapters/copilot/src/parser.rs`](https://github.com/ccusage/ccusage/blob/c4177eeb6f037bcfcdfe948c78699fb437399b41/rust/adapters/copilot/src/parser.rs)、其合成 session-state fixture |
| [Cline / Apache-2.0](https://github.com/cline/cline/blob/a6507a62a147db4a35e27f4294589742ccac5060/LICENSE) | `a6507a62a147db4a35e27f4294589742ccac5060` | [`ExtensionMessage.ts`](https://github.com/cline/cline/blob/a6507a62a147db4a35e27f4294589742ccac5060/apps/vscode/src/shared/ExtensionMessage.ts)、[`message-translator.ts`](https://github.com/cline/cline/blob/a6507a62a147db4a35e27f4294589742ccac5060/apps/vscode/src/sdk/message-translator.ts)（明确 IDE 三桶互斥） |
| [Pi 官方源码](https://github.com/badlogic/pi-mono/tree/9ee7586a95f5e653ae279c3b8f20938faf3639a1) | `9ee7586a95f5e653ae279c3b8f20938faf3639a1` | `packages/coding-agent/src/core/session-manager.ts`（v3）、`packages/ai/src/types.ts`（Usage） |

公开资料的当前网页和缓存版本曾出现差异，本次以表内固定代码与独立合成输入为依据，不将第三方已支持等同于本项目已验收。下载的参考文件只在忽略的 `artifacts/` 下；提交的 fixture 均为自建合成数据，无真实记录。

验证、首轮失败和交给 Claude 的注意事项见 [RESULTS-AGENT-BATCH1-20261102.md](RESULTS-AGENT-BATCH1-20261102.md)。
