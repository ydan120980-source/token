# 会话阅读内容不全：检查与修复 · 2026-11-05

所有者：“我的 11.3 版的会话读取内容不全，你检查并全量修复，当前会话读取的 agent 都支持了吗。”

**状态：** 机制上修完，只用合成数据验证。**没有读取所有者的真实记录**（没有这项授权），所以“所有者看到的那一处缺失”具体是下面哪一条，没有证据确认。`scripts/local/reader-coverage.js` 由所有者在自己机器上运行，只输出计数和行类型名，不输出正文。

## 哪些 Agent 能读

11.3 版（`dist/20261103-multi-reader`）只读 7 个：Codex、Claude Code、OpenCode、MiMo Code、Gemini CLI、DeepSeek Harness、Antigravity。其余 10 个在那一版点不开对话。

当前全部 17 个内置 Agent 都有读取器。格式依据的可信度不同：

| 依据 | Agent |
| --- | --- |
| 公开源码，本轮又核对了 Codex 的 `rollout/src/policy.rs`、`protocol/src/models.rs` | Codex |
| 公开源码或公开约定，未在真实记录上核对 | OpenCode、MiMo、Gemini、DeepSeek、Antigravity、Pi、Copilot、Qwen、Cline、Kilo、Kimi CLI、Continue |
| Claude Code 没有公开格式：来自 CC Switch 和其他第三方描述，部分行类型来自记忆，标注见代码 | Claude Code |
| 第三方描述 | ZCode、Cursor、WorkBuddy |

读不了或读不全的：Kimi Code 新日志（公开资料没有正文格式，明确提示不支持）；Cursor 记录本身没有工具结果和时间；自定义 JSONL 来源没有读取器。

## 查出的丢内容

| 位置 | 现象 | 修复 |
| --- | --- | --- |
| 阅读页 | 切到“只看对话”或单个文件再切回，**只显示前 30 轮**，后面滚不出来。观察器看的是旧元素 | 观察器跟着元素和页数重建 |
| 阅读页 | 工具调用之间 Agent 说的话全折在“执行过程”里，最后一条之外都看不到 | 说的话留在页面上，只折叠中间的步骤，一段步骤一行，和 Codex、Claude Desktop 一样 |
| 取全文 | 一个会话的文件指纹超过 200 字符（Claude Code 约 10 个子 Agent 起），“显示全部”、查找、复制、导出**全部失败** | 指纹定长 |
| 长回复 | 问题和回复超过 8 KB 只显示前 1200 字，要点按钮 | 问题和回复 256 KB 内直接完整显示 |
| 超长会话 | 总量超过 24 MB 后**直接丢弃后面的所有条目** | 预览变短，条目一个不少，全文可取；条目上限 10 万到 50 万 |
| 大文件 | 超过 128 MB 不读 | 512 MB，和通用读取上限一致；图片数据只在要显示时才留在内存 |
| 子 Agent | Claude Code 超过 64 个文件或累计 128 MB 的**静默丢弃**；早期版本放在会话旁边的 `agent-*.jsonl` 没读；OpenCode 系的子会话没读；Qwen、Cursor 的子 Agent 没读；跨会话搜索也搜不到子 Agent | 全部读入，按时间放到对应位置 |
| Claude Code | 排队发送的消息（工作时打的字）、服务端工具和 MCP 工具、文档块、工具返回的截图、本地命令输出、接口错误都没有显示 | 都显示 |
| Codex | `agent_message`、`tool_search_*`、`image_generation_call`、推理原文、工具返回的图片和列表形式的输出、网页搜索的打开和页内查找、中断、计划都没有或显示成乱码；早期 rollout 和只有事件的文件读出来是空的 | 都显示 |
| OpenCode 系 | 旧的 JSON 文件存储完全读不了（`storage/`、`project/*/storage/session/`）；子任务、重试、Agent 自己加的文字、回复错误被丢 | 都显示 |
| 其他 | Gemini 的警告和图片、Antigravity 没有结果的调用、Copilot 和 Kimi 的通知、Cline 与 Cursor 不认识的块 | 都显示 |

新规则：**读到的每一行要么显示，要么明确列在“只是元数据”的名单里。** 程序不认识的行和块折叠显示为“未识别的记录 · 类型”，不再消失；对不上调用的工具结果显示为“工具结果”。折叠的“注入的上下文”依然折叠。

`tests/m1/transcript-coverage.test.js` 给每种形状放一个独有标记，断言标记能到达窗口。

## 取舍

- 问题和回复完整下发，单个阅读页内存会比之前略高。**内存没有复测。** 见 `RESULTS-READER-MEMORY-20261103.md` 的目标。
- 部分 Claude Code 行类型（排队消息、`progress` 内嵌的子 Agent）依据记忆和第三方资料，没有真实记录证据。形状不对时最多落到“未识别的记录”，不会丢。
- 早期 Claude Code 的兄弟文件要读每个候选文件开头 64 KB，上限 5000 个，打开大项目目录下的会话可能慢一点。
- Codex 的子 Agent 线程是独立文件，这轮没有并入父会话，它们在列表里是自己的会话（未核对是否都列出）。
- `sessions-reader-extras` 第一次在 150% 的“查找输出末尾”处失败，之后连续 2 次通过，原因没有查明。这条断言这轮之前也不稳定。
