# Antigravity 额度只读合同与 Windows 验证（2026-10-19）

所有者在额度资源后端合入后要求继续原计划，本轮推进研究拆分第2项：Antigravity CLI只读合同、解析与Windows合成验证。代码不接入产品入口、IPC、账号缓存或来源能力表；实际额度支持仍只有Codex。UI仍由Claude负责，不显示Antigravity“已支持”。

## 已核对依据

- [官方v1.1.11发布记录](https://antigravity.google/docs/changelog#v1111)说明print mode增加/usage等只读命令的结构化输出，不开启Agent轮次或消耗额度。最低版本取1.1.11。
- [官方/usage说明](https://antigravity.google/docs/cli/commands/usage/)说明该命令向后端刷新模型配置和额度；它会访问账号服务，不能当作纯本地统计。
- [官方headless合同](https://antigravity.google/docs/cli/headless/)说明JSON包络、状态、stdout/stderr和print-timeout，也说明headless使用CLI已缓存授权。应用不自行读取这些授权文件，但启动CLI仍可能间接触发其认证和配置行为。
- 结构化usage分组目前依据[Orca固定提交的协议记录](https://github.com/stablyai/orca/blob/051708702c62367d1a9b91f68a5071bf8c21b21a/src/main/rate-limits/antigravity-usage-response.ts)，其样本是macOS agy 1.2.11。只参考字段与风险说明，未引入Orca依赖或复制其实现；本轮夹具是自行构造的合成数据。

网页于本轮再次读取。官方对命令语义的说明、第三方协议样本和本项目Windows实测是三种不同证据；后者目前只涉及合成Node子进程，不能冒充真实Antigravity验收。

## 模块与调用合同

| 模块/函数 | 输入 | 输出/边界 |
| --- | --- | --- |
| src/quota/antigravity-command.js: commandPlan(executable) | 用户明确选择的Windows本地绝对.exe路径 | 冻结计划；不查PATH、不读文件、不spawn |
| version/supportedVersion | 有界、单一CLI版本文本 | 标准版本或拒绝；不接受预发布、多个版本或任意日志文字 |
| src/quota/antigravity-resources.js: fromAntigravity(stdout,fetchedAt,cliVersion) | 有界结构化输出及观察时间 | 白名单AccountQuotaV2，provider=antigravity；无IO |
| src/quota/antigravity-probe.js: inspectAntigravity({executable,run,signal,now}) | 调用方注入run，不提供默认真实传输 | 两阶段单次检查；成功返回quota及有限evidence，失败仅受控errorCode和null quota |
| scripts/m1/quota-probe-process.js | 合成测试指定的Node进程与临时目录 | 开发验证传输，产品禁止导入；不为真实Antigravity提供运行入口 |

没有更改QuotaService、Codex RPC、main/preload、连接列表或现有缓存。新的纯模块可以被后续受审的适配器使用；本轮只由测试导入。产物目录由现有构建通配符管理，不据模块存在宣称来源能力已上线。

## 固定命令与版本门禁

计划先查询`--version`，外部上限5秒；确认版本后才允许`-p /usage --output-format json --print-timeout 20s`这一组固定参数，外部上限30秒。shell=false、windowsHide=true；stdout和stderr合计最多512KiB。不接受任意参数、附加prompt、shell拼接、.cmd/.bat/.ps1、UNC或PATH命令。

`--disable-slash-commands`会把命令变成提示的风险来自参考实现；本合同不包含该参数，也不包含跳过权限、恢复会话、指定模型或重试模型的参数。错误不自动重试，没有轮询或后台任务。

当前支持的**协议版本区间**保守设为1.1.11至1.2.11（含端点）。这是准备阶段的已审查范围，不是对所有版本的兼容声明，也不是官方最新版本号。高于上限同样拒绝，需先审查目标版本的包络、命令处理和启动副作用后更新测试与上限。版本字符串本身不能证明程序来源、二进制未被替换或零副作用，真实接入仍需后述验收。

## 输出与生命周期语义

仅解析`command.name=usage`的`command.data.groups[].buckets[]`，不从人类展示response和description抽取额度、模型ID或账号。分组名保留作标签；桶ID来自结构化字段。同组多个窗口留在同一个池，不将“Claude and GPT models”拆成两个池。

协议没有稳定组ID，本轮用组内桶ID排序后的SHA-256生成本地pool ID，窗口顺序、组顺序和展示名变化不改变ID；桶集合变化会产生新ID，不能拿它跨账号、跨套餐或与另一入口自动合并。modelIds为空，scope与会员资格均unknown，到期时间未提供为null。当前只解码/usage窗口，不实现/credits或购买包读取。

remaining_fraction必须是[0,1]内的有限number，转为对应窗口百分比，不四舍五入为整数；非法值保留unknown/issues，缺失不置零。disabled=true保留为禁用窗口，不能画成可用100%。weekly和5h是根据协议窗口字段映射的10080/300分钟，其他窗口保留标签且durationMins=null；cadence未知，不从名字推断日历/滚动语义。窗口reset经过的行为复用resourceView：标stale、不回满。

空groups是“未报告容量”，partial且hasMeasurements=false。缺列表、空的单个分组、重复桶ID、坏结构、超过100组或200窗口、显式partial/has_more/next_page_token都拒绝整个结果，不把截断响应发成完整额度。

接收完整JSON或有非JSON日志的逐行JSON。扫描所有JSON记录，不能只取第一个成功结果。重复usage响应、坏JSON记录、非对象记录或后续ERROR均拒绝。捕获输出只在内存中处理；成功结果不保留原包络、response、email、account ID、路径或错误详情。

## 零消费证据与身份

成功包络必须同时报告num_turns=0、conversation_id为空及五个已知token计数全为数值0；额外计数字段也必须为0。任一记录含正轮次、非空会话ID或正token计数，返回AGY_MODEL_TURN_DETECTED。非零进程退出时若仍有此证据，也优先暴露该受控错误。缺证据返回AGY_NO_TURN_UNVERIFIED；只有SUCCESS和command.name还不够。

这是**事后核对**。如果CLI已经进行了推理，解析器不能撤销消费；未来真实适配必须在首次查询前约束版本、文件身份、启动配置与副作用。遇到模型轮次必须停止该路径并人工核对，不允许循环探测。本模块没有自动重试。

成功evidence只有cliVersion、identityScope=cli-current-account-unverified、noModelTurn=reported-zero、liveEnabled=false。输出不能归入已有Google连接或某个用户邮箱；没有稳定账号/工作区证据，不能承诺多账号监控。Pro/Ultra等标签也不从分组名猜测。

## Windows 合成验证

测试通过注入run，将版本/usage两个阶段替换成仓库自己的Node夹具；不运行第三方CLI。临时工作目录有空格和中文，子进程环境只给操作系统所需变量，不继承API key、用户profile或PATH。覆盖参数原样传递、退出失败、输出洪泛、超时、取消、启动失败以及Windows /T终止合成进程树，并检查测试目录未生成账号或会话文件。

开发传输在Windows超时/取消/超限时使用系统taskkill.exe的固定PID参数，等待直接子进程和终止辅助进程结束。该测试证明已覆盖的合成进程树可以回收；它不提供生产Job Object，也没有证明父进程先退出后留下的孤儿/脱离进程能被回收。POSIX仅验证直接子进程，不宣称整棵树清理。

可重复命令：`node --test tests/m1/antigravity-quota.test.js tests/m1/quota-probe-process.test.js`。实际检查结果见[验收记录](RESULTS-ANTIGRAVITY-QUOTA-CONTRACT-20261019.md)。

## 真实接入前必须补齐的验收

1. 用户明确选择官方Windows CLI路径和本次使用的账号范围；明确单次读取会让CLI使用自己的已有授权并向服务端查额度。安装、登录、真实账号读取尚未执行。
2. 核对Windows官方分发形态、版本和二进制身份，处理版本探测与使用间替换问题。当前合同仅接受.exe，若官方实际通过shim启动，先设计专门启动合同，不放开任意shell。
3. 确认print-mode命令在启动插件、MCP、hooks、配置和模型之前如何处理，以及可否可靠隔离。不能靠“零token”推断没有工具或配置副作用，也不读取/修改真实配置来绕过它们。
4. 选择生产子进程所有权方案，覆盖正常退出留孤儿、取消、睡眠恢复和崩溃清理；开发taskkill测试不能替代Job Object或等效保证。
5. 针对目标版本和真实账号做一次有明确范围的核对：响应归属、零turn/零token、无新会话与实际余额变化、模型共享组、断开和错误恢复。服务端不给身份/会员到期/credits时继续unknown。
6. 通过后再单独接入产品服务、缓存、IPC和Claude界面，并更新来源能力。独立连接/撤销和代际隔离不得复用或冒认Codex连接。

上述真实验收、WorkBuddy授权服务端、其他来源和GitHub功能没有在本轮启动。

后续增量补充：[Windows进程所有权与文件校验](WINDOWS-QUOTA-PROCESS-20261019.md)已经实现并在源码模式合成验证Job Object、正常退出后代清理、宿主/调用方异常退出、协作取消及版本/使用之间替换拒绝。它没有完成真实CLI、启动副作用、账号归属或打包版验收；本合同的原始验收记录仍表示当时的阶段，不追溯改写为真实支持。

所有者后续明确要求[自动发现CLI路径](ANTIGRAVITY-AUTO-DISCOVERY-20261019.md)，并授权对其当前账号单次/usage核对；这替代本记录要求用户先手填/选定路径的前提。发现候选仍需程序身份与版本核验，扫描本身不读取账号。实际本机只发现桌面程序，未发现独立CLI，尚未执行额度请求。
