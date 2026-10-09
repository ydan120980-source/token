# 工作区维护、审计与统一界面 — 2026-10-03

用户先要求保留当前版本、删除测试及被替代的版本，再要求深入审计、压力测试、清除死代码。随后明确弃用截图中的旧深色 M1 窗口，并选择保留五来源采集、接入新版界面。此文记录该范围；不授权后续云/iOS、其他 provider、自动启动或公开发布。

## 当前实现

唯一入口 `src/quota/main.js`。Nowdex 风格窗口同时提供五来源离线统计与独立 Codex 额度。原有统计沿用 `%APPDATA%/AgentUsage-M1`，额度仍为独立 home/keyring；未搬运凭据或清除真实连接。`src/m1/` 仅包含共享统计模块和实验模块，没有旧窗口入口。

新增受限 usage IPC：获取统计、刷新、暂停/恢复、选择来源、导出、确认清空。只接受主窗口主 frame；导出在主进程重新执行统计白名单投影；选择目录拒绝原有 UNC/认证路径及数据目录重叠。目录添加后暂停；清空只清统计并暂停，保留原始来源和额度连接。退出窗口关闭采集 worker/native child 及额度 CLI，不再有旧 M1 托盘。

统一 UI 的运行时仍在 `design/desktop-reference/`；它是实际打包界面。`serve.js` 只用于开发预览，不打入应用。产品不再从 `scripts/m1/` 导入开发脚本。两个旧启动别名仍映射到唯一入口。

## 审计修复

| 问题与证据 | 修复 |
| --- | --- |
| 160,000 条 SQLite 新消息导致数据库被报告为 SOURCE_PARSE_FAILED；数组 spread 超过 V8 函数参数上限 | 按行追加，保留全部记录和独立原生总量核对 |
| Service.close 后仍可再次扫描来源 | 关闭后 refresh 返回保存状态，不创建 worker 或 native child |
| RPC 超大帧失败后仍保留约 2 MiB 原始缓冲，关闭后还会处理晚到帧 | 失败清空缓冲，关闭后忽略输入；增加回归 |
| WorkBuddy 每条详细记录重复遍历已有记录；持久层每轮五次全历史扫描 | 单次过滤 fallback；仅在有详细 WorkBuddy 记录时清理旧 aggregate |
| 新窗口快速关闭时初始化的 loadFile 中断可能弹错误框并阻塞测试退出 | 退出期间抑制初始化错误框和继续 show/refresh |
| renderer 全局变量与 preload bridge 冲突、目录点击同时进入浏览器演示弹窗 | renderer 使用局部闭包；原生模式只使用目录 IPC |
| 同一统计序列多次读请求重复执行白名单投影 | 按 Store 的 snapshot 对象复用投影；序列变化自动重建 |

前三项为初始压力测试复现。后两处 UI 冲突和快速关闭是在本轮集成/验收中发现并修复，未冒称为旧版本已存在问题。

## 清理与保留

初次清理删除 7,850 个文件、5,908,116,170 bytes（约 5.50 GiB）。精确目标清单位于 `.planning/MAINTENANCE-20261003/cleanup-inventory.json`；绝对路径限制在本工作区及明确的相邻 `token test` 审计副本，拒绝 reparse point 和运行中的目标。另移除已退役日期 helper，日期测试转向实际 renderer 的 usage-math。

- 删除旧 M1 窗口的 main/preload/renderer/HTML/CSS、旧 exe/ZIP、被替代额度目录与解压副本、临时缓存、相邻复制审计包。
- 删除当前产品没有引用的上游 agent/hub/shared/electron、macOS native、site、worker、对应 390 余个非 M1 测试与构建/签名/发布脚本。34 个历史选定上游测试在移除前通过；因被测实现已退役，当前不再保留这些测试命令。
- 生产直接依赖由 10 个减到 2 个（sql.js、tokscale）。移除 8 个不用的生产依赖及直接 macOS 签名依赖；离线 npm 安装移除 21 个包，所需 Electron/Tokscale/Playwright 版本未升级。
- 保留研究、LICENSE、原先业务统计、额度连接和用户未关联的改动。历史审计与上游参考文档当时归档到 `docs/m1/history/` 与 `docs/upstream/`；2026-10-09 这两处与 `docs/handoff/` 一并移出版本控制，仅作本机参考，不再随仓库分发。
- 原始上游实现可从基线提交 `f156470` 恢复；清理没有改写 Git 历史或自动提交。
- 原生/UI/压力测试使用系统 TEMP，结束后清理。统计预览的显式 prepare 工具仍可保存自己的只读投影；不能把该个人文件打入源码包。

