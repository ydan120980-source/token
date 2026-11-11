'use strict';
// M4: one data/action owner. React owns all source DOM; no implicit source/config reads.
(()=>{
 const bridge=window.usageBridge,agents=window.agentCatalog.agents;
 const demo=!bridge&&(new URLSearchParams(location.search).has('demo')||window.previewUsage?.schemaVersion!=='LocalUsagePreviewV1');
 const state={discovery:null,statuses:null,busy:false,failed:false,stale:false,stage:'',message:'',retry:null,collection:null,notice:''};
 const render=()=>window.dispatchEvent(new Event('sources-host-change'));
 const toast=message=>window.usageData?.toast(message);
 const {demoDiscovery,selection}=window.sourcesModel.create(state,agents);
  async function discover() {
    state.discovery = await bridge.sources(); state.failed = false; state.stale = false;
  }
  async function load(collect = false) {
    if (state.busy) return;
    if (demo) { state.discovery ||= demoDiscovery(); render(); return; }
    if (!bridge) { render(); return; }
    if(collect)window.dispatchEvent(new Event('sources-refresh-request'));
    state.busy = true; state.stage = '正在检查读取位置…'; state.message = ''; render();
    try {
      await discover();
      if (collect) { state.stage = '读取位置已检查，正在采集用量…'; render(); const result = await bridge.refresh(); state.collection = result; state.statuses = result.snapshot?.sources || state.statuses; }
      state.retry = null;
    } catch { state.failed = true; state.stale = true; state.message = '读取位置检查未完成；显示上次检查结果，历史统计保留。'; state.retry = () => load(collect); }
    finally {
      state.busy = false;
      render();
    }
  }
  async function change(name, agent, value) {
    if (agents[agent]?.custom) { try { await bridge.customChange(agent,name,value);await discover();render(); } catch {toast('自定义来源操作失败，历史统计保留。');} return; }
    if (demo) { applyDemo(name, agent, value); return; }
    if (!bridge) return;
    if (state.busy) { render(); return; } // Puts a switch flipped mid-change back.
    state.busy = true; state.stage = '正在保存来源设置并检查读取位置…'; state.message = ''; render();
    try {
      const result = await bridge.changeSource(name, agent, value);
      if (result.discovery) { state.discovery = result.discovery; state.stale = state.failed = false; state.retry = null; state.message = '来源设置已保存；历史统计保留。'; }
      else { selection(result.selection); state.failed = true; state.message = '来源设置已保存，读取位置检查失败；开关与路径是新设置，文件信息待检查，历史统计保留。'; state.retry = () => load(); toast(state.message); }
      state.collection = result.state; state.statuses = result.state?.snapshot?.sources || state.statuses;
    }
    catch { state.failed = true; state.stale = true; state.message = '来源操作未完成；当前显示上次确认的设置，请重新检查，或重试这次操作。历史统计保留。'; state.retry = () => change(name, agent, value); toast(state.message); }
    finally { state.busy = false; render(); }
  }
  async function add(agent) {
    if (state.busy || !bridge) return;
    state.busy = true; state.stage = '等待选择本地来源…'; state.message = ''; render();
    try {
      const result = await bridge.chooseSource(agent); state.collection = result;
      if (result.sourceSaved) {
        selection(result.sourceSelection); state.stage = '路径已保存，正在检查读取位置…'; render();
        try { await discover(); state.message = '读取路径已保存，采集已暂停；确认路径后在设置中恢复。历史统计保留。'; state.retry = null; }
        catch { state.failed = true; state.message = '读取路径已保存，采集已暂停；读取位置检查失败，文件信息待检查。历史统计保留。'; state.retry = () => load(); toast(state.message); }
      }
    } catch { state.failed = true; state.message = '未完成目录选择或保存。请检查目录是否可读、是否与产品数据目录重叠，然后重试。'; state.retry = () => add(agent); toast(state.message); }
    finally { state.busy = false; render(); }
  }
  // The demo applies changes to its synthetic discovery without touching the machine.
  function applyDemo(name, agent, value) {
    const sync = source => { for (const entry of source.paths) if (entry.state !== 'excluded') entry.state = source.enabled ? 'included' : 'stopped'; };
    for (const source of state.discovery.sources) {
      if (name === 'all') source.enabled = value;
      else if (source.agent === agent) {
        if (name === 'enable') source.enabled = value;
        if (name === 'reset') { source.enabled = true; for (const entry of source.paths) entry.state = 'included'; }
        if (name === 'remove' || name === 'include') for (const entry of source.paths) if (entry.path === value) entry.state = name === 'remove' ? 'excluded' : 'included';
      }
      sync(source);
    }
    render();
  }


 const host={get:()=>state,demo,available:Boolean(bridge||demo),catalog:()=>agents,load,change,add,
 update(statuses){if(arguments.length)state.statuses=statuses;render();},collection(value){state.collection=value;render();},notice(value){state.notice=value;render();},retry(){if(!state.busy)return state.retry?.();},
 async reveal(file){try{await bridge.revealSourcePath(file);}catch{toast('这个位置已经不在了，请重新检查');}},
 async copyText(text){if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);toast('已复制完整路径：'+text);return true;}catch{ /* desktop fallback */ }}if(bridge?.copyText){await bridge.copyText(text);toast('已复制完整路径：'+text);return true;}throw Error('COPY_UNAVAILABLE');}
 };
 window.sourcesHost=host;
 // Saved facts are published by preview.js before islands mount.
 window.addEventListener('source-catalog',render);

 (()=>{
 let snapshot=null,selected=null,message='',loading=null,pending=false,reloadAgain=false;
 const render=()=>{window.dispatchEvent(new Event('installer-change'));window.dispatchEvent(new Event('sources-host-change'));};
  async function reload() {
    if (pending) { reloadAgain = true; return; } pending = true;
    try { const result = await bridge.installers(); if (!result.ok) throw new Error(); snapshot = result.state; render(); }
    catch { message = '安装状态获取失败，请重新打开或检查。'; render(); }
    finally { pending = false; if (reloadAgain) { reloadAgain = false; void reload(); } }
  }
  async function act(agent, action) {
    if (!snapshot) return;
    loading = agent; render();
    try { const result = await bridge.installerAction({ agent, action, revision: snapshot.revision }); if (result.state) snapshot = result.state; message = result.message || (result.ok ? '任务已提交，进度会在对应 Agent 下显示。' : '操作未完成，请重试。'); }
    catch { message = '操作未完成，请重新检查状态；已有安装和用量历史保留。'; }
    finally { loading = null; render(); }
  }

 host.installers=()=>({snapshot,selected,message,loading,pending});
 host.loadInstallers=reload;host.installAction=(agent,action)=>{selected=agent;message='';return act(agent,action);};
 const unsubscribe=bridge?.onInstallUpdate?.(()=>void reload());window.addEventListener('unload',()=>unsubscribe?.());
 })();

 (()=>{let current=null,selected=null,busy=false,message='',generation=0;
 const render=()=>window.dispatchEvent(new Event('sources-host-change'));
 async function open(agent){if(!bridge?.agentSetup)return;const request=++generation;selected=agent;current=null;busy=true;message='正在获取已保存状态…';render();try{const result=await bridge.agentSetup(agent);if(request!==generation)return;if(!result.ok)throw Error();current=result.state;message='';}catch{if(request===generation)message='获取状态失败，请重试。';}finally{if(request===generation){busy=false;render();}}}
 host.setup=()=>({current,selected,busy,message});host.openSetup=open;host.closeSetup=()=>{generation++;selected=null;render();};
 host.setupAction=async actionId=>{if(busy||!current)return;const request=generation;busy=true;message='正在处理…';render();try{const result=await bridge.agentSetupAction({agent:selected,actionId,revision:current.revision});if(request!==generation)return;if(result.state)current=result.state;message=result.ok?({'command-copied':'官方安装命令已复制，请在自己的 PowerShell 中检查后执行。','guide-opened':'已请求系统浏览器打开官方指南。','metadata-rescanned':'程序入口扫描已完成，请查看最新结果。'}[result.outcome]||'操作已完成。'):result.message||'操作失败，请重试。';}catch{if(request===generation)message='操作未完成，已有统计保持不变；请重试。';}finally{if(request===generation){busy=false;render();}}};
 })();

 (()=>{const model=window.connectionState;let snapshot=null,stale=false,pending=null,again=false,closed=false;
 const fallback=()=>model.projectConnections({catalog:window.agentCatalog.agents});
 const render=()=>{window.dispatchEvent(new Event('connections-change'));window.dispatchEvent(new Event('sources-host-change'));};
  function load() {
    if(closed)return Promise.resolve();
    if(!bridge?.connections){render();return Promise.resolve();}
    if(pending){again=true;return pending;}
    pending=(async()=>{try{const next=await bridge.connections();if(next?.schemaVersion!=='SourceConnectionsV1'||!Array.isArray(next.rows))throw new Error();if(!closed){snapshot=next;stale=false;render();}}catch{if(!closed){stale=true;render();}}finally{pending=null;if(again&&!closed){again=false;void load();}}})();return pending;
  }

 host.connections=()=>({snapshot:snapshot||fallback(),stale});host.loadConnections=load;
 const changed=()=>window.dispatchEvent(new Event('source-connections-invalidated'));
 const unsubscribers=[bridge?.onUpdate?.(changed),window.quotaBridge?.onUpdate?.(changed)];
 window.addEventListener('unload',()=>{closed=true;for(const unsubscribe of unsubscribers)unsubscribe?.();});
 })();
 (()=>{let state={selections:{},busy:false},pending=false,message='';
 const render=()=>window.dispatchEvent(new Event('sources-host-change'));
 host.config=()=>({state,pending,message});
 host.configAction=async(name,agent,scope)=>{if(!bridge||pending)return;pending=true;message='';if(name==='configCheck')state={...state,busy:true,active:agent+':'+scope};render();try{const result=await bridge[name](agent,scope);if(result.error)message=window.sourcesModel.errors[result.error]||'操作未完成，请重试。';else state=result.state||result;}catch{message='操作未完成，请重试。';}finally{pending=false;render();}};
 host.configCancel=()=>bridge?.configCancel().catch(()=>{});
 host.loadConfig=async(updated)=>{if(!bridge||pending)return;const next=updated||await bridge.configState();if(next.error)throw Error('配置检查状态未能刷新。');state=next;message=updated?'配置已更新，请重新检查。':'';render();};
 })();
 (()=>{let selection,view,preview,contextId=null,undoAvailable=false,editing=null,busy=false,message='';
 const render=()=>window.dispatchEvent(new Event('sources-host-change'));
 const clearPreview=()=>{preview=null;};
 async function invoke(action,request={}){const result=await bridge.configManage(action,selection.agent,selection.scope,selection.kind,request);if(result.error)throw Error(window.sourcesModel.managementErrors[result.error]||'操作未完成，请重新读取并核对当前配置后重试。');return result;}
 async function task(work){if(busy)return;busy=true;message='正在处理…';render();try{await work();}catch(error){message=error.message;}finally{busy=false;render();}}
 async function load(){view=null;clearPreview();editing=null;render();view=(await invoke('list')).view;contextId=view.id;undoAvailable=Boolean(view.undo);message='已读取所选范围；本次读取未修改配置。';render();}
 async function finishWrite(action,request={}){const result=await invoke(action,request),applied=action==='apply';undoAvailable=applied&&Boolean(result.undo);contextId=null;clearPreview();const warnings=[];try{await host.loadConfig(result.state);}catch{warnings.push('检查状态未能刷新');}try{await load();}catch{warnings.push('配置列表未能重新读取');}message=(applied?'已应用，并保存系统加密恢复记录；可撤销本次修改。':'已撤销最近一次修改。')+(warnings.length?warnings.join('；')+'。请点击“重新读取”，不要重复应用；写入结果不受此次刷新失败影响。':'');}
 function showPreview(value){preview=value;message='预览已准备，请核对变更。';}
 host.manager=()=>({selection,view,preview,contextId,undoAvailable,editing,busy,message});
 host.openManager=value=>{selection=value;view=null;contextId=null;undoAvailable=false;clearPreview();editing=null;render();return task(load);};
 host.closeManager=()=>{if(busy)return false;const id=contextId;clearPreview();view=null;contextId=null;undoAvailable=false;editing=null;if(id&&selection&&bridge)void invoke('release',{id}).catch(()=>{});render();return true;};
 host.managerEdit=id=>{if(busy)return;clearPreview();editing=id;render();};host.managerDiscard=()=>{clearPreview();message='预览已取消，未修改。';render();};host.managerInvalidate=()=>{clearPreview();render();};
 host.managerAction=(action,values)=>task(async()=>{if(action==='reload')return load();if(action==='import'){clearPreview();const result=await invoke('import',{id:view.id});if(result.canceled)message='已取消导入，未修改。';else showPreview(result.preview);}else if(action==='preview'){clearPreview();showPreview((await invoke('preview',{id:view.id,action:'edit',row:editing,patch:window.sourcesModel.editPatch(values)})).preview);}else if(action==='toggle'){clearPreview();showPreview((await invoke('preview',{id:view.id,action:'toggle',...values})).preview);}else if(action==='apply'){if(preview)await finishWrite('apply',{id:preview.id});}else if(action==='undo')await finishWrite('undo');});
 })();
 (()=>{let draft=null,editing=false,step=0,busy=false,preview=null,message='',fields=[],sampleInfo='最多 200 行 / 1 MiB；不展示正文或原始身份。',form=null,location='尚未选择';
 const render=()=>window.dispatchEvent(new Event('sources-host-change'));
 function fill(value){draft=value;editing=Boolean(value.selected);step=0;preview=null;const def=value.definition;form={name:def.name,template:def.template,mode:def.mode,input:def.inputSemantics||'',reason:typeof def.outputIncludesReasoning==='boolean'?(def.outputIncludesReasoning?'yes':'no'):'',time:def.timeUnit||'iso',filters:JSON.stringify(def.filters||[],null,2),mapping:{...def.mapping}};fields=[];location=value.selected?'已有确认的读取位置：'+value.locations.join('；'):'尚未选择';sampleInfo='最多 200 行 / 1 MiB；不展示正文或原始身份。';message='';render();}
 async function run(action){if(busy)return;busy=true;message='正在处理…';render();try{await action();message='';}catch(error){message=window.sourcesModel.failure(error);}finally{busy=false;render();}}
 host.custom=()=>({draft,editing,step,busy,preview,message,fields,sampleInfo,form,location});
 host.openCustom=async(id=null)=>{if(!bridge?.customDraft)return;try{fill(await bridge.customDraft(id));window.dispatchEvent(new Event('sources-custom-open'));}catch(error){host.notice(window.sourcesModel.failure(error));}};
 host.closeCustom=()=>{if(busy)return false;draft=null;form=null;preview=null;fields=[];render();return true;};
 host.customField=(key,value)=>{if(busy||!form)return;preview=null;form={...form,...(key.startsWith('mapping:')?{mapping:{...form.mapping,[key.slice(8)]:value}}:{[key]:value})};render();};
 host.customAction=action=>run(async()=>{if(action==='import'){const result=await bridge.customImport();if(!result.canceled)fill(result);}else if(action==='choose'){const result=await bridge.customChoose(draft.token);if(!result.canceled){draft.selected=true;preview=null;location='已确认 '+result.count+' 个读取目录：'+result.locations.join('；');}}else if(action==='sample'){const result=await bridge.customSample(draft.token);fields=result.fields;sampleInfo='已检查 '+result.rows+' 行，发现 '+result.fields.length+' 个字段；选择字段路径，不展示正文。';}else if(action==='back')step--;else if(action==='next'){if(window.uiKeyboard.isComposing())return;if(step===0&&(!draft.selected||!form.name.trim()))throw Error('CUSTOM_CONFIG_INVALID');if(step===2)preview=await bridge.customPreview(draft.token,window.sourcesModel.customConfig(form));if(step===4){if(!preview)throw Error('CUSTOM_PREVIEW_STALE');await bridge.customApply(preview.id);draft=null;form=null;window.dispatchEvent(new Event('sources-custom-close'));await load();return;}step++;}});
 host.customChange=async(id,action,value)=>{try{await bridge.customChange(id,action,value);await load();}catch(error){host.notice(window.sourcesModel.failure(error));}};
 host.customExport=id=>bridge.customExport(id).catch(error=>host.notice(window.sourcesModel.failure(error)));
 })();
 Object.freeze(host);
})();
