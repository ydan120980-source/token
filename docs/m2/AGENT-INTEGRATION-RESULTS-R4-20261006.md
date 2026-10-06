# Agent Usage 接入 — 第四版修复候选验收

日期2026-10-06，独立候选 `dist/agents-20261006-r4`。第三轮独立审查暂不通过，主线程修复 R9。原报告 `AGENT-INTEGRATION-REVIEW-R3-20261006.md` 原样归档。当前记录是主线程验收，第四轮独立复验尚未派发，不标最终审查通过。

## 范围与修复

九类本地用量：Codex、Claude Code、OpenCode、WorkBuddy、MiMo Code、Gemini CLI、Cursor、ZCode、DeepSeek Harness；账号额度仍仅 Codex。唯一入口 `src/quota/main.js`，保留 Electron、Nowdex / Apple 交互、用户数据/连接/未提交改动及历史交付。没有手机版、云部署、其他 Agent 认证/额度、账号切换、统计上传或付费推理。范围依据接入合同和用户接受的有限支持。

R9/P2：同次扫描 OpenCode 两份120-token旧观察分类冲突，随后 MiMo 提供140-token完整更新，整份选择本来正确，但 Object.assign 遗留旧 usageConflict / measurementQuality 属性，分类与费用未恢复。修复为完整应用选中快照：删除新快照没有的旧属性，再更新保留对象，首次身份及对象引用关系保持不变。没有关闭冲突保护或将未知补零。

来源诊断仍描述本次扫描曾观察到的冲突，UI 提示为“本次扫描发现计量分类冲突；仍有冲突的记录暂停精确定价”。最终记录的当前质量决定分类/费用是否可用；已恢复快照可精确定价，源状态 partial 不表示所有最终记录都未定价。合同明确此区别。

新增一个有状态回归组，总测试105：两种首次归属、两种旧观察顺序、同来源与跨来源对照、保留五桶/身份、清除条件属性、来源缺失/重扫/重启；恢复后新出现的140-token矛盾仍未定价，后续160-token完整更新再次恢复。普通人工费率 input=1/output=2 USD/M 时140-token费用0.00018、160-token0.00022。

新增维护驱动 `scripts/m1/agent-recovery-ui-test.js`，从自己的合成 home/store 启动实际采集，用放大的合成人工费率 input=10000/output=20000 USD/M使 UI 值可读，140-token费用1.80（不代表真实模型价格）。两种首次归属与100%/150%源码 UI已通过；独立 native140、分类明确、页面费用/ARIA恢复、源哈希不变，无renderer错误。

## 主线程验收

- verify：ESLint、105/105通过；旧R1–R8回归继续通过。
- 原审查 recovery-probe.cjs 复制到自己的r4证据目录重放，两种路径均140/measured、无旧冲突标记、五桶明确、费用0.00018，重启保持。没有覆盖原审查产物。
- native、六场景stress、synthetic crypto、runtime audit通过。
- source usage/quota/nine-source/functional UI 在100%/150%通过；九来源native1204，曲线175/176帧实际移动，无renderer错误。
- Windows构建及ASAR103项源码/资源逐字节核对通过，runtime44模块唯一入口/退休路径检查通过。九来源、额度、functional在100%/150%通过，曲线174/177帧实际移动。证据 `windows` 及日志。
- Windows实际恢复UI，两种首次归属×两种缩放通过；140/native一致、明确分类、费用1.80、首次归属、源哈希不变，无renderer错误。持续冲突UI两种缩放通过：120/native一致、分类未知、未定价，提示实际位于截图视口中。证据 `windows/recovery-ui` 与 `windows/conflict-ui`。
- 自建测试ZIP CRC及84文件逐字节解压一致；中文空格路径解压版九来源、额度、持续冲突UI在100%/150%通过，恢复UI两种首次归属×两种缩放通过；源哈希不变，无renderer错误，未启动真实认证进程。证据 `extraction.json` 与 `extracted`。

本轮证据 `artifacts/m2-agents-r4`。所有运行使用独立 usage/quota 与合成 fixture home，未重读真实来源。audit计数及前后源哈希不等同独立OS访问监测。

## 已接受限制

Cursor 官方 SDK默认SQLite/NDJSON/合法逐请求CSV已支持；缺用量的普通IDE/CLI transcript无法可靠计费。Gemini/Cursor没有真实调用样本；ZCode正reasoning仅合成；Harness v0/v1不支持，v2/v3只有兼容结构合成，真实可比仅v4。没有新增真实账号、长期休眠或物理显示器组合验收。

历史真实汇总仅引用主线程2026-10-05T14:59:25.700Z报告：ZCode23096475；Harness29/35稳定可比v4共111030630，6份明确跳过（4无可比用量、2parser partial）。本轮未重读，不把历史报告标为新独立实采。

## 交付和复验

r1/r2/r3交付保持冻结，r4独立目录交付。源码ZIP排除真实输入/日志/数据库、认证、应用数据、依赖运行时、缓存与截图。完成候选验收后绑定源码指纹、源码ZIP和Windows树哈希，另行请求第四轮独立只读六维复验精确配置批准。第三轮的批准不授权下一次派发。
