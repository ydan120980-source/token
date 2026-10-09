# 隐私与数据处理

本文说明 Agent Usage 读取什么、不读取什么、以及数据存在哪里。实现位置：`src/m1/policy.js`、`src/m1/sources.js`、`src/m1/extended-sources.js`、`src/quota/`。

## 读取范围

应用只读取你本机已经存在的 AI 编码 Agent 记录，且只读取下面九个来源的白名单路径：

Codex、Claude Code、OpenCode、WorkBuddy、MiMo Code、Gemini CLI、Cursor、ZCode、DeepSeek Harness。

完整路径与各来源允许的文件类型定义在 `src/m1/policy.js:6`（`roots()`）与 `:23`（`allowedFile()`），逐来源字段口径见 [docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md](m2/AGENT-INTEGRATION-CONTRACT-20261005.md)。

**只有下面这些字段会进入统计**：模型标识、各 token 桶计数（input / output / cache read / cache write / reasoning）、时间戳、来源与 Agent 标识、会话级去重标识。

## 明确不读取

- **认证与凭据文件。** 文件名以 `auth`、`credentials`、`config`、`settings`、`storage`、`token`（后随 `._-` 或结束）开头的文件一律拒绝。
- **会话正文与标题。** 统计投影不包含消息内容。
- **绝对路径。** 投影中不含本机路径。
- **邮箱、设备名、凭据。** 不进入快照，不进入导出。
- **Codex 凭据。** 额度通过独立官方 CLI 子进程读取，凭据存于系统 keyring，应用本身不接触。

## 不修改

源数据库以只读方式打开：将原始字节（含已提交的 WAL 页）载入内存后由 sql.js 查询，不建立持久连接、不加写锁、不迁移 schema、不执行 checkpoint。**应用从不写入任何 Agent 的数据库或配置。**

## 不传输

统计、凭据和用量数字都不离开本机。仅有的两个出网点是：

1. 公开价格快照：固定 URL `https://models.dev/api.json`，在独立子进程中 GET（16 MB 上限、15 s 超时），子进程环境被裁剪为 `ELECTRON_RUN_AS_NODE` / `SYSTEMROOT` / `WINDIR` / `TEMP` / `TMP`，不传递 HOME 或代理变量。
2. Codex 官方 CLI：仅在用户主动使用"额度监控"时启动。

渲染层 CSP 为 `connect-src 'none'`，主进程拒绝所有非 `file:` / `devtools:` 的请求。

## 存储位置与清除

| 内容 | 位置 |
| --- | --- |
| 用量历史、采集偏好、统计备份 | `%APPDATA%\AgentUsage-M1` |
| 额度连接缓存、独立 CLI home | `%APPDATA%\AgentUsage-M1-Quota` |

删除这两个目录即可彻底清除本应用产生的全部数据。应用不会删除你的原始 Agent 记录——源文件始终由对应的 Agent 工具自己管理。

统计导出功能只输出上述白名单字段，不包含原始记录或身份信息。

## 已知的隐私相关限制

- `docs/m1/DESKTOP-UI-BASELINE.md` 记录了界面参考来源；其中引用的公开主页属于设计参考，未复制进 fixtures 或可分发源码。
- 界面中的"个人资料"（名称、简介、头像）保存在浏览器 localStorage，仅本机使用，不上传。默认值不含任何个人信息，请在首次使用时自行填写。
- 应用无自动更新、无遥测、无崩溃上报。
