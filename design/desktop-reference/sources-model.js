'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.sourcesModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  const count = value => Number(value).toLocaleString('zh-CN');
  const when = value => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : null;
  // 'unverified' means the files were read but this parser has not been checked against a real
  // sample yet; the badge says what happened, the tooltip says what is still unchecked.
  const STATUS = { verified: '已验证', partial: '部分支持', unverified: '已读取', 'not-detected': '未检测到', error: '读取失败' };
  const STATUS_TIPS = { verified: '读取正常，解析规则已用真实样本核对', partial: '读取到了，但部分记录缺少用量字段', unverified: '读取正常；这个来源的解析规则还没有用真实样本核对过', error: '这次没有读到可用的记录，已有数据保留不变' };
  const ISSUES = {
    SOURCE_BUSY:'来源文件正在写入，稍后重新检查；已有统计保留',SOURCE_TIMEOUT:'读取超过时间限制，缩小读取范围后重试；已有统计保留',SOURCE_PARSE_FAILED:'记录格式无法解析，请检查来源版本或个人来源映射',
    CUSTOM_HISTORY_RETAINED:'部分历史文件未重读，已有观测保留',CUSTOM_COUNTER_UNSUPPORTED:'累计或汇总记录不参与计量',CUSTOM_LINE_LIMIT:'记录行过大，保留历史',CUSTOM_INCOMPLETE_LINE:'文件末行未完成，保留历史',
    SOURCE_USAGE_REGRESSION: '较旧快照未覆盖已记录用量', SOURCE_USAGE_CONFLICT: '本次扫描发现计量分类冲突；仍有冲突的记录暂停精确定价',
    DEEPSEEK_FORMAT_UNSUPPORTED: '会话版本暂不支持，保留已有统计', DEEPSEEK_SEED_INVALID: '分叉记录缺少有效继承边界', DEEPSEEK_ENCODING_CONFLICT: '同一会话出现两种编码，请保留一个读取来源',
    SOURCE_COMPRESSION_INVALID: '压缩记录尚未完整或已损坏，稍后重试', CURSOR_CSV_SCHEMA: 'CSV 需要逐请求的时间、模型、输入、输出、缓存读写字段',
    CURSOR_SOURCE_MODE_CONFLICT: 'SDK 和 CSV 无法证明是否重复；当前统计库请沿用一种来源', USAGE_UNREPORTED: '部分调用没有报告用量',
    SOURCE_USAGE_ESTIMATED: '用量是客户端估算，不是实际计量，不计费用', SOURCE_FORMAT_UNSUPPORTED: '部分记录的格式还不支持，已跳过；已有统计保留', COPILOT_SOURCE_MODE_CONFLICT: 'session-state 和 OTel 无法证明是否重复，这次没有计入；请只保留一种读取位置',
    SOURCE_ROW_INVALID: '部分记录字段不完整，已保留有效记录', DEEPSEEK_LOG_INCOMPLETE: '会话序列不连续，仅保留有效前缀',
    SOURCE_LIMIT: '文件过多或目录过深，只读取了已列出的部分', SOURCE_ALIAS_REJECTED: '有文件经链接指向读取位置之外，已跳过',
    SOURCE_UNREADABLE: '部分目录无法读取', ANTIGRAVITY_MODEL_UNPAIRED: '部分对话的模型记录与调用数对不上，这些调用的模型记为未知、不定价', SOURCE_SYMLINK_REJECTED: '读取位置本身是链接，未读取'
  };
  const PATH_STATE = { included: '已纳入读取', excluded: '已排除', stopped: '已停用' };
  const states = { 'static-ok': '静态通过', issue: '发现问题', unchecked: '未检查', 'not-applicable': '不适用' };
  const files = { 'codex-config': '.codex/config.toml', 'codex-hooks': '.codex/hooks.json', 'claude-settings': '.claude/settings.json', 'claude-settings-local': '.claude/settings.local.json', 'claude-mcp': '.mcp.json', skill: 'SKILL.md', 'skill-directory': 'Skills 目录', 'mixed-account-mcp': '用户／本地 MCP', 'client-compatibility': '客户端兼容性', instruction: '指令文件' };
  const reasons = { STRUCTURE_ONLY: '已覆盖的字段结构通过', FRONTMATTER_ONLY: '已覆盖的技能元数据通过', NO_ENTRIES: '此文件中没有配置项', FIELD_TYPE: '字段类型不符合配置要求', MAP_REQUIRED: '应使用配置对象', ENTRY_REQUIRED: '配置项应使用对象', GROUP_ARRAY_REQUIRED: '事件应包含配置组列表', GROUP_REQUIRED: '配置组结构或匹配字段有误', HANDLER_REQUIRED: '处理器应使用对象', HANDLER_VALUE_REQUIRED: '缺少处理器必需字段', TRANSPORT_CONFLICT: '命令与远程地址同时出现', TRANSPORT_REQUIRED: '缺少命令或远程地址', COMMAND_REQUIRED: '缺少有效命令', COMMAND_UNCHECKED: '命令形式未覆盖，未执行验证', URL_TYPE: '地址不是有效的 HTTP(S) 地址', TRANSPORT_UNCONFIRMED: '连接类型尚未覆盖', DYNAMIC_REFERENCE_UNCHECKED: '含动态引用，未求值', DYNAMIC_HELPER_UNCHECKED: '动态 helper 未执行', TIMEOUT_ALIAS_UNCHECKED: '超时别名同时出现，需核对客户端行为', HANDLER_UNCONFIRMED: '处理器类型尚未覆盖', EVENT_UNCONFIRMED: '事件名称尚未覆盖', EVENT_HANDLER_UNSUPPORTED: '此事件不支持该处理器', MCP_RUNTIME_UNCHECKED: '未检查真实 MCP 连接和工具', MCP_SETUP_UNAVAILABLE: '启动设置事件无法使用 MCP 工具', MCP_STARTUP_CONTEXT_UNCHECKED: '是否可用取决于会话启动上下文', ASYNC_COMMAND_ONLY: '异步选项只适用于命令处理器', SESSION_END_FORCED_SYNC: '会话结束事件会强制同步', ONCE_IGNORED_IN_SETTINGS: 'settings 中的 once 选项会被忽略', CONDITION_EVENT_UNSUPPORTED: '此事件不支持该条件，处理器不会运行', CONDITION_UNCHECKED: '条件未求值', HOOKS_DISABLED_IN_FILE: '此文件显式关闭 hooks，最终状态还取决于其他配置层', HOOKS_ALIAS_UNCHECKED: '使用旧开关别名，需核对客户端行为', HOOKS_PRECEDENCE_UNCHECKED: '新旧开关同时存在，未推断优先级', SKILL_FIELD_REQUIRED: '缺少必需的技能名称或描述', DUPLICATE_SKILL_NAME: '同一 Agent 和范围中存在重复技能名', BOOLEAN_COERCION_UNCHECKED: '布尔值兼容行为取决于客户端版本', CONTEXT_UNCONFIRMED: '技能执行上下文尚未覆盖', REFERENCES_NOT_FOLLOWED: '只检查引用结构，不跟随引用路径', CLIENT_VERSION_UNVERIFIED: '未核对已安装客户端版本', MIXED_ACCOUNT_FILE_EXCLUDED: '混合账号文件不读取，此范围的 MCP 未覆盖', ENOENT: '未找到候选文件或目录', EACCES: '没有读取权限', EPERM: '系统拒绝读取', PATH_REJECTED: '目录联接或符号链接未读取', FILE_TYPE: '文件类型或链接数不符合只读要求', FILE_CHANGED: '读取期间文件发生变化，请重试', FILE_LIMIT: '文件超过大小上限', TOTAL_LIMIT: '达到本次总读取上限', FRONTMATTER_LIMIT: '技能前言超过读取上限', FRONTMATTER_MISSING: '未找到完整技能前言', DUPLICATE_KEY: '存在重复配置键', PARSE_UNSUPPORTED: '语法无法由当前安全解析器确认', PARSE_LIMIT: '达到解析上限', ENTRY_LIMIT: '达到检查项上限，剩余项未检查', READ_UNAVAILABLE: '文件暂时无法读取', ROOT_OBJECT_REQUIRED: '配置根应使用对象' };
  const errors = { CONFIG_CHECK_BUSY: '已有目录选择或检查正在进行。', CONFIG_CHECK_TIMEOUT: '检查超时，可重试。', CONFIG_CHECK_CANCELLED: '已取消检查。', CONFIG_ROOT_NOT_SELECTED: '请先选择范围目录。', CONFIG_SELECTION_REJECTED: '所选目录不可用，请选择本机普通目录。', CONFIG_CHECK_FAILED: '检查未完成，可重试；若有上次结果，将继续显示。' };
  const managementErrors = { CONFIG_MANAGEMENT_UNSUPPORTED:'此 Agent／范围不支持这项管理；Claude MCP 目前只支持项目级 .mcp.json。',CONFIG_ROOT_NOT_SELECTED:'请先选择此范围的目录。',CONFIG_PREVIEW_STALE:'预览已失效，请重新读取并预览。',CONFIG_CHANGED:'文件已变化，未覆盖新内容。请重新读取后再操作。',CONFIG_FORMAT_UNSUPPORTED:'此文件的语法或结构不在安全编辑范围内，未修改。',CONFIG_IMPORT_COLLISION:'有同名配置或目录，导入不会覆盖。',CONFIG_IMPORT_REJECTED:'导入内容不符合本地配置／Skill 目录要求，未修改。',CONFIG_FILE_REJECTED:'文件类型、链接数或大小不符合要求。',CONFIG_PATH_REJECTED:'目录存在链接或越界，操作已拒绝。',CONFIG_BACKUP_UNAVAILABLE:'系统加密不可用，无法建立备份，未写入。',CONFIG_EDIT_INVALID:'填写的字段或组合不符合配置要求，请检查。',CONFIG_NO_CHANGE:'本次预览没有实际变化。',CONFIG_UNDO_UNAVAILABLE:'没有可撤销的本次修改。',CONFIG_CHECK_BUSY:'已有检查或目录选择正在进行。',CONFIG_MANAGEMENT_LIMIT:'达到管理读取上限，未继续读取。' };
  const labels={id:'调用 ID（必填）',session:'会话 ID（可选）',time:'时间（必填）',model:'模型',provider:'计费服务商',input:'输入 Token',output:'输出 Token',cacheRead:'缓存读取',cacheWrite:'缓存写入',reasoning:'推理 Token',total:'报告总量'};
  const MESSAGES={CUSTOM_SOURCE_OVERLAP:'读取位置与其他来源重叠。请选择独立目录，停用来源也会保留其范围。',SOURCE_PRODUCT_OVERLAP:'不能选择本应用的数据目录或其上级目录。',CUSTOM_FIELD_INVALID:'请填写有效的调用 ID、时间与用量字段路径；不能使用原型属性。',CUSTOM_CONFIG_INVALID:'配置格式或计数选项不完整，请检查后重试。',CUSTOM_COUNTER_UNSUPPORTED:'首版只支持每次调用独立用量，累计快照和会话汇总不会相加。',CUSTOM_PREVIEW_STALE:'文件或统计在预览后发生变化，请返回并重新预览。',CUSTOM_BUSY:'正在采集或执行其他来源操作，请稍后重试。',CUSTOM_NO_RECORDS:'没有找到可计量记录。请检查格式、调用 ID、时间与过滤条件。',SOURCE_SYMLINK_REJECTED:'读取目录本身不能是链接，请选择实际目录。',SOURCE_TIMEOUT:'读取超时，历史统计保留。可缩小读取目录后重试。',CUSTOM_DRAFT_STALE:'草稿已过期，请关闭后重新编辑。'};
  function failure(error) {const code=Object.keys(MESSAGES).find(code=>String(error.message).includes(code));return MESSAGES[code] || '操作未完成，原设置与历史统计保留。请检查配置或读取位置后重试。';}

  function create(state, agents) {
  function demoDiscovery() {
    const files = { codex: [144, 6], claude: [20, null], opencode: [1], workbuddy: [62, 1, null, null], mimo: [1], gemini: [null], cursor: [null], zcode: [1], deepseek: [44, null], antigravity: [17, null, null] };
    const homes = { codex: ['.codex\\sessions', '.codex\\archived_sessions'], claude: ['.claude\\projects', '.claude\\transcripts'], opencode: ['.local\\share\\opencode'], workbuddy: ['.workbuddy\\projects', '.workbuddy\\workbuddy.db', '.workbuddy-ai\\projects', '.workbuddy-ai\\workbuddy.db'], mimo: ['.local\\share\\mimocode'], gemini: ['.gemini\\tmp'], cursor: ['.cursor\\projects'], zcode: ['.zcode\\cli\\db\\db.sqlite'], deepseek: ['.dsh\\sessions', '.dsh\\profiles\\desktop\\sessions'], antigravity: ['.gemini\\antigravity\\brain', '.gemini\\antigravity-cli\\brain', '.gemini\\antigravity-ide\\brain'] };
    const latest = new Date(Date.now() - 36e5).toISOString();
    return { schemaVersion: 'SourceDiscoveryV1', checkedAt: new Date().toISOString(), unsupported: [{ id: 'kiro', name: 'Kiro', markers: ['~/.kiro'] }, { id: 'trae', name: 'Trae', markers: ['~/.trae'] }],
      sources: Object.keys(agents).map(agent => {
        const paths = homes[agent].map((home, index) => ({ path: 'C:\\Users\\demo\\' + home, display: '~\\' + home, origin: 'auto', state: 'included', exists: files[agent][index] !== null, kind: home.endsWith('.db') || home.endsWith('.sqlite') ? 'file' : 'directory', files: files[agent][index], latest: files[agent][index] ? latest : null, issues: [] }));
        const total = paths.reduce((n, entry) => n + (entry.files || 0), 0);
        return { agent, enabled: true, installed: total > 0, files: total, latest: total ? latest : null, paths };
      }) };
  }
  function selection(sources) {
    if (!sources) return;
    const previous = state.discovery;
    state.discovery = { ...previous, unsupported: previous?.unsupported || [], sources: sources.map(source => {
      const old = previous?.sources.find(item => item.agent === source.agent);
      return { ...old, ...source, paths: source.paths.map(entry => ({ display: entry.path, exists: false, files: null, issues: [], ...old?.paths.find(item => item.path === entry.path), ...entry })) };
    }) };
    state.stale = true;
  }
  function sourceLine(source, status) {
    if (source && !source.enabled) return '已停用 · 历史统计保留';
    if (state.stale) return '文件信息待重新检查 · 历史统计保留' + (status?.lastSuccess ? ' · 最近成功 ' + when(status.lastSuccess) : '');
    if (source && !source.installed) return '本机未检测到这个 Agent';
    const parts = [];
    if (source) parts.push(source.files ? count(source.files) + ' 个记录文件' : '已安装，没有可读的用量记录');
    if (status?.observedRecords != null) parts.push(count(status.observedRecords) + ' 条已读取记录');
    const latest = when(source?.latest);
    if (latest) parts.push('最近变化 ' + latest);
    if (status?.lastSuccess) parts.push('最近成功 ' + when(status.lastSuccess));
    return parts.join(' · ');
  }

    return {demoDiscovery,selection,sourceLine};
  }
  // What a record's quality means, in the words the pricing page uses for the same thing (src/m1/pricing-labels.js).
  const QUALITY = { conflict: '两个来源记下的用量不一致', partial: '用量字段不完整', 'invalid-cache': '缓存数量大于输入，记录自相矛盾', 'invalid-reasoning': '推理数量大于输出，记录自相矛盾', 'total-mismatch': '分项之和与总量对不上', 'missing-inputUncached': '来源没有报告输入 Token', 'missing-output': '来源没有报告输出 Token', 'missing-cacheRead': '来源没有报告缓存读取', 'missing-cacheWrite': '来源没有报告缓存写入', 'missing-reasoning': '来源没有单独报告推理 Token' };
  const STAGE = { queued: '等待执行', resolving: '获取官方安装信息', dependency: '准备应用内运行环境', downloading: '下载安装文件', verifying: '核验安装文件', extracting: '解压已核验的原生程序', installing: '正在安装', postcheck: '复检安装结果', checking: '检查官方最新版本', 'awaiting-installer': '等待完成安装界面', complete: '已完成', failed: '操作失败', canceled: '已取消' };
  const STATE = { unchecked: '未检查', missing: '未安装 · 扫描范围内未发现', installed: '已安装', broken: '无法运行', multiple: '发现多个安装', incomplete: '检查未完成', unverified: '已发现 · 版本未知' };
  function label(row) { return row?.version || STATE[row?.state] || '未检查'; }

  function installerView(row){const waiting=row.stage==='awaiting-installer',progress=row.totalBytes&&row.downloadedBytes!=null?Math.min(1,row.downloadedBytes/row.totalBytes):null;return {waiting,progress,percent:row.downloadedBytes&&row.totalBytes?Math.floor(progress*100)+'%':null,stage:STAGE[row.stage]||'正在处理',attempt:row.attempt>1?' · 第 '+row.attempt+' 次下载尝试':''};}
  function installerUpgrades(snapshot){return snapshot?.rows.filter(row=>row.updateAvailable&&(row.managed||['workbuddy','cursor','zcode'].includes(row.agent))).length||0;}
  const setupWhen=value=>new Date(value).toLocaleString('zh-CN');
  function programStatus(row,hasRecords=false) { if(!row)return null;if(row.state==='missing'&&hasRecords)return '程序不在扫描范围内，记录可以读到';if(row.busy)return STAGE[row.stage]||'正在处理';if(row.updateAvailable)return '程序 '+label(row)+' · 可升级到 '+row.latest;return row.state==='unchecked'?null:'程序 '+label(row); }
  function installActions(row, disabled) { const waiting=row.stage==='awaiting-installer';return [
    {action:'install',label:row.updateAvailable?'升级':row.state==='missing'||row.state==='unchecked'?'安装':row.managed?'重新安装':['workbuddy','cursor','zcode'].includes(row.agent)?'安装 / 升级':'安装应用内版本',disabled:Boolean(disabled||waiting||row.localMaintenanceRequired)},
    {action:'check',label:waiting?'复检安装':'检查',disabled:Boolean(disabled)}, {action:'official',label:'官方下载'},
    ...(waiting?[{action:'dismiss-installer',label:'安装界面已关闭'}]:[]),...(row.canCancel?[{action:'cancel',label:'取消'}]:[]),...(row.launchCommand?[{action:'copy-launch',label:'复制启动命令'}]:[])]; }
  function path(entry,stale) { const files=stale?'文件信息待检查':!entry.exists?(entry.state==='included'&&entry.origin==='auto'?'尚未出现，出现后自动读取':'不存在'):entry.state!=='included'?(entry.kind==='file'?'文件':'目录'):entry.files===null?'无法读取':count(entry.files)+' 个文件';return {meta:[entry.origin==='added'?'手动添加':null,entry.exists||entry.state!=='included'?PATH_STATE[entry.state]:null,files].filter(Boolean).join(' · '),issues:entry.issues.map(code=>ISSUES[code]||code),action:entry.state==='included'?{name:'remove',label:entry.origin==='added'?'移除':'排除'}:entry.state==='excluded'?{name:'include',label:'重新读取'}:null}; }
  function sourceSummary(state,connected) {const sources=state.discovery?.sources||[],enabled=sources.filter(s=>s.enabled);return state.busy?state.stage:state.stale?(state.discovery?'读取设置已保留 · 文件信息待重新检查':'读取位置检查未完成 · 历史统计保留'):!state.discovery?(connected?'正在检查读取位置…':'已保存的来源状态'):'读取 '+enabled.length+' / '+sources.length+' 个来源 · '+(enabled.some(s=>s.files==null)?'至少 ':'')+count(enabled.reduce((n,s)=>n+(s.files??0),0))+' 个记录文件'+(state.discovery.unsupported.length?' · 另发现 '+state.discovery.unsupported.length+' 个暂不支持的 Agent':''); }
  // 2026-10-27 (owner): no explanatory small print; the notice shows only what happened.
  function sourceNotice(state) {return [state.message,state.collection?.error?'最近采集没有完整完成':'',state.notice].filter(Boolean).join(' · '); }
  /**
   * The open items that belong to one Agent, merged by what can be done about them: a price to set, a record that
   * cannot be repaired (said so, with only 不再提醒), or a reading problem to look at. Items of no Agent stay general.
   */
  function attentionGroups(items) {
    const byAgent={},general=[],short=value=>value>=1e9?(value/1e9).toFixed(1)+'B':value>=1e6?(value/1e6).toFixed(1)+'M':value>=1e3?(value/1e3).toFixed(1)+'K':String(value);
    const open=(items||[]).filter(item=>!item.acknowledged);
    for(const item of open){if(item.agent)(byAgent[item.agent]||=[]).push(item);else general.push(item);}
    const cards=Object.fromEntries(Object.entries(byAgent).map(([agent,list])=>{
      const price=list.filter(item=>item.fix==='price'),accept=list.filter(item=>item.fix==='accept'),other=list.filter(item=>item.fix==='source'),rows=[];
      if(price.length)rows.push({key:'price',kind:'act',title:price.length+' 个模型没有价格',effect:short(price.reduce((sum,item)=>sum+(item.tokens||0),0))+' Token 没算进费用',ids:price.map(item=>item.id),models:price.map(item=>item.modelKey).filter(Boolean)});
      if(accept.length){const records=Math.max(...accept.map(item=>item.records||0)),estimated=agent==='continue',which=records?count(records)+' 条':'部分记录';rows.push({key:'accept',kind:'accept',title:estimated?'用量是客户端估算，不是实际计量':'记录本身不完整，无法修复',effect:estimated?which+'没算进费用':which+'没算进费用，其余正常',ids:accept.map(item=>item.id),models:[]});}
      for(const item of other)rows.push({key:item.id,kind:'source',title:item.what.replace(/^[^：]*：/,''),effect:item.effect,ids:[item.id],models:[]});
      return [agent,rows];
    }));
    const all=Object.values(cards).flat(),act=all.filter(row=>row.kind!=='accept').length+general.length;
    return {cards,general,act,accept:all.filter(row=>row.kind==='accept').length};
  }
  function sourceRow(state,id,meta,demo) {const source=state.discovery?.sources.find(s=>s.agent===id),status=state.statuses?.find(s=>s.agent===id),stopped=source&&!source.enabled;const issues=[...new Set(status?.errors||[])].map(code=>ISSUES[code]||'读取暂不可用：'+code);return {source,status,stopped,issues,label:meta.custom?(meta.archived?'已移除':stopped?'已停用':issues.length?'部分支持':'已读取'):stopped?'已停用':state.stale?'待检查':source&&!source.installed&&!status?.observedRecords?'未检测到':status?.status==='unverified'&&!status.lastSuccess?'尚未读取':STATUS[status?.status]||(demo?'本机样本已验证（示例）':'尚未读取'),tip:STATUS_TIPS[status?.status],quality:Object.entries(status?.qualityIssues||{}).map(([kind,n])=>(QUALITY[kind]||'有些记录不完整')+'：'+n+' 条').join('；'),changed:source?.paths.some(e=>e.origin==='added'||e.state==='excluded')}; }
  function configProjection(state,agent,scope,kind,pending,message) {const item=state.selections[agent+':'+scope],result=item?.result,summary=result?.summary[kind],known=['codex','claude'].includes(agent),busy=pending||state.busy;const candidates={mcp:['codex-config','claude-mcp'],hooks:['codex-config','codex-hooks','claude-settings','claude-settings-local'],skills:['codex-config','skill','skill-directory']};return {item,known,busy,selection:known?item?(scope==='home'?'用户根目录已选择':'项目根目录已选择'):'尚未选择范围目录':'此 Agent 的配置检查尚未适配。用量与安装支持不代表配置检查已支持。',message:message||(busy?'正在处理…':item?.error?errors[item.error]||'检查未完成。':''),summary:summary?states[summary.state]+' · 问题 '+summary.counts.issue+' · 未检查 '+summary.counts.unchecked+' · 静态通过 '+summary.counts['static-ok']+' · '+new Date(item.checkedAt).toLocaleTimeString('zh-CN')+(item.error?'（上次结果）':''):'尚无检查结果',files:(result?.files||[]).flatMap(file=>{const checks=file.checks.filter(row=>row.kind===kind||kind==='skills'&&row.kind==='skill-overrides'||row.kind==='file'&&candidates[kind].includes(file.kind));return checks.length?[{title:(files[file.kind]||'配置文件')+(file.index?' · 第 '+file.index+' 个目录项':'')+' · '+checks.length+' 项',checks:checks.map(check=>({...check,label:states[check.state],reason:reasons[check.reason]||'该项尚未检查，请核对所选文件。',location:check.location?['entry','event','group','handler'].filter(k=>check.location[k]).map(k=>({entry:'配置项',event:'事件',group:'组',handler:'处理器'}[k])+' '+check.location[k]).join(' · ')||check.location.section:''}))}]:[];}),empty:!result?(known?'':'暂只支持 Codex 和 Claude Code'):'此类别没有已覆盖的检查项。'}; }
  function editPatch(values) {const patch={};for(const [field,value] of Object.entries(values))if(value.trim()){if(field==='args'){try{patch.args=JSON.parse(value);}catch{throw Error('参数应为 JSON 字符串列表，例如 ["--help"]。');}}else patch[field]=field==='timeout'?Number(value):value;}if(!Object.keys(patch).length)throw Error('请填写至少一个要修改的字段。');return patch;}
  function customConfig(form) {const result={schemaVersion:'CustomSourceV1',name:form.name.trim(),template:form.template,mode:form.mode};if(result.template==='mapped'){if(!form.input||!form.reason)throw Error('CUSTOM_CONFIG_INVALID');const mapping={};for(const [key,value] of Object.entries(form.mapping))if(value.trim())mapping[key]=value.trim();let filters;try{filters=JSON.parse(form.filters||'[]');}catch{throw Error('CUSTOM_CONFIG_INVALID');}Object.assign(result,{mapping,filters,inputSemantics:form.input,outputIncludesReasoning:form.reason==='yes',timeUnit:form.time});}return result;}
  function previewRows(s) {return [['记录文件',s.files],['可计量调用',s.records],['Token 总量',s.totalTokens],['新增记录',s.added],['替换记录',s.replaced],['移除记录',s.removed],['保留历史文件',s.retained],['重复观测',s.duplicates],['冲突',s.conflicts],['无效记录',s.invalid],['过滤行',s.filtered],['不支持的计数',s.unsupported],['可估算费用的调用',s.pricedRecords],...Object.entries(s.unknown).map(([key,n])=>[(labels[key]||{inputUncached:'未缓存输入'}[key]||key)+' 未报告',n])];}
  function createInsights(state,window,collection){
  const count=value=>new Intl.NumberFormat('zh-CN').format(value);
  const money=value=>value===null?'未定价':value>0&&value<.005?'<$0.01':window.displayValues.usd(value);
  // Budget thresholds are user-entered settings; retain their finer precision.
  const budgetMoney=value=>value>0&&value<.0000005?'<$0.000001':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(value);
  const cost=row=>row.lower===null?'未定价':row.lower===row.upper?money(row.lower):money(row.lower)+' – '+money(row.upper);
  const agent=id=>state.general?.sources.find(s=>s.agent===id)?.name||window.agentCatalog.agents[id]?.name||'全部来源';
  const fieldNames={inputUncached:'未缓存输入',output:'输出（含推理）',cacheRead:'缓存读取',cacheWrite:'缓存写入',reasoning:'推理'};
  const issueNames={SOURCE_BUSY:'来源文件正在写入',SOURCE_UNREADABLE:'来源暂不可读',SOURCE_PARSE_FAILED:'来源格式暂不可解析',SOURCE_LIMIT:'扫描达到范围限制',SOURCE_TIMEOUT:'扫描超时',SOURCE_ROW_INVALID:'部分用量记录无效',SOURCE_USAGE_CONFLICT:'同调用的观测存在冲突',SOURCE_USAGE_REGRESSION:'观察到较旧的用量快照',CUSTOM_HISTORY_RETAINED:'部分文件沿用已保存历史',CUSTOM_COUNTER_UNSUPPORTED:'记录的计数方式暂不支持',USAGE_QUALITY_PARTIAL:'用量字段缺失或存在冲突',USAGE_UNPRICED:'部分用量未计入费用估算',PROJECT_UNATTRIBUTED:'部分用量缺少项目归属',BUDGET_EXCEEDED:'已观测估算达到预算',BUDGET_POSSIBLY_EXCEEDED:'估算区间可能达到预算',BUDGET_INCOMPLETE:'未定价用量使预算无法完整判断',BUDGET_UNPRICED:'当前用量尚无法估算费用'};
  const KINDS=[['sources','来源'],['cost','费用'],['sessions','会话'],['budget','预算']];
  const PERIODS={daily:'今天',weekly:'本周',monthly:'本月',total:'全部历史'};
  const budgetOverview=()=>state.general?.budgetOverview;
  const budgetKey=row=>row.scope+':'+row.period;
  const budgetName=row=>row.projectLabel||row.projectName||(row.scope==='all'?'全部项目':row.scope==='unknown'?'未知项目':'无法关联的项目');
  const budgetStates={'not-set':'当前项目与周期尚未设置预算。','no-data':'当前周期没有已观测记录，无法判断预算使用情况。',unpriced:'当前用量未定价，无法判断预算使用情况。',exceeded:'已计价部分的估算下限已达到预算。','possibly-exceeded':'估算区间上限已达到预算，实际情况仍不确定。',incomplete:'已计价部分尚未达到预算；仍有未定价用量，不能确认总额在预算内。','observed-below':'当前已观测的估算低于预算；这不是实际账单或额度保证。','scope-missing':'项目已不在当前已保存记录中，无法判断预算使用情况。'};
  const budgetLabels={'no-data':'暂无观测记录',unpriced:'费用尚未定价',exceeded:'已观测估算达到预算','possibly-exceeded':'估算区间可能达到预算',incomplete:'仍有未定价用量','observed-below':'已观测估算低于预算','scope-missing':'无法判断预算'};
  // The last failed collection (Service.get().diagnostic, src/m1/collection-diagnostic.js) is
  // one live item at the top of the list: it cannot be acknowledged and leaves once a collection
  // completes. The diagnostic is global, so it never names a source (UI-COLLECTION-DIAGNOSTIC-20261022.md).
  const STAGES={'source-watch':'监视来源变化','source-stamp':'检查来源文件变化','source-refresh':'刷新来源','source-scan':'扫描来源文件','native-verification':'统计组件核对','custom-source':'读取自定义来源',discovery:'检查读取位置',worker:'采集进程',collection:'采集',ingest:'写入本机统计',maintenance:'维护本机数据'};
  const RETRY='可以重新检查',REINSTALL='重新安装本应用后再试';
  const REASONS={
    EACCES:['没有访问权限','检查该位置的访问权限后重新检查'],EPERM:['没有访问权限','检查该位置的访问权限后重新检查'],
    ENOENT:['文件或目录不存在','确认读取位置仍然存在'],ENOTDIR:['路径不是目录','确认读取位置仍然正确'],EISDIR:['路径是目录而不是文件','确认读取位置仍然正确'],
    ENOSPC:['磁盘空间不足','释放磁盘空间后重试'],EMFILE:['同时打开的文件过多','关闭部分程序后重试'],ENFILE:['同时打开的文件过多','关闭部分程序后重试'],
    EIO:['磁盘读写出错','检查磁盘后重试'],EBUSY:['文件被其他程序占用','稍后重试'],EROFS:['目标位置只读','确认本应用的数据目录可以写入'],EINVAL:['路径或参数无效','确认读取位置仍然正确'],ETIMEDOUT:['操作超时','稍后重试'],
    NATIVE_UNAVAILABLE:['统计组件不可用',REINSTALL],NATIVE_BINARY_MISMATCH:['统计组件校验不一致，已拒绝运行',REINSTALL],NATIVE_TIMEOUT:['统计组件运行超时','稍后重试'],NATIVE_OUTPUT_LIMIT:['统计组件输出超出上限',RETRY],
    NATIVE_FAILED:['统计组件运行失败',RETRY],NATIVE_SCHEMA_MISMATCH:['统计组件输出格式不符',REINSTALL],NATIVE_TOTAL_MISMATCH:['统计组件合计与逐条记录不一致',RETRY],
    COLLECTION_TIMEOUT:['采集超时','稍后重试'],COLLECTION_WORKER_FAILED:['采集进程意外退出',RETRY],UNKNOWN:['原因未知',RETRY]};
  const CONTROLLED={MAINTENANCE_BUSY:'本机数据正在维护',MAINTENANCE_INCOMPLETE:'本机数据维护没有完成',MAINTENANCE_STALE:'本机数据维护状态已过期',LOCAL_STORAGE_INVALID:'本机统计文件无法使用',DISCOVERY_FAILED:'读取位置检查失败',DISCOVERY_TIMEOUT:'读取位置检查超时',SOURCE_PATH_REJECTED:'读取位置不被允许',SOURCE_SYMLINK_REJECTED:'读取位置是链接，已拒绝',SOURCE_ALIAS_REJECTED:'读取位置与其他位置重复，已拒绝',SOURCE_SIZE_OR_LINK:'来源文件过大或是链接',DATABASE_SCHEMA_UNSUPPORTED:'来源数据库结构暂不支持'};
  const errorCode=value=>/^[A-Z][A-Z0-9_]+$/.test(value||'')?value:'';
  function collectionItem(){
    const c=collection();
    return c?.error?{id:'collection',kind:'sources',scope:'collection',acknowledged:false,collection:c}:null;
  }
  function collectionSentence(c){
    const d=c.diagnostic,code=errorCode(c.error);
    // Controlled errors carry the public code in c.error; the diagnostic only says "controlled".
    const [reason,hint]=!d?[code?CONTROLLED[code]||issueNames[code]||'原因未报告':c.error,RETRY]
      :d.category==='contract'&&d.reason==='CONTROLLED_ERROR'?[CONTROLLED[code]||issueNames[code]||'采集遇到已识别的问题',RETRY]
      :REASONS[d.reason]||['原因未知',RETRY];
    const where=d?'出错环节：'+(STAGES[d.stage]||'采集'):'';
    return {what:'最近一次采集没有完成：'+reason,effect:['已有数据保留不变',where,hint].filter(Boolean).join(' · '),title:[code&&'错误代码 '+code,d&&!['UNKNOWN','CONTROLLED_ERROR',code].includes(d.reason)&&'原因代码 '+d.reason].filter(Boolean).join(' · ')};
  }
  function attentionItems(){
    const general=(state.general?.issues||[]).filter(i=>i.target!=='workbench').map(i=>({...i,kind:i.target,scope:'general'}));
    const budget=(budgetOverview()?.issues||[]).map(i=>({...i,kind:'budget',scope:'budget'}));
    const order=Object.fromEntries(KINDS.map(([kind],n)=>[kind,n])),live=collectionItem();
    return [...(live?[live]:[]),...general,...budget].sort((a,b)=>order[a.kind]-order[b.kind]);
  }
  function sentence(i){
    if(i.scope==='collection'){const s=collectionSentence(i.collection);return [s.what,s.effect,[{action:'retry',label:i.collection.collecting?'正在采集…':'重新检查',disabled:Boolean(i.collection.collecting)}],s.title];}
    const e=i.evidence,who=i.agent?agent(i.agent):'',records=e.records!==undefined?count(e.records)+' 条记录':'';
    const source=label=>[{action:'source',value:i.agent,label}];
    if(i.code==='USAGE_UNPRICED'){
      const labels=window.pricingLabels,fixable=labels.FIXABLE.includes(e.reason),why=e.cause?labels.CAUSES[e.cause]||labels.REASONS['usage-incomplete']:labels.REASONS[e.reason]||'无法估算';
      return [(who?who+' · ':'')+(e.model==='unknown'?'未记录模型':e.model)+'：'+why,'有 '+records+'、'+count(e.tokens)+' Token 未计入费用估算',fixable?[{action:'pricing',label:'去定价'}]:source('查看来源')];
    }
    if(i.code==='USAGE_QUALITY_PARTIAL')return [who+(i.agent==='continue'?'：用量是客户端估算，不是实际计量':'：部分记录缺少用量字段'),count(e.records)+' / '+count(e.totalRecords)+' 条记录的 Token 与费用不完整',source('查看来源')];
    if(i.code==='PROJECT_UNATTRIBUTED')return ['部分用量缺少项目归属',records+'没有工作目录，在项目费用里归为“未归属”',[{action:'view',value:'sessions',label:'查看会话'}]];
    if(i.kind==='budget'){
      const row=budgetOverview()?.budgets.find(row=>row.scope===e.scope&&row.period===e.period),scope=(PERIODS[e.period]||e.period)+' · '+(row?budgetName(row):'无法关联的项目');
      const label=i.code==='BUDGET_NO_DATA'?'暂无观测记录，无法判断预算':i.code==='BUDGET_SCOPE_MISSING'?'项目已不可关联，无法判断预算':issueNames[i.code]||i.code;
      return [scope+'：'+label,'预算 '+budgetMoney(e.limitUsd)+(e.lower!==null?'，已估算 '+cost(e):'')+(e.unpricedTokens?'，另有 '+count(e.unpricedTokens)+' Token 未定价':''),[{action:'budget',value:e.scope+':'+e.period,label:'查看预算'}]];
    }
    return [(who?who+'：':'')+(issueNames[i.code]||'来源诊断 '+i.code),(records?'影响 '+records:'影响范围未知')+(e.codes?.length>1?' · 依据 '+e.codes.join('、'):''),i.agent?source('查看来源'):[]];
  }

 function capability(id){const s=state.general?.sources.find(row=>row.agent===id);if(!s)return null;return {agent:id,formats:s.formats.join(' / '),note:'全部已保存历史 · 只读采集 · '+(s.realSampleVerified?'本机真实样本已验证':'尚无当前解析规则的真实样本验证标记')+(s.ruleVersion!==null?' · 规则版本 '+s.ruleVersion:'')+(s.mixedRules?' · 部分历史使用旧规则':''),semantics:'输入：'+({inclusive:'含缓存',exclusive:'不含缓存','schema-dependent':'按已验证的来源结构解释'}[s.inputSemantics])+'；原始输出：'+({'includes-reasoning':'含推理','excludes-reasoning':'不含推理，归一化时合并','schema-dependent':'按已验证的来源结构解释'}[s.outputSemantics])+'。'+(s.quota?'账号额度在“额度”页按 Agent 单独连接读取。':'不提供账户额度。'),fields:Object.entries(fieldNames).map(([field,label])=>({label,value:s.known[field].records+' / '+s.records+' 条已报告'})),summary:count(s.totalTokens)+' Token · '+cost(s)+' · '+s.sessions+' 个已识别会话'};}
 return {attentionItems,sentence,capability,PERIODS,budgetStates,budgetLabels,budgetKey,budgetName,cost,budgetMoney};

}
  return Object.freeze({installerView,installerUpgrades,setupWhen,createInsights,create,count,when,STATUS,STATUS_TIPS,ISSUES,PATH_STATE,STAGE,STATE,label,programStatus,installActions,path,sourceSummary,sourceNotice,attentionGroups,sourceRow,configProjection,errors,managementErrors,editPatch,customConfig,previewRows,labels,failure});
});
