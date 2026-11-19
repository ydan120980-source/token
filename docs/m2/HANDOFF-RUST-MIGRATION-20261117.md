# HANDOFF · Rust/Tauri 迁移（2026-11-17 会话交接）

本文件是本次重构会话的交接总结。绑定规划与进度锚点是仓库根 `MIGRATION_PLAN.md`（§7 进度日志含逐 slice 证据）；
本文件补充环境重建、会话增量、决策摘要与剩余工作清单。两者冲突时以 `MIGRATION_PLAN.md` 的最新记录为准。

## 1. 任务与边界

把 Electron 43 + Node 后端的 Agent Usage（QuotaDock）100% 迁移为纯 Rust Tauri v2（Windows 原生）：
安装包 ≤15MB、托盘驻留 ≤15MB（实测为准，G2/G3）；前端 `ui/` 零业务改动，仅 `ui/src/data/bridges.ts` 可改；
JSON 形状与错误信封与 JS 契约逐字节一致。六条铁律见 `MIGRATION_PLAN.md` §1。

- 工作树：`token-fix`（专属 worktree），分支 `qoder/dev-20261117`，从本地 main 切出。
- **未经所有者明确许可禁止合并；禁止 push/PR/tag/Release**（AGENTS.md local-only）。
- 不读外部认证文件/`~/.claude.json`；不上传；未知用量/价格保持 null（不补零、不关冲突保护）；
  夹具全合成；`tests/m1/release-privacy.test.js` 拒绝机器路径入 tracked 文件（本文件与所有新增文件已通过）。

## 2. 会话增量与提交链（审计轨迹）

| 提交 | 内容 | 测试 |
| --- | --- | --- |
| `782eec5` | workspace 骨架 + amount/zstd/js_json/statistics_io/store_io/normalize/usage_snapshot/time/agent_catalog/source_registry/local_snapshot/snapshot_codec/snapshot_delta | 29 绿 |
| `2f21ef0` | pricing/projection slice：pricing/aggregate/usage_math/usage_projection(+incremental)/runtime_catalog/valuation | 38 绿 |
| `0f69046` | Store+sources slice：pathx/policy/sessions/session_aggregate/source_scope/ledger_view/operation_metrics/model_aliases/pricing_labels/sqlite_memory/jsonl_adapter/extended_sources/antigravity/batch1_sources/batch1_extra/sources/store 全量；snapshot-order 第三测试（全链路）解除 deferred | 48 绿 |
| `f560611` | workbench slice：build/change/csv + Store.workbench/saveWorkbench（8 视图缓存与失效）；新增 collate 模块（ICU localeCompare parity） | 49 绿 |
| `848d160` | tokscale 内联 slice：native.rs + vendor/tokscale-core v4.17.0（MIT）替换 exe 子进程；exe 十例 parity | 51 绿 |
| `d2ae6d3` | 交接文档 + native 夹具生成器入库 + 隐私守卫 vendor 豁免 | 51 绿 |
| （本提交） | vendor 官方 tarball 全量字节交叉核对闭合（110/110），README 补齐，SHA256SUMS 110 条 | 51 绿 |

M1 子模块状态：store/ledger/zstd ☑ snapshot/delta ☑ pricing/projection ☑ Store+sources ☑ sqlite+WAL ☑
workbench ☑ tokscale 内联 ☑ **parity 全绿 □（剩余见 §6）**。M2–M6 未开始。

## 3. 环境重建（下一会话必读）

工具链：rustup stable-x86_64-pc-windows-gnu 1.100（无 MSVC；M3 若需再议）；g++ (MinGW-W64) 可用；Node v24。

1. **中文路径链接问题**：外部 mingw ld 不认非 ASCII 源码路径 → 每次 cargo 命令设
   `CARGO_TARGET_DIR` 为用户目录下 ASCII 路径（环境级变量，**不入 tracked 文件**）。
2. **cargo 网络**：本机 cargo 自带 libcurl 下载 crates 超时（curl.exe 直连正常）；github git/raw/API 被阻断或限流。
   可行路线：环境级 `CARGO_HOME` 指向源码树外 scratch 目录，内置 sparse 镜像配置（rsproxy.cn，0.5s 级响应）：
   ```toml
   [source.crates-io]
   replace-with = "rsproxy-sparse"
   [source.rsproxy-sparse]
   registry = "sparse+https://rsproxy.cn/index/"
   [net]
   retry = 3
   ```
   `Cargo.lock` 的 source URL 仍为 canonical crates.io（源替换透明），其他维护者无需镜像即可复现。
   scratch 目录可能被系统清理——按上面配置重建即可，registry 缓存会重新下载（镜像快）。
