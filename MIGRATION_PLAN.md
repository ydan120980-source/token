# MIGRATION_PLAN.md — QuotaDock · Electron → Tauri v2 纯 Rust 迁移

> **最高优先级：本机编译产物即用即删。** 构建前检查 RAM 和目标盘空间，使用本轮专用输出目录。验证、失败或取消后清理编译目录、临时包和解包副本，保留日志、哈希和验收数值。清理范围按 [AGENTS.md](AGENTS.md) 首条执行。

> **接力指令（新会话第一句话）**：「请先读取 MIGRATION_PLAN.md，然后继续执行下一个未完成的任务。」
> 本文件是迁移工程的唯一进度锚点。每完成一个子模块的移植与测试验证，立即更新 §7 的勾选与证据行。
> 工作树：`token-fix`，审阅分支 `codex/rust-migration-review-20261119`（快照 `458a57f`）。**未经所有者允许禁止合并到 main，禁止 push。**
> 状态：**单进程 Rust 宿主。M4、M5 已通过所有者验收，IPC 直连 111／111，展开 123／123。M6.1 已完成，M6.2 转入 GitHub 手动安装预览路径。**

---

## 0. 目标与铁律（所有者指令 2026-11-17）

目标：后端 100% Rust 化（Tauri v2，Windows OS Native），剥离 Chromium 与 Node.js；
正式安装包 ≤ 15 MiB。进程树私有工作集：冷启动直进托盘 ≤ 15 MiB、读库关窗回托盘 ≤ 35 MiB、开窗峰值 ≤ 500 MiB。复用前端页面与组件。

1. **前端最小改动**：禁改 `ui/src/pages/`、`ui/src/kit/`；唯一改造点 `ui/src/data/bridges.ts`
   （Electron `window.*` → `@tauri-apps/api/core` invoke + `@tauri-apps/api/event` listen）。
   所有 Rust 返回结构 `#[derive(Serialize, Deserialize)]` + `#[serde(rename_all = "camelCase")]`，
   字段名/嵌套/错误结构与 `ui/src/data/types.ts`、`src/quota/contract.js`、`src/m1/statistics-contract.js` 分毫不差。
2. **消灭 Node Worker 与外部脚本**：10 个 `worker_threads` → 同进程 `tokio` 任务 + `rayon` 池；
   删除 `windows-job-host.cs` 与全部 `.ps1`；`windows` crate 原生实现 DPAPI
   （`CryptProtectData`/`CryptUnprotectData`）与 Job Object（`CreateJobObjectW` +
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` + `AssignProcessToJobObject`）。
3. **存储瘦身**：废 `sql.js` → `rusqlite`（bundled、WAL、磁盘页缓存），Schema 与 Zstd 快照帧 100% 兼容；
   JSONL 流式 `BufReader`/偏移量读取，严禁整文件入内存；`tokscale` 内联为 Cargo 依赖（许可门见 §6-G1）。
4. **WebView2 降内存**：`additionalBrowserArgs` 注入
   `--js-flags=--max-old-space-size=128 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`；
   关闭主窗口 = **销毁 WebView2 实例**，仅留 Rust 调度 + 托盘；托盘唤醒时重建窗口。
5. **Zero Stubs**：禁 `todo!()`/`unimplemented!()`/省略/假数据；15 个适配器的 HTTP/OAuth/Cookie 逻辑 1:1 完整移植。
6. **进度持久化**：本文件随每个子模块更新。

与项目既有规则的关系：本迁移是所有者新决策，覆盖 AGENTS.md 中「Electron 为宿主」的历史实现描述；
但**数据语义不变量**（未知不填零、快照顺序无关、十进制字符串、隐私边界、合成测试为主）全部继承，见 §5。
Electron 旧实现与 `tests/m1` JS 套件在切换验收前保持可运行、保持绿，作为对照基准。

---

## 1. 勘探事实（Phase 0 实测）

| 项 | 事实 |
| --- | --- |
| 后端规模 | `src/m1` + `src/quota` 共 13,698 行 JS（含 10 个 worker、15 个 provider 适配器、4 个 `.ps1`/`.cs` 宿主脚本） |
| 测试基准 | `tests/m1/*.test.js` 147 个套件 + `tests/m1/fixtures/` 合成夹具（Rust parity 测试复用同一夹具目录） |
| 前端构建 | Vite 7 lib 模式 IIFE 单包 `design/desktop-reference/ui/agent-ui.js` + 单 CSS，`<script src>` 经典加载，CSP `script-src 'self'`，无模块/eval/网络；`tests/m1/ui-bundle.test.js` 逐字节校验 |
| 桥装配 | preload 暴露 `usageTransport`/`quotaBridge`/`windowBridge`/`shellBridge`/`githubBridge`/`updateBridge`/`trayBridge`/`previewUsage`；**宿主层** `usage-data.js` 把 `usageTransport` 装配成 `usageBridge`（含 packed delta 解码），`quota-host.js`/`sessions-host.js`/`sources-host.js`/`insights-ui.js` 同理 |
| packed 快照 | `usage:getPacked` 返回 `{snapshotBytes, snapshotRevision, ...}`；`snapshotBytes` 是 **JSON delta 帧**（`LocalUsageDeltaV1`），页内 `window.snapshotCodec.unpack` 解码；Rust 侧必须产出同构帧，宿主 codec 不动 |
| 账本存储 | `statistics.json` 经 `write-statistics`/`read-statistics`（zstd 帧）；`preferences/pricing/billing/validation/workbench/model-pricing/session-labels` 为普通 JSON；独占创建同目录 `.tmp-<rand>`、`sync_all` 后原子替换，Unix mode 0o600；损坏隔离 `quarantine/` |
| 源库读取 | `sqlite-memory.js`：**只读字节拷贝 + 手工 WAL overlay**（校验 WAL 头/ checksum /commit 边界，512MB 上限），sql.js 内存映像查询，不碰源库 shm 锁；Rust 必须保留同语义（不能直接 rusqlite 打开活库） |
| native 引擎 | `tokscale.exe` 4.17.0，每次 spawn 前 SHA-256 全量校验；仅用于「统计投影核对」，非主采集路径；上游 github.com/junhoyeo/tokscale 为 Rust workspace：`crates/tokscale-core`（lib）+ `crates/tokscale-cli`；仓库许可标 MIT + AGPL-3.0（**core 许可待核，G1**） |
| 网络边界 | 主进程 `disableNetwork`；网络只存在于隔离子进程：provider worker、price-fetch、installer 下载、github-transport、electron-updater 自有 session。Rust 侧用**按作用域隔离的 reqwest client** 继承该边界，统计核心零网络 |
| 窗口 chrome | Electron `titleBarStyle:hidden` + 原生 `titleBarOverlay` 提供最小化/最大化/关闭；UI bundle 内**没有**自绘窗口按钮（`window-controls` 0 处）。Tauri `decorations:false` 后需宿主层注入控制条（§3.4，G4） |
| 托盘 | 独立 BrowserWindow 加载 `design/desktop-reference/tray/card.html`，桥仅 `tray:rows/size/open` + `tray:update`；Tauri 第二 WebviewWindow 或同窗口隐藏方案见 §3.4 |
| 更新 | electron-updater + NSIS draft Release 流程（`AUTO-UPDATE-20261108.md`）；Rust 侧以 `tauri-plugin-updater`(nsis) + `tauri-plugin-process` 重启继承「先 controlled shutdown 再安装」语义 |
| IPC 面 | invoke 通道 ≈ 118（含 `usage:agents:*` 13、`usage:config:*` 6），push 事件 9；全表见 §2 |

---

## 2. IPC Channel 完整映射表

命名规则：`domain:action` → Tauri command `domain_action`（snake_case）。
返回类型列引用 `ui/src/data/types.ts`（下称 T）。envelope 不扁平化：`{ok:false,...}` 仍是成功 resolve 的数据。
错误码字符串（`safeCode`/`MESSAGES`/`ERRORS` 白名单）1:1 保留。

### 2.1 window / shell / tray（宿主层，M3）

| Electron channel | Tauri command | 入参 | 返回 |
| --- | --- | --- | --- |
| `window:menu` | `window_menu` | name: "app"\|"statistics"\|"appearance"\|"about" | true |
| `window:theme` | `window_theme` | "light"\|"dark" | true |
| `window:state` | `window_state` | — | T.WindowState |
| `shell:get` | `shell_get` | — | 壳偏好（desktop-shell 现状对象） |
| `shell:set` | `shell_set` | patch | 同 `shell:get` |
| `shell:readHistory` | `shell_read_history` | id: string(≤64) | 行数组（含 message 映射） |
| `tray:rows` | `tray_rows` | — | 托盘卡片行 |
| `tray:size` | `tray_size` | height: number | true |
| `tray:open` | `tray_open` | command: string | true（唤醒主窗口/导航） |
| （新增）`window:minimize`/`window:maximize`/`window:close` | `window_minimize`/`window_maximize`/`window_close` | — | true（G4 控制条用；经 windowBridge 暴露） |

### 2.2 usage 域（M1/M2 引擎，M3 接线）

| Electron channel | Tauri command | 入参 | 返回 |
| --- | --- | --- | --- |
| `usage:get` / `usage:getPacked` | `usage_get` / `usage_get_packed` | revision: number\|null | T.UsageState / packed 帧（§1） |
| `usage:refresh` / `usage:refreshPacked` | `usage_refresh` / `usage_refresh_packed` | 同上 | 同上 |
| `usage:enabled` / `usage:interval` / `usage:subscription` | `usage_enabled` / `usage_interval` / `usage_subscription` | bool / ms / (agent, fee) | T.UsageState |
| `usage:performanceState` | `usage_performance_state` | —（多余参数拒绝） | bridges.ts 内联对象 |
| `usage:statisticsDiagnostics` | `usage_statistics_diagnostics` | — | requests+lifecycle+owner |
| `usage:connections` / `usage:connectionsV2` | `usage_connections` / `usage_connections_v2` | — | T.Connections / T.ConnectionsV2 |
| `usage:sources` | `usage_sources` | — | T.SourceDiscovery |
| `usage:sourceChange` | `usage_source_change` | (name, agent, value) | T.SourceChangeResult |
| `usage:chooseSource` | `usage_choose_source` | agent（原生目录/文件选择器） | T.SourceChooseResult |
| `usage:revealSourcePath` | `usage_reveal_source_path` | path（必须已在 discovery 内） | {shown:true} |
| `usage:dataInfo` / `usage:openData` | `usage_data_info` / `usage_open_data` | — | {version,path,bytes} / void |
| `usage:agentUse` | `usage_agent_use` | {offset} | {rows:T.AgentUseRow[],searched,total,next} |
| `usage:pricing`（view='coverage' 同通道） | `usage_pricing` / `usage_pricing_coverage` | — | T.Pricing（含 sync）/ T.PriceCoverage\|null |
| `usage:priceSave` / `usage:priceReset` | `usage_price_save` / `usage_price_reset` | T.PriceEntry / T.PriceKey | T.Pricing |
| `usage:priceProbe` / `usage:priceTry` / `usage:pricePlan` | `usage_price_probe` / `usage_price_try` / `usage_price_plan` | entry / {key,targets} / {auto,fallback,partial} | T.PriceProbe / T.PriceTry / T.PricePlan |
| `usage:priceSync` / `usage:priceAuto` | `usage_price_sync` / `usage_price_auto` | — / bool | T.PriceSync |
| `usage:billingSave` | `usage_billing_save` | T.Billing | T.Pricing |
| `usage:codexPreview` / `usage:codexApply` | `usage_codex_preview` / `usage_codex_apply` | — / id（原生确认框） | T.MaintenancePreview\|null / T.MaintenanceApply |
| `usage:export` / `usage:exportCost` / `usage:exportProjects` | `usage_export` / `usage_export_cost` / `usage_export_projects` | snapshot / request / selection（原生保存框） | T.SavedFile |
| `usage:reprice` | `usage_reprice` | — | {recalculated,records,sequence,priceBasis} |
| `usage:workbench` / `usage:workbenchSave` / `usage:attention` | `usage_workbench` / `usage_workbench_save` / `usage_attention` | selection / T.WorkbenchSave / — | T.Workbench / T.Workbench / T.Attention |
| `usage:sessions` / `usage:sessionSummary` | `usage_sessions` / `usage_session_summary` | selection（packed=true 固定） | T.SessionList（packed 帧）/ T.SessionSummary |
| `usage:sessionLabels` / `usage:sessionLabel` | `usage_session_labels` / `usage_session_label` | — / (key, patch) | T.SessionLabels |
| `usage:transcript` | `usage_transcript` | key(64hex), request? | T.Transcript |
| `usage:transcriptPart` / `usage:transcriptFind` / `usage:transcriptStamp` | `usage_transcript_part` / `usage_transcript_find` / `usage_transcript_stamp` | key+request / key+{stamp,query} / key | T.TranscriptPart / T.TranscriptFind / markdown |
| `usage:transcriptFacts` / `usage:transcriptFileHistory` | `usage_transcript_facts` / `usage_transcript_file_history` | key / {key,path,offset} | T.TranscriptFacts / 内联历史对象 |
| `usage:searchTranscripts` | `usage_search_transcripts` | {query,range,agent,offset} | T.TranscriptSearch |
| `usage:transcriptCopy` / `usage:transcriptExport` | `usage_transcript_copy` / `usage_transcript_export` | key+{stamp,from,to[,name]}（导出带原生保存框） | {copied:true} / {saved?\|canceled?} |
| `usage:copyResume` / `usage:copyText` | `usage_copy_resume` / `usage_copy_text` | key / text | {copied:true} |
| `usage:openLink` / `usage:openFolder` | `usage_open_link` / `usage_open_folder` | url(http/s 白名单) / key | {opened:true} / {opened,path} |
| `usage:customDraft/Choose/Sample/Preview/Apply/Change/Import/Export` | `usage_custom_draft` … `usage_custom_export` | 见 bridges.ts 签名（choose/import 带原生选择器，import 有文件名/大小/符号链接校验） | T.CustomDraft 等 |
| `usage:agentSetup` / `usage:agentSetupAction` | `usage_agent_setup` / `usage_agent_setup_action` | agent / {agent,actionId,revision} | T.SetupReply |
| `usage:installers` / `usage:installerAction` | `usage_installers` / `usage_installer_action` | — / {action,agent,revision} | T.InstallReply |
| `usage:agents:<action>`（13） | `usage_agents_<action>` | action ∈ state,check,addProject,removeProject,instruction,preview,apply,locate,plan,repair,undoRepair,history,restore | 各自对象；错误 envelope `{error}` |
| `usage:config:<action>`（6） | `usage_config_<action>` | action ∈ state,choose,check,forget,cancel,manage | T.ConfigReply<…>；错误白名单 17 码 |

### 2.3 quota 域（M5）

| Electron channel | Tauri command | 入参 | 返回 |
| --- | --- | --- | --- |
| `quota:get` / `quota:getV2` | `quota_get` / `quota_get_v2` | — | T.QuotaReply<T.QuotaState> / T.QuotaReply<T.QuotaStateV2,null> |
| `quota:login` / `quota:cancel` | `quota_login` / `quota_cancel` | alias(≤48) / — | QuotaReply（login 打开外部 Chrome 授权 URL，白名单 `loginUrlAllowed`） |
| `quota:refresh` / `quota:refreshAll` | `quota_refresh` / `quota_refresh_all` | id(36uuid) / — | QuotaReply |
| `quota:setAutoRefresh` / `quota:remove` / `quota:chooseExecutable` | `quota_set_auto_refresh` / `quota_remove` / `quota_choose_executable` | "off"\|"1min" / id（原生确认框）/ —（原生选 codex.exe） | QuotaReply |
| `quota:providers` / `quota:providerExperimental` | `quota_providers` / `quota_provider_experimental` | — / bool | T.QuotaReply<T.ProviderState> |
| `quota:providerConnect` / `quota:providerAction` | `quota_provider_connect` / `quota_provider_action` | T.ProviderConnect / T.ProviderAction | 同上 |
| `quota:providerGuide` / `quota:providerPassiveGuide` | `quota_provider_guide` / `quota_provider_passive_guide` | adapter / id | 同上 |
| `quota:providerWebsiteLogin` / `quota:providerWebsiteCancel` / `quota:providerClientLogin` | `quota_provider_website_login` / `quota_provider_website_cancel` / `quota_provider_client_login` | T.ProviderConnect / — / T.ProviderConnect | 同上 |
| `quota:discoverAntigravity` | `quota_discover_antigravity` | — | {ok,discovery:T.RuntimeDiscovery\|null,errorCode?} |
| `quota:antigravitySetup` / `quota:antigravitySetupAction` | `quota_antigravity_setup` / `quota_antigravity_setup_action` | — / {actionId,revision} | T.SetupReply |

### 2.4 github / update（M5）

| Electron channel | Tauri command | 入参 | 返回 |
| --- | --- | --- | --- |
| `github:get/connect/cancel/disconnect/repositories/setSync/syncNow` | `github_get` … `github_sync_now` | — / request | `{ok:true,state}` \| `{ok:false,error:GITHUB_*}` |
| `github:copyCode` / `github:open` | `github_copy_code` / `github_open` | — / url(openable 白名单) | bool |
| `update:get/check/cancel/install` | `update_get` … `update_install` | — | `{ok,state}` \| `{ok:false,error:UPDATE_*,state}` |
| `update:open` | `update_open` | url（必须等于 latest.url） | bool |

### 2.5 push 事件（Rust `app.emit`，事件名不变；bridges.ts 用 listen 订阅）

| 事件 | 触发源 | 订阅方 |
| --- | --- | --- |
| `usage:update` | 统计事实变化/采集完成/定价变更 | usageBridge.onUpdate |
| `usage:installUpdate` | 安装器状态变化 | onInstallUpdate |
| `quota:update` / `quota:providerUpdate` | V1/V2 额度状态变化 | onUpdate / onProviderUpdate |
| `github:update` / `update:state` | 同步/更新状态变化 | 各自 onUpdate |
| `window:command` / `window:state` | 菜单命令/焦点/最大化 | windowBridge.onCommand/onState |
| `tray:update` | 托盘行变化 | trayBridge.onUpdate |

---

## 3. 目标架构

### 3.1 Cargo workspace 目录树

```
token-fix/
├─ Cargo.toml                  # workspace：members 随里程碑逐个加入
├─ crates/
│  ├─ usage-engine/            # M1：src/m1 核心（store/ledger/pricing/projection/valuation/
│  │  │                        #     workbench/snapshot-codec/delta/zstd-frame/sqlite 只读+WAL overlay/
│  │  │                        #     tokscale-core 内联核对）
│  │  └─ tests/parity/         # 翻译自 tests/m1，读 ../../tests/m1/fixtures
│  ├─ session-reader/          # M2：sessions/transcript*/search/labels/导出 markdown
│  ├─ source-admin/            # M4：discovery/source-scope/custom-sources/config-health*/
│  │                           #     agent-inventory/skill-front/agent-setup/agent-install 引擎
│  ├─ quota-engine/            # M5：V1/V2 service、15 适配器、refresh-scheduler、quota-watch、
│  │                           #     provider-secret-store(DPAPI)、github-service、update-service
│  └─ win-native/              # M4：dpapi.rs / job.rs / shortcut.rs(IShellLinkW) / power.rs /
│                              #     clipboard.rs（替换 .ps1/.cs 与 safeStorage）
├─ src-tauri/                  # M3：bin crate
│  ├─ tauri.conf.json
│  ├─ src/main.rs, lib.rs
│  ├─ src/ipc/{usage,quota,shell,github,update,tray,window}.rs   # §2 命令，薄封装 crates
│  ├─ src/host/{window.rs,tray.rs,lifecycle.rs,single_instance.rs}
│  └─ src/state.rs             # 服务编排 + controlled shutdown（继承 main.js shutdown 语义）
├─ ui/                         # 仅 data/bridges.ts 改（M3）
├─ design/desktop-reference/   # 宿主层不动；新增 titlebar-controls.js（G4）
└─ tests/m1/                   # JS 基准套件，切换前保持绿
```

### 3.2 `src-tauri/Cargo.toml` 依赖清单（含用途）

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon", "protocol-asset"] }
tauri-plugin-single-instance = "2"      # requestSingleInstanceLock + second-instance 唤醒
tauri-plugin-autostart = "2"            # 开机自启，默认 off（DESKTOP-SHELL-20261105）
tauri-plugin-dialog = "2"               # 全部原生 open/save/confirm 框（§2 标注处）
tauri-plugin-opener = "2"               # openExternal/openPath/showItemInFolder
tauri-plugin-clipboard-manager = "2"    # writeClipboard 语义
tauri-plugin-updater = "2"              # NSIS 更新，替换 electron-updater（draft 流程继承）
tauri-plugin-process = "2"              # 更新后重启
serde = { version = "1", features = ["derive"] }
serde_json = "1"                        # 保留未知字段：#[serde(flatten)] extra: Map 承接 [key:string]:unknown
tokio = { version = "1", features = ["rt-multi-thread","macros","sync","time","process","io-util","fs"] }
rayon = "1"                             # CPU 密集投影/解析，替换 worker_threads
rusqlite = { version = "0.32", features = ["bundled", "serialize"] }   # 仅查询内存映像/自有库；源库仍字节拷贝（deserialize 需 serialize feature）
zstd = "0.13"                           # 账本 zstd 帧 100% 兼容
num-bigint = "0.4"                      # G5 已决：amount.js 36 整数位+18 小数位超 rust_decimal 上限，BigInt 对齐算术 1:1
sha2 = "0.10"                           # 哈希/digest/session key
rand = "0.8"; uuid = { version = "1", features = ["v4"] }
regex = "1"                             # 适配器/校验正则 1:1
indexmap = "2"                          # JS Map 插入序（scan 结果/分组）
iana-time-zone = "0.1"                  # Intl resolvedOptions().timeZone 等价（系统 IANA 时区）
icu_collator = { version = "2", features = ["compiled_data"] }  # localeCompare  parity（系统 locale ICU 排序）
icu_locale = { version = "2", features = ["compiled_data"] }
sys-locale = "0.3"                      # Node 默认 locale 等价（Windows 用户默认 locale）
chrono = { version = "0.4", features = ["serde"] }  # 时区/day 边界（投影时区语义 M1 核对）
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls","cookies","gzip","json","stream"] }
url = "2"; base64 = "0.22"; cookie_store = "0.21"
encoding_rs = "0.8"                     # 适配器编码（如 GBK）按 1:1 需要
windows = { version = "0.58", features = [
  "Win32_Security_Cryptography",        # DPAPI
  "Win32_System_JobObjects", "Win32_System_Threading",
  "Win32_UI_Shell", "Win32_UI_WindowsAndMessaging",
  "Win32_System_Com", "Win32_System_SystemInformation" ] }
tokio-util = "0.7"; futures = "0.3"
tokscale-core = { path = "vendor/tokscale-core" }  # 门 G1 已决：v4.17.0 源码内联（MIT），见 §7 2026-11-17 tokscale slice
[build-dependencies]
tauri-build = { version = "2", features = [] }
[profile.release]
lto = true; codegen-units = 1; strip = true; panic = "abort"; opt-level = "z"  # 体积门 G2
```

