# Agent Usage

Windows 本地 AI 编码 Agent 用量统计 + Codex 账号额度监控。完全离线运行，本地优先。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20x64-lightgrey)
![Node](https://img.shields.io/badge/node-%3E%3D22.15.0-green)

## 这是什么

一个 Windows 桌面应用（Electron），只读解析本机九个 AI 编码 Agent 的会话记录与本地数据库，把 token 用量、模型分布、时间趋势汇总成一个界面，并单独展示 Codex 账号的套餐额度与刷新窗口。

## 这不是什么

设计上刻意不做的四件事，也是本项目的安全边界：

- **不读取认证文件。** 文件名以 `auth` / `credentials` / `config` / `settings` / `storage` / `token` 开头的文件一律拒绝（`src/m1/policy.js:23`）。Codex 额度走独立官方 CLI 子进程，凭据存在系统 keyring。
- **不修改来源数据库或配置。** 源 SQLite 字节（含已提交 WAL 页）读入内存后由 sql.js 只读查询，不建连接、不加写锁、不迁移、不 checkpoint（`src/m1/policy.js`、契约见 `docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md`）。
- **不上传任何数据。** 统计留在 `%APPDATA%\AgentUsage-M1`，凭据留在系统 keyring，服务端不落地。
- **不发送推理或工具调用。** 额度只读取窗口与用量数字，不含会话内容。

采集只依赖本机已有文件。除了获取公开模型价格快照（`https://models.dev/api.json`，独立子进程、固定 URL）和 Codex 官方 CLI 本身，应用不发起其他网络请求。

## 环境要求

- Windows 10 / 11 x64
- Node.js `>=22.15.0`（见 `package.json` 的 `engines`）
- 可选：本机已安装 `codex` CLI（仅"额度监控"需要）

其他平台不在支持范围内：`package.json` 只声明 `win` x64 target，且 `src/m1/policy.js` 的来源根路径按 Windows 约定解析。

## 快速开始

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
npm.cmd start
```

第二条命令是必需的：`--ignore-scripts` 会跳过 Electron 的 postinstall，该脚本才会真正下载 Electron 二进制；跳过它 `npm start` 会直接失败。

首次启动后界面可能显示空数据，这是正常的——本机还没有任何 Agent 的会话记录。数据目录 `%APPDATA%\AgentUsage-M1` 也在首次运行时才创建。

只想看界面（不启动 Electron、不调用原生采集）：

```powershell
node design/desktop-reference/serve.js
# 打开 http://127.0.0.1:4178/
```

这是合成数据的开发预览，不连接真实来源、不能登录账号。

## 支持的来源

| Agent | 读取位置 | 读取内容 |
| --- | --- | --- |
| Codex | `~/.codex/sessions`, `~/.codex/archived_sessions` | 会话 JSONL |
| Claude Code | `~/.claude/projects`, `~/.claude/transcripts` | 会话 JSONL |
| OpenCode | `~/.local/share/opencode` | 消息 JSON / SQLite |
| WorkBuddy | `~/.workbuddy/projects`, `workbuddy.db` | JSONL / SQLite |
| MiMo Code | `~/.local/share/mimocode` | SQLite |
| Gemini CLI | `~/.gemini/tmp`（路径含 `chats`） | 会话 JSON/JSONL |
| Cursor | `~/.cursor/projects` | SDK `index.db` / `runs.ndjson` / usage CSV |
| ZCode | `~/.zcode/cli/db/db.sqlite` | SQLite |
| DeepSeek Harness | `~/.dsh/sessions`, `~/.dsh/profiles/desktop/sessions` | 会话 JSONL（含 zstd） |

路径定义在 `src/m1/policy.js:6`。逐个来源的字段口径、去重规则与已知限制见 [AGENT-INTEGRATION-CONTRACT-20261005.md](docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md)。

**账号额度目前仅支持 Codex。** 其余来源只统计用量，不读取账号套餐。

已知缺口需要在贡献前了解：Gemini CLI 与 Cursor 目前**只有格式合成样本与 Electron 测试，没有真实调用样本**，因此不能认为这两个来源的真实数据已被验收；ZCode 没有官方数据库合同，按投影字段读取。

## 数据位置

| 内容 | 位置 |
| --- | --- |
| 用量历史与采集偏好 | `%APPDATA%\AgentUsage-M1` |
| 额度连接、缓存、独立 CLI home | `%APPDATA%\AgentUsage-M1-Quota` |

删除这两个目录即可完全清除本应用产生的数据。应用不会删除你的原始 Agent 记录。

## 隐私与数据处理

见 [docs/PRIVACY.md](docs/PRIVACY.md)。关键是：统计只包含白名单字段（模型名、token 桶、时间戳、来源标识），不含会话正文、标题、绝对路径、邮箱、凭据或设备名。

## 定价模型

内置 `src/m1/models-dev-prices.json` 定价快照，可手动同步公开价格数据。三条硬规则：

- 未知用量永远不填 0；缺失保持 `null` 并显示为"未知"。
- 未知价格永远不当作免费；显示为"未定价"。
- 冲突保护不为了凑总额而关闭。

因此界面上的 API 等价估算只是估算，未定价的模型会单列而不是计成 0。

价格快照的更新流程见 [docs/m1/PRICING-SYNC-20261004.md](docs/m1/PRICING-SYNC-20261004.md)；用 `npm run pricing:check` 检查当前快照是否偏离已评审来源，`npm run pricing:sync` 重新生成。

## 开发

```powershell
npm.cmd run verify          # ESLint + 单元测试（117 项）
npm.cmd run test:native     # 需要 tokscale 原生二进制
npm.cmd run test:ui         # 需要 Playwright + 显示器
npm.cmd run test:quota:ui
npm.cmd run test:stress
npm.cmd run experiment:crypto
npm.cmd run audit:runtime
```

`verify` 之外的大多数脚本需要 Playwright、Electron 或真实显示器。所有维护用 UI 测试都使用独立的 usage/quota 目录和合成 fixture home，不触碰真实数据。

**唯一会读取你真实用量来源的是 `npm run validate:local`**，它不是例行测试，不纳入 `verify`。

贡献流程、数据语义铁律与已知陷阱见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 项目结构

```
src/quota/      Electron 主进程、IPC、额度 RPC、窗口外壳（产品入口）
src/m1/         共享统计库：来源策略、解析、存储、定价（不是第二个应用）
design/desktop-reference/   渲染层 HTML/CSS/JS
scripts/m1/     开发与验收脚本
tests/m1/       单元测试
docs/m1/, docs/m2/   设计与验收记录
```

`src/m1/` 是共享库，不是"M1 版应用"——历史上曾有一个独立的 M1 界面，已删除。

## 打包

```powershell
npm.cmd run dist:win:dir -- --config.directories.output=dist/r10
```

输出为未签名的 `win-unpacked/` 目录，必须整体保留（不能只复制 exe）。

## 已知限制

- 构建产物**未签名**（`signAndEditExecutable: false`），Windows SmartScreen 会警告。`@tokscale` 原生二进制在 spawn 前不校验哈希。
- 数据损坏时应用会显示错误并退出，**没有自动恢复到备份的入口**。备份文件确实会生成（`backups/statistics-before-*.json`），但需要手动替换。
- 原生验证（tokscale 交叉校验）失败会丢弃整轮采集结果，而不是保留本轮扫描。
- 摘要首次统计 2 万行数据时主线程会阻塞约 334–364 ms。
- 物理 DPI 缩放、Windows 窗口吸附、长时间连续运行未做系统化验收。曾出现过一次窗口关闭错误，根因未定位。
- 没有内核级网络审计；网络封锁是 Node 层的 API 拦截（`src/m1/policy.js:66`）。
- 未使用读屏软件实测；无障碍检查见 [A11Y-REVIEW-20261008.md](docs/m2/A11Y-REVIEW-20261008.md)。
- 配对、跨设备同步、生产密钥与 iOS 端均未开始。本项目目前只有 Windows 桌面端。

## 文档索引

- [数据合同与去重](docs/m1/DATA-CONTRACT.md)
- [Codex 登录与额度边界](docs/m1/CODEX-QUOTA.md)
- [九来源接入合同](docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md)
- [桌面端范围与同步边界](docs/m2/DESKTOP-SCOPE-20261004.md)
- [上游来源与复用边界](docs/m1/UPSTREAM.md)
- [第三方资产归属](design/desktop-reference/LICENSES.md)

## 贡献与安全

- 贡献流程：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全报告：[SECURITY.md](SECURITY.md)

## 许可与归属

MIT，见 [LICENSE](LICENSE)。第三方组件、图标、字体与定价数据来源见 [NOTICE](NOTICE) 与 [design/desktop-reference/LICENSES.md](design/desktop-reference/LICENSES.md)。

本项目源自 [token-monitor](https://github.com/Javis603/token-monitor)（MIT，Javis）的维护分支，上游 provenance 与复用边界见 [docs/m1/UPSTREAM.md](docs/m1/UPSTREAM.md)。
