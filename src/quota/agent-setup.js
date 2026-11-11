'use strict';
const definitions = require('./agent-setup-catalog');
const { MESSAGES } = require('./errors');
const { discoverAgentRuntime } = require('./agent-runtime-discovery');
const {capabilities}=require('./provider-catalog');
const ISSUE_STEPS = {
  SOURCE_BUSY: '来源文件正在写入，等待写入结束后在来源页重新检查；已有统计保留。',
  SOURCE_UNREADABLE: '检查读取位置是否存在及当前用户权限；不自动提权或更改原文件权限。',
  SOURCE_TIMEOUT: '读取达到时间限制，检查来源范围后手动重试，保留历史。',
  SOURCE_PARSE_FAILED: '检查来源版本及文件格式；自定义来源检查解析规则，保留原始数据。',
  SOURCE_USAGE_CONFLICT: '计量分类存在冲突，不累加副本、不补零；检查重复来源，未解决记录保持未定价。',
  SOURCE_USAGE_REGRESSION: '较旧快照未覆盖已保存用量，确认读取位置和文件版本。',
  USAGE_UNREPORTED: '来源没有报告部分用量，保留未知；安装或登录不能补造缺失字段。',
  CURSOR_CSV_SCHEMA: '选择包含逐请求时间、模型、输入输出和缓存分类的 CSV；汇总图表导出不适用。',
  CURSOR_SOURCE_MODE_CONFLICT: 'SDK 与 CSV 无法确认重复范围，请沿用一种来源模式，历史统计保留。',
  DEEPSEEK_FORMAT_UNSUPPORTED: '当前适配器仅核对 v2–v4；等待适配器更新，不改写会话或降级原数据。',
  DEEPSEEK_LOG_INCOMPLETE: '会话序列尚不完整，等待写入完成后重新检查，历史保留。',
  ANTIGRAVITY_MODEL_UNPAIRED: '模型记录尚未与调用数配对，用量保留、模型和费用保持未知。',
  SOURCE_ALIAS_REJECTED: '部分链接目标位于允许范围之外，确认来源位置，不自动跟随链接。',
  SOURCE_SYMLINK_REJECTED: '读取位置为链接，选择受支持的实际来源目录，不扩大扫描范围。'
};
function usageRecovery(facts, custom) {
  const raw = facts?.status || {}, paused = facts?.enabled === false;
  const codes = [...new Set((Array.isArray(raw.errors) ? raw.errors : []).filter(code => Object.hasOwn(ISSUE_STEPS, code)))];
  const state = paused ? 'paused' : ['error', 'partial'].includes(raw.status) ? raw.status : raw.observedRecords > 0 || raw.lastSuccess ? 'available' : 'not-read';
  const steps = paused ? ['来源读取已停用；到Agent 管理确认后启用，已有统计不变。'] : state === 'error' || state === 'partial' ? ['本次读取未完全成功，已有历史保留；先检查来源页的读取位置和诊断。'] : state === 'not-read' ? ['尚无可确认的读取结果；安装后须有兼容用量记录，缺少记录不等于未安装或额度为零。'] : ['已有本地用量观测，程序入口扫描结果不覆盖历史统计。'];
  steps.push(...codes.map(code => ISSUE_STEPS[code]));
  if (custom) steps.push('个人来源无需安装插件；在“编辑规则”中核对选定的 JSONL/NDJSON 路径、格式与字段映射。不会自动寻找或读取未知目录。');
  return { state, steps, issues: codes };
}
function createAgentSetup({ catalog, facts, environment, antigravity, openExternal, writeText, discover = discoverAgentRuntime }) {
  const slots = new Map();
  const allowed = agent => typeof agent === 'string' && Object.hasOwn(catalog(), agent) && (Object.hasOwn(definitions, agent) || /^custom-[a-f0-9-]{36}$/.test(agent));
  const slot = agent => { if (!slots.has(agent)) slots.set(agent, { revision: 0, signature: null, runtime: null, scanFailed: false, pending: null, busy: false }); return slots.get(agent); };
  function state(agent) {
    if (!allowed(agent)) throw new Error('SETUP_AGENT_REJECTED');
    const meta = catalog()[agent], saved = facts(agent), usage = usageRecovery(saved, meta.custom), definition = definitions[agent];
    const quotaErrors = agent === 'codex' ? [...new Set((saved.quota?.accounts || []).map(account => account.errorCode).filter(code => Object.hasOwn(MESSAGES, code)))].map(code => MESSAGES[code]) : [];
    const capability=capabilities().find(row=>row.provider===agent),providerQuotaNote=capability?.adapters.length?'额度页已提供独立连接；'+capability.reason:'个人来源只提供用量，不接入账号额度。';
    if (agent === 'antigravity') return { ...antigravity.state(), schemaVersion: 'AgentSetupV1', agent, name: meta.name, usage, providerNote: definition.note, quotaDescription: providerQuotaNote };
    const current = slot(agent), signature = JSON.stringify({ usage, quotaErrors });
    if (current.signature !== signature) { current.signature = signature; current.revision++; }
    let reason = 'scan-required', title = '检查程序入口与读取状态';
    if (meta.custom) { reason = 'custom-source'; title = '核对个人来源规则'; }
    else if (current.scanFailed) { reason = 'scan-failed'; title = '扫描未完成，上次结果仅供参考'; }
    else if (current.runtime) { reason = !current.runtime.coverage.complete ? 'scan-incomplete' : current.runtime.entries.length ? 'entry-found' : 'entry-not-found'; title = reason === 'entry-found' ? '发现程序入口，尚未核验版本与账号' : reason === 'entry-not-found' ? '已扫描位置未发现程序入口' : '部分位置未能检查'; }
    const command = !meta.custom && definition.command && reason === 'entry-not-found' && usage.state === 'not-read' ? definition.command : null;
    const actions = meta.custom ? [] : [{ id: 'installation-guide', label: definition.desktop ? '打开官方安装 / 下载指南' : '打开官方安装指南' }, ...(command ? [{ id: 'copy-install-command', label: '复制 PowerShell 安装命令' }] : []), { id: 'troubleshooting-guide', label: '打开官方排查说明' }, { id: 'rescan', label: '重新扫描程序入口' }];
    return { schemaVersion: 'AgentSetupV1', agent, name: String(meta.name).slice(0, 80), revision: current.revision, reason, title, usage,
      providerNote: definition?.note || '自定义来源只接入本地用量，不接入账号额度。',
      steps: meta.custom ? [] : ['按官方指南安装或更新；登录与账号权限在官方应用内核对。', '安装后重新打开本应用以更新 PATH，再手动重新扫描；默认位置也会检查。', '路径扫描不会执行 CLI、核对版本、登录或请求额度，也不会重试模型调用。'],
      checkedAt: current.runtime?.checkedAt || null, runtime: current.runtime ? structuredClone(current.runtime) : null,
      installation: { mode: 'guided', command: command || null, shell: command ? 'PowerShell' : null, executed: false }, actions,
      quotaDescription: agent === 'codex' ? ['Codex 额度在额度页独立连接与刷新；此引导不会登录或刷新账号。', ...quotaErrors].join(' ') : providerQuotaNote+' 本地 token、估算费用、积分及会员有效期不能相互替代。',
      notice: '打开指南、复制命令或发现文件不表示安装、登录或额度读取成功。' };
  }
  async function scan(agent) {
    if (agent === 'antigravity') return antigravity.scan();
    const current = slot(agent);
    if (!current.pending) current.pending = Promise.resolve().then(() => discover(agent, environment())).then(runtime => {
      if (runtime?.schemaVersion !== 'AgentRuntimeDiscoveryV1' || !Array.isArray(runtime.entries) || typeof runtime.coverage?.complete !== 'boolean') throw new Error('INVALID_RUNTIME_DISCOVERY');
      current.runtime = structuredClone(runtime); current.scanFailed = false; current.revision++;
    }).catch(() => { current.scanFailed = true; current.revision++; throw new Error('SETUP_SCAN_FAILED'); }).finally(() => { current.pending = null; });
    return current.pending;
  }
  async function action(request) {
    const fail = (errorCode, message, next = null) => ({ ok: false, errorCode, message, state: next });
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 3 || !['agent', 'actionId', 'revision'].every(key => Object.hasOwn(request, key)) || !allowed(request.agent) || typeof request.actionId !== 'string' || !Number.isSafeInteger(request.revision)) return fail('SETUP_ARGUMENTS_REJECTED', '请求参数无效，请刷新引导。');
    const { agent, actionId, revision } = request;
    if (agent === 'antigravity') { const result = await antigravity.action({ actionId, revision }); return { ...result, state: state(agent) }; }
    const current = slot(agent), before = state(agent);
    if (current.busy) return fail('SETUP_BUSY', '已有引导操作正在进行。', before);
    if (revision !== before.revision) return fail('SETUP_STALE', '状态已变化，请使用最新引导。', before);
    if (!before.actions.some(item => item.id === actionId)) return fail('SETUP_ACTION_UNAVAILABLE', '当前状态不适用此操作。', before);
    current.busy = true;
    try {
      if (actionId === 'rescan') { await scan(agent); return { ok: true, outcome: 'metadata-rescanned', state: state(agent) }; }
      if (actionId === 'copy-install-command') {
        await scan(agent); const next = state(agent);
        if (!next.installation.command) return fail('SETUP_ACTION_UNAVAILABLE', '发现结果已变化，安装命令未复制，请查看最新引导。', next);
        await writeText(definitions[agent].command); return { ok: true, outcome: 'command-copied', state: state(agent) };
      }
      await openExternal(actionId === 'installation-guide' ? definitions[agent].install : definitions[agent].help);
      return { ok: true, outcome: 'guide-opened', state: state(agent) };
    } catch (error) { return fail(error?.message === 'SETUP_SCAN_FAILED' ? 'SETUP_SCAN_FAILED' : actionId === 'copy-install-command' ? 'SETUP_COPY_FAILED' : 'SETUP_GUIDE_FAILED', actionId === 'rescan' || error?.message === 'SETUP_SCAN_FAILED' ? '本次扫描失败，保留上次结果；请重试。' : actionId === 'copy-install-command' ? '未能复制安装命令；可打开官方指南。' : '未能打开指南；请检查默认浏览器后重试。', state(agent)); }
    finally { current.busy = false; }
  }
  return Object.freeze({ state, action });
}
function installAgentSetup(ipcMain, valid, setup) {
  for (const [channel, count, action] of [['usage:agentSetup', 1, agent => ({ ok: true, state: setup.state(agent) })], ['usage:agentSetupAction', 1, request => setup.action(request)]]) ipcMain.handle(channel, (event, ...args) => {
    if (!valid(event)) throw new Error('IPC_SENDER_REJECTED');
    if (args.length !== count) return { ok: false, errorCode: 'SETUP_ARGUMENTS_REJECTED', message: '请求参数无效。', state: null };
    try { return action(...args); } catch { return { ok: false, errorCode: 'SETUP_AGENT_REJECTED', message: '来源不可用，请重新打开引导。', state: null }; }
  });
}
module.exports = { createAgentSetup, installAgentSetup };
