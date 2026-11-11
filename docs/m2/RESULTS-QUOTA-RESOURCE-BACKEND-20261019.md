# 额度资源后端第一增量验收（2026-10-19）

本轮实现逻辑算法与后端，按所有者安排把V2界面交给Claude。实现和接口合同见 [额度资源后端V2与界面交接](QUOTA-RESOURCE-BACKEND-20261019.md)，可执行合成样例位于tests/m1/fixtures/quota-resources.js。本记录属于日常开发验收，不是正式发布候选。

## 交付范围与复核

- 已实现：精确十进制数量、多池/窗口/积分包、资格与有效期分离、逐项新鲜度、当前Codex响应映射、V1/V2兼容投影、旧缓存迁移及V2只读IPC。
- 只保留当前Codex真实适配。通用合同可以表达WorkBuddy积分包与Antigravity模型组，不等于这些服务商已接入。没有读取真实账号、来源日志、认证文件或其他程序配置，也没有新增请求端点或第三方服务运行。
- 当前源码复核覆盖：null与零、精度和算术边界、逐池而非整体百分比、会员失效与购买包独立、reset经过不回满、坏元数据保留issues、完整快照替换、先保存再发布、身份变更与迟到响应、白名单与IPC sender guard。
- CodeGraph工具在本环境不可用，使用定向源码检查及受影响测试核对调用链与写入路径。未调用子Agent。
- 缓存兼容复核：旧缓存启动只转换内存；同一原子文件保存resourceQuota V2和派生quota V1影子；旧版本读取可用，但旧版本再次保存会丢弃新字段，不保证无损降级。

## 实际检查

| 检查 | 结果与证据 |
| --- | --- |
| npm run verify | 通过，ESLint clean、node --test报告fail 0；artifacts/quota-resource-backend-20261019/final-verify.log |
| npm run audit:runtime | 通过，单一产品入口、无退役路径或开发脚本导入；final-audit-runtime.log |
| 新资源与服务测试 | 合成覆盖精确减法、规范化往返、输入边界、Pro实际窗口、credits-only、会员/包到期、多池时钟、来源摘要隐私、旧/新缓存重启、保存失败与迟到响应；纳入verify |
| IPC/preload测试 | 实际handler安装函数与实际preload在隔离VM中执行；两个只读入口、sender拒绝、错误脱敏与不触发RPC通过 |
| node scripts/m1/source-quota-ui-test.js | 源码Electron隔离合成回归通过，100%/125%/150%缩放；source-quota-ui.log及source-quota-ui/*/results.json |
| node scripts/m1/quota-ui-test.js | 源码Electron隔离合成回归通过，100%/150%缩放；quota-ui.log及quota-ui-results.json |
| git diff --check | 通过 |

初次lint曾发现service.js一个无效初始化赋值，修复后最终verify通过。quota UI输出含Node SQLite实验特性提示；套件报告无页面错误，未启动凭据进程。

## 现有界面兼容回归

Browser插件及browser技能未提供，使用仓库现有Electron Playwright套件，无新增依赖。每次启动都显式指定独立usage/quota目录和合成fixture home。流程为：缓存额度进入页面→来源跨页导航→刷新/登录失败→保留旧缓存并重试→移除连接但保留用量→重启后的历史缓存；另覆盖批量刷新、冷却、登录取消和弹窗交互。

页面标题/路由、有效内容、控制可响应、无页面错误均通过。来源套件另覆盖800×650窄窗口暗色模式与横向溢出断言，已查看quota-dark-narrow.png；额度失败截图artifacts/quota/error-1.png已查看，保留历史窗口并显示受控读取错误及冷却。没有更改设计或渲染文件，不据此宣称V2新界面验收通过。

## 验收状态与下一责任边界

- **已实现且合成测试通过**：上述后端、缓存、只读接口；现有界面操作兼容回归。
- **未进行真实验证**：真实Codex Pro窗口/购买余额、会员到期、积分包到期、实际Windows官方账号核对。测试替身不能代替这些证据。
- **未实现**：V2新界面、其他服务商真实额度适配、GitHub账号绑定或远端项目监控。Claude应按合同接入getV2/connectionsV2，并修正旧Pro示例的300分钟假设；完成后跑受影响界面套件。
- **未执行发布验收**：未打包、未生成交付代次或源码ZIP、未替换安装版。原生解析器和打包链路未修改，本轮不运行发布候选套件。

实现、测试、合同和本记录的代码提交为`4124de01728fe7ed18e2b6d2da58b99e0da73256`（feat: model quota resources and lifecycle with compatible cache），以本地main的`9053aac79d859ac419a730c9604f9e6071acd70c`为基线。

本轮按既有授权在主题分支codex/quota-resource-backend-20261019提交并复核后本地合入；保持GitHub同步暂停，无push/PR或远端合并。最终合入标识由Git合并提交记录，合入后另核对共享main干净、与已验证分支树一致、origin/main仍停留在4d011eb。
