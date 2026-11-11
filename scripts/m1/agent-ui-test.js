'use strict';
// No browser plugin surface for native Electron: Playwright with disposable
// homes and quota/usage stores. Never connect to an account or read real sources.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const {_electron:electron} = require('playwright');
const {DatabaseSync} = require('node:sqlite');
const {agentFixtures} = require('../../tests/m1/agent-fixtures');
const {Store} = require('../../src/m1/store');
const {SOURCES} = require('../../src/m1/policy');
const {verifyProjection} = require('../../src/m1/native');
const {scanSources} = require('../../src/m1/sources');
const {settle,cleanup,keepVisible} = require('./ui-settle');
const {openSettings,openBilling,waitText} = require('./settings-ui-helpers');
// Collection is complete when every fixture token is in the snapshot.
let expectedTotal = null;
async function collected(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) { const state = await page.evaluate(() => window.usageBridge.get()); if (state.audit && !state.collecting && state.snapshot.daily.reduce((s,r) => s+r.totalTokens,0) === expectedTotal) return state; await new Promise(resolve => setTimeout(resolve,100)); }
  throw new Error('SOURCE_COLLECTION_TIMEOUT');
}
const usageUi = require('./usage-ui-helpers');
(async()=>{
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'agent-integration-ui-')), output = process.env.AGENT_EVIDENCE_DIR || 'artifacts/m2-agents/source'; fs.mkdirSync(output,{recursive:true});
  const home = path.join(root,'home'), fixture = agentFixtures(home), _total = (expectedTotal = fixture.total), usage = path.join(root,'usage'), store = new Store(usage,fixture.roots);
  const sdkRow = JSON.parse(fs.readFileSync(fixture.roots.cursor[0],'utf8')), sdkFile = path.join(home,'.cursor/projects/project/sdk-agent-store/hash/index.db'); fs.mkdirSync(path.dirname(sdkFile),{recursive:true});
  const sdkDb = new DatabaseSync(sdkFile); sdkDb.exec('CREATE TABLE runs(run_id TEXT,agent_id TEXT,model TEXT,created_at TEXT,started_at TEXT,usage_json TEXT,result TEXT)'); sdkDb.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run(sdkRow.runId,sdkRow.agentId,sdkRow.model.id,new Date(sdkRow.createdAt).toISOString(),null,JSON.stringify(sdkRow.usage),fixture.sentinel); sdkDb.close();
  store.setEnabled(true); // Persist the explicitly selected SDK fixture file.
  fs.mkdirSync(path.join(home,'.kiro'),{recursive:true}); // A detected-only Agent trace.
  const scan = await scanSources(fixture.roots,'native-fixture',{reads:0}), native = await verifyProjection(Object.values(scan).flatMap(s => s.records),path.join(root,'native'));
  assert.equal(native.status,'passed'); assert.equal(native.tokens,fixture.total);
  const evidence = [];
  try {
    for (const scale of [1,1.5]) {
      const quota = path.join(root,'quota-'+scale);
      const app = await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE || require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']),'--quota-data-dir',quota,'--usage-data-dir',usage,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
      try {
        const page = await app.firstWindow(), errors = []; await keepVisible(app); page.on('pageerror',e => errors.push(e.message)); page.on('console',m => {if(m.type() === 'error') errors.push(m.text());});
        let state = await collected(page); assert.equal(state.snapshot.daily.reduce((s,r) => s+r.totalTokens,0),fixture.total); assert.equal(state.audit.networkAttempts,0);
        await page.locator('[data-view="usage"]').click(); await settle(page);
        await page.locator('[data-usage-agents] [data-agent-more]').click(); assert.equal(await page.locator('[data-usage-agents] [role=radio]').count(),SOURCES.length + 1);
        assert(await page.locator('[data-usage-agents] img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
        for (const [agent,tokens] of Object.entries(fixture.expected)) {
          await page.locator('[data-usage-agents] [data-agent="'+agent+'"]').click(); await settle(page);
          assert.equal(await page.evaluate(()=>window.usageHost.filters().agent),agent); { const shown = await usageUi.value(page,'totalTokens'); if (tokens === 0) assert.equal(shown,'未知','no records reads as unknown, not 0'); else assert.equal(Number(shown.replaceAll(',','')),tokens); }
          assert((await page.locator('[data-usage-hero] [role=status]').first().innerText()).includes(await page.locator('[data-usage-agents] [data-agent="'+agent+'"]').getAttribute('aria-label')));
          assert.equal(await page.locator('[data-usage-agents] [aria-checked="true"]').count(),1);
        }
        await page.getByRole('button',{name:'查看全部',exact:true}).click(); await settle(page); assert.equal(await page.evaluate(()=>window.usageHost.filters().agent),'all');
        await page.screenshot({path:path.join(output,'usage-'+scale+'.png')});
        await page.locator('[data-view="sources"]').click(); await settle(page); assert.equal(await page.locator('[data-source-rows] [data-source-agent]').count(),SOURCES.length);
        // What each source reads is the status line's hover text (UI-SOURCES-MANAGE-20261020.md).
        assert(await page.locator('[data-source-reading]').evaluateAll(lines => lines.some(line => /runs\.ndjson|index\.db/.test(line.title)))); await page.screenshot({path:path.join(output,'sources-'+scale+'.png')});
        if (scale === 1) {
          // Source scope (SOURCES-DISCOVERY-20261014.md): switch, exclude, reset, bulk, guard.
          const summary = text => page.locator('[data-source-summary]').filter({hasText:text}).waitFor();
          const saved = () => JSON.parse(fs.readFileSync(path.join(usage,'preferences.json'),'utf8')).sources;
          await summary('读取 ' + SOURCES.length + ' / ' + SOURCES.length + ' 个来源'); assert((await page.locator('[data-source-traces]').innerText()).includes('Kiro'));
          await page.locator('[data-source-agent="gemini"] [role="switch"]').click(); await summary('读取 ' + (SOURCES.length - 1) + ' / ' + SOURCES.length + ' 个来源'); assert.deepEqual(saved().disabled,['gemini']);
          await page.locator('[data-source-agent="codex"] [data-source-paths] button').evaluate(summary => { summary.click(); window.sourcesUi.render(); });
          assert.equal(await page.locator('[data-source-agent="codex"] [data-source-paths] button').getAttribute('aria-expanded').then(value=>value==='true'), true, 'status repaint must preserve disclosure before the queued native toggle');
          await page.locator('[data-source-agent="codex"] [data-source-path-action="remove"] button').first().click(); await page.locator('[data-source-agent="codex"] [data-source-path-action="include"] button').waitFor();
          assert.equal(saved().excluded.codex.length,1);
          await page.locator('[data-source-reset="codex"] button').click(); await page.locator('[data-source-path-action="include"] button').waitFor({state:'detached'}); assert.equal(saved().excluded.codex,undefined);
          await assert.rejects(page.evaluate(() => window.usageBridge.changeSource('remove','codex','C:\\Windows')),/SOURCE_REJECTED/);
          await page.locator('[data-sources-page]').getByRole('button',{name:'全部读取',exact:true}).click(); await summary('读取 ' + SOURCES.length + ' / ' + SOURCES.length + ' 个来源'); assert.deepEqual(saved().disabled,[]);
        }
        await openSettings(page,'pricing'); await openBilling(page); await settle(page); assert.equal(await page.locator('[data-billing-agent]').count(),SOURCES.length);
        await page.getByRole('button',{name:'保存规则',exact:true}).click(); await waitText(page,'price-result',/已保存/); state = await page.evaluate(() => window.usageBridge.pricing());
        assert.equal(Object.keys(state.billing.defaults).length,SOURCES.length); for (const config of Object.values(state.billing.defaults)) assert.equal(config.mode,'actual');
        await page.screenshot({path:path.join(output,'billing-'+scale+'.png')});
        // File picker cancel, rejection and valid selection exercise the real IPC.
        await app.evaluate(({dialog}) => {dialog.showOpenDialog = async () => ({canceled:true,filePaths:[]});});
        state = await page.evaluate(() => window.usageBridge.chooseSource('cursor')); assert.equal(state.enabled,true);
        await app.evaluate(({dialog},file) => {dialog.showOpenDialog = async () => ({canceled:false,filePaths:[file]});},usage);
        await assert.rejects(page.evaluate(() => window.usageBridge.chooseSource('cursor')),/SOURCE_PRODUCT_OVERLAP/);
        await app.evaluate(({dialog},file) => {dialog.showOpenDialog = async () => ({canceled:false,filePaths:[file]});},fixture.roots.cursor[0]);
        state = await page.evaluate(() => window.usageBridge.chooseSource('cursor')); assert.equal(state.enabled,false);
        state = await page.evaluate(() => window.usageBridge.setEnabled(true)); assert.equal(state.enabled,true);
        await app.evaluate(({dialog},file) => {dialog.showOpenDialog = async () => ({canceled:false,filePaths:[file]});},sdkFile);
        state = await page.evaluate(() => window.usageBridge.chooseSource('cursor')); assert.equal(state.enabled,false);
        await page.evaluate(() => window.usageBridge.setEnabled(true)); await page.evaluate(() => window.usageBridge.refresh());
        state = await collected(page); assert.equal(state.snapshot.daily.reduce((s,r)=>s+r.totalTokens,0),fixture.total); assert(!JSON.stringify(state.snapshot).includes(fixture.sentinel));
        await page.locator('[data-view="usage"]').click(); await page.locator('[data-usage-refresh] button').click(); await settle(page);
        assert.equal(errors.length,0,errors.join('\n'));
        evidence.push({scale,sources:SOURCES.length,buttons:SOURCES.length + 1,independentTotal:fixture.total,native,allAgentScopes:true,billingActualDefaults:true,cancelAndOverlap:true,sdkSqlite:true,errors});
      } finally {await app.close();}
    }
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2)); console.log('PASS: ' + SOURCES.length + ' format-backed sources, independent native totals, 100%/150% Electron scopes/logos, pricing defaults, file picker, guards and restart.');
  } finally {await cleanup(root);}
})().catch(e => {console.error(e);process.exitCode=1;});
