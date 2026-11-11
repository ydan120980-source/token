'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {_electron:electron} = require('playwright');
const {Store,atomic} = require('../../src/m1/store'), {normalize} = require('../../src/m1/normalize');
const {fixtures} = require('../../tests/m1/fixtures'), {cleanup,isolatePointer,keepVisible} = require('./ui-settle'), {openSettings,pickSelect} = require('./settings-ui-helpers');
const usageUi = require('./usage-ui-helpers');
const { usageDetailChecks } = require('./usage-detail-checks');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-detail-')), results = [];
  const output = process.env.DETAIL_EVIDENCE_DIR || 'artifacts/detail'; fs.mkdirSync(output,{recursive:true});
  try {
    const home = path.join(root,'home'), fixture = fixtures(home), usage = path.join(root,'usage'), store = new Store(usage,fixture.roots);
    for (let i = 0; i < 300; i++) {
      const record = normalize('codex',{input_tokens:100000 + i * 100, output_tokens:1200, cached_input_tokens:80000, reasoning_output_tokens:100, total_tokens:101200 + i * 100},{id:'detail-'+i, time:Date.now()-Math.floor(i/10)*86400000, provider:'openai', model:i%3 ? 'model-'+i%100 : 'gpt-6.1-sol',entry:'desktop'},'synthetic-salt'); store.state.records[record.id] = record;
    }
    store.state.sequence = 1; atomic(path.join(usage,'statistics.json'),store.state); store.setEnabled(false);
    for (const scale of [1,1.5]) {
      const app = await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE || require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']),'--quota-data-dir',path.join(root,'quota-'+scale),'--usage-data-dir',usage,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
      try {
        const page = await app.firstWindow(), errors = []; await keepVisible(app); page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
        await isolatePointer(app);
        // firstWindow can precede later scripts that establish the initial quota route.
        // The real window is shown after loadFile completes; test that same readiness.
        await page.waitForLoadState('load');
        await usageUi.openUsage(page);
        results.push(await usageDetailChecks(page, app, { scale, output, errors, openSettings, pickSelect }));
      } finally {await app.close();}
    }
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2)); console.log('PASS: usage detail at 100/150, exact price bounds, current Figure, search/keyboard, unknown data, spacing, scroll interruption and reduced motion. ' + JSON.stringify(results));
  } finally {await cleanup(root);}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
