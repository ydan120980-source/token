# 发布前运行依赖兼容修补 · 2026-11-01

恢复锁定依赖时，npm 报告随产品分发的两个间接依赖有公告：body-parser 2.3.0（高危）和 fast-uri 3.1.8（中危）。已先向所有者说明；这不是一次完整安全扫描，也没有观察到本产品被利用。

来源是固定的 `@modelcontextprotocol/sdk` 1.32.1：Express 引入 body-parser，Ajv 引入 fast-uri。当前保存查询入口 `src/m1/query-entry.js` 使用 StdioServerTransport，没有启用 SDK 的 HTTP 服务；产品主进程的网络隔离和外部打开地址白名单保持不变。没有为确认公告发送攻击请求、启动服务或读取真实数据。

[body-parser 公告](https://github.com/advisories/GHSA-27r3-jxmh-p828) 将 2.4.0 列为当前主版本的修复版本；[fast-uri 公告](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) 将 3.1.9 列为其 3.x 修复版本。锁文件只更新这两个 package 条目的版本、来源、完整性及对应依赖约束，根依赖/SDK/Electron 版本不变。npm 自动补入的不相关 WASI bundled 元数据没有纳入本次差异。没有执行 audit fix --force 或跨主版本升级。

安装后 `npm audit --omit=dev --json` 报告运行依赖公告为 0；外部 SDK 客户端的 stdio initialize、tools/list、tools/call、受控错误、隐私与保存账本集成通过。完整 verify、打包与新包界面验收跟随本轮 M12 候选执行，尚不能用这些定向结果代替新候选全部通过。构建工具依赖的其余公告未在本次兼容修补中清理，运行依赖审计为 0 不代表整个仓库无安全问题。
