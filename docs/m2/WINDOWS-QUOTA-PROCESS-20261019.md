# Windows 额度进程所有权、文件校验与启动审查（2026-10-19）

所有者在Antigravity只读协议准备合入后要求继续。本轮推进下一项后端基础：替代仅靠PID追踪的回收方案，约束版本检查与使用之间的程序文件身份，并继续核对官方CLI启动行为。UI、Codex现有连接、main/preload、来源能力和真实账号读路径均未接线。

## 实现结构

| 模块 | 职责 |
| --- | --- |
| src/quota/executable-pin.js | 对明确选定的本地程序做有界流式SHA-256及文件身份快照；拒绝符号链接/重解析父目录、非文件、空/超大/读取中变化的文件；不查PATH |
| src/quota/windows-job.js | Windows源模式传输；校验输入/文件身份、运行自有宿主、限制宿主输出与总截止时间、处理取消和受控结果 |
| src/quota/windows-job-host.ps1 | 无profile/非交互Windows PowerShell入口，仅显式加载系统Utility模块和本项目C#；不绕过ExecutionPolicy，不加载用户模块 |
| src/quota/windows-job-host.cs | Win32 Job Object、受限句柄继承、程序锁定、进程创建、输出收集、调用方寿命、终止与回收确认 |
| src/quota/antigravity-windows-run.js | 将固定version/usage阶段绑定到不可变程序快照；拒绝不同路径、任意参数和被修改的超时/输出上限 |

Windows PowerShell与其.NET编译能力是明确的平台前提，不新增npm依赖、不安装SDK或编译器；策略禁止脚本/动态编译、缺少宿主或不支持所需Win32接口时受控失败，不回退shell或taskkill。源码C#在运行时编译，临时编译产物由系统临时目录管理，不写源码或业务目录。

## 作业与寿命

创建带KILL_ON_JOB_CLOSE的匿名作业，不开放breakaway。通过STARTUPINFOEX的JOB_LIST属性在创建时纳入作业，再恢复初始挂起线程，避免“spawn之后再按PID认领”的常规执行窗口。[微软属性合同](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute)明确JOB_LIST支持Windows 10及以后；[微软进程作业说明](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)说明子进程归属、终止及最后句柄关闭规则。

目标仅继承NUL输入与stdout/stderr写端三个指定句柄，不继承作业句柄、调用方句柄或其他宿主句柄。目标环境由调用方显式传入，不合并宿主环境；宿主自身只获得固定操作系统变量。参数用Windows argv引用规则编码，不经shell执行。

正常主进程退出后仍终止整个作业并查询活动进程数，不能因code=0就放任后台后代。目标超时或输出超限也终止作业；取消通过宿主输入控制通道协作处理，并在回收确认后返回canceled。宿主卡死时外层有硬截止，强制结束后返回JOB_CLEANUP_UNCONFIRMED/reaped=false，不冒充已验证清理。

宿主持有Node调用方的进程句柄并监测结束；同时核对调用方创建时间不晚于宿主，避免接受已经被复用的较新PID。宿主崩溃时最后作业句柄关闭，由操作系统终止成员。测试覆盖的是已成功创建并运行后的崩溃；未宣称在CreateProcess系统调用内部任意时点故障的所有结果均被形式证明。

这是一套进程所有权机制，不是文件、网络、注册表或凭据沙箱。通过外部服务代为启动的进程不一定属于该作业，不能由此声称第三方插件/MCP无副作用。

## 文件一致性

程序快照包含路径、SHA-256、字节数和文件身份；最多256MiB，哈希读取长度与前后元数据必须一致。Windows拒绝设备/UNC/替代数据流路径。快照只表达“当前选定的这些字节”，不等于官方签名/发布者证明。

绑定器保存重新校验后的冻结副本，调用方改写原快照对象不能偷换检查基线。每个阶段前再次校验；宿主自己重新打开同一映像、复核SHA-256，并用FileShare.Read在阶段全程禁止写入/删除。祖先目录保持防重命名句柄并拒绝重解析点，缩小重新解析路径的替换窗口。无法保持这些约束就拒绝启动。

