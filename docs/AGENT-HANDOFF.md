# Agent 交接说明

> **读者**：第一次接手本项目、**没有任何历史上下文**的 AI 编码 Agent（本项目的双主开发都在用 Claude Code）。
> 本文假设你是刚 clone 完仓库、对项目一无所知。读完本文你应该能独立跑起来、改对地方、不踩已知的坑。
> 面向人类的上手说明是 [README.md](../README.md)，贡献规则与数据语义铁律是 [CONTRIBUTING.md](../CONTRIBUTING.md)。本文是给 Agent 的第三份，偏"接手时你需要知道但没人会主动告诉你"的部分。

---

## 1. 这个项目是什么

Windows 本地桌面应用（Electron），**只读**解析本机九个 AI 编码 Agent 留下的会话记录与本地数据库，汇总 token 用量、模型分布、时间趋势，并单独展示 Codex 账号的套餐额度与刷新窗口。

- 语言/栈：**纯 JavaScript + CSS**。无 TypeScript、无打包器、无框架、无 ES module。渲染层用 `classic <script src>` 逐个加载。
- 运行时：Node.js `>=22.15.0`，只支持 Windows 10/11 x64。
- 生产依赖只有两个：`sql.js@1.14.2`、`tokscale@4.17.0`。
- 完全离线。唯一的出网点是获取公开模型价格快照（`https://models.dev/api.json`，独立子进程、URL 固定）。

**四条硬边界**（也是评分点，改动时不要越界）：

1. **不读认证文件。** 文件名以 `auth` / `credentials` / `config` / `settings` / `storage` / `token` 开头的文件一律拒绝。
2. **不改来源数据库或配置。** 源 SQLite 的字节（含已提交的 WAL 页）读进内存后用 sql.js 只读查询——不建连接、不加写锁、不迁移、不 checkpoint。
3. **不上传任何数据。**
4. **不发送推理或工具调用。** 额度只读窗口与用量数字。

九个已批准来源：Codex、Claude Code、OpenCode、WorkBuddy、MiMo Code、Gemini CLI、Cursor、ZCode、DeepSeek Harness。**账号额度目前仅 Codex。**

---

## 2. 第一次跑起来

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js   # 不能省：上一条 --ignore-scripts 跳过了 Electron 的 postinstall
npm.cmd run verify                      # ESLint + 全部单元测试
```

在 Windows PowerShell 里用 `npm.cmd` 而不是 `npm`，可以避开 `npm.ps1` 的执行策略问题。

`verify` 应当输出 `fail 0`，当前是 **119 项测试 / 23 个测试文件**。这是唯一能在任何机器上无条件跑通的自检；不需要显示器、不需要 Electron、不需要原生二进制。

只想看界面（不启动 Electron、不连真实数据）：

```powershell
node design/desktop-reference/serve.js   # 然后打开 http://127.0.0.1:4178/
```

这是合成数据的开发预览，不能登录账号、不调原生采集。

**首次启动界面为空是正常的**——本机还没有任何 Agent 的会话记录。数据目录也是首次运行时才创建。

---

## 3. 代码地图

```
src/quota/main.js        ★ 唯一产品入口。Electron 主进程、IPC、窗口、额度服务装配
src/quota/               contract.js 额度判定 / errors.js 错误码表 / preload.js IPC 桥
                         rpc.js 与 codex.exe 的 stdio RPC / service.js 额度状态 / window-shell.js
src/m1/                  共享统计库。注意：不是"第二个应用"，历史上有过一个独立 M1 界面，已删除
  policy.js              来源根路径、文件白名单、目录遍历、网络封锁 —— 采集的唯一权威
  sources.js             各来源的解析入口与投影
  extended-sources.js    Gemini / Cursor / ZCode / DeepSeek 的补充解析
  store.js               持久化、迁移、快照生成、定价目录
  worker.js              worker 线程：watch 变更 → scan → native 交叉校验
  service.js             主线程侧：调度、重试、维护
  normalize.js pricing.js usage-snapshot.js sqlite-memory.js native.js zstd-frame.js
design/desktop-reference/  渲染层 HTML/CSS/JS（约 87 个文件）
scripts/m1/                开发、验收、打包脚本（不在产品路径上）
tests/m1/                  单元测试
docs/                      设计、合同与验收记录
```

产品运行时可到达的模块约 49 个，由 `npm run audit:runtime` 断言。**改动模块图后一定要跑它。**

### 三条数据流

1. **采集**：`src/quota/main.js` → `src/m1/service.js` → `src/m1/worker.js`（worker 线程）→ `src/m1/sources.js` / `extended-sources.js` → `src/m1/store.js` 的 `ingest()` → 快照 → IPC → 界面。
2. **额度**：`src/quota/service.js` → `src/quota/rpc.js` spawn `codex.exe app-server --listen stdio://`（七个方法白名单，强制 `cli_auth_credentials_store="keyring"`）。
3. **定价**：`src/m1/price-sync-service.js` → fork `src/m1/price-fetch-worker.js`（唯一的出网点）→ 写回定价快照。

