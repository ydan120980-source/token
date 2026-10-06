# Agent Usage 接入首轮独立审查 — 2026-10-05

结论：**暂不通过**。九来源适配器、共享桌面流程和 Windows 候选已能运行；本轮核实五项统计或状态问题，其中 R1、R3、R4 会重复计数，R2 会降低已经记录的流式用量，R5 会将不完整压缩读取标作成功。主线程修复后需要绑定新指纹复验。本报告不代表整个用户任务完成。

本轮采用批准的首轮配置：独立审查者，gpt-6.1-sol，xhigh，显式指定，45 分钟上限。没有创建、派发或恢复子代理。没有修改产品、测试、脚本、文档、偏好或 dist；仅创建自己的 ignored 审查产物，并运行允许的隔离检查。未读取真实来源、认证或配置，未操作真实账号、调用付费推理或上传统计。公开官方源码、文档和官方发布的 SDK 包仅用于格式核验。

## 固定基线及环境

- 开始与结束源码指纹：160 文件，`885e5ca3f0fc9ecac6290a0ae69d4742e147654401296c156fa6880fd8908b69`。
- 源 ZIP：208 项，CRC 与当前源码逐字节匹配，SHA256 `1fcfb02dae3044e1dc3175fb9f30a5955fdb0c03609adea0ac68837306362d8f`。
- Windows 目录：84 文件，开始指定值和结束重算值一致，`db12d0149d39843ef697b42c568c72c55b4a93b56c0df6850820ccc0eb862474`；ASAR 101 项与源码匹配。
- Node v24.13.1；bundled Python 3.12.14。产品入口仍为 `src/quota/main.js`。
- 没有可调用的 CodeGraph；使用定向源码、官方格式和隔离复现核验。
- 应用 frontend-testing-debugging 的 Playwright 分支：Browser 插件未列出，目标为原生 Electron。所有 UI 都使用自己的 usage/quota 目录和 synthetic fixture home。
- 候选 UI：100%/150% 缩放，标准窗口和 800×600 窗口，深浅主题/减少动态由专项脚本覆盖；身份检查的实际 viewport 为 1182×852，URL 为候选 ASAR 中的 `design/desktop-reference/index.html`，title 为 `Agent Usage · Codex 额度`。

## 六维判断

| 维度 | 已核验 | 判断和缺口 |
|---|---|---|
| 需求完整性 | 已有四来源完善和新增四来源均有实际解析器；九来源目录/文件白名单、图标、来源状态、计费默认和全页 scope 已接入；账号额度仍仅 Codex | 部分满足。Cursor 默认 SQLite/普通 IDE、CLI 覆盖未完成，不能把合同中的排除自动当成用户缩小验收范围。Gemini/Cursor 没有真实样本，Harness v0/v1 未支持，ZCode 正 reasoning 未真实核对。 |
| 逻辑正确性 | 总量、缓存/推理桶、重试/fork/rewind、同扫描去重、坏 JSON 行、模式冲突与显式模型映射通过已有检查 | 不通过。R1/R3/R4 重复计数，R2 持久累计值回退。 |
| 边界情况 | 未知/零、非法 CSV、最高 generation、双编码拒绝、未来格式拒绝、暂停/退出/重启、源/产品目录重叠、坏文件保留历史已覆盖 | 不通过。持久历史和当前去重不一致、等价序列化变化、较旧快照、压缩尾帧完整性仍有缺陷。 |
| 代码质量 | 唯一入口、42 个运行模块、来源目录和字段投影、HMAC 标识、统计导出白名单、当前产品网络约束、本地资产通过检查 | 部分满足。跨来源索引仅存在于一次 scan；sharedKey/CSV ID 依赖原始序列化；持久更新规则与 scan 的最大快照规则不同；解压已消费字节不能证明帧完整。 |
| 测试覆盖 | ESLint、94 测试、native、stress、crypto 与多项原生 UI 已独立重跑 | 不足以放行。现有测试没有 R1–R5 的有状态/等价序列化场景；Harness v2/v3 测试只改 v4 fixture 的版本号，没有真实样本证据。functional 首轮失败、复跑通过，稳定性待加强。 |
| 实际运行结果 | 候选与自己制作的中文空格路径解压版通过九来源 UI；候选 quota/usage/functional 复跑/motion/overview/continuity 通过 | 合成运行通过，不等于统计正确或真实接入全面通过。真实结果只审读冻结 aggregate report，不重新采集真实来源。 |

