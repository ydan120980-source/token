# Antigravity 安装与恢复引导验收（2026-10-19）

本轮从本地 main `e09b236142174a2670ac4942a679f121439f0224` 推进所有者要求的“缺少 CLI 或无法读取 /usage 时提供安装/解决引导”。交付后端状态投影、固定动作控制器、主进程与 preload 接线；renderer 交由 Claude。接口和所有者决定见 [安装恢复合同](ANTIGRAVITY-SETUP-RECOVERY-20261019.md)。

## 验证结果

证据均在忽略目录 `artifacts/antigravity-setup-recovery-20261019/`，日常维护不生成 dist/源码 ZIP。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 新后端及原发现器专项单测 | 通过：缺失/桌面/shim/不完整/多候选、版本上下界、已知失败、未知身份/额度、stale/busy、固定动作、失败保留、真实 preload 与 sender guard | 首次专项工具输出；完整 verify 日志包含同组用例 |
| `npm.cmd run verify` | 首轮通过；补充最终反馈文案后最终复跑通过，ESLint clean、node --test fail 0 | `verify.log`、`verify-final.log` |
| `npm.cmd run audit:runtime` | 通过：单一产品入口、无退役路径或开发脚本导入 | `audit-runtime.log` |
| 源码 `node scripts/m1/source-quota-ui-test.js` | 首轮通过；最终代码复跑通过，100%/125%/150% 缩放 | `ui.log`、`ui-final.log`、`ui-final/*/results.json` |
| `git diff --check` | 通过 | 提交前实际执行 |
| 官方依据 | Quickstart/认证/排查页面核对；公开安装脚本只读获取，未执行 | 合同内官方链接及脚本散列 |

没有测试失败后放宽断言或保护边界。最终复跑是因为首次通过后增加固定中文动作失败反馈及安装最新版可能尚未复核的说明，需核对最终字节；不是把首轮失败改写成通过。

## 实际 IPC 集成证据

Browser 插件及 browser 技能未提供，沿用项目现有 Electron Playwright 套件。每次启动显式设置独立 usage/quota 目录与合成 fixture home；发现器不使用真实 PATH 或 Program Files。真实主进程/preload/renderer IPC 中依次验证：

1. 初次引导为未扫描；纯内存 getter 不扫描或请求额度。
2. 合成不可执行 agy.exe 被发现，仍是待核验；删除后变为缺少 CLI，已有发现入口与引导状态一致。
3. 拒绝调用方 URL；复制/浏览器失败返回对应错误；替身成功时只收到固定官方文本和固定链接。
4. 复制前 CLI 突然出现，重扫撤回安装建议，仍不宣告额度就绪；移除后显式重扫恢复缺失引导。
5. 合成文件字节、用量账本、额度缓存保持不变，不创建 Codex 登录 home。已有来源/额度导航、刷新、失败保留与重试、窄窗暗色回归继续通过，无页面错误。

浏览器与剪贴板动作使用替身，未真正打开浏览器或写系统剪贴板；没有 renderer 新功能改动，这不是新引导界面的可见验收。

## 复核结论与限制

CodeGraph 不可用，定向复核 `discoverAntigravity → setup.scan → state/action → IPC/preload` 调用链及主窗口/主 frame sender guard。没有外部 review agent 或外部审核服务；由本会话完成源码与测试复核。

缺少 CLI 的安装建议在执行前检查最新路径。发现任意候选/不完整/多候选时不继续复制安装命令；故障不会覆盖最后成功发现结果。新版本等待适配器核对、旧版本提供官方更新说明；不能反向推荐降级。通用进程错误只提供登录/网络/权限/服务限制的排查方向，不能推断具体原因、会员到期、账号身份或零额度。后端探测失败接收器只合成验证，尚未连接真实采集。

本轮没有扫描本机真实安装目录，上一轮 desktop-only 只是历史发现结果。真实 CLI 安装/登录/版本执行/额度请求均未进行；旧的单次 `/usage` 授权未被使用。打包版、新 renderer 和真实会员状态未验收。当前 quota live 支持仍 Codex-only；未开始其他 Backlog、通知、轮询或 GitHub 同步。

## 本地交付

主题分支 `codex/antigravity-setup-recovery-20261019`。按既有授权，通过门禁后在干净共享 main 以 no-ff 本地合入；合入记录由 Git 历史和忽略目录的 local-merge 收据提供。未 push 或创建 PR，`origin/main` 保持 `4d011eb81a4cca62f39084909ac3e6bfe096f594`。

已验证实现、单测、IPC 回归和合同提交为 `6ac5934474b1fa1e323489e9cfe96f3b2f477e22`（feat: add guided Antigravity CLI setup and recovery actions）。最终复跑与最终运行时审计均通过；后续结果记录提交只补交付证据。