CodeGraph 在本会话不可用，采用当前源码引用/资源图、打包清单、42 个行为测试及合成/native/UI 压力作为替代证据。

## 已执行验证与压力边界

| 检查 | 已验证结果 |
| --- | --- |
| verify | 42 行为测试与 ESLint 通过，0 失败 |
| test:native | 五来源 6 条合成记录，694 token，与 Tokscale 4.17.0 聚合一致；无 Node 网络尝试，源只读 |
| test:ui（源码） | 100/150 强制缩放：五来源、四范围、agent/model 筛选、目录选择与重叠拒绝、暂停/恢复、手动/定时刷新、原生保存 mock、清空取消/确认、重启暂停/空历史通过；新增合成记录约 15.1 秒可见 |
| test:quota:ui | 源码与 Windows exe：合成连接/刷新/失败/冷却/取消/移除、未知字段、重启缓存与自动关闭通过；不启动真实认证子进程 |
| 后端压力 | 六组通过：160,000 SQLite 新消息三轮总量恒为 17,920,694，数据库 hash 不变且原生一致；8,000 WorkBuddy 记录；200 重叠采集只一轮；20 账号/1,000 批调用的 20,000 次请求合并为 1,000 顺序读取；2,000 乱序碎片 RPC 与超大帧；20,000 投影行/3,000 图表计算 |
| 界面压力（源码） | 20,000 聚合行、100 模型、200 天；100/150 缩放启动 1.94–1.96 秒，20 次范围切换最慢 0.46 秒；20 并发 IPC 读取约 1.06 秒；无 page/console 错误及整页横向溢出 |
| crypto | 独立发送/接收进程；错误密钥、篡改、重复和重放拒绝；密钥不保存 |
| governance | 唯一入口、冻结版本、最小依赖、离线采集、独立 keyring 边界通过 |

压力测试不是持续数小时 soak 或物理休眠验收。160,000 条输入的测试进程峰值 RSS 约 824 MiB；该进程还生成 fixture、同步解析并保存历史，其 event-loop delay 不能等同于 Electron renderer 卡顿或单独产品内存。产品解析运行在 worker，真实界面压力另有独立测量。慢盘和更大历史仍可能进入既有 60 秒超时/退避，不能承诺所有机器无卡顿。

## 最终 Windows 交付核对

- 交付按代存放在 `dist/` 下的独立目录，每代含 `win-unpacked/`、Windows ZIP、源码 ZIP、manifest 和 `SHA256SUMS.txt`。本轮的最终交付为 `dist/nowdex-20261003/`，上一代 `dist/pricing-20261003/` 按计划保留。这两个目录共约 1.08 GiB（每代约 554 MiB）。`dist/win-unpacked` 只是 `dist:win:dir` 的构建输出目录，不再是保留交付。
- Windows 目录包的用量/额度完整流程均在 100/150 强制缩放通过。另验证 20,000 行/100 模型/200 天压力：启动 1.91–1.93 秒，范围切换最慢 0.476 秒，20 并发 IPC 读取 1.05 秒，无 page/console 错误或整页横向溢出。
- 61 个产品源码/资源/文档与 ASAR 逐字节一致，旧入口/上游模块/开发脚本不存在；package 的 main/name/version/dependencies 与工作区一致，builder 正常剔除开发字段，不能要求整个 package.json 字节相同。
- Windows ZIP 84 项、源码 ZIP 118 项：CRC 和 SHA-256 通过。源码所有归档条目与当前白名单文件比较一致，并验证不含 runtime/凭据/私人统计/real-account observations。
- Windows ZIP 解压到系统 TEMP 的中文/空格目录，执行包内源码核对及同一额度/用量 UI 流程通过。每个缩放下额外运行 3 次窗口刚出现即关闭，共 6 次，均正常退出；隔离目录在验收后清理。
- 新增合成记录在实际打包 UI 约 15 秒可见；暂停、确认清空和重启继续保持，未改写真实来源或连接。
- 另删除上次交付剩余 5 个文件、168,830,165 bytes。合计至少清理 6,076,946,335 bytes（5.66 GiB）旧文件，另有退役日期 helper；这是删除量，新保留的目录包与 ZIP 合计约 554 MiB，不能把删除量直接称为最终净空闲增量。
- 当前 runtime 图 21 个可达模块、两个生产依赖；研究保留 11 个文件。历史参考源码留在 Git，历史图片/真实验收观察留在被忽略的 `artifacts/history/`，均不作为新构建验收。

