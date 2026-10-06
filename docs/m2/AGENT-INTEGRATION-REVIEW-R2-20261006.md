# Agent Usage 接入第二轮独立复验 — 2026-10-06

结论：**暂不通过，返回主线程修复 R6–R8**。首轮 R1–R5 的原具体复现均已通过，新支持的 Cursor 默认 SDK SQLite 和本轮合成桌面运行也通过；扩展重放确认三个遗漏，分别影响冲突诊断、完整用量的保留和旧账本的 Agent 归属/计费倍率。本报告不代表整个用户任务已完成。

## 执行范围与固定基线

采用用户于 2026-10-06 批准的配置：Agent Usage 接入独立审查，gpt-6.1-sol，xhigh，均显式指定，45 分钟软预算。本轮约 15 分钟完成。没有创建、派发或恢复子代理。没有修改产品、项目测试/脚本/文档、偏好、dist 或真实数据；仅写自己的 ignored artifacts，执行隔离合成检查。没有读取真实来源、认证或配置，没有真实账号操作、付费推理或统计上传。此前审查及交付保留。

- 源码开始/结束：162 文件，SHA256 b0c990fdf7f0a1bc9695eb7d30a2f8e562b677e272ae49b5cae8bf4430ed7a37。
- 源 ZIP：211 项，CRC 通过，全部与当前工作区逐字节一致；SHA256 b9749084149b7838685da1cbd98593e5d086a460ba1578cbf32201f7ba28b9b9。
- Windows 候选：dist/agents-20261005-r2/win-unpacked，84 文件，Windows pathlib 规范树 SHA256 5e883d8955154426ca793c8628edd6d27e4b33651605b78abe1f873503d66002；开始/结束一致。
- 自己制作 ZIP，在“中文 空格 解压”路径解压，CRC 与 84 文件树一致，并实际运行九来源 UI。
- ASAR 102 项源码/资产/文档逐字节一致；runtime audit 为 43 个模块，唯一入口 src/quota/main.js。
- CodeGraph 工具不可用，采用定向源码、官方发布包静态核验、合成复现和测试。原生 Electron 没有可用 Browser 插件 surface，使用项目 Playwright/Electron 路径。所有 UI 串行，明确指定独立 usage/quota 与 synthetic fixture home。
- canonical 树值以 delivery-audit.json / final-delivery.json 的 Python Windows pathlib 算法为准。ASAR 明细在 asar-audit.json；早期自建 JS 树计算的不同排序值不用于候选匹配结论。

## 六维判断

| 维度 | 复验结论 |
|---|---|
| 需求完整性 | 在用户已接受的有限支持范围内满足：九来源、Cursor 默认 SDK SQLite/NDJSON/合格逐请求 CSV、Agent/source/model scope 和九 Agent 实际模型计费默认均接入。额度仍仅 Codex。接受的真实样本缺口不再当作范围阻断。 |
| 逻辑正确性 | 暂不通过。R1–R5 原复现通过；R6–R8 是新确认的合并/迁移遗漏。 |
| 边界情况 | 压缩截断、checksum、CSV 等价表示、重启/历史保留、坏行、模式冲突、目录保护已有覆盖；同扫描桶冲突、等总量质量升级和 MiMo 先保存的旧重复账本仍有缺陷。 |
| 代码质量 | 唯一入口、共享目录/来源白名单、只读数据库投影及独立网络边界保持。scan 与 Store 的快照选择规则仍不一致，旧 HMAC 迁移的 owner 决定有固定 Agent 顺序偏置。 |
| 测试覆盖 | ESLint + 100/100、native、stress、crypto 和三类候选 UI 独立通过。新增六组回归有效，但没有捕获 R6–R8 的扫描前置合并与旧账本反向归属场景。 |
| 实际运行结果 | Windows 候选与自己制作的中文空格解压版均在 100%/150% 跑通九来源；usage/quota/functional 候选 UI 通过。纯鼠标 hover 独立采样通过，本轮没有复现早期偶发 UI 失败；不能据此宣称长期稳定性/真实样本验收全部通过。 |

## 修复清单

共同命令（只创建临时合成 home/store）：

`& E:/ai/node.exe artifacts/review-agent-integration-r2/additional-ledger.cjs`