3. 标准命令（在 worktree 根，Git Bash）：
   ```bash
   export PATH="$USERPROFILE/.cargo/bin:$PATH"
   export CARGO_TARGET_DIR="<用户目录>/cargo-target-token-fix"   # ASCII
   export CARGO_HOME="<scratch>/cargo-home"                      # 含上述 config.toml
   cargo test -p usage-engine        # 全量 parity（store_chain 约 110s，workbench 约 34s）
   cargo check -p usage-engine
   node --test tests/m1/release-privacy.test.js   # 隐私守卫
   ```
4. 运行时夹具依赖 Node 与（native 夹具再生时）`node_modules/@tokscale/cli-win32-x64-msvc` 的 pin exe
   （依赖 junction 边界见 AGENTS.md；`trustedBinary()` 每次 spawn 前 SHA-256 全量校验）。

## 4. 测试矩阵（51，全部期望值来自 JS/_exe 参考）

- amount 4 · js_json 5 · pricing 3 · projection 3 · snapshot_codec 3 · snapshot_order 3 · sources 3（22 例解析器矩阵）
  · statistics_io 7 · store_chain 7（全链路顺序无关/WAL/隔离/重扫/自定义/会话元数据） · usage_math 3 · zstd_frame 7
  · workbench 1（14 视图+2 CSV+5 错误码+重启持久化+range/budget/settings/request/collation 单元）
  · native 2（10 例 exe parity + 资格规则单元）。
- 期望值来源：`tests/fixtures/` 静态夹具（JS 参考或 pin exe 生成）+ workbench 运行时生成器（视图依赖真实当日，
  Rust 测试同轮调用 node 生成 JS 参考，固定 salt 种子、掩码 ingest 时钟）。

## 5. 关键决策与不变量（迁移期新增）

- **G9 行身份**：JS WeakMap/=== 以 serde_json Value 结构相等代替（输出精确）；Rc 行引用恢复字节级 delta parity 仍 deferred。
- **collate 模块**：`String.prototype.localeCompare` = 系统 locale 的 ICU 排序（本机 zh-CN：CJK 先于 Latin、
  重音/大小写有别于字节序）。`icu_collator`(compiled_data) + `sys-locale`，thread_local CollatorBorrowed。
  workbench 三处排序与 model_aliases 已切换；**后续所有 JS localeCompare 位点一律走 collate**
  （已移植的投影日期/小时/copilot 时间+id 为 ASCII，ICU 与字节序等价，已核）。
- **tokscale 内联**（G1 落地修正）：git 依赖不可 fetch → `vendor/tokscale-core` path 依赖。
  源码 = junhoyeo/tokscale tag v4.17.0（MIT © Junho Yeo），经 fastly.jsdelivr 逐文件获取；
  **官方 codeload tarball 全量字节交叉核对已闭合：110/110 一致**（tarball sha256
  eaa5269091d8365df27de342029d586a1bb3806b20575077cc0b2bf039b57ebc；Git Bash tar 对该归档误报 EOF，
  用 Python tarfile 解包比对），2 个测试夹具 README 自官方补齐。`Cargo.toml` 仅把 workspace 继承解析为
  tag 根 manifest 的具体版本（该根 manifest 与官方字节一致；cargo 发布同款归一化），源码字节不动；
  `LICENSE` + `SHA256SUMS`（110 条）随附。
  语义 gate = pin exe 4.17.0 十例矩阵（含重复 uuid 去重 → NATIVE_TOTAL_MISMATCH 负例）。
- **native 密闭边界**：子进程密闭 env 的进程内等价 = 每次调用临时设置并还原
  `TOKSCALE_CONFIG_DIR`（run 目录）/`TOKSCALE_PRICING_CACHE_ONLY=1`（永不网络取价）/`HOME`（合成 home；
  core 的 paths::home_dir 优先读 HOME，封住 claude 解析器 cc-mirror 对真实用户目录的读取）。
  `use_env_roots=false` + `clients=["claude"]` 使其余 roots 全落在合成 home；core 内 dirs:: 调用已逐点核过。
  随子进程退役：NATIVE_BINARY_MISMATCH/NATIVE_UNAVAILABLE（二进制字节意义；pin 改为 vendored 源码）、
  NATIVE_OUTPUT_LIMIT（无 stdout 通道）。NATIVE_TIMEOUT 覆盖异步取价段；同步解析不可抢占 → M3 宿主采集看门狗兜底。
  store.rs 两处 parserVersion 引用 `native::TOKSCALE_VERSION`（单一 pin 点）。
