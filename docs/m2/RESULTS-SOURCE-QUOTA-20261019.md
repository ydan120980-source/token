# 产品方向记录与来源/额度对齐验收（2026-10-19）

结论：所有者明确的公开用户与 GitHub 主线已记录，首个来源/额度对齐增量已实现并合成验证。按项目门禁复核后允许本地 no-ff 合入；本记录为合入前依据，合并提交及主目录复验另保存在本线程证据目录。实际额度仍只有 Codex，GitHub 只有首版合同。

## 授权、方向与提交

所有者要求“记录这次明确的产品方向，然后开始推进”，承接已说明的首轮：先做来源/额度对齐，同时确定 GitHub 只读监控合同，再进入 GitHub 实现。基线 main 为 ac6d46e，复用现有独立工作树，新主题分支 codex/source-quota-alignment-20261019；未启动 Agent。

- 27fe9f0：提交 [PRODUCT-DIRECTION-20261019.md](PRODUCT-DIRECTION-20261019.md)，同步 AGENTS 与旧工作台路线的优先级。公开用户、GitHub 绑定/选定仓库状态、后续本地 Git 状态及有限写操作为主线；配置健康和 DIY 暂缓。
- d703e21：实现能力/连接/新鲜度投影、内存只读 IPC、额度与来源页集成、纯逻辑与交互测试及文档。
- 按用户明确记录要求，另新增一条小型记忆扩展更新，不编辑 MEMORY.md 等核心记忆文件；其内容只记录该方向和范围，不包含账号或业务数据。

GitHub 首版合同明确连接、所选仓库、仓库状态分离；优先评估细粒度权限；只读元数据、提交、PR、Actions/检查状态；未确定桌面授权和凭据保存方案前不实现登录。该产品路线不恢复本仓库 GitHub 同步，也不授权 Git 写操作、上传、发布或后台常驻。

## 实现与复核

| 项目 | 当前行为 |
| --- | --- |
| 能力与来源一致 | 额度页显示十个内置来源和动态个人来源；Codex 支持账号额度，其他内置来源明确尚未接入，个人来源仅用量。未确认官方接口不标成“没有接口” |
| 读取与连接独立 | 来源页显示对应额度连接概览并可进入管理；额度页可定位回来源。停用来源读取不退出账号，移除账号不删除用量历史。导航本身不开始登录 |
| 多连接新鲜度 | fresh/stale/cached/missing 逐连接计数，一项成功不覆盖其他连接。启动缓存待验证、超过十分钟或已过重置时间标过期、异常未来时间保持未知；不推断额度已补足，不加总不同账号的额度 |
| 错误与恢复 | 需登录、失败、重复连接、CLI 未就绪与缓存重置有独立表达；重启保留的错误也计入概览。读取概览失败保留旧视图并明确待检查，可重试；未读到概览时连接数为 null |
| 隐私与边界 | SourceConnectionsV1 只返回来源维度、能力、状态、数量和时间，不返回账号 ID、备注、计划、额度窗口、原始错误正文或凭据。usage:connections 只访问现有内存状态，不触发发现、采集、额度刷新或认证 |
| 既有功能 | 未修改 QuotaService 的登录/注销/刷新协议、来源读取白名单、采集/计价/去重或 usage_query；没有新品牌额度、GitHub 请求、Git 命令或配置读取 |
| 界面 | 沿用中性灰、现有来源行、账号卡和 sheet，新增值在 tokens.css 定义；来源行开放状态、焦点、原有个人来源和能力详情保持正常。README 明确用量离线可用与额度官方 CLI 的区别 |

CodeGraph 当前不可用，使用定向源码、现有 IPC sender 校验、纯投影测试、真实 Electron IPC、源码及打包回归核对。新投影与 UI 的时间刷新只重新读取内存概览；没有新增 Agent/网络轮询任务。

## 执行证据

