'use strict';
// No browser plugin surface for native Electron: Playwright with disposable
// homes and quota/usage stores. Never connect to an account or read real sources.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const {_electron:electron} = require('playwright');
const {DatabaseSync} = require('node:sqlite');
const {agentFixtures} = require('../../tests/m1/agent-fixtures');
const {Store} = require('../../src/m1/store');
const {verifyProjection} = require('../../src/m1/native');
const {scanSources} = require('../../src/m1/sources');
const {settle} = require('./ui-settle');
async function collected(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) { const state = await page.evaluate(() => window.usageBridge.get()); if (state.audit && !state.collecting && state.snapshot.daily.length === 9) return state; await new Promise(resolve => setTimeout(resolve,100)); }
  throw new Error('NINE_SOURCE_COLLECTION_TIMEOUT');
}
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'agent-integration-ui-')), output = process.env.AGENT_EVIDENCE_DIR || 'artifacts/m2-agents/source'; fs.mkdirSync(output,{recursive:true});
  const home = path.join(root,'home'), fixture = agentFixtures(home), usage = path.join(root,'usage'), store = new Store(usage,fixture.roots);
  const sdkRow = JSON.parse(fs.readFileSync(fixture.roots.cursor[0],'utf8')), sdkFile = path.join(home,'.cursor/projects/project/sdk-agent-store/hash/index.db'); fs.mkdirSync(path.dirname(sdkFile),{recursive:true});
  const sdkDb = new DatabaseSync(sdkFile); sdkDb.exec('CREATE TABLE runs(run_id TEXT,agent_id TEXT,model TEXT,created_at TEXT,started_at TEXT,usage_json TEXT,result TEXT)'); sdkDb.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run(sdkRow.runId,sdkRow.agentId,sdkRow.model.id,new Date(sdkRow.createdAt).toISOString(),null,JSON.stringify(sdkRow.usage),fixture.sentinel); sdkDb.close();
  store.setEnabled(true); // Persist the explicitly selected SDK fixture file.
  const scan = await scanSources(fixture.roots,'native-fixture',{reads:0}), native = await verifyProjection(Object.values(scan).flatMap(s => s.records),path.join(root,'native'));
  assert.equal(native.status,'passed'); assert.equal(native.tokens,fixture.total);
  const evidence = [];
  try {
    for (const scale of [1,1.5]) {
      const quota = path.join(root,'quota-'+scale);
      const app = await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE || require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']),'--quota-data-dir',quota,'--usage-data-dir',usage,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
      try {
        const page = await app.firstWindow(), errors = []; page.on('pageerror',e => errors.push(e.message)); page.on('console',m => {if(m.type() === 'error') errors.push(m.text());});
        let state = await collected(page); assert.equal(state.snapshot.daily.reduce((s,r) => s+r.totalTokens,0),fixture.total); assert.equal(state.audit.networkAttempts,0);
        await page.locator('[data-view="usage"]').click(); await settle(page);
        assert.equal(await page.locator('#agentPicker button').count(),10);
        assert(await page.locator('#agentPicker img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)));
        for (const [agent,tokens] of Object.entries(fixture.expected)) {
          await page.locator('#agentPicker [data-agent="'+agent+'"]').click(); await settle(page);
          assert.equal(await page.locator('#agentFilter').inputValue(),agent); assert.equal(Number((await page.locator('#totalTokens').innerText()).replaceAll(',','')),tokens);
          assert((await page.locator('#scopeContext').innerText()).includes(await page.locator('#agentPicker [data-agent="'+agent+'"]').getAttribute('aria-label')));
          assert.equal(await page.locator('#agentPicker [aria-pressed="true"]').count(),1);
        }
        await page.locator('#resetUsageScope').click(); await settle(page); assert.equal(await page.locator('#agentFilter').inputValue(),'all');
        await page.screenshot({path:path.join(output,'usage-'+scale+'.png')});
        await page.locator('[data-view="sources"]').click(); await settle(page); assert.equal(await page.locator('#sourceRows .source-row').count(),9);
        assert(/runs\.ndjson|index\.db/.test(await page.locator('#sourceRows').innerText())); await page.screenshot({path:path.join(output,'sources-'+scale+'.png')});
        await page.locator('[data-view="settings"]').click(); await page.locator('#pricingPanel').evaluate(e => {e.open = true;});
        await page.locator('#priceTabBilling').click(); await settle(page); assert.equal(await page.locator('#billingRows article').count(),9);
        await page.locator('#saveBilling').click(); await settle(page); state = await page.evaluate(() => window.usageBridge.pricing());
        assert.equal(Object.keys(state.billing.defaults).length,9); for (const config of Object.values(state.billing.defaults)) assert.equal(config.mode,'actual');
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
        await page.locator('[data-view="usage"]').click(); await page.locator('#refresh').click(); await settle(page);
        assert.equal(errors.length,0,errors.join('\n'));
        evidence.push({scale,sources:9,buttons:10,independentTotal:fixture.total,native,allAgentScopes:true,billingActualDefaults:true,cancelAndOverlap:true,sdkSqlite:true,errors});
      } finally {await app.close();}
    }
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2)); console.log('PASS: nine format-backed sources, independent native totals, 100%/150% Electron scopes/logos, pricing defaults, file picker, guards and restart.');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
})().catch(e => {console.error(e);process.exitCode=1;});