### 3.3 `tauri.conf.json` 要点

- `build.frontendDist = "../design/desktop-reference"`（宿主 index.html + 已提交 bundle，经典脚本加载不变）。
- 主窗口：`decorations:false`、`transparent:false`、`backgroundColor` 随系统主题（GROUND）、
  1480×960 上限/min 800×600、`visible:false` 启动后 show（`--hidden` 时仅托盘）。
- `windows[].additionalBrowserArgs = "--js-flags=--max-old-space-size=128 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"`。
- 独立 WebView2 user-data-folder（保证销毁窗口后其进程可退出，G3）。
- CSP 与现状一致（`script-src 'self'`）；asset protocol 仅暴露白名单目录（图标/托盘卡）。
- 托盘图标 + 第二 WebviewWindow（tray/card.html，`decorations:false`、按需创建/销毁）。
- 安全：等价 `setWindowOpenHandler(deny)`/`will-navigate preventDefault` → Tauri `on_navigation` 拒绝 + 新窗口请求拒绝；
  等价 webRequest 拦截 → 自定义协议只放行本地资产，渲染器零网络（网络全在 Rust 作用域 client）。

### 3.4 bridges.ts 改造设计（M3，唯一前端改动）

- bridges.ts 不再读 preload 注入对象，而是**用 invoke/listen 构造同形对象**挂到
  `window.usageTransport`、`window.quotaBridge`、`window.windowBridge`、`window.shellBridge`、
  `window.githubBridge`、`window.updateBridge`、`window.previewUsage`。
- **宿主层 `usage-data.js`/`quota-host.js` 等装配逻辑零改动**：它们只消费 `usageTransport`，
  packed delta 解码、sessions codec 解包继续在页内完成（§1），Rust 只负责产出同构字节。
- `windowBridge` 增加 minimize/maximize/close 三方法供宿主控制条；`onCommand/onState` 用 listen。
- 订阅型成员（onUpdate 等）返回 Unsubscribe，内部 `listen().then(unlisten)` 同步包装，语义与 ipcRenderer.on 一致。
- **窗口控制条（G4）**：新增宿主脚本 `design/desktop-reference/titlebar-controls.js`（宿主层，非 ui/src），
  在 `integrated-titlebar` 区域右端注入三按钮，调 windowBridge；样式走 tokens.css 既有令牌。
  这是绕过「禁改 pages/kit」与「Tauri 无原生 overlay」冲突的唯一合规路径。
- 托盘卡 `card.js` 的 `trayBridge` 同理由 bridges.ts 的托盘入口构造（或独立小入口脚本，M3 定）。

---

## 4. 六个里程碑

每个里程碑：独立可编译（workspace 成员级）、独立可测试（cargo test parity + 对应 JS 套件仍绿）、
完成即更新 §7。顺序按依赖：引擎 → 读取 → 宿主 → 管理 → 外部连接 → 验收。

### M1 · usage-engine：账本与统计核心（headless lib）
- 移植：`store.js`（含 quarantine/atomic/迁移/reconcile）、`read/write-statistics`+`zstd-frame`、
  `snapshot-codec/delta`、`usage-snapshot`（顺序无关）、`usage-math/projection*/valuation/pricing*`、
  `runtime-catalog/model-aliases`、`workbench/insights-math/cost-*`、`session-aggregate`、
  `sqlite-memory`（字节拷贝+WAL overlay 1:1，rusqlite 查内存映像）、`native.js`→tokscale-core 内联核对。
- 并发：statistics-worker 的 read/mutation 队列语义 → tokio 单写者队列 + rayon 投影（`statistics-contract` 命令表保留为内部协议）。
- parity 测试（翻译）：core, cost-table, usage-projection-incremental, usage-projection-accumulators,
  usage-series, usage-models, snapshot-order, snapshot-codec, snapshot-delta, saved-string-sharing,
  read-statistics, write-statistics, write-consistency, startup-storage, agent-ledger, pricing-maintenance,
  pricing-plan, pricing-sync, runtime-pricing, model-aliases, workbench, budget-overview, attention-summary,
  insights, calendar, trend-gaps, source-calculation, wal-overlay, collection-batch, collection-diagnostic,
  statistics-contract, read-model, query, query-runtime, display-values, cost-models, cost-day-series,
  cost-chart, chart-geometry, candidate-core, native-binary（改为 core 内联 parity）。
- 出口：`cargo test -p usage-engine` 全绿；JS 基准同夹具结果逐字段比对（金额十进制字符串、null 不填零）。
- 门：G1（tokscale-core 许可/API）、G5（decimal 精度）。

### M2 · session-reader：会话与阅读器
- 移植：`sessions/session-list*/session-labels`、`jsonl-adapter`、`transcript*.js` 全族（流式 BufReader、
  偏移量分页、continuation 校验、marks、file-history、search 时间bounded批）、`transcript-changes`、
  `batch1-sources/batch1-extra-sources/extended-sources` 的读取部分、markdown 导出。
- parity：transcript-*（12 个）、sessions-*（6）、session-labels, session-aggregate, session-range,
  reader-turns, continue-sessions, batch1-sources, batch1-extra-sources, public-agent-formats, scan-cache。
- 出口：512MB 上限、预览预算截断不丢项、subagent 按时间合并等 READER-FULL 规则逐条有测试。

### M3 · src-tauri 宿主 + bridges.ts 切换
- 移植：`window-shell/desktop-shell/tray`（含 tray 销毁重建主窗口 WebView2，G3）、单实例、`--hidden`、
  快捷方式对齐（IShellLinkW）、powerMonitor→WM_POWERBROADCAST、controlled shutdown 编排、
  `clipboard-write/chrome-browser`（外部 Chrome 打开语义）、`read-history`、`quota-watch` 通知壳。
- bridges.ts 按 §3.4 改造；titlebar-controls.js 注入；`previewUsage` 加载信封保留。
- 接线 M1/M2 全部 usage 命令 + 事件；未移植域（quota/github/update/agents/config/install）命令返回
  **真实错误 envelope**（如 `STATISTICS_COMMAND_REJECTED` 同族的 `*_UNAVAILABLE` 错误码），非假数据（铁律 5 的合规形态：错误是真实状态）。
- parity/冒烟：window-shell, desktop-shell, usage-data-transport, ui-preview-data, clipboard-write,
  chrome-browser, ui-bundle（bundle 字节不变）, ui-layout, widget-layout-model；
  UI 套件 harness：Playwright 经 WebView2 `--remote-debugging-port` CDP 接入（G6），先跑概览/用量/会话三页冒烟。
- 出口：Tauri dev 构建可开概览/用量/会话/费用/设置页，真实合成数据；托盘关闭→内存测量（G3 首次数值）。