下列简写均以本工作树 artifacts/source-quota-20261019/ 为根。所有测试使用独立 usage/quota 和合成 home，未运行 validate:local。

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| npm.cmd run verify | 最终 lint 和单元 fail 0 | verify-final.log；首次失败保留 verify-first.log |
| npm.cmd run audit:runtime | 单入口、当前运行依赖与本地 UI 资源通过 | audit-runtime.log、artifacts/maintenance/runtime-audit.json |
| npm.cmd run test:native | 新合成目录、固定原生校验、来源只读及 Node 网络尝试为零 | native.log |
| npm.cmd run test:query:integration | 原 CLI/stdio 协议、分页版本、隐私和四文件查询仍通过 | query.log、query/results.json |
| 新 source-quota 源码 UI | 100%/125%/150%、800px 暗色窄窗，能力、跨页导航、独立暂停/移除、刷新/需登录缓存、概览失败重试、账本字节不变通过 | alignment-ui-fourth.log、ui/各缩放/ |
| 原 quota/custom-sources/workbench/usage 源码 UI | 全部 exit 0，现有账号生命周期、个人来源、能力详情/洞察与采集流程通过 | regression-suites.json、各 *-ui-first.log；quota/usage 沿用 artifacts/quota、artifacts/maintenance 输出 |
| 隔离构建与 audit:package | 真实 node_modules、当前产品源码/资源/必需文档与 ASAR 字节一致，包内 tokscale 固定哈希通过 | build-deps.log、build.log、audit-package.log |
| 打包 EXE source-quota UI | 三档缩放和窄窗全部通过；测试只替换实际已加载的 QuotaService 模块，验证真实 preload/IPC/渲染/持久化 | packaged-ui-first.log、packaged-ui/各缩放/ |

使用现有 Playwright 原生 Electron 流程，Browser plugin not available。已查看 125% 的额度概览、来源页和暗色窄窗截图，未见新增遮挡/横向溢出，界面无新运行错误。旧账号卡的既有布局保留；截图中的账号与路径均为合成 fixture。

## 首次失败及修正

1. 新 UI 首次隐私断言把个人来源 ID 后缀误认作账号 UUID：fixture 复用了相同 UUID；改为不同标识后保留原严格断言。日志 alignment-ui-first.log。
2. 第二次 UI 点击透明 input，被已有可见 switch-track 截获；测试改为点击用户实际操作的 switch label。日志 alignment-ui-second.log。
3. 第三次 UI 通过 app.getAppPath 拼接 src/quota，在源模式重复路径；改为定位且只接受当前进程实际加载的唯一 service 模块，源码/ASAR 共用，未加载工作树副本冒充包内模块。日志 alignment-ui-third.log。第四次三档通过。
4. 首次 verify 的静态服务白名单检查把数组首项当作语法，未识别放在首项的新脚本；保持既有 index.html 首位，把新脚本列在其后。定向服务检查及全量复跑通过，不删除断言或放宽服务范围。

## 限制与合入结论

没有真实账号或其他来源额度的接入/验证，没有 GitHub 登录、仓库读取、Git 操作、遥测、通知或开机启动。GitHub 认证方案、其他来源官方接口核对、公开分发的完整安装/升级/签名流程仍是后续阶段。合成结果不能代表这些已完成。

额度新鲜度是已保存观测的可信状态，不是后台实时探测；原额度自动刷新开关保持其独立行为。概览只读次数不构成服务商额度请求。未知用量、价格和账号值不补零。

本轮隔离包用于代码验证，不是正式发布候选；没有执行全套打包 UI、crypto 和中文空格解压副本发布验收，不生成正式 dist 代次/源码 ZIP，也不替换当前运行包或清理历史代次。GitHub 同步继续暂停。

复核未发现阻止本轮本地合入的问题。实际合入前再次确认共享 main 干净、仍为 ac6d46e、无进行中的 Git 操作；no-ff 合入后在共享目录运行 verify 与 audit:runtime，并核对内容树和 origin/main。实际合并与主目录复验写入本轮 local-merge.json 与 main-* 日志。
