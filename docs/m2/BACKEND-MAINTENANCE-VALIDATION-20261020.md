# 后端维护源码验收（2026-10-20）

本轮工作树：`codex/backend-handoff-20261020`。起点为 `2a5600b`（全局预算 UI 接线），共享 main 未修改。所有运行使用独立临时数据目录及合成 home；没有真实来源、账号、认证、代理/防火墙读取或维护操作。公共官方文档检索用于核对配置字段，未调用真实 Agent。

## 增量及结果

1. `4180603`：内置与自定义来源在同一草稿中组装和投影，统计账本一次原子提交；转换/投影/写入失败保留账本，部分来源读取失败保留历史。见 `COLLECTION-BATCH-CONSISTENCY-20261020.md`。
2. `4eb3ad2`：统一 AGENTS 的已实现/真实验证范围，Antigravity 保持未启用；迁出机器专用 Claude 网络治理、替换与回滚。产品只安装自有代次，旧维护标记停止该 Claude 路线。见 `PUBLIC-INSTALLER-BOUNDARY-20261020.md`。
3. 本次配置检查增量：Codex + Claude Code 独立白名单读取器、受限数据语法、脱敏投影和显式根 CLI；不接 GUI/自动扫描，不读 `.claude.json`，整体保持部分覆盖/版本未验证状态。见 `CONFIG-HEALTH-STATIC-20261020.md`；提交 ID 由 Git 历史给出。

## 已执行检查

| 检查 | 结果与范围 |
| --- | --- |
| `npm run verify` | ESLint 通过，单元测试 fail 0；包括批次转换/投影/最终 rename 故障、重试/重启和配置隐私/资源限制 |
| `npm run test:native` | 通过；来源字节只读，Node 网络尝试为零 |
| `npm run test:stress` | 通过；大 SQLite 账本、WorkBuddy 明细增长、刷新重叠/关闭、合成额度队列/RPC和大投影 |
| `npm run audit:runtime` | 通过；含独立配置 CLI，无产品对本机脚本的引用，无新增运行时依赖 |
| 本机维护脚本 ESLint | 通过；本机替换/恢复/回滚只用注入 HTTP、进程与临时程序文件验证；Windows P/Invoke 只在临时文件运行 |
| `scripts/m1/agent-install-ui-test.js` | 源码模式 100%/125%/150% 通过；应用内 Claude 安装、旧维护禁用提示、取消/重试、桌面安装复检和官方备用入口 |
| `scripts/m1/workbench-ui-test.js` | 源码模式 100%/150% 通过；现有页面集成、私有导出、失败保存恢复和重新计价 |
| `scripts/m1/usage-ui-test.js` | 源码模式 100%/150% 通过；实际合成采集、刷新/暂停、路径拒绝、导出及重启 |
| `scripts/m1/interaction-reliability-ui-test.js` | 源码模式 100%/150% 通过；合成 IME、滚动中断、保存后发现失败恢复、对话框焦点与布局 |
| `scripts/m1/agent-recovery-ui-test.js` | 源码模式 OpenCode/MiMo、100%/150% 通过；实际合成采集、原生对照、归属/成本恢复和来源字节不变 |

测试日志位于本工作树 `.planning/backend-consistency-config-20261020/`；UI 证据位于 `artifacts/backend-handoff-20261020/`（usage 固定使用 `artifacts/maintenance/`）。这些临时目录不跟踪。CodeGraph 工具不可用，调用边界使用当前源码定向搜索、依赖审计及上述测试核对。

## 未执行和保留限制

没有运行真实配置检查或本机维护 CLI，没有 MCP/hook/skill/模型执行、真实账号查询、配置修改、远程 Git 操作、共享 main 合并或正式打包；以上不是打包版验收。UI 只调整安装器动作与文案，未改 CSS、布局或设计 tokens。配置首版不模拟跨层覆盖、不核验实际客户端版本、不检查运行连接，也不加载复杂 TOML/YAML、插件或系统托管配置；这些均明确为未检查，而非健康。
