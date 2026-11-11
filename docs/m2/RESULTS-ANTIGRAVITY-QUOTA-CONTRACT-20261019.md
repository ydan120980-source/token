# Antigravity 只读协议准备验收（2026-10-19）

依据所有者“继续原计划推进”，在本地main的628e502c0bc245e05e498caa9ca6cc083c424b5d上实施研究拆分第2项。实现合同与真实接入条件见 [Antigravity额度只读合同](ANTIGRAVITY-QUOTA-CONTRACT-20261019.md)。本记录是开发增量验收，不是正式发布验收。

## 完成内容

- 已实现纯命令计划、保守版本区间、结构化额度解码和注入传输的两阶段检查。模型分组保持服务端边界，禁用/未知/耗尽分开；不猜账号、会员到期或购买credits。
- 包络必须明确报告零turn、空会话ID、零token计数；成功记录之后的模型轮次、错误或重复响应不能被忽略。不保存原stdout/stderr或原始身份信息。
- 新模块没有接到产品main/preload、QuotaService、账号缓存、来源支持表或自动刷新。运行时真实额度仍是Codex-only，UI没有更改。
- 无真实CLI发现、安装、登录、执行、账号请求、认证/配置读取、第三方代码执行或付费请求。未调用子Agent。Windows测试只启动本项目自有Node合成夹具，以及终止其进程树的系统taskkill。

## 实际执行与证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 受影响协议与进程测试 | 通过，fail 0 | artifacts/antigravity-quota-contract-20261019/affected-tests.log |
| 最终npm run verify | 通过，ESLint clean，node --test报告fail 0 | final-verify.log |
| npm run audit:runtime | 通过，产品仍为同一入口，无退役路径/开发脚本导入 | audit-runtime.log |
| git diff --check | 通过 | 提交前实际执行 |
| Windows合成子进程 | 版本/usage两阶段、空格中文工作目录、参数原样、无凭据环境、启动失败、超时、取消、stderr超限、整棵合成树终止通过 | 纳入verify，quota-probe-process.test.js |
| 额度合同 | 重排/改名的稳定桶集合ID、共享组、禁用窗口、未知时长、异常比例/日期、空容量、部分响应拒绝、零turn证明缺失、后续异常记录、版本越界和错误脱敏通过 | 纳入verify，antigravity-quota.test.js |

自行构造的输出投影位于artifacts/antigravity-quota-contract-20261019/synthetic-view.json。它是合同样例，不是账号截图或真实读取结果。测试环境没有生成账号/会话文件；此断言只覆盖合成夹具，不能延伸到真实CLI。

## 自审结论与限制

CodeGraph工具未提供，按定向源码与测试核对解码、错误返回、传输注入及导入关系。当前产品图不导入新Antigravity模块或开发传输。复核未发现阻断本次“协议准备增量”合入的问题。

Windows合成回收实现等待直接子进程及taskkill辅助进程退出；超时测试另确认已知合成后代PID不存在。正常退出留下孤儿或脱离进程的生产处理尚未证明，开发传输不是Job Object，不得直接作为生产传输上线。零turn检查属于事后证据，不能阻止或撤销已经发生的推理消费。

命令版本区间上限1.2.11是本轮审查协议的保守上限，未声称是最新官方版本；真实目标版本若更高，必须先审查/更新协议，而不是跳过版本拒绝。本轮没有在任何真实版本上执行命令，也没有核对插件、MCP、hooks的实际启动行为。实际账号归属、Windows官方分发与二进制替换防护、会员/credits覆盖和生产清理仍需后续验收。

## 四态与后续边界

- **已实现**：上述命令/版本/解析/检查模块，以及开发用有界进程测试工具。
- **合成测试通过**：协议边界与Windows Node子进程生命周期。
- **真实验证**：未执行；不能标记“Antigravity额度已接入”或展示为真实账号。
- **未执行**：新UI、真实授权/CLI/账号调用、WorkBuddy服务端、其他服务商、GitHub功能、正式打包和源码ZIP。现有渲染与产品接线未修改，本轮不重复运行界面套件。

实现、测试、合同和本记录的提交为`c859740fe3190fcc141e928c300c714cc78d5f1d`（feat: prepare constrained Antigravity quota protocol before live access），主题分支为codex/antigravity-quota-contract-20261019。

本轮按既有本地合入授权提交并复核，仍不push、不开PR、不修改远端。最终合并由Git记录，合入后核对共享main与已验证文件树一致、工作树干净以及origin/main仍为4d011eb81a4cca62f39084909ac3e6bfe096f594。
