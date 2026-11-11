# 首批七来源续进：Continue / Kilo / Qwen / Kimi · 2026-11-02

## 范围与状态

所有者对“首批七来源，分三组实施”的建议回复“开始”。第一组 Copilot/Cline/Pi 已提交为 `6cf9039`，其合同和结果分别见 [第一组读取合同](AGENT-BATCH1-CONTRACT-20261102.md)和[第一组验证记录](RESULTS-AGENT-BATCH1-20261102.md)。本增量继续同一授权内的其余四来源；首批之外的候选不开始。

仍为后端-only，Claude 负责前端 UI、交互和表达。当前后端登记共十七个内置用量来源，其中七个新增来源都标记 `usageOnly:true`。不新增额度/登录、安装、配置管理、会话阅读器或 resume 命令，不读真实来源/凭据/账号，不改 Agent 文件，不启用遥测，不启动 Agent，不上传、不 push、不打包。

工作分支 `codex/agents-batch1-20261102`，位于独立工作树。共享 main 的预先未跟踪 `docs/agents/` 保留原状，因此按干净工作树门槛未合入 main。源代码交接应使用本分支的已提交版本，不能称为 main 已上线。

## 四来源读取合同

| ID | 默认位置 / 文件白名单 | 允许访问的字段 | 明确不读 |
|---|---|---|---|
| `continue` | `~/.continue/dev_data/devdata.sqlite`；只接受 `devdata.sqlite` | `tokens_generated` 的 `id/model/provider/tokens_prompt/tokens_generated/timestamp` | 其他表、正文、用户标识、JSONL dev_data、配置、auth |
| `kilo` IDE | `%APPDATA%/Code/User/globalStorage/kilocode.kilo-code/tasks/<id>/ui_messages.json` | `say/api_req_started` 的 `ts`、数字用量及本行 `modelInfo`；旧协议判定仅看 `apiProtocol` | conversation history、正文中的模型标签、任务 manifest/config |
| `kilo` CLI | `~/.local/share/kilo/kilo.db`；只接受 `kilo.db` | `message.id/session_id/data`；data 仅投影 `role/tokens/modelID/providerID/time` | part 表、正文、工具、配置、认证 |
| `qwen` | `~/.qwen/projects/*/chats/*.jsonl`，文件父目录必须为 `chats` | assistant 的 `sessionId/timestamp/model/usageMetadata` | user/正文/工具参数、配置与认证 |
| `kimi` | `~/.kimi/sessions`、`~/.kimi-code/sessions` 中 `wire.jsonl` | 旧 `StatusUpdate` 的 timestamp、message_id、token_usage；新 `usage.record` 的 time、usageScope、model、usage | config.json 的模型、workspaces/session index、正文、工具、其他 wire 事件 |

SQLite 一律复用 `sqlite-memory.js` 的 O_RDONLY 字节与已提交 WAL 内存镜像；不连接源库、不锁/迁移/checkpoint 源库。目录/文件限额、链接和越界保护、受控错误码沿用现有 policy。所有容器只在内存解码，不将原容器留在解析缓存/账本。

### Continue：客户端估算不是实测

公开源码的 `logTokensGenerated()` 写入的是 `countTokens(prompt/completion)`；数据库时间由 SQLite `CURRENT_TIMESTAMP` 产生，按 UTC 解释。只接受已核对的 `YYYY-MM-DD HH:mm:ss` 字段形态。

- token 值保留，但 `quality=partial`、私有 `measurementBasis=client-estimated`，来源报告固定码 `SOURCE_USAGE_ESTIMATED`，**即使手动配置价格也不作精确定价**。
- cache、reasoning、session、cwd 未报告，均不猜测。没有会话元数据和阅读能力。
- 稳定身份为 row ID + UTC 时间的 HMAC，模型/价格/文件位置不进入身份；复制的同一数据库行不重复计入。格式未覆盖的旧 schema 不会就地迁移；读取失败保留应用历史。
- 不把 tokensGenerated JSONL 与数据库混计。其他 Continue 日志、CLI 和补全/Agent 分类不在本批支持承诺中。

### Kilo：IDE 与 CLI 分开解析

