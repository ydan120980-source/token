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

2026-11-05 所有者为响应速度优化授权本机真实数据测试，仍通过上述显式入口：`npm run validate:local -- --performance --output <私有证据目录>`。它使用临时独立应用状态、不读认证文件或查账号、不改源文件、不保存正文／截图，退出后删除临时统计；只保留数值证据。可选 `--profile`（CPU）或 `--layout-profile`（布局）仅作归因，不与无采样器的正式交互回执混用；诊断可完成，但 `measurementEligible` 必须为 false。布局记录在收到事件时就去掉原始参数／URL，只保留耗时、对象数和代码位置，不保存原始 trace。开始／结束均须通过桌面可用检查，锁屏或系统剪贴板拒绝访问的记录不能算交互验收。全程帧分位数会受读取等待时长影响，比较滚动优先使用对应 `phaseFrames`。该授权不把真实读取加入普通 verify、UI、压力或发布脚本。

会话专项可加 `--reader-only`：只导航会话页，并检查两份长记录、左右栏切换和悬停；仍是上述显式真实入口，普通测试不读取真实来源。工具记录原生窗口焦点／失焦次数，失去前台的计时不算验收；桌面资格通过也不代表延迟已达标，慢轮次必须保留。

`node scripts/m1/reader-interaction-benchmark.js` 始终创建独立合成 home／usage／quota，覆盖大量会话、工具密集和轮次较多的两种记录。PowerShell 先设置 `$env:PERF_OUTPUT='<私有证据目录>'`；`READER_DIAGNOSTIC=1` 或 `READER_LAYOUT=1` 只作数值归因，不具备计时验收资格。`READER_CHECKS=1` 在停止计时后检查未绘制命令的筛选、继续显示、焦点、文件树和卡片 Escape；可另设 `READER_CURRENT_SCREENSHOT=1` 保留一张当前合成窗口图，不拍像素前后对照。工具内的 `PERF_SOURCE_ROOT` 可选择已核对字节的本地产品基线，不能替代来源读取授权。

真实性能工具的 `PERF_SOURCE_ROOT` 选择产品窗口，初始统计仍由当前验证工具所在检出生成。`load.collectionMs` 是该准备过程的记录，不能据此比较不同后台源码的采集速度；采集的正式对照使用其独立基准。本批只改展示层，两边后台字节相同。

## 测试分层：什么时候跑什么

2026-11-03 本地候选工作流见 `docs/m2/LOCAL-CANDIDATE-WORKFLOW-20261103.md`：日常源码检查不生成交付目录/ZIP；正式验收使用 `candidate:plan/build/check`，按产品和测试输入、系统/日期/显示状态及证据字节核对复用，明确标记历史通过而非新执行。构建目录不可覆盖，校验后共享新目录中的相同 runtime 文件，旧交付保留。性能/高刷不复用功能收据。`signing:plan` 仅报告未配置状态，独立签名配置离线受审；没有证书或更新客户端，不启动自动更新或发布。

所有者同日取消本轮像素基线和前后对照，改为之后自己查看；本轮只保留当前最终包的完整截图，不将取消视作视觉批准。当前源码内存与限时 UI 分别见 `RESULTS-READER-MEMORY-20261103.md` 和 `RESULTS-READER-UI-20261103.md`，包版必须另测，真实样本仍另行授权。

所有者 2026-11-02 指定本次交接界面每轮约 20 分钟：枚举全部，但只在预算内派发；同字节针对性通过结果可复用，未完成、无回执与通过分开记录。常规改动选择受影响项，全量仅用于重大更新/发布，并服从最新缩减指令。详见 `docs/m2/UI-TEST-BUDGET-20261102.md`；不得为预算弱化断言或把未完成当全量通过。

11月2日当前候选与逐步验收见 `docs/m2/RESULTS-HANDOFF-RELEASE-20261102.md`：源码/包版、原失败/针对性复验、预算遗漏、大窗口RAM/私有提交与原生帧间隔分别记录。长阅读内存和范围切换长帧仍未达标；视觉由所有者转Claude待审，真实记录核对未授权。不要重开遗漏套件、用旧小窗口数字替代当前实测或将候选当正式发布通过。

