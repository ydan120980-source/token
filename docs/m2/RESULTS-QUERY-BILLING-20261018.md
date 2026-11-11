# 只读查询、别名建议与计费流程交回记录（2026-10-18）

2026-10-19 后续：所有者已明确授权本线程继续三项后端维护、按记录复核并本地合入。以下保留原交回时的历史状态；当前复核与验收见 [RESULTS-BACKEND-CONSISTENCY-20261019.md](RESULTS-BACKEND-CONSISTENCY-20261019.md)。

状态：本轮四项范围已交付，可供原主线程验收。前三项已实现并合成验证，第四项仅文档探索。实现提交 `e0f027d`；主题分支 `codex/query-billing-20261018`，以本地 main `7a2d8fb` 为基线。首轮四小时预算内完成，未追加预算，未派发其他 Agent。工作树保留；未合入共享 main、未 push/开 PR、未替换运行包或生成正式发布代次/源码 ZIP。

## 提交与批准 UI

| 本分支提交 | 内容与来源 |
| --- | --- |
| `452bcd2` | 已批准原费用排版；带入 `e5ebd38` |
| `3d3d40d` | 趋势数值避让整条曲线；带入 `ea5385f` |
| `86976da` | 316 CSS px 三列紧凑展开与完整趋势；带入 `a11f4c7` |
| `1f4d60b` | 先提交本轮实施范围、四文件读取与查询隐私合同 |
| `e0f027d` | 查询、共享计价/旧账本整理、显式别名建议、计费流程及阶段 3 探索文档 |

没有重复创建 worktree；使用平台创建的独立工作树和 codex/ 分支。批准 UI 的两份记录已补记所有者“可以了”的确认，不再等待概念审批。CodeGraph 工具不可用，按定向源码、调用链和测试验证公共接口。

## 四项交付

| 项目 | 已交付 | 验证及边界 |
| --- | --- | --- |
| 工作台阶段 2 | `query-entry` 提供 CLI / stdio MCP 的 `usage_query`，SDK 锁定 `1.32.1`；筛选、分组、分页、输出 schema、受控错误与限额；无 HTTP/TCP | Node 和 Windows EXE + ASAR 的真实外部 SDK 客户端均启动、initialize、枚举并调用成功。实际协商 `2025-11-25`，工具只有 usage_query。没有安装或修改真实 Agent 客户端配置 |
| 智能别名建议 | 本地目录/用户费率的完整标识匹配，解释原因、版本、服务商和费率；歧义不选择，点击候选只预填，明确保存才写映射 | 合成日期型号、多个候选、null/零、无候选、刷新保持展开、保存失败重试通过；不猜后续型号，不新增历史价格，不补用量桶或取消冲突 |
| 自定义费率与倍率 | 未使用的自定义费率也可编辑/移除；单位、作用范围、空白/零区分、行内校验、默认恢复草稿、失败重试；移除不受无效费率草稿阻塞 | 源码与打包版的 100%/125%/150%、800px 窄窗口通过，动态注册来源也可配置；映射/费率/倍率/移除失败均保留输入；保存成功后刷新失败仍报告已保存 |
| 阶段 3 远期探索 | 十个 Agent 的官方依据、候选文件/字段白名单、四态、脱敏、隔离与未来验收矩阵 | 只有文档；没有配置读取、解析器、扫描入口或审计 IPC。WorkBuddy 持久化路径等未确认项保持空白名单/未检查。未来哨兵/配置审计测试尚未实施 |

实施合同：[QUERY-BILLING-SCOPE-20261018.md](QUERY-BILLING-SCOPE-20261018.md)、[SAVED-QUERY-20261018.md](SAVED-QUERY-20261018.md)。探索交付：[CONFIG-HEALTH-EXPLORATION-20261018.md](CONFIG-HEALTH-EXPLORATION-20261018.md)。README、隐私、工作台方向与 AGENTS 同步更新。

## 统一计算与隐私

查询只读取应用自有 `statistics.json`、`billing.json`、`pricing.json`、`model-pricing.json`；参数不能改变读取目录，启动时才可选择。整组双读、变化有限重试；缺失可选文件采用 GUI 默认，存在但损坏受控失败，不隔离或修复。没有 Store 构造器、来源扫描、tokscale/Agent/额度调用或价格下载。