最终证据：`artifacts/maintenance/{runtime-audit,asar-results,archive-results,stress-results,ui-stress-results,usage-ui-results}.json` 与 `artifacts/quota/native-results.json`。最终交付 manifest 报告本轮合成检查及真实验收边界；SHA-256 列于各代交付目录内的 `SHA256SUMS.txt`（当前为 `dist/nowdex-20261003/SHA256SUMS.txt`）。

## 真实验收限制

本轮未读取现有认证文件、未登录/刷新/注销真实账号、未消费额度重置。上次真实账号证据仅属历史 `history/quota-stability-delivery.json`，不能自动推广到新构建。已有默认连接及独立验收连接保留，真实 logout 仍延期。

本轮界面测试使用强制 scale 与原生对话框 mock，未人工验收物理 DPI/系统对话框、真实多个账号、物理睡眠唤醒或新的单账号端到端登录。两个 ZIP 均不包含用户 runtime data、凭据、真实输入、私人统计、日志或 real-account observations。源码 ZIP 不含安装依赖；Windows ZIP 包含运行应用所需的 Electron 与生产依赖。

## 后续清理 — 2026-10-04

用户再次要求复查工作区并清理无用、过时文件。**本轮只删除已确认无归属的文件，未删除任何被当前产品、打包白名单、脚本默认值或文档引用的内容。** Codex 会话仍在运行（PID 38896、30492）；删除前确认 `dist/` 十分钟内无写入、`design/`、`artifacts/visual*`、`.cache/{nowdex-edit,quota-refine}.py` 全部未触碰。

