# 直接安装与更新交付验收（2026-10-19）

实现提交：`3d42e85c4d2f6c3c88bd494fcf4d95ef1a906dce`；异常退出护栏修复：`06a034e`。本轮依据所有者“像 CC Switch 一样直接安装，并保留官方下载入口”的纠正实施，合同见 [DIRECT-AGENT-INSTALL-20261019.md](DIRECT-AGENT-INSTALL-20261019.md)。最小现有页面入口属于本轮，后续视觉美化仍交 Claude。

## 已完成的代码与检查

- 十个内置 Agent 的固定安装计划、官方版本检查、应用内 CLI 安装/升级、桌面签名核验与安装界面交接、串行队列、进度、取消/重试、外部安装元数据、启动命令复制和官方下载备用入口已实现。
- CLI 安装使用私有 Node/HOME/npm 配置和新代次；版本核验前不切换 active。桌面安装必须复检，取消了安装界面可清除待复检标记。没有安装器任意 URL/路径/命令 IPC。
- `npm run verify` 最终 `fail 0`；`audit:runtime` 通过。合成合同覆盖固定计划/版本/域名、下载超限/重定向/取消、校验失败阻断、签名拒绝、升级失败保留旧版本、串行进度、IPC 注入、桌面未完成/重启/复检，以及无法确认清理时停止队列、工作进程意外退出和 IPC 断联后取消。
- Windows 真实 Job Object/helper 测试通过：安装能力可请求受限长任务，额度能力仍限制 30 秒；短/长路径 ZIP 解压成功，穿越 ZIP 拒绝，进程已回收。
- 源码模式受影响 `agent-install-ui-test.js` 与 `source-quota-ui-test.js` 在 100%、125%、150% 缩放通过；安装/升级失败与重试、取消、桌面复检、官方备用入口、窄窗深色、业务数据字节保持不变均有合成证据。
- 正式候选 `test:native`、`test:stress`、`experiment:crypto` 通过，均为独立合成数据。`validate:local` 未运行。
- `dist:win:dir` 完成，`audit:package` 最终通过：当前产品源码/资源逐字节匹配 ASAR，独立 PS/C# helpers 匹配，tokscale 固定版本与 SHA-256 护栏保持。
- 使用实际打包可执行文件加载 ASAR：独立安装 worker 实际 fork、空目录元数据扫描和官方 OpenCode 最新版读取通过（当时 `1.19.3`）；未安装、未登录、未调用模型/额度。打包 ASAR 调用解包后的 Windows helper/Job Object 也通过。
- Windows 构建 ZIP 解压到 `artifacts/direct-agent-install-20261019/验收 最终目录/解压 程序`，全部 87 个文件逐字节一致。

## 本轮失败与修复

1. 首轮 lint 的 caught-error 包装缺少 cause，已修复，后续完整 verify 通过。
2. 隔离真实 OpenCode 安装首轮在 Node 官方下载超时；第二轮下载/校验后触发 Windows PowerShell/.NET 的长路径限制。修复 extended path 与路径归一化，并新增短路径、长路径、穿越 ZIP 实测；补测第一轮因 extended path 中斜杠归一化遗漏失败，修复后复跑通过。
3. 修复后的隔离真实 OpenCode 安装已完成 Node 官方下载、哈希核验、实际解压和运行时版本检查，并进入 npm 平台包下载；在该下载阶段达到安装总时限，返回 `INSTALL_TIMEOUT`，子树确认回收，未写 Agent active 指针。**没有真实 CLI 安装成功证据。** 未改现有全局 Agent、PATH、账号或配置。
4. 首次包审计在 electron-builder 尚未产出 app.asar 时提前触发，报 ENOENT；等待构建退出后复跑通过。

5. 收尾源码复核发现工作进程意外退出、IPC 断联后取消缺少清理确认护栏，已改为停止队列；合成测试证明后续任务不启动。完整 verify、受影响源码安装 UI、最终构建/包审计、真实打包 worker/helper、最终解压字节核对均重新通过。此前候选全部 28 个 UI 与解压采集套件已通过，修复后的最终候选重新跑全套，结果以下节为准。

CodeGraph 工具不可用，本轮对当前源码、调用路径、IPC 和进程生命周期定向复核，并以测试与实际打包进程验证。

## 打包与解压运行验收

状态：最终候选通过。`scripts/m1/*-ui-test.js` 全部 28 个套件在最终打包程序上通过，无失败。字节核对过的中文/空格路径副本随后执行 `agent-recovery-ui-test.js` 通过：真实启动合成采集，OpenCode/MiMo 两种先归属顺序、100%/150% 缩放均通过，源文件哈希保持不变。

源码归档逐条字节校验、目录树哈希和本地 main 合入提交写入随包 `AgentUsage-CodexQuota-delivery.json`，最终生成证据为 `artifacts/direct-agent-install-20261019/delivery-final-check.json`。本地合入沿用干净共享 main、合作锁和 `--no-ff` 门槛，远端保持暂停。

交付目录为 `dist/direct-agent-install-20261019`，旧 `dist/all-agent-recovery-20261019` 保留。本轮不执行跨代硬链接共享；交付清单不得声称已执行共享。

## 未执行与限制

十个真实 Agent 的安装、升级、桌面向导、登录、账号额度/会员过期没有全量实机验收；安装逻辑与合成测试通过不能替代这些结果。Cursor update 与 Antigravity manifest 在本机网络曾不可达，受控失败与官方下载入口保留。没有放宽来源/认证读取，没有模型调用、安装后自动登录或 `/usage` 重试；账号额度仍仅 Codex。自定义来源仍只有格式/路径引导。

所有者的实际界面与真实网络验收待交付后检查。代码与交付只在本地，不 push、不建 PR、不做远端合并。

证据目录：`artifacts/direct-agent-install-20261019/`；关键文件为 `verify-final-worker-lifecycle.log`、`runtime-audit-lifecycle-final.log`、`native.log`、`stress.log`、`crypto.log`、`build-final-worker-lifecycle.log`、`package-audit-lifecycle-final.log`、`packaged-helper-final.log`、`packaged-worker-final.log`、`isolated-real-result.json`、`packaged-ui/status.json`、`extracted-byte-check.json`。