## 修复清单

共同复现工作目录：`E:\project\My_project\项目测试\codex\token`。脚本只创建并删除自己的临时合成 home/store，结果写到 `artifacts/review-agent-integration`。以下问题全部由主线程修复，审查者没有修改代码。

### R1 — P1，跨来源去重没有覆盖持久历史

- 位置：`E:/project/My_project/项目测试/codex/token/src/m1/store.js:53`；关联 `src/m1/sources.js:92`、`:138`。
- 命令：`& E:/ai/node.exe artifacts/review-agent-integration/repro-edges.cjs`，看 `realScanPersistentDedup`。
- 样本/步骤：只存在 MiMo SQLite 的请求 `same-request`（input 60、output 20、reasoning 2、cacheRead 40），首次扫描并入账；随后新增相同请求的 OpenCode JSON，再次扫描。当前 scan 正确只输出 OpenCode 1、MiMo 0。
- 预期/实际：持久账本仍为 122；实际 244，同时保留 MiMo 和 OpenCode 两条相同 sharedKey 记录。native 只核对本次 scan，不能发现历史合并后的重复。
- 影响：来源目录变化、历史源不可读或新发现副本后，总量、趋势和价格估算重复。
- 建议及验收：持久层对跨 Agent 同一调用维持稳定的重复抑制规则；保留数据和可恢复备份。测试两种首次来源顺序、旧源缺失/重新出现、新源出现、重启与价格估算，累计始终只计一次。迁移旧账本不能清空数据或因换签名再重计。

### R2 — P2，较旧流式快照覆盖较大已保存用量

- 位置：`E:/project/My_project/项目测试/codex/token/src/m1/store.js:53`，覆盖发生在 `:55`；同扫描的最大快照规则在 `src/m1/sources.js:146`。
- 命令：`& E:/ai/node.exe artifacts/review-agent-integration/repro-ledger.cjs`，看 `staleClaude`。
- 样本/步骤：同一 Claude message ID，input=100、缓存=0，先保存 output=20 的 measured 快照，再读取 output=10 的较旧 measured 快照。
- 预期/实际：不能无告警降低已产生用量；预期保持 120 或报告计数回退。实际从 120 降到 110，两个快照均 measured，未报告冲突。
- 影响：旧副本、流式日志截断/替换、选择较旧来源后，累计与估算减少；在一次扫描中有效的最大快照规则没有延续到持久更新。
- 建议及验收：对累计/流式来源使用明确的持久快照选择规则，不要逐桶简单取最大值制造新记录。测试大→小→大、质量改善/降级、不同桶但同总量、重启以及 Cursor 累计 run/Gemini 重复快照，保留明确冲突语义。

### R3 — P1，跨 Agent 语义去重依赖 JSON 键顺序

- 位置：`E:/project/My_project/项目测试/codex/token/src/m1/normalize.js:45`。
- 命令：`& E:/ai/node.exe artifacts/review-agent-integration/repro-edges.cjs`，看 `realScanKeyOrder`。
- 样本/步骤：OpenCode JSON 和 MiMo SQLite 具有相同请求 ID、模型、时间和五桶；仅将 MiMo 的 tokens 属性改为 `cache, reasoning, output, input`，缓存属性改为 `write, read`。
- 预期/实际：两种合法 JSON 序列化应代表相同用量调用，预期 122；实际 scan 收到两条、总量 244。`JSON.stringify(usage)` 将对象插入顺序纳入 sharedKey。
- 影响：导出、迁移或重新序列化后的相同副本绕过合同承诺的语义去重。
- 建议及验收：对批准的语义投影生成规范签名，明确未知/零和版本规则；考虑旧账本兼容，不能只修改新签名。覆盖字段顺序、等价支持字段名、无关字段变化、真实不同请求和重启。

### R4 — P1，无 Request ID 的 Cursor CSV 在等价导出变化后重计