- 系统 TEMP 清理两轮，共释放约 788 MB：过期的解压构建 `Agent Usage 定价验收 510f9e16…`（84 文件 / 395.7 MB）、56 个 `agentusage-quota-*` 测试残留、1,287 个空 `.tmp*` 目录、17 个 2026-09-30 的 Chromium profile/更新器残留（`cprof*`、`CC Switch-3.20.4-updater-*`、`bunx-*` 等，3,918 文件 / 392.5 MB）。TEMP 由 895.9 MB 降至 134.7 MB。剩余小项（harness 日志、`cloud_*.dat`、`workbuddy-*` spill）体积小且可能再生，未删。
- 删除 `dist/` 第一代根副本 5 项（`win-unpacked/`、Windows ZIP、源码 ZIP、manifest、`SHA256SUMS.txt`，88 文件 / 553.86 MB）。该代（10-03 20:58）的内容已被 `dist/pricing-20261003/`（22:42）和 `dist/nowdex-20261003/`（23:32）完整取代；删除前确认两代各自含 `win-unpacked/`+两个 ZIP+manifest+`SHA256SUMS.txt`。删除前 `dist/` 为 1,661.7 MB，删除后 178 文件 / 1,107.9 MB（保留的两代，每代 553.9 MB）。
- 接线两个原本无人引用的脚本：`npm run governance` → `scripts/m1/governance.js`（新增包装，转调 `governance.py`；裸 `python` 在本机是 WindowsApps 占位程序，必须用打包 Python，与 `source-archive.js` 同一模式）和 `npm run audit:package` → 既有 `scripts/m1/audit-package.js`。
- 这两项接线同时暴露并复现了一个真实风险：`audit:package` 逐字节比对 ASAR 与当前源码，因此**任何对 `docs/m1/CODEX-QUOTA.md` 等已打包文件的编辑都会立刻让交付包与工作树不一致**。本轮对 `CODEX-QUOTA.md:33` 的过时引用修正因此回退，未把已冻结交付置于不可复现状态。该过期行保留待下次重建交付时一并修正。
- 文档修正：`README.md:9` 指向已删除的根 ZIP，改为 `dist/nowdex-20261003/...` 并说明各代自成目录、不互相覆盖；`README.md:54` 构建流程保持 `dist/win-unpacked`（那是 `dist:win:dir` 的可重建输出目录，不是保留交付）；打包命令补 `--output-dir dist/nowdex-20261003`；证据索引补 `NOWDEX-UI-20261003.md`；本文第 57 行与第 66 行按"按代存放"改写。
- 复核：`npm run verify` lint + **48 项测试全通过**；`npm run governance` PASS；`audit:package` 对 `dist/nowdex-20261003` 报告 67 个文件逐字节一致。
- 未执行、仍需用户决定：`.cache/` 中 11 个未被任何文档引用的参考资料（保留其中 2 个属于 Codex 会话的编辑脚本）；`scripts/m1/{quota-protocol-smoke.js,prepare-ui-preview.js}`（功能正常但无人引用；后者依赖仍存在的 `src/m1/read-snapshot.js`）。

## 交付形态调整：每代一份 + 运行时共用 — 2026-10-04

上文第 57 行、第 72 行描述的是调整前的形态（每代含 Windows ZIP，每代约 554 MiB）。用户随后要求"每代只留一份 + 运行时共用"，本节记录调整结果；上文按当时事实保留，不追改。

**事实依据（测量，非估算）**：对 `activity-20261004`、`activity-fix-20261004`、`nowdex-20261003`、`pricing-20261003` 四代逐文件比对 `win-unpacked/`（各 84 项），**82 个文件约 156 MB 四代完全相同**，只有两个路径槽真正不同：`Agent Usage Quota.exe`（225,533,440 bytes，四个不同 SHA-256）与 `resources/app.asar`（约 25.9 MB，四个不同 SHA-256）。字节级比对显示两代 exe 仅差 59 字节，全部落在内嵌 asar 完整性清单区域，即除 asar 摘要外运行时未变。

