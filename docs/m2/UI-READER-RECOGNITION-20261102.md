# 阅读页识别 Agent 写进对话的内容 · 2026-11-02

所有者问：阅读页里出现的 `<oai-mem-citation>`、`<external_codex_apps_open_page>` 这些内容，原会话从没见过，是上下文压缩吗？

**不是压缩。** 它们是 Codex 桌面版写进记录、但自己界面不显示的内容（依据见下），阅读页之前把原文全显示出来了。这次改成自动识别：要么折叠，要么提取成该有的样子。

下面只用合成样例验证过，没有用真实记录核对。

## 识别什么

代码在 `src/m1/transcript-marks.js`，七个 Agent 共用。

| 记录里的内容 | 是什么 | 现在怎么显示 | 依据 |
|---|---|---|---|
| 回复末尾的 `<oai-mem-citation>` | 回复引用的记忆，Codex 界面隐藏 | 从回复里拿掉，回复下方折叠成“引用了 N 条记忆”，右栏列出 | `openai/codex` `codex-rs/utils/stream-parser` |
| `<send_user_message_question_reply>` | 回答 Agent 提问，内容是 JSON | 气泡里显示问题和回答，目录显示“回答：…” | `codex-rs/tui/src/async_question_reply.rs` |
| `# Files mentioned by the user:` 和 `## My request for Codex:` | 应用附带的文件和本人的话 | 气泡只留本人的话，文件显示成附件 | `USER_MESSAGE_BEGIN`（官方）；文件行格式来自 `raycast/extensions`（第三方） |
| `<external_codex_apps_open_page>` | 打开应用页面的事件 | 不算一轮，折叠成“打开了一个应用页面” | `yetone/magpie`（第三方） |
| `<turn_aborted>`、`<subagent_notification>`、`<environment_context>` 等 | 系统写入的内容 | 不算一轮，按类型命名后折叠 | `raycast/extensions`、`yetone/magpie`（第三方） |
| `<user_shell_command>` | 本人在界面里跑的命令 | 显示成命令行 | `yetone/magpie`（第三方） |
| 其他形如 `<some_tag>…</some_tag>` 的整条消息 | 新版本可能加的标签 | 折叠成“注入的上下文” | 本项目的判断 |

**误判的处理**：整条消息只由带 `_` 或 `-` 的标签组成才会折叠。如果有人恰好贴了这样一段，它在折叠里还能看到，不会丢。普通的 `<b>` 或句子中间的标签不受影响。

## 上下文压缩

真正的压缩现在单独标出来，所有者之前看不到它发生在哪：

- 对话里显示“上下文在这里压缩了”，有数据时带“自动/手动”和压缩前 Token。
- 压缩摘要折叠显示，不再当成本人的问题。
- 右栏“这段对话”列出每次压缩的位置，点击可跳转。

| Agent | 记录形式 | 依据 |
|---|---|---|
| Codex | `compacted` 行、`context_compacted` 事件 | `codex-rs/protocol/src/protocol.rs` 有 `ContextCompacted`；`compacted` 行的字段未单独核对 |
| Claude Code | `compact_boundary`、`isCompactSummary` | 第三方解析器 |
| OpenCode、MiMo Code | `compaction` 部分 | 官方仓库有此类型，字段未逐一核对 |
| Gemini CLI、DeepSeek Harness、Antigravity | 没有识别 | 没有查到可靠格式 |

## Codex 的代码模式

所有者截图里“跑过的命令”显示的是 `const results = await Promise.allSettled([…`。这是 Codex 的代码模式：模型写一段 JavaScript 交给 `exec` 工具，里面再调用真实工具（`codex-rs/code-mode-protocol/src/description.rs`）。

- **现在**：从源码里读出 `tools.exec_command({cmd:"…"})` 的命令，一次调用跑多条就列多条。读取时只做文本匹配，**不执行**。
- **没有工具调用的脚本**（如 `store(...)`）：不算命令。
- **命令写在变量里**（如 `cmd: c`）：读不出来，不算进“跑过的命令”，这是已知限制。
- **`tools.apply_patch`**：进入改动视图。
- **失败标记**：`exec_command` 的结果写着 `Process exited with code N`，非 0 算失败。代码模式的输出没有统一格式，这里不判断失败。

## 其他修正

- **轮数**：之前开场内容也占一个序号，所以会出现“共 20 轮”却有“第 21 轮”。现在只按本人的提问计数，开场内容叫“开头”。
- **目录标题**：不再显示 Markdown 的 `##`。
- **吸顶问题栏**：背景改成不透明，文字不会从下面透出来。
- **复制和导出**：记忆引用不再混进复制的回复里。

## 没有做

- 没有用真实记录核对，上面标“第三方”的格式尤其需要核对。交接里的真实样本一步加了这些内容。
- 附件只有文件名和路径，不读取文件内容。