### 主进程硬化（不要放松）

`src/quota/main.js`：`disableNetwork` / 单实例锁 / `onBeforeRequest` 只放行 `file:` 与 `devtools:` / 权限一律 `false` / `webPreferences { contextIsolation: true, nodeIntegration: false, sandbox: true }` / IPC 前校验 sender + mainFrame / `setWindowOpenHandler(deny)` + `will-navigate` preventDefault。渲染层 CSP 里 `connect-src 'none'`。

---

## 4. 数据语义铁律

**这些不是风格建议，是硬约束**——每一条都来自已修复的真实数据事故，破坏任何一条都会产出"看起来合理但是错的"数字。完整版见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

1. **未知永远不是零。** 绝不用 0 填充未知的用量或价格。未知保持 `null`，显示为"未知"；未定价显示为"未定价"。算缓存命中率必须忽略未记录的写入，而不是当成 0 写入。
2. **绝不为凑总额而关闭冲突保护。** 来源冲突要保留并标 `partial`。
3. **替换选中快照必须完整套用。** 新快照里不存在的属性要移除，同时保留 first-owner 身份与对象引用（`src/m1/sources.js`）。
4. **快照选择必须顺序无关。** 规则：valid 优先于 invalid，其次总额更大（即使 partial），再次质量/已知字段。`tests/m1/snapshot-order.test.js` 对每种顺序对照参考规则校验。
5. **原生验证每次必须在新建目录运行。** tokscale 的源消息缓存假定文件只追加；复用投影会**冻结之后所有采集**。
6. **受损的存储文件隔离，绝不静默丢弃。** 无法解析或结构非法的状态文件被 `rename` 到数据目录下的 `quarantine/`，然后用空默认值继续启动，并通过 `snapshot().recovered` / `state().recovered` 把事实透出到界面。不要改回"抛错退出"，也不要在隔离前写东西覆盖原字节。

---

## 5. 改动时最容易踩的坑

- **`quarantine/` 是唯一被允许移动用户数据的地方。** 它只做 `rename`，不删不改。隔离失败（文件被占用等）要降级为 `QUARANTINE_FAILED` 并继续启动，而不是抛错。
- **Playwright `page.waitForFunction` 对 async 谓词会立即 resolve。** 要轮询桥接状态请用 `scripts/m1/ui-settle.js` 的 `until`。
- **来源状态 `partial` 描述的是扫描，不是定价。** 一条记录是否已定价取决于它自己的质量字段，两者独立。
- **`package.json` 的 `build.files` 是白名单。** `docs/m1/UPSTREAM.md` 和 `docs/m1/CODEX-QUOTA.md` 必须留在原位——移动或改名会让打包内容与磁盘不一致，`npm run audit:package` 会失败。
- **`.gitattributes` 强制 LF。** 别改成 CRLF：Windows 上检出 CRLF 会让按内容匹配的测试失败。
- **删除临时目录要用 `tests/m1/temp.js` 的 `remove()`**，不要直接 `fs.rmSync`。关掉 `Service` 之后 Windows 释放 worker 文件句柄是异步的，随后几毫秒内 `fs.rmSync` 可能报 `EPERM`。这是调度竞态不是泄漏。
- **`@electron/asar` 是未声明的传递依赖。** `scripts/m1/audit-package.js` require 它，但 `package.json` 里没有；改依赖时注意。
- **`package.json` 的 `"private": true` 必须保持 `true`。** 它只阻止误 `npm publish`，不影响 GitHub 公开；而 `scripts/m1/governance.py` 会断言它。
- **加了新脚本（`<script src>`）要同步两处**：`design/desktop-reference/serve.js` 的静态白名单，和 `scripts/m1/audit-runtime.js` 的资源检查。

---

## 6. 测试与验收：四态必须分清

这是本项目的一条纪律：**已实现 / 合成测试过 / 真实数据验证过 / 完全未执行**，四者不能互相冒充。写报告、提 PR、回消息时都要说清楚是哪一态。

| 命令 | 需要什么 | 何时跑 |
| --- | --- | --- |
| `npm run verify` | 无 | **每次改动必跑**。ESLint + 119 项单元测试 |
| `npm run test:native` | tokscale 原生二进制 | 动 `src/m1/` 的采集、解析、存储 |
| `npm run test:*:ui` | Playwright + Electron + 显示器 | 动渲染层 |
| `npm run test:stress` | Node | 动并发、存储、调度 |
| `npm run experiment:crypto` | Node | 动加密实验代码 |
| `npm run audit:runtime` | Node | 动模块图、入口、UI 资源 |
| `npm run audit:package` | 一次 `dist:win:dir` 之后的产物 | 动 `package.json` 的 build 段 |
| `npm run pricing:check` | Node | 动定价 |
| `npm run validate:local` | **读你的真实数据** | ⚠️ 不是例行测试，不纳入 `verify` |

