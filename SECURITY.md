# 安全策略

## 报告漏洞

**请不要为安全问题开公开 issue。**

请通过 GitHub 的私密漏洞报告渠道联系维护者：

1. 打开仓库的 **Security** 标签页
2. 选择 **Report a vulnerability**
3. 填写复现步骤与影响

如果该渠道不可用，请开一个**不含技术细节**的 issue，只说明"需要私下沟通安全问题"，维护者会主动联系你。

报告时请包含：受影响的版本或提交、复现步骤、实际影响，以及你愿意公开的程度。请不要附上真实会话内容、认证文件、本机绝对路径或账号标识。

## 本项目的安全不变量

以下四条是设计承诺。任何使其中一条不成立的改动都视为安全缺陷，请按上述渠道报告：

1. **不读取认证文件。** 文件名以 `auth` / `credentials` / `config` / `settings` / `storage` / `token` 开头的文件被拒绝（`src/m1/policy.js:23`）。Codex 凭据只存在于系统 keyring，由官方 CLI 子进程访问。
2. **不修改来源数据库或配置。** 源 SQLite 仅以只读方式将字节（含已提交 WAL 页）载入内存，不建立连接、不加写锁、不迁移、不执行 checkpoint。
3. **不上传数据。** 统计、凭据与用量数字都不出本机。
4. **不发起用户未预期的网络请求。** 出网点只有两个：固定 URL 的公开价格子进程（`src/m1/price-fetch-worker.js`），以及用户主动触发的 Codex 官方 CLI。渲染层 CSP 为 `connect-src 'none'`。

## 已知安全边界

请在报告前了解当前**已知**的限制，这些是记录在案的设计现状而非新漏洞：

- **未签名构建。** `signAndEditExecutable: false`，Windows SmartScreen 会告警。`@tokscale` 原生二进制在 spawn 前不校验哈希。
- **网络封锁是 Node 层拦截，不是内核级管控。** `src/m1/policy.js:66` 的 `disableNetwork` 覆盖 `fetch`、`node:http/https`、`node:net`、`node:tls` 的常用入口，未覆盖 `http2`、`dgram`、全局 `WebSocket`、`net.Socket.prototype.connect` 或原生模块。当前代码不调用这些 API，但这不是沙箱级保证。
- **数据损坏无自动恢复。** 存储文件损坏时会显示错误并退出，不会从备份自动恢复。

## 支持范围

仅 Windows 10 / 11 x64 是被支持与验证的平台。其他平台上的行为不作安全承诺。