完整数据：additional-ledger.json。以下由主线程修复，审查者未改代码。

### R6 — P2，同扫描等总量的 measured 桶冲突被静默消解

位置：src/m1/sources.js:165–166；持久层对应冲突规则在 src/m1/store.js:99。

步骤：空账本下，同一 Claude message ID 在 projects/a.jsonl 和 transcripts/b.jsonl 各出现一份 measured 快照，时间/模型/总量相同；两份分别 input=100/output=20 和 input=90/output=30，缓存均为 0，总量均 120。两份均为允许读取的真实适配器格式。

预期：发现等总量但分类不同的歧义，并报告 SOURCE_USAGE_CONFLICT/partial，不能靠文件遍历次序伪装一份确定用量。实际：scan errors=[]、partial=false，只保留后遍历的 90/30；Store 无旧记录可作冲突比较，直接保存 measured。设置人工价格 input=1/output=2 USD/M 后精确估算为 0.00015，另一份为 0.00014；无法从这两个副本证明哪份正确，但冲突没有暴露。

影响：新安装、首次重扫、多个日志副本同时发现时，分类、费用及质量取决于遍历次序。已新增的持久层冲突检查没有机会看见被 scan 丢掉的另一份。

建议验收：在适配器/scan 的 ID 合并阶段采用与持久层一致的整份快照规则，保留显式冲突诊断，不逐桶取最大值。覆盖两种文件顺序、首次入账和重启；Claude/Gemini/Cursor 等价重复快照应覆盖同类规则。

### R7 — P2，跨来源等总量的完整副本不能改善 partial 快照

位置：src/m1/sources.js:150–155，尤其 :151 的严格大于判断。

步骤：相同 OpenCode/MiMo 调用 ID、时间、模型。先扫描的 OpenCode JSON 报 input=60/output=20/cacheRead=40/cacheWrite=0，未报 reasoning；后扫描的 MiMo SQLite 报完全相同桶并明确 reasoning=0。二者 total 都为 120，前者 partial，后者 measured。

预期：仍只计一次、保留 OpenCode 首次归属，采用完整 measured 副本的桶。实际：只有总量严格增长才更新 owner，MiMo 完整副本被 skipped；Store 只收到 partial 快照，reasoning=null。手动价格足够时，本可确定的 0.00014 USD 费用被显示为未知（savedCost=null）。

影响：新增/复制来源提供了更完整计量时，统计仍持续不完整；仅在一次 ingest 中测 quality 升级的回归无法发现扫描前已经丢弃信息。

建议验收：等总量下允许兼容的质量改善，同时对等总量 measured 桶冲突保持诊断，并保留首次来源身份。覆盖两种来源顺序、重启、源缺失/再出现，禁止未报告值自动补零。

### R8 — P2，旧账本迁移按固定 OpenCode 优先顺序改变首次归属

位置：src/m1/store.js:83–84；固定顺序生成在 src/m1/normalize.js:48。

步骤：构造上一版真实数据结构的合成账本：MiMo 120-token 调用先保存，之后同调用 OpenCode 130-token 完整快照保存；sharedKey 用保留的首轮源码 ZIP 中原公式生成，两个 usage 快照不同，因此旧 sharedKey 不同；旧记录没有 sharedRecordIds。当前只扫描 OpenCode 源，升级迁移。给 MiMo multiplier=2，OpenCode multiplier=1，价格 input=1/output=2/cacheRead=1 USD/M。

预期：合并为一条 130，保持先保存的 MiMo 归属，成本为 0.00032。实际：sharedRecordIds 的 [opencode,mimo] 查找先命中已有 OpenCode 记录，MiMo 被抑制；归属改为 OpenCode，成本变为 0.00016。重启后仍如此。原记录及备份保留，问题是活跃记录归属/计费，不是删除数据。

影响：从首轮受 R1 影响的旧账本升级时，Agent 范围、趋势、默认模型或倍率可改变。现有旧迁移测试只覆盖 OpenCode 先保存，fresh-ledger 两种顺序测试不能代替旧账本的反向场景。

建议验收：旧别名合并先确定持久首次归属，再从完整快照选择计量；不能用 sharedRecordIds 的 Agent 顺序决定 owner。覆盖 MiMo/OpenCode 两种旧保存顺序、不同旧 sharedKey、较大副本、不同计费倍率、源缺失和重启，并保留恢复备份。

