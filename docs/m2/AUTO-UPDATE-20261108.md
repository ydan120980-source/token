# 自动更新：构建、发布、下载与重启安装

所有者 2026-11-08 决定（本文件是 `docs/m2/GITHUB-AND-UPDATE-20261104.md` 更新部分的继续，不是它的替代）。该文件记录的决定「手动检查，有新版本时打开下载页，有证书之前不做自动安装」在本文范围内被取代：**现在做自动构建、自动检查、后台下载、确认后重启安装；仍然没有证书，仍然只发未签名预览版。**

## 所有者确定的四件事

| 决定 | 选择 |
|---|---|
| 更新包放在哪里 | GitHub Releases（`ydan120980-source/token`），不自建下载站 |
| 签名 | 暂时没有证书，发未签名预览版 |
| 升级流程 | 后台自动下载，下完提示「重启并更新」，由使用者选时间 |
| 怎么触发构建 | 打版本标签自动构建，生成**草稿** Release，等所有者确认后再发布 |

## 已实现

**主进程（`src/quota/update-service.js`，新增）**
`electron-updater` 6.8.11 + NSIS 安装包 + GitHub Releases。它需要 `electron.app` 与 `electron.net`，无法放进现有的子进程网络隔离模型，因此是主进程里唯一直接联网的模块。它通过 electron-updater 自己的 session partition（`electron-updater`，无缓存）访问网络，**不走 `node:http`/`fetch`**，所以 `src/quota/main.js:34` 的 `disableNetwork` 保持原样。现有的四个子进程通道（额度、公开价格、安装器、provider）一个都没改动。

状态机：`unconfigured → idle → checking → available → downloading → downloaded`，失败进 `error`，取消回 `available`。八个错误码 `UPDATE_NOT_CONFIGURED / UPDATE_NOT_PUBLISHED / UPDATE_OFFLINE / UPDATE_REQUEST_FAILED / UPDATE_VERIFY_FAILED / UPDATE_BUSY / UPDATE_NOT_READY / UPDATE_INSTALL_FAILED` 与 `src/quota/errors.js` 的额度错误目录分开，不会被 `safeCode()` 当成 provider 失败。

节奏：启动 20 秒后检查一次，之后最多每 6 小时一次（仅窗口开着时）。两个定时器都 `unref()`。`autoDownload=false`（下载由本模块发起，不藏在检查里）、`autoInstallOnAppQuit=false`（**退出时不安装**，只有人点了才装）、`allowPrerelease=true`（本项目发预览版）。

安装走 `quitAndInstall(true, true)`：NSIS 收到 `/S --force-run`，静默安装并让新版本重新启动。助手式安装器（`oneClick:false`）自己从注册表找上次安装目录，不需要 `/D=`。

**安装前排空自己的进程。** 安装器要替换正在运行的程序占用的文件，而 NSIS 只短暂等待就会强杀残留进程，所以 `install()` 先 `await beforeInstall()`——主进程把这件事接到与「退出应用」同一个 `shutdown()`，停止采集与其他子进程——之后才启动安装器。关闭窗口仍遵循既有托盘设置。关闭任务使用 `allSettled`，即使一项失败也等其余任务结束；失败向安装调用方传播，不能弹错误后当作成功。失败时状态留在 `downloaded` 并报 `UPDATE_INSTALL_FAILED`，更新桥和托盘保留，重试只再调用未成功关闭的任务。已关闭的采集不会自动恢复；永久关闭失败仍需退出排查，不能靠重试绕过检查。

**并发与取消。** 每次下载有自己的任务记录（token、取消标记和收尾 Promise）。点「取消下载」之后状态回到 `available`，保留任务归属直到底层 Promise 收尾；立即重试会先等它结束，避免 electron-updater 把旧 `downloadPromise` 返回给新 token。期间旧进度、完成或错误事件不能恢复下载／安装状态。手动检查、定时检查与下载共用同一个 `busy` 守卫，启动 20 秒的那次检查若撞上正在进行的下载就直接跳过本回合，不产生未处理的拒绝。

安装器同步抛错、同步错误事件及晚到的启动错误都保留已下载状态与重试按钮；更新错误即使在退出准备后仍能通知界面。直到真正退出才关闭更新监听器和托盘。

