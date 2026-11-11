# 仅本机手动 Claude 维护

此目录保留历史机器配置的替换、备份、自动恢复与手动回滚能力，不属于产品依赖图或 Windows 应用打包清单。固定 loopback 代理、进程名、防火墙组和 npm Claude 目标只服务原所有者机器。其他用户使用产品安装器的应用自有目录路线。

工具仅在明确执行本入口时读取原有网络治理元数据；不会创建或修改代理、防火墙、配置、登录或额度。治理不完整、目标变化或下载失败立即停止，不改为直接网络。`check` 也会执行受控程序的 `--version`，不能当作无副作用的配置扫描。

必须手动指定原安装器数据目录（含 `claude/governed.json`、备份与下载代次的根目录），并附完整确认参数：

```powershell
node scripts/local/claude-governed/manage.js check --root 'C:\explicit\installer-data' --confirm-local-governed-maintenance
# 同样的参数结构支持 install 与 rollback；不要用示例目录执行。
```

先审阅 `engine.js`、`host.ps1` 和 `proxy.js` 的固定合同。`install` 会替换既有受控外部程序，因此需要该次具体维护授权；产品中的旧“受控升级”和“回滚”入口已移除。本次代码迁移只用合成文件、注入 HTTP 与进程执行器验证，没有在真实机器配置上运行此工具。

旧产品的维护标记和备份保留原位。产品只检查应用目录内标记是否存在，返回 `INSTALL_LOCAL_MAINTENANCE_REQUIRED`；不会自动迁移、删除标记、读取治理配置、联网或改写外部 Claude。需要解除标记时，应先另行审阅本机迁移方案。
