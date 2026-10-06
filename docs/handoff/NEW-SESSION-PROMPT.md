# 可复制的新会话开场

```text
继续开发 Agent Usage 第二阶段。工作区：E:\project\My_project\项目测试\codex\token。

先读 AGENTS.md、docs/handoff/SESSION-HANDOFF-20261004.md 和 docs/m1/UI-POLISH-20261004.md，做简短只读核查，保留全部当前未提交改动、研究、应用数据、已有Codex连接和历史交付。不要用git reset/clean恢复旧代码，不要恢复已退役M1 GUI；src/quota/main.js是唯一产品入口。

第一阶段及后续Windows优化已交付，最新版本dist/polish-20261004。已有五来源只读统计、独立Codex额度、Nowdex Mac风格界面和共享动效。顶栏使用统计/外观/关于；760ms柔和数字、滚轮边界传递等已完成。最新包合成验证通过，真实单账号额度证据只是历史；大数据同步重绘和偶发窗口关闭根因仍是遗留问题。

完整目标是Windows主动采集 → 仅统计的端到端加密外网同步 → iPhone/iOS只读查看。请据此提出并落实第二阶段的具体范围；先核对现有UsageSnapshotV1/SourceCapability/AccountQuotaV1和加密实验，明确配对、密钥、持久防回放、只读授权与离线状态。现有AES-GCM只是合成实验，不是生产E2EE，不能直接当作完成方案。

云区域/月预算、Mac/Xcode与iPhone构建资源、iOS分发、密钥恢复及是否同步Codex额度尚需确认。先推进不依赖这些决定的源码核查和协议/验收设计；真实部署、付费、公开发布、敏感上传与新授权边界在具体可评审结果和用户批准后执行。不要默认扩展其他provider、远程控制、账号切换、autostart、重置消费或公共排行。

继续保持Nowdex Mac审美与Apple交互原则，保留现有Electron/普通JS/CSS栈。所有维护测试使用独立usage/quota目录与合成home；区分已实现、合成测试、真实验收和未执行项。不得不经每次精确配置批准启动subagent。
```
