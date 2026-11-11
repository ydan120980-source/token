# 合入分支的后续复核：打包与测试（2026-10-17）

`feat/package-and-ui-polish`（合入 main 为 `56ed4bf`）的计价、Antigravity 配对和界面已分别在 `PRICING-UNREPORTED-WRITES-20261017.md`、`UI-UNIFY-20261017.md` 复核。本记录覆盖剩下的打包脚本和测试改动。

## 打包：构建前检查，取代打包后修补

`f99259a` 在 `dist:win:dir` 后追加 `ensure-dist-native.js`：`node_modules` 是目录联接时 electron-builder 会漏掉 `@tokscale`，脚本就从 `node_modules` 补拷到 `app.asar.unpacked`，并在 `app.asar` 里没有 `@tokscale` 时解包、补入、重新打包。

问题：

- 重新打包用的是不带 `unpack` 参数的 `createPackage`，原本在包外的文件被整体打进 `app.asar`，"在包外"的标记丢失（用小 asar 复现：898 字节变为 200905 字节，`tokscale.exe` 的 unpacked 标记由真变假）。包里多出一份原生二进制，产物也不再是 electron-builder 的输出。
- 修补之后 `audit:package` 照常通过，本该在打包时暴露的问题被掩盖；联接导致漏掉的若不止 `@tokscale`，脚本也不会处理。
- 补拷的来源是联接指向的另一棵树，其 `@tokscale/cli` 的 JS 包不经版本或哈希校验。

改为 `scripts/m1/check-build-deps.js` 在 electron-builder 之前运行：`node_modules` 或 `node_modules/@tokscale` 是联接或符号链接就失败并说明处理办法；否则核对 `@tokscale/cli-win32-x64-msvc` 的版本和 SHA-256 与 `src/m1/native.js` 一致。打包后仍由 `audit:package` 复查。已核对：联接工作树失败，主目录与 `token-release`（真实副本）通过。没有在本次运行完整的 `dist:win:dir`，下一个候选会覆盖。

## 测试：恢复剪贴板断言

同一分支把 `sessions-ui-test.js` 的两条剪贴板断言改成"读到内容才比较"。其中恢复命令一条检查带 `$(calc)` 的恶意路径是否被正确转义，放宽后剪贴板为空也会通过。补救用的轮询同样无效：`until` 在页面里执行判断函数，函数引用的 `app` 只存在于 Node 一侧，抛出的 ReferenceError 被 `.catch(() => {})` 吞掉。复制在写入剪贴板之后才弹提示，所以提示出现后直接读取即可，两条断言恢复为无条件比较。

同一批里的其他测试改动只新增断言，没有放宽。

## 未合入的旧分支

`fix/electron-render-perf`（2026-10-13）的性能改动已被自身回退，剩下的会话页改动中，搜索清除按钮已在 main；路径和 ID 的复制在 main 上已有按钮与检查器；多关键词同时匹配、空结果时一并重置 Agent 筛选两项不在 main。是否移植由项目负责人决定，分支保留到决定为止。
