# 本地候选复用与签名更新准备 · 2026-11-03

所有者要求减少每次优化后的重复打包和空间占用；已选择目前没有证书，先完成本地流程和可审核配置。本流程不发布、不清理旧交付、不读取真实来源或证书。保留历史验收和失败记录。

## 日常到交付

1. 日常修改先 `npm run verify`，加直接受影响的源码界面检查，不生成日期交付目录或 ZIP。
2. `npm run candidate:plan` 只计算输入身份，说明是否有可复用包。身份包括包内源码/资源、依赖文件、完整 Electron runtime、package/lock 和独立的 UI 编译输入。
3. 正式验收才运行 `npm run candidate:build -- --generation <新名称>`。需要时先编译 UI，再执行现有依赖检查、`electron-builder --win dir --x64 --publish never` 和 `audit:package`。输出目录不可覆盖；相同输入已有包会先校验全部字节和 audit，再克隆共享文件。普通 build 不生成 ZIP。
4. 新候选的相同 runtime 文件与已有交付使用 NTFS 硬链接，按相对路径、大小和 SHA-256 检验；主程序或 ASAR 也只有逐字节相同时才共享；不同内容不共享。已有目录不被改写或删除。旧输出如需总体共享仍使用已有 `dist:share` 的静置和预检流程。
5. `npm run candidate:check -- --generation <名称> --suite sessions-ui-test.js` 针对这份包运行一个功能套件。新运行保留隔离证据和收据；输入、测试、系统/日期/显示状态及证据字节都相同的成功收据可以复用，输出明确是 `REUSED_PAST_PASS`，不是刚执行通过。`--fresh` 强制新运行。失败、未知显示状态、损坏证据不能复用。性能和高刷套件不允许通过此功能收据复用。
6. 源码和运行包 ZIP 只在最后正式交付各生成一次，保留 manifest、checksums 和解压核对。产品不变的文档整理不要求重新构建产品；最终源码归档仍包含这些文档。

硬链接是同一文件的多个目录入口，占用逻辑大小仍会显示完整文件尺寸。应同时看逻辑总量和唯一文件标识统计的实际分配估计。共享候选应视为不可变，只能创建新候选，不能在旧包中就地编辑 DLL/资源。出现改动会在下一次字节验证时拒绝复用。

## 签名与更新配置的实际状态

`npm run signing:plan` 显示 `NOT_CONFIGURED`。`scripts/m1/signed-update.config.cjs` 是未来人工使用的独立配置，不参与普通本地 dir 验收。它需要公开的 `AGENT_USAGE_SIGNING_PUBLISHER`；没有发布者时立即失败。可选 `AGENT_USAGE_UPDATE_FEED` 只允许不带凭据、查询和片段的 HTTPS 地址，否则保留可审阅的本仓库 draft 渠道描述。当前不访问渠道。

配置要求签名、更新签名验证、发布者名称、SHA-256 签名算法、NSIS x64 和 differentialPackage；发布者字段按实际 electron-builder 26.16.1 schema 放在 `win.signtoolOptions.publisherName`，并有离线 schema 测试。将来证书或签名服务只能在本机秘密设施设置，不写进仓库或聊天。即使配置了构建环境也必须使用 `--publish never`，发布另行授权。

当前没有证书/签名服务，没有签名安装包，没有引入/启动 electron-updater 客户端，没有联网检查、下载、安装、定时轮询或 GitHub Release。自动更新启用前还需要：受审的客户端与用户操作约定、真实的签名验证/篡改拒绝试验、两个版本的升级回归和获批发布渠道。配置通过不等于自动更新已经可用。

## 测试复用的边界

源码功能、打包功能、像素、内存、解压字体和真实样本是不同证据。旧像素批准不能覆盖新页面；低空闲内存不能覆盖切页峰值；同字节只允许复用同风险层的明确通过记录。界面预算按 `UI-TEST-BUDGET-20261102.md`，不自动恢复之前候选被所有者停止的套件。
