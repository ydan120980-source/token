# 十 Agent 额度路线源码及发布验收（2026-10-20）

状态：源码、Windows 构建、打包 UI 与中文空格解压合成验收通过。实施范围和各 Agent 条件见 [额度路线决定](QUOTA-READINESS-RELEASE-20261020.md)。本轮所有业务/账号输入均为合成夹具，不执行新的真实账号查询，不读取真实配置或认证，不修改代理/防火墙，不调用模型，不恢复 GitHub。

## 交付内容

保留此前 `2c12b11` / `2a5600b` 的全局预算与事项证据范围、`4180603` 的批次一致性、`4eb3ad2` 的规则统一与本机安装器隔离、`6e60053` 的静态配置检查。本轮新增 Antigravity 官方状态栏 quota 被动路线，十个内置 Agent 现在都有显式读取或观测能力。Claude/Antigravity 需要本人配置回调，其余服务仍有凭据、授权、项目及覆盖范围前提。不能将“有路线”写成“真实账号全部通过”。

Antigravity 的主动 CLI 查询仍不接线。原始回调不落盘，私有桶名不透传，缺失额度不从上下文推算；不同约束不相加。源码包增加隔离本机工具以满足其合成测试依赖，但运行包继续排除 scripts。源码归档仅选择已跟踪文件，避免把目录内额外本机文件纳入交付。

## 源码验收

- `npm run verify`：首轮遇到 Windows 作业测试夹具 JSON 尚未写完就被轮询读取，调整夹具以临时文件写完后 rename 发布；复跑 ESLint 通过、单元测试 fail 0。没有降低进程清理断言。
- `test:native`、`test:stress`、`experiment:crypto`、`audit:runtime` 通过，原生验证来源只读、Node 网络尝试为零。额度队列压力仍为合成，不是服务商负载。
- 源码 provider-quota：首轮因扩展夹具误用 `providers` 路径而导出失败，改回真实产品子目录 `provider-quotas`；100%/150% 复跑通过，包含 Claude 与 Antigravity 的实际 Electron-as-Node + PowerShell 转发、脱敏和重启，真实服务商请求为零。
- 源码 source-quota、agent-setup：100%/125%/150% 通过。界面只改额度接线和必要说明，CSS、布局与 tokens 没有变化。
- Antigravity 单测验证十个能力、字段/限额、稳定顺序、未知值、适配器绑定、重复年龄保留、缺字段替换、重启、移除和 sender 守卫。

## 真实验收边界

本轮没有真实账号验收。历史记录只有 2026-10-19 的 Codex 一次成功，未在本轮重查或更新其观测。其他真实凭据未提供、Claude/Antigravity 未收到真实状态栏回调；WorkBuddy 大众 OAuth、Gemini 一键授权及网站试验接口等外部条件保持原限制。

## 正式发布检查

- 实施提交 `bad168017a732f282147e19e346c3d85309fc7aa`，本地 no-ff 合入 `f24f60ca1bb9ad1633d9fd9f4ad98d37f6d6b678`。合入前确认 main 干净、无其他 Git 进程/合并及 index lock；没有 remote 操作。
- `dist:win:dir -- --config.directories.output=dist/quota-readiness-20261020` 通过。使用 main 的物理 node_modules，预构建 tokscale 版本与 SHA-256 检查通过；没有向联接目录打包或事后补文件。
- `audit:package` 通过：207 个源码、资产、文档与 ASAR 逐字节匹配；原生二进制及 unpacked host 匹配。Windows 程序仍由 f24f60c 对应的运行时源码构建，后续验收补丁仅为测试与本文，不改变这组运行时字节。
- 全部 30 个 `scripts/m1/*-ui-test.js` 在该 Windows 程序上最终通过。首轮 20 项通过、10 项失败：8 项在首次主进程调试调用时报 promise 被回收，冲突测试未展开读取位置，概览测试 tooltip 被外部鼠标事件移走。测试 helper 增加真实 file 页面加载完成门槛，冲突测试按实际路径展开 disclosure，概览测试隔离 OS 鼠标事件；未重试业务写操作、放宽断言或改产品样式。失败套件单独复跑全部通过，首轮与复跑日志均保留。
- ZIP CRC 与中文空格解压校验通过，88 个文件逐一匹配构建目录 SHA-256。解压副本的 agent-recovery 通过实际合成采集和原生对照；provider-quota 通过两种缩放、Claude/Antigravity 实际 Electron-as-Node + PowerShell 回调、凭据内存边界和重启；配置静态 CLI 通过显式范围、脱敏和拒绝默认扫描。没有把源码 Node 单测当作打包链路验证。
- 验收测试补丁合入前再跑 `verify`（ESLint 通过、fail 0）与 `audit:runtime`，均通过。验收补丁提交及最终本地合入以 Git 和交付 manifest 的 acceptanceCommit 为准。

交付目录 `dist/quota-readiness-20261020/` 保留完整 `win-unpacked/`、Windows ZIP、源码 ZIP、`AgentUsage-CodexQuota-delivery.json`、`SHA256SUMS.txt`。源码 ZIP 只取已跟踪文件，最终逐一对照当前 main 的工作树和 Git blob；不把忽略的日志、运行数据或认证文件作为输入。Windows ZIP 在测试后保持相同字节；最终源包/程序包/manifest 的 hash 记录在交付清单，不在本文自引用。

证据位于 `artifacts/quota-readiness-20261020/`：`packaged-ui/suite-results.json` 为首轮、`packaged-ui-rerun/final-suite-results.json` 为最终合并结果，另有 `extraction.json`、`extracted-ui/suite-results.json`、`config-cli-packaged.json` 及最终 `delivery-validation.json`。完整源码检查日志在实施工作树 `.planning/quota-readiness-release-20261020/`。CodeGraph 不可用，主线程以定向源码、依赖审计、故障夹具和上述实跑核对，未调用子 Agent。

未执行：新的真实账号/真实状态栏验收、真实配置扫描、认证/浏览器读取、主动 Antigravity CLI 查询、自动登录、模型调用、网络治理操作、真实输入法候选窗或屏幕阅读器人工验收。未做代码签名；既有代次不删除。GitHub 功能与同步仍暂停。
