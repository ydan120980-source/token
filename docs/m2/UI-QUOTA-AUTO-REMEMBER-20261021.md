# 记住额度自动刷新的选择（2026-10-21）

## 所有者决定

所有者要求"自动刷新默认开启"。Claude 说明了两点：
- 现在每次启动都恢复为关闭。启动即自动刷新，意味着不需要用户操作就会定时读取账号额度。
- 这与"恢复已保存的连接时不联网，额度只在用户明确刷新时读取"的已记录决定冲突（[QUOTA-WEBSITE-LOGIN](QUOTA-WEBSITE-LOGIN-20261020.md)）。

随后所有者从三个方案中选择了"记住我的选择"：
- 首次使用仍为关闭；
- 用户开启过一次后，重启时保持开启；
- 用户关闭后，重启时保持关闭。

## 实现

- **只改渲染层**：`quota-ui.js` 在用户切换"自动刷新"时，把选择写入本机 `localStorage` 的 `agentusage.quotaAutoRefresh.v1`。
- **启动时恢复**：应用启动、第一次读到额度状态后，如果保存的是"每分钟"，且服务当前为关闭、页面不是示例模式，就通过现有的 `quotaBridge.setAutoRefresh('1min')` 重新开启。
- **后端不变**：`src/quota/service.js` 仍然以 `off` 启动，没有新增持久化或 IPC。重新开启后，第一次读取仍要等满一个间隔（`nextAutoAt` = 当前时间 + 1 分钟），启动时不会立刻发请求。
- **读不到存储时**：本机存储不可用时（例如被清除），回到关闭。
- **适用范围**：自动刷新只覆盖 Codex 账号，和原来一样；其他服务商的额度仍由用户手动刷新。

## 测试

`quota-ui-test` 原来断言重启后为 `off`（`restartOffHistoricalCache`），现在改为：
- 重启前选择了每分钟，重启后自动恢复为 `1min`；
- 下一次读取时间至少在 30 秒之后；
- 再切回关闭，并确认保存的值是 `off`。

证据字段改名为 `restartRemembersAutoRefreshHistoricalCache`。

## 验证（源码模式，合成数据）

| 检查 | 结果 |
| --- | --- |
| `npm run verify` / `audit:runtime` | 通过（fail 0） |
| 界面套件 | quota（含重启后记住选择）、continuity、overview 全部通过 |

未做：打包版、真实账号数据。