### M4 · source-admin + win-native：源管理/配置健康/Agent 管理/安装器
- 移植：`discovery/source-scope/source-registry/custom-sources`、`config-health*`+`config-manager`
  （加密备份→DPAPI）、`agent-inventory/skill-front/agent-traces`、`agent-setup/antigravity-setup/discovery`、
  `agent-install-*`（HTTPS+SHA-512 下载、bounded resume、app-owned generations、私有 Node/home、
  无 npm lifecycle；Job Object 绑定子进程）、`windows-job`→win-native/job.rs；删除全部 `.ps1/.cs`。
- parity：discovery, source-scope, sources-models, custom-sources, config-health*（5）, config-manager*（2）,
  agent-inventory, skill-front, agent-setup, antigravity-setup/discovery, agent-install*（5）, windows-job,
  boundaries, release-privacy。
- 出口：`usage:agents:*`/`usage:config:*`/installers 全命令真实可用；UI 源页/Agent 管理页冒烟。

### M5 · quota-engine：额度 V1/V2 + 15 适配器 + 外部连接
- 所有者已定稿 WebView2 UDF 策略。主窗口和托盘浮窗沿用进程级临时 UDF，第三方登录使用物理隔离的目录，暖托盘私有工作集验收仍为 ≤ 35 MiB。
- 每次内嵌网页登录分配独立临时 UDF（`quotadock-login-<uuid>`），同一次登录内支持 OAuth 与 2FA 跳转。仅提取当前站点明确允许的有效凭据，验证并经当前用户 DPAPI 持久化后销毁登录窗口，再限时重试清理目录。取消、关闭和失败也清理本次目录。只有明确验证必须跨次保留会话的供应商才能单列例外，其目录仍与主窗口隔离。
- 已核对 Electron 基线。`provider-website-login.js` 维护站点导航和 Cookie 筛选规则，当前 `ProviderQuotaService.openWebsite` 打开默认浏览器；产品路径没有 Electron 持久会话分区，也不读取默认浏览器的 Cookie。`opencode-console-login.js` 采用外部浏览器设备流，续期依赖凭据库中的 OAuth 上下文。两者均未发现需要跨次保留应用浏览器配置的约束。
- 宿主启动时异步回收过期 UDF，仅限本应用创建并能验证归属的目录，须排除仍持有存活锁的目录和重解析点。所有者已豁免 M4 约 0.99 MiB 的历史测试残留。
- 移植：`service/resource-state/amount`（V2 归一化 1:1，含 workbuddy 分页上限）、`provider-service/catalog/http/
  oauth/website-login/client-login/device-login`、15 适配器逐字段（Cookie 白名单、UA、organization/workspace）、
  `antigravity-*`（Job _owned pinned-image 语义→win-native）、`claude-passive`、`refresh-scheduler/quota-watch`、
  `provider-secret-store`→DPAPI、`connection-state`、`github-service/github-api/github-transport`（device flow）、
  `update-service`→tauri-plugin-updater（beforeInstall=controlled shutdown；draft-only 发布流程不变）。
- 网络作用域：每域独立 reqwest client（cookie jar/代理/超时继承），统计核心仍零网络。
- parity：provider-adapters, provider-login/oauth/client-login/experimental/quota, quota-*（9）,
  connection-state, refresh-concurrency/interval, workbuddy-client/pagination, convenient-login, login-recovery,
  antigravity-quota/passive, claude-passive, github-api/service, update-service/shutdown, signing-profile,
  release-workflow, quota-probe-process, windows-memory-sampler。
- 出口：额度页/连接流程合成全绿；真实账号验收仍按 AGENTS.md 单独授权，不在本迁移自动执行。

### M6 · 瘦身验收与打包切换
#### 所有者决策 · 2026-11-20

- 当前无正式签名身份，先同步迁移分支源码，Tauri 预览版采用 GitHub 分发 NSIS 完整包与 SHA-256 回执，用户手动下载和安装。预览版关闭应用内自动安装入口。正式自动更新仍采用 `tauri-plugin-updater`，要求完整包签名绑定应用版本。预览和正式安装包体积门槛均为 ≤ 15 MiB。
- M6.1 正式打包前核对 Gemini、Cursor 客户端登录与 WorkBuddy 旧桌面会话复用，与 Electron 对齐三轮静默重试。按实际可接入路径验证，逐项保留定向 Rust 测试和黄金比对结果。
- M6.2 正式安装包验收包括隔离的升级／回退流程、运行内存和 125% 视觉对照。
- M6.3 真机实测核对单随 NSIS 包交付。所有者点测真实 GitHub OAuth 与私有库同步、Windows 手动覆盖安装、开机自启注册、系统通知以及真实供应商登录／安装。签名通道单独验收 Windows 静默升级。

#### M6.1 本轮回执

- [x] 宿主层接入 Codex／Provider 的三轮静默刷新策略。旧读数可用且无现有错误时，首两轮的瞬态超时或请求失败保留旧结果，历史记录包含 `quiet`。每次静默等待期间归还调度槽，第三轮仍失败时发布错误并保留最近读数。认证拒绝、限流和手动刷新按原规则即时呈现。Rust 宿主定向 21 项及 Electron 黄金 8 项通过，见 `m6-quiet-rust-final.log` 与 `m6-quiet-electron.log`。
- [x] 生产读取路径测试使用 100,786,176 字节 SQLite 主库、4,239,512 字节未 checkpoint WAL 和 229,376 字节 SHM。宿主开窗采集时以 Windows 文件共享限制拒绝写入，独占 SHM，并占用 SQLite 原生锁区。主库与 WAL 两条记录均与 Electron 黄金逐字段一致。源文件 SHA-256 和修改时间一致。宿主回托盘后可独占打开三份文件，合成目录已清理。
- [x] 修改前诊断。整库内存镜像版读取期间进程树私有工作集峰值 618.48 MiB，私有提交峰值 1,208.24 MiB。关窗后私有工作集 30.80 MiB，采样未见 WebView2。保留 `m6-sqlite-wal.json` 作为对照。
- [x] 所有者授权的 SQLite 修复与复测通过。对源主库和 WAL 流式只读复制，在隔离目录校验并叠加提交帧。SQLite 只读打开副本，页缓存上限 2 MiB，禁用 mmap。真实格式合成库同一场景复测私有工作集峰值 302.92 MiB，暖托盘 29.60 MiB，采样未见 WebView2。私有提交峰值 812.52 MiB，暖托盘 87.86 MiB。单次采集观测为原 444 ms 与新 697 ms，尚无多轮延迟结论。
- [x] 新读取路径的统计与 Electron 黄金一致，源 SHA-256、修改时间和目录清单均一致。文件保护仍拒绝写入、占用 SQLite 源锁区并独占 SHM。暖托盘可重新独占打开源文件，隔离快照残留 0。Rust 专项覆盖有效校验和但未提交的尾帧、页缓存、只读连接及清理。回执 `m6-sqlite-file-test.log`、`m6-sqlite-file-parity.json`。
- [x] 所有者接受三条授权路径差异并放行 M6.2。Gemini 通过已登录的官方 CLI 内 `/stats model` 查询额度，Cursor 在 QuotaDock 中走独立网页登录，WorkBuddy 走独立网页登录或显式 API 凭据。旧客户端会话复用列为产品差异。真实账号登录与额度显示由所有者在 M6.3 点测。
- [x] SQLite 隔离快照改造后，串行 Rust 工作区单元、集成、文档测试合计 2,369 项通过、0 失败、5 项标记忽略，见 `m6-sqlite-final-workspace.log`。同轮 Electron 回归 813／813 通过，见 `m6-1-electron.log`。这些回执位于 `artifacts/memory-gate-20261119/recovery-verification/`。
- [x] 已备好 [M6 真机实测核对单](docs/m2/M6-MANUAL-ACCEPTANCE.md)，正式包路径及最终验收结论等 M6.2 装包后填写。

#### M6.2 手动安装预览与装包门禁

- [x] 备好 Windows 当前用户 NSIS Release 配置和 `scripts/m1/package-tauri-release-windows.ps1`，复用正式 updater 的升级身份和静默安装配置。Release 宿主恢复按自有设置决定生产来源采集，测试继续使用隔离夹具。当前宿主定向测试 21／21 通过，见 `m6-release-host.log`。
- [x] `-ManualPreview` 使用独立的回执目录，关闭 updater 产物与构建时 updater 公钥。常规模式仍要求 `QUOTADOCK_UPDATER_PUBLIC_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY`。现有 GitHub Release 工作流面向 Electron，Tauri 预览包有独立的发布审阅。
- [ ] 构建当前提交的手动安装预览包，记录实际体积和 SHA-256。在发布预览资产前完成装包门禁，保留现有 Electron `v0.1.8` 标签与资产。

- 手动安装预览 NSIS 实测 ≤ 15 MiB（G2），复用前端 bundle 和现有 Release 体积配置。
- 冷托盘 ≤ 15 MiB、读库关窗回托盘 ≤ 35 MiB、开窗峰值 ≤ 500 MiB（G3）。按应用进程树统计私有工作集，另报私有提交量。
- 用真实大体积 SQLite 验证只读隔离复制、手工 WAL overlay、不锁源库和不访问 `shm`，同时核对统计正确性与内存。
- 全量 parity 汇总 + 受影响 UI 套件（WebView2 CDP harness）+ `audit:runtime` 等价 Rust 审计；
  所有者视觉/交互验收后，才谈切换与合并（**合并仍需所有者逐次允许**）。
- 同机同分辨率和同数据对照 Electron 与 Tauri 预览包，逐页及托盘浮窗验证零像素差。留存回执作为后续动效改动的静止态基线。
- 验证 Electron 回退后旧目录及安装身份照常使用，另行验证 Tauri 已安装版本升级后自有账本、偏好与可续期授权恢复。
- 出口：MIGRATION_PLAN 全勾选 + 验收证据行；旧 Electron 入口保留为对照直至所有者下令移除。

#### M6 通过后的交互动效

所有者要求在 M6 装包验收后调整概览卡片拖拽弹簧，并取四段本地视频和账号菜单截图作为参考。以下为参考片段的抽帧观察，由 QuotaDock 自有组件承载对应动效。

| 参考 | 观察与 QuotaDock 验收 |
| --- | --- |
| 卡片拖拽 `As-smooth-as-it-gets` | 卡片保持抓取点，跨列时轻微倾斜，目标占位随排序变化。约 5.20 秒松手，5.40 秒接近静止。单独微调 QuotaDock 的松手归位与邻卡让位节奏，核对跨列、取消及中途改向。 |
| 侧边栏过渡实验 | 约 1.50 秒开始拖动分隔线，2.00–2.20 秒附近收合为图标栏，内容区随宽度迁移。对照拖动、到阈值吸附、标题淡出及反向展开。 |
| 控件动效展示 `DJTpuwUQx6CYmS-G` | 分段选择、开关、复选、下拉、滑块与状态按钮各有独立反馈，3–11 秒可看到多组状态切换。映射到 QuotaDock 已有的对应控件，逐项比对按下、切换、完成三个状态。 |
| 状态胶囊 `D71RLtCH4n0r9bko` | 轮廓光变化和局部模糊衔接图标／文本进出。画面分段展示两端效果，用于参考 QuotaDock 自有状态提示的过渡。 |
| 账号菜单截图 | 核对内外圆角在嵌套边缘的间距、弹层与侧栏底部入口的锚点及半透明背景。截图用于确认静止态几何。 |

实施顺序与每批验收

1. **概览拖拽。** 在同机 125% 及相同窗口尺寸下，用同一指针轨迹采集现版、参考和新方案。先调整 `ui/src/design/motion.ts` 中用于卡片归位的弹簧，验证 `ui/src/kit/sortable.tsx` 的归位和邻卡让位。首版试调为松手后可见归位时间增加约 10–15%，根据录屏收敛。检查短距离、跨列、取消、快速反向与连续拖动，记录握持点偏移、可见归位时长、邻卡首次位移和掉帧。保留键盘排序和减少动态效果行为。
2. **侧栏与账号弹层。** 复用已有侧栏分隔线和账号入口。验证拖宽、阈值吸附、导航文字淡出、点击展开及中途反向，同时检查内容区重排。用截图比对弹层锚点、嵌套圆角与内边距，覆盖亮暗主题、125%／150% 和键盘关闭后的焦点恢复。
3. **控件与状态反馈。** 将参考中的按下、切换与完成动效逐项匹配现有分段控件、开关、下拉和状态提示。重点比对状态变更时机、文本可读性及减少动态效果分支，分别录制正常与快速连续操作。
4. **收口。** 每批使用相同数据和操作脚本录制对照，保留帧截图与差异记录。对照 M6 静止态基线跑受影响页面冒烟，确认拖拽和侧栏变化未增加持续长帧。录屏使用合成数据。

本轮交付计划，UI 源码改动从 M6 预览包验收后单独开始。

---

## 5. 语义 parity 不变量（继承 AGENTS.md，Rust 侧强制）

1. 未知用量/价格 = null，显示 unknown/unpriced；禁填零、禁关冲突保护。
2. 金额 = 十进制字符串（`amount.js` 语义），禁 f64 直算跨池总额；`rust_decimal` 精度门 G5。
3. 快照选择顺序无关：valid>invalid，total 大者优先（即使 partial），再 quality/known；parity 用 snapshot-order 全排列。
4. 源库只读：字节拷贝 + WAL overlay（checksum/commit 边界/512MB 上限/SOURCE_BUSY mtime 校验），不锁源库。
5. 账本原子写 0o600 + quarantine 隔离；zstd 帧与 delta 帧字节级兼容（旧数据可直接读）。
6. 错误码/envelope 白名单 1:1（`safeCode`、config 17 码、inventory ERRORS、GITHUB_*/UPDATE_* 正则）。
7. 隐私边界：不读外部认证文件；DPAPI 仅 app-owned vault；导出仅名字/聚合；session 内容仅打开时读、不落缓存
   （session-labels 的 turn/alias/pinned/group 除外）。
8. 时区/day 边界一次计算复用（RESPONSIVENESS-20261106 语义）；serde camelCase + flatten 承接未知字段。
9. 夹具全合成；`release-privacy` 等价检查拒绝机器路径入 tracked 文件。

## 6. 风险与决策门（需所有者裁决或 M1 内核验）

- **G1 tokscale 许可与 lib API**：**已决（2026-11-17）**：workspace `license = "MIT"`，`tokscale-core` 为 rlib，
  内联合法；AGPL 部分不在 Rust core。pin tag `v4.17.0`（与旧 exe 同语义）。**落地修正（2026-11-17 tokscale slice）**：
  本机 github git 传输/raw/API 均被阻断或限流，git 依赖不可 fetch → 改为 `vendor/tokscale-core` path 依赖，
  源码取自同一 tag（jsdelivr CDN 逐文件获取，随后官方 codeload tarball 全量字节交叉核对 110/110 一致，
  含补齐的 2 个测试夹具 README；归一化 Cargo.toml 的版本来源根 manifest 与官方字节一致），
  语义以 SHA-256 pin 的 exe 4.17.0 十例矩阵逐字节 parity 为准；SHA256SUMS（110 条）随 vendor 提交。
  core 实际依赖 reqwest(rustls+native-tls)/rusqlite/zstd/simd-json/tokio（无 leveldb），体积影响计入 G2。