- 位置：`E:/project/My_project/项目测试/codex/token/src/m1/extended-sources.js:89`，ID 构造在 `:90`。
- 命令：`& E:/ai/node.exe artifacts/review-agent-integration/repro-edges.cjs`，看 `csvOptionalTotal`、`csvEquivalentTime`、`sameCsvFileUpdated`。
- 样本/步骤：同一 `full.csv`、同一条无 Request ID 调用，时间 `2026-10-05T12:00:00Z`，input=60/cacheRead=40/cacheWrite=10/output=20，总量 130。首次有 `Total Tokens` 列，第二次只移除这份合同允许省略的列。另一个等价变化为时间改成 `2026-10-05T20:00:00+08:00`。
- 预期/实际：规范时间、模型、桶及相同 occurrence 不变，预期仍为 130；同文件更新后实际 260。等价时区的规范 timestamp 相同，ID 仍不同。
- 影响：完整 CSV 重新导出或覆盖原文件即可扩大历史账本；不是合同已警示的多个部分导出无法确定重叠的问题。
- 建议及验收：签名采用规范投影后的时间和计量字段，排除冗余可选总量表示。保留相同调用特征的实际重复次数；测试可选列增减、等价时区、复制完整导出、同一完整文件更新、相同 timestamp 的两次真实调用和旧账本迁移。

### R5 — P2，Harness 截断 Zstandard 尾帧没有标记不完整

- 位置：`E:/project/My_project/项目测试/codex/token/src/m1/extended-sources.js:113`、`:115`；状态影响 `src/m1/store.js:67`。
- 命令：`& E:/ai/node.exe artifacts/review-agent-integration/repro-edges.cjs`，看 `tornCompressedTail` 与 `tornRawTail`。
- 样本/步骤：一个完整压缩帧含 v4 header 与 120-token 调用，串接下一帧的一半字节，文件在读取期间保持稳定。作为对照，raw JSONL 有相同有效前缀和截断尾行。
- 预期/实际：保留 120，同时 partial=true、固定不完整诊断且不推进最近成功时间。实际压缩输入返回记录 1、120 token、partial=false、errors=[]，并设置新的 lastSuccess；raw 对照正确 partial=true。当前 Node 同步解码器可能消费全部不完整输入而不抛错，bytesWritten 不证明完整帧。
- 影响：崩溃留下的稳定尾帧和暂时截断的文件被呈现成完整成功读取，遗漏范围不透明。
- 建议及验收：确认压缩帧完整性并将不完整状态传入 SourceCapability，同时保留有效前缀；不要放宽完整已提交帧损坏的拒绝规则。覆盖空输出的短尾帧、尾帧部分 JSON、多完整帧、校验损坏、未知压缩支持、历史保留和 lastSuccess。

## 已运行的检查和证据

| 检查 | 本轮结果 | 产物 |
|---|---|---|
| verify | ESLint + 94/94 | `verify.log` |
| native | 原五来源，6 记录，694 token | `native.log` |
| 九来源 native / UI | 11 记录，1204 token；候选和独立解压版均 100%/150% 通过 | `packaged/results.json`、`extracted/results.json` |
| stress | 六场景通过：160k SQLite ×3、8k WorkBuddy、200 并发 refresh、20k quota 排队、RPC 碎片/溢出、20k 图表行 | `stress.log` |
| synthetic crypto | 独立进程错误钥匙/篡改/重放/重复拒绝通过 | `crypto.log` |
| runtime / ASAR | 42 个模块，101 项 ASAR 逐字节匹配 | 当前 `artifacts/maintenance` 的 audit 结果及冻结副本；本轮没有触碰 frozen-evidence |
| quota UI | 100%/150%，合成登录/刷新/错误/冷却/取消/退出/重启，无真实凭据进程 | `quota-ui.log` |
| usage UI | 100%/150%，刷新/暂停/定价/导出/目录保护/重启通过 | `usage-ui.log` |
| functional UI | 首轮 `functional-ui-test.js:26` 金额 hover 展开断言失败；复跑两缩放完整通过 | `functional-ui.log`、`functional-repeat.log`、`functional-repeat/results.json` |
| motion / overview / continuity | 100%/150%，范围、未知值、tooltip、动效、重入、分钟刷新、图标/键盘、减少动态通过 | 各自 `*-ui.log` 和结果目录 |
| UI 身份 / 截图 | ASAR index 路径、正确 title、10 个 Agent 按钮、1.2K 统计、无 page/console error | `ui-identity.json`、`identity-usage.png` |
| 源 ZIP / Windows / 独立 ZIP 解压 | 208 源项、84 Windows 文件、CRC、当前源码和目录树匹配 | `delivery-audit.json`、`final-delivery.json` |
| 基线结束复核 | 160 项指纹与开始一致，候选和源 ZIP SHA 不变 | `current-fingerprint.json`、`final-fingerprint.json` |

