# 九来源桌面用量接入合同 — 2026-10-05

范围以用户本轮选择「1 和 2 都做，外加 zcode 和 deepseek harness」及接入计划为准：现有四类本地采集完善，新增四类本地用量。额度监控仍为 Codex。图标、日志适配、在线额度是三个独立能力，不相互替代。唯一产品入口仍是 `src/quota/main.js`。

## 读取及统计口径

| Agent | 本轮可读取数据 | 用量语义 / 去重 |
| --- | --- | --- |
| Codex | sessions / archived_sessions JSONL | 已有累计差分、重复 bucket、归档复制和 fork 排除保持；输出包含推理 |
| Claude Code | projects / transcripts 中 assistant.message.usage | 输入与缓存分离；同一 message ID 的流式快照及复制以一条请求计数 |
| OpenCode | message JSON / opencode*.db 中 message 表 | 输入、缓存、可见输出、推理互不重叠；标准输出加推理；坏 JSON 行隔离；旧 JSON 与 SQLite 重复 ID 去重 |
| WorkBuddy | 项目 JSONL / workbuddy.db 的 session_usage | 明细优先替代同 session 的总量补充；缺失模型/分类维持未知，不将 session 总量当请求数 |
| MiMo Code | mimocode*.db 中 message / session_message | 与 OpenCode 一致的五桶；保留 CLI/Desktop；同格式跨 Agent 的物理/语义重复保持排除 |
| Gemini CLI | `.gemini/tmp/**/chats/session-*.json/jsonl` 及子 Agent 的 UUID JSONL | 按 session ID + message ID 去重；JSON、JSONL、`$set.messages` 旧 checkpoint 共存；rewind 不撤销已产生调用费用；input 含 cached，output 不含 thoughts，标准输出相加；tool 计数不猜分类；没有推理字段时保留不完整状态 |
| Cursor | 默认 `.cursor/projects/**/sdk-agent-store/**/index.db` 的 runs 用量，或选择 SDK `runs.ndjson` / `index.db` / 逐请求用量 CSV | SDK 仅读 run_id/agent_id/model/created_at/started_at/usage_json，不读 result、events/checkpoints/agents。SQLite 与 NDJSON 同 run ID 只计一次；input、缓存分离；reasoning 是 output 子集。CSV 与 SDK 不混计，既有另一模式的历史保留并报告冲突 |
| ZCode | `.zcode/cli/db/db.sqlite` 的 `model_usage` | 仅投影 id/session/provider/model/time/五桶/两个总量；每 attempt 一条，不再加 turn_usage。当前本机 input/output 为 inclusive；变体以 computed_total 对齐 disjoint 桶，无法对齐标冲突；未知保留 null |
| DeepSeek Harness | `.dsh/sessions`、`.dsh/profiles/desktop/sessions` 下 canonical `session.vN.jsonl[.zstd]` | 支持已核对的 v2/v3/v4；只选同会话最高 generation；Zstandard 串接帧逐帧读取；未来格式拒绝且不退回旧版本；同代双编码拒绝。按 session + turn/step + attempt 序号去重，格式升级重排物理 seq 不会重计历史调用；最后 tagged end-seed 为 fork cut；已组装 usage 优先，重试 attempt 的 stream usage 也计费；输入与缓存分离，推理已含输出；序列断裂只保留有效前缀 |

所有缺失字段为 `null`，已报告的零为零。规范 total 不重复加推理；不完整/冲突记录不伪装精确费用。记录数是用量记录数；Cursor SDK 为 run，WorkBuddy 总量补充为 session，不等同网络请求数。HMAC 使用本应用已有持久 salt，原始 message/session ID 不进入统计快照。

SQLite 仅读取原文件与已提交 WAL 的字节，在 sql.js 内存镜像查询。没有原库连接、写锁、迁移、checkpoint、配置或认证写入。JSON/压缩/SQLite 解码需读取包含其他字段的容器字节；代码仅访问用量/路由/时间/去重字段，不提取、显示、保存或导出正文、工具参数、header.system、认证及 error_message。统计导出再次经过主进程白名单；来源错误仅允许固定代码，不能借错误文本导出任意内容。

