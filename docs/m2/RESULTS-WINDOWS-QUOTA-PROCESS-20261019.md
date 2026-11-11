# Windows 额度进程与文件一致性验收（2026-10-19）

在本地main d092db9b0d99f81f3aed3307aa67271a68d8bd2f基础上，按所有者“继续”推进Windows进程所有权、文件身份和启动审查。范围/接口/限制见[实现合同](WINDOWS-QUOTA-PROCESS-20261019.md)。这是源码模式开发验收，不是发布候选。

## 已完成与检查

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| Job Object与文件校验 | 已实现，未连接产品入口 | src/quota/windows-job*、executable-pin、antigravity-windows-run |
| Windows合成测试 | 正常退出后的detached后代、目标超时/洪泛/取消、宿主及调用方强制退出、锁定/替换拒绝通过 | artifacts/windows-quota-process-20261019/job-tests-fixed.log及最终verify |
| 合成CLI全链路 | 临时编译的自有EXE经固定参数/校验/Job Object返回V2；版本/使用之间替换及改写原快照拒绝 | windows-job.test.js纳入最终verify |
| npm run verify | 通过，ESLint clean、node --test报告fail 0 | artifacts/windows-quota-process-20261019/final-verify.log |
| npm run audit:runtime | 通过，单一入口、现有产品图无新接线、无开发脚本导入 | audit-runtime.log |
| git diff --check | 通过 | 提交前实际执行 |

首次冒烟命令因shell引号失败，改用单引号here-string向Node传入脚本。宿主初次启动因禁用模块自动加载后的Join-Path依赖失败，改为.NET路径API并显式加载系统Utility模块。初次洪泛测试发现UTF-8尾截断后替换字符扩展使返回值超限，修复为完整字符解码并复跑通过。另修正终止后等待进程真正signaled的回收竞态；最终测试覆盖这些路径。失败日志保留在忽略目录，未伪装为首次通过。

## 复核

CodeGraph未提供，检查当前源码、明确导入关系、Windows结构体/标志、句柄继承、取消/回收时序与返回值。进程在执行初始线程前纳入作业，作业句柄不传给目标；正常主进程退出也不绕过后代回收。调用方死亡以持有的进程句柄观察，核对创建时间；程序快照冻结后跨阶段使用，校验与执行期间限制文件替换。

回收不确定时返回reaped=false，原始宿主诊断不透出。Job Object只承担进程成员所有权，不宣称是第三方CLI配置/文件/网络沙箱。本轮检查未发现阻断此源码准备增量合入的问题。

## 四态与未执行事项

- **已实现**：Job Object宿主、源模式传输、程序快照/锁定、固定阶段绑定与受控错误。
- **合成验证通过**：本机Windows PowerShell/.NET/Win32接口及自有Node/C#程序的上述路径。临时目录有中文和空格，环境显式传入，输出不写用户数据。
- **真实验证未执行**：真实Antigravity程序、签名、目标版本、插件/MCP/hooks启动、授权、账号归属及额度核对。公开文档不足以证明无启动副作用，版本上限不放开。
- **打包/产品未执行**：未修改main/preload、UI、Codex原有请求、账号缓存或来源能力；未改打包配置、未构建/生成ZIP/替换安装版。ASAR外辅助文件位置与完整性需正式接入验收；源模式通过不代表打包版通过。

没有读取真实认证、配置或来源日志，没有扫描/运行真实CLI、安装依赖、部署服务器、发起付费/模型调用或调用子Agent。未重复运行未受影响的界面套件。

实现、测试、合同与本记录的提交为`ce0b1729233613e330813ce76e31cb96987a6af2`（feat: own Windows quota child trees and pin executable bytes），主题分支为codex/windows-quota-process-20261019。按既有授权提交、复核后本地合入；无push/PR，origin/main保持4d011eb81a4cca62f39084909ac3e6bfe096f594。最终合入由Git记录，合入后另核对共享工作树和已验证树一致。
