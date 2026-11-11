# 额度并发与登录恢复包验收（2026-10-23）

## 交付结论

主要代码提交 `934f67b`，登录/刷新互斥补丁 `796d0df`，最终运行时构建/本地主线提交 `a5e5781`。正式交付目录 `dist/quota-concurrency-20261023-r2/`。旧代次全部保留，GitHub 继续暂停；无样式改动，无安装器/签名验收，独立便携运行时未执行 hardlink 共享。

## 实现与速度

Codex 与其他服务使用同一个并发池，最多 16 个独立任务、同服务商 4 个、CLI 4 个；不同连接独立完成，同连接/同 CLI home 保持互斥，进程关闭后才释放槽位。手动与分钟刷新都覆盖符合条件的全部连接，不再等待 Codex 全部结束才启动其他服务。重新登录时只跳过当前连接的刷新，其他连接继续。

20 个全新合成 Node 子进程，每个 250ms 响应：串行 6247ms、4 并发 1615ms、8 并发 985ms、16 并发 665ms，约 9.39 倍；每档都完成并保留 20 条缓存，子进程无残留。此为合成吞吐，不等于真实网络速度。脚本为 `scripts/m1/quota-refresh-benchmark.js`。

新登录不再要求先解密旧密文：保留旧密文原字节供缓存失败回滚，新凭据加密回读验证后原子替换。受控存储阶段和白名单 OS 错误码可显示在连接提示，不返回异常原文/路径/凭据。

## 执行的验收

- `verify`：ESLint clean、fail 0；`audit:runtime` 通过，152 个可达产品模块。
- `test:native` 全新投影通过，源文件只读、Node 网络尝试 0；`test:stress` 六类通过（含 20 账号、1,000 批次调用、CLI 峰值 4、结束无 pending）；`experiment:crypto` 通过。
- 八套受影响源码 UI：provider-client、provider-login、quota-identity、quota、quota-v4、interaction-reliability、workbench、usage，通过；最终互斥补丁后复核两套登录 UI，通过。
- Windows 构建与包审计通过，255 个源码/资源/文档与 ASAR 逐字节一致；原生 tokscale 固定版本/哈希通过。
- 全部 37 套打包 UI 通过；客户端套件在 100% 和 150% 缩放验证损坏旧 WorkBuddy 密文后重新连接、加密重启恢复、实际 8 路同时读取、全部服务分钟刷新。
- Windows ZIP CRC/安全路径/逐文件内容一致；88 个运行文件，432803380 bytes；中文和空格路径解压副本逐字节一致，agent-recovery 采集套件及 quota-v4 套件通过，测试前后 EXE/ASAR 哈希不变。
- 结果提交后生成源码 ZIP，再验证 Git blob/工作树内容、源码及 Windows ZIP 的 SHA-256、完整清单。最终记录为 `artifacts/quota-concurrency-20261023-r2/delivery-verification.json`。

Windows ZIP SHA-256：`168ab38141a7f48fdd390e2d975a208ddaa3168416526e3a45542351464df302`。

## 首轮失败与候选替换

新增源码损坏密文重连用例首轮因取消夹具遗留 hang 标记超时，修正隔离后通过，未放宽产品断言。最终门禁一轮在并行 UI 时，既有 PowerShell statusline 子进程超过 15 秒；完整复跑通过，未更改该测试。首个打包候选在源码审阅发现同一行重新登录与分钟刷新竞争后暂停，补互斥及回归后另建 R2；该旧候选不是完成交付。本代次打包/解压结果以最终 suite-results 为准。

## 真实验收限制

本轮未查询真实服务商，未解密真实凭据。一个新建合成标记在本应用 vault 保存路径中加密回读成功，既有密文逐字节保持不变；它只验证该次探针环境，不证明原运行实例的失败原因。全部界面测试使用隔离合成 usage/quota/home。

本轮真实 WorkBuddy GUI 重新连接、其他真实账号刷新、长时定时轮询和旧 Antigravity 重新授权未执行。之前增量的单次真实 WorkBuddy 读取不视为本轮验收。历史额度和旧密文保留。详细范围见 `docs/m2/QUOTA-CONCURRENCY-20261023.md`。

证据：`artifacts/quota-concurrency-20261023-r2/`，包含 source-checks、source-ui、source-r2、packaged-ui、extracted-ui、extraction.json、build/audit 日志、source-acceptance.json 和最终 delivery-verification.json。