- IDE 当前用量行的 `tokensIn` 含 cache read/write，扣除后得到非缓存输入。按参考实现的 `2025-11-02T00:00:00Z` 当前格式分界，或旧行明确的 `apiProtocol=openai`，识别 inclusive 输入。其余旧行口径不明则 `SOURCE_FORMAT_UNSUPPORTED`，不猜。
- CLI 复用 OpenCode message schema，但只读取固定投影。input/cache 为互斥桶；output 是否另加 reasoning，必须由报告的 `tokens.total` 证明。没有足够证据时 output 为 null、记录为 partial；原本的 total/cache/reasoning 冲突质量不降级为有效值。
- IDE 身份与 Cline 相同：task + ts；CLI 为 session + message ID。只在本行有模型时使用，不读正文补齐，也不采用客户端 cost。
- CLI 的已记录 message ID + 原调用时间 + 模型参与现有 OpenCode/MiMo 共享 schema 去重；Store 保留首次 Agent/entry/session 归属，并沿现有快照冲突规则处理不同副本。合成验证包括 Kilo 历史先落盘、OpenCode 副本后来出现及重启。
- IDE/CLI 之间没有已验证的迁移对应，不能宣称跨格式去重覆盖。没有安装和账号连接能力。

### Qwen：输出与 reasoning 的重叠需有证据

- input 的 `promptTokenCount` 含 cachedContentTokenCount。cache write 未报告，保持 null。
- 只有 `totalTokenCount=prompt+candidates` 时将 thoughts 视作 candidates 的子集；等于 `prompt+candidates+thoughts` 时才把 thoughts 加入规范 output；明确 thoughts=0 时也可确定 output。
- 无法证明重叠时 output 为 null，价格暂停；有正的源总量时保留源总量，否则保留可计算下界。矛盾总量不解除 `total-mismatch`，源 total=0 不用作默认值提示。报告 `USAGE_UNREPORTED`。
- 记录没有稳定 message ID 的已核对格式，以 session ID + 原时间 + 同时间计量行序号作 HMAC 身份；模型、token 桶和无用量正文行不改变身份。复制日志去重，同一时间的多次计量保留数量。裁剪、重写同时间调用顺序的部分日志无法证明完全等价，不承诺任意重叠片段的完美去重。
- 缺 session/time 不用文件路径或 mtime代替；跳过并报告 `SOURCE_ROW_INVALID`。

### Kimi：排除累计和重复 bookkeeping

- CLI 旧格式只读 `StatusUpdate.payload.token_usage`，input_other、output、input_cache_read、input_cache_creation 为分离桶；时间来自秒级 timestamp。
- Code 新格式只接受 `usage.record` 且 `usageScope=turn`；读取 inputOther/output/inputCacheRead/inputCacheCreation，时间来自 time。排除 session scope、缺 scope、step.end、llm.request 等事件。
- 旧消息有 message_id 时用其稳定去重；其他记录用 session + agent lane + 原时间 + 同时间序号，保留同时间调用数量。Code `agents/<agent>` 路径识别父 session 和 lane，子 lane 不与主 lane 混为同一调用。
- 模型只取新记录明确的 model。旧 CLI 未记录或模型为 `__...` 配置引用时保持 unknown，不读 config.json、不推算 kimi-for-coding 的历史实际模型，也不猜价格。reasoning 未报告为 null。
- 两种格式之间及任意部分重叠日志的对应关系尚未真实核对，不声称迁移去重已验收。

## 成熟项目依据

实现复用本项目已有 normalize、Store、快照选择、统计线程及 SQLite WAL 读取，不引入 SDK、新依赖或新的原生二进制。源码研究只读取公开仓库，没有执行上游代码/配置或使用 GitHub 账号。

