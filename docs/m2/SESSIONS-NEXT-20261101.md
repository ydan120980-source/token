# 会话页下一步（决策记录）· 2026-11-01

**状态**：所有者 2026-11-01 批准第 1、4、5、6、7 项，第 2、3 项先出界面草图。Claude 已实现第 1、4、5、6、7 项，只用合成数据在源码模式下验证；没有用真实样本核对，没有做打包验收。

**关系**：扩展 [SESSIONS-LAYER1-20261012.md](SESSIONS-LAYER1-20261012.md)。该记录第 2 层（标题、末条消息预览、全文搜索）原先不批准；本记录只批准其中的**标题**，而且只取 Agent 自己保存的标题字段。末条消息预览、正文搜索和完整对话（第 3 层）仍不做。

## 1. 所有者的决定

| 项 | 内容 | 决定 |
|---|---|---|
| 1 | 会话按项目或按时间分组 | 做 |
| 2 | 会话时间线（每个 Agent 一条横道，画会话跨度） | 先出界面草图；所有者看过后改为概览的“当前窗口里的会话”小组件，见 [SESSIONS-READER-20261101.md](SESSIONS-READER-20261101.md) 第 5 节 |
| 3 | 会话与额度窗口对应 | 同上，并入同一个小组件 |
| 4 | 搜索覆盖工作目录和会话 ID | 做 |
| 5 | 补齐恢复命令（按官方或公开源码核实） | 做 |
| 6 | 自己给会话起名、置顶 | 做 |
| 7 | 读取会话标题 | 做，只取 Agent 自己保存的标题 |

参考：CC Switch 的会话管理（MIT，`farion1231/cc-switch`，本次核对的提交 `8be8405`，2026-10-31）可以按项目或时间分组，搜索标题、目录、消息和 ID，复制恢复命令。它的阅读视图、消息搜索和批量删除不在本记录范围内：删除会改动 Agent 自己的文件，项目规则禁止。

## 2. 标题从哪里来

只取 Agent 自己作为“标题”保存的字段。没有这种字段的 Agent 没有标题，**不从消息正文截取**（CC Switch 对 Gemini CLI、DeepSeek Harness 等用第一条用户消息作标题，本项目不这样做）。

| Agent | 标题来源 | 依据 |
|---|---|---|
| Codex | Codex 主目录下的 `session_index.jsonl`，只取每行的 `id` 和 `thread_name`；同一 id 以最后一行为准 | 旁证：CC Switch `codex.rs` |
| Claude Code | 会话 JSONL 中 `type: "custom-title"` 行的 `customTitle`（`/rename` 写入）；以最后一次为准 | 旁证：CC Switch `claude.rs` |
| OpenCode、MiMo Code | `session` 表的 `title` 列（列存在时），与已读取的 `id`、`directory` 同一行 | 旁证：CC Switch `opencode.rs`；MiMo Code 与 OpenCode 同结构 |
| Antigravity | `conversation_summaries.db` 中该对话的 `title` 列；`preview` 列不读 | 旁证：CC Switch `agy.rs` |
| Gemini CLI、DeepSeek Harness、WorkBuddy、ZCode、Cursor | 没有标题 | 没有 Agent 自己保存的标题字段，或未核实 |

`session_index.jsonl` 是新增的读取文件：只在来源目录是 Codex 的 `sessions` 或 `archived_sessions` 时，读它们上一级目录里的这一个文件，不超过 16 MB，不跟随链接，读取失败就当作没有标题。它的修改时间计入来源指纹，改名后下一次采集会更新。

标题整理成一行，最多 120 个字符。

## 3. 恢复命令

| Agent | 命令 | 依据 |
|---|---|---|
| MiMo Code | `mimo -s <ID>` | 官方：MiMo Code CLI 选项页，`--session`/`-s` 为“Session ID to continue” |
| Antigravity | `agy --conversation=<ID>` | 旁证：CC Switch `agy_config.rs`；只支持默认配置，不带 `--gemini_dir` |
| DeepSeek Harness | 无 | CC Switch `dsh.rs` 说明恢复由 Harness 自己的网页界面负责 |
| WorkBuddy、ZCode | 无 | 没有找到公开的恢复命令 |

命令仍沿用第 1 层的安全要求：会话 ID 严格校验，目录用 PowerShell 单引号字面量，只复制到剪贴板，不由应用执行。

## 4. 名称和置顶

- 保存在应用自己的文件 `session-labels.json`（统计数据目录下），按哈希后的 `sessionKey` 记录；不保存原始会话 ID 或目录。
- 不进入统计快照、统计导出和查询接口，也不写入任何 Agent 的文件。
- 名称整理成一行，最多 120 个字符；清空名称就删除它，回到 Agent 自己的标题。

## 5. 界面

- 会话页新增“按项目 / 按时间”分组。按时间按最后活动的本地日期分为今天、昨天、近 7 天、近 30 天、更早。
- 置顶的会话单独排在最前面的“置顶”组。
- 会话行先显示名称（你起的名字优先，其次是 Agent 的标题），后面是时间；没有名称时与原来相同。
- 会话详情可以改名称、开关置顶；有 Agent 标题时另外显示“Agent 里的标题”。
- 搜索覆盖名称、Agent 标题、项目、目录、模型和会话 ID。第 4 项里的目录和会话 ID 搜索此前已经实现，本次补上名称和标题。

## 6. 隐私

- 标题保存在本机统计库的会话元数据里，与原始会话 ID、工作目录同一规则：只在本机会话页显示，不进入统计快照、统计导出、查询接口、日志和错误文本。
- 一次新的观测完整替换会话元数据：来源不再给出标题时，标题随之删除。

## 7. 验证

- 单元测试：各来源的标题只来自上表字段，Gemini CLI、DeepSeek Harness、WorkBuddy 和 ZCode 即使有可读文本也没有标题；标题不进入统计导出；`session_index.jsonl` 改名会改变来源指纹；删除标题后元数据随之删除；标题整理规则；MiMo Code 和 Antigravity 的恢复命令；名称和置顶的保存、重启后读取、非法输入拒绝、外来文件忽略；按时间分组、置顶在前、名称优先级和搜索。
- `npm run verify` fail 0，`npm run audit:runtime` 通过。
- 界面套件（源码模式，合成数据）：`sessions`、`widgets`、`overview` 通过。`sessions` 第一次运行在“duration rendered”断言处失败一次，随后连续两次通过，同一版本在 main 上也通过；按偶发记录，没有改测试。
- 截图核对：按项目、按时间、置顶组、详情里的名称和置顶开关。

## 8. 没有做的

- 第 2、3 项不在会话页做，已改为概览小组件（见上）。
- 概要卡片和小组件里的“最近会话”仍显示项目名，还没有显示会话名称。
- 真实样本核对：各来源的标题字段只在合成数据上验证；真实数据只能通过 `validate:local` 核对。
