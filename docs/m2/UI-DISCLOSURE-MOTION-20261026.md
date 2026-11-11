# Disclosure 动效模式修正 · 2026-10-26

## 授权与范围

M5 迁移按计划 §9.4 停止后，所有者明确批准两行 vendor 修复，并要求独立验证、单独提交后继续 M5–M8。该授权是对 `UI-MIG-M4-M8-RULINGS-20261025.md` §1 vendor 禁令的此处例外，不扩大到其它 vendor、kit、theme、token、guard、后端或 IPC 修改。

仅将 `ui/src/vendor/fluid/components/accordion.tsx` 的导入与唯一调用从 `useReducedMotion` 改为 Motion 已公开的 `useReducedMotionConfig`。保留 `?? false`、组件接口、几何、spring、测量、焦点和挂载生命周期。`VENDOR.md` 已登记本地差异。

## 原因

应用以 system/full 启动，再在运行中切换系统 reduced。原会话回归在 body 已为 reduced 时，读取到折叠区中间高度 49.625px（完整高度 106px），违反 reduced 直接到终态的原断言。

本地安装的 Motion `useReducedMotion` 实现仅在 useState 中保存首次媒体值，不订阅更新，也不读取 MotionConfig。应用 providers 已把最新模式传入 MotionConfig；改用 `useReducedMotionConfig` 后读取该配置，full 对应 never，reduced 对应 always，off 还沿用既有 skipAnimations。没有新增模式、时长或视觉。

## 验证方法与证据

新增 `scripts/m1/ui-disclosure-motion-ui-test.js` 使用既有 gallery 的同一受控 Disclosure。深浅色均先确认 full 的真实中间高度，再在同一挂载上切换系统 reduced、应用 reduced 和 off；通过真实键盘输入展开/关闭，在输入后下一帧检查完整高度/零高度、aria-expanded、焦点与内容节点身份。产物在 `artifacts/ui-disclosure-motion/`。

新测试首轮直接测隐藏且尚未测量的面板，观察到 vendor 有意立即完成的初始测量交接。随后先以 off 打开/关闭一次，保留同一组件，再测实际高度弹簧。第二处测试定位误取了 gallery 的其它 aria-expanded 控件，改用已确认的面板节点。程序内 click 后同任务中的 RAF 可能早于 React/Motion 写入阶段，读取到旧高度 0；测试改用真实键盘输入完成后读取下一帧，不加固定等待，也不删除几何、焦点或中间高度断言。M5 原会话测试作同样的真实输入定位迁移，终态误差仍小于 1px。

为了保持独立提交，从已提交 M4 `d83537c` 导出 `.cache/disclosure-independent/`，只加入本两行修正、VENDOR 登记、专项脚本及本记录；在该目录构建生成物和验证。M5 草稿不进入该修复提交。该目录是本地合成验证副本，不是正式打包或交付代次。

独立目录 build、verify（fail 0）、runtime、专项、foundation、完整 gallery、设置和来源冒烟全部通过。专项和原会话套件也在当前迁移树通过，后者保留 100%/150% 比例、两层折叠、精确命令/路径、数据/未知/焦点和下一帧 reduced 终态。没有将独立修复的通过视为 M5 最终门槛通过。

独立目录日志为 `.cache/disclosure-independent/.cache/disclosure-independent-*.log`，当前树专项与会话日志为 `.cache/disclosure-special.log`、`.cache/disclosure-sessions.log`。独立截图原件在该副本的 artifacts 内，并复制到当前树 `artifacts/ui-disclosure-motion/independent/`，供统一审核。已查看深浅色展开截图，没有新增几何或外观差异。最终专项脚本再次 lint 通过。

## 后续

本修复独立交 Claude 审核；验证和提交完成后按原授权恢复 M5 → MK-b → M6 → M7 → M8。没有 main 合并、远程操作、正式打包、真实来源/账号/认证/配置读取或子代理。

署名：Codex