- **G2 正式 NSIS ≤ 15 MiB**。诊断封装已测 6.45 MiB，正式包以 M6 实测为准。
- **G3 进程树私有工作集**。冷托盘 ≤ 15 MiB，读库关窗回托盘 ≤ 35 MiB，开窗峰值 ≤ 500 MiB。暖托盘达标后进一步压降不阻塞。关窗验收须确认主 WebView2 进程树退出。
- **G4 窗口控制条**：Tauri 无原生 titleBarOverlay；宿主层注入三按钮（§3.4）。视觉需所有者确认（tokens 令牌内）。
- **G5 decimal 精度**：**已决（2026-11-17）**：`amount.js` MAX_INTEGER_DIGITS=36、MAX_SCALE=18，内部 BigInt；
  rust_decimal（96-bit）不足，改用 `num-bigint` 对齐算术 1:1 移植（amount/aligned/format/subtract/compare）。
- **G6 UI 套件 harness**：现 `*-ui-test.js` 走 Electron；M3 建 WebView2 CDP 适配层（Playwright connectOverCDP），
  套件断言不改、只换启动器；无法适配的套件显式登记 deferred，不伪报通过。
- **G7 更新链**：tauri-plugin-updater 的 NSIS 静默安装与「先 shutdown 再安装」语义需合成验收（继承 AUTO-UPDATE 记录方法）；
  无证书现状不变（SmartScreen 警告保留）。
- **G8 性能不回归**：rayon/tokio 替换 worker 后，首读/离开长任务对照旧基线只降不升（所有者 2026-11-05 优先级继承）。

## 7. 进度日志（完成即勾选，附证据）

- [x] Phase 0 勘探与总体规划（2026-11-17，本文件；IPC 全表 §2；未写业务代码）
- [ ] M1 usage-engine（子模块逐项：store/ledger/zstd ☑ snapshot/delta ☑ pricing/projection ☑ Store+sources ☑ sqlite+WAL ☑ workbench ☑ tokscale 内联 ☑ parity 全绿 □）
  - [x] 2026-11-18 · A.1 `cost-table`、共用 JS 数字格式：`cargo test -p usage-engine --test cost_parity cost_table_matches_js` 通过；按 JS 黄金 JSON 逐字节检查模型/Agent、同期空窗口、缺口与范围原因、排序折叠、日序列、CSV 舍入与转义。
  - [x] 2026-11-18 · A.1 `cost-export`：`cost_export_matches_js` 通过；快照唯一数据来源、分组和窗口校验、自定义来源名称、空导出、CSV/文件名与拒绝码均与 JS 比对。
  - [x] 2026-11-18 · A.1 `cost-insights`：`cost_insights_match_js` 与 `subscription_fees_are_validated_and_persisted` 通过；月报、可比窗口、投影、组成、覆盖率、缓存及订阅对比逐字节比对，另以本地合成偏好验证费用拒绝不写入、四舍五入、删除与重启恢复。
  - [x] 2026-11-18 · A.1 `insights-math`：`insights_math_matches_js` 通过；字段记录状态、类别、缓存命中、费用分配、排名折叠、热力图、连续天数、峰值窗口、效率和变化率与旧实现逐字节一致。
  - A.1 验收：`cargo test --locked --offline -p usage-engine` 通过 56 项（原 51 项 + 新增 5 项，含 152 个合成黄金场景）；格式调整和 lint 修复后，`cost_parity` 与 `js_json` 复验 10 项通过。JS 成本表、成本洞察、通用洞察、日序列、成本视图模型和隐私守卫共 23 项通过；隐私规则另覆盖未跟踪的新文件。新增 Rust 文件通过 `rustfmt --check`；全 crate Clippy 仍有历史告警，且原 `tests/js_json.rs` 中的近似常量触发默认拒绝。只验收 Rust 核心逻辑，未切换 Electron/Tauri 或 UI，未使用真实数据。
  - 2026-11-17 · 工具链：rustup stable-x86_64-pc-windows-gnu 1.100（无 MSVC，GNU 先行；M3 若需再补）；
    外部 mingw ld 不认中文路径 → CARGO_TARGET_DIR 固定为用户目录下 ASCII 路径（环境级变量，不入 tracked 文件）。
  - 2026-11-17 · amount/zstd_frame · cargo test 11 绿（期望值由 JS 参考生成）。
  - 2026-11-17 · js_json/statistics_io/store_io · cargo test 12 绿（JSON.stringify 字节级 parity：键序/浮点指数/escape/undefined；
    流式账本读取含 7 字节 chunk 切多字节字符；atomic 失败清理；quarantine/load）。
  - 2026-11-17 · normalize/usage_snapshot/time · cargo test 3 绿（normalize 全字段含 HMAC 与 JS 逐字节一致；
    255 个观察集×全排列顺序无关 parity；UTF-16 canonical 比较）。初败 1：serde_json u64/f64 表示差，改字节级比较后绿。
    snapshot-order 第三测试（scan/ledger 全链路）依赖 sources/Store/pricing，登记 deferred 至对应 slice（2026-11-17 Store+sources slice 已解除并全绿）。
  - 2026-11-17 · agent_catalog/source_registry/local_snapshot/snapshot_codec/snapshot_delta · cargo test 3 绿（29 累计）：
    列式 transport 值 parity + 字节压缩断言（<50%、字典化 <80%）、legacy 向量解码、delta 白名单/行序/删除/null/
    BASE_MISMATCH/非法索引/4096 上限/INVALID_STATISTIC。snapshot-delta 第二测试（宿主 usage-data.js vm）deferred 至 M3。
  - 决策 G9（2026-11-17）：delta 行身份 JS 用 WeakMap 对象引用；Rust Value 无身份，暂以结构相等代替
    （被引用行值相等，恢复精确性不受影响）；projection slice 落地时改 Rc 行引用以恢复字节级 delta parity。
  - 2026-11-17 · pricing/aggregate/usage_math/usage_projection(+incremental)/runtime_catalog/valuation ·
    cargo test -p usage-engine 全绿（38：旧 29 + pricing 3 + usage_math 3 + projection 7，含 5 时区×3 序
    单小时共享累加器、增量=全量 5 修订+隐藏重复、增量回退 5 场景、22 例 evaluate 矩阵/校验/下界、
    batched curves 全移植、disjointMix 参考值）。初败 3 并修复：
    ① serde_json 默认浮点解析非正确舍入（长十进制差 1 ulp）→ 启用 float_roundtrip feature（全 crate 受益）；
    ② disjoint_mix 的 has_null/all 累加顺序 [u,o,re,cr,cw] 与显示索引 [u,o,cr,cw,re] 错位 → 改顺序；
    ③ 测试 assert_eq! 区分 u64/f64 → 改 js_json stringify 比较。pricing-expected fixture 恢复 JS 原始字节
    （曾被 serde 重序列化丢失 0.00037600000000000003 尾数）。
    G9 现状：projection/incremental 已落地但仍用结构相等行身份；Rc 行引用（字节级 delta parity）仍 deferred。
    runtime_catalog 内嵌 models-dev-prices.json（8056 模型）+ 远端校验/合并/离线回退已移植，真实网络拉取属 M5。
  - 2026-11-17 · Store + sources slice · cargo test -p usage-engine 48 全绿（新增 sources 3 + store_chain 7）：
    pathx/policy/sessions/session_aggregate/source_scope/ledger_view/operation_metrics/model_aliases/pricing_labels/
    workbench(settings/request/range/budget/summary)/sqlite_memory/jsonl_adapter/extended_sources/antigravity/
    batch1_sources/batch1_extra/sources/store 全量移植。证据：
    ① snapshot-order 第三测试（scan/ledger 全链路）解除 deferred：7 观察×配对/三元组×全排列×3 文件拆分×逐次扫描+重启，
    与参考规则逐字节一致（含冲突不计价、partial 下限、首归属 opencode）；
    ② 22 例解析器矩阵（codex 累计/fork/claude/workbuddy/opencode/gemini/cursor SDK+CSV/deepseek v2/zcode/pi/cline IDE+CLI/
    copilot state+intervals+otel/qwen/kilo/kimi 三布局/continue）期望值由 JS 参考生成；
    ③ WAL 覆盖读取 committed 页、坏头/坏页/坏校验和拒绝；启动隔离损坏账本+重启无新隔离；重复扫描不重写不跳号；
    自定义源 validSaved/definition；policy 拒绝 auth/UNC/相对路径、只列允许文件。
    初败 4 并修复：regex 不支持 \0 转义→\x00；kimi 按 path.sep 字面切分（Windows 反斜杠）而非双分隔符；
    WAL 快照头部 18/19 字节仍为 WAL 模式导致 SQLite 找 -wal 文件→置回 rollback 模式（只读一致快照）；
    测试 assert_eq! u64/f64 差→as_f64 比较。
    实现要点：rusqlite bundled+serialize，sqlite3_malloc 拷贝镜像后 deserialize（不打开源库）；
    GetFileInformationByHandle 取 NTFS file index 对齐 stat.ino；Store 草稿=克隆+staging 写入队列，
    prepare/commit 两段事务与 JS Object.create 草稿语义一致；digest 排除 lastAttempt/lastSuccess/durationMs。
    deferred 登记：workbench build/change/csv 与 Store.workbench/saveWorkbench 属 workbench slice；
    sessionList/sessionListPacked/transcript*/search/agentUse/fileHistory 属 M2；
    shareSavedStrings 为 V8 字符串驻留优化，无可观测行为，Rust 不移植；G9 行身份仍为结构相等。
  - 2026-11-17 · workbench slice · cargo test -p usage-engine 49 全绿（新增 workbench 1 个集成测试，内含
    14 视图 + 2 CSV + 5 错误码 + 重启持久化 + range/budget/settings/request/collation 单元用例）：
    workbench build/change/csv 全量移植（项目归因/重名标签/未知项目、预算期并集、scope-missing、
    issue 指纹与 acknowledged、500 上限与 omittedIssues、sourceRows 语义/格式/known 覆盖、CSV BOM/公式注入防护/12 位有效数字）；
    Store.workbench/saveWorkbench 接线（8 视图缓存、snapshot/settings/scope 失效、reprice/commit 清缓存、
    WORKBENCH_SCOPE_INVALID 回退 all 概览）。证据：运行时 fixture 生成器
    crates/usage-engine/tests/fixtures/workbench-gen.cjs（视图依赖真实当日，Rust 测试同轮调用 node 生成 JS 参考；
    合成 home：codex 7 会话含重名/无 cwd/未定价/partial/40 天前记录 + claude + mapped 自定义源；
    固定 salt 种子 statistics.json 使项目 id/issue id 可比；sourceRows[].lastSuccess 两侧掩码为各自 ingest 时钟）。
    初败 3 并修复：① JS localeCompare 为系统 locale（zh-CN）ICU 排序，CJK 先于 Latin、重音/大小写有别于字节序
    → 新增 collate 模块（icu_collator compiled_data + sys-locale，thread_local CollatorBorrowed），
    workbench 三处排序与 model_aliases target 排序改用之，collation 探针与 JS 逐对一致；
    ② JS projectOptions 与 options 共享对象引用，label 原地写入 → Rust 克隆后回写 options；
    ③ node 主模块路径不认 canonicalize 的 \\?\ 前缀 → 测试剥前缀。
    其余已移植模块的 localeCompare 位点（投影日期/增量小时/copilot 快照时间+id）均为 ASCII 日期/十六进制 id，
    ICU 与字节序等价；cost-*/insights/session 列表的 localeCompare 在各自 slice 统一走 collate。
    workbench build/change/csv 的 deferred 登记自此解除。
  - 2026-11-17 · tokscale 内联 slice · cargo test -p usage-engine 51 全绿（新增 native 2）：
    `native.rs` 以 vendored tokscale-core 的 `get_model_report`（ pinned CLI `--json --client claude --home`
    的同一路径）替换 tokscale.exe 子进程；canonical statistics-only transcript、`totalTokens >= 0` 资格规则
    （null 视为 0 仍计入）、schema/total 校验与 {status,records,tokens,engine} 结果与 native.js 逐字节一致。
    证据：tests/fixtures/native-expected.json 由 SHA-256 pin 的 exe 4.17.0 在 10 组合成输入上生成
    （含 JS native-binary 测试的 401 记录/120754 字节/sha 常量、max-safe 整数、重复 uuid 去重导致
    NATIVE_TOTAL_MISMATCH 的负例、空输入、null/缺失/负数/非数字排除、unicode/非字符串 id）；
    Rust 侧 wire 字节 sha256 与 exe 结果逐例一致，重复检查同父目录各得新鲜缓存根，env 覆盖用后还原。
    边界：子进程密闭 env 的进程内等价 = 每次调用临时设置 TOKSCALE_CONFIG_DIR（run 目录）/
    TOKSCALE_PRICING_CACHE_ONLY=1（永不网络取价）/HOME（合成 home，paths::home_dir 优先读它，
    封住 claude 解析器 cc-mirror 对真实用户目录的读取）；use_env_roots=false + clients=["claude"]
    使其余 roots 全部落在合成 home；逐点核过 core 内 dirs::/paths::home_dir 调用（其余均门控或仅测试）。
    随子进程退役的错误码：NATIVE_BINARY_MISMATCH/NATIVE_UNAVAILABLE（二进制字节意义，pin 改为 vendored 源码）、
    NATIVE_OUTPUT_LIMIT（无 stdout 通道）；NATIVE_TIMEOUT 覆盖异步取价段，同步解析不可抢占，
    由 M3 宿主采集看门狗兜底（登记）。store.rs 两处 parserVersion 改引用 native::TOKSCALE_VERSION。
    获取与核验：github git/raw/API 在本机被阻断或限流（schannel/openssl EOF、403），codeload 连接约 12MB 被重置；
    可行路线 = fastly.jsdelivr.net 逐文件（110 文件）+ data.jsdelivr.com 官方尺寸元数据核对（108/110 一致，
    lib.rs 曾截断→按尺寸补齐）；2 个测试夹具 README（jsdelivr 对 .md 重定向到被阻断的 raw）暂排除。
    **交叉核对已闭合（同日）**：官方 codeload tarball（20,696,542 字节，
    sha256 eaa5269091d8365df27de342029d586a1bb3806b20575077cc0b2bf039b57ebc）下载完成，
    Python tarfile 解包（Git Bash tar 对该归档误报 EOF，gzip 流完整 32,317,440 字节）逐文件比对：
    107 个共有文件 0 差异，2 个 README 自官方补齐，LICENSE 一致，归一化所用根 Cargo.toml 与官方字节一致；
    SHA256SUMS 重生成 110 条，cargo test 51 复跑全绿。vendor/tokscale-core：
    源码字节不动，Cargo.toml 仅把 workspace 继承解析为 tag 根 manifest 的具体版本（cargo 发布同款归一化），
    LICENSE（MIT © Junho Yeo）与 SHA256SUMS（110 条）随附。依赖经 rsproxy.cn sparse 镜像 fetch
    （cargo 自带 libcurl 下载在本机超时，curl.exe 直连 static.crates.io 正常；镜像配置在环境级
    CARGO_HOME scratch 目录，不入 tracked 文件，Cargo.lock 源 URL 仍为 canonical crates.io）。
    初败 2 并修复：fixture JSON 往返把 NaN 变 null（null 计入而 NaN 不计）→ 生成器改用字符串 "NaN"
    （两侧同样跳过）；HOME 还原断言误设 None（Git Bash 本身导出 HOME）→ 改为与调用前值比较。