阅读页剩余功能专项：`node scripts/m1/sessions-reader-extras-ui-test.js`（默认 100%/150%，`READER_EVIDENCE_DIR` 指定证据位置，`QUOTA_PACKAGED_EXE` 可指向包版）。它验证真实合成解析/IPC，明确替换外部桌面动作；接续搜索夹具不代表真实时间预算基准。综合版式、跟随及轮号保存仍由 `session-reader-ui-test.js` 覆盖；当前结果见 `RESULTS-HANDOFF-READER-20261102.md`。

每一层只验证上一层没有覆盖的风险，不重复验证同一份字节：`audit:package` 已证明 ASAR 与源码逐字节一致，解压校验已证明解压副本与构建目录逐字节一致。

| 时机 | 跑什么 | 不跑什么 |
| --- | --- | --- |
| 开发中 | `verify`，加上改动涉及的 1–2 个界面套件（源码模式） | 全套界面、打包 |
| 提 PR | CI 的 `verify`；按上表补跑对应检查；改了渲染层的，跑受影响的 `test:*:ui`（源码模式）。只改测试脚本的，跑被改的套件。PR 里写明跑了哪些、没跑哪些 | 打包验收（统一留到候选） |
| 发布候选（发布验收负责人） | `verify`、`test:native`、`test:stress`、`experiment:crypto`、`audit:runtime`；`dist:win:dir` 加 `audit:package`；打包版上跑 `scripts/m1/` 下全部 `*-ui-test.js`；把构建打成 ZIP，解压到含空格与中文的路径并逐字节比对，在解压副本上跑一个会启动采集的套件（如 `agent-recovery`） | 源码模式全套界面（打包版已覆盖同一份字节） |

- M9 完成后的渲染层（2026-10-29）：日常修改运行受影响页面的源码冒烟，以及本次改动直接涉及的交互/数据语义套件；发布候选仍枚举并运行全部 `*-ui-test.js`。迁移旧选择器时保留未知值、数据隔离、键盘、焦点和溢出等行为要求，改查当前 kit DOM，不因页面迁移而删除这些要求。
- 字体改动的发布验收：对打包版和中文空格路径解压副本分别设置 `QUOTA_PACKAGED_EXE`，运行 `node scripts/m1/release-window-check.js <证据标签> --font-only`。检查文件响应、loaded 字体面和 CDP 实际自定义中文字形；Electron 的 file: Resource Timing 可以为空。去掉 `--font-only` 可另外检查合成可见窗口中的标题栏读数/已采集对齐及悬停按压轨迹，不能替代所有者或 Claude 的主观手感审定。M11 跨日结果见 `docs/m2/RESULTS-M11-20261030.md`。
- 像素基线使用固定时钟、合成账本、同一视口/主题/sRGB/动效状态。重拍基线同时交付前后图与差异报告供 Claude 审阅；不得把机器阈值通过写成设计批准。
- 改了打包相关内容（`package.json` 的 build 段、依赖、原生二进制）的 PR，在 PR 阶段就要跑 `dist:win:dir` 加 `audit:package`，因为风险就在打包本身。
- `dist:win:dir` 要求构建目录的 `node_modules` 是真实目录：它是目录联接或符号链接时，electron-builder 会悄悄漏掉 `@tokscale`，所以构建前的 `check-build-deps` 会直接失败。工作树里用 `npm ci` 或 `robocopy /E` 复制一份，不要在打包后补文件。
- 首轮失败要如实记录。复跑通过只能写"复跑通过"，不能写成首轮通过。
- M12 性能复核：`today-stability-ui-test.js` 覆盖真实五秒合成采集的稳定更新；`high-refresh-ui-test.js` 记录实际屏幕刷新率、原生 rAF 和指针合并/取消。`performance-window-check.js` 使用 `PERF_ROWS`、`PERF_MODELS`、`PERF_OUTPUT`，可用 `PERF_IDLE_SAMPLES=8` 记录可见静置两分钟；内存必须包含全部应用进程、明确 private/working-set、导航峰值与稳定值，不用强制 GC 或减掉 GPU 证明达标。`release-full-screenshots.js <标签>` 输出六页两主题完整截图。M12 由所有者明确交 Codex 实施原视觉待决，历史 Claude 等待记录不作为本次新增授权；当前实测限制见 `docs/m2/UI-PERFORMANCE-M12-20261030.md`。
- 同一条断言在两个候选里都偶发失败的，开 issue 跟踪，修复或单独隔离，不要每轮验收都停下来排查。

