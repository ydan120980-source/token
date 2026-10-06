# Agent Usage 接入第三轮独立复验 — 2026-10-06

结论：**暂不通过，返回主线程修复 R9（P2，跨来源冲突恢复路径）**。原 R1–R8 的具体复现通过，基础测试与候选/独立解压版适用 UI 检查通过。扩展检查确认：同次扫描中先发现等总量冲突、再读到更大的完整跨 Agent 副本时，计量更新了，但旧冲突属性仍保留，分类与费用无法恢复。该问题已由固定 Windows 候选的实际采集/IPC/页面复现；不是仅推测。

## 执行与固定基线

角色：Agent Usage 接入独立审查，独立只读审查者；模型 gpt-6.1-sol / 推理 xhigh，主线程派发时显式指定、不继承；45 分钟软预算。直接读取主线程的人类“批准”及对应第三轮配置请求，确认本次执行、六维审查和最终回传授权。开始 2026-10-06 01:15:13 UTC，结束完整性复核 01:26:54 UTC（北京时间 09:15–09:26）。

没有创建/恢复/派发任何代理，没有修改产品、项目测试/脚本/文档、偏好、dist 或真实数据。仅写 artifacts/review-agent-integration-r3 的 ignored 审查产物，执行合成隔离检查。所有 Electron 检查串行，显式指定独立 usage/quota 和 synthetic fixture home。没有真实账号、认证/配置读取、付费推理或统计上传；没有清理此前被自动审批阻止的审查 ZIP/解压副本。

- 源码首尾：164 文件，SHA256 10d8e7b056ee783cdae575d0eabf6387de855ebb1c85f28d5663851f91da6ebe。
- 固定候选：dist/agents-20261006-r3/win-unpacked。
- 源 ZIP：215 文件，CRC 通过，全部与当前工作区逐字节一致，SHA256 29445b82788dc9ed8db1a278202399c8494ee3db00adcd8c14e2f596d88ede3b。
- Windows 84 文件树：SHA256 f24f50d7fc6e7149c2ff7e4439d8c00152a96cfd569baac59411c7c44a334efc。使用与 package-quota.py describe_dir 相同的 Windows pathlib 排序/路径/大小/内容算法，首尾一致。
- 自己制作 ZIP，在“中文 空格 解压”目录解压，CRC/84 文件树一致并实际运行九来源与冲突 UI。
- ASAR 103 项与当前源/资源/文档逐字节匹配；runtime audit 44 个模块，唯一入口 src/quota/main.js，退休路径未恢复。
- 无可调用 CodeGraph，使用定向源码、固定候选、独立合成重放及测试。原生 Electron 的 IPC/主进程场景继续使用已应用 frontend-testing-debugging 的 Playwright/Electron 路径；没有可用于该 Electron 目标的 Browser 插件 surface。

## 六维结论

| 维度 | 本轮结果 |
|---|---|
| 需求完整性 | 在已接受的有限支持范围内满足：九来源、Cursor 默认 SDK SQLite/NDJSON/合法逐请求 CSV、统一 scope/来源状态/计费设置；账号额度仍仅 Codex。没有把接受的真实样本限制当作新阻断。 |
| 逻辑正确性 | 暂不通过。R1–R8 原具体复现通过；R9 的更大完整跨来源快照不能正确清除旧冲突元数据。 |
| 边界情况 | 等总量冲突、等总量完整度改善、旧归属/倍率、CSV 等价表示、压缩截断、历史保留、重启、模式冲突、坏行和目录保护通过现有检查；复合的“冲突→更大完整跨来源副本”仍失败。 |
| 代码质量 | 共用整份 usage-snapshot 规则与保存顺序归属有改善；跨来源保留对象引用的 Object.assign 与整份替换语义不一致，遗漏条件属性删除。 |
| 测试覆盖 | ESLint + 104/104、native、stress、crypto 和多项 UI 独立通过。新增回归覆盖原 R6–R8，但未覆盖 R9 的同次扫描复合场景。 |
| 实际运行结果 | 候选和自己中文空格解压版的九来源/冲突 UI 在 100%/150%通过；候选 usage/quota/functional 同样通过。另一个实际候选采集场景确认 R9，页面 140 tokens 但仍未定价，无 page error。 |