- [ ] M2 session-reader（sessions □ transcript 族 □ search/file-history □ labels/导出 □ parity □）
  - [x] 2026-11-18 · A.2 `session-list` 白名单：`session_list_whitelist_matches_js` 通过；保留零值、未知字段、审核过的自定义来源与按日分组，过滤恢复命令和非白名单字段。
  - [x] 2026-11-18 · A.2 `session-list-codec`：`packed_session_lists_match_js_wire_and_validation` 通过；对象和逐行输入生成相同的 SessionListBytesV1 字节，损坏索引、行宽和尾部无效数据不产生半份列表。二进制 IPC 接线留给宿主。
  - [x] 2026-11-18 · A.2 `session-labels`：`labels_match_js_persistence_and_rejections` 通过；只写应用自己的标签文件，支持清除标签和恢复阅读位置，忽略旧归档标志，拒绝无效更新且保持原字节。
  - [x] 2026-11-18 · A.2 `transcript-lines`：合成 JSONL 的逐行输出与 JS 一致；验证跨块 UTF-8、无结尾换行、损坏行和 JSON null、索引反向直读，以及替换、追加、过大和非普通文件拒绝。每次读取只保留缓冲块及当前行，不持久化索引。
  - [x] 2026-11-18 · A.2 `transcript-changes`：`recorded_file_changes_match_js` 通过；从记录提取多文件补丁、移动、工具编辑及 Antigravity 变更，含长差异降级，不执行工具或写入源文件。
  - [x] 2026-11-18 · A.2 `transcript-continuation`：`transcript_prefix_checkpoints_match_js` 通过；按 64 项 SHA-256 检查点逐字节比对、多字节长文本 UTF-16LE、追加、重写、缩短和无效证明。与 Rust JSON DTO 相同，仅可表示有效 Unicode 字符串；JS 专有的孤立代理项用例尚未对齐。
  - [x] 2026-11-18 · A.2 `transcript-marks`：`transcript_marks_match_js` 通过；识别注入上下文、图片占位、附件、问答、斜杠命令、引用与 code-mode 字面参数；只提取记录，不运行代码。
  - [x] 2026-11-18 · A.2 账本会话投影：`saved_session_projection_and_packed_bytes_match_js` 通过；仅借用账本事实，逐会话发送，不打开对话。覆盖范围、近期每 Agent 五条、去重、无归属用量和仅有元数据的 Continue。
  - [x] 2026-11-18 · A.2 `transcript-tasks` 请求调度：沿用宿主阻塞执行器，单请求占用直到工作实际退出；测试覆盖超时后不重叠、拒绝关闭后工作与退出等待。未接入 Electron；所有使用方需在流式读取的有界步骤检查取消。
  - A.2 本轮验收（合成、源码层）：`cargo test --locked --offline -p usage-engine` 66 项通过，新增 10 项覆盖 150 个 JS 黄金场景及文件代际、调度与关闭测试；相关 JS 回归 49 项通过。新增 Rust 文件通过格式检查；定向 Clippy 和 Rustdoc 通过，Clippy 仍报告既有 26 项库告警。隐私规则另覆盖未跟踪的新文件。未读真实会话，未测应用常驻内存。
  - [x] 2026-11-18 · A.2 `transcript.js` Codex / Claude 子集：索引仅保存偏移、标记与有界元数据，按需回读正文；预览、单会话查找、正文/图片/工具结果分页、facts、Markdown、Claude 子代理及事件回退已通过合成 JS 比对，支持前缀续传、拒绝旧 stamp。
  - [x] 2026-11-18 · A.2 Rust 账本接线：只接受保存在账本中的哈希会话键，使用已选来源根；脱离账本后交给无专用线程的读取队列。合成用例验证隔离未批准来源，以及 32 MiB 合并回复只出 1,200 字符预览、按偏移取得尾页；这不是 RSS 实测。
  - Codex / Claude 本轮验收：`cargo test --locked --offline -p usage-engine` 70 项通过（新增 `transcript_index` 4 项），受影响 JS 套件 65 项通过，格式检查和含未跟踪文件的隐私守卫通过。偏移索引每次请求重建，未做跨请求缓存；合法 Unicode 参与黄金比对，落在代理对中间的旧 JS 分页行为未对齐。未读取真实会话，未切换 UI/IPC 或运行应用级内存验收。
  - [x] 2026-11-18 · A.2 跨会话搜索、文件历史和 MCP/Skill 活动：19 组合成 JS 黄金比对通过，覆盖 Codex、Claude Code、Copilot CLI、WorkBuddy、Cursor。请求内建立文件索引，逐会话处理；保留摘要、失败编辑排除、原始路径、本目录/其他工作树匹配、已耗预算后仍推进一个候选。没有持久文本索引。
  - [x] 2026-11-18 · A.2 扫描账本接线：7 组合成 JS 黄金比对通过。仅从已存会话元数据生成候选、按更新时间排队，保留 Agent 过滤、排除当前会话、偏移、计数和下一页游标；请求不携带可执行命令或可读文件路径。
  - [x] 2026-11-18 · A.2 `transcript-more.js` 的 Copilot CLI、WorkBuddy、Cursor：复用偏移索引和原来源白名单；黄金用例覆盖 Copilot 调用去重、详细结果/错误、WorkBuddy 文件头回退、Cursor 子代理与非白名单拒绝。仅合成格式验收。
  - 本轮验收：Rust 全量 71 项通过；Clippy 调整后两个受影响套件共 15 项复验通过。相关 JS 43 项通过；格式、含未跟踪文件的隐私守卫和定向 Clippy 通过（仅既有告警）。沿用旧版搜索对 `range` 只校验、不筛选候选的行为。未读取真实会话、修改 UI/IPC 或实测应用内存。
  - [x] 2026-11-18 · A.2 SQLite/旧布局：OpenCode、MiMo、ZCode、Kilo 覆盖两类 SQLite 表、子会话及相容旧目录。参数绑定按会话取数；只读快照合并已提交 WAL，跨会话扫描同批复用数据库快照。合成 WAL 测试通过且变化后拒绝旧 stamp。
  - [x] 2026-11-18 · A.2 其余文件来源：Cline / Kilo / Continue 的 JSON，Gemini 的文档和行日志，Pi、Qwen、Kimi CLI、DeepSeek Harness、Antigravity。覆盖 Gemini 重写/回退、Pi/Qwen 分支、Kimi 参数分片、Antigravity 步骤修订和调用配对、DeepSeek 世代及多帧压缩；JSONL 请求只保存必要的偏移和关联索引。18 组 JS 存储黄金夹具通过，覆盖预览、分页、查找、摘要、Markdown、stamp 和扫库。
  - A.2 格式验收：Rust 全量 74 项通过，最后的旧目录链接保护调整后阅读器与 zstd 套件 15 项复验通过；相关 JS 81 项通过。新增模块格式检查、定向 Clippy、Rustdoc、含新文件的隐私守卫通过。普通 JSON 文档和 SQLite 快照均为请求级；压缩 JSONL 在必要时从帧流重放，不写解压临时文件；本次没有测量真实应用 RAM。
  - [ ] A.2 后续验收：Codex、Claude Code 真会话已通过 Tauri 阅读器；其余来源的应用级真数据验证还未运行。JS 孤立 UTF-16 代理项边界未对齐；Kimi Code 无公开正文结构时沿用旧版不支持。
- [ ] M3 宿主+bridges 切换（window/tray/lifecycle □ bridges.ts □ 控制条 □ M1/M2 接线 □ 三页冒烟 □ 托盘内存首测 □）
  - [x] 2026-11-19 · Windows 阅读器宿主切片：复用现有 1480 × 960 界面。独立 Vite 构建启用 Tauri `invoke` 和 `listen`，接通用量快照、会话列表和标签、预览、分段、查找、跟读 stamp、摘要、跨会话搜索及文件历史。常规 Electron 构建的 5 项 bundle 校验通过，包括字节一致性。默认真数据读取关闭，须显式提供 `--real-sources codex,claude`。IPC 使用原 DTO 的 JSON；二进制 IPC、正式托盘浮窗、管理与配额 IPC、导出/剪贴板和整应用切换仍待迁移。
  - [x] 2026-11-19 · 窗口生命周期：关闭销毁主 WebView2 并释放内存账本，原生托盘复用重建入口。自动验收以测试进程输入调用同一重建入口，未手工点击系统托盘图标。WebView2 使用 128 MB JS 堆上限与独立用户数据目录，验收省略禁用 SmartScreen 的启动参数。
- [x] M4 source-admin+win-native（discovery/custom ✓ config-health/manager ✓ inventory/skill ✓ install 引擎 ✓ DPAPI/Job ✓ 合成 parity ✓）
- [ ] M5 quota-engine（V1/V2 □ 15 适配器 □ 登录族 □ scheduler/watch □ github □ update □ parity □）
  - [x] Windows DPAPI 原语与凭据格式：仅当前用户可解密，解密缓冲释放前清零，解密用途绑定；凭据按路由规范化。合成测试覆盖错误用途和无效输入。
  - [x] 额度 V1/V2 数据契约：Codex CLI 响应、旧 V1 缓存恢复、资源字段和单项新鲜度均已与 Electron 比对；保留未知值、过期与不同余额口径。
  - [x] 15 个 Provider 适配器、17 条路由：现有 `provider-adapter-parity.json` 逐字节一致。固定 HTTP 请求与 Electron 比对；回环测试验证拒绝重定向、错误状态、取消及响应体限制。已接入 Claude 组织、OpenCode 工作区、Gemini 项目发现、MiMo 附加请求和 WorkBuddy 有界分页，合成测试通过。回环和注入式传输为本阶段唯一网络验证。
  - [x] Antigravity 结构化输出投影：官方 CLI 的 JSON／NDJSON 与被动状态栏响应通过 Electron 比对。验证允许的版本、无模型调用证明、分组哈希、未知字段和无效观察拒绝。CLI 探测／执行及被动导入接线待完成。
  - [x] 连接状态、并发调度和配额提醒引擎：覆盖独立 Provider/CLI/key 上限、任务取消、只在已验证观测间去重、V2 覆盖计数、低量／即将重置／恢复提醒及跨重启去重。账户匹配仅保存在进程内，透出状态和重复账户 ID。
  - [ ] 应用额度服务：账户配置与旧凭据库兼容、登录和续期、服务级发布与取消竞态、后台刷新接线、Antigravity CLI 执行／被动导入、通知派发、GitHub 和更新仍待完成。
- [ ] M6 验收（体积实测 □ 托盘内存实测 □ 全量 parity □ UI 套件 □ 所有者验收 □ 合并许可 □）

### 2026-11-19 · Codex / Claude Code 真会话应用验收

- 旧 Electron 交互基线使用 `validate:local -- --performance --reader-only --sources codex,claude`。两条 Claude 会话首次内容分别在 695.6 ms、575.9 ms 出现，运行全程符合桌面焦点资格；该命令未采内存。
- Tauri 初轮 Debug 三窗格、返回列表的全树私有工作集峰值分别为 662.54、701.90 MiB；退出探测没有确认进程树销毁。第一轮 Release 确认页面销毁与重建，记录过 38.08 MiB 托盘驻留，仍有辅助进程和 WebView2 临时目录清理问题。随后改为等待重建的主窗口关闭后再退出，同时核验新运行的隔离目录清理。
- 最终 Release 复测 `artifacts/tauri-reader-acceptance/tauri-release-confirmed.json` 完整通过采样资格、三条真会话渲染、关闭与重建后再读、退出清理；无页面或宿主错误。两条 Claude 的统计记录数为 1,683 / 1,560，Codex 为 810。单窗格峰值为 441.94 MiB 私有工作集 / 799.92 MiB 私有提交量，三窗格为 590.15 / 1,068.36 MiB，返回列表为 616.81 / 1,010.87 MiB。确认 WebView2 退出后，托盘进程树只剩 Rust 宿主，峰值为 52.90 / 150.59 MiB。相邻一轮托盘工作集为 52.49 MiB。**G3 15 MB 与开窗 500 MiB 均未达标**。早期失败轮遗留的 WebView2 临时目录未通过自动审批删除，检查时已无统计账本。
- 复现入口为 `node scripts/m1/stage-tauri-reader.js`、`cargo build --locked --release -p quotadock-desktop`、`node scripts/m1/measure-tauri-reader.js <exe> <report.json> --real-sources codex,claude`。使用系统 125% DPI 和常规窗口尺寸，复用 Windows PDH 100 ms 采样，分别统计进程树私有工作集与提交量。会话按统计记录数选样；三窗格含两条 Claude 和一条 Codex。只输出数字、来源名称和状态，验收不保存正文或打印原始会话标识、来源路径。
- 自动检查包括 `cargo test --locked --offline -p usage-engine -p quotadock-desktop`（usage-engine 74 项通过）、最终宿主的 Rustfmt 和 Clippy、`npm run typecheck:ui`、新增脚本 ESLint 与前端 bundle 校验。首次 `--workspace --offline` 未运行 vendored 核心的测试，缺少其测试依赖 `futures-executor`。

### 2026-11-19 · Electron / Tauri 安装包逐像素复验

