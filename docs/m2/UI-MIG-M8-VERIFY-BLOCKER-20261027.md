# M8 verify 基线阻塞 · 2026-10-27

**历史失败记录：2026-10-28最终候选7167d3f的串行verify已通过；详见文末。保留旧失败，不把本次未复现写成后端修复。**

此记录保留现有门槛失败，不授权后端修改，也不豁免 `verify fail 0`。M8 继续完成已授权的页面验证和对照图，最终停止交 Claude；未达到全部门槛时不得称为可合并。

## 当前证据

- 候选的 `npm run verify` 在原 `tests/m1/windows-job.test.js:122` 的“pinned image stays locked against writes for the invocation and is released afterward”失败：`pending.reaped === true` 后，129 行向临时 `selected.exe` 写入仍报 `UNKNOWN: unknown error, open ...`。
- 捕获完成后，在干净本地 main `0ac94cf2f8599188d03e0405ce55a00824c57ae2` 单独运行 `node --test tests/m1/windows-job.test.js`，没有 UI 或像素比较并行，仍在同一断言失败，进程退出码 1。原日志为共享工作区 `.cache/m8-main-windows-job.log`；交付证据中保留其副本。
- `src/quota/windows-job.js`、`windows-job-host.ps1`、`windows-job-host.cs`、`executable-pin.js` 和 `tests/m1/windows-job.test.js` 与 main 完全相同。没有修改原断言，没有加入重试、跳过或改变 reaped 语义。
- 中间一次 verify 同时报告 `agent-ui.js` 过期；说明性小字收口后的最后 `npm run build:ui` 已重新生成产物。这项以最终 verify 的实际输出为准，不能把中间日志说成只有文件锁一项失败。

## 最后一次串行验证

收口代码与 bundle 重建后，在没有 UI / 像素比较并行的条件下重新运行 `npm run verify`，最终仍为退出码 1，唯一失败为上述文件锁释放断言；lint、UI 类型检查、bundle 精确重建比对及其余测试通过。原日志 `.cache/m8-final-verify.log`。随后 `npm run audit:runtime` 退出码 0，报告 `PASS: 152 reachable product modules; one entry, no retired paths/development imports, local UI assets present.`，日志 `.cache/m8-final-runtime.log`。没有为取得通过而继续重复该失败测试。

## 处理边界

走势两组补充批准并完成后，再次在无 UI 并行条件下执行最后 verify，依然只有相同文件锁断言失败；bundle、lint、类型及其它测试通过，runtime audit 通过。最终日志 `.cache/m8-trend-verify-final.log`、`.cache/m8-trend-runtime-final.log`，同时保留前述历史失败。

开工指令 §3 明确禁止从旧分支挑入 `609d948 Windows-job`，§8 和计划 §0.3 / §9.4 保留范围限制。本轮没有实施后端诊断修复，没有从旧分支挑提交。最终记录必须准确列明 verify 状态；修复或豁免门槛需由所有者另行决定，M7 仍须等 Claude 审核通过后才可开始。

## 2026-10-28 原版对标候选的实际复验

候选7167d3f在全部UI和像素捕获结束后单独运行 `npm.cmd run verify`，本次退出0，摘要 `fail 0 / cancelled 0 / skipped 0`。随后 `npm.cmd run audit:runtime` 退出0，152个可达产品模块审计通过。完整日志 `.cache/m8-closeout-verify.log`、`.cache/m8-closeout-runtime.log`，副本在 `artifacts/ui-mig/M8/reference-closeout/logs/`。

本次没有复现上面的Windows Job锁失败；历史失败日志与main证据保留。本分支相关后端和windows-job测试仍与main相同，没有删除断言、加重试、挑入旧提交或修改释放语义。因此本次结果是“最终verify实际通过”，不能推导为“后端锁问题已修复”。最新交付以 `UI-MIG-M8-20261028.md` 为准，M7仍未开始。