## 数据语义铁律

M12 内存续进的扩大场景可对 `performance-window-check.js` 设置 `PERF_NAV_CYCLES=3`、`PERF_REFRESHES=4`、`PERF_CONTINUOUS=1`：独立 Windows 计数器在切页/采集期间查询应用及当时的子孙 PID；第三次刷新追加一条合成记录，并断言保存总量变化。记录实际采样间隔、缺值、静置和峰值，不能把查询间等待 250ms 写成无间隙的瞬时上限。此工具始终新建合成 home/usage/quota；新结果不覆盖旧候选。当前算法与证据见 `docs/m2/M12-MEMORY-PEAKS-20261030.md`。

2026-11-01 续进验收见 `docs/m2/RESULTS-M12-MEMORY-20261101.md`：候选保留原始缺值、同二进制增长策略对照和新目录复测；所有者最新决定为暂不推送。`desktop-performance-test.js` 随当前费用页的 tab/tr 语义执行，状态不变时等待 `usage:hydrate` 实际完成后检查图表未重建，不能要求无变化的状态文字强行修改 DOM。完整截图可用 `RELEASE_CAPTURE_TIME` 固定 Date 和合成 mtime；历史源码参考用 `RELEASE_APP_ROOT`，必须注明不是旧二进制。

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

- 渲染层有两部分（`docs/m2/UI-REACT-FOUNDATION-20261025.md`）：
  - **生产外框与页面**：`ui/src/app.tsx` 在唯一 `#app` 根节点中直接组合六页、侧栏和标题栏；`[data-ui-root]` 只作样式作用域。不要恢复 `islands.js`、legacy/ui-reset 层或退休控制脚本。页面/外框样式进入当前 theme，字体和 tokens 保持独立。`design/desktop-reference` 保留数据 hosts/models、用量投影及额度卡片叶节点；classic 脚本仍受 `serve.js` 白名单与运行时/ASAR 审计约束。
  - **React 层**：源码在 `ui/`，用 `npm run build:ui` 构建，产物提交进仓库。正式源码 ZIP 同时包含 `ui/` 源码和已构建产物。`npm run verify` 会逐字节检查产物是否和源码一致，忘了重新构建会失败。颜色、字号、圆角都只取 `tokens.css` 里的值；动效只用 `spring.fast`、`spring.moderate`、`spring.slow` 三档。
- 自定义 JSONL 来源通过运行时注册与配置接入，遵循 `docs/m2/CUSTOM-JSONL-SOURCES-20261017.md`；合成验证使用 `npm run test:custom:ui` 与 `npm run test:custom:stress`，不得把自定义来源再硬编码进品牌清单。
- 新增内置来源需要在 `src/m1/policy.js` 的 `roots()`、`allowedFile()`、解析器与 `src/m1/agent-catalog.js` 之间保持一致。
- 错误使用受控的 `SCREAMING_SNAKE` 码，码表另需与 `src/m1/local-snapshot.js` 同步。
- 本地查询入口为 `src/m1/query-entry.js`，不经过 GUI 或采集服务。运行 `npm run test:query:integration` 验证真实 stdio 客户端；设置 `QUERY_PACKAGED_EXE` 可验证 EXE + ASAR 路径。查询错误码仅由该入口白名单透出，不混入来源状态码。新增计费流程的合成界面验证为 `node scripts/m1/billing-query-ui-test.js`；同样支持 `QUOTA_PACKAGED_EXE`，所有数据在独立 fixture 中。
- `valuation` 与 `usage-projection` 是 GUI/保存查询共享的无 IO 计算模块；读取链不得依赖 Store 或来源读取器。继续查询分页必须带 revision；修改计费或投影合同需覆盖版本失效、失败保存与重启对照。`node scripts/m1/query-benchmark.js` 只测独立合成账本，不设与机器速度绑定的 CI 阈值。
- 来源/额度概览的纯投影在 `src/quota/connection-state.js`，只读内存接口为 `usage:connections`；不得从概览触发采集或账号请求，不能把其他来源的本地用量视作额度支持。`node scripts/m1/source-quota-ui-test.js` 验证跨页导航、独立生命周期、缓存和概览失败重试，支持 QUOTA_PACKAGED_EXE 及隔离合成数据。
- 提交信息用 `feat:` / `fix:` / `docs:` 前缀，说明"为什么"。