- [x] 从当前基准提交重新构建 Electron 0.1.8 NSIS，并多轮构建 Tauri Release NSIS。运行从安装包解出的应用和自带资源，在同一台 Windows 上以 125% 缩放、1480 × 960 CSS 像素采集六个主页面的浅色、深色、空状态与合成数据，另采两种主题的会话正文。原生整窗由同一 DWM 边界采集路径获得，逐像素比对保留全部 RGB 通道且无掩码。
- [x] 修复 Tauri 宿主缺少 `windowBridge` 导致的 44 像素标题栏和右侧概要布局降级，接入窗口主题、最大化、还原、拖动与原生命令。接通所选来源的元数据检查、项目和诊断摘要、计价只读 IPC，并使用与 Electron 一致的启动加载状态。Electron 前端 bundle 字节一致，页面组件不变。
- [ ] 零差异验收。原生窗口和内容截图均须按零变化像素判断，截图中真实连接账号、自定义小组件排列、配置和安装弹窗、托盘浮窗尚有迁移或覆盖缺口。视觉复验只用隔离合成数据，安装包采用提取方式启动，不改现有安装。
- 最后一轮在 `visual-diff-empty`、`visual-diff-populated`、`visual-native-diff-empty`、`visual-native-diff-populated` 各有完整结果。内容 **0/26**、原生整窗 **0/26** 零差异，同图自比 **12/12**。浅色空状态概览内容差异从 1,463,446 降到 62,649 像素；带数据的浅色 Agent 管理在接通项目和诊断摘要后从 682,886 降到 11,570 像素。Windows 截图中 Electron 运行 Chromium 150，Tauri 运行 WebView2 157。
- 受影响的 Rust 来源检查和工作台黄金测试、最终宿主编译、TypeScript、ESLint、Electron 原 bundle 5 项和 `git diff --check` 通过。最大化与还原在 Tauri 包上实际调用并确认状态。早期截图轮出现 WebView2 临时合成配置未清理；最终截图方案将比较和清理分开记录。
- 复验入口：`node scripts/m1/desktop-pixel-parity.js <electron|tauri> <exe> <output> 1.25 <empty|populated>`，通过 `DESKTOP_PIXEL_CAPTURE_NATIVE=1` 采集整窗。比较使用 `compare-desktop-pixels.py <reference> <candidate> <output> [--native]`。输出位于 `artifacts/desktop-pixel-parity`。

### 2026-11-19 · 来源和会话 IPC，配额数据路径

- M2/M3 · 接通会话摘要、统计／费用／工作台／会话导出、剪贴板及受限链接，接通并验证来源状态保存、选择路径边界及 V1/V2 只读连接投影。隔离 WebView2 验证会话摘要、V2 连接、无观测时返回未知、路径和链接策略、来源写入和原生导出取消。最初两种 UI Automation 定位未匹配保存窗口，改用仅作用于测试 PID 和固定窗口标题的 Win32 匹配后，取消返回 `{ canceled: true }`，临时目录已清理。保存文件的原子替换由宿主单元测试验证。
- M4 · 来源基础管理和采集诊断已接入，配置健康／管理、清单与安装器以及 Windows Job Object 仍待迁移。DPAPI 原语测试限合成数据，Electron 凭据库兼容需单独验证。
- M5 · 配额 HTTP 与观测流程已可组合。数值型金额在解析时保存原始字面量，`9007199254740993.125` 的余额保留原精度；资源观察时间与剩余口径不推断，同账户的不同限制独立判断新鲜度。固定 HTTP 端点、凭据与作用域只在 Rust 层使用。Tauri 已接只读连接投影，尚未接入真实 Provider 服务和登录。
- 验证 · `cargo test --locked --offline -p quota-engine -p quotadock-desktop` 21 项通过（含宿主 2 项）；相关 Electron JS 55 项通过，含现有 UI bundle 字节校验 5 项。TypeScript、定向 Clippy、变更文件 Rustfmt 和 `git diff --check` 通过，Clippy 仍报告 `usage-engine` 的既有告警。
- 本轮使用既有 Electron 黄金夹具、Electron JS 实时参考和合成 WebView2。安装包逐像素差异和真实应用内存沿用上节最后一轮记录，待服务与托盘接线完成后复验。

### 2026-11-19 · 暂停点与架构复核

**历史审阅快照。** 当时暂停推进以确认架构。以下保留原有证据，现行决议见后文。

| 范围 | 快照状态 |
|---|---|
| 账户与凭据 | Rust 账户库将快照和加密凭据在单次原子写入中提交。用户确认后从选定的 Electron 数据目录复制导入并按 ID 去重。原版 Electron 生成的合成 V1/V2 密文均通过导入、DPAPI 重封及重启恢复。 |
| 读取与刷新 | 手动凭据、读取、取消、移除、批量和分钟调度已接 Tauri。应用自有授权续期与账户变化拒绝已接入。官方 CLI／网站／设备登录和被动观测待接入，真实休眠唤醒、短暂故障静默重试和读取历史仍待比对。 |
| 进程与托盘 | Windows 原生 Job 对象已通过执行文件替换拒绝和实际父子进程回收测试。标准流捕获、交互式登录和安装器接线待做。托盘卡片复用原资源，打开、受限读状态、关闭、回主窗口经隔离 WebView2 检查。完整桌面偏好、通知和实际系统托盘点击待验。 |
| 完整切换 | 配置健康／管理、安装器、GitHub、更新及 packed IPC 仍有缺口。这一轮未打正式包或重测内存和像素差。此前的零像素差、托盘 15 MB 和开窗 500 MiB 仍是验收门。 |

验证记录：quota-engine 和宿主 29 项常规 Rust 测试通过，另显式执行原版 Electron 合成凭据兼容测试 1 项并通过。相关 Electron 回归 35 项通过，包含前端 bundle 字节校验。TypeScript、Tauri Debug 构建及 8 项合成 WebView2 冒烟通过，托盘用测试入口打开。仅使用合成账户、隔离目录或本机传输，未读取正式安装资料。

### 2026-11-19 · 所有者定稿与验收口径

- **定稿为单进程 Rust 宿主（Tauri v2），放弃拆进程备选。** 冷托盘私有工作集为 3.42 MiB，Electron 隐藏启动为 247.18 MiB。读库回托盘为 33.86 MiB，Electron 为 299.56 MiB，后者约为前者的 8.85 倍。空窗关窗仍有 22.22 MiB，体现含 WebView2 客户端与 COM 初始化在内的固定成本，未单独量测 COM 份额。为此重做 M5 的 13 条登录族 IPC 跨进程接线不划算。
- **用户侧整应用一次性切换。** 内部按 M4 → M5 → M6 逐项测试、黄金比对和打包，保留 Electron 对照。
- Tauri 使用独立目录。经用户在菜单确认后复制导入并重封凭据，失败账户标记需重新登录。Electron 原目录和回退路径隔离。

| 验收项 | 目标 | 同机证据 |
|---|---:|---|
| 冷启动直进托盘，私有工作集 | ≤ 15 MiB | 3.42 MiB，合成基线达标 |
| 读库关窗回托盘，私有工作集 | ≤ 35 MiB | 33.86 MiB，合成基线达标。进一步压降不阻塞 |
| 开窗峰值，私有工作集 | ≤ 500 MiB | 三窗格 370.86 MiB，返回列表 391.46 MiB，均达标。WebView2 GPU 动效放大瞬态峰值，8 秒回落至 348.95 MiB。本项不修改 `bridges.ts` 或页面组件 |
| 正式 NSIS 安装包 | ≤ 15 MiB | 诊断封装 6.45 MiB，Electron 公开包 121.53 MiB。正式 Tauri NSIS 待 M6 实测 |

| 范围 | 导入规则 |
|---|---|
| 通用偏好、展示设置 | 可继承。校验已知字段和取值，再写入 Tauri 独立目录。 |
| 历史账本、统计、历史额度 | 可继承。按版本校验、前置备份和去重，保留未知、缺失、旧读数和未定价语义。 |
| 已验证可重封的凭据 | 可继承。限用户确认、当前 Windows 用户及已核对格式，成功后在独立目录 DPAPI 重封。失败保留历史，标记需重登。 |
| 网页 Cookie 登录态 | 必须重建。旧库兼容测试证明可解密的合成旧记录，用于验证格式。正式导入需排除网页登录态，当前原型的 Cookie 恢复路径待 M5 接线时收紧。 |
| 设备流运行时授权 | 必须重建。重新发起本次授权，禁止沿用旧的待登录或进行中的运行时状态。 |
| 更新与安装身份 | 必须重建。单独验证 Tauri 安装、更新签名及升级，旧 Electron 路径保留供回退。 |

#### 内存门禁 · `737737c` / `458a57f`

Windows 原生 125%，Tauri 客户区 1480 × 960 CSS px。PDH 每 100 ms 记录同一时刻的完整进程树，分别使用 `Working Set`、`Working Set - Private` 与 `Private Bytes`。普通工作集的树合计包含多进程共享页的重复计数。托盘表取末次有效样本，浏览表取各阶段整树私有工作集峰值。测试使用隔离目录和三份合成 Codex／Claude JSONL（810、1,683、1,560 轮，14,111,722 字节，SHA-256 `1d2ee6701766a50ab518b907dd4a6fcf7e833e90e4c8716827efab6d042d376c`），记录只含数值、PID 及进程角色。

| Tauri 托盘样本 | PID | 进程 | Working Set | Private Working Set | Private Commit |
|---|---:|---|---:|---:|---:|
| 同脚本对照轮，默认冷启动 | 18788 | quotadock-desktop | 15.29 | 3.42 | 10.57 |
| 同脚本对照轮，默认读库后关窗 | 18788 | quotadock-desktop | 65.98 | 33.86 | 115.86 |
| 首轮默认读库后关窗 | 3184 | quotadock-desktop | 65.73 | 33.61 | 109.08 |
| 空数据关窗对照 | 20900 | quotadock-desktop | 53.75 | 22.22 | 65.36 |
| `MIMALLOC_PURGE_DELAY=0`，读库后关窗 | 24600 | quotadock-desktop | 64.54 | 32.41 | 95.26 |
| 关闭动效，读库后关窗 | 10628 | quotadock-desktop | 64.15 | 31.98 | 101.96 |

单位均为 MiB。各行只有一个进程。冷启动探针确认主窗、WebView2 profile、账本 `Store` 均未创建，读调用为 0。关窗等待 WebView2 整树退出及 `Store` 释放。此前实测 150.59 MiB 私有提交量所在阶段也只有 Rust 宿主。两轮默认读库后的 mimalloc 提交页分别为 102.31／109.08 MiB 和 109.13／115.86 MiB（后者分别是各轮进程私有提交总量）。空目录开窗关窗仍留 65.36 MiB 私有提交量，mimalloc 占 58.38 MiB。仅对本轮进程启用立即归还空闲页后，读库后私有提交量降至 95.26 MiB，私有工作集降至 32.41 MiB，仍高于当时的暖托盘 15 MiB 门槛。

首轮 `VirtualQueryEx` 记录读库后私有映射区约 106.22 MiB、映射文件区约 10.75 MiB。映射区统计与进程私有提交量的口径不同。mimalloc 提交统计包含仍被对象占用的页和分配器保留的页，历史 150.59 MiB 缺少堆级记录，无法分配到具体对象。源码显示 `Store::new` 初始化、合并和散列价格目录，内嵌 JSON 还有进程级 `OnceLock`。本轮未量出价格表独占份额。工作负载只读 JSONL，SQLite 整库复制及 WAL overlay 未走到，临时文件换底座未执行。

| Tauri 私有工作集峰值的同刻归因 | 单窗格 | 三窗格 | 返回列表 |
|---|---:|---:|---:|
| 整树 | 321.95 | 370.86 | 391.46 |
| Rust 宿主 PID 18788 | 65.45 | 67.38 | 67.40 |
| WebView2 renderer PID 18792 | 112.77 | 147.86 | 152.32 |
| WebView2 GPU PID 36820 | 96.67 | 109.91 | 125.65 |

同脚本对照轮返回列表整树增加 20.60 MiB，其中 GPU 增加 15.74 MiB、renderer 增加 4.45 MiB、Rust 宿主增加 0.02 MiB。首轮和立即归还空闲页对照都重现反涨，整树增加 18.12 和 21.25 MiB，GPU 增加 18.72 和 17.30 MiB。合成配置走正常动效设置切到 `off` 后，三窗格／返回列表为 356.79／360.80 MiB，差值 4.01 MiB，GPU 差值 5.10 MiB。该对照覆盖整条路径，支持动效放大涨幅，未定位到单个合成层。

同脚本轮返回列表后 Rust 计数 `[get, refresh, sessions, preview, part, facts]` 保持 `[2, 1, 4, 3, 0, 0]`。阅读器窗格归零，供阅读器使用的全量会话列表引用从 3 行变为 null，页面连接元素 9,666 → 2,028。CDP 的 DOM 节点 12,334 → 12,723 → 7,827，JS 堆使用 27.54 → 25.97 → 24.31 MiB，detached 根 10 → 12 → 12（对应三窗格、返回、再静置 8 秒）。该时窗不能确证或排除长期 DOM 保留。静置后整树私有工作集 348.95 MiB，私有提交量 706.16 MiB。历史实数 590.15 → 616.81 MiB 对应宿主阶段私有峰值 150.76 → 141.49 MiB，旧报告缺少峰值同刻进程角色及堆数据，历史 GPU 和对象级份额仍未证实。

可在宿主细化关窗后的价格目录所有权、分配线程生命周期和必要缓存释放，继续用空目录对照测增量。实测反涨期间没有新增这些 IPC，当前没有 `bridges.ts` 改动依据。若后续精确归因到阅读器或列表重挂载的动画／合成层，可能触及被保护的页面或组件，须由所有者决定。

| 同机、同脚本对照，单位 MiB | 当前 Tauri Release | Electron v0.1.8 公开包 |
|---|---:|---:|
| 冷托盘／隐藏启动，普通工作集／私有工作集／私有提交量 | 15.29／3.42／10.57 | 503.05／247.18／501.86 |
| 读库后回托盘，普通工作集／私有工作集／私有提交量 | 65.98／33.86／115.86 | 564.17／299.56／492.01 |
| 单窗格私有工作集峰值 | 321.95 | 335.88 |
| 三窗格私有工作集峰值 | 370.86 | 374.19 |
| 返回列表私有工作集峰值 | 391.46 | 388.54 |
| 安装包体积 | 6.45（6,758,838 字节，诊断 NSIS） | 121.53（127,434,956 字节，公开 NSIS） |

两端同为原生 125%、1480 × 960 CSS px、完整动效。Electron `--hidden` 创建并保留 BrowserWindow、renderer、GPU 和 utility，冷表使用单独空目录启动。两端读库路径使用同一份合成 JSONL、同一测量脚本和列表／阅读操作。Electron 在隐藏启动就执行初次采集，合成数据须在该次启动前写入。Tauri 用冷探针开窗前写入。Electron 安装包按发布资产 SHA-256 `372751706f89d6b275629241003c8d9ad93147bc01e95a009165923e4ea11a86` 校验后解包。诊断 NSIS 已从包中提取并确认 payload 等于被测 Tauri Release（SHA-256 `56ae4275a49fdb284c2c38a411c14721571b3da4084c3c5cbefdb6a6bdb8f3ad`）。正式 Tauri 打包配置仍为 `bundle.active=false`，6.45 MiB 只覆盖当前可执行文件的诊断封装。初轮因列表工具超时或 Electron 空目录启动后没有发现追加的同批数据而失败，已用公开版支持的隔离 fixture 和共同的页面操作重跑。

