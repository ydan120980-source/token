'use strict';
// Shared, pure projection for the source and quota pages. No I/O or credential
// access. Connection counts never imply that account quota can be added up.
(function(root,factory) {
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.connectionState=factory();
})(typeof window==='undefined'?this:window,function() {
  const FRESH_MS=10*60000,CLOCK_SKEW_MS=60000;
  const USAGE_LABELS={unknown:'读取状态未检查',paused:'读取已停用',available:'已有读取结果',partial:'部分读取',error:'读取失败', 'not-detected':'未检测到', 'not-read':'尚未读取'};
  const CAPABILITY_LABELS={supported:'支持账号额度','not-integrated':'额度尚未接入','usage-only':'仅接入用量'};
  function timestamp(value,now=Date.now()) {
    if(typeof value!=='string')return null;
    const time=Date.parse(value);
    return Number.isFinite(time)&&time<=now+CLOCK_SKEW_MS?new Date(time).toISOString():null;
  }
  function quotaFreshness(account,now=Date.now()) {
    const quota=account?.quota,fetchedAt=timestamp(quota?.fetchedAt,now);
    if(!quota)return {state:'missing',reason:'not-fetched',fetchedAt:null};
    if(!fetchedAt)return {state:'missing',reason:'invalid-time',fetchedAt:null};
    const windows=Array.isArray(quota.pools)?quota.pools.flatMap(pool=>pool.windows||[]):quota.windows;
    const balances=Array.isArray(quota.pools)?quota.pools.flatMap(pool=>pool.balances||[]):[];
    if((!Array.isArray(windows)||!windows.length)&&!balances.length)return {state:'missing',reason:'no-windows',fetchedAt};
    if((windows||[]).some(w=>typeof w.resetsAt==='string'&&Number.isFinite(Date.parse(w.resetsAt))&&Date.parse(w.resetsAt)<=now))return {state:'stale',reason:'reset-passed',fetchedAt};
    if(quota.coverage?.stale)return {state:'stale',reason:'resource-stale',fetchedAt};
    if(now-Date.parse(fetchedAt)>FRESH_MS)return {state:'stale',reason:'age',fetchedAt};
    if(account.status!=='ready'||account.errorCode||account.busy)return {state:'cached',reason:'verification-required',fetchedAt};
    return {state:'fresh',reason:null,fetchedAt};
  }
  function quotaLabel(health) {
    return health.state==='fresh'?'已更新':health.state==='stale'?'缓存已过期 · 请刷新':health.state==='cached'?'缓存 · 待验证':health.reason==='invalid-time'?'更新时间异常 · 请刷新':'额度未知';
  }
  function quotaSummary(agent,meta,quota,now) {
    const provider=quota?.providerCapabilities?.find(value=>value.provider===agent);
    const capability=agent==='codex'||provider?.adapters?.length?'supported':meta.custom?'usage-only':'not-integrated';
    const empty={capability,connectionState:capability==='supported'?'unknown':'not-applicable',connections:null,loginRequired:null,failed:null,refreshing:null,duplicates:null,freshness:null,latestSuccess:null,oldestSuccess:null,latestAttempt:null,cliAvailable:null,cacheRecovered:null};
    if(capability!=='supported'||!quota||!Array.isArray(quota.accounts))return empty;
    const accounts=(agent==='codex'?quota.accounts:quota.providerAccounts||quota.accounts).filter(a=>a&&a.provider===agent).slice(0,20),freshness={fresh:0,stale:0,cached:0,missing:0};
    const times=[],attempts=[];
    for(const account of accounts){const health=quotaFreshness(account,now);freshness[health.state]++;if(health.fetchedAt)times.push(health.fetchedAt);const attempt=timestamp(account.lastAttempt,now);if(attempt)attempts.push(attempt);}
    times.sort();attempts.sort();
    const loginRequired=accounts.filter(a=>['login-required','login-failed'].includes(a.status)||a.errorCode==='LOGIN_REQUIRED'||a.credentialReady===false).length;
    const failed=accounts.filter(a=>(a.status==='error'||a.errorCode)&&!['LOGIN_REQUIRED','PROVIDER_AUTH_REQUIRED','PROVIDER_PASSIVE_PENDING'].includes(a.errorCode)).length;
    const refreshing=accounts.filter(a=>a.status==='refreshing').length,connecting=accounts.some(a=>a.status==='connecting');
    return {...empty,connectionState:loginRequired||failed?'attention':connecting?'connecting':accounts.length?'connected':'not-connected',connections:accounts.length,loginRequired,failed,refreshing,duplicates:accounts.filter(a=>a.duplicateKnown).length,freshness,latestSuccess:times.at(-1)||null,oldestSuccess:times[0]||null,latestAttempt:attempts.at(-1)||null,cliAvailable:agent==='codex'&&typeof quota.executableAvailable==='boolean'?quota.executableAvailable:null,cacheRecovered:agent==='codex'?Boolean(quota.recovered):false};
  }
  function projectConnections({catalog,collection=null,statuses={},disabled=[],custom={},discovered=[],quota=null,now=Date.now()}) {
    const rows=Object.entries(catalog).map(([agent,meta])=>{
      const raw=statuses[agent],installed=discovered.find(s=>s.agent===agent)?.installed;
      const stopped=collection?.enabled===false||disabled.includes(agent)||meta.custom&&(custom[agent]?.enabled===false||meta.archived);
      const known=collection!==null||Object.hasOwn(statuses,agent)||typeof installed==='boolean';
      const state=stopped?'paused':!known?'unknown':raw?.status==='error'?'error':raw?.status==='partial'?'partial':installed===false&&!raw?.observedRecords?'not-detected':raw?.lastSuccess||raw?.observedRecords>0?'available':'not-read';
      return {agent,name:typeof meta.name==='string'?meta.name.slice(0,80):agent,custom:Boolean(meta.custom),archived:Boolean(meta.archived),usage:{state,lastState:['verified','unverified','partial','error','not-detected'].includes(raw?.status)?raw.status:null,observedRecords:Number.isSafeInteger(raw?.observedRecords)&&raw.observedRecords>=0?raw.observedRecords:null,lastSuccess:timestamp(raw?.lastSuccess,now),checkedAt:timestamp(collection?.checkedAt,now)},quota:quotaSummary(agent,meta,quota,now)};
    });
    return {schemaVersion:'SourceConnectionsV1',observedAt:new Date(now).toISOString(),rows};
  }
  function quotaDescription(quota) {
    if(quota.capability==='usage-only')return '个人来源提供用量记录，不接入账号额度。';
    if(quota.capability!=='supported')return '当前可统计用量，账号额度尚未接入。';
    if(quota.connectionState==='unknown')return '账号连接状态未检查。';
    if(quota.cacheRecovered&&!quota.connections)return '连接缓存已重置，请到额度页重新连接。';
    if(!quota.connections)return quota.cliAvailable===false?'未连接账号 · 需先选择官方 Codex CLI。':'尚未连接账号。';
    const parts=[quota.connections+' 个连接'];
    if(quota.loginRequired)parts.push(quota.loginRequired+' 个需重新登录');
    if(quota.failed)parts.push(quota.failed+' 个读取失败');
    if(quota.refreshing)parts.push(quota.refreshing+' 个刷新中');
    if(quota.connectionState==='connecting')parts.push('等待官方授权');
    for(const [key,label] of [['fresh','已更新'],['stale','缓存已过期'],['cached','缓存待验证'],['missing','额度未知']])if(quota.freshness?.[key])parts.push(quota.freshness[key]+' 个'+label);
    if(quota.duplicates)parts.push('有重复连接，额度不可叠加');
    if(quota.cliAvailable===false)parts.push('官方 Codex CLI 未就绪');
    return parts.join(' · ');
  }
  return Object.freeze({FRESH_MS,quotaFreshness,quotaLabel,projectConnections,quotaDescription,USAGE_LABELS,CAPABILITY_LABELS});
});
