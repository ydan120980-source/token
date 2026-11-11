# 阅读页记住读到哪，以及 Antigravity 的改动和用量（2026-11-02）

**状态**：已实现，合成数据源码模式下核对；打包和真实数据未验收。所有者 2026-11-02 决定：先开“记住读到哪”，书签和备注、记录外的本地图片、独立窗口先不做。这是对“阅读什么都不留”的一次放宽，只放宽下面这一项。

## 记住读到哪

- **保存什么**：第几轮，一个整数。存在应用自己的 `session-labels.json`，和名称、置顶同一条记录，按哈希后的会话键。不存内容、问题文字、滚动像素或时间。
- **何时保存**：停在某一轮 2 秒后，或离开阅读页时。回到第一轮时删除这个数字。
- **何时恢复**：再次打开时跳到那一轮开头。从对话内容搜索结果打开时，优先定位到搜索词。记录变短、那一轮不存在了就从头开始。
- **不进**统计、统计导出和查询接口，也不写入 Agent 的文件，和名称、置顶一样。
- 轮的编号按记录顺序。Agent 改写记录（Gemini 回退、Antigravity 压缩）后，同一个编号可能对应不同内容，这时只是位置不准，不影响别的。

## Antigravity

此前的记录（`UI-READER-PARSING-20261102.md`）说“用量在另外的数据库里”，**这是错的**：`src/m1/antigravity.js` 早就从 `PLANNER_RESPONSE` 行读 `input_tokens`、`output_tokens`、`cache_read_tokens`，数据库里只有模型名。

| 项 | 现在 | 依据 |
|---|---|---|
| 每轮 Token | 有这些字段的记录就显示 | 本项目的接入合约。`cc-sessions-viewer` 说 agy CLI 的记录没有这些字段，所以按产品版本可能显示不出来；没有就不显示这一行 |
| 改动 | `CODE_ACTION` 步骤：`[diff_block_start]` 到 `[diff_block_end]` 的差异，文件名取自“tool to: <路径>” | `cc-sessions-viewer`、`specstory-cli` 的 ANTIGRAVITY-FORMAT.md、`wakatime-cli`、`deja-vu` 四份独立实现或说明一致 |
| 新建文件 | “Created file file://…”，正文取自对应调用的 `CodeContent` | `specstory-cli` 的格式说明。配不上调用时不显示改动，不会写成空文件 |
| 工具行名称 | `PLANNER_RESPONSE` 的 `tool_calls` 按顺序对应后面的结果步骤 | `jolliai`、`agy-studio`、`cc-sessions-viewer` |
| 失败 | `status: ERROR`，或 `RUN_COMMAND` 文字里有 “The command failed with exit code” | `specstory-cli` 的格式说明：命令失败时状态仍是 DONE |
| 思考 | `thinking` 字段折叠显示 | 同上 |

**没有官方格式**。Google 没有公开这些格式，上面都是第三方根据观察写的，我也没有读过你机器上的记录，所以是“合成样例通过”，不是“真实记录验证过”。`multi_replace_file_content` 的差异块走同一路径，新建文件之外的其他工具没有处理。

## 测试

`tests/m1/session-labels.test.js`、`tests/m1/transcript-changes.test.js`、`scripts/m1/session-reader-ui-test.js`。
