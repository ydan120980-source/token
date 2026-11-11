'use strict';
const { MIN_VERSION, MAX_REVIEWED_VERSION, version, supportedVersion } = require('./antigravity-command');

// Destinations and command text are owned by the main process. The renderer can
// request an action ID, never supply a URL, executable, shell or error message.
const GUIDES = Object.freeze({
  installation: 'https://antigravity.google/docs/getting-started',
  authentication: 'https://antigravity.google/docs/install?tab=cli',
  troubleshooting: 'https://antigravity.google/docs/cli/troubleshooting/'
});
const INSTALL_COMMAND = 'irm https://antigravity.google/cli/install.ps1 | iex';
const FAILURE_MESSAGES = Object.freeze({
  AGY_SETUP_ARGUMENTS_REJECTED: '请求参数无效，请刷新引导状态后重试。',
  AGY_SETUP_BUSY: '已有引导操作正在进行，请等待其结果。',
  AGY_SETUP_STALE: 'CLI 状态已更新，请使用最新引导。',
  AGY_SETUP_ACTION_UNAVAILABLE: '当前状态已不适用此操作，请查看最新引导。',
  AGY_SETUP_SCAN_FAILED: '重新扫描失败，已保留上次发现结果供参考。',
  AGY_SETUP_COPY_FAILED: '安装命令未能复制，请重试或打开官方指南。',
  AGY_SETUP_GUIDE_FAILED: '未能打开官方指南，请检查默认浏览器后重试。'
});
const failureResult = (errorCode, state) => ({ ok: false, errorCode, message: FAILURE_MESSAGES[errorCode], state });
const ACTIONS = Object.freeze({
  'installation-guide': Object.freeze({ id: 'installation-guide', label: '打开官方安装指南', effect: 'open-official-guide' }),
  'copy-install-command': Object.freeze({ id: 'copy-install-command', label: '复制 PowerShell 安装命令', effect: 'copy-command' }),
  'authentication-guide': Object.freeze({ id: 'authentication-guide', label: '打开官方登录指南', effect: 'open-official-guide' }),
  'troubleshooting-guide': Object.freeze({ id: 'troubleshooting-guide', label: '打开官方排查指南', effect: 'open-official-guide' }),
  rescan: Object.freeze({ id: 'rescan', label: '重新扫描 CLI', effect: 'metadata-scan' })
});
const RECOVERY = Object.freeze({
  AGY_EXECUTABLE_REQUIRED: ['runtime-required', '没有可核验的 CLI 路径', '重新扫描官方安装位置和 PATH；桌面程序和启动脚本不能代替 agy.exe。'],
  AGY_OUTPUT_LIMIT: ['output-limit', 'CLI 输出超出限制', '保留读取限制，查看官方排查指南；不要把完整输出或登录信息粘贴到应用。'],
  AGY_PROTOCOL_INVALID: ['protocol-invalid', '无法确认 /usage 返回格式', '等待适配器核对该 CLI 的结构化输出；重新安装不能证明兼容。'],
  AGY_REQUEST_FAILED: ['request-failed', '/usage 读取失败，原因尚未确认', '在自己的终端检查 CLI 登录、网络、账号权限和服务限制；应用没有从通用失败推断未登录、会员到期或额度为零。'],
  AGY_MODEL_TURN_DETECTED: ['model-turn-detected', '检测到模型调用，已停止发布本次额度', '等待适配器复核 /usage 的无模型调用约定；不要自动重试。'],
  AGY_NO_TURN_UNVERIFIED: ['no-turn-unverified', '无法证明本次读取未调用模型', '等待适配器复核；不要自动重试，也不要把未知用量当作零。'],
  AGY_TIMEOUT: ['timeout', 'CLI 读取超时', '检查网络和服务状态后由用户决定是否再次读取；重新扫描只检查文件位置，不会重试 /usage。'],
  AGY_CANCELED: ['canceled', '本次读取已取消', '保留已有数据；重新扫描不会恢复或重试已取消的请求。'],
  AGY_CLEANUP_FAILED: ['cleanup-unconfirmed', '无法确认子进程已清理', '暂停额度读取，检查残留进程并重启应用；不要自动重试或强行安装覆盖。'],
  AGY_BINARY_CHANGED: ['binary-changed', 'CLI 文件在核验后发生变化', '重新扫描并重新核验文件和版本；扫描不会执行新文件。'],
  AGY_HOST_UNAVAILABLE: ['host-unavailable', '读取运行环境不可用', '查看官方排查指南及应用进程环境；检查执行权限和文件占用，不要自动提权或更改执行策略。']
});
const numericVersion = value => value.split('.').reduce((sum, part) => sum * 10000 + Number(part), 0);
function projectSetup({ revision = 0, discovery = null, scanError = false, probe = null } = {}) {
  let reason = 'scan-required', title = '先检查 CLI 是否可用', steps = ['扫描官方安装位置和 PATH，无需手工填写路径。'];
  let install = false;
  if (scanError) {
    reason = 'scan-failed'; title = '本次扫描失败'; steps = ['上次发现结果仅供参考，不能据此判断 CLI 缺失；重新扫描或查看官方排查指南。'];
  } else if (discovery) {
    if (discovery.coverage?.issues?.includes('PLATFORM_UNSUPPORTED')) {
      reason = 'platform-unsupported'; title = '当前只支持 Windows CLI 发现'; steps = ['此入口不扫描 WSL；在受支持的 Windows 环境中检查。'];
    } else if (discovery.coverage?.complete !== true || discovery.selection?.state === 'incomplete') {
      reason = 'scan-incomplete'; title = 'CLI 扫描尚不完整'; steps = ['部分路径不可访问或扫描达到限制；检查权限、PATH 和网络盘条目后重新扫描，不要据此重复安装。'];
    } else if (discovery.selection?.state === 'ambiguous') {
      reason = 'multiple-candidates'; title = '发现多个 CLI，尚未选择'; steps = ['在终端检查官方安装位置和 PATH 中的重复版本；应用不会猜测账号或自动删除文件。'];
    } else if (discovery.selection?.state === 'single-candidate') {
      reason = 'verification-required'; title = '已发现 CLI，仍需核验'; steps = [`需要核验程序文件、版本及 /usage 协议；当前已复核版本范围 ${MIN_VERSION}–${MAX_REVIEWED_VERSION}。`];
    } else if (discovery.status === 'not-found' || discovery.status === 'desktop-only') {
      install = true; reason = discovery.status === 'desktop-only' ? 'desktop-only' : 'cli-missing';
      title = discovery.status === 'desktop-only' ? '已发现桌面版，还缺少 CLI' : '未在已扫描位置发现 CLI';
      steps = ['打开官方指南，在 PowerShell 中自行执行官方安装命令。', '安装后重新打开应用以更新 PATH，再点击重新扫描；默认目录也会自动扫描。', '终端中的 agy --version 可帮助确认安装；登录由用户在官方 CLI 中完成，应用不读取认证文件。', `官方安装器安装当前版本；若高于已复核上限 ${MAX_REVIEWED_VERSION}，仍需等待适配器更新。`];
    } else if (discovery.status === 'launcher-only') {
      reason = 'launcher-only'; title = '只发现启动脚本'; steps = ['当前读取器需要官方 agy.exe；检查官方安装目录与 PATH 后重新扫描，应用不会执行 .cmd 或 .ps1 启动脚本。'];
    } else {
      reason = 'candidate-rejected'; title = '发现的路径不满足核验条件'; steps = ['检查官方安装及链接目标；应用不会执行被拒绝的文件，也不会自动覆盖或删除它。'];
    }
    // A failure is tied to one discovery revision and only supplements the
    // selected runtime. A stale error must not hide missing/ambiguous files.
    if (reason === 'verification-required' && probe) {
      install = false;
      if (probe.errorCode === 'AGY_VERSION_UNSUPPORTED') {
        if (!probe.cliVersion || supportedVersion(probe.cliVersion)) { reason = 'version-unrecognized'; title = '无法确认 CLI 版本兼容性'; steps = ['等待核对版本输出和兼容性判定；不要根据此结果要求用户升级或降级。']; }
        else if (numericVersion(probe.cliVersion) < numericVersion(MIN_VERSION)) { reason = 'version-too-old'; title = 'CLI 版本早于已支持范围'; steps = [`按官方指南更新 CLI 后重新扫描；最低已支持版本为 ${MIN_VERSION}，更新后的版本仍需核验。`]; }
        else { reason = 'version-unreviewed'; title = 'CLI 版本尚未复核'; steps = [`当前适配器仅复核至 ${MAX_REVIEWED_VERSION}；等待适配器更新，不要求用户降级或重复安装。`]; }
      } else if (RECOVERY[probe.errorCode]) {
        [reason, title] = RECOVERY[probe.errorCode]; steps = [RECOVERY[probe.errorCode][2]];
      }
    }
  }
  const actionIds = [...(install ? ['installation-guide', 'copy-install-command'] : []), ...(reason === 'version-too-old' ? ['installation-guide'] : []), ...(reason === 'request-failed' ? ['authentication-guide'] : []), 'troubleshooting-guide', 'rescan'];
  return {
    schemaVersion: 'AntigravitySetupV1', provider: 'antigravity', revision, reason, title, steps,
    checkedAt: discovery?.checkedAt || null, lastDiscovery: discovery ? structuredClone(discovery) : null,
    cliVersion: probe?.cliVersion || null, supportedVersions: { minimum: MIN_VERSION, maximumReviewed: MAX_REVIEWED_VERSION },
    installation: { mode: 'guided', command: install ? INSTALL_COMMAND : null, shell: install ? 'PowerShell' : null, defaultDirectory: '%LOCALAPPDATA%\\agy\\bin', executed: false },
    actions: actionIds.map(id => ({ ...ACTIONS[id] })),
    quota: { liveEnabled: false, ready: false, verificationRequired: true },
    notice: '打开指南或复制命令不表示安装、登录或额度读取成功。重新扫描只检查路径，不执行 CLI。'
  };
}