## 提交与分支

- 每个被接受的增量都要提交，代码、测试与文档放在同一个提交里。
- 不要提交 `dist/`、`artifacts/`、`.planning/`、`.cache/`——已在 `.gitignore`。
- 不要提交真实 Agent 会话内容、路径、账号标识或任何个人数据到代码、测试、文档或 issue 里。

## 协作流程

2026-10-29 M11 发布任务例外：所有者已授权本轮验收完成后将审阅过的源码正常推送到 `ydan120980-source/token`，交付本地验收包；不创建 PR、标签或 GitHub Release，不上传附件、不 force push。这不授权其他任务恢复远端协作。M11 外观待决（活动三项及可见窗口补充项）须由 Claude 确认或修正；像素重拍、自动检查和审阅包均不能代替视觉批准。见 `docs/m2/UI-M11-CLAUDE-REVIEW-20261029.md`。

本仓库由多位维护者（人与各自的 AI 编码会话）共同开发，维护者直接拥有仓库写权限。

> **2026-10-12 起暂停 GitHub 同步，只做本地开发（项目所有者决定）。** 恢复同步前，本节中 PR 相关的规则由下面几条代替：
>
> - 不 push，不开 PR，不在 GitHub 上合并；`origin/main` 停在 `4d011eb`。
> - 仍在自己的 worktree 里开主题分支，从本地 `main` 拉出，也以本地 `main` 为基准 rebase。
> - 本地合入条件：`npm run verify` 报告 `fail 0`，`npm run audit:runtime` 通过；改了渲染层的，再在源码模式下跑受影响的界面套件。通过后在共享目录的 `main` 上用 `git merge --no-ff` 合入，合入前确认那里工作树干净、没有别的会话正在合并。
> - R4、R6、A4 在项目所有者指派前没有负责人，不要开工。
> - 原本要在 issue 里记录的范围决定，改为在 `docs/m2/` 下提交一份带日期的决策记录。
> - 恢复同步时由发布验收负责人（会话"开发续进"）统一开一个同步 PR，并删除这段说明。

- **分支**：每项工作开一个主题分支（`fix/…`、`feat/…`、`docs/…`），通过 PR 合入 `main`，不直接推 `main`。开工前与推送前都 `git pull --rebase origin main`。
- **合入条件**：CI 的 `verify` 通过，且 PR 描述写明本地实际跑过哪些检查、哪些没跑（按四态：已实现 / 合成测试过 / 真实数据验证过 / 未执行）。
- **历史不可改写**：不 force push `main`，不改写已推送的历史。在可能含未推送提交的工作树上不要用 `git reset --hard` / `git clean`——本项目曾因此永久丢失两个已提交的增量。
- **发布验收归属**：打包版与解压副本验收、`dist/<代次>` 候选和 `docs/m2/RESULTS-*` 验收记录由**发布验收负责人**在有桌面的 Windows 机器上完成。分工与出候选的时机见下一节。
- **范围决定**：超出当前来源、额度和配置管理合同的工作，先取得项目所有者的决定再动手；远端协作暂停期间以 `docs/m2/` 中的日期记录保存，不沿用早期九来源或额度仅 Codex的历史范围。
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

## 合成数据从哪来

测试数据里的会话名、项目名、路径和正文一律现编，不从截图、真实记录或别人的会话里抄，改写几个字也不行。`tests/m1/release-privacy.test.js` 只拦得住本机路径，名字靠自觉。

## 何时出发布候选

所有者决定（2026-10-18）：按日期/主题建立的 `dist/<代次>` 交付目录、源码 ZIP、交付清单与校验文件，只在正式打包时生成。日常维护和每次本地合入不再生成这些交付物，也不再为源码归档额外执行压缩、解压及逐字节交付校验；继续保留代码提交、必要测试和 `artifacts/` 中的测试证据。改动打包链路时，上文要求的构建与包审计仍照常执行，但不自动另出交付代次。现有代次保留，清理另由所有者决定。详见 [正式打包时才生成交付归档](docs/m2/RELEASE-ONLY-ARCHIVES-20261018.md)。

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