**界面**
设置 → 关于。`data-about-update` 反映状态，按钮依状态是「检查更新」/「取消下载」/「重启并更新」，未打包的运行显示「这个版本不含自动更新」，不提供按了也没用的按钮。进度按整百分比或 250ms 节流刷新，不打断阅读。

**发布（`.github/workflows/release.yml`，新增）**
`push` 一个 `v*` 标签，或手动指定标签。校验标签等于 `package.json` 的版本（electron-updater 就是按 `v<version>` 找标签的）→ `npm run verify` → `audit:runtime` → `dist:win:setup` → `audit:package` → 检查 `latest.yml`、`.blockmap`、`resources/app-update.yml` 都在且 `latest.yml` 描述的是这个版本 → 用 `GITHUB_TOKEN` 建**草稿** Release。发布草稿是人的动作，工作流永远不做。

**工作流只碰草稿。** 重跑同一标签时先 `gh release view --json isDraft`，只有 `isDraft` 为 `true` 才替换附件；已经发布过的标签直接失败退出，不会用 `--clobber` 覆盖已发布的安装包（`--clobber` 会先删后传，上传失败就留下残缺资产）。

工作流里的两段 PowerShell 有本地测试 `tests/m1/release-workflow.test.js`：按步骤名抽出 `run:` 块，在临时目录里用真的 `pwsh` 执行，`gh` 用桩替代，覆盖附件齐全/缺件/版本不符/无 sha512、建草稿、覆盖草稿、拒绝已发布、上传失败。加这段测试的原因是一个真实缺陷：`@($setup, 'dist/latest.yml', 'dist/AgentUsage-' + $version + '-setup.exe.blockmap')` 里 `+` 的优先级低于逗号，会把路径拆成三个数组项，即使文件都在也会报缺件。现在 blockmap 路径先算成 `"$setup.blockmap"` 再进数组。

权限只有 `contents: write`，用于建草稿；安装包里没有任何令牌。

**配置（`package.json`）**
`build.publish` 从 `null` 改为固定的 GitHub provider（`ydan120980-source/token`），`nsis.differentialPackage: true`。`governance.py` 现在断言发布目标就是这两项，构建不可能被指向别人的 Release。

## 本地实际验证过什么

- `npm run dist:win:setup` 真跑过：产出 `dist/AgentUsage-0.1.0-preview-setup.exe`（约 122 MiB）、其 `.blockmap`（133 KB）、`dist/latest.yml`（version/files/sha512/path/releaseDate 齐全），以及 `dist/win-unpacked/resources/app-update.yml`（`owner: ydan120980-source` / `repo: token` / `provider: github` / `updaterCacheDirName: agent-usage-updater`）。
- `npm run audit:package` PASS：272 项源码/资源/文档与 ASAR 逐字节一致，运行时包元数据一致，unpacked tokscale 4.17.0 哈希匹配。
- `npm run verify` PASS：ESLint、`tsc -p ui/tsconfig.json`、全部单元测试 `fail 0`（含 11 个更新服务测试与 12 个工作流测试）。
- `py scripts/m1/governance.py` PASS。注意 `python` 在这台机器是 WindowsApps 别名，会以 9009 失败，要用 `py`。
- `node scripts/m1/account-update-ui-test.js` PASS（源模式，Playwright）：未配置时「检查更新」禁用且文案为「不含自动更新」；注入假 updater 后，检查 → 后台下载（断言此时 `installed` 仍为空）→ 进度 → 「重启并更新」→ 断言 `quitAndInstall(true, true)` 在清理完成之后才被调用。截图在 `artifacts/ui-account-update-20261108/`。
- 更新服务的边界测试覆盖的是失败路径而非happy path：取消后仍为 `available`、被取代的下载不覆盖新任务、清理未完成时安装器不启动、清理失败时保持 `downloaded` 并可重试、定时检查撞上下载时跳过且无未处理的拒绝。
- 工作流的两段 PowerShell 在本地用真的 `pwsh` 跑过（`gh` 为桩），包括「已发布的 Release 拒绝覆盖」。

