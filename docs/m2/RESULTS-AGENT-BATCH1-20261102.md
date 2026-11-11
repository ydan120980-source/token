# 首批新增 Agent 后端结果与 Claude 对接 · 2026-11-02

本记录对应第一组提交 `6cf9039` 的 Copilot/Cline/Pi；首批授权共七来源，其余四来源的后续实现、最终验证与完整对接见 [AGENT-BATCH1-EXTRA-20261102.md](AGENT-BATCH1-EXTRA-20261102.md)。下文未开始项描述第一组提交时的状态，不代表首批七来源的最终状态。

## 交付状态

后端已实现，合成验证完成，保留在 `codex/agents-batch1-20261102`，基线本地 main `8cff8bb`。读取合同、固定源码树依据和详细限制见 [AGENT-BATCH1-CONTRACT-20261102.md](AGENT-BATCH1-CONTRACT-20261102.md)。实现、测试及本记录在同一增量提交；最终提交号以该分支历史/交付回复为准。

没有修改 `ui/` 或 `design/desktop-reference/`，没有新依赖/原生版本变更，没有修改 package build 段。没有启动真实采集、读取真实来源/凭据/账号、开启遥测、操作前端、打包、推送或发起子代理。

共享 main 当时仍有预先存在的未跟踪 `docs/agents/`，不属于本增量。按干净工作树的本地合入条件，未清理、暂存或提交该目录，也未合入共享 main。Claude 对接前应明确使用此分支/增量；不把“独立分支完成”写成“main 已上线”。

## 本次实现

- 新的 `src/m1/batch1-sources.js` 是 usage-only 纯投影模块，处理 Copilot CLI shutdown、受限 OTel chat span、Cline IDE/CLI 和 Pi v3。
- `policy` 新增固定默认根和文件白名单；`agent-catalog`/发现目录新增 `copilot/cline/pi`。未扩展账号、安装、配置管理或正文阅读权限。
- Copilot 用保存的数字累计检查点重建逐模型关闭区间，避免旧文件消失、迟到、复制及重启造成重复计入；修正区间仍经 Store 的批次暂存和原子发布。
- `usageOnly:true` 将本批与旧十 Agent 的账号额度能力分开。三个来源不会获得默认 API-key 登录、安装计划或 setup 动作。
- 固定诊断码 `SOURCE_FORMAT_UNSUPPORTED`、`COPILOT_SOURCE_MODE_CONFLICT` 沿现有统计投影输出。未知桶仍为 null；模型/价格无来源依据时不猜测。

## 验证结果

所有测试使用独立临时 home/usage；不经过 `validate:local`。

| 检查 | 结果 / 范围 |
|---|---|
| 定向集成与来源回归 | 通过：新增解析器、旧 Agent 集成、来源范围、只读发现、setup 与额度能力边界 |
| `npm.cmd run verify` | **复跑通过，fail 0**；包含 ESLint、UI TypeScript 及全部 node 单元测试 |
| `npm.cmd run test:native` | 通过；仍用校验过的 tokscale 4.17.0，对统计专用投影验证；新增来源另由合成 Service 测试经过相同验证 |
| `npm.cmd run audit:runtime` | 最终版本通过；产品入口、模块层次、本地资源、无开发脚本导入检查通过 |
| `git diff --check` | 通过 |
| UI / 视觉 / 打包 / 解压副本 | 未执行，本增量不声明这些验收 |
| 真实 Agent 格式、当前安装版本、真实记录、账号 | 未执行，不声明真实支持已验证 |

新增合成断言包括：三来源独立总量；正文/工具/凭据哨兵不落盘、不进投影；源文件前后 SHA-256 相同；重复采集和重启；Cline 两种输入口径；Pi fork/复制去重及未来版本拒绝；Copilot 累计快照排序、不同会话独立、迟到前缀/前缀消失、模式冲突及重启保护、OTel 只计调用不计汇总；保存失败回滚；无变化服务刷新跳过写盘；无新增额度/安装权。

原生单独脚本主要仍覆盖既有四来源 fixture，不把它称为三个新真实格式的原生独立认证。新增 Service 测试使用三个自建合成来源并验证 nativeVerification=passed，但原生只核验规范总量，不验证字段语义。

## 首轮失败及处理

1. 新增定向测试首轮错误地要求两次直接 Store 入账的完整文件字节相同；直接入账会更新扫描状态时间。改为比较统计事实不变，并单独在 Service 无变化刷新路径验证文件字节不变，复跑通过。
2. 首轮全量 verify 的 setup/catalog 枚举断言失败；同时发现新来源会被通用 provider catalog 赋予默认登录描述。修正为明确的 usageOnly 能力边界，setup 测试只要求具有 setup 合同的内置项。旧额度断言维持，复跑通过。
3. 首轮全量 verify 的 Windows 状态栏 helper 测试出现子进程超时；该文件没有修改，较小的定向复跑及完整 verify 复跑均通过。未扩大超时或去掉断言。
4. 新增安装边界断言曾引用不存在的 `agent-install-catalog`；改为实际 `agent-install-plans.plans`，定向及全量复跑通过。

日志在本工作树忽略目录 `artifacts/`：`batch1-first-tests.log`、`batch1-targeted*.log`、`batch1-regression-r3.log`、`batch1-verify.log`、`batch1-verify-r2.log`、`batch1-native.log`、`batch1-runtime-audit*.log`。首轮日志保留。

## 给 Claude 的接口说明

| 内容 | 已有后端提供 | Claude 对接注意事项 |
|---|---|---|
| 来源 ID | `copilot`、`cline`、`pi` | 数据目录与 `usageOnly:true` 已注册；不要默认套旧十来源的额度登录、安装或 setup 管理入口 |
| 统计 | 既有 UsageSnapshotV1 的来源、daily、模型/entry 和字段覆盖 | 无新 IPC；未知字段仍为 null；Cline/Pi 单条调用与 Copilot 关闭区间记录的计数单位不同 |
| 来源状态 | 既有 partial/error/lastSuccess、固定诊断码 | `SOURCE_FORMAT_UNSUPPORTED` 表示不在核对格式内；Copilot 模式冲突表示保留历史、拒绝当前混计；不要表达为零用量 |
| 图标/文字 | 暂用现有通用图标与简短来源说明 | 本批未设计 UI/品牌图标、悬停卡、布局或视觉表达，由 Claude 处理 |
| 会话 | 现有独立列表元数据，Pi 有合法 cwd，其他无 cwd 为未知 | 没有新增 transcript/resume/search 支持；不要因为出现统计就开启阅读/恢复按钮 |
| Copilot 模式 | 默认只读 session-state，可显式选已有 OTel 文件 | 不会自动开启遥测；不能把 CLI 统计写成整个 Copilot IDE/云端覆盖；同库混模式会拒绝 |

若在对接时发现共享 catalog 的新增项触发既有界面假设，由 Claude 修前端并跑受影响的合成源码 UI 套件；本记录不代替其验收。真实样本核对仍需单独明确授权，并遵守 `validate:local` 及内容边界。

## 保留限制

- Copilot 暂不读取 session-store.db/data.db、账号 credits，也不对 shutdown 与 OTel 做自动逐调用融合；没有 shutdown 的活动/崩溃调用可能未记录，回退/重置计量不猜测。
- OTel 仅支持明确的单次 chat span schema；不接受缺会话身份、仅日志/metrics、嵌套 OTLP 批次等变体。
- Cline 旧 IDE 行缺 `modelInfo` 时模型未知；不会读取正文补齐；跨 IDE/CLI 迁移去重尚未核对。
- Pi 仅核对 v3，未声称衍生产品和其他 session 版本兼容。fork 同 entry 去重不等于已实现子会话阅读或编排。
- 未做新内存/长期稳定性测量，不沿用旧 M12 数字声明新版本内存达标。

第一组在此提交收口；后续沿同一首批授权继续第二、三组，见上方续进记录。