- **serde_json features**：`preserve_order`（JS 键序）+ `float_roundtrip`（正确舍入，长十进制 1 ulp 教训）全 crate 生效。
- **SQLite/WAL**：rusqlite bundled+serialize，字节拷贝镜像 deserialize（不打开源库）；WAL 快照头部 18/19 字节
  置回 rollback 模式；NTFS file index 用 GetFileInformationByHandle 对齐 stat.ino。
- **其他 JS 语义坑**：regex `\0`→`\x00`；kimi 按 path.sep 字面切分（Windows 反斜杠）；`null >= 0` 为 true
  （native 资格规则 null 计 0 仍计入）；JSON 往返丢 NaN（夹具用字符串 "NaN"，两侧同跳过）；
  amount 用 num-bigint（G5：36 整数位+18 小数位超 rust_decimal）。
- **不移植**：shareSavedStrings（V8 字符串驻留优化，无可观测行为）；parse-cache 的 JS payload 权重缓存
  属性能启发式，M3 队列设计时一并裁决（登记）。
- **隐私守卫适配**：release-privacy 对 `vendor/` 加 scoped 豁免——vendored 上游测试夹具带上游自己的合成身份
  （me/Alice/Frank 等），非本机路径；vendor 以 SHA256SUMS pin 保证字节不动，第一方代码仍全量受守卫。

## 6. 剩余工作（按里程碑）

- **M1 收尾（parity 全绿）**：cost-table(143 行)/cost-insights(170)/insights-math(213)/cost-export(23)、
  usage-query(76)/usage-read-model(20)/query-entry(39)/query-runtime(18)/read-snapshot(48)、
  statistics-contract(27)/statistics-errors(14)/collection-diagnostic（worker 边界错误分类；NATIVE 集合需按退役码更新）。
  对应 JS parity 套件翻译：cost-table/cost-models/cost-day-series/cost-chart/chart-geometry/insights/calendar/
  trend-gaps/display-values/candidate-core/attention-summary/usage-series/usage-models/query/query-runtime/read-model/
  write-consistency/statistics-contract。完成后 M1 出口：cargo test 全绿 + JS 基准同夹具逐字段比对。
- **M2 session-reader**：session-list/session-list-codec/session-labels/transcript 族/usage 搜索/file-history/导出。
- **M3 宿主+bridges**：service/worker/statistics-worker/statistics-service → tokio 单写者队列 + rayon；
  bridges.ts 切换；窗口/托盘/生命周期；采集看门狗（native 同步段）；三页冒烟；托盘内存首测（G3）。
- **M4 source-admin+win-native**：discovery/custom-sources/config-health 族/agent-inventory/agent-traces/skill-front；
  DPAPI/Job Objects（windows crate）。
- **M5 quota-engine**：src/quota 15 适配器/登录族/scheduler/github-sync-payload/price-sync-service/price-fetch-worker/update。
- **M6 验收**：体积/托盘内存实测、全量 parity、UI 套件（G6 WebView2 CDP 适配）、所有者验收、**合并许可**。

## 7. 夹具工具（再生指南）

- `crates/usage-engine/tests/fixtures/workbench-gen.cjs`：运行时 JS 参考生成器（Rust 测试自动调用）。
  手动：`node crates/usage-engine/tests/fixtures/workbench-gen.cjs <repo-root> <out-dir>`。
- `crates/usage-engine/tests/fixtures/native-gen.cjs`：pin exe 参考生成器（需 node_modules 的 @tokscale exe）。
  `node crates/usage-engine/tests/fixtures/native-gen.cjs <repo-root> <out-dir>`，
  将 `<out-dir>/native-expected.json` 覆盖同目录夹具。**升级 tokscale = 同步更新 vendor 源码 pin、
  native::TOKSCALE_VERSION、src/m1/native.js TOKSCALE 与 lockfile，并再生本夹具**（native-binary.test.js 守卫）。
- 静态夹具：normalize-expected/pricing-expected/sources-expected（JS 参考字节，勿用 serde 重序列化——会丢浮点尾数）。

## 8. 本次交付

- 交接文档：本文件（docs/m2/）。
- 源码包：`dist/20261117-rust-migration-handoff/`（untracked 交付目录）——分支 HEAD 的 `git archive` 全量 tracked
  源码 ZIP + SHA256SUMS + 交付清单。含 Rust crates/vendor/规划/全部 JS 源码与夹具；不含 node_modules/dist 产物。
  官方 `npm run package:source` 的文件夹清单尚不含 Rust 树（Electron 产品打包器），M3/M6 正式打包时再统一；
  本包是迁移交接专用，非发布候选。