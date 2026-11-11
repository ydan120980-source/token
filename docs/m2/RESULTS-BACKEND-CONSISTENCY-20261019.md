# 后端一致性维护与本地合入复核（2026-10-19）

结论：三项已实现并通过下列合成、源码界面及隔离打包验证；按所有者授权，由本线程复核后本地 no-ff 合入。本文记录合入前的验收依据，合并提交由 Git 历史记录，实际操作前仍检查共享 main 的基线、干净状态和进行中的 Git 操作。没有真实来源读取、客户端配置变更、上传、远端同步或正式交付代次。

## 授权与提交

本轮授权是“开始这三项，然后由你按结果记录复核后本地合入”。主题分支延续 codex/query-billing-20261018；开始时主题 HEAD 为 363ced0，共享 main 为 7a2d8fb。范围决定见 [BACKEND-CONSISTENCY-20261019.md](BACKEND-CONSISTENCY-20261019.md)。主线程独立实施，没有委派。

| 提交 | 内容 |
| --- | --- |
| c0a0101 | 三项实施、验证及本地合入范围 |
| de6dd65 | 候选写入成功后才发布内存，保护计费引用，旧悬空目标保留未定价 |
| 45f161f | 查询 revision、严格后续分页及外部协议验证 |
| d81d009 | 无 IO 计价/投影及独立只读模型、日期格式化器复用、大账本测量 |

本地合入也包括上轮未合入的 452bcd2、3d3d40d、86976da、1f4d60b、e0f027d、363ced0。已按 [上轮交回记录](RESULTS-QUERY-BILLING-20261018.md)复核获批费用排版、完整曲线、紧凑详情、四文件查询、显式别名建议和计费失败恢复；本轮用当前最终代码重新执行受影响检查。上轮“未合入、交回原线程”是当时状态，本轮新的明确授权允许本线程承担复核和本地合入。

## 三项结果与源码复核

| 范围 | 结果及复核依据 |
| --- | --- |
| 写入一致性 | clear、采集开关、来源范围、刷新间隔、订阅使用候选状态。原子替换失败保留原内存对象、统计/会话投影、个人来源历史索引、磁盘及定时器；重试只推进一次并与重启一致。原有 ingest/commitCustom/计费提交保护保留 |
| 引用完整性 | 手动价格移除与价格目录替换先验证已有有效映射/默认模型目标；无可用回退时 PRICE_TARGET_IN_USE，写盘前拒绝。面板保留输入并提示先解除引用。旧悬空目标允许只读加载、继续未定价，不自动删规则；新 setBilling 写入仍严格校验 |
| 查询版本 | revision 绑定计算合同、账本 sequence、时区、计价依据指纹、规范化选择和公开聚合；不散列原始文件、路径、会话/记录身份或元数据。后续 offset 页必须带版本；选择或计算依据变化受控要求重查。页大小可变，分页总额不跟页大小变化 |
| 后端边界 | valuation 接受显式价格/计费输入；usage-projection 接受记录、估算器、时区与时间；GUI Store 和 usage-read-model 共用。读取链不再 require Store、policy、来源读取器、会话模块或 native。Store 保留持久化/缓存职责 |
| 性能 | 冻结 45f161f 旧模块与新实现以同一合成生成器、每规模新进程测量；10 万记录查询中位数 9476.1 → 1184.0 ms，测量进程峰值 RSS 2988.9 → 439.9 MiB。其余规模、方法和边界见范围记录。只复用最多八个时区的 Intl 格式化器，没有新增持久化查询缓存 |
| 审查补修 | 旧非标准 entry 在聚合侧归 unknown、会话侧保留原值会漏算会话；现两侧统一投影，新增 entry=unknown 的独立回归 |

逐项复核确认：unknown/null/显式零、冲突保护、完整快照、首存身份和 WorkBuddy 明细替代规则保留；别名建议不自动映射；价格更新不写统计事实。单产品入口仍为 src/quota/main.js。没有新增来源、配置信息读取、常驻服务、端口、依赖、阶段 3/4 或其他 Backlog 工作。CodeGraph 不可用，使用源码调用链、独立依赖加载检查、测试及包内字节验证。

## 本轮执行的验证