GUI 与查询共用 Store estimate/resolvePrice、纯 billing 校验、迁入 src/m1 的 usage-math/insights-math 和费用汇总。旧账本的重复记录与 WorkBuddy 汇总替代规则从构造器抽为共享 ledger-view，查询只在内存整理；保持首存身份、完整快照选择、顺序无关与冲突保护，文件字节不变。Cursor 的 csvIdentity 回填不影响已有聚合，查询不回填。

输出逐字段构造，不返回路径、原始或散列会话/记录 ID、配置映射、逐文件索引、项目或会话元数据。缺会话标识时 sessions 为 null，knownSessions 为已知下限。空桶/未定价仍为 null，显式零保留。错误不回显原文、参数、路径或堆栈。进程内护栏禁止常见写入、子进程、连接与监听，但不宣称 OS 沙箱。外部 Agent 可自行把聚合发给其模型服务商，应用自身无新增上传。

新增 SDK 的安装没有改变锁文件中原有依赖的版本；已核对 common package paths 的版本变化为空。运行入口仍为 src/quota/main.js，无第二个 GUI、无独立工作台页面。

## 本轮已执行检查与证据

所有例程使用独立 usage/quota 与合成 home；没有运行 validate:local，没有真实来源/账号验证。下表的 source/、billing-ui/、regression/、packaged/ 简写均以本工作树的 artifacts/query/ 为根。

| 命令/检查 | 结果 | 本工作树下证据 |
| --- | --- | --- |
| `npm.cmd run verify` | lint 通过，单元 fail 0 | `artifacts/query/source/verify-final.log` |
| `npm.cmd run audit:runtime` | 通过，包含查询入口及迁移后的共享脚本 | `artifacts/query/source/audit-runtime.log`、`artifacts/maintenance/runtime-audit.json` |
| `npm.cmd run test:native` | 合成原生校验通过，来源只读、Node 网络尝试为 0 | `artifacts/query/source/native-final.log` |
| `npm.cmd run pricing:check` | 通过，价格重建一致 | `artifacts/query/source/pricing-check.log` |
| `npm.cmd run test:query:integration` | CLI 与独立 SDK 客户端通过；含坏参数、损坏保存文件、畸形/超长帧、隐私与不写盘 | `artifacts/query/source/integration-final.log`、`source/results.json` |
| 文档中的 PowerShell CLI + JSON 参数 | 含空格目录实测通过 | `artifacts/query/source/cli-powershell.json`；输入为 `artifacts/query/cli fixture` 合成账本 |
| `node scripts/m1/billing-query-ui-test.js` | 三档缩放与窄窗口、别名、费率、倍率、动态来源、保存/移除失败重试通过 | `artifacts/query/billing-ui-final.log`、`billing-ui/{1,1.25,1.5}/` |
| cost-layout / cost-compact / cost-rebuild / cost / style-alignment / custom-sources UI | 全部通过，保留原费用骨架、完整曲线/历史入口与 316px 展开 | `artifacts/query/regression/final-suites.json`、对应 `*-final.log` 与各套件子目录 |
| functional / usage UI | 源码受影响流程通过 | `artifacts/query/regression/functional-final.log`、`usage-final.log`；用量截图/结果仍按原套件写入 `artifacts/maintenance/` |
| 获批费用页同态视觉对照 | 125% 同合成 fixture、同页态内容一致，差异仅位于右侧滚动条的 29 个像素 | `artifacts/query/source/visual-comparison.json`、`regression/cost-layout/overview-light-1.25.png` |

定向测试覆盖：旧/空账本、零倍率对未知仍不定价、旧重复记录与冲突、partial 快照顺序、动态来源、日期/分页/未知参数、整组读取变化、原子写失败清理、只访问四文件、原始身份/路径哨兵不出输出。运行时护栏另在独立子进程中验证监听、网络、写盘和 spawn 均被拒绝。

### 隔离构建验证（不是正式发布验收）

```powershell
node scripts/m1/check-build-deps.js
node_modules/.bin/electron-builder.cmd --win dir --x64 --publish never --config.directories.output=artifacts/query/build
node scripts/m1/audit-package.js artifacts/query/build/win-unpacked
```

真实 node_modules 目录通过构建前检查；未绕过目录联接检查。当前源码/资产/必需文档与 ASAR 逐字节一致，包内 tokscale 的固定 SHA-256 通过。证据：`artifacts/query/packaged/build-deps.log`、`build-final.log`、`audit-package-final.log`。

