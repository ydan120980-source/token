# 第 8 节步骤 4：本地候选交付 · 2026-11-03

**LOCAL_CANDIDATE_ONLY / RAM_TARGET_NOT_MET。功能打包验收通过，当前环境内存与长帧未通过；不推送、不发布，不视为正式发布就绪。** 真实阅读格式尚未核对；源码界面有预算遗漏；视觉由所有者后续自己看。所有者已取消像素基线重拍和前后对照，本轮没有执行该项。

候选：`dist/20261103-multi-reader/win-unpacked/Agent Usage Quota.exe`。性能实现 `24bd298`，复制与界面收尾 `604862e`，像素取消记录 `e2208b9`；本记录所在提交包含本地交付工具、配置及最终记录。最终源码 ZIP 的 HEAD、全部交付 SHA-256 由同目录交付 manifest 标明，不以旧候选或编译工具的 HEAD 冒充产品身份。

ASAR：`de309aa5e056dfb29dadb221ccf336168f497b9fe513d055f2ee8f7e9375dae3`。Vite 重编译后 bundle 字节未变；包内全部 245 项源码/资源/文档与当前树一致，原生 tokscale 4.17.0 保持锁定 SHA-256。特别核对 `transcript-marks.js`、`transcript-lines.js`、`transcript-tasks.js`、`transcript-task-worker.js`、`session-list-codec.js`、`session-aggregate.js`、`clipboard-write.js` 和 `assets/ui/search.svg`，见 `asar-required-files.json`。

## 当前包内存：明确失败

相同名义默认窗口 1480×960，当前显示环境是 **240 Hz、系统缩放 150%、实际 viewport 1480×962 / DPR 1.5**。完整归属进程树的 Windows 连续 private working set：

| 场景 | 驻留采样峰值 MiB | 最后静置 MiB | 私有提交峰值 MiB | 500 MiB 驻留目标 |
|---|---:|---:|---:|---|
| 双栏长阅读 + 两次跟随 | 618.1 | 509.1 | 847.1 | 超标 |
| 三栏长阅读 + 两次跟随 | 671.3 | 503.0 | 898.5 | 超标 |
| 三个长会话对比 | 666.5 | 507.6 | 891.3 | 超标 |
| 两万项保存会话 + holdAll/快速切换 | 493.6 | 367.6 | 708.4 | 通过本轮采样 |
| 文件历史第一批扫描 | 690.3 | 523.0 | 910.0 | 超标 |

原始数据为 `artifacts/reader-performance-20261102/memory/packaged-final-*-complete/results.json`，汇总 `packaged-final-summary.json`。所有采样都区分私有驻留、普通 shared working set 与 private commit，不减 GPU、不强制 GC、不裁剪工作集、不缩窗、不降 DPI、不改栏数、不新增正文/解析缓存。峰值仍是有采样间隙的观察值，不是瞬时硬上限。

前一步源码五场景低于 500 的数据来自 **300 Hz / 125%** 环境，不能替代这次当前包结果，也不能把跨显示环境差异定性成打包导致的回归。增加一次当前环境源码三栏诊断，峰值约 **686.3 MiB**，同样超标；该 probe 另有 GPU 元数据查询，不是原五场景的同字节受控复跑。GPU API 报告硬件加速、GPU 合成和栅格化启用。普通 GPU working set 增幅明显，其他 JS 堆没有同幅增长，是后续图形资源归因的线索；没有证明 DPI 是唯一原因，也没有把 basic GPU 枚举里未填充的字段当成软件回退结论。

当前五场景有界 rAF 样本 P95 约 4.3–8.4 ms，但最长帧约 296–493 ms。采集各轮时长不同、至多 20k 间隔，不称全程稳定高刷。额外的包版 `high-refresh-ui-test` 在 240 Hz 屏幕的 **强制 100% 测试缩放** 窗口通过，180 个短样本中位约 4.2 ms（约 238 Hz）；这不是 150% 重负载的流畅度或内存通过。

依照第 8 节“超标报告数字，不自行限制栏数或加缓存”的边界保留失败。原有 CPU/分配改进和 125% 同环境前后结果仍有效，但当前 150% 下的 300–500 目标尚未完成，需要继续单独归因图形合成/资源寿命，不能因此发布或改验收标准。

## 功能和交付检查