## R9 — P2，更大完整跨来源快照沿用已失效的冲突标记

位置：src/m1/sources.js:152–153，直接原因在 :153 的 Object.assign；对应整份选择规则 src/m1/usage-snapshot.js:8–11。后续未知分类由 src/m1/store.js:175、:178 产生，定价在 src/m1/pricing.js:24 因 usageConflict 拒绝。

复现命令（E:/project/My_project/项目测试/codex/token）：

`& E:/ai/node.exe artifacts/review-agent-integration-r3/recovery-probe.cjs`

实际 Windows 候选采集与 UI 命令：

`& E:/ai/node.exe artifacts/review-agent-integration-r3/recovery-ui.cjs`

两个驱动只创建自己的合成临时 home/store，退出后清理这些临时合成目录，不读真实源。完整结果 recovery-probe.json、recovery-ui.json、recovery-ui.png。

### 样本与步骤

1. OpenCode 的 storage/message/a.json 与 b.json 含同调用 ID、时间、gpt-4.1 模型，两份都完整 measured；input/output 分别 100/20 与 90/30，reasoning/cacheRead/cacheWrite 明确为 0，总量都 120。
2. MiMo SQLite message 表含同调用的更新完整快照：input=100、output=40，其余明确 0，总量 140。
3. 单次 scan 先扫描 OpenCode 两份旧观察，形成 usage-conflict；随后读取 MiMo 更大完整副本。为排除价格因素，明确设置人工 input=1/output=2/cacheRead=0/cacheWrite=0 USD/M。
4. 对照将同一 140-token 更新放到 OpenCode 的 c.json；另在 Windows 候选中从空账本开启实际采集，并通过 usageBridge 与页面观察。

### 预期与实际

合同已明确：新的更大有效完整累计快照可取代旧快照。selectUsageSnapshot 本身也正确选择新的 140-token measured 记录，新的记录不带 usageConflict / measurementQuality 属性。

预期：仍只计 140、保持首次 OpenCode 身份；恢复 input=100/output=40 等明确分类，费用 0.00018，已解决的旧冲突标记不能继续控制当前定价。

跨来源实际：Object.assign 把新记录字段覆盖到旧 owner，却不删除新记录没有的旧属性。最终记录同时具有 quality=measured、usageConflict=true、measurementQuality=measured。snapshot 所有桶为 null、knownUsage={}、费用 null，重启后仍为 null。候选实际采集结果同样为 140，页面显示“未定价”，renderer 无错误。

同来源对照：records.set 替换对象，记录不再有 usageConflict；相同 140-token 计量恢复 knownUsage 和 0.00018 费用。这证明问题发生在跨来源应用已选快照的步骤，不能归因于价格缓存、模型映射或选择规则拒绝更大完整快照。

另一个观察：同来源对照本次 scan 仍留下 SOURCE_USAGE_CONFLICT（之前确实观察过冲突），但最终计量和定价已恢复。因此修复时应让当前冲突状态/来源解释与历史观察诊断的语义清楚一致；本报告不将其另列为一个阻断编号。

### 影响与修复验收建议

流式副本、旧导出/SQLite 副本同时出现时，较大的最终完整计量无法恢复费用与分类，即使总量已正确更新。旧条件元数据可能继续影响之后的快照质量比较。

主线程应完整应用被选中的快照，显式处理不再存在的条件元数据，同时保持首次来源身份及已输出 owner 对象的引用关系。不要通过关闭冲突保护或将未知补零解决。补充：
- 同次 scan 旧等总量冲突 → 更大完整跨 Agent 副本；明确断言质量、usageConflict、measurementQuality、五桶、费用、首次归属。
- 两种首次归属与来源生命周期，重扫/旧源缺失/重启。
- 同来源与跨来源对照一致；仍有当前有效矛盾时继续 unknown/unpriced。
- 最终 Windows 采集/UI 显示恢复，重新绑定修复后的指纹和候选。

## 原问题及本轮独立检查