外部协议测试设置 `QUERY_PACKAGED_EXE` 为该隔离 EXE、`QUERY_EVIDENCE_DIR=artifacts/query/packaged`。客户端以 `ELECTRON_RUN_AS_NODE=1` 运行 ASAR 内 query-entry，数据目录含中文与空格。实际 initialize 内容、工具名和合成返回聚合保存在 `artifacts/query/packaged/results.json`，日志为 `integration-final.log`。这不是只 require 模块的测试。

另以 `QUOTA_PACKAGED_EXE` 和 `BILLING_EVIDENCE_DIR=artifacts/query/packaged/billing-ui` 跑新增计费 UI 的三档缩放；通过记录为 `packaged/billing-ui-final.log` 与各缩放子目录的 results/screenshots。UI 测试中的文件保存失败都是故意制造的合成目录阻塞。

## 首次失败与修正

- 初版查询检查发现内部费用汇总没有公开导出、合成 provider 与手动费率键不一致；修正共享导出和 fixture 后定向测试通过。
- 首次全量 verify 的旧预览 fixture 没有 Store v1 的 version 字段，被新的只读校验拒绝。fixture 补成合法 v1 账本，未放宽坏文件校验；首轮日志 `artifacts/query/source/verify.log` 保留，最终复跑 fail 0。
- 新测试脚本初次 lint 缺浏览器全局声明/有未用导入，已修正，最终 lint 通过。
- 加强打包客户端“不写盘”目录断言时，测试误假设 preferences.json 已存在；改为比较实际初始目录，未改产品逻辑。失败日志 `artifacts/query/packaged/integration-guard-first.log` 保留；最终源码与 EXE 客户端复跑通过。
- 旧账本与 GUI 启动整理的差异由源码检查发现并抽成共享纯内存逻辑；新增旧副本、较大观测、冲突与 WorkBuddy 对照通过，没有用旧检查替代新检查。

## 限制与未执行

- 没有真实来源、真实账号、凭据、模型 API 或付费服务操作；未安装/修改任何 Agent MCP 配置。官方 SDK 客户端证据不能替代每个真实产品客户端的人工验收。
- 查询不是多文件跨进程事务。每次请求读取稳定保存区间；跨页价格或数据可能变化。损坏保存文件由查询受控拒绝，恢复仍由应用或人工处理。
- 别名建议保守匹配完整版本/日期/限定词。没有目录依据的历史型号保持无建议/未定价，不以更新型号替代，也不从价格高低做决定。
- 配置健康仅有资料和设计，未来脱敏哨兵矩阵、解析器、真实扫描和页面验收均未执行；未确认文件路径保持空白名单。没有阶段 4。
- 本轮隔离构建不等于完整发布候选：没有全套 stress/crypto、所有打包 UI 的统一枚举、中文带空格的解压包逐字节对照和解压副本采集验收，没有正式代次/源码 ZIP/运行替换。r15/r16 保留。

## 原主线程验收与本地合入步骤

1. 在保留工作树检查 `codex/query-billing-20261018`、`e0f027d` 与上述证据；可用 `git diff main...codex/query-billing-20261018` 审查。当前共享 main 只读检查为干净的 `7a2d8fb`，origin/main 仍为 `4d011eb`。
2. 重点复核四文件封闭读取、纯旧账本整理与 Store 的统一计价；查看外部 EXE 客户端 initialize/tools/query 实际结果；对照别名选择、失败重试截图和获批费用同态图。需要重验时使用本文件的合成命令，不能改用真实来源。
3. 主线程实际合入前再次确认共享 main 干净、没有其他会话正在合并。若本地 main 有新提交，先在主题分支整合并按影响补测，再由主线程在共享目录用 `git merge --no-ff codex/query-billing-20261018` 合入；不 push/开 PR，不从 origin/main 拉取旧基线。
4. 共享主仓库按新 lockfile 准备真实依赖目录（`npm.cmd ci --ignore-scripts --no-audit --no-fund`、`node node_modules/electron/install.js`），再进入正式发布候选流程。隔离构建不代替这一环。
5. 正式新代次由发布 owner 按 CONTRIBUTING 执行 headless、dist:win:dir + audit:package、动态枚举全部 packaged `*-ui-test.js`（含新增 billing-query）、MCP EXE 集成，以及中文空格解压副本字节校验和采集验收；保留 r15/r16，通过后才替换运行包。

本线程到此交回，不继续 Backlog、不自行合入、发布或派发新任务。