- `npm run verify` 为 fail 0；`test:native`、`test:stress`、`experiment:crypto`、`audit:runtime` 通过。最后的相同 EXE/ASAR 硬链接规则调整另跑了候选工具/签名配置的针对性测试与 ESLint，通过；不把它说成重跑了无关全套。
- 本次 build 执行现有 `dist:win:dir` 的同一条依赖检查及 `electron-builder --win dir --x64 --publish never`，随后 `audit:package` 通过。再次 build 同代际只字节核对与审计，返回复用，没有再次打包或生成 ZIP。
- 当前包实际跑过 `session-reader`、`sessions-reader-extras`、`sessions`、`app-shell`、`overview`。阅读专项在 100%/150% 缩放又实际重复一轮通过；高刷独立新执行，不使用功能收据缓存。五个指定套件均有实际通过，外框重复请求及综合阅读脚本恢复时明确标为 `REUSED_PAST_PASS`。
- 综合阅读真实套件先通过，证据收集器随后因为 PowerShell 自动把 ISO 日期转成 DateTime、文件名带本地日期斜杠而失败。修复 GUID 文件名后复用原通过收据，没有假装重新执行；首轮日志和 `package-runner-initial-error.json` 保留。各套件原输出在 `artifacts/local-candidate/20261103-multi-reader`，收据快照在本轮 `package-receipts/`；重复专项的首轮收据没有被缓存的最新指针替代。
- 运行 ZIP 真实解压到 `artifacts/reader-performance-20261102/解压 验收 多栏/win-unpacked`，CRC、ZIP 每项内容、88 个解压文件逐字节一致。该中文/空格路径副本上的 `agent-recovery-ui-test`（实际采集、100%/150%、源文件散列未变）和 Noto 字体检查通过；当前包同样通过文件响应、loaded 字体面与 CDP 实际中文字形检查。
- 当前包 24 张六页完整/首屏截图、12 张阅读功能截图及静态画廊：`artifacts/reader-performance-20261102/review/index.html`。均未遮挡原图；标准截图使用 100% 测试缩放，与内存的原生 150% 分开。没有拍前后对照、没有机器像素批准、没有自动联系 Claude。人工查看了概览和三栏当前图，完整图片路径已核对；不是所有者视觉批准。
- 功能截图助手曾因临时 fixture 前缀不在时间冻结白名单、默认折叠组未展开、Codex fixture 没有文件编辑而失败。只修捕获步骤：使用受支持的私有临时前缀、真实展开、切换到有原生 edit 的 OpenCode 会话拍文件历史，再回到 Codex 三栏。未修改产品、守卫或解析结果来配合拍图。原错误日志保留，最后 12 张与 manifest 完成。

源码界面轮沿用前一步 `RESULTS-READER-UI-20261103.md` 的 42/58 有证据、16 项预算遗漏（约 18.15 分钟实际界面执行），没有恢复遗漏项，也没有在包版重复 58 项。内存、截图、解压与 headless 检查是独立验收，未混成整个交付“20 分钟”。

## 减少重复构建与空间

`LOCAL-CANDIDATE-WORKFLOW-20261103.md` 说明 `candidate:plan/build/check` 与收据规则。输出不可覆盖，产品/依赖/完整 runtime/UI 输入与证据有字节身份；同字节成功收据复用明确标历史通过。普通维护不生成日期交付目录、源码 ZIP 或运行 ZIP，正式交付最后各生成一次。

当前 runtime 逻辑约 415.82 MiB，新目录中 86 个相同文件与旧交付硬链接复用约 156.00 MiB；新 EXE 的 ASAR 完整性信息与产品包不同，保留独立内容，不绕过完整性以省空间。解压、采集和字体检查后，新的解压副本 88 项又与候选共享约 415.82 MiB，全部字节复核不变。两次共享涉及约 571.82 MiB 重复逻辑字节；这是文件字节计数，不冒称测得卷剩余空间恰好增加同样数值。旧目录的文件路径和内容不替换，未删任何历史 ZIP/代际。

本轮未使用的像素基线 worktree/依赖联接因自动审批拒绝清理而保留，详情见视觉取消记录；不要用别的删除方式绕过。共享 main 的未跟踪 `docs/agents/` 属于其他工作，不满足干净合入门禁，未移动、暂存或删除它，也未合入共享 main。

## 签名、源码与限制

`signing:plan` 实际输出 `NOT_CONFIGURED`；可审核的 `signed-update.config.cjs` 按安装的 electron-builder 26.16.1 schema 验证通过。要求签名、SHA-256、更新签名验证与发布者匹配，NSIS 差分配置只是准备。没有证书/签名服务、签名安装包、实际 updater 客户端、联网更新、自动下载或发布。没有读取凭据、证书库或付费服务。

运行 ZIP 为 `AgentUsage-CodexQuota-Windows-x64.zip`；最终提交后创建 `AgentUsage-CodexQuota-source.zip`，按当前文件字节和全部已跟踪 UI 条目核对。另有当前图与记录的 review ZIP、完整验收 evidence ZIP；机器收据、归档 CRC、文件 SHA 和最终 HEAD 以同目录 `Multi-Reader-delivery-checks.json`、`DELIVERY-SHA256SUMS.txt` 为准，散列路径相对仓库根目录。归档和生成的证据在忽略目录，不以再次改产品、再次打包收尾。

只用合成数据，无真实来源/认证文件/真实账号查询；阅读格式和“正在读取会话”真实负载没有核对。没有 GitHub push、PR、tag、Release 或资产上传。当前 RAM 与长帧是明确未解决项，不能称正式发布验收通过。
