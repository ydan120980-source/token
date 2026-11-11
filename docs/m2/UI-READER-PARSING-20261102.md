# 阅读页第二组：改动、用量、子 Agent、跟随、代码颜色（2026-11-02）

**状态**：已实现，合成数据源码模式下核对；打包和真实数据未验收，也没有用任何真实会话验证过解析。所有者 2026-11-02 要求第一组完成后直接做第二组。

读取范围只多了一项：Claude Code 子 Agent 的记录（见第 3 节）。其余仍是打开时现读、不写入任何地方。

## 格式核对

只按公开源码或文档实现，没有读真实记录。

| Agent | 改动 | 每轮 Token | 依据 |
|---|---|---|---|
| Claude Code | Edit、Write（`file_path`、`old_string`、`new_string`、`content`） | `message.usage`，同一消息只算一次 | 官方 hooks 文档；用量规则同 `sources.js` |
| Codex | `*** Begin Patch` 格式，含 shell 调用 apply_patch | `token_count` 的 `last_token_usage`，重复上报只算一次 | `openai/codex` 的 `apply-patch/src/parser.rs`；`sources.js` |
| Gemini CLI | replace、write_file（字段同 Claude Code） | 消息的 `tokens` | `gemini-cli` 的 `base-declarations.ts`、`chatRecordingTypes.ts` |
| OpenCode | edit、write（`path` 或 `filePath`、`oldString`、`newString`），patch 格式 | 助手消息的 `tokens` | `anomalyco/opencode` 的 `tool/plugin/edit.ts`、`write.ts`；`sources.js` |
| DeepSeek Harness | edit、write、apply_patch、str_replace_editor | `assistant/message`、`assistant/attempt` 的 usage，继承的历史不算 | `deepseek-harness` 的 `tool-fs`、`tool-str-replace-editor`；`extended-sources.js` |
| MiMo Code | 走 OpenCode 的解析 | 同 OpenCode | **没有单独核对**，只是和 OpenCode 共用读取路径 |
| Antigravity | 后来补上，见 `UI-READER-POSITION-20261102.md` | 同左。这里原先写“用量在另外的数据库里”，是错的 | 没有官方格式，依据第三方实现 |

MultiEdit 不在当前文档里，按字段形状兼容旧记录，这一点没有来源确认。OpenCode 工具的 `patch` 参数名只核对到 patch 格式本身，所以按“任何参数里出现 `*** Begin Patch`”来识别。

## 1. 改动视图和改过的文件

- 工具行写文件名和 `+增 −删`，展开看增删对比。对比内容在展开时才读取，窗口平时只留文件列表。
- 右栏“改过的文件”按首次改动排序。点一个文件只看改过它的轮次，并展开这些改动。
- 查找、跨会话搜索、复制整轮和导出都包含改动内容。
- **只认 Agent 的编辑工具**：用 shell 命令改的文件看不到，失败的调用不算。
- 整文件写入只算新增，因为记录里没有它覆盖掉的内容。
- 对比算法：先去掉相同的首尾；中间部分不超过 40000 个单元时逐行比较，超过就读作整段删除后整段新增。

## 2. 每轮用量

答复下方写“Token 1.5K”。整个会话都没有用量（Antigravity）时不显示这一行；只是这一轮没有时写“Token 未知”，从不写 0。只显示，不进统计。

## 3. 子 Agent

- Claude Code 现在把子 Agent 存在 `<会话>/subagents/agent-<id>.jsonl`（官方文档），所以只处理主文件里的 `isSidechain` 行不够。打开会话时也读这些文件，最多 64 个，合计不超过单文件上限。这是**新增的读取**，文件仍在已批准的来源目录和白名单内。
- 子 Agent 的步骤按时间插入，折成“子 Agent · N 步”，它的提示不算你的一轮，它的 Token 加到所在的轮次。
- 这个文件和会话的对应关系按路径确定，插入位置按时间确定，没有依赖工具结果里的字段。

其余 Agent 没有折叠：OpenCode 和 Codex 的子任务是单独的会话，这里只显示调用那一行。

## 4. 跟随

最后一条记录在一小时内的会话，标题栏有“跟随”。打开后每 4 秒只看记录的大小和时间，变了才重新读取，等待时间不少于上次耗时的 10 倍，所以大会话不会被连续重读。读到末尾时跟到最新，否则不动滚动位置。离开或换会话即停止，默认关闭。

OpenCode 和 MiMo Code 的记录在共用数据库里，同库的其他会话有活动也会触发重读。

## 5. 代码颜色

自己写的小分词器，没有新增依赖，覆盖常见语言；不认识的语言保持纯色。查找时和超过 64 KB 的代码块不上色。

**内存（合成会话：300 轮，每轮一段 80 行代码，渲染进程）：**

| 做法 | 渲染进程 | 节点数 |
|---|---|---|
| 不上色 | 147–155 MB | 约 17600 |
| 全部上色（第一版，已放弃） | 266 MB | 89290 |
| 只给视口附近上色（现在） | 163–164 MB | 约 18070 |

这是合成的极端情况，不代表真实会话。全进程合计波动较大（647–854 MB），不能用来下结论。M12 的 300–500 MB 目标这次没有重新测量。

## 顺带修掉

折叠栏的来源管理角标盖住图标（所有者 2026-11-02 反馈）：`shell.css` 的规则压过了 `app-layout.css` 的折叠样式，角标保持了完整尺寸。现在是角落里的 8px 圆点，测试断言它不盖住图标。

## 测试

新增 `tests/m1/transcript-changes.test.js`，每个 Agent 一份合成样例；`scripts/m1/session-reader-ui-test.js` 覆盖 Codex 和 Claude Code 的界面流程。其余 Agent 的界面没有在它们的记录上跑过。
