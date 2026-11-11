# ZCode 已授权但额度桶为空（2026-10-21）

所有者在修复版完成 ZCode Chrome 授权，应用随后返回 `PROVIDER_QUOTA_UNAVAILABLE`。当前 worker 的执行顺序先完成设备授权，再请求固定账单接口；此错误在 ZCode 分支只有通过 `code === 0`、`data.balances` 数组及大小校验且数组为空时出现。因此已能区分授权接收成功与没有返回额度桶，无需再次读取已丢弃的 grant 或重复查询来诊断。无法由此判断套餐、余额为零、企业账号或没有订阅。

原行为把该成功空响应当作登录失败，凭据没有保存，用户被迫重新授权。修正限于该已核对 ZCode 响应：返回 `AccountQuotaV2` 的空 pools、`incomplete: true`、未知 entitlement；沿用正常加密连接保存。现有卡片显示“额度未知”“服务没有返回额度项”，不增加数值、不改样式。后续明确刷新可以收到真实资源包；重启只恢复加密连接与已保存空观测，不请求网络。

鉴权失败、缺少 balances、非数组、超限、未知响应结构仍失败，不保存未经验证的连接；其他适配器的空响应合同不变。合成回归覆盖首次连接、加密保存、未知显示、重启不查询、后续显式刷新获得额度，以及 malformed／401 与其他提供商空响应拒绝。源码客户端 UI 使用真正的空响应适配器验证页面与重启，避免所有来源始终返回同一 75% 假数据。

参考公开源码仍为已固定的 XDTrees/dsh-xdpool `2def4d01509784c7ebc4fe9b5d860f12a398a64f` 中 `fetchZcodeBalance` 的 balances 合同；不复用其将空额度相加为零、自动领取计划或发模型请求的行为。此补丁形成新的 `login-real-recovery-20261021-r2` 运行代次，保留此前代次；最终真实与打包结果见 [RESULTS-LOGIN-REAL-RECOVERY-20261021.md](RESULTS-LOGIN-REAL-RECOVERY-20261021.md)。