文件在两个阶段之间更新，返回AGY_BINARY_CHANGED，不执行第二阶段。两阶段之间只允许相同内容/身份，不能因--version成功就永久信任同一路径。程序依赖DLL、CLI自行加载配置和工具、官方签名/发行来源尚未因此被证明。

## 输出、错误与预算

目标stdout/stderr合计最多512KiB；收集按字节计量，截断时不扩展不完整UTF-8尾字符。非法UTF-8不作为正常响应发布。JSON宿主包络预算计入转义膨胀，编译/策略诊断只在内存丢弃，不透出路径或堆栈。目标原文只供后端协议解析，不写入日志或缓存。

目标时间上限仍为version 5秒、usage 30秒；外层另留15秒宿主启动/编译预算，协作取消等待最多5秒后进入硬停止，硬停止另等3秒宿主退出。目标回收与pipe收集各有最多3秒等待。失败不会切换到旧开发传输，也不会重试模型。

runWindowsJob返回code、stdout/stderr、timedOut/canceled/overflow/reaped及受控errorCode。只有拿到本机宿主确认的回收结果才标reaped=true；启动前拒绝也可确认没有创建目标。Antigravity检查新增AGY_BINARY_CHANGED和AGY_HOST_UNAVAILABLE；不把进程/策略问题解释为登录失效、会员到期或额度耗尽。

## 本轮 Windows 验证

全部是本项目自有合成程序：Node夹具，以及临时编译、仅回答version/usage的C#控制台程序。没有发现或执行本机Antigravity。测试位于tests/m1/windows-job.test.js：

- 中文/空格工作目录、引号、空参数、尾反斜杠、shell符号原样传递；测试环境不继承API key或用户profile变量。
- 主进程正常退出后，detached后代被回收；超时、洪泛、协作取消的回收确认。
- 强制结束宿主，或强制结束Node调用方，已创建的作业成员均退出。
- 运行中程序文件无法写入，退出后释放锁；两个阶段之间替换程序、修改调用方快照均不能通过。
- 固定协议经真实CreateProcess/Job Object运行的合成EXE完成版本→usage→AccountQuotaV2，保持共享池与零turn证明；不会把此结果标作真实服务商验收。

## 公开 CLI 审查结论

再次读取了[官方headless](https://antigravity.google/docs/cli/headless/)、[设置](https://antigravity.google/docs/settings?tab=cli)、[MCP](https://antigravity.google/docs/mcp/)和[认证页](https://antigravity.google/docs/install?tab=cli)。这些页面说明CLI可以使用已有授权、全局/工作区配置和本地/远端MCP；本轮没有从这些文档查实“/usage在所有插件/MCP/hooks初始化之前短路”或一个足够覆盖它们的纯只读启动开关。缺少证据不等于已经证明它必定启动这些组件。

原安装文档入口本轮重定向到认证页，没有据此查实用户目标Windows版本的最终exe/shim分发形态。未扫描安装目录，也未选择/执行真实CLI。协议上限继续保守保持1.2.11；没有因为网页版本更新而自动放开。

## 尚未完成的接入条件

1. 用户指定目标官方CLI路径、账号范围及单次真实读取范围；官方来源/签名与目标版本仍要核对，不能把文件哈希当作发行信任。
2. 确认目标版本的启动隔离能力与凭据使用合同。Job Object不能代替插件、配置或网络副作用审查；不能通过读取/改写真实配置绕过边界。
3. 打包入口仍未接线。外部PowerShell不能直接读取ASAR内的ps1/cs；正式集成时须确定受审的实体辅助文件位置/完整性与生命周期，并完成打包、提取副本及Windows策略验收。本轮未改build配置或制造发布代次，不能称为打包版已可用。
4. 真实账号零turn/无新会话/额度与身份归属核对、连接撤销和UI接入仍未验收。当前来源能力继续Codex-only。

本轮结果见[验收记录](RESULTS-WINDOWS-QUOTA-PROCESS-20261019.md)。WorkBuddy授权服务端、GitHub功能和其他后续项未启动。

后续所有者已批准自动发现路径和单次真实/usage范围，取代手工提供路径的要求；见[自动发现决定与本机结果](ANTIGRAVITY-AUTO-DISCOVERY-20261019.md)。程序/版本核验、无账号误归属及未完成打包验收的边界仍保留。