过程明细存放于 `artifacts/memory-gate-20261119/`。`baseline/{tauri,electron}.json` 是配对轮摘要，旁边的 JSONL 保留每次采样的 PID、父 PID、进程名及三个内存指标。`electron-cold/` 是 Electron 空数据隐藏启动。`initial-tauri/`、`empty/`、`purge/`、`motion-off/` 是四轮 Tauri 对照。`scripts/m1/measure-memory-gate.js` 接收 `tauri|electron <exe> <output-directory> [reader|empty|cold]`。归还空闲页轮仅设进程环境 `MIMALLOC_PURGE_DELAY=0`，动效轮仅设 `QUOTADOCK_MEMORY_GATE_MOTION=off`。`scripts/m1/package-memory-gate-windows.ps1` 以 NSIS 生成诊断包。采样未保存会话、路径、凭据或原始 DOM。

2026-11-19 收尾复核了六组有效摘要与原始 PID 样本，核对了同源夹具、原生视口、峰值和包体回执。变更检查、诊断脚本 ESLint、Python 与 PowerShell 语法检查通过。沿用被测 Release 构建和桌面运行证据，中断的 Rust 测试缺乏可核查完成回执。二次编译前先按本文件首条资源规则重新评估。

- 收尾 Electron 回归：`npm run lint`、`npm run typecheck:ui` 通过。以单并发执行 `node --test --test-concurrency=1 tests/m1/*.test.js`，813 项全部通过。回执保存在 `artifacts/memory-gate-20261119/recovery-verification/`。
- 暖托盘备选优化：若今后私有工作集超过 35 MiB，才复测价格目录 `OnceLock` 改为随 Store 释放、重开重载，以及 mimalloc 与默认系统分配器的差异。当前保留原配置，继续推进主线。

诊断读数按新口径复判，默认合成冷托盘、暖托盘和开窗均达标。真实大库与正式包仍须按上述指标验收。

#### 解冻前回归状态 · 2026-11-19

- Electron 已绿。全量回归 813／813，ESLint 和 TypeScript 通过。Rust 调用原版 Electron 生成合成旧库，再导入、DPAPI 重封并重启恢复，兼容测试 1／1 通过。
- WebView2 本轮 Debug 构建和隔离冒烟通过，覆盖冷托盘、开窗、采集、会话列表、单／三窗格、返回和回托盘。此回执只验冒烟，正式内存验收仍用 M6 Release。
- Windows Job 原夹具以 Job 进程数恰为 2 作为启动信号，本机有额外进程而失败。调整后由实际合成后代传回 PID，核验终止前存活、终止后退出及 Job 清空，定向 4／4 通过。生产 Job 逻辑未改。
- Rust 全量仍红。vendored tokscale 的 MiMo 目录符号链接去重测试在建立链接时返回 Windows 1314（缺少所需特权）。全量重跑与前一轮清理交叠，导致部分测试和文档测试缺少已构建文件，该轮不能签发全绿。下一次全量在能够创建目录符号链接的环境中串行完成，再执行 Cargo 清理。
- 本次专用 Cargo 目录已通过 `cargo clean` 清除，最终清理回执 2.4 GiB，目录已消失。上轮 `input/` 的 684.82 MiB 安装包与解包副本仍待清理，自动审批拒绝删除，哈希与采样回执已保存。M4 首个子模块等待两项门禁解除。
- 日志和退出状态位于 `artifacts/memory-gate-20261119/recovery-verification/`，旧诊断包回执仍在 `input/`。

- M4 入口复核：`input/` 仅剩两份包体哈希回执，普通权限目录符号链接探针通过。串行 `cargo test --locked --offline --workspace --no-fail-fast` 退出 0，2,317 项通过、0 失败，5 项按原声明忽略（Electron 合成凭据另有单独绿灯）。覆盖单元、集成和文档测试。保留本轮专用 Cargo 缓存，进入 M4.1。回执：`recovery-verification/m4-entry-rust-status.json`。

### M4.1 · 独立账本、原子落盘与重启读取

- [x] 2026-11-19 · 正常 Tauri 宿主在应用标识所对应的数据目录下使用 `usage/`，包括 `statistics.json`、偏好、计价及会话标签。应用级写入租约阻止多个宿主同时写入。窗口关闭释放内存 Store，WebView2 仍使用本次进程的临时 profile。Electron 原目录不参与启动读写。
- [x] 2026-11-19 · 同目录独占创建临时文件，保持流式 JSON 写入，`sync_all`、关闭临时句柄并原子替换。打开的旧读句柄仍读到完整旧版本，新句柄读到完整新版本。失败替换保留已提交内容，模拟中断遗留的不完整临时文件在冷启动时被忽略。此次未执行物理断电试验。
- [x] 2026-11-19 · 定向 Rust 宿主、statistics_io 和 Store 全链测试 18／18。覆盖写入租约释放、并发持有的读句柄、未知值 `null` 和高精度十进制字符串。Electron 统计读写、账本与隐私回归 17／17。
- [x] 2026-11-19 · `scripts/m1/ledger-restart-check.js` 将实际 Tauri 写入字节与 Electron 原版读写重编码比对。移除合成源后，关窗重建和新进程启动均读出相同 3 条会话、统计版本 1、日汇总和标签。逐字节核对冷重启、Electron 隔离哨兵与源正文未写入。最终轮清除测试目录，首轮关窗后的宿主退出和临时文件清理未通过，保留初轮回执。脚本加入 WebView2 退出静置后复验通过。首轮约 14.56 MiB 合成临时文件清理受自动审批拦截。
- 复现及回执位于 `artifacts/memory-gate-20261119/recovery-verification/` 的 `m4-ledger-*`。按所有者指示保留本轮专用 Cargo 缓存，未执行 `cargo clean`。

### M4 · 本机数据目录信息与打开入口

- [x] 2026-11-19 · Tauri 设置桥接接通 Electron 的 `dataInfo` 和 `openData` 契约。仅主窗口可请求，目录固定为 Tauri 自有 `usage/`。统计目录体积使用文件元数据，最多访问 20,000 个条目，跳过链接和 `agent-tools`。页面与组件目录无变更。
- [x] 2026-11-19 · Rust 宿主 4／4、TypeScript 检查、Tauri 前端构建和 Electron bundle／预览回归 11／11 通过。隔离 WebView2 实测设置桥返回版本、独立路径和账本体积，重跑 M4.1 的黄金字节、关窗及冷重启全绿。打开入口通过宿主构建，未在冒烟中拉起资源管理器。回执：`recovery-verification/m4-data-webview.json`。
### M4.2 · 自定义源、定价同步与配置健康

- [x] 自定义源通过 8 条 `usage:custom*` 接入独立 `usage/`。预览只返回限定摘要，应用前核对文件版本，支持变更、停用、删除、回滚、导入和导出。黄金比对覆盖重启后仍为未知的用量与来源正文不落盘。
- [x] 本地价格保存／重置、试算、覆盖计划、账单设置、估值重算和工作台保存均接 Rust。同步以固定 HTTPS 端点拉取价格目录，失败时保留旧目录。托盘调度只读取价格文件，在 Store 已释放时执行同一账单引用校验并原子替换价格目录。
- [x] 6 条 `usage:config:*` 已接通。静态检查经 Rust 阻塞池执行，扫描只读已明确选择的范围。MCP、Hooks 与 Skill 的管理操作经预览、版本核对、DPAPI 备份和原子替换执行，支持撤销。
- [x] 定向 Rust 17／17，Electron 配置、自定义源及采集诊断 59／59，定价与工作台 32／32。TypeScript 检查通过。隔离 WebView2 复验覆盖 15 项 IPC 结果及关窗重建、冷重启和账本隐私不变量。IPC 冒烟核对未授权边界，成功写入和恢复由合成 Rust 黄金测试验证。固定端点的真实网络请求未执行。
- [x] 保留首轮路径判断和冒烟断言失败回执。Windows 路径比较统一按组件处理，价格探测冒烟以 Electron 计算的按 Token 价格为期望值。回执见 `artifacts/memory-gate-20261119/recovery-verification/m42-final-*`。
### M4.3 · Agent 清单、运行时发现与安装器

- [x] 环境发现接入元数据探测。Rust 4／4、Electron 14／14，包含普通 CLI、Antigravity、已保存的来源范围和其他 Agent 的存在性提示。没有执行 CLI 进行发现。
- [x] Agent 盘点限定在固定配置文件和选定项目。四类 Agent 的 Rust 与 Electron 输出逐项一致，Electron 盘点／Skill 行为 22／22。13 条 Agent 管理操作由 Rust 处理，指令按项目内的盘点 ID 访问，预览和恢复沿用加密备份。管理接线的 WebView2 冒烟将随 M4 收口运行。
- [x] Agent 引导、Antigravity 运行时发现及会话内 MCP／Skill 活动接入 6 条 IPC。运行时发现只读文件元数据；复制命令与打开官方指南由用户显式触发。已有 `discovery` 和 `agent-traces` 在主宿主提供来源路径与额外 Agent 痕迹。
- [x] 安装器的 2 条 IPC 和进度事件接入生产宿主。固定 HTTPS 来源、有限重试与续传、TAR/GZIP 和 ZIP 原生解包、完整性验证、WinTrust 发行者检查、版本探测与应用内代际原子切换均走 Rust。队列串行，退出时取消并等待；临时下载由任务目录释放。旧 Claude 本机维护标记仍阻断产品安装路线。
- [x] 安装和受管探测通过 Windows Job。通过 SHA-256 pin 后创建挂起进程，通过进程创建属性把该进程直接交给 `KILL_ON_JOB_CLOSE` Job，再恢复运行。保留 Job 及只读镜像租约，输出有上限。已验证显式取消、宿主被终止时的进程树回收及错误 pin 拒绝。创建时原子入 Job 的完整复验记入最终回执。
- [x] 补接用户订阅费及 Codex 账本重建预览、确认与备份。黄金比对覆盖预览时账本字节一致、错误预览被拒绝及先备份后替换。自定义源打开位置限已保存并通过校验的根目录。
- [x] Electron 全量回归按 `--test-concurrency=1` 执行，813／813。M4.3 定向黄金覆盖四种 Agent、安装来源及解包契约、账本重建、DPAPI 配置恢复和 Job 子进程生命周期。
- [x] WebView2 最新复验通过。M4.2 的 16 项和 M4.3 的 13 项 IPC 检查全绿，同时完成窗口重建、冷重启、Electron 账本字节黄金比对及合成测试目录清理。首轮 29 项 IPC 已通过，冷重启的退出清理遇到 `EPERM`。Rust 宿主只对本进程临时 UDF 的暂时共享冲突限时重试，已通过复现实测及持有句柄的合成测试。
- [x] 最终源码的 Rust 工作区串行全量复验通过，覆盖单元、集成与文档测试，共 2,341 通过、0 失败、默认忽略 5 项。使用已安装 Electron 另行运行默认忽略的旧凭据兼容测试，合成凭据解封、DPAPI 重封、重启恢复与旧目录字节隔离 1／1。Rust 创建时入 Job 的取消和宿主终止测试通过。TypeScript、ESLint 与 Tauri dev 构建通过。
- 回执在 `artifacts/memory-gate-20261119/recovery-verification/`，见 `m4-final-rust-retry.log`、`m4-final-electron-dpapi.log`、`m4-final-electron.log`、`m4-final-smoke-retry.json`。本轮使用合成源、模拟安装请求和进程树。真实供应商下载安装、真实签名包交互和发布验收留待后续授权与 M6。
- WebView2 失败首轮遗留的合成目录 `%TEMP%/quotadock-ledger-restart-TaPl6v` 约 0.99 MiB，以及句柄测试的零字节副本 `%TEMP%/.tmpyrN03S`，即时清理命令均被执行策略拒绝。成功复验的临时文件已清理。按所有者指示保留增量缓存。本轮未执行 `cargo clean`。

### M4 接线后的 IPC 进度

用 Electron preload 实际调用、Tauri renderer `bridges.ts` 的直接返回和 Rust `generate_handler!` 注册表交叉核对。字段别名合并到同一 Electron 通道，返回占位错误的兼容方法未计入。历史 **111** 的口径把 `usage:agents:` 动态前缀算作 1 条；展开 13 个真实操作后是 **123** 条。现有直接接线 **81／111**，或 **93／123**。

| Electron preload 域 | 展开后接入／总数 | 尚待接入 |
| --- | ---: | --- |
| `window:*` | 3／3 | — |
| `usage:*` | 79／82 | `performanceState`、`statisticsDiagnostics`、`interval` |
| `quota:*` | 11／21 | 两条 provider 指南、网页登录／取消、客户端登录及 Codex 登录／取消／单账户刷新／移除／选择程序 |
| `shell:*` | 0／3 | `get`、`set`、`readHistory` |
| `github:*` | 0／9 | GitHub 连接、同步和相关操作 |
| `update:*` | 0／5 | 获取、检查、取消、安装和打开发行入口 |
| **合计** | **93／123** | **30 条** |

M4 本轮明确的 `usage:config:*` 6／6、`usage:agents:*` 13／13、自定义源 8／8、定价维护与同步、来源、Agent 引导及安装器通道均已接线。台账刷新间隔与统计遥测列为历史待补项；本次 M4 门禁只验证授权的合成数据与操作。逐通道回执为 `artifacts/memory-gate-20261119/recovery-verification/m4-ipc-coverage.json`。

### M5.1 · 登录与旧库导入进度