## Cursor 文件合同与限制

新增来源默认扫描 `.cursor/projects` 中允许的 SDK 文件；已有明确自定义路径或空列表仍保留。来源面板选择 `.csv`、`runs.ndjson` 或 SDK `index.db`，取消不改变状态。新选择替换 Cursor 路径，其他 Agent 目录继续追加；选择后沿用已有暂停采集流程。不能选择本应用 usage/quota 数据目录、认证文件或不支持的文件。SDK 自定义 stateRoot 可通过选择其 index.db 接入，本应用不会创建或配置 SDK，也不会执行推理。SQLite schema 不符合 runs 字段合同则拒绝；不读 IDE 全局 state.vscdb。

CSV 要求逐调用的 `Date` / `Timestamp`（ISO 8601 且带时区）、`Model`、`Input Tokens`（不含缓存）、`Cache Read Tokens`、`Cache Write Tokens`、`Output Tokens`；`Total Tokens` 和 `Request ID` / `Usage ID` 可选。也接受同时存在的 `Input Tokens (w/ Cache Write)`、`Input Tokens (w/o Cache Write)`，由两者差值确定缓存写入。数值只接受非负安全整数。引号、逗号、换行、BOM 受支持；无时区日期、非法日历日期、负值、重复列、缺少必要分类会显式拒绝或标部分记录无效。

有请求 ID 时用其去重；无 ID 时用投影后的时间/模型/桶签名及重复次数保留相同记录的数量，复制同一导出文件不会翻倍。无 ID 的多个部分重叠导出无法证明相同 timestamp 的多次调用是否重复，因此建议沿用同一完整导出文件；它是导入合同，不是按用户、日期汇总的 Analytics 图表 CSV。

**尚未支持** Cursor IDE 私有 `state.vscdb` 和普通 CLI 无 usage 的 transcript。官方 SDK 默认 SQLite、NDJSON 与合法逐请求导出可用；不能据此宣称所有 Cursor 会话都会自动采集。Gemini CLI / Cursor 本轮没有真实调用样本，因此只有格式合成及 Electron 测试，不标真实样本已验收。Harness v0/v1 的旧 packed stream 暂不支持；不通过修改原日志升级；v2/v3 为官方兼容结构的合成验证，真实可比核对仅 v4。ZCode 本机无正 reasoning 样本，推理变体只有合成验证。用户已明确接受上述有限支持和真实验收限制（2026-10-05），按此范围继续修复和独立复验；该接受不等于未执行的真实验收通过。

## UI、定价、边界

共享 agent-catalog 同时驱动采集、来源白名单、模型归属、计费设置及图标选择器，共九类。概览、趋势、明细沿用同一 Agent/source/model 范围。九 Agent 默认都是实际记录模型、倍率 1；未知路由仍由用户在模型映射面板明确指定。Gemini / GLM 大小写仅匹配明确厂商模型 ID，不猜 auto/free 路由；定价失败仍诚实显示未知。

UI 保留现有 Nowdex / Apple 风格、图表 pointer/wheel 穿透、动画及减少动态模式。图标为本地 SVG 的简化标记，不通过产品网络加载；无未定价详情面板回归。现有每分钟 Codex 额度刷新、重入 cooldown、账号 keyring/独立 CODEX_HOME 均不改变。

没有新增账号配对、钥匙、认证凭据或恢复流程。持久去重仍是本地统计账本的 HMAC ID，不等同生产同步协议的防重放。同步上传、生产密钥/配对/恢复、云区域/预算、iOS 构建分发继续受 `DESKTOP-SCOPE-20261004.md` 的独立决定约束。模型定价依然只有专门固定 URL 子进程可 GET models.dev；其他产品进程及采集器保持网络阻断。

