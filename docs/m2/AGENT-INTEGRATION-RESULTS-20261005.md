# 其他 Agent 本地用量 — 修复候选验收记录

日期：2026-10-05。范围及数据合同见 `AGENT-INTEGRATION-PLAN-20261005.md`、`AGENT-INTEGRATION-CONTRACT-20261005.md`。首轮独立审查报告保留在 `AGENT-INTEGRATION-REVIEW-20261005.md`，结论暂不通过。主线程修复候选为 `dist/agents-20261005-r2`，尚未完成独立复验，不能标记审查通过。首轮 `dist/agents-20261005` 及历史交付保留。

## 实现范围

统一九类本地来源：Codex、Claude Code、OpenCode、WorkBuddy、MiMo Code、Gemini CLI、Cursor、ZCode、DeepSeek Harness。新增 Gemini recording/checkpoint 用量、Cursor 官方 SDK 默认 SQLite / runs.ndjson / 合法逐请求 CSV、ZCode model_usage、Harness v2–v4 raw / Zstandard。共享来源状态、图标选择、九 Agent 实际模型计费默认与显式映射；统计中未知值继续保持未知。账号额度仅现有 Codex，没有新增其他 Agent 认证或在线额度。

## 首轮问题及主线程修复

| 编号 | 修复 | 可复验依据 |
|---|---|---|
| R1 持久跨来源重复 | 跨扫描/重启维护相同调用的规范身份；先记录来源保留归属；旧重复记录保留且通过索引抑制，迁移前创建可恢复备份 | 两种首次来源顺序、旧源缺失/再出现、增长、重启及成本；复现累计 122 → 122 |
| R2 用量回退 | 较小的已测快照保留旧值并诊断；相等总量但桶冲突也保留旧值，不拼造桶最大值 | Claude/Gemini/Cursor 大→小→大、质量变化、分类冲突及重启；120 → 120 |
| R3 字段顺序导致重复 | sharedKey 改为规范身份，不依赖原始对象序列化；关联旧 HMAC 标识 | 字段顺序变化签名相等、旧账本迁移/备份、同扫描和持久扫描 |
| R4 CSV 等价导出重复 | 无 Request ID 时按规范时间、模型和独立 token 桶生成身份，保留重复行次数；冗余 Total Tokens 不影响身份 | 时区等价/可选列变化及重复两行；旧 CSV 标识迁移、重启；130 → 130 |
| R5 压缩尾帧误成功 | 完整帧边界先校验，再原生解压；截断尾帧保留有效前缀并标 partial，不推进 lastSuccess；完整帧损坏拒绝整文件 | 四种尾帧截断、checksum 损坏、旧账本保留；有效前缀 120 / partial true |
| G1 SDK 默认 SQLite | 白名单增加官方 index.db；只投影 runs 的计费字段，NDJSON 副本去重，坏 usage_json 行隔离 | 默认目录自动发现、文件选择 IPC、CSV/SDK 冲突、敏感 result 哨兵不导出 |
| N2 审计证据口径 | 报告区分声明的计数器、源/WAL 哈希及实际观察，没有宣称独立 OS 文件访问监测 | real-aggregate-check.json 中 auditBasis |

新增 `tests/m1/agent-ledger.test.js` 六组有状态回归。旧记录和原数据不清空；迁移产生的备份留在应用自己的用量目录。

## 修复候选主线程验证

- verify：ESLint 与 100 项单元/合同测试通过。
- native：旧五来源独立 694 token 通过；九来源独立 Tokscale 投影为 1204 token，通过 SDK SQLite 文件选择后的扫描、重启也保持同一总量。
- stress：160000 SQLite 记录三次扫描、8000 WorkBuddy 明细、200 并发 refresh、20000 额度请求队列、碎片 RPC、20000 行图表压力通过。
- synthetic crypto：独立进程实验通过错误钥匙、篡改、重放、重复；不代表生产同步或持久防重放验收。
- runtime audit：43 个当前运行模块，唯一 `src/quota/main.js` 入口；未恢复退休应用。
- usage UI、quota UI、九来源专项 UI：独立合成 home / usage / quota，100% 与 150% 缩放通过；无真实登录、推理或凭据进程。
- functional UI：首轮审查发现偶发悬停失败；修复阶段仍发现一次 RAF 采样不足和一次下拉菜单关闭超时，失败保留。测试先验证真实 hover，再用受支持的键盘焦点保持金额动画；画布采样前核对前台可见；下拉选择先等待有限布局动画。最新源码完整运行在 100%/150% 通过，坐标采样 222/225 帧；Windows 候选同样通过，224/222 帧，坐标确实移动而不是仅 RAF 回调。未知归因的早期失败保留，未修改产品交互或降低断言；长期稳定性仍交独立复验核查。
- Windows 修复候选已构建；ASAR 102 项当前源/资源/文档逐字节匹配。临时 Windows ZIP CRC 通过；独立中文空格路径解压的 84 文件逐字节相等。原生打包九来源 / quota / functional UI 在 100%/150% 通过；中文空格路径解压版九来源 / quota UI 在 100%/150% 通过，未使用真实 home 或账号。

## 真实只读汇总及接受的限制

2026-10-05T14:59:25Z 的 `artifacts/m2-agents-r2/real-aggregate-check.json`：ZCode 一份稳定库 23096475 token 与独立 SQL 相等，正 reasoning 行为 0；Harness 35 份候选中 29 份稳定可比 v4 文件 111030630 token 逐份一致。6 份跳过：4 份无可比用量，2 份 parser partial，均不计入通过。真实来源运行中会变化，此值是该时点样本。

报告声明读取 148 次、源写入/认证读取/网络请求计数 0；依据是受限源码路径、计数器和前后源/WAL 哈希。没有部署独立操作系统访问监测，不能把这些计数器当作独立审计证据。

用户已明确接受有限支持与真实验收限制，继续修复和独立复验：Cursor 支持官方 SDK SQLite/NDJSON 与符合合同的逐请求 CSV，普通 IDE/CLI transcript 无用量字段时无法可靠计费；Gemini/Cursor 本轮无真实调用样本；Harness v0/v1 未支持，v2/v3 只有兼容结构合成验证，真实可比核验仅 v4；ZCode 正 reasoning 只有合成样本。真实账号、物理显示器组合和长时间休眠恢复没有新增验收。

没有云、手机、认证导入、账号切换、统计上传或付费推理。后续独立复验只读固定候选和隔离样本，不重新访问真实来源。复验执行仍须用户逐次批准精确配置。

## 证据与交付

新证据写在 `artifacts/m2-agents-r2`。R1–R5 原审查复现脚本在该目录对当前源码重放已得到预期结果；原报告保持原文。为恢复被主线程重放覆盖的原 JSON，主线程从首轮源码 ZIP 在隔离目录重现旧失败并恢复这些 JSON；这是主线程对原基线的重放，不冒充原始独立执行证据。首轮源码 ZIP 与 Windows 目录未变更。

交付 SHA/文件树以 r2 manifest 和 SHA256SUMS 为准。源 ZIP 排除认证、真实日志/数据库、应用数据、node_modules、缓存和截图。独立复验没有通过前，r2 是修复候选。

用户当前决定（2026-10-05）：暂不启动本轮独立复验。原审查线程保持空闲，未派发新任务。主线程修复与候选验收完成，但首轮审查结论不因主线程测试通过而自动变为通过。
