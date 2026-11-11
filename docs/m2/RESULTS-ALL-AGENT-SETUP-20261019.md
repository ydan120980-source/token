# 全 Agent 安装恢复引导与 Windows 交付验收（2026-10-19）

实现提交 `76f95ca`，基于本地 main `32cc53169bbecfc5afd0fc34a5bd7d4b2ee699cc`。范围及官方依据见 [全 Agent 合同](ALL-AGENT-SETUP-20261019.md)。用户明确授权最小现有页面入口并要求正式打包，Claude 后续美化。无子 Agent 或外部审核服务，由本会话完成复核和验收。

## 实现及合成验收

覆盖十个内置 Agent 的官方安装/下载/排查引导、个人来源规则排查，来源/额度页面共用入口。固定动作由主进程持有，打开引导不扫描，用户显式扫描才有元数据检查；不启动发现的程序。程序入口、已有用量、账号额度独立，不推断登录/会员过期/剩余额度，不把未知补零。

| 检查 | 已执行结果 | 证据（artifacts/all-agent-recovery-20261019/） |
| --- | --- | --- |
| 单元与 ESLint | 实现及后续验收脚本修正后均执行 `npm.cmd run verify`，最终通过，fail 0 | verify-final.log、verify-delivery.log |
| 单一入口/本地资源 | `audit:runtime` 通过 | runtime-audit.log |
| 原生统计 | `test:native` 通过，固定 tokscale 散列核对 | native.log |
| 压力与密码实验 | `test:stress`、`experiment:crypto` 通过 | stress.log、crypto.log |
| 新引导源码 UI | 修正测试夹具后，100%/125%/150% 复跑通过 | setup-ui-rerun.log、setup-ui/results.json |
| 受影响来源/额度页 | 源码三档缩放通过 | source-quota.log |
| 正式构建 | 全新 dist/all-agent-recovery-20261019/win-unpacked 构建通过，不覆盖旧代次 | build.log |
| ASAR/原生包审计 | 源码、资源、文档逐字节匹配；无退役/开发入口，tokscale 版本及 SHA-256 匹配；全部测试后再次核对通过 | package-audit.log、package-audit-final.log |
| 全部打包 UI | 全部套件最终通过；首轮有两项测试脚本问题，修正后各自复跑通过，原失败保留 | packaged-ui/status.json、packaged-ui/final-results.json、unpriced-rerun.log、visual-rerun.log |
| 解压字节检查 | 中文及空格路径副本逐文件字节一致 | extraction.json、extraction.log |
| 解压副本采集 UI | agent-recovery 在解压副本上 100%/150% 通过，真实启动合成采集及原生统计；采集后原包与解压目录字节均不变 | extracted-collecting-ui.log、extracted-collecting-ui/、extraction-after-tests.json |

首轮 lint 发现本会话批量编辑脚本处理数组的错误，使四个自有 UI 文件出现错误替换；仅还原这四个自有文件后定向重做，lint 复跑通过。新 UI 套件首轮错误地把空缓存标为不接受的 QuotaCacheV1，生产代码按合同隔离了它；将夹具改为 QuotaCacheV2 后三档复跑通过。没有为通过测试修改缓存保护或降低断言，不把首轮写成通过。

全量打包首轮另有两项验收脚本失败：未定价引导对同一条目内两个 details 使用宽泛定位器；视觉夹具在同一资源池重复放置 secondary 窗口标识，被 V2 缓存合同拒绝。分别改为已有 data-gap-help 区域定位，以及独立 codex-extra 资源池的第三窗口，并新增夹具合法性检查。保留所有原行为、三窗口、零值、未知值及固定尺寸断言。修正后两项在同一打包字节上各自复跑通过；产品代码、缓存防护、数据语义均未放宽，不因仅测试脚本修正重建/重复全部通过套件。

Browser 插件及 browser 技能未提供，使用项目 Electron Playwright。每次启动显式指定独立 usage/quota/home；浏览器/剪贴板使用替身。新套件点击全部 Agent 的实际入口、扫描及官方指南，验证固定目标、失败反馈、新文件出现撤回安装命令、账本/额度文件字节不变、不创建登录 home。已查看源码及打包版窄窗暗色截图，无横向溢出。正式包全部既有套件及新引导套件最终通过，完整 roster 与首轮/复跑证据在 final-results.json。

## 已验证程序身份

运行时由实现提交 `76f95cac632f796cb5fbd6351aa2f5d300c90f2c` 构建；之后只有验收脚本和本记录变化。`resources/app.asar` SHA-256 为 `8a1428912e8f9a12debe13b9f078f20ee1ad96d1e1107812841c54c9416309c9`，exe SHA-256 为 `9c4374bcf84beb933b5164ba000965ce9c7996ced94aba25ca96e5e83f1d757f`。构建身份见 build-identity.json。全文件解压字节检查涵盖 runtime 目录全部文件；没有用只比入口文件替代完整解压检查。

## 真实验收边界

已真实核对的是公开官方资料及本地构建/包字节。程序安装、账号登录、真实来源/配置/认证内容、真实额度与会员过期均未检查。本轮没有使用此前 Antigravity 单次 /usage 授权，没有启动自动安装/登录/轮询。网络仅开发构建获取依赖和官方公开资料，未上传用量或用户数据。程序沿用未签名的本地构建配置。

## 交付与人工检查

交付目录 `dist/all-agent-recovery-20261019/`，程序 `win-unpacked/Agent Usage Quota.exe`；需要保留整个目录。随附使用说明、源码归档、交付清单及 SHA256SUMS；源码 ZIP 和运行时完整目录的散列以交付清单为准，归档生成后单独核对。用户可从来源管理或额度页的“安装与故障恢复”逐个检查显示/官方链接/手动扫描/复制及失败提示；不提前将用户人工体验记为通过。

本轮仅本地集成；没有 push/PR/远端合并。`origin/main` 保持 `4d011eb81a4cca62f39084909ac3e6bfe096f594`。通过验收后在干净共享 main 上 no-ff 合入，提交与合入身份以 Git 历史、local-merge.json 及最终交付清单记录为准；不替换用户当前运行的安装版，不清理旧代次。
