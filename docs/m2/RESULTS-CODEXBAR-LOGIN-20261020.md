# CodexBar 登录对齐验收记录

日期：2026-10-20。实现范围：[连接合同](CODEXBAR-LOGIN-PARITY-20261020.md)。最终运行包按以下固定提交构建；源码归档在验收记录提交后核对。

## 已执行

- 十 Agent 统一连接入口；七条隔离网站登录、Claude/Gemini/Antigravity 官方 CLI 登录与独立账号切换、有限已有凭据复用、验证后加密保存、续期与删除。
- `npm run verify`：ESLint clean，单元测试 fail 0。
- `npm run audit:runtime`、`test:native`、`test:stress`、`experiment:crypto`：通过。Windows 原生 console / Job Object 合成测试验证实际 TTY、无终端凭据捕获与取消回收。
- 源码 UI：provider-login（七网站）、provider-client（官方来源选择、强制重新授权、手动密钥持久化、失败切换与取消）、provider-quota、source-quota、interaction-reliability、usage、workbench，通过；登录相关按 100% / 150% 缩放验收。
- UI 没有 CSS、设计 token 或样式改动；GitHub feature / push / PR / 远端合并未执行。

源码证据在实现 worktree 的 `artifacts/codexbar-reference-20261020` 和 `artifacts/codexbar-login-parity-20261020`。早期 UI 脚本仍假设旧默认路线／隐藏选择器的失败日志保留；调整为明确选择来源与实际可见入口后通过，没有强制点击或放宽产品守卫。

## 正式交付

- 主实现：`b2aae1b402a852cb9ed8648ce6f4788c2fee7a1a`；验证码子页面修复及反例测试：`2117a8b11206993bf945a753ee74efe68e91c792`。
- 本地运行版本合入／构建提交：`7e67abaa5b58986357ae22afd4e71380ba1f7f86`。后续验收记录只修改文档，最终 manifest 另记录 acceptanceCommit；运行源码与此提交一致。
- 最终代次：`dist/codexbar-login-20261020-final`，保留完整 `win-unpacked`、Windows ZIP、源码 ZIP、delivery JSON 与 SHA256SUMS。未签名；没有执行 runtime sharing，也没有清理既有代次。
- Windows 构建通过；`audit:package` 核对 211 个源码／资源／随包文档逐字节匹配 ASAR，原生 SHA pin 与拆包 helper 一致。
- Windows ZIP SHA-256：`b807aabaa57f3e3bfb79f727d7776f212bc7cdb1929d6ea077ff941e2a131f18`。解压到 `artifacts/codexbar-login-20261020-final/中文 空格验收/win-unpacked`，CRC 与全部 88 个文件的字节／SHA-256 对照通过。
- 最终 EXE 的全部 32 个 `*-ui-test.js`：32 通过，0 失败。解压目录中的 agent-recovery、provider-login、provider-client：3 通过，0 失败。后两项均覆盖 100% / 150% 缩放；网站登录实际等待验证码 iframe、登录后 Windows 加密与重启恢复，客户端覆盖强制授权、失败切换和取消。采集套件同时验证源字节与原生聚合。固定范围的静态配置 CLI 在解压 EXE 的 Node 模式中通过，不读真实配置。
- 源码 ZIP 在本验收记录提交后重建；最终 tracked Git／工作区逐字节对照、CRC、源码／Windows／manifest SHA-256 由 `delivery-validation.json`、交付 manifest 与 SHA256SUMS 给出。核对脚本要求全部打包／解压 UI 通过、运行文件保持不可变且 Git tree clean，才生成最终结果。

正式证据集中在 `artifacts/codexbar-login-20261020-final`：build.log、package-audit.log、packaged-frame-probe.log、packaged-ui/suite-results.json、extraction.json、extracted-ui/suite-results.json、config-cli-packaged.json，以及最终 delivery-validation.json。源码阶段证据复制在 source-evidence 与 source-reference-and-logs。

## 验证码回归的补充证据

首个候选 `dist/codexbar-login-20261020` 的 32 个旧 UI 套件全部通过，但它们没有验证码 iframe。随后按 Cloudflare／Google 官方 CSP 合同补充该状态，并在旧候选的解压运行中复现 iframe 等待超时；原日志保留于 `artifacts/codexbar-login-20261020/extracted-ui/provider-login-ui-test/run.log`。因此没有将首个候选的通过结果复用成最终候选的验收。

修复只为子页面允许已核对的 Cloudflare 与 `/recaptcha/` 地址，顶层导航／弹窗仍不允许这些地址。源码与最终 ASAR 的隐藏 Electron 集成检查均证明：实际加载跨源合成 iframe，且只有收到该 iframe 的消息后才生成并返回本站合成 Cookie。没有使用真实网站、真实验证码或前台窗口。最终七网站 UI 还要求验证码 iframe 可见后才能继续登录；测试不强制点击或跳过该状态。

## 真实验收边界

本轮真实凭据读取 0、真实服务账号请求 0、真实登录 0。网络响应、客户端认证和 API key 都是合成 fixture；Windows 加密、进程与 UI 是实际平台运行。只有此前 Codex 的真实账号验收记录仍然成立。不能把本轮结果描述为十个实际账号全部登录／额度读通。

服务商验证码、Google 嵌入浏览器策略、Cloudflare、账号资格、第三方客户端令牌格式和非公开接口漂移仍需使用者真实操作确认。ZCode 缺少可复用 key 时仍需获取并填入一次，和 CodexBar 的 API key 路线保持真实一致；OpenCode 新版未知数据库凭据不猜读，可选网站来源。官方 CLI 原生认证文件保留在每连接应用自有目录，不声称这些文件由 vault 加密；移除时清理该目录。
