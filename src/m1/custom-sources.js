'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const adapter = require('./jsonl-adapter');
class CustomSources {
  constructor(service, protectedDirs = []) { this.service=service; this.store=service.store; this.protectedDirs=[this.store.dir,...protectedDirs]; this.drafts=new Map(); this.previews=new Map();this.expiryTimer=null; }
  expire(){clearTimeout(this.expiryTimer);const now=Date.now();for(const [id,p]of this.previews)if(now-p.createdAt>=5*60*1000)this.previews.delete(id);for(const [id,d]of this.drafts)if(now-d.createdAt>=30*60*1000)this.drafts.delete(id);const deadlines=[...this.previews.values()].map(p=>p.createdAt+5*60*1000).concat([...this.drafts.values()].map(d=>d.createdAt+30*60*1000));this.expiryTimer=deadlines.length?setTimeout(()=>this.expire(),Math.max(1,Math.min(...deadlines)-now)):null;this.expiryTimer?.unref?.();}
  close(){clearTimeout(this.expiryTimer);this.expiryTimer=null;this.previews.clear();this.drafts.clear();}
  reserved(id) {
    return [...Object.values(this.store.defaults).flat(),...Object.values(this.store.settings.sources.added).flat(),...Object.entries(this.store.state.customSources || {}).filter(([key])=>key!==id).flatMap(([,source])=>source.reservedRoots || source.roots || [])];
  }
  busy() { if (this.service.closed || this.service.current || this.service.customBusy) throw new Error('CUSTOM_BUSY'); }
  async locked(work) {
    this.busy(); this.service.customBusy=true; clearTimeout(this.service.timer);
    try { return await work(); } finally { this.service.customBusy=false; this.service.schedule(); }
  }
  draft(id = null) {
    this.busy();
    const saved=id && this.store.state.customSources?.[id];
    if (id && (!saved || saved.archived)) throw new Error('CUSTOM_NOT_FOUND');
    const token=crypto.randomUUID();
    this.drafts.clear(); this.previews.clear();
    const draft={id:id || 'custom-'+crypto.randomUUID(),roots:saved?.roots || [],definition:saved?.definition || {schemaVersion:'CustomSourceV1',name:'我的 Agent',template:'standard',mode:'per-request'},version:saved?.version || 0,createdAt:Date.now()};
    this.drafts.set(token,draft);
    this.expire();
    return {token,id:draft.id,definition:draft.definition,selected:draft.roots.length > 0,locations:[...draft.roots]};
  }
  get(token) { const draft=this.drafts.get(token); if (!draft || Date.now()-draft.createdAt>30*60*1000) throw new Error('CUSTOM_DRAFT_STALE'); return draft; }
  choose(token, roots) {
    this.busy();
    const draft=this.get(token); const next={...draft,roots};
    adapter.checkRoots(next,this.reserved(draft.id),this.protectedDirs);
    for (const root of roots) if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error('SOURCE_SYMLINK_REJECTED');
    this.drafts.set(token,next); this.previews.clear(); return {selected:true,count:roots.length,locations:[...roots]};
  }
  configure(token, value) {
    this.busy();
    const draft=this.get(token), config=adapter.definition(value);
    if (JSON.stringify(config)!==JSON.stringify(draft.definition)) this.previews.clear();
    draft.definition=config;
    return draft;
  }
  async sample(token) { const draft=this.get(token); adapter.checkRoots(draft,this.reserved(draft.id),this.protectedDirs); return this.locked(()=>this.service.customTask('sample',draft)); }
  async preview(token, value) {
    const draft=this.configure(token,value); adapter.checkRoots(draft,this.reserved(draft.id),this.protectedDirs);
    return this.locked(async()=>{
      const old=this.store.state.customSources?.[draft.id];
      const source={...draft,name:draft.definition.name,version:old && adapter.parserHash(old.definition)===adapter.parserHash(draft.definition) ? old.version : (old?.version || 0)+1};
      const before=await this.service.customTask('fingerprint',source);
      const result=await this.service.customTask('scan',source,old?.files || {});
      const after=await this.service.customTask('fingerprint',source);
      if (before!==after) throw new Error('CUSTOM_PREVIEW_STALE');
      const oldRecords=this.store.records().filter(r=>r.agent===draft.id), nextIds=new Map(result.records.map(r=>[r.id,r]));
      const oldIds=new Map(oldRecords.map(r=>[r.id,r]));
      const summary={files:result.fileCount,records:result.records.length,totalTokens:result.records.reduce((n,r)=>n+r.totalTokens,0),unknown:Object.fromEntries(['inputUncached','output','cacheRead','cacheWrite','reasoning'].map(key=>[key,result.records.filter(r=>r[key]===null).length])),
        added:result.records.filter(r=>!oldIds.has(r.id)).length,removed:oldRecords.filter(r=>!nextIds.has(r.id)).length,replaced:result.records.filter(r=>oldIds.has(r.id) && JSON.stringify(oldIds.get(r.id))!==JSON.stringify(r)).length,...result.diagnostics,pricedRecords:result.records.filter(r=>this.store.estimate(r).lower!==null).length};
      if (!oldRecords.length && result.diagnostics.errors.length) throw new Error(result.diagnostics.errors[0]);
      if (!summary.records && summary.unsupported) throw new Error('CUSTOM_COUNTER_UNSUPPORTED');
      if (!summary.records && !oldRecords.length) throw new Error('CUSTOM_NO_RECORDS');
      const id=crypto.randomUUID(); this.previews.clear(); this.previews.set(id,{token,sequence:this.store.state.sequence,source,result,fingerprint:after,definitionHash:adapter.hash(draft.definition),createdAt:Date.now()});
      this.expire();
      return {id,summary,configHash:adapter.hash(draft.definition),sourceStamp:after,sequence:this.store.state.sequence,expiresAt:new Date(Date.now()+5*60*1000).toISOString()};
    });
  }
  async apply(id) {
    return this.locked(async()=>{
      const preview=this.previews.get(id);
      if (!preview || Date.now()-preview.createdAt>5*60*1000 || preview.sequence!==this.store.state.sequence || adapter.hash(this.get(preview.token).definition)!==preview.definitionHash || JSON.stringify(this.get(preview.token).roots)!==JSON.stringify(preview.source.roots)) throw new Error('CUSTOM_PREVIEW_STALE');
      adapter.checkRoots(preview.source,this.reserved(preview.source.id),this.protectedDirs);
      if (await this.service.customTask('fingerprint',preview.source)!==preview.fingerprint) throw new Error('CUSTOM_PREVIEW_STALE');
      const {source,result}=preview, old=this.store.state.customSources?.[source.id];
      const previous=old ? {...old,previous:undefined} : null;
      const reservedRoots=[...new Set([...(old?.reservedRoots || old?.roots || []),...source.roots])];
      const next={id:source.id,name:source.definition.name,definition:source.definition,roots:source.roots,reservedRoots,version:source.version,enabled:true,archived:false,files:result.files,diagnostics:result.diagnostics,fileCount:result.fileCount,previous};
      this.store.commitCustom(next,result.records);
      this.previews.clear(); this.drafts.clear(); await this.service.dropCollector(); this.service.stamp=null; this.service.update();
      return {saved:true,id:source.id};
    });
  }
  async change(id, action, value) {
    return this.locked(async()=>{
      const source=this.store.state.customSources?.[id];
      if (!source) throw new Error('CUSTOM_NOT_FOUND');
      let next={...source};
      if (action==='enable' && typeof value==='boolean' && !source.archived) next.enabled=value;
      else if (action==='remove') next={...source,enabled:false,archived:true,previous:{...source,previous:undefined}};
      else if (action==='rollback' && source.previous) { next={...source.previous,reservedRoots:source.reservedRoots || source.roots,previous:{...source,previous:undefined}}; adapter.checkRoots(next,this.reserved(id),this.protectedDirs); }
      else throw new Error('CUSTOM_CHANGE_INVALID');
      this.store.commitCustom(next,adapter.merge(next.files || {}).records); this.previews.clear(); await this.service.dropCollector(); this.service.stamp=null; this.service.update(); return {saved:true};
    });
  }
  export(id) { const source=this.store.state.customSources?.[id]; if (!source) throw new Error('CUSTOM_NOT_FOUND'); return adapter.definition(source.definition); }
  import(value) { const config=adapter.definition(value), draft=this.draft(); this.drafts.get(draft.token).definition=config; return {...draft,definition:config}; }
}
function describe(sources) {
  const {filesUnder}=require('./policy');
  return Object.values(sources || {}).map(source=>{
    const paths=source.roots.map(root=>{
      let exists=false, files=null, issues=[];
      try { exists=fs.existsSync(root); if (source.enabled && !source.archived) { const found=filesUnder(source.id,root,{reads:0}); files=found.length; if (found.limited) issues.push('SOURCE_LIMIT'); } } catch { issues=['SOURCE_UNREADABLE']; }
      return {path:root,display:root,origin:'custom',state:source.enabled && !source.archived ? 'included' : 'stopped',exists,kind:'directory',files,latest:null,issues};
    });
    return {agent:source.id,enabled:source.enabled && !source.archived,installed:paths.some(p=>p.exists),files:paths.reduce((n,p)=>n+(p.files||0),0),latest:null,paths,custom:true,archived:source.archived,mixedRules:Boolean(source.diagnostics?.mixedRules),canRollback:Boolean(source.previous)};
  });
}
module.exports={CustomSources,describe};