- [x] 主窗和托盘仍使用进程级临时 UDF。网页登录单次创建独立目录，限定 HTTPS 导航域、拦截下载与外部窗请求，并在 IPC 分发层拒绝登录窗调用应用命令。有效凭据通过 Rust 额度验证和 DPAPI 持久化后销毁 WebView2。启动任务按 24 小时期限回收本应用有归属记录且无存活租约的目录，遇到重解析点或无归属记录时跳过。
- [x] 旧库仍通过主窗口菜单选择目录和二次确认。API key 等可移植凭据验证后重封。网页登录态、设备流和 CLI 运行时授权要求重新建立。兼容解码器保留旧格式测试，产品导入不继承这些授权。合成 Electron 凭据验证了重封及账号重启状态，旧连接文件与 Cookie 文件字节相同。
- [x] 合成 WebView2 冒烟覆盖独立 UDF 创建、主窗 Cookie 不可见、登录窗口关闭后删除 UDF、DPAPI 重开账户。Fixture 从空白页注入合成 Cookie，额度响应用合成数据。同期窗口重建、冷重启、账本 Electron 黄金字节与测试目录清理均通过。
- [x] 接通 Provider 官方指南、状态栏指引、网页登录和取消。Claude／Antigravity 状态栏由本人复制配置，Rust 仅接收标准输入并原子保存额度投影。浏览器登录采用站点规则与 Cookie 白名单，DeepSeek 只读取本次窗口本站固定的 `userToken`。第三方真实跳转和多工作区交互待验证。
- [x] Codex App Server 的登录、取消、单账户刷新、移除、选择程序已接线。用户选择的 `codex.exe` 存应用内 SHA-256 pin，进程归 Windows Job 管理。双向管道限长并隔离标准错误，连接先确认 CLI 实际配置为系统凭据库，每个账户使用独立 `CODEX_HOME`。原生双向管道、取消、宿主退出回收和旧 pin 拒绝已合成验证。真实授权和账户变更通知对账仍待验证。
- [x] 官方 CLI 交互窗口接入 Windows Job。创建时将进程纳入 Job，交互控制台内部完成授权，宿主无须捕获控制台内容。合成 Windows 进程树套件 10／10。首轮后代退出检查把 Job 计数归零与进程句柄发出退出信号视为同时发生，复跑改用限时等待，两份回执分别为 `m5-cli-console-job.log` 与 `m5-cli-console-job-retry.log`。
- [x] Antigravity 登录及额度走受管官方 CLI。选择已验证的 app-owned 安装或唯一元数据候选，同一 SHA-256 pin 覆盖版本、交互控制台及固定 `/usage` 参数。保留已复核的 1.1.11–1.4.2 门禁。用户在独立控制台按 CLI 的浏览器提示完成授权并退出。授权材料保存在 DPAPI 凭据记录中，刷新时复原到新建临时目录，用后清理。自动读至少间隔五分钟，取消与退出等待 Job 收口。只发布无模型调用证据的合法报告。
- [x] 合成 CLI 实际执行了托管启动、版本检查、登录、额度读取、凭据更新、冷重启和显式刷新。验证了临时授权目录清理和 299,999／300,000 ms 自动刷新边界。Rust 原生流程与黄金比对 2／2，Electron Antigravity、客户端及 Job 29／29。回执 `m5-antigravity-native-smoke-final.log` 与 `m5-antigravity-electron.log`。真实 CLI 授权兼容性仍待验证。
- [ ] 客户端登录 IPC 已覆盖 OpenCode Zen／ZCode、四种显式环境 API key、Claude 和 Antigravity 的应用独立授权。仍缺 Gemini CLI 与 Cursor 客户端路线及其他固定文件来源。Gemini 公共文档限制第三方直接使用 CLI OAuth 访问 Code Assist，已将官方说明入口切到 `/stats model` 的使用文档。后续应用内额度需要供应商支持的集成合同。
- **WorkBuddy 接线。** Tauri 提供独立网页登录和手动提供已授权的 API 凭据两条路线。能力列表在两个读取入口均投影为这两条可选路线，旧桌面账户仍可读取历史额度。用户追加的私有密钥方式未接入，旧 Electron 桌面加密会话复用仍有差异。开放平台的第三方 OAuth 要求应用审核并由服务端管理应用密钥。
- [x] WorkBuddy 本轮补验通过。桌面 Rust 11／11，适配器与金额精度定向套件 3／3，其中 17 条适配器输出与 Electron 黄金夹具逐条一致。WebView2 冒烟通过两条入口的合成读取、浏览器 UA 校验、积分十进制字符串、凭据不出现在 IPC 投影、关窗重建和冷重启后的 DPAPI 恢复及显式刷新。核对合成凭据和 UA 均未明文写入配额缓存。本轮重启夹具在测试沙盒里保存配额账户，测试目录已清理。真实 WorkBuddy 账号与远端接口仍待验收。回执见 `m5-workbuddy-desktop-final.log`、`m5-workbuddy-parity.log` 和 `m5-workbuddy-restart.json`。

### M5.2 · 后台刷新、托盘与桌面提醒

- [x] M5.2 调度基础接线。主进程保存额度刷新偏好，写入失败保留旧状态，冷重启重新起算计时。自动批次并行调度 Provider 和 Codex，Codex 子进程与 Provider 共用运行槽，手动全刷仍按 Electron 原入口只处理 Codex，Provider 由现有前端分别发起。Codex 失败保留上次额度，限流与需重新登录状态跨重启保留。
- [x] 定向验证通过。Rust 账户与调度 5／5、Tauri 桌面 12／12。WebView2 实测 IPC 合成场景包含刷新偏好写入与冷重启、Codex 手动批次统计、登录隔离及 WorkBuddy 重启刷新。回执 `m5-codex-refresh-core.log`、`m5-codex-refresh-desktop.log`、`m5-codex-refresh-webview.json`。Codex 实际账户后台运行与慢读重试策略仍待验收。
- [x] M5.2 三条桌面 IPC 已接线。关闭到托盘、引导标志和提醒阈值在应用独立目录原子保存。读取历史按连接保留最近 40 行，同结果合并，返回时间和受限错误码。已验证关窗留托盘、冷重启恢复及关闭该偏好后关窗完全退出。托盘监听配额变更，阈值、重置与重登提醒经 Windows 通知插件投递。点击通知可打开额度页。
- [x] TypeScript 检查和桌面 Rust 14／14，WebView2 冒烟涵盖桌面三条 IPC、历史合并、重启、关窗和隔离。回执 `m5-desktop-shell-rust.log`、`m5-desktop-shell-webview.json`。
- [x] 2026-11-20 · M5.2 合成暖托盘回执。关窗并等待实际一分钟自动刷新完成后静置 3 秒，PDH 取得 15 个完整进程树样本，均无 WebView2。私有工作集峰值及末值 29.52 MiB，私有提交量峰值及末值 85.83 MiB，总工作集末值 89.33 MiB。Rust 宿主私有工作集 28.61 MiB，`conhost` 0.91 MiB。首轮把全部额外子 PID 误判为 WebView2，复跑按实际进程名区分并继续计入树总量。保留 `m5-warm-tray-after-refresh.json` 与 `m5-warm-tray-after-refresh-retry.json`。本轮为开发构建和合成账本，正式安装包与真实大库归 M6 终验。
- [x] 最终暖托盘复跑 `m5-warm-tray-after-refresh-final.json` 全程通过。私有工作集峰值及末值 31.19 MiB（宿主 30.30 MiB，`conhost` 0.89 MiB），私有提交量峰值及末值 97.13 MiB，总工作集末值 90.97 MiB，15 个样本均无 WebView2。前一轮复跑在冷重启阶段仍断言只发生两次手动读取，自动刷新会按 Electron 相同规则合并第三次成功读取，已修正冒烟断言。最终回执同时验证冷重启、DPAPI 恢复、关窗退出和临时目录清理。
- [x] 接完 GitHub、更新与开机登录接线后，在同一合成场景复验。关窗、自动刷新、静置后 16 个样本的私有工作集峰值 31.28 MiB，私有提交量 95.31 MiB，总工作集末值 91.63 MiB，未见 WebView2 子进程。登录窗隔离、DPAPI 恢复、冷重启和临时目录清理仍通过。回执 `m5-final-warm-webview.json`。
- [x] Windows 开机登录注册已接入 `shell:set`。仅安装态允许用户显式操作，在 HKCU Run 使用独立的 Tauri 标识与 `--start-in-tray`。启动参数会跳过主窗创建和启动账本读取。Rust 注册命令的引号与参数测试通过，实际注册和系统通知投递需在正式安装态验收。
- [ ] M5.2 仍缺 Electron 的瞬态错误延迟重试一次、连续三轮前保持静默的行为。Rust 当前已有刷新池、限流退避和历史读数保留。
- [x] 2026-11-20 · 接通 `usage:performanceState`、`usage:statisticsDiagnostics` 与 `usage:interval`。原子保存的间隔值与 Electron 一致，默认 15 秒，0 关闭定时采集。定时器在主窗持有账本期间运行，关窗释放账本后暂停，额度后台刷新独立运行。诊断返回 Rust 账本所有者和请求计数，尚无对应的 Node 堆和 worker 投影采样项记为 null。观测诊断无需装载账本或读取来源。
- [x] Rust 账本 9／9、桌面 14／14、Electron 定向 8／8、TypeScript 和实际 WebView2 合成定时刷新均通过。WebView2 从新增合成数据验出账本版本推进，禁用定时后重启恢复 0，账本字节与 Electron 黄金一致。回执 `m5-usage-interval-core.log`、`m5-usage-desktop.log`、`m5-usage-electron.log` 与 `m5-usage-webview.json`。

### M5.3 · GitHub 同步与签名更新

- [x] GitHub 9 条 IPC 已接线。用户发起设备流，Windows DPAPI 密文与本地账号状态同一次原子替换。同步前复核本人拥有、私有、可写、未归档的目标，固定设备文件名并检查远程 blob SHA。同步载荷仅含内置 Agent 按日期、模型的汇总和上传元数据。
- [x] GitHub 同步载荷与 Electron 黄金 JSON 逐字节一致，Rust API 2／2、桌面 15／15、Electron 基线 11／11，WebView2 未配置模式 9 条通道通过。回执 `m5-github-sync-payload.log`、`m5-github-api-rust.log`、`m5-github-desktop.log`、`m5-github-electron.log`、`m5-github-webview.json`。真实设备授权、续期和私有库上传需要获准的 GitHub App 与测试仓库。
- [x] 更新 5 条 IPC 已接线。安装构建需在编译时配置公钥 `QUOTADOCK_UPDATER_PUBLIC_KEY`，从独立 `latest-tauri.json` 获取版本。下载支持进度、取消与重试，使用临时文件保留已验签的安装包。更新程序接受本项目 NSIS 资产和指定 CDN，强制签名绑定版本。用户触发安装时先等待账本和后台任务收口，再请求 Tauri updater 静默安装并重启。
- [x] 更新定向 Rust 桌面 17／17，合成验签 1／1，确认匹配版本包通过、替换字节或虚报版本均被拒绝。首轮 mock 缺插件配置，复跑修正。Electron 更新 13／13。WebView2 未配置模式 5 条 IPC 通过。回执 `m5-updater-desktop.log`、`m5-updater-signature.log`、`m5-updater-signature-retry.log`、`m5-updater-electron.log`、`m5-updater-webview.json`。
- [x] 所有者定稿为签名 NSIS 完整包。M6 打包需生成绑定应用版本的签名，配好 Tauri 专用更新清单，并使用隔离安装身份与测试 feed 核对升级和回退。真实静默升级与重启归入 M6.3 点测清单。

| Electron preload 域 | 直接接线／展开总数 | 尚待接线 |
| --- | ---: | --- |
| `window:*` | 3／3 | — |
| `usage:*` | 82／82 | — |
| `quota:*` | 21／21 | `providerClientLogin` 仍有分支缺口，Codex 合成接线与真实授权验收分开 |
| `shell:*` | 3／3 | Windows 开机登录注册和系统通知的安装态实测 |
| `github:*` | 9／9 | 配置态的实际设备授权与本人私有库同步 |
| `update:*` | 5／5 | 正式签名完整包的静默升级 |
| **合计** | **123／123（111／111）** | **直接接线完成，部分行为仍待验证或补齐** |

本轮逐项核对保存在 `m5-final-ipc-coverage.json`。

回执目录为 `artifacts/memory-gate-20261119/recovery-verification/`。最新逐通道核对见 `m5-m52-ipc-coverage.json`，M5.1 快照保留在 `m5-ipc-coverage.json`。`m5-webview-login.json` 记录 10 项桥接调用和 4 项 UDF／DPAPI 冒烟，`m5-electron-login.log` 记录 10 项定向 Electron 基线，`m5-codex-and-login-rust.log` 含 9 项 Windows Job 测试和 1 项 Electron DPAPI 兼容复验。初次 Rust 开发构建报出 Tauri 回调所有权与命令分发泛型推断问题，已修复并复跑。新增状态栏子路径先修复了测试错误类型和 Windows 引号，再跑工作区门禁。WorkBuddy 首轮桌面编译发现新错误枚举转换不成立，改用现有 `AccountError::Observation` 包装，初次失败保留在 `m5-workbuddy-desktop.log`。

2026-11-20 · Rust 工作区全量复验 · E 盘在链接期间降至约 1.09 GiB 可用空间，已按资源规则结束本次 Cargo 进程树并按所有者要求保留现有增量缓存。`m5-20261120-workspace.log` 只记录编译进度，门禁仍开放。上轮较早构建的 `m5-m51-rust-final.log` 为 2,349 通过、5 项默认忽略，其快照早于 WorkBuddy 能力调整。

资源复查时 E 盘回升至 16.26 GiB，可用物理内存约 2.07 GiB。准备以单构建任务、带资源监控的方式复跑，终端执行策略拒绝启动监控命令。本轮未再次启动 Cargo。

2026-11-20 · Electron 全量回归（串行） · `m5-20261120-electron.log` 813／813，0 失败、0 跳过。覆盖旧版登录、适配器、刷新池、托盘及 Job 行为。

2026-11-20 · 最新 Rust 工作区全量（串行） · `m5-final-workspace.log` 共 58 个测试目标，含 3 个文档测试目标。2,366 项通过，0 失败，5 项默认忽略。17 条额度适配器路线与 Electron 黄金通过，签名与版本篡改拒绝测试通过。

2026-11-20 · 最新 Electron 全量（串行） · `m5-final-electron.log` 813／813，0 失败、0 跳过。随后在本轮工作区目标中单独执行默认忽略的 Electron 凭据库兼容测试，1／1。验证了可重封凭据冷重启后可用，旧 Cookie 与设备流账户提示重登，并逐字节核对旧库未被写入。回执 `m5-final-electron-credential.log`。

2026-11-20 · 旧编译产物清理 · 按 Cargo 测试目标、配置指纹与时间保留各组最新的完整变体。逐文件删除 127 个过时测试可执行文件，合计 11,449,852,212 字节。保留当前二进制、依赖、指纹记录和增量缓存。回执为 `cache-prune-plan.json` 与 `cache-prune-result.json`。

2026-11-20 · 验证后清理 · Rust、Electron 和旧凭据测试全部退出后，移除 59 个被新变体取代的测试可执行文件，合计 5,357,135,988 字节。两轮合计 186 个文件、16,806,988,200 字节，保留最新工作区测试和构建所需的产物与增量缓存。回执 `cache-prune-after-tests-plan.json`、`cache-prune-after-tests-result.json`。

### 解冻顺序

1. **收尾门禁。** 清理临时副本并保留哈希及采样日志，跑通 Rust 工作区常规测试、Electron 合成凭据兼容、Electron 回归与 WebView2 冒烟。价格缓存与分配器轻检可选且不阻塞。
2. **M4。** 首先落地自有账本独立目录、原子写与重启读取。接通 13 条 Agent IPC、6 条配置 IPC，以及定价、自定义源、安装器。接入 Windows Job Object 与可执行文件 SHA-256 pin。
3. **M5。** 补齐 13 条登录族 IPC、后台刷新、托盘通知、9 条 GitHub 和 5 条更新 IPC，按实测 111 条 Electron preload invoke 核对。完成显式旧目录导入与 DPAPI 重封。
4. **M6。** 完成真实大 SQLite 源正确性、内存、正式 NSIS 和零像素差验收。真实账号测试须单独授权。

> 证据行格式：`日期 · 子模块 · cargo test/套件名 · 结果 · 偏差与遗留`。初始失败与重跑分开记，不覆盖历史。