## 本轮检查与证据

| 检查 | 独立结果 / 证据 |
|---|---|
| R1–R5 原复现 | repro-ledger.json / repro-edges.json：122→122、Claude 120→120、字段顺序签名一致、CSV 130→130、压缩有效前缀 120 且 partial=true/lastSuccess=null。原首轮 JSON 没有重写。 |
| verify | verify.log：ESLint 和 100/100。 |
| native | native.log：五来源独立 694 token；九来源 native 随 UI 11 records/1204 token。 |
| stress | stress.log：160000 SQLite ×3、8000 WorkBuddy、200 并发刷新、20000 额度排队、碎片 RPC、20000 图表行等六场景通过。 |
| crypto | crypto.log：synthetic 独立进程错误钥匙/篡改/重放/重复拒绝通过，不等同生产同步验收。 |
| runtime / package | runtime-audit.log：43 模块。asar-audit.json：102 项匹配。delivery-audit.json/final-delivery.json：211 源项、84 Windows 文件和自己解压树完整性。 |
| candidate nine-source | windows/results.json：100%/150%，全部 Agent scope、图标、实际模型默认、取消/目录保护、SDK SQLite 选择、刷新/重启、1204 token，无 renderer errors。 |
| extracted nine-source | extracted/results.json：自己的中文空格路径解压版，100%/150% 同项通过。 |
| usage / quota | usage-ui.log / quota-ui.log：100%/150% 刷新、暂停、导出、重启；合成登录、错误、cooldown、cancel、cache，无真实 credential process。 |
| functional | functional/results.json：100%/150%，映射、默认模型、人工价格、离线价格失败保留缓存、搜索/wheel picker、主题/800×600/减少动态、曲线复用及坐标移动通过；各 175 RAF 样本，无 renderer errors。 |
| mouse-only hover | hover/results.json：100%/150%，每种缩放 20%/50%/80% 三个鼠标位置，1.4 秒各 331–336 帧始终 hover/expanded，focused=false，上限到最终值；另外独立键盘焦点通过。 |
| format verification | sdk-inspection.json：静态核对已冻结的官方 @cursor/sdk 1.0.35，默认 sdk-agent-store/index.db、runs 字段与 TokenUsage 对应，没有执行 SDK。压缩边界与官方 Zstandard format 对照。 |
| baseline closeout | final-fingerprint.json / final-delivery.json：162 源项及源码 ZIP/候选/解压树保持一致。 |

N1：本轮没有复现首轮未知归因的 hover 失败。新功能测试先证明 hover 再用 focus 保持动画；本轮补充了独立无 focus 的鼠标证据。此前失败仍是历史证据，单轮通过不证明长期零偶发。

N2：auditBasis 已明确声明计数器和源/WAL 前后哈希不是独立 OS 文件访问监测，本轮接受该口径修正；不把 sourceWrites=0/authenticationReads=0 当作独立访问审计。

## 接受的范围与实际样本限制

Cursor 支持官方 SDK 默认 SQLite、NDJSON 和符合合同的逐请求 CSV；普通 IDE/CLI 无 usage transcript 不在可靠计费支持内。Gemini/Cursor 没有真实调用样本；ZCode 正 reasoning 只有合成验证；Harness v0/v1 不支持、v2/v3 只有兼容结构合成，真实可比仅 v4。用户已接受这些限制，故不重复首轮范围阻断，也不标为未执行的真实验收通过。

只审读主线程冻结 aggregate report：2026-10-05T14:59:25.700Z，ZCode 1 份 23096475，Harness 29/35 份稳定可比 v4 共 111030630；6 份跳过（4 无可比 usage、2 parser partial）。本轮没有重新读取真实来源，因此这些是提供的历史证据，不是本轮独立实采。没有增加云/手机、其他 Agent 额度、凭据访问、真实调用、长时间休眠或物理显示器组合验收。

本轮结束于独立复验结果。没有执行修复、后续 backlog、新审查调度或清理先前被自动审核阻止的审查副本。审查 ZIP/解压副本继续留在 ignored artifacts。

官方依据：
- Cursor Local agent stores：https://cursor.com/docs/sdk/typescript#local-agent-stores
- Zstandard frame format：https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md