下列路径以本工作树 artifacts/backend-consistency-20261019/ 为根；unit 次数不在本文固定。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| npm.cmd run verify | 最终 lint 通过，单元 fail 0 | verify-final.log；首次全量 verify-first.log 也通过 |
| npm.cmd run audit:runtime | 单入口、当前本地资源与运行依赖图通过 | artifacts/maintenance/runtime-audit.json |
| npm.cmd run test:native | 新合成投影、tokscale 固定哈希、只读来源通过；Node 网络尝试为零 | native.log |
| npm.cmd run pricing:check | 已评审价格重建一致 | 本轮命令输出，最终包/计价测试亦覆盖当前快照 |
| npm.cmd run test:query:integration | Node 外部 SDK initialize/tools/list/tools/call、连续两页、缺版本/过期版本、受控错误、隐私与只读通过 | query-final.log、query-final/results.json |
| npm.cmd run test:stress | SQLite 反复采集、WorkBuddy、刷新/退出、额度队列、RPC 边界、大投影通过 | stress.log、artifacts/maintenance/stress-results.json |
| test:workbench:stress / test:custom:stress | 合成项目费用重估、账本不变；个人来源边界、取消、无变化刷新通过 | workbench-stress.log、custom-stress.log、custom-stress.json |
| 合成大账本测量 | 1万/5万/10万，独立金额与总量相符、账本字节不变 | benchmark-before-frozen.json、benchmark-after.json |
| billing-query 源码 UI | 三档缩放与 800px 窄窗口；引用保护、草稿/失败重试、零/null、倍率和查询计价通过 | billing-ui-first.log、ui/billing/ |
| cost/workbench/sessions/functional/usage/custom-sources/cost-layout/cost-compact 源码 UI | 全部 exit 0，受影响主流程、原费用布局、完整曲线与紧凑详情通过 | ui-suites.json、各 *-ui-first.log、ui/各套件；usage 套件沿用 artifacts/maintenance/ |
| 隔离构建 + audit:package | 真实 node_modules 预检、构建、当前产品与 ASAR 字节一致、固定原生哈希通过 | build-deps.log、build.log、audit-package.log |
| 打包 EXE 外部 SDK | EXE + ASAR 实际协议、连续分页、价格变化拒绝旧版本通过 | packaged-query.log、packaged-query/results.json |
| 打包 billing-query UI | 100%/125%/150% 与窄窗口通过，引用保护提示留有截图 | packaged-billing-first.log、packaged-billing/各缩放/ |

UI 使用现有 Playwright 原生 Electron 套件，Browser plugin not available；每套件独立 usage/quota 与合成 home。已查看当前 125% 费用概览和计费界面截图，未见新增遮挡或布局破坏。费用日期按本轮系统日显示 2026-10-19，不声称与昨日截图逐像素相同。新增引用提示的可见文本、原输入与价格文件不变均有断言；全部窗口和 fixture 按原套件清理。

## 首次失败与修正

- 新写入一致性测试初稿的嵌套对象少一个括号，产生 SyntaxError；修正 fixture 表达式后定向测试通过，未放宽产品验证。
- 日期函数共享时，首次纯投影检查发现 day(time, timezone) 与 localDay(timezone, time) 参数顺序不同；补显式适配后复跑通过，DST/多时区及全部单元/界面检查随后通过。
- 其余本文所列全量、SDK、源码 UI、隔离构建/包审计、打包计费 UI 均本轮首轮通过。性能初测另留 benchmark-before.json，但正式前后结论只用冻结 45f161f 的 benchmark-before-frozen.json 作基线。

## 限制与合入结论

没有执行 validate:local、真实账号/来源或真实 Agent MCP 配置/模型调用；这些不能由合成或官方 SDK 代替。revision 不是历史快照存储、跨进程多文件事务或锁；分页中发生变化需重查。写入失败一致性不等于断电持久化保证，未做断电/磁盘硬故障测试。旧悬空引用仍需用户修正，未自动修复配置。大账本仍有全量 JSON 读取与投影边界；性能只是当前机器的合成测量。

本轮构建是隔离验证，不是完整发布候选；未执行全套打包 UI 动态枚举、crypto 发布检查、中文空格解压副本字节与采集验收；不创建正式 dist 代次、源码 ZIP、不替换当前运行包，既有 r15/r16 保留。

复核结论：未发现阻止本轮本地合入的未解决问题。允许在 main 干净且仍为复核基线、无进行中的合并时执行 git merge --no-ff codex/query-billing-20261018。合入后按新 lockfile 对齐共享 main 的本地依赖，并在该目录运行 verify 与 audit:runtime，确认工作树干净及 origin/main 未变化。实际合并、依赖安装与主目录验证输出存入本线程证据目录。
