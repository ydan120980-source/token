# 采集批次一致性（2026-10-20）

本增量只处理本地采集账本，不读取真实来源、不扩展来源或账号授权。GitHub 功能与远程同步继续暂停。

原先 Service 依次保存内置来源和各个自定义来源。合成故障证明：后一个自定义来源转换失败时，前面的部分结果已持久化，但整次刷新返回失败，重试和重启看到不同的完成边界。

现在 `Store.ingestCollection` 在隔离草稿里组装整批结果、生成投影，再用一次原子替换提交 `statistics.json`。一次有变化的采集只推进一次 sequence。提交成功后才发布内存账本、缓存和 Service 的采集 stamp；转换、投影或保存失败都保留原内存和原账本。无变化的自定义来源重试跳过整账本复制和保存。迁移备份可能先于最终保存生成，但不会提前发布采集事实。

来源读取不完整仍按原合同保留该来源历史，并接纳其他有效观测；它是可提交的部分观测，不与整个批次持久化失败混为一谈。独立的自定义来源管理操作保留原有保存接口。

验证均在独立临时目录、合成 home 和合成来源中执行：

- `collection-batch.test.js` 覆盖后续来源转换失败、最终 rename 失败、投影失败、单次保存、重试、重启、部分来源保留、安静重试和关闭后刷新。
- 与 collection-diagnostic、custom-sources、scan-cache 的定向组合通过。
- `npm run verify`：ESLint 通过、单元测试 fail 0。
- `npm run test:native`、`npm run test:stress`、`npm run audit:runtime` 通过。原生验证确认来源只读且 Node 网络尝试为零；压力验证包含大账本与刷新重叠。

没有进行真实来源采集、真实账号查询、正式打包或共享 main 合并。临时测试日志在本工作树 `.planning/backend-consistency-config-20261020/`，不进入源码包。