- [tokscale 固定源码树](https://github.com/junhoyeo/tokscale/tree/b26c433d03f23a2255ad9f212512ce83ede83da3)（MIT，© Junho Yeo）：`crates/tokscale-core/src/sessions/roocode.rs`、`qwen.rs`、`kimi.rs`。借鉴格式与口径，不采用其从正文/配置补模型、缺值补零或日期映射模型的策略。
- [ccusage 固定源码树](https://github.com/ccusage/ccusage/tree/c4177eeb6f037bcfcdfe948c78699fb437399b41)（MIT，© ryoppippi）：`rust/adapters/kilo/src/loader.rs`、`parser.rs`，`adapters/kimi/src/parser.rs`。核对固定 message SQL 与 turn/session scope，未使用其账号/配置读取能力。
- Continue 官方仓库的 [`core/data/devdataSqlite.ts`](https://github.com/continuedev/continue/blob/main/core/data/devdataSqlite.ts)、[`core/llm/index.ts`](https://github.com/continuedev/continue/blob/main/core/llm/index.ts)、[`core/util/paths.ts`](https://github.com/continuedev/continue/blob/main/core/util/paths.ts)，于 2026-11-02 取得。公共 GitHub API 限流，未取得对应 commit，不将 main 链接称为固定版本。实际核对文件 SHA-256：
  - devdataSqlite.ts：`8660df289437fcb00ce1b0adc983b3a28c18bd276b8f8f7a6a3a8d9dce7f40d8`
  - llm/index.ts：`1e81cf6e96e415262950f23302562462fc7bf713ca4f2f62ade019a52e6198e6`
  - util/paths.ts：`40460e3e83f73d436c8cf62dfedc4007ba2d9c332688441721d6ff41ecb71845`

上述 tree SHA 是 Git tree 对象，不是 commit SHA。参考副本留在本工作树忽略的 `artifacts/agent-format-references`；实现为独立 CommonJS usage 投影，自建合成 fixtures，不导入上游工程或真实样本。

## 最终验证与局限

| 检查 | 结果 |
|---|---|
| 新增四来源 + 第一组三来源定向回归 | 通过；包括隔离 SQLite/WAL、输入与 reasoning 语义、重复/重启、估算不定价、正文哨兵、文件字节不变、跨 OpenCode/Kilo 首次归属 |
| `npm.cmd run verify` | **最终通过，fail 0**；包含 lint、UI typecheck 与全部单元测试 |
| `npm.cmd run test:native` | 通过；原生脚本仍主要覆盖既有 fixture；两个新增 Service 合成测试另覆盖本批七来源规范总量的原生投影，不证明真实格式正确 |
| `npm.cmd run audit:runtime` | 最终代码通过；仅新增一个可达纯投影模块 |
| `git diff --check` | 通过 |
| UI / 打包 / 解压 / 真实数据 / 长期内存 | 未执行，不声明通过 |

在第一组全量复跑通过后，新增四来源的全量 verify 通过。随后为 Kilo/OpenCode 跨来源归属及 Continue 稳定身份补充修正，最终 verify 再次通过、fail 0，最终 runtime audit 也通过；这是代码改变后的必要复测，不沿用上一版本结果。没有扩大超时、屏蔽测试或安装依赖。第一组最初失败的记录仍在其结果文档中。

证据日志：`artifacts/batch1-extra-targeted.log`、`batch1-extra-dedup.log`、`batch1-seven-verify.log`、`batch1-seven-final-verify.log`、`batch1-seven-native.log`、`batch1-seven-runtime.log`、`batch1-seven-final-runtime.log`。这些日志只来自合成测试，不包含真实记录。

## 完整首批交给 Claude

1. 新增 ID 为 `copilot/cline/pi/continue/kilo/qwen/kimi`；生产统计仍用已有白名单接口，无新 IPC。没有改 `ui/`、`design/desktop-reference/`、窗口、布局、组件或图标资源；暂用现有通用图标。
2. 七个来源都是 `usageOnly:true`；provider capabilities、setup、installer 不为它们提供登录/安装动作。前端应按能力显示，不把旧十 Agent 的连接/管理按钮直接套用。
3. Continue 的 `SOURCE_USAGE_ESTIMATED` 是数据口径提示，不是 IO 故障；显示客户端估算及价格未知。它没有 session 元数据。其余来源的 partial、unknown/unpriced 与字段覆盖按原协议表达。
4. Copilot 记录数是模型关闭区间，不是请求数；Qwen/Kilo 的 reasoning 歧义会令 output 未知；Kimi 旧日志的模型保持未知。不要在表达层补零/猜模型/隐藏冲突。
5. 没有为七来源增加正文阅读、resume 命令或全文检索；不能仅因有统计/会话 ID 就显示可阅读/可恢复。
6. UI、真实来源和打包验收仍独立。Claude 对接时跑受影响的合成源码 UI 套件；所有者后续如授权真实核对，才通过 `validate:local` 在具体范围内进行。本次没有真实格式兼容证明和新 M12 内存达标结论。

首批七个来源到此收口，不自动扩展 Windsurf、Warp、Junie 等候选。
