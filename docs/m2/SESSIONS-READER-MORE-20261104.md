# 会话阅读补全：其余 Agent · 2026-11-04

**状态：都能阅读。只用合成数据验证，没有用任何真实记录核对过格式。** 所有者决定把会话阅读补全到还不支持的 Agent（2026-11-04）。读取规则不变，见 `SESSIONS-READER-20261101.md`：点开时现读，只显示，不保存，不上传。读取器在 `src/m1/transcript-more.js`。

| Agent | 读什么 | 格式依据 | 可信度 |
|---|---|---|---|
| Pi | `~/.pi/agent/sessions/**/*.jsonl` | 官方 pi-mono `session-manager.ts`、`ai/types.ts` | 公开源码 |
| GitHub Copilot CLI | `session-state/<id>/events.jsonl` | 官方 copilot-sdk `generated/session-events.ts` | 公开源码 |
| Qwen Code | `projects/*/chats/<id>.jsonl` | 官方 `chatRecordingService.ts` | 公开源码 |
| Cline、Kilo Code（IDE） | `tasks/<id>/api_conversation_history.json` | Anthropic 消息格式；Cline 的文件名是已知公开约定，这次没有逐行核对源码 | 公开约定 |
| Cline CLI | `<id>/<id>.messages.json` | Codex 用量读取器已核对的结构 | 公开源码 |
| Kilo Code CLI | `kilo.db` 的 message、part | Codex 记录：沿用 OpenCode 结构 | 公开源码 |
| Kimi CLI | `wire.jsonl` | 官方 `wire/types.py`、kosong `message.py` | 公开源码 |
| Continue | `~/.continue/sessions/<id>.json` | 官方 `core/index.d.ts` | 公开源码 |
| ZCode | `db.sqlite` 的 message、part | **第三方描述**（一个 Ruby 客户端和一篇博客），官方没有公开 | 未核对 |
| Cursor | `agent-transcripts/**/<id>.jsonl` | **第三方描述**（agent-chorus、Cursor 论坛） | 未核对 |
| WorkBuddy | 项目 JSONL | **第三方用量解析器**只说明了行类型，正文形状是按兼容方式读的 | 未核对 |

Cline、Kilo、Cursor、Continue 的正文文件不在用量扫描的白名单里，读取时走单独的名单（`policy.js` 的 `transcript:`），用量采集因此不会多读任何文件，有测试检查。

## 已知缺口

- **Continue 的会话没有用量。** 它的用量表没有会话标识，所以列表来自它自己的 `sessions/sessions.json`（所有者 2026-11-04），只读会话 ID、标题、时间和目录，不读消息。这些行的记录数是 0，Token 和费用显示未知，不显示 0；用量统计不受影响。
- **Kimi Code 的新日志读不了。** 公开资料只说明了用量事件，没有说明正文，读到时显示“这个 Agent 还不能阅读对话”，不显示空白。Kimi CLI 的日志可以读。
- **Cursor 的记录只有文字和工具调用**，没有工具结果和时间。第三方资料说法不一。另外用量里的 Cursor 会话标识和对话文件名是否一致没有证据，对不上时显示“找不到这个会话的记录文件”。
- **恢复命令（resume）** 没有为这些 Agent 增加。

所有格式都要等所有者授权后，用 `validate:local` 这类真实核对才算验证过。

## 验证

只用合成数据，源码模式。`agents-batch1` 把 7 个新 Agent 的合成对话写进假的主目录，由真实采集读取，再逐个在阅读页打开，看到正文才算通过。ZCode、Cursor、WorkBuddy 只有单元测试，没有在阅读页打开过。

`sessions-reader-extras` 这轮跑一次通过。`sessions` 第一次在“未知项目的详情打不开”失败，之后连续 2 次通过，原因没有查明。`quota-probe-process` 在全量 `verify` 里失败过一次，这轮没动它，单独跑 4 次、全量再跑 2 次都通过，也没有查明。
