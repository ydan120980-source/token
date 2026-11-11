# 后端交接修复验收（2026-10-20）

已完成所有者本次批准的后端与文档范围，前端接线及 UI 验收待 Claude 完成（`needs-ui-run`）。没有合入共享 main。基础提交为 `c8742e0a5a7caf962c215c632b08341b64de8596`，工作树为 E 盘 `token-worktrees/backend-handoff-20261020`，主题分支 `codex/backend-handoff-20261020`；A–F 六个合并提交已逐个确认是 HEAD 的祖先。未合并旧费用预览分支。

后续状态：所有者随后明确将预算 UI 接线改交本会话；预算接线与对应源码 UI 套件现已完成，见 [UI-BUDGET-OVERVIEW-20261020](UI-BUDGET-OVERVIEW-20261020.md)。本文其余 needs-ui-run／未执行描述保留为后端提交时的历史验收边界，不代表后续预算验收仍未完成。

## 实现结果

- **保存预算总览**：`WorkbenchV1.budgetOverview` 公开所有保存预算各自的项目、周期、日历范围、限制及规范估算。原 selection/budget/issues/omittedIssues/total 与 evidence 保持含义不变。全局预算事项独立限 500 个，独立 omittedIssues；不把其他范围的事项混进原 issues。
- **确认绑定自身范围**：总览和选中视图使用同一预算事项 ID、指纹算法，确认按事项自己的 scope/period 核对当前 evidence。无数据和丢失项目分别公开 no-data/scope-missing，不当作正常或零成本；缺失项目仍可确认、取消确认和删除。成功变更后若原项目已丢失，返回同周期 all 视图。
- **复杂度**：一次预算投影每条相关记录只估价一次，按至多四种周期累计 all 与不透明项目 scope。没有逐预算调用工作台。既有 snapshot 的估价投影独立，规模测试先生成 snapshot 再计数预算投影。价格、账本序号、时区/今日或预算配置变化均随现有缓存边界失效；没有跨再计价复用旧结果。
- **安全错误诊断**：worker 在固定阶段发出 `{stage,category,reason}`，service 再次白名单验证后仅在内存 getter 返回。保留已声明的大写 error 合同码；其他异常回退原错误字符串。OS 原因仅取白名单 code/一层 cause.code；任意未声明大写文本也归未知。没有原始 message、stack、路径、命令、凭据、cause 对象、响应或新增落盘诊断日志。正常采集后清除诊断；未定价/不完整用量保持数据语义。
- **规则一致性**：AGENTS.md 按已批准的多服务额度适配器实施范围统一，区分适配器、合成和历史真实验收；历史真实额度只有 2026-10-19 的一次 Codex 读取，本轮没有新查询。Antigravity 产品查询仍未启用。
- **Claude 安装治理**：只记录本机端口/进程/策略画像与独立泛化方向；安装器运行文件未改，未读取真实治理配置。

准确字段、枚举、确认请求及前端接线合同见 [BACKEND-HANDOFF-CONTRACT](BACKEND-HANDOFF-CONTRACT-20261020.md)；安装器文档见 [CLAUDE-GOVERNANCE-PROFILE](CLAUDE-GOVERNANCE-PROFILE-20261020.md)。既有 main/preload 会透传新增字段，无需新增 IPC 或放宽 sender 校验。

## 本轮实际检查

证据都在当前工作树的忽略目录 `.planning/backend-handoff-20261020/`，不是旧会话的通过记录。

