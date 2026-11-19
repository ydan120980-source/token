# MIGRATION_PLAN.md — QuotaDock · Electron → Tauri v2 纯 Rust 迁移

> **接力指令（新会话第一句话）**：「请先读取 MIGRATION_PLAN.md，然后继续执行下一个未完成的任务。」
> 本文件是迁移工程的唯一进度锚点。每完成一个子模块的移植与测试验证，立即更新 §7 的勾选与证据行。
> 工作树：`token-fix`，分支 `qoder/dev-20261117`（自本地 main `c378786`）。**未经所有者允许禁止合并到 main，禁止 push。**
> 状态：**Phase 0、M1 Batch 1 与 Phase A.1 完成；Phase A.2 的 17 个 Agent Rust 阅读格式已迁移，应用级验收待完成。**

---

## 0. 目标与铁律（所有者指令 2026-11-17）

目标：后端 100% Rust 化（Tauri v2，Windows OS Native），剥离 Chromium 与 Node.js；
安装包 ≤ 15 MB；托盘驻留内存 ≤ 15 MB；前端 `ui/` 业务代码零改动复用。

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
| 账本存储 | `statistics.json` 经 `write-statistics`/`read-statistics`（zstd 帧）；`preferences/pricing/billing/validation/workbench/model-pricing/session-labels` 为普通 JSON；原子写 `.tmp-<rand>` + rename，mode 0o600；损坏隔离 `quarantine/` |
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
- 体积：NSIS 安装包实测 ≤15MB（G2；tokscale 内联后无 exe 资产）；`strip/lto/opt-level=z` + 前端 bundle 复用。
- 内存：托盘驻留（主 WebView2 销毁后）≤15MB 实测（G3）；开窗口峰值对照旧基线只降不升；
  采样方法继承 windows-memory-sampler（private working set 与 private commit 分开报）。
- 全量 parity 汇总 + 受影响 UI 套件（WebView2 CDP harness）+ `audit:runtime` 等价 Rust 审计；
  所有者视觉/交互验收后，才谈切换与合并（**合并仍需所有者逐次允许**）。
- 出口：MIGRATION_PLAN 全勾选 + 验收证据行；旧 Electron 入口保留为对照直至所有者下令移除。

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
- **G2 15MB 安装包**：Rust bin(strip+lto) 估 6–10MB + bundle ~1.5MB + 资产；NSIS LZMA 后有望 ≤15MB，**以实测为准**。
  若超：先砍依赖 feature，再请所有者重议目标；不擅自放宽。
- **G3 15MB 托盘驻留**：销毁主 WebView2 后 Rust 进程估 8–15MB；WebView2 独立 UDF 的 browser 进程须随最后一个
  webview 退出而退出（M3 实测验证，必要时 `Close()`+等待进程退出再报数）。开窗口时 WebView2 本身百兆级是物理事实，
  目标只约束托盘态；验收数值分开报。
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
- [ ] M4 source-admin+win-native（discovery/custom □ config-health/manager □ inventory/skill □ install 引擎 □ DPAPI/Job □ parity □）
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

**状态：暂停迁移。** 本分支保存 Rust/Tauri 审阅快照。Electron 继续作为正式运行入口和契约对照，等待所有者确定后续方向。

| 范围 | 快照状态 |
|---|---|
| 账户与凭据 | Rust 账户库将快照和加密凭据在单次原子写入中提交。用户确认后从选定的 Electron 数据目录复制导入并按 ID 去重。原版 Electron 生成的合成 V1/V2 密文均通过导入、DPAPI 重封及重启恢复。 |
| 读取与刷新 | 手动凭据、读取、取消、移除、批量和分钟调度已接 Tauri。应用自有授权续期与账户变化拒绝已接入。官方 CLI／网站／设备登录和被动观测待接入，真实休眠唤醒、短暂故障静默重试和读取历史仍待比对。 |
| 进程与托盘 | Windows 原生 Job 对象已通过执行文件替换拒绝和实际父子进程回收测试。标准流捕获、交互式登录和安装器接线待做。托盘卡片复用原资源，打开、受限读状态、关闭、回主窗口经隔离 WebView2 检查。完整桌面偏好、通知和实际系统托盘点击待验。 |
| 完整切换 | 配置健康／管理、安装器、GitHub、更新及 packed IPC 仍有缺口。这一轮未打正式包或重测内存和像素差。此前的零像素差、托盘 15 MB 和开窗 500 MiB 仍是验收门。 |

验证记录：quota-engine 和宿主 29 项常规 Rust 测试通过，另显式执行原版 Electron 合成凭据兼容测试 1 项并通过。相关 Electron 回归 35 项通过，包含前端 bundle 字节校验。TypeScript、Tauri Debug 构建及 8 项合成 WebView2 冒烟通过，托盘用测试入口打开。仅使用合成账户、隔离目录或本机传输，未读取正式安装资料。

恢复前先对齐三个问题：

1. **后台进程归属。** 当前 Tauri 宿主同时持有调度和窗口。可继续精简同进程宿主，或拆成轻量 Windows 托盘宿主与按需工作进程。两种结构均用整个应用进程树衡量，刷新峰值单独记录。
2. **切换粒度。** 按领域交付 Rust 内核，还是等待宿主、安装、更新和逐像素验收一并达标再切换。审阅分支保留 Electron 对照入口。
3. **数据和安装身份。** 独立数据目录与用户确认导入已经确定。需要划定可继承的偏好和运行时授权、要求重新登录的场景，并分别验证 Electron 回退与 Tauri 升级。

### 待迁移顺序（架构确认前暂停）

1. M5 · 将配额观测接到可恢复的账户服务和受限 IPC，用合成凭据与回环服务验证写入顺序、并发刷新、关闭及重启。随后接登录／续期、CLI 和被动观测。
2. M4 · 完成配置健康／管理、Agent 清单、Windows Job Object 和安装器。先完成只读检查，再接入用户显式触发的修改和安装。
3. M3/M5 · 接配额提醒、原生托盘浮窗与持久设置，完成 GitHub、更新及剩余 IPC。
4. M6 · 打包后进行真实包回归、内存和零像素差验收。以相同输入复验，真实账号测试须单独授权。

> 证据行格式：`日期 · 子模块 · cargo test/套件名 · 结果 · 偏差与遗留`。初始失败与重跑分开记，不覆盖历史。