| 检查 | 结果与自己的证据 |
|---|---|
| R1–R5 | repro-ledger.json / repro-edges.json：持久跨来源 122→122、Claude 120→120、字段顺序 sharedKey 一致、CSV 等价列/时区 130→130、压缩有效前缀120/partial=true/lastSuccess=null。没有覆盖原审查数据。 |
| R6 | additional-ledger.json：冲突诊断 SOURCE_USAGE_CONFLICT、来源 partial、费用 null；snapshot 不把歧义桶当已知分类。 |
| R7 | additional-ledger.json：跨来源完整副本被保留为 measured，明确 reasoning=0，费用0.00014。 |
| R8 | additional-ledger.json：旧 MiMo 首次归属保留、总量130、倍率2费用0.00032、重启保持。104测试中的两种保存顺序、旧抑制标记、缺失来源和备份也独立运行通过。 |
| verify | verify.log：ESLint，104/104，0 failed/skip。 |
| native | native.log：旧五来源694；九来源 UI 自带独立 native 11 records/1204 tokens。native 校验是总量聚合核对，不证明快照选择/分类/费用正确。 |
| stress | stress.log：六场景通过，160000 SQLite×3总量17920694且源库不变；8000 WorkBuddy；200并发refresh；20000额度队列；碎片RPC；20000图表行。 |
| synthetic crypto | crypto.log：错误钥匙/篡改/重放/重复独立进程实验通过，不等同生产同步。 |
| runtime / ASAR | audits/runtime-audit.json：44模块；audits/asar-results.json：103源/资源/文档匹配、唯一入口和退休路径检查。 |
| 候选九来源 | windows/agents/results.json：100%/150%，1204 tokens、9来源/10按钮、图标、全Agent scope、实际计费默认、取消/目录保护、SQLite选择/重启，无errors。 |
| 独立解压九来源 | extracted/agents/results.json：自己制作的中文空格路径解压版，100%/150%同项通过。 |
| 正常冲突 UI | windows/conflict/results.json 与 extracted/conflict-visible/results.json：100%/150%，120 total、分类未知/费用未定价、原因可见、synthetic源哈希不变。解压版补充滚入原因文本的截图，避免仅以DOM等待冒充视口截图。 |
| usage UI | usage-ui.log / usage：100%/150%，刷新、暂停、定价、导出、路径保护、重启通过。仅改自己驱动输出目录以保留历史证据。 |
| quota UI | quota-ui.log / quota：100%/150%，cache/unknown、合成登录刷新退出、错误/冷却/取消、重启通过，没有真实credential process。 |
| functional UI | windows/functional/results.json：100%/150%，人工定价/映射/默认模型持久化、离线价格缓存、picker wheel、主题/800×600/reduced motion、chart复用通过；175/172帧且坐标确实移动，无errors。 |
| R9 独立扩展与实际运行 | recovery-probe.json：跨来源保存140/measured却带usageConflict=true，费用null；同来源对照0.00018。recovery-ui.json/png：候选从空账本实际采集140而未定价。 |
| 首尾完整性 | current-fingerprint.json / final-fingerprint.json；delivery-audit.json / final-delivery.json：164指纹、215源ZIP、84候选及84独立解压树一致。 |

本轮没有重跑 r2 的纯鼠标多位置采样；r3 functional 的 hover/focus、动效和减少动态检查通过，历史偶发失败/长期稳定性限制仍保留。不能把 r2 的鼠标证据写成 r3 新采样。

recovery-ui.json 中 nativeValidation 字段实际记录的是应用声明的 audit 计数器，名称不是独立 native 验证结论；本报告不将其当作 native 或 OS 审计证明。sourceWrites/authenticationReads 的声明0也不是独立 OS 文件访问监测。

## 接受的有限支持与未执行验收

用户已接受：Cursor 官方 SDK 默认 SQLite、NDJSON、合格逐请求 CSV；缺 usage 的普通 IDE/CLI transcript 无法可靠计费。Gemini/Cursor 没有真实调用样本；ZCode 正 reasoning 仅合成；Harness v0/v1未支持、v2/v3合成兼容、真实可比仅v4。额度仍仅 Codex。

只引用已提供的2026-10-05T14:59:25.700Z历史汇总：ZCode23096475、Harness29/35稳定可比v4共111030630；6份明确跳过。本轮没有重读真实来源，不把历史报告当本轮独立实采，也没有新增真实账号、长时间休眠或物理显示器组合验收。

本轮到此结束，只回传报告与修复清单。没有执行修复、下一轮代理调度或后续Backlog。主线程修复后如需再次复验，应按工作区规则另行取得该次精确配置批准。

