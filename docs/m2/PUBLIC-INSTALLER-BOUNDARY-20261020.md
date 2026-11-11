# 公共产品安装器与本机维护分离（2026-10-20）

所有者指出产品内写死个人网络和外部 Claude 目标不适合公众使用。本次选择迁移为手动本机工具，不开放任意代理、进程、防火墙组或外部目标配置。

产品 `agent-install-engine` 只安装应用自有代次；Claude 与 Codex 保留固定 npm 官方平台包、SHA-512、断点续传、解压约束、私有 home、版本复检和原子激活。产品 PowerShell host 只保留解压、签名和安装元数据模式；不再检查个人代理/进程/防火墙，不再替换外部 Claude。worker 和 service 不接受受控升级授权字段或 rollback 操作；界面去除旧操作和文案，未改 CSS、布局或设计 tokens。

既有 `claude/governance-required.json` 或 `governed.json` 标记存在时，产品只检查应用自有标记的存在性，不解析它，也不读取真实治理配置。Claude 元数据联网、安装与版本执行均停止，返回 `INSTALL_LOCAL_MAINTENANCE_REQUIRED`。旧缓存的 governed 状态转为本机维护提示，不参加全部升级，不提供外部启动命令。备份和标记不删除，避免静默转为普通网络。

原替换/回滚、固定代理和 PowerShell 预检移至 `scripts/local/claude-governed/`，由带绝对数据目录及确认参数的 `manage.js` 手动调用。该目录不被产品引用，不属于现有 `build.files` 清单。这个工具仍专用于原机器；运行真实维护需要该次授权。此迁移没有在真实机器上执行检查、下载、替换、回滚或配置修改。历史 `INSTALLER-RECOVERY-20261019.md` 和 `CLAUDE-GOVERNANCE-PROFILE-20261020.md` 的产品原路径例外自本决定起失效。

验证使用合成文件和注入进程/HTTP：公共 Claude 安装保持外部字节不变；旧标记在联网/进程之前拒绝；缓存不可恢复旧操作；本机工具保留替换、失败恢复和回滚；代理失败无直接回退。源码 UI 套件验证应用内 Claude 安装、旧维护提示与禁用、取消/重试及桌面安装复检。完整校验和运行时依赖审计结果见本工作树测试日志及交付说明。尚未进行打包验收或真实本机工具验收。
