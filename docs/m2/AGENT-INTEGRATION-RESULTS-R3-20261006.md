# Agent Usage 接入 — 第三版修复候选验收

日期：2026-10-06。范围以 `AGENT-INTEGRATION-CONTRACT-20261005.md` 和用户接受的有限支持为准。候选 `dist/agents-20261006-r3`。第二轮独立报告 `AGENT-INTEGRATION-REVIEW-R2-20261006.md` 结论暂不通过，要求主线程修复 R6–R8。本记录是主线程验收；新一次独立复验尚未派发，不能标审查通过。

## 当前范围

九类本地用量：Codex、Claude Code、OpenCode、WorkBuddy、MiMo Code、Gemini CLI、Cursor、ZCode、DeepSeek Harness。Cursor 官方 SDK 默认 SQLite、NDJSON 和合法逐请求 CSV 已接入。账号额度仍仅 Codex。唯一产品入口 `src/quota/main.js`；保留 Electron、Nowdex / Apple 交互、旧数据、连接、未提交改动及所有历史交付。没有云、手机版、其他 Agent 认证/额度、账号切换、统计上传或付费推理。

## 第二轮问题修复

| 编号 | 主线程修复 | 回归验收 |
|---|---|---|
| R6 同扫描等总量分类冲突 | 扫描、Gemini checkpoint 和持久化共用 `usage-snapshot` 整份规则；冲突明确诊断、标 usage-conflict；保留总量/原始证据，歧义分类不计入已知分类，暂停精确定价 | Claude/Gemini/Cursor 两种文件顺序、checkpoint 内副本、首次入账、单份重扫和重启；同总量冲突保持未知费用，不逐桶取最大值 |
| R7 等总量完整副本丢失 | 兼容的完整副本可改善缺失字段，保留首次来源身份；完整度改善和分类冲突分别判断 | OpenCode/MiMo 两种首次来源、来源缺失/再出现、重启；reasoning=0 来自明确观测，费用 0.00014；矛盾副本仍报警 |
| R8 旧归属和倍率偏移 | 在保留的原始记录中先按首次保存插入顺序确定 owner，再选择整份计量；不按 Agent 枚举顺序选择；含旧错误抑制标记的原件可恢复归属 | 两种旧保存顺序、不同旧 sharedKey、120→130 完整快照、不同倍率、源缺失、重启与备份；MiMo 首归属费用 0.00032、OpenCode 首归属 0.00016 |

新增四组有状态回归（同组含多 Agent/顺序/生命周期案例），总测试由 100 增至 104。旧 R1–R5 回归继续通过。新规则复用旧统计版本，保留副本与迁移备份；冲突质量也使旧计费代码拒绝精确估算，不以字段缺失补零。

独立第二轮的 additional-ledger.cjs 复制到 `artifacts/m2-agents-r3` 对修复源码重放，主线程断言冲突费为 null、完整副本费 0.00014、旧 MiMo 归属费 0.00032。没有覆盖原审查脚本/数据。

## 主线程检查

- verify：ESLint 与 104/104 测试通过。
- native：694 token 五来源投影通过；九来源专项独立 native 总量 1204，覆盖默认 SDK SQLite。
- stress：160000 SQLite×3 扫描总量 17920694 与 native 一致、源数据库不变；8000 WorkBuddy 明细；200 并发刷新；20000 额度请求队列；碎片 RPC；20000 行图表计算，六场景通过。
- synthetic crypto：错误钥匙、篡改、重放和重复的独立进程实验通过，不等同生产同步验收。
- runtime audit：44 模块，唯一入口、退休路径未恢复，UI 资源完整。
- 本轮 source usage/quota/nine-source/functional UI：100% / 150% 通过，无 renderer 错误；九来源独立 native 总量 1204；功能曲线采样分别 175 / 176 帧实际坐标移动，模型映射、默认计费持久化、离线价格缓存、滚轮选择器、减少动态效果和窄窗口无溢出通过。证据 `artifacts/m2-agents-r3/source` 及本轮 UI 日志。
- Windows 构建通过；ASAR 103 项源码/资源逐字节匹配，退休入口不存在。原生候选九来源、额度、functional UI 在 100% / 150% 通过，功能曲线 164 / 177 帧实际移动，无 renderer 错误。证据 `artifacts/m2-agents-r3/windows`、`asar-results.json`。
- Windows 候选专项冲突 UI 在 100% / 150% 通过：独立 native 总量 120，分类未知、费用未定价、来源管理可见冲突原因；合成源哈希不变，无 renderer 错误。专项驱动 `scripts/m1/agent-conflict-ui-test.js`，证据 `artifacts/m2-agents-r3/windows/conflict-ui`。
- 自建测试 ZIP CRC 通过，84 文件逐字节解压一致；中文空格路径解压版九来源、额度和专项冲突 UI 在 100% / 150% 通过，无 renderer 错误，无认证进程启动。证据 `artifacts/m2-agents-r3/extraction.json`、`extracted`；这不包含新的真实账号或长期运行验收。

## 独立第二轮已通过及限制

第二轮对固定 r2 独立重跑：100测试、native、stress、crypto、usage/quota/functional、原生及自己中文空格路径解压九来源 UI 在100%/150%通过；源码/候选/解压树首尾一致，ASAR102项一致。纯鼠标无 focus 在两种缩放、20%/50%/80%三个位置采样1.4秒（331–336帧）始终展开，功能曲线坐标实际移动；本轮未复现早期偶发失败。r3只修改统计选择、迁移及冲突提示，未改产品动效；这些是 r2 的独立证据，不能冒充 r3 新复验或长期稳定性验收。

接受的有限支持保持：Cursor 普通 IDE/CLI transcript 缺用量字段时无法可靠计费；Gemini/Cursor没有真实调用样本；ZCode正 reasoning仅合成；Harness v0/v1不支持，v2/v3只有兼容结构合成，真实可比核对仅v4。没有新增真实账号、物理显示器组合和长时间休眠验收。

真实汇总仅引用主线程 2026-10-05T14:59:25.700Z 历史样本：ZCode 23096475、Harness29/35稳定可比v4共111030630；6份跳过（4无可比用量、2parser partial）。本轮没有重读真实来源。读取/写入/认证/网络声明计数与前后源/WAL哈希不是独立 OS 访问监测。

## 交付状态

源码 ZIP 排除真实日志/数据库、认证、应用数据、node_modules、缓存、截图。r1/r2候选和独立审查报告保留，新r3不覆盖历史dist。新候选准备完成后绑定新的源码指纹和ZIP/Windows树哈希，请求下一次独立只读六维复验精确配置。发现问题仍由主线程修复。

## 2026-10-06 第三轮独立复验后状态

以上“尚未派发”等描述为r3冻结时记录。用户随后批准第三轮显式 gpt-6.1-sol / xhigh / 45分钟只读复验；原R1–R8具体复现及适用基础/候选/解压UI通过，但扩展实际采集发现R9/P2，整体暂不通过。报告原样归档 `AGENT-INTEGRATION-REVIEW-R3-20261006.md`。r3源码ZIP、Windows候选与当时指纹不修改，主线程在独立r4修复/验收；本工作区说明追加状态，不重写旧归档。