**所有 UI 与压力测试必须指定自己的 usage/quota 目录和合成 fixture home，绝不在真实数据上跑。**

`.github/workflows/ci.yml` 只跑 `verify` 与 `audit:runtime`（windows-latest、Node 22.15）。UI/native/打包**故意不上 CI**——它们需要显示器和原生二进制。

---

## 7. 当前状态

- 分支：`main`。**工作树应当是干净的。**
- 测试：119 项，23 个测试文件。CI 全绿。
- 来源：九来源只读采集已实现；额度仅 Codex。
- 交付：`dist/` 下的候选**不会被提交**（已被 `.gitignore` 忽略），每次候选是新的 `dist/<generation>` 目录。历史候选不保证保留、也不必再验证。

### 已知缺口（诚实清单，不要当它们不存在）

- **构建产物未签名**（`signAndEditExecutable: false`）。`@tokscale` 的原生二进制在 spawn 前**不校验哈希**。自用可接受，对外分发前必须处理。
- **原生验证失败会丢弃整轮采集结果**，而不是保留本轮扫描（`src/m1/worker.js` 的 scan 与 native 校验在同一 async 链上）。
- 存储文件损坏时**只做隔离，不做自动回滚**；`backups/` 里仍有迁移前备份，但没有"一键恢复"入口。
- **网络封锁是 Node 层的 API 拦截**，只覆盖 `fetch` / `http` / `https` / `net` / `tls`；没有内核级审计，且未覆盖 `http2` / `dgram` / `WebSocket`。
- 摘要首次统计 2 万行时主线程阻塞约 334–364 ms。
- 物理 DPI 缩放、Windows 窗口吸附、长时间连续运行未做系统化验收；曾出现过一次窗口关闭错误，根因未定位。
- **Gemini CLI 与 Cursor 目前只有格式合成样本与 Electron 测试，没有真实调用样本**——不能认为这两个来源的真实数据已被验收。ZCode 没有官方数据库合同，按投影字段读取。
- 未使用读屏软件实测。无障碍检查见 [docs/m2/A11Y-REVIEW-20261008.md](m2/A11Y-REVIEW-20261008.md)。
- 配对、跨设备同步、生产密钥与 iOS 端均未开始。本项目目前只有 Windows 桌面端。

---

## 8. 怎么工作

- **每个被接受的增量都要提交**，代码、测试与它的文档放在**同一个**提交里。历史就是审计线索，交付报告引用 commit。
- 提交信息用 `feat:` / `fix:` / `docs:` / `chore:` / `test:` / `style:` 前缀，说明**为什么**，不只是做了什么。
- 不要提交 `dist/`、`artifacts/`、`.planning/`、`.cache/`——已在 `.gitignore`。
- 不要往代码、测试、文档或 issue 里写**真实 Agent 会话内容、本机路径、账号标识或个人数据**。
- 提交日志前自行删除其中的本机路径与账号信息。
- 安全漏洞走 [SECURITY.md](../SECURITY.md) 的私密渠道，不要发公开 issue。

---

## 9. 还想深入读什么

按需要的顺序：

| 想知道 | 读 |
| --- | --- |
| 每个来源到底读哪些字段、怎么去重、有哪些限制 | [docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md](m2/AGENT-INTEGRATION-CONTRACT-20261005.md) |
| 数据合同与字段语义 | [docs/m1/DATA-CONTRACT.md](m1/DATA-CONTRACT.md) |
| Codex 登录与额度边界 | [docs/m1/CODEX-QUOTA.md](m1/CODEX-QUOTA.md) |
| 隐私边界到底承诺了什么 | [docs/PRIVACY.md](PRIVACY.md) |
| 第三方组件、图标、字体、定价数据来源 | [NOTICE](../NOTICE)、[design/desktop-reference/LICENSES.md](../design/desktop-reference/LICENSES.md) |
| 上游血缘与复用边界 | [docs/UPSTREAM-PROVENANCE.md](UPSTREAM-PROVENANCE.md)、[docs/m1/UPSTREAM.md](m1/UPSTREAM.md) |
| 版本变更记录 | [CHANGELOG.md](../CHANGELOG.md) |
| 桌面端范围与同步边界 | [docs/m2/DESKTOP-SCOPE-20261004.md](m2/DESKTOP-SCOPE-20261004.md) |

---

## 10. 开工前的一句话总结

产品入口是 `src/quota/main.js`；`src/m1/` 是共享库不是第二个应用；九来源只读、额度仅 Codex；不读认证、不改源库、不上传；未知永远不是零；**改完先跑 `npm run verify` 和 `npm run audit:runtime`**；分不清"实现过"和"验收过"时，说没验收。
