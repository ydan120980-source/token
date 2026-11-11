# 后端修复新增合同通知（2026-10-20）

本轮范围由所有者批准：保存预算总览、安全诊断及规则文档。保留 A–F 渲染层，不恢复 quota completion Backlog。不合入 main、不执行真实来源或账号查询、不打包。CodeGraph 当前不可调用，使用定向源码与合成测试。

## 预算

`usageBridge.workbench()` 保持 `WorkbenchV1` 原有 selection、range、budget、issues、omittedIssues、total、evidence 的含义，新增 `budgetOverview: {budgets, issues, omittedIssues}`。

- `budgets[]`: `{scope, period, projectName, projectLabel, range, limitUsd, state, remainingUsd, remainingUpperUsd, total}`。scope 是原不透明项目标识或 all/unknown；period 为 daily/weekly/monthly/total；range 为 `{from,to}`，采用返回值 timezone/today 的日历边界。项目找不到时两个名称均为 null，state 为 `scope-missing`。total 沿用选中视图的规范估算摘要，空数据 lower/upper 为 null。
- state 沿用既有预算状态并增加 `scope-missing`；无数据仍为 `no-data`，未知估价不能当作正常或零成本。
- `issues[]` 沿用 `{id,code,agent,target,evidence,fingerprint,acknowledged}`，最多 500 个，独立 `omittedIssues` 计数。只包括预算事项，target=workbench。按保存键排序。新增 `BUDGET_NO_DATA`、`BUDGET_SCOPE_MISSING`；其余预算代码沿用原值。
- 所有预算 evidence 均保持 `{scope,period,limitUsd,lower,upper,unpricedTokens}`；ID 与指纹沿用旧算法。确认请求继续使用现有 workbenchSave，必须提交事项自身 `evidence.scope` 为 project、`evidence.period` 为 period，而非当前页面 selection。省略或错用范围不能确认其他预算。范围已丢失的预算仍可确认、取消确认或删除。
- 对已丢失项目成功确认/删除后，workbenchSave 返回相同 period 的 all 视图（selection.project=all），其中仍有预算总览；直接 workbench 请求不存在项目继续报 WORKBENCH_SCOPE_INVALID。不能把已保存成功当作失败，也不能伪造丢失项目的选中视图。
- 只用内存 records、sessions、当前计价依据与 workbenchSettings；一次投影每条相关记录估价一次，按至多四种周期聚合。无采集、真实来源读取或账本改写。

## 安全诊断

`Service.get()`（由既有 usage:get/refresh 等 IPC 透传）新增 `diagnostic: null | {stage,category,reason}`，仅内存保存。旧 error 字符串和已声明的大写错误合同保留，实际白名单在 `src/m1/collection-diagnostic.js`；任意未声明大写异常文本也按未知处理，不能凭字符形状进入公开 error。worker 失败消息也附带该字段，service 再次验证后保留。没有新日志或统计文件字段。

- stage: `source-watch | source-stamp | source-refresh | source-scan | native-verification | custom-source | discovery | worker | collection | ingest | maintenance`。
- category: `os | native | contract | unknown`。
- reason: 白名单 OS 码 `EACCES | EPERM | ENOENT | ENOSPC | EMFILE | ENFILE | EIO | EBUSY | EROFS | ENOTDIR | EISDIR | EINVAL | ETIMEDOUT`；native 码 `NATIVE_UNAVAILABLE | NATIVE_BINARY_MISMATCH | NATIVE_TIMEOUT | NATIVE_OUTPUT_LIMIT | NATIVE_FAILED | NATIVE_SCHEMA_MISMATCH | NATIVE_TOTAL_MISMATCH`；contract 仅受控 `CONTROLLED_ERROR | COLLECTION_TIMEOUT | COLLECTION_WORKER_FAILED`；无法识别为 `UNKNOWN`。
- 不解析或回显任意异常文本；不返回 message/stack/path/command/cause/原始响应。只允许从直接 code 或一层 cause.code 提取白名单 OS 码。兼容顶层 error 沿用既有已声明纯大写合同；非合同异常继续回退 COLLECTION_FAILED。失败保留已有账本；成功采集后清除诊断。未定价数据仍是数据事实，不能转换为采集失败。

## needs-ui-run

后续更新：所有者将预算接线改交本会话后，以下预算接线与源码 UI 验收已完成，见 [UI-BUDGET-OVERVIEW-20261020](UI-BUDGET-OVERVIEW-20261020.md)。下文为最初后端交接记录；安全诊断的新增 UI 展示没有在本次预算范围内启动。

Claude 待接线：来源“需要处理”的全局预算改读 `budgetOverview.issues`，去重选中预算事项，并使用各事项自身 scope/period 确认；预算列表改读 budgets 并显示项目区分标签、各自周期及 no-data/scope-missing 状态；原页内提示仍读原 issues。诊断按固定枚举呈现，不能拼接原始异常。

接线后至少运行 workbench、usage、interaction-reliability 的来源列表、页内提示与确认流程；按实际渲染差异补 unpriced-guidance、custom-sources、sessions。所有 UI 使用独立 usage/quota 与合成 fixture home。本轮后端通过不代表前端列表已经修复或 UI 已验收。