| 检查 | 本轮结果 | 证据 |
| --- | --- | --- |
| `npm.cmd run verify` | ESLint clean、fail 0；新增安全出口收紧、边界覆盖后最终复跑通过 | `verify-first.log`、`verify-final.log` |
| `npm.cmd run test:native` | 新临时合成夹具，固定 tokscale 校验通过；来源只读、Node 网络尝试为零 | `native.log` |
| `npm.cmd run audit:runtime` | 产品入口、可达模块、无退役实现/开发脚本依赖与本地 UI 资源检查通过 | `runtime.log`；`artifacts/maintenance/runtime-audit.json` |
| `npm.cmd run test:workbench:stress` | 既有 20,000 条合成记录、项目合计、重复投影和再计价通过，账本字节不变 | `workbench-stress.log` |
| 独立保存预算规模检查 | 20,000 条记录、1000 个保存预算、四种周期，预算投影恰好估价 20,000 次，预算事项 500 + omitted 500，选中视图未受污染，重复查询复用缓存，账本字节不变、网络尝试零 | `budget-scale.js`、`budget-scale.json`、`budget-scale.log` |
| `git diff --check`、A–F 祖先检查 | 通过 | 本轮终端输出 |

新增单元测试在 `tests/m1/budget-overview.test.js`、`tests/m1/collection-diagnostic.test.js`。覆盖未选范围超支、不同项目/同名项目、多周期/跨年周界与时区切换、未知价格/明确免费/区间估价/混合未定价、无数据/缺失项目、指纹失效、错误范围确认拒绝、独立截断和被截断预算可确认；实际 worker 贯通 OS/native/未知/未声明大写错误，敏感字段剥离、原生合同差异、内存生命周期、失败保留、恢复清除、写入失败/崩溃/超时。

**首轮失败记录**：新增预算定向测试首次发现丢失项目的确认已保存但返回视图报 WORKBENCH_SCOPE_INVALID；修复 Store 的成功返回后复跑通过。完整 verify 首轮通过，最终字节变更后的复跑也通过。没有把定向失败写成首轮全绿。

## needs-ui-run：Claude 接线与受影响套件

1. `insights-ui.js` 的全局预算列表接 `view.budgetOverview.budgets`，“需要处理”的预算事项接 `budgetOverview.issues`；显示独立 omittedIssues，去掉从旧 selected issues 再加一份的重复预算。
2. 确认动作把事项自己的 `evidence.scope/period` 作为 `project/period` 提交。恢复待办亦同。删除/确认缺失项目后接受返回的 all selection，并按页面实际选择重新读取；不能把已成功持久化操作显示成失败。
3. no-data、scope-missing、unpriced、incomplete、possibly-exceeded 不得写“正常”；项目显示用 projectLabel 区分同名，不显示路径。各行范围独立，不能沿用当前页面日期。
4. 选中页的 budget、页内提示和既有非预算 issues 继续按原 selection 使用。diagnostic 用枚举映射固定说明；没有原因时承认未知，不拼接原始错误。
5. 必跑源码套件：`node scripts/m1/workbench-ui-test.js`、`node scripts/m1/usage-ui-test.js`、`node scripts/m1/interaction-reliability-ui-test.js`。按实际接线差异补 `unpriced-guidance-ui-test.js`、`custom-sources-ui-test.js`、`sessions-ui-test.js`。现有三个必跑脚本已核对：内部创建独立 home/usage/quota 并传 fixture 参数，不能改成真实用户数据。
6. 新增界面验收案例：当前 monthly/all 正常，daily/all 与 daily/项目 B 超支，两条全局事项都可见并能独立知悉/恢复；切周期和页面不影响确认对象；缺失项目/无数据/未知价格不变零；再计价后确认失效；诊断失败及恢复时 snapshot 不被清空。至少遵循既有 100%/150% 覆盖，并核对来源列表、费用/预算页提示、窄窗状态。

本轮没有修改 `design/desktop-reference/`、tokens 或 UI 套件，没有运行 UI、浏览器/Electron 手动验收、打包、发布、真实采集、认证文件/浏览器凭据读取、真实额度/模型请求、代理/防火墙读写。没有启动子 Agent、发送跨会话通知、fetch/pull/push、PR 或合入共享 main。CodeGraph 不可调用，源码核对与测试替代，不声称独立安全扫描。

后续 UI 接线、发布候选验收和安装器泛化分别属于后续授权范围；没有自动恢复 Backlog。
