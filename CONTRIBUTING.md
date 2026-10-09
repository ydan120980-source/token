# 贡献指南

感谢参与。本文说明如何搭建环境、修改代码以及本项目的数据语义铁律——**后者是硬约束，不是建议**。

## 环境

- Windows 10 / 11 x64（唯一被支持并可验证的平台）
- Node.js `>=22.15.0`
- Git

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
node node_modules/electron/install.js
npm.cmd run verify
```

第二条命令不能省：`--ignore-scripts` 跳过了 Electron 的 postinstall，这一句才真正下载 Electron 二进制。

## 提交前必须通过

```powershell
npm.cmd run verify
```

包含 ESLint 与全部单元测试（当前 117 项）。除此之外，按改动范围还应运行：

| 改动区域 | 需要的额外检查 |
| --- | --- |
| `src/m1/` 采集、解析、存储 | `npm run test:native`（需要 tokscale 原生二进制） |
| 渲染层、界面 | 相应的 `test:*:ui` 套件（需要 Playwright + 显示器） |
| 打包、`package.json` build 段 | `npm run audit:runtime`，以及一次 `dist:win:dir` 后 `npm run audit:package` |
| 定价 | `npm run pricing:check` |

**所有 UI 与压力测试必须指定自己的 usage/quota 目录和合成 fixture home，绝不在真实数据上跑。** 唯一允许读取真实来源的是 `npm run validate:local`，它不纳入例行验证。

## 数据语义铁律

这些规则来自已修复的真实事故，破坏任何一条都会产生看起来合理但错误的数据。

1. **未知永远不是零。** 绝不用 0 填充未知的用量或价格。未知保持 `null`，显示为"未知"；未定价显示为"未定价"。缓存命中率计算必须忽略未记录的写入，而不是把它们当 0。
2. **绝不为凑总额而关闭冲突保护。** 出现来源冲突时保留冲突并标 `partial`，不要为了让数字对上而丢弃冲突标记。
3. **替换选中快照时必须完整套用。** 新快照中不存在的属性要移除，同时保留 first-owner 身份与对象引用（见 `src/m1/sources.js`）。
4. **快照选择必须顺序无关。** 规则：valid 优先于 invalid，其次总额更大（即使 partial），再次质量/已知字段。`tests/m1/snapshot-order.test.js` 会对每种顺序对照参考规则校验。改动 `src/m1/usage-snapshot.js` 必须让该测试通过。
5. **原生验证每次必须在新建目录运行。** tokscale 的源消息缓存假定文件只追加，复用投影会冻结后续所有采集。`src/m1/native.js` 已按此实现。

## 已知陷阱

- **Playwright `page.waitForFunction` 对 async 谓词会立即 resolve。** 轮询桥接状态请用 `scripts/m1/ui-settle.js` 的 `until`，不要用 `waitForFunction`。
- **来源状态 `partial` 描述的是扫描，不是定价。** 一条记录是否已定价取决于该记录当前的质量字段，两者独立。
- **`package.json` 的 `build.files` 是白名单。** `docs/m1/UPSTREAM.md` 与 `docs/m1/CODEX-QUOTA.md` 必须留在原位——移动或改名会让打包内容与磁盘不一致，`npm run audit:package` 会失败。
- **`@electron/asar` 是传递依赖。** `scripts/m1/audit-package.js` require 它，但 `package.json` 未声明；改动依赖时注意。
- **`.gitattributes` 强制 LF。** 不要改成 CRLF：Windows 上检出 CRLF 会让按内容匹配的测试失败。

## 代码约定

- 渲染层是**本地静态 HTML/CSS/JS**，不使用打包器、不使用 ES module。新增脚本请沿用现有的 classic `<script src>` 方式，并同步更新 `design/desktop-reference/serve.js` 的静态白名单与 `scripts/m1/audit-runtime.js` 的资源检查。
- 新增来源需要在 `src/m1/policy.js` 的 `roots()`、`allowedFile()`、解析器与 `design/desktop-reference/agent-catalog.js` 之间保持一致。
- 错误使用受控的 `SCREAMING_SNAKE` 码，码表另需与 `design/desktop-reference/local-snapshot.js` 同步。
- 提交信息用 `feat:` / `fix:` / `docs:` 前缀，说明"为什么"。

## 提交与分支

- 每个被接受的增量都要提交，代码、测试与文档放在同一个提交里。
- 不要提交 `dist/`、`artifacts/`、`.planning/`、`.cache/`——已在 `.gitignore`。
- 不要提交真实 Agent 会话内容、路径、账号标识或任何个人数据到代码、测试、文档或 issue 里。

## 报告问题

安全漏洞请走 [SECURITY.md](SECURITY.md) 的私密渠道，不要发公开 issue。

其他问题请在 issue 中提供：Windows 版本、应用版本或提交、复现步骤，以及**脱敏**后的错误码。提交日志前请自行删除其中的本机路径、会话内容与账号信息。
