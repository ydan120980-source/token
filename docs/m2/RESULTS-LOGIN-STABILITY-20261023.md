# 登录恢复与全服务自动刷新修复包验收（2026-10-23）

## 交付结论

代码提交 `aec2e00`，本地主线合并/运行时构建提交 `fa66f2d`。交付目录 `dist/login-stability-20261023/`；旧交付目录保留，未运行 hardlink 共享或清理，GitHub 继续暂停。此次是独立便携版，无签名/安装器验收。

## 修复范围

- 本应用 vault 启动时恢复失败后，显式刷新可重试恢复，主按钮优先“重试恢复”，不必先走新授权；保留历史观测，诊断仅返回受控阶段。
- 应用拥有的 OAuth grant 若遇到 access token 提前 401，可受限续期并重读一次；不从其他客户端复制 refresh grant，不启动自动登录。
- WorkBuddy 返回重叠页时保留前面已验证的包并标记 incomplete，重叠页不计入。非法结构/矛盾总数、授权和网络错误仍拒绝。
- 一个共享分钟定时器刷新所有符合条件的已连接服务，保留忙碌/冷却/限流保护，不重叠执行、不补历史 tick；自动 tick 不读取外部 WorkBuddy/Cursor 登录文件。
- 仅修复所有者指出的顶部 cadence 控件局部间距和压缩，沿用既有 token、样式和控件。

## 本轮实际验收

- `npm run verify`：ESLint clean、fail 0；`audit:runtime` 通过（151 个可达模块）。
- `test:native` 使用全新合成投影，通过 694 tokens、只读源及 Node 网络尝试 0 的断言。
- `test:stress` 六类通过；`experiment:crypto` 通过。
- 八套受影响源码 UI：provider-client、provider-login、quota-identity、quota、quota-v4、interaction-reliability、workbench、usage，均通过。
- 正式 Windows 构建及 ASAR 审计通过：254 个源码、资源和文档逐字节一致，解包辅助程序与 tokscale 4.17.0 固定校验通过。
- 全部 37 个 `scripts/m1/*-ui-test.js` 在真实打包 EXE 上通过，无失败。
- ZIP CRC、路径条目和逐文件内容校验通过；88 个运行文件，432796987 bytes，解压到中文/空格路径。
- 在该字节核对副本上再运行 agent-recovery、quota-v4，两套通过；EXE/ASAR 在 UI 前后不变。
- provider-client 新增断言通过：8 个合成服务实际收到自动刷新；恢复凭据不增加登录次数；100%/150% 缩放、800/1180 宽度下文字和箭头不重叠；加密重启恢复。
- 源码 ZIP 在结果提交后生成，再与 Git blob/工作树逐字节核对；最终 manifest/校验以 `delivery-verification.json` 为准。

Windows ZIP SHA256：`f81e1dcd8e805e29f41eedbe9f8cd4929a20ad7a67c56e55dc9f665ddf213225`。

## 真实数据与合成验收的区别

所有者单独授权只读本地 vault 诊断：OpenCode Zen、ZCode、WorkBuddy 的 V2 记录可解密且绑定/格式/上下文/有效期通过；两个旧 Antigravity 密文无法解密。加密副本在旧正式包的隔离启动中也能恢复前三项。原运行实例的暂时恢复失败尚未复现，不宣称确认了系统密钥丢失原因；nativeTheme 初始化假设经独立合成实验未复现，未作为结论。

所有者另行授权一次 WorkBuddy 固定积分接口只读验收：北京时间 2026-10-23 08:58:31 成功。第 1、2 页均 code=0，各 50 个包，第二页出现重叠；修复版输出 50 个可解析包并标记 incomplete=true。这不表示所有包都有可用余额，也不表示完整覆盖。只进行这一次有界调用（两页 HTTP 请求），未保存原始响应或凭据，未改写真实连接/cache；未执行模型或任务。

上述真实诊断与读取独立于正式 UI 套件，后者均使用各自的合成 usage/quota/home。GUI 真实连接写入、全服务真实定时轮询、旧 Antigravity 重新授权和长时间稳定性未验收。旧 Antigravity 密文及全部历史额度保留，不能声称已经修复这些密文。

## 证据

`artifacts/login-stability-20261023/`：source-checks、source-acceptance.json、build/audit 日志、packaged-ui、extracted-ui、extraction.json，以及最终 delivery-verification.json。

源码客户端 UI 增加恢复用例时，首次测试引用浏览器闭包外 retryId 导致工具 ReferenceError；修正稳定选择条件后两档缩放通过，最终正式包 37 套首轮全通过。未改变产品错误来迎合测试。