function createAntigravitySetup({ discover, openExternal, writeText }) {
  let discovery = null, scanError = false, probe = null, revision = 0, pending = null, busy = false;
  const state = () => projectSetup({ revision, discovery, scanError, probe });
  function scan() {
    if (!pending) pending = Promise.resolve().then(discover).then(value => {
      // Do not retain references belonging to the scanner or renderer.
      if (value?.schemaVersion !== 'AntigravityDiscoveryV1') throw new Error('INVALID_DISCOVERY');
      discovery = structuredClone(value); scanError = false; probe = null; revision++; return structuredClone(discovery);
    }).catch(() => { scanError = true; probe = null; revision++; throw new Error('AGY_SETUP_SCAN_FAILED'); }).finally(() => { pending = null; });
    return pending;
  }
  async function action(request) {
    const failure = errorCode => failureResult(errorCode, state());
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 2 || !Object.hasOwn(request, 'actionId') || !Object.hasOwn(request, 'revision') || typeof request.actionId !== 'string' || !Number.isSafeInteger(request.revision)) return failure('AGY_SETUP_ARGUMENTS_REJECTED');
    if (busy) return failure('AGY_SETUP_BUSY');
    if (request.revision !== revision) return failure('AGY_SETUP_STALE');
    if (!state().actions.some(item => item.id === request.actionId)) return failure('AGY_SETUP_ACTION_UNAVAILABLE');
    busy = true;
    try {
      if (request.actionId === 'rescan') {
        await scan(); return { ok: true, outcome: 'metadata-rescanned', state: state() };
      }
      if (request.actionId === 'copy-install-command' || (request.actionId === 'installation-guide' && state().installation.command)) {
        // Refresh presence before advising an installation. A newly installed,
        // ambiguous or unreadable runtime invalidates the old install action.
        await scan();
        if (!state().actions.some(item => item.id === request.actionId)) return failure('AGY_SETUP_ACTION_UNAVAILABLE');
      }
      if (request.actionId === 'copy-install-command') {
        await writeText(INSTALL_COMMAND); return { ok: true, outcome: 'command-copied', state: state() };
      }
      const guide = { 'installation-guide': 'installation', 'authentication-guide': 'authentication', 'troubleshooting-guide': 'troubleshooting' }[request.actionId];
      await openExternal(GUIDES[guide]); return { ok: true, outcome: 'guide-opened', state: state() };
    } catch (error) { return failure(error?.message === 'AGY_SETUP_SCAN_FAILED' ? 'AGY_SETUP_SCAN_FAILED' : request.actionId === 'copy-install-command' ? 'AGY_SETUP_COPY_FAILED' : 'AGY_SETUP_GUIDE_FAILED'); }
    finally { busy = false; }
  }
  // Backend-only future probe handoff. Never exposed over IPC; raw stdout,
  // stderr, credentials, account identity and quota payloads are not retained.
  function recordProbeFailure(result, expectedRevision) {
    if (pending || expectedRevision !== revision || scanError || discovery?.selection?.state !== 'single-candidate' || result?.ok !== false || !(result.errorCode === 'AGY_VERSION_UNSUPPORTED' || Object.hasOwn(RECOVERY, result.errorCode))) return false;
    probe = { errorCode: result.errorCode, cliVersion: version(result.cliVersion) }; revision++; return true;
  }
  return Object.freeze({ state, scan, action, recordProbeFailure });
}
function installAntigravitySetup(ipcMain, valid, setup) {
  ipcMain.handle('quota:antigravitySetup', (event, ...args) => {
    if (!valid(event)) throw new Error('IPC_SENDER_REJECTED');
    return args.length ? failureResult('AGY_SETUP_ARGUMENTS_REJECTED', null) : { ok: true, state: setup.state() };
  });
  ipcMain.handle('quota:antigravitySetupAction', (event, ...args) => {
    if (!valid(event)) throw new Error('IPC_SENDER_REJECTED');
    return args.length !== 1 ? failureResult('AGY_SETUP_ARGUMENTS_REJECTED', null) : setup.action(args[0]);
  });
}
module.exports = { GUIDES, INSTALL_COMMAND, projectSetup, createAntigravitySetup, installAntigravitySetup };