## 非阻断建议和样本/范围卡点

- **N1，测试稳定性**：functional 首轮 hover 断言失败，复跑通过。未核实产品稳定回归，原因仍未知。保留首轮日志，并补充原生窗口 show 与目标 hover 状态的等待证据；不能把首次失败抹去。该项不列为已确认产品缺陷。
- **N2，审计证据口径**：`src/m1/worker.js:6` 和 `scripts/m1/agent-real-check.js:10` 的 sourceWrites/authenticationReads 是初始化为 0 的字段，没有独立的全文件访问监测。源码只读路径、合成源 SHA 不变和固定网络拒绝测试提供支持，但不能仅凭这些 0 声称真实读取已经由独立访问审计证明。
- **G1，Cursor 范围缺口**：官方 SDK 默认使用 SQLite，NDJSON 是显式替换 backend；现实现拒绝默认 index.db，也不覆盖 IDE 私有 state.vscdb 或普通无 usage CLI transcript。只有用户现有 JSONL SDK 或合格逐调用 CSV 可接。原用户选择的是 Cursor 本地用量，合同中的排除不自动授权缩小需求；主线程需明确实际目标并补齐，或取得用户对有限支持的明确接受。依据：[官方 Local agent stores](https://cursor.com/docs/sdk/typescript#local-agent-stores)，以及已静态核验的官方 `@cursor/sdk` 1.0.35 发布包。没有执行 SDK 或调用模型。
- **G2，Gemini/Cursor 真实样本**：没有本机真实调用样本；本轮只确认官方格式对应、合成 fixture 和 Electron 实际运行。真实路由/时间/缓存/重试、Cursor 导出的可获得性仍未验收。Gemini 字段与录制语义依据：[官方 Types](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts)、[Recording Service](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingService.ts)。不能自行调用付费推理来填此缺口。
- **G3，Harness / ZCode 覆盖**：只审读 `artifacts/m2-agents/frozen-evidence/real-aggregate-check.json`：ZCode 1 库、23096475 token 匹配；Harness 35 候选中 29 稳定/可比、110110224 token 匹配，6 份跳过不算通过。独立对照函数明确只比较 Harness v4，不能将这 29 份推广为 v2/v3 真验收。v0/v1 未支持；6 份的具体原因未在 aggregate 中列明。ZCode 正 reasoning 和未公开的数据库语义变体只有合成证据，不能推断真实全面通过。Harness 尾帧恢复/冻结历史规则依据：[官方持久化后端](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-persistence-jsonl/README.md)。
- **G4，实际人工验收**：没有重读真实日志或账号，没有真实 Gemini/Cursor 推理，没有长时运行/休眠恢复或物理显示器动效人工验收。源码启动的旧冻结证据仅审读；本轮实际 UI 主体运行的是与源码一致的候选和自己的独立解压版。

所有修复由主线程实施。R1–R5 修复及旧账本兼容验收前不放行；G1–G3 未补足或经用户明确接受前，不能宣布所有目标 Agent 全面接入完成。后续独立复验仍需逐次批准精确执行配置；本轮授权不覆盖新执行。

临时产物清理说明：自动审批审核拒绝了清理本轮自己创建的 `中文 空格 解压/` 和 `review-windows.zip`，返回理由仅为 `blocked by policy`。未改用其他方式绕过。两项保留在本 ignored 审查目录，原候选及历史 dist 未清理或改写。