旧统计/用户偏好/定价/连接不清理。偏好仅对缺少的新来源补入默认 roots，已有自定义目录和空列表不覆盖。坏记录、忙碌文件和读取失败保留已保存历史。持久层与扫描对同调用的多份观测使用同一整份快照选择规则：有效观测（measured/partial）优先于无效观测，其次总量较大者（较晚快照；缺字段快照的总量是下限），等总量时按质量、已知字段和模型信息选择；结果与文件、Agent 及扫描先后顺序无关（2026-10-06 用户确认“总量大的优先”）；较旧用量报 SOURCE_USAGE_REGRESSION、相同总量但 measured 分类冲突报 SOURCE_USAGE_CONFLICT，不逐桶取最大值。跨 OpenCode/MiMo 身份以原调用 ID、规范时间及模型生成 HMAC，与键顺序/计量增长无关；保持首次已保存来源归属。已证明副本通过 duplicateIds 抑制，原记录和迁移备份保留，旧 agent-specific HMAC 可由两来源对应 HMAC 关联。CSV 无请求 ID 使用规范时间/模型/四桶和 occurrence，冗余 Total Tokens 不改变身份；旧完整导出按相同规范多重集迁移，无法证明不同部分导出重叠的限制仍存在。Zstandard 先确认帧/块边界完整，再原生解码；完整帧校验损坏拒绝整次文件，截断末帧仅保留完整前缀并报 DEEPSEEK_LOG_INCOMPLETE，不推进最近成功时间。新版本在独立 dist 目录交付，不覆盖之前交付，不 reset/clean。

## 验收与官方格式依据

主线程需通过 verify、native、stress、crypto、usage UI、quota UI、runtime audit；九来源专项需验证独立 1204 token 合成账本、跨格式去重、fork/retry、坏行、未知值、偏好升级、范围及计费设置，100%/150% 原生 Electron 和 Windows 打包/解压运行。真实核对只保存汇总和稳定文件数量；跳过不可比文件，不将其算通过。独立审查必须绑定当前固定源码/候选交付及六维问题清单，审查不改代码。

- Gemini 官方 [chatRecordingTypes](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts) / [chatRecordingService](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts)。
- Cursor 官方 [SDK TypeScript 文档](https://cursor.com/docs/sdk/typescript)，公开发布 `@cursor/sdk` 1.0.35 的 `LocalAgentRunDocument` / `TokenUsage` / `JsonlLocalAgentStore` 类型与实现；[Analytics CSV](https://cursor.com/docs/account/teams/analytics) 并不保证包含逐调用 token 桶，不能一概接受。
- [ZCode 官方产品文档](https://zcode.z.ai/en/docs/welcome) 没有公布数据库合同；本轮结构与 inclusive 总量依据本机 schema-only 和无正文的 SQL 数值汇总，不能标为官方稳定接口。
- Harness 官方 [持久化后端](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md)、[TokenUsage](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/llm-streaming.md)、[会话事件](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/session/src/types.ts)、[assistant stream](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm/src/assistant-stream.ts) 及冻结 v2/v3/v4 格式。

## 2026-10-06 第二轮修复口径

扫描、Gemini checkpoint 合并和持久账本共用整份快照选择规则。等总量且已知分类冲突时，保留一致的总量和原始计量证据，明确 SOURCE_USAGE_CONFLICT/partial；记录标为 usage-conflict，歧义分类不作为已知分类导出，精确定价暂停。等总量兼容的完整副本可以改善缺失字段，不能补造零或逐桶取最大值。相同总量的单份重扫不能自动抹掉已经发现的歧义；新的更大有效累计快照可取代旧快照；它若缺字段，分类和费用如实显示为未知，不回退到较小的完整快照。旧别名的归属依据保留账本 records 的首次保存插入顺序，包含被抑制的原记录，不能用 OpenCode/MiMo 的固定枚举顺序决定。归属与整份计量选择分离，保留首次 Agent、entry、session 身份与对应计费倍率；迁移前备份，原副本保留。

## 2026-10-06 第三轮修复口径

跨来源应用被选中的整份快照时，必须清除该快照不含的旧条件属性（包括 usageConflict / measurementQuality），同时保留首次来源身份和已输出对象的引用关系。SOURCE_USAGE_CONFLICT 来源诊断表示本次扫描观察到过分类冲突，不等同于所有最终记录仍有冲突；当前精确定价/分类是否可用由最终记录决定。同次扫描后续出现更大有效完整快照时可以恢复明确分类与定价；新出现的同总量矛盾仍暂停精确定价。UI 提示明确区分扫描观察与未解决记录。