## 没有验证、也不能声称的

- **没有真的从 GitHub 下载过、没有真的安装过一次升级。** 上面全部是合成 updater 与本地打包，没有联网、没有运行安装包、没有两个版本之间的真机升级。
- **没有打标签、没有建 Release、没有推送。** 仓库目前 0 个 Release、0 个 Tag。
- 差分下载已开启（`differentialPackage: true` + `.blockmap`），但**没有实测过一次差分更新**；electron-updater 在差分失败时会自动回落全量下载。
- 未签名意味着 electron-updater 跳过签名校验（`publisherName` 为空时 `verifySignature` 返回 null）。**SmartScreen 仍会警告**，且无法证明包来自本项目的发布者。
- 当前 `package.json` 版本是 `0.1.0`，与本仓已发布的成品版本相同。要发第一个可更新版本，需要先把版本号抬到 `0.1.1`。
- **旧包没有更新器**：已经装过的旧版本必须手动装一次这次的新版本，之后才能走程序内更新。`dir` 解压版不能自更新（没有 `app-update.yml`），会如实报「不含自动更新」。

## 验收步骤（所有者执行）

1. 同步抬高 `package.json` 与 `package-lock.json` 的版本，运行 `npm run build:ui` 更新内嵌版本的前端产物，再提交并按审阅范围推送 `v<version>` 标签。
2. 等工作流跑完，在 Releases 里看到草稿；下载草稿里的安装包装到一台干净的机器上（这是「旧包没有更新器」那一次手动安装）。
3. 再抬一次版本（例如 `0.1.2`），打标签、跑工作流，但**先不要发布**草稿 —— 客户端此时应该看不到任何更新。
4. 发布草稿。回到那台机器，启动应用，等启动检查（20 秒），应看到「有新版本 0.1.2」并开始后台下载。
5. 下完出现「重启并更新」；点击，确认安装完成且新版本自动启动、`--updated` 参数生效。
6. 验收时核对：统计、设置、阅读位置（`session-labels.json`）和加密连接记录是否保留。安装器 `deleteAppDataOnUninstall: false`，升级不删数据；但这需要真机确认一次。

## 尚未决定的事

- 证书/签名服务（`scripts/m1/signing-profile.js` 的 `readiness()` 仍是 `NOT_CONFIGURED`，`missing` 里只剩发布者身份与已签名产物两项）。
- 是否对全部用户开自动检查，还是先给一个开关。当前是启动即检查、无条件，与「后台下载、确认后安装」的最低打扰设定一致。

## Codex 二次复核后的维护修复

本批从 `0034192` 开始，仅修复清理失败传播和下载取消收尾，并保留安装器失败后的状态通知。新增测试直接执行主进程真实 `shutdown()`／`before-quit` 接线；取消测试使用已安装的 `AppUpdater.prototype.downloadUpdate` 和真实 `CancellationToken`，仅替换网络传输。UI 用假 updater 验证启动失败提示在状态刷新后仍存在，并可再次点击重启。

本批源码验证：`build:ui`、lint、UI 类型检查、全部单元测试、`audit:runtime` 和使用捆绑 Python 的 `governance.py` 通过。`account-update-ui-test` 在 1480×960 的合成窗口检查失败提示、状态刷新和重试；`desktop-shell-ui-test` 在 125% 的合成窗口检查托盘与关闭窗口行为，两套均通过。原有工作流 PowerShell 测试也在全量单元检查中通过。证据位于工作区外的 `token-evidence/auto-update-repair-20261108/`，未读真实来源或账号。

初轮新增主进程测试的夹具缺少 `usage` 空值占位，补齐后通过；首轮 UI 检查中 Electron 将未设置字段序列化成 null，改为直接断言「安装器是否已被调用」后定向复跑通过，保留首轮日志，没有删除失败路径或降低行为要求。

前述安装包属于维护前字节，不代表本批源码已进入交付物。本批没有重新打包／包审计、新建 Release／Tag、合并 main、推送、真实升级、差分下载或 RAM 测量。准备退出失败后不会自动恢复已关闭的采集；更新和退出入口保持可用，无法关闭的任务仍须排查。