**已执行**：
- 删除四份每代 `AgentUsage-CodexQuota-Windows-x64.zip`（`activity-20261004` 164,334,414 b、`activity-fix-20261004` 164,334,358 b、`nowdex-20261003` 164,332,141 b、`pricing-20261003` 164,328,711 b），**共释放 626.9 MB**。删除前逐个校验：路径在 `dist\` 前缀内、文件名精确匹配、是常规文件、相对深度为 2。ZIP 内容与同代 `win-unpacked/` 完全相同（此前已逐条核对 84 项名称与大小），且可由 `package-quota.py --windows-zip` 重建，因此删除不损失信息。
- 四代 82 个相同文件用 NTFS 硬链接共用：`scripts/m1/dist-share.js` 以相对路径 + SHA-256 分组，对同哈希成员 `linkSync` 到临时名后 `renameSync` 原子替换，**从不处理 ZIP**；累计折叠 467.9 MB。共 102 个 inode 承载 352 个文件。
- 调整后 `dist/` 形态：**352 文件，逻辑 1,588.9 MB，物理 1,121.0 MB**（此前四代含 ZIP 时逻辑 2,215.8 MB / 物理 1,747.9 MB，再早含根副本时 1,661.7 MB 仅两代）。每代目录 = `win-unpacked/` + `AgentUsage-CodexQuota-source.zip` + `AgentUsage-CodexQuota-delivery.json` + `builder-debug.yml` + `SHA256SUMS.txt`。
- 接线：`npm run dist:share`（共用）、`npm run dist:share:verify`（校验并打印逻辑/物理占用）。`--quiet-seconds` 默认 90 秒，树内近 90 秒有写入即输出 `BUSY` 并退出码 1，用于避免与正在进行的构建竞争；另有 `--dry-run`。
- 新增 `tests/m1/dist-share.test.js` 4 项：分组与 differing 判定、建链后同 inode 且不碰内容不同文件与 ZIP、dry-run 不改动 + 幂等 + 门禁可见性、verify 对同内容两个 inode 报 `physicalCopies`。**全部通过**，`npm run verify` lint 干净。

**manifest 与 ZIP 引用修正**：四代 manifest 与 `SHA256SUMS.txt` 原先仍列已删除的 Windows ZIP。`package-quota.py` 改为默认记录目录形态（`form: "directory"`、逐文件哈希合成树哈希、84 文件、按代字节数），新增 `--refresh-records` 只依据磁盘现有产物重写 manifest/`SHA256SUMS.txt`，不重建 ZIP；新增 `runtimeSharing` 字段说明共用方式。四代已用 `--refresh-records` 重写：`sha256` = `f80a3a4d…`（activity）、`0e162e5d…`（activity-fix）、`8886e0c8…`（nowdex）、`84bea910…`（pricing）。**注意树哈希定义已变（原为 ZIP 字节哈希），不与旧 `SHA256SUMS.txt` 可比。**

**只读验证**：`audit-package.js` 只比对源码/资源/文档与 ASAR，不涉及 `dist/` 产物，因此删除 ZIP 与重建 manifest 不影响其结论。

**未做**：未重新运行打包或 UI 测试（本轮不改产品代码，仅改交付形态与脚本）；物理 DPI、真实多账号、真实 logout 仍按前文延期。

## 后续环境整理 — 2026-10-04（第二轮）

用户要求继续清理无用与过时文件。本轮动作只涉及被 `.gitignore` 忽略的目录，**未改动任何被跟踪文件**（`git status --porcelain` 前后同为 1,072 行：1,007 `D` + 46 `??` + 19 `M`）。

**系统临时目录**：删除 3 个完整解压构建副本（`Agent Usage Range 中文`、`Agent Usage Nowdex 中文`、`Agent Usage Activity 中文`，各 84 文件 / 395.7 MB）与 60 个 `agentusage-quota-*` 测试残留，**释放约 1,187 MB**（1,619.3 MB → 468.4 MB）。删除前逐个用 `Resolve-Path` 校验绝对路径位于临时目录之下且文件名匹配白名单前缀，`refused: 0`。

**`.cache/` 解压验收残留**：`detail-delivery-check`（233 文件 / 559.3 MB）与 `motion-delivery-check`（512 文件 / 563.6 MB）**共释放 1,122.9 MB**（1,123.5 MB → 0.6 MB）。两者零脚本引用，仅被 `docs/m1/DETAIL-UI-20261004.md`、`docs/m1/UI-MOTION-20261004.md` 的文字描述提及，内容可由 `package-quota.py` 从 `dist/<代>/win-unpacked` 重新解包得到。删除门禁：位于 `.cache\` 之下、叶子名精确匹配、最新写入龄 ≥10 分钟。首次尝试因另一位写入者刚写 `design/desktop-reference/{detail-interactions.js,detail-ui.css,motion.js}` 被门禁拦下。

**`dist/` 长到 7 代后重新纳入共用**：`detail-20261004`、`motion-20261004`、`polish-20261004` 加入后运行 `npm run dist:share`，**新建 246 个硬链接**；一次因写入者占用 `tokscale.exe` 报 `EPERM`，重跑成功（`linked: 1, alreadyShared: 491, failures: []`）。最终 `npm run dist:share:verify` 输出 `status: OK`：**7 代、82 组、0 失败**；`files 613`、`physicalFiles 121`、`logicalBytes 2,914,342,122`、`physicalBytes 1,933,048,218`、`collapsedBytes 981,293,904`。全部 7 代的 `dxcompiler.dll` 均为 `links=7`。每代仍只保留 `win-unpacked/` + 源码 ZIP + manifest + `SHA256SUMS.txt`，**无任何每代 Windows ZIP 残留**。上文第 95 行的「四代 / 352 文件」是当时快照，未追改。（2026-10-04 现状注记：dist/ 现实际仅保留 polish-20261004 一代，旧代已不在，本节 7 代数字为当时快照。）

**复核**：`npm run verify` lint 干净、**55 项测试全部通过**。`.cache` 中剩余 23 个文件均为另一位写入者的脚本或参考素材，未删。

**未处置项**：`docs/m1/DETAIL-UI-20261004.md` 与 `docs/m1/UI-MOTION-20261004.md` 正文仍提到已删除的 `.cache/*-delivery-check`；这两个文档当时正被另一位写入者重写，为避免覆盖其改动本轮未修改，该处仅影响文字叙述、不影响可重建性。`docs/m1/CODEX-QUOTA.md` 中指向 `.cache/codex-schema` 的引用同样悬空未改；该文件在 `package.json` 的 `build.files` 内，修改后须重跑 `audit:package` 同步 ASAR。`scripts/m1/quota-protocol-smoke.js` 无任何引用，但为功能正常的手动登录握手工具，保留不删。

### 2026-10-04 独立审查修复轮（副开发角色）

依据用户提供的工程批评基准（测试弱化/可读性/短视补丁/死代码/职责错位/诚实性六类）启动独立只读审查线程，返回 7 项修复清单；主线程修复后复验。本轮处置：

- **会话交接记录中的 dist 保留声明修正**（该记录现已移出版本控制）：原声明与实测不符（实际仅 polish-20261004 一代），已改为以复核修正为准的表述。
- **src/m1/store.js 导出面收窄**：module.exports 从 { Store, atomic, load, day, price } 收窄为 { Store, atomic, price }；load/day 无任何外部 require 引用（day 仅 store.js:71 内部使用），grep 全仓确认。
- **src/quota/rpc.js:39 缓冲上限改字节计数**：原 this.buffer.length 为 UTF-16 码元数（worst case 约 4MiB 字节才触发），改为 Buffer.byteLength(this.buffer, 'utf8') 精确 2MiB 字节，且只计未消费积压（行提取后自然递减）。quota-lifecycle.test.js:49-50 与 stress-test.js:108-109 用 ASCII 溢出用例验证仍有效。
- **scripts/m1/quota-protocol-smoke.js 用法在此记录**（该文件不删）：手动协议冒烟，需显式指定官方 CLI 可执行文件，例 node scripts/m1/quota-protocol-smoke.js "C:\\path\\to\\codex.exe" [--login-handshake]；使用隔离临时 CODEX_HOME，断言空账号、无 auth.json 生成、可选登录启动即取消；不读取本机现有 Codex 认证。
- **preview.js 二次拆行（复验后补）**：复验发现首轮机械拆行后仍残留 11 行 >300 字符（Chart.js options 对象、一行流函数、三元链无 `' + '` 边界），已用字符串感知脚本在字符串外 `, `/`; ` 边界断行 + 2 行手动拆分，最终 705 行、0 行 >300 字符，纯格式改动。
- **文档时点注记（复验新发现处置）**：SESSION-HANDOFF-20261004.md:133 历史验收包名清单与 MAINTENANCE-20261003.md:113 「7 代共用」均为历史时点快照、与当前 dist/ 仅存 1 代的现状易混淆，两处已加「当时快照/现状注记」标注。
- **遗留待用户决定（本轮不动）**：.cache/ 中 .cache/polish-delivery-check/ 约 500MB 交付校验副本与约 24 个根级研究残留（activity-*.py、nowdex-*.py、cc-switch-tree.json 等）——均为另一位写入者（Codex 主开发）的素材，按门禁规则不删，待其确认；CODEX-QUOTA.md:33 悬空引用因 ASAR 字节一致约束仍暂缓（同上文先例）。
