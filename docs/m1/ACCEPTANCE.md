# M1-WINDOWS-LOCAL 验收记录

实施：2026-10-02；交付收尾：2026-10-03。环境：Windows x64 10.0.26300，Node 24.13.1 / npm 11.8.0，Electron 43.4.0，Tokscale 4.17.0，Playwright Electron 1.63.0。

交付结论：Windows 本地功能与打包版本的自动检查通过，五类本机选定样本有独立账本核对；生产 E2EE、iOS、外网同步、实际额度和公开发布没有实施。实现与原计划的复用差异见 UPSTREAM.md，属于 M1 评审内容。

## 自动检查

| 检查 | 结果与证据 |
|---|---|
| ESLint | M1 代码、脚本、测试通过 |
| 新增行为测试 | 15 项通过：五来源独立预期、复制/迁移、累计/fork、空字段、缓存/reasoning、WAL、源不变、共享记录、WorkBuddy fallback、日期、持久化、暂停/并发、超时退避、网络入口与 AES |
| 官方原生 Tokscale | 4.17.0，合成统计投影 6 条、694 token 聚合一致，cache-only 独立目录，哨兵未进入投影 |
| 适用上游回归 | usageDelta、historyDayBoundary、archiveHelpers、tokscaleClientMapping 共 34 项通过 |
| Electron 源码 UI | 概览/来源/设置、四范围、两种筛选、刷新、暂停恢复、导出、清空、窗口隐藏恢复，100%/150% 缩放通过 |
| Windows 打包 UI | 对实际 `dist/win-unpacked/Agent Usage M1.exe` 运行同一 Playwright 流程通过；没有 renderer 异常；最终 ZIP CRC 检查及解压后独立启动/694 token 合成采集通过 |
| 加密实验 | 两个独立 Node 测试进程，正确解密、错误密钥、密文与头部篡改、旧序号、重复投递通过 |
| 本地治理 | 冻结依赖、独立身份/入口、发布关闭、禁用旧账号入口、文档存在检查 |

上游全套额度/账号/同步/更新检查不适用于本次禁用入口，未执行；选定上游回归不代表 M1 加载了原采集/归档代码。Browser plugin 不在会话中，使用计划明确指定的 Playwright Electron，覆盖真实 Windows 主进程/preload/renderer。

截图与自动化 JSON 位于忽略的 `artifacts/`，只用合成数据。图标/CSS来自上游，M1 三入口及统计 UI 是收敛后的新界面。发现并修复上游 overflow 裁切和打包 ASAR 原生程序路径问题；最终截图可完整显示下方明细。

## 本机真实来源核对

最终抽样运行读取 **224 个文件**，归一化 **30,276 条记录**；扫描与原生校验 **3,918 ms**（首次冷运行约 5,720 ms）。采集期间本机 Codex 仍有新增记录，运行间总量变化不代表重复累计。

| 来源 | 文件 / 记录 | 独立核对方法 | 结论 |
|---|---:|---|---|
| Codex | 142 / 13,803 | 3 个非 fork 会话最后累计总量，对照解析后增量合计 | 3/3 一致 |
| Claude Code | 18 / 1,286 | 3 个 JSONL 唯一 message 账本，input+output+cache read+write | 3/3 一致 |
| OpenCode | 1 / 10,084 | 内存 SQLite 五个不重叠桶独立求和 | 一致 |
| WorkBuddy | 62 / 3,915 | 2 个详细 JSONL 及 1 个 DB aggregate 独立核对；全扫描按会话避免 fallback 重复 | 3/3 一致 |
| MiMo | 1 / 1,188 | 内存 SQLite 五个不重叠桶独立求和 | 一致 |

只读真实来源记录没有提交原文、标题、文件路径、账号或认证。脱敏详细结果留在本机 `artifacts/local-validation.json`，验收标记写在自己的 `%APPDATA%/AgentUsage-M1/validation.json`。

打包后的全量扫描额外发现 Codex 2 条 total-mismatch、WorkBuddy 4 条 invalid-reasoning。来源页显示部分支持和质量原因；这些记录不计价，独立样本一致不覆盖这些异常记录。其余三类来源在隔离测试目录因未复制真实验收标记显示 unverified，这是正确行为。

verified 只表示本机选定样本已核对；Codex Desktop/CLI 与 MiMo Desktop/CLI 的每个版本和入口未逐一人工验收，缺少明确入口时显示 unknown。不能据此声称市面上所有变种全面支持。

## 隐私与离线证据

- 合成源文件读取时拦截 fs.openSync，要求 O_RDONLY；读取路径不得是 auth.json。SQLite/WAL/SHM 在内存读测试前后文件 SHA-256 相同。SQL.js不连接源文件、没有 checkpoint 或写锁。
- 合成哨兵包含正文/邮箱/密钥标记，存储、导出、投影检查均未出现。renderer 禁用 Node，preload 只有 7 类 M1 操作；未注册旧账号/额度/同步 IPC。
- 主进程、线程的 Node fetch/http/https/net/tls 与 Electron net 入口拒绝外部请求；CSP connect-src none、webRequest 只放行 file/devtools。测试四类网络入口均拒绝；正常界面与线程检测到的网络尝试为 0。
- 原生 Tokscale 使用官方固定二进制、剥离 provider 环境、投影 home、独立配置与 cache-only 分支；没有源认证路径可读。原生聚合正常完成。
- `sourceWrites/authenticationReads: 0` 状态是受限读函数与白名单路径设计的结构性计数，结合拦截/hash测试使用，不能当作通用操作系统审计。**未做内核级网络抓包、系统范围文件访问审计或第三方二进制安全认证**；原生离线结论依赖固定源码分支与调用边界，不能宣称抓包证明所有原生 syscall 为零。
- 未更改防火墙、代理、安全策略、agent 配置或全局 Codex 配置。下载依赖、上游源码和公共价目表属于构建阶段网络行为。

## Windows 运行与剩余人工检查

实际 Windows exe 在真实来源与独立测试目录中的首次可用统计从约 21,808 ms 优化到 8,292 ms；合成新增用量通过定时采集在 15,016 / 15,004 ms 内可见（100%/150%）。

实际 Windows exe 的启动、数据目录隔离、合成采集、交互、关闭隐藏/恢复、退出测试已执行。自动化 mock 原生保存/确认对话框，验证真实导出文件与清空行为；未人工点击系统对话框。

仍需用户评审：系统托盘物理双击/菜单与第二实例唤醒、原生保存/选择目录对话框、长时间持续运行与休眠恢复、真实 Windows 显示设置的缩放（自动化采用 force-device-scale-factor）、签名/SmartScreen体验。没有做 iPhone 真机、云、生产密钥管理或公网测试。

目前 JSON 全历史扫描已在约 3 万条记录规模下测量；整轮 60 秒超时、15 秒定时意味着此规模的新数据可见目标可达 60 秒内。更大的历史、慢磁盘、持续写入数据库或未知 schema 可能退避；保留历史并报告，不承诺所有机器的延迟。

费用没有账单核对，只是 138 个明确 provider/model 固定价目项的 USD 等价估算。旧/自定义/别名模型及缺失必要字段会未定价，不推测订阅额度。

M1 停在此评审点。后续 iOS/E2EE云同步等必须获得对应阶段授权。
