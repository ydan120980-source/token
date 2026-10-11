# 贡献指南

感谢参与。本文说明如何搭建环境、修改代码以及本项目的数据语义铁律——**后者是硬约束，不是建议**。

## 环境

- Windows 10 / 11 x64（唯一被支持并可验证的平台）
- Node.js `>=22.15.0`
- Git

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
npm.cmd run verify
```

第二条命令不能省：`--ignore-scripts` 跳过了 Electron 的 postinstall，这一句才真正下载 Electron 二进制。

## 提交前必须通过

```powershell
npm.cmd run verify
```

包含 ESLint 与全部单元测试，要求 `fail 0`（不在文档里记录测试数：并行分支都会改它）。除此之外，按改动范围还应运行：

| 改动区域 | 需要的额外检查 |
| --- | --- |
| `src/m1/` 采集、解析、存储 | `npm run test:native`（需要 tokscale 原生二进制） |
| 渲染层、界面 | 相应的 `test:*:ui` 套件（需要 Playwright + 显示器） |
| 打包、`package.json` build 段 | `npm run audit:runtime`，以及一次 `dist:win:dir` 后 `npm run audit:package` |
| 定价 | `npm run pricing:check` |

**所有 UI 与压力测试必须指定自己的 usage/quota 目录和合成 fixture home，绝不在真实数据上跑。** 唯一允许读取真实来源的是 `npm run validate:local`，它不纳入例行验证。

## 测试分层：什么时候跑什么

每一层只验证上一层没有覆盖的风险，不重复验证同一份字节：`audit:package` 已证明 ASAR 与源码逐字节一致，解压校验已证明解压副本与构建目录逐字节一致。

| 时机 | 跑什么 | 不跑什么 |
| --- | --- | --- |
| 开发中 | `verify`，加上改动涉及的 1–2 个界面套件（源码模式） | 全套界面、打包 |
| 提 PR | CI 的 `verify`；按上表补跑对应检查；改了渲染层的，跑受影响的 `test:*:ui`（源码模式）。只改测试脚本的，跑被改的套件。PR 里写明跑了哪些、没跑哪些 | 打包验收（统一留到候选） |
| 发布候选（发布验收负责人） | `verify`、`test:native`、`test:stress`、`experiment:crypto`、`audit:runtime`；`dist:win:dir` 加 `audit:package`；打包版上跑 `scripts/m1/` 下全部 `*-ui-test.js`；把构建打成 ZIP，解压到含空格与中文的路径并逐字节比对，在解压副本上跑一个会启动采集的套件（如 `agent-recovery`） | 源码模式全套界面（打包版已覆盖同一份字节） |

- 改了打包相关内容（`package.json` 的 build 段、依赖、原生二进制）的 PR，在 PR 阶段就要跑 `dist:win:dir` 加 `audit:package`，因为风险就在打包本身。
- 首轮失败要如实记录。复跑通过只能写"复跑通过"，不能写成首轮通过。
- 同一条断言在两个候选里都偶发失败的，开 issue 跟踪，修复或单独隔离，不要每轮验收都停下来排查。

## 数据语义铁律

这些规则来自已修复的真实事故，破坏任何一条都会产生看起来合理但错误的数据。

1. **未知永远不是零。** 绝不用 0 填充未知的用量或价格。未知保持 `null`，显示为"未知"；未定价显示为"未定价"。缓存命中率计算必须忽略未记录的写入，而不是把它们当 0。
2. **绝不为凑总额而关闭冲突保护。** 出现来源冲突时保留冲突并标 `partial`，不要为了让数字对上而丢弃冲突标记。
3. **替换选中快照时必须完整套用。** 新快照中不存在的属性要移除，同时保留 first-owner 身份与对象引用（见 `src/m1/sources.js`）。
4. **快照选择必须顺序无关。** 规则：valid 优先于 invalid，其次总额更大（即使 partial），再次质量/已知字段。`tests/m1/snapshot-order.test.js` 会对每种顺序对照参考规则校验。改动 `src/m1/usage-snapshot.js` 必须让该测试通过。
5. **原生验证每次必须在新建目录运行。** tokscale 的源消息缓存假定文件只追加，复用投影会冻结后续所有采集。`src/m1/native.js` 已按此实现。
6. **受损的存储文件隔离，绝不静默丢弃。** `src/m1/store.js` 的 `load()` 与 `src/quota/service.js` 的构造器把无法解析或结构非法的文件 `rename` 到数据目录下的 `quarantine/`，然后用空默认值继续启动，并把记录通过 `snapshot().recovered` / `state().recovered` 透出到界面。不要改回"抛错退出"，也不要在隔离前写任何东西覆盖原字节。

## 已知陷阱

- **`quarantine/` 是唯一被允许"移动用户数据"的地方。** 它只做 `rename`，不删不改；隔离失败（例如文件被占用）要降级为 `QUARANTINE_FAILED` 并继续以默认值启动，而不是抛错。
- **Playwright `page.waitForFunction` 对 async 谓词会立即 resolve。** 轮询桥接状态请用 `scripts/m1/ui-settle.js` 的 `until`，不要用 `waitForFunction`。
- **来源状态 `partial` 描述的是扫描，不是定价。** 一条记录是否已定价取决于该记录当前的质量字段，两者独立。
- **`package.json` 的 `build.files` 是白名单。** `docs/m1/UPSTREAM.md` 与 `docs/m1/CODEX-QUOTA.md` 必须留在原位——移动或改名会让打包内容与磁盘不一致，`npm run audit:package` 会失败。
- **`@electron/asar` 是传递依赖。** `scripts/m1/audit-package.js` require 它，但 `package.json` 未声明；改动依赖时注意。
- **`.gitattributes` 强制 LF。** 不要改成 CRLF：Windows 上检出 CRLF 会让按内容匹配的测试失败。
- **删除临时目录要用 `tests/m1/temp.js` 的 `remove()`，不要直接 `fs.rmSync`。** 关闭 `Service` 后，Windows 释放 worker 文件句柄是异步的：随后几毫秒内 `fs.rmSync` 可能报 `EPERM`。这是调度竞态而非泄漏，`remove()` 会在 5 秒预算内重试并只对 `EPERM`/`EBUSY`/`ENOTEMPTY` 生效。

## 代码约定

- 渲染层是**本地静态 HTML/CSS/JS**，不使用打包器、不使用 ES module。新增脚本请沿用现有的 classic `<script src>` 方式，并同步更新 `design/desktop-reference/serve.js` 的静态白名单与 `scripts/m1/audit-runtime.js` 的资源检查。
- 新增来源需要在 `src/m1/policy.js` 的 `roots()`、`allowedFile()`、解析器与 `design/desktop-reference/agent-catalog.js` 之间保持一致。
- 错误使用受控的 `SCREAMING_SNAKE` 码，码表另需与 `design/desktop-reference/local-snapshot.js` 同步。
- 提交信息用 `feat:` / `fix:` / `docs:` 前缀，说明"为什么"。

## 提交与分支

- 每个被接受的增量都要提交，代码、测试与文档放在同一个提交里。
- 不要提交 `dist/`、`artifacts/`、`.planning/`、`.cache/`——已在 `.gitignore`。
- 不要提交真实 Agent 会话内容、路径、账号标识或任何个人数据到代码、测试、文档或 issue 里。

## 协作流程

本仓库由多位维护者（人与各自的 AI 编码会话）共同开发，维护者直接拥有仓库写权限。

- **分支**：每项工作开一个主题分支（`fix/…`、`feat/…`、`docs/…`），通过 PR 合入 `main`，不直接推 `main`。开工前与推送前都 `git pull --rebase origin main`。
- **合入条件**：CI 的 `verify` 通过，且 PR 描述写明本地实际跑过哪些检查、哪些没跑（按四态：已实现 / 合成测试过 / 真实数据验证过 / 未执行）。
- **历史不可改写**：不 force push `main`，不改写已推送的历史。在可能含未推送提交的工作树上不要用 `git reset --hard` / `git clean`——本项目曾因此永久丢失两个已提交的增量。
- **发布验收归属**：打包版与解压副本验收、`dist/<代次>` 候选和 `docs/m2/RESULTS-*` 验收记录由**发布验收负责人**在有桌面的 Windows 机器上完成。分工与出候选的时机见下一节。
- **范围决定**：超出九个来源或"额度仅 Codex"的工作，先在 issue 里取得项目所有者的决定再动手。
- **提交身份**：建议使用 GitHub 提供的 noreply 邮箱提交（`git config user.email <id>+<login>@users.noreply.github.com`），仓库是公开的。

## 分工：按能否占用屏幕划分

界面套件（`scripts/m1/*-ui-test.js`、`ui-stress`、`desktop-performance`）会弹出 Electron 窗口并模拟鼠标，运行期间占用屏幕。不能占用屏幕的维护环境不跑它们。

| 检查 | 可占用屏幕的环境（发布验收负责人所在机器） | 不可占用屏幕的环境 |
| --- | --- | --- |
| `verify`、`test:native`、`test:stress`、`experiment:crypto`、`audit:runtime`、`pricing:check` | 可以 | 可以 |
| `dist:win:dir` + `audit:package`（无窗口） | 可以 | 可以 |
| 界面套件 | 可以 | 不跑 |
| 发布候选与 `RESULTS-*` 记录 | 负责 | 不做 |

按这条线分配工作：

- **不可占用屏幕的环境**负责风险能在无界面检查中暴露的改动：`src/m1/` 的采集、解析、存储、策略、原生校验、worker 与 service；`src/quota/` 中不涉及窗口的部分（`rpc.js`、`contract.js`、`service.js`、`errors.js`）；定价；非界面脚本与文档。
- **可占用屏幕的环境**负责渲染层 `design/desktop-reference/`、窗口与 IPC（`src/quota/main.js`、`preload.js`、`window-shell.js`）以及界面套件本身。
- 跨界的改动（例如改了快照或额度状态里界面要显示的字段、改了界面套件里的断言）：作者照常提 PR，给 PR 加 `needs-ui-run` 标签，并写明影响哪些界面套件。可占用屏幕的一方跑完这些套件、在 PR 里回复结果之后，才能合并。

## 何时出发布候选

候选不跟着每个 PR 出。满足下面任一条才出：

1. 项目所有者要替换本机正在使用的版本，或要对外交付；
2. 合并了只有打包版才能验证的改动：依赖、`package.json` 的 build 段、原生二进制或其校验、主进程入口；
3. 距上一个候选已累积了较多尚未在打包版上验证过的运行时改动，项目所有者决定收一次。

只改文档、测试脚本或 CI 的合并不出候选。渲染层 PR 在 PR 阶段已在源码模式下跑过受影响的套件，攒到下一个候选再做打包验收。

## Windows 工具链陷阱

- PowerShell 里用 `npm.cmd` 而不是 `npm`，避开 `npm.ps1` 的执行策略限制。
- PowerShell 没有 heredoc；多行提交信息写进文件再 `git commit -F <文件>`。
- 工作区路径含非 ASCII 字符时，Node 24 的 `fs.cpSync` 可能直接以退出码 127 结束进程且无任何输出；辅助脚本里请逐文件复制（在 Node 24.13.1 上复现；其他版本未验证）。
- `scripts/m1/python.js` 导出的是 `{ python }` 函数，调用时写 `python()`。

## 报告问题

安全漏洞请走 [SECURITY.md](SECURITY.md) 的私密渠道，不要发公开 issue。

其他问题请在 issue 中提供：Windows 版本、应用版本或提交、复现步骤，以及**脱敏**后的错误码。提交日志前请自行删除其中的本机路径、会话内容与账号信息。
