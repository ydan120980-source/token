'use strict';
/* global document, requestAnimationFrame, innerWidth, innerHeight */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const {_electron:electron} = require('playwright');
const {Store,atomic} = require('../../src/m1/store'), {normalize} = require('../../src/m1/normalize');
const {fixtures} = require('../../tests/m1/fixtures'), {settle,cleanup,isolatePointer} = require('./ui-settle');
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
        const page = await app.firstWindow(), errors = []; page.on('pageerror',e=>errors.push(e.message)); page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});
        await isolatePointer(app);
        // firstWindow can precede later scripts that establish the initial quota route.
        // The real window is shown after loadFile completes; test that same readiness.
        await page.waitForLoadState('load');
        await page.locator('[data-view="usage"]').click(); await page.locator('#totalCost button').waitFor(); await settle(page);
        const price = page.locator('#totalCost button');
        assert.equal(await page.locator('#costDialog').count(),0);
        const lower = Number(await price.getAttribute('data-cost-lower')), upper = Number(await price.getAttribute('data-cost-upper')); assert(upper > lower);
        await price.hover(); await settle(page);
        if (!await price.evaluate(b=>b.classList.contains('cost-expanded'))) {
          await page.screenshot({path:path.join(output,'hover-failure-'+scale+'.png')});
          fs.writeFileSync(path.join(output,'hover-failure-'+scale+'.json'),JSON.stringify(await price.evaluate(b=>({html:b.outerHTML,hover:b.matches(':hover'),rect:b.getBoundingClientRect().toJSON(),motion:document.body.dataset.motion,view:document.querySelector('#main').dataset.currentView})),null,2));
        }
        assert.equal(await price.locator('.cost-upper').textContent(), await page.evaluate(v=>window.displayValues.usd(v),upper));
        assert.equal(await price.evaluate(b=>b.classList.contains('cost-expanded')),true);
        await page.screenshot({path:path.join(output,'inline-price-'+scale+'.png')});
        await page.mouse.move(5,5); await settle(page); assert.equal(await price.evaluate(b=>b.classList.contains('cost-expanded')),false);
        await price.focus(); await settle(page); assert.equal(await price.evaluate(b=>b.classList.contains('cost-expanded')),true); await price.press('Escape');
        // Every frame remains bounded; the label contains the final value immediately.
        const frames = await page.evaluate(async () => {
          document.querySelector('[data-period="today"]').click(); const el = document.getElementById('totalTokens'), target = Number(el.dataset.finalValue), label = el.getAttribute('aria-label');
          const samples = []; let start;
          await new Promise(resolve=>{function step(now){start ??= now; samples.push({ms:Math.round(now-start),text:el.textContent}); if(now-start<820) requestAnimationFrame(step); else resolve();} requestAnimationFrame(step);});
          return {target,label,samples,final:el.textContent};
        });
        assert.equal(frames.final,frames.label); assert(frames.samples.some(s=>s.text!==frames.final));
        const parseTokens = text => Number.parseFloat(text) * (text.endsWith('B') ? 1e9 : text.endsWith('M') ? 1e6 : text.endsWith('K') ? 1e3 : 1);
        const sampledValues = frames.samples.map(s=>parseTokens(s.text));
        assert(sampledValues.every((value,i)=>i===0 || value<=sampledValues[i-1]));
        const early = frames.samples.find(s=>s.ms>=100), middle = frames.samples.find(s=>s.ms>=340), late = frames.samples.find(s=>s.ms>=440);
        assert(parseTokens(frames.samples[0].text)-parseTokens(early.text) < parseTokens(middle.text)-parseTokens(late.text));
        await page.evaluate(()=>{for(const range of ['7','30','all','today','all']) document.querySelector('[data-period="'+range+'"]').click();}); await settle(page);
        assert.equal(await page.locator('#totalTokens').textContent(),await page.locator('#totalTokens').getAttribute('aria-label'));
        await page.locator('#modelFilter-trigger').click(); await page.locator('#selectPanel input').fill('model-99');
        assert.equal(await page.locator('#selectOptions [role="option"]').count(),1); await page.locator('#selectPanel input').press('Enter'); await settle(page);
        assert.equal(await page.locator('#modelFilter').inputValue(),'model-99'); assert.equal(await page.locator('#modelFilter-trigger').evaluate(b=>document.activeElement===b),true);
        await page.locator('#modelFilter-trigger').click(); await page.locator('#selectPanel input').fill('不存在的模型'); assert.equal(await page.locator('#selectOptions [role="option"]').count(),0); await page.locator('#selectPanel input').press('Escape');
        await page.locator('#modelFilter').selectOption('all'); await settle(page);
        await page.locator('.heat-palette [aria-checked="true"]').focus(); await page.keyboard.press('End'); assert.equal(await page.locator('.heat-palette [data-value="mono"]').evaluate(button => button === document.activeElement), true);
        assert.equal(await page.locator('#heatColor').inputValue(),'mono');
        await page.locator('#modelFilter-trigger').click(); await settle(page);
        const bounds = await page.locator('#selectPanel').boundingBox(); assert(bounds.height <= 360.1 && bounds.y >= 8); assert(bounds.y+bounds.height <= await page.evaluate(()=>innerHeight)-8);
        await page.screenshot({path:path.join(output,'model-menu-'+scale+'.png')}); await page.locator('#selectPanel input').press('Escape');
        await page.locator('#heatmap button[data-tokens]').last().press('Enter'); await settle(page);
        const unknown = page.locator('#dayDetail .cost-value[data-cost-lower=""]').first();
        assert.equal(await unknown.locator('.cost-lower').textContent(),'未定价'); assert.equal(await unknown.locator('.cost-plus').count(),0);
        const inset = await page.locator('#dayDetail .client-row').first().evaluate(card=>{const r=card.getBoundingClientRect(), a=card.querySelector('.client-line').getBoundingClientRect();return {left:a.left-r.left,right:r.right-a.right};}); assert(inset.left>=18 && inset.right>=18);
        await page.locator('#dayDetail').scrollIntoViewIfNeeded(); await page.screenshot({path:path.join(output,'day-spacing-'+scale+'.png')});
        // Capture a real accelerated jump, then interrupt with wheel input.
        const scrolling = await page.evaluate(async()=>{window.scrollTo({top:0,behavior:'instant'}); window.uiDetail.scrollIntoView(document.getElementById('dayDetail')); const start=window.scrollY; await new Promise(resolve=>requestAnimationFrame(resolve)); return {start,middle:window.scrollY,active:window.uiDetail.activeCount};}); assert(scrolling.active>0);
        await page.mouse.wheel(0,-20); await settle(page);
        await page.locator('[data-view="settings"]').click(); await settle(page); await page.locator('#motionSelect').selectOption('reduced');
        await page.locator('[data-view="usage"]').click(); await page.locator('[data-period="today"]').click();
        assert.equal(await page.locator('#totalTokens').textContent(),await page.locator('#totalTokens').getAttribute('aria-label')); assert.equal(await page.evaluate(()=>window.uiDetail.activeCount),0);
        await page.emulateMedia({reducedMotion:'reduce'}); await page.evaluate(()=>window.uiMotion.setPreference('system')); assert.equal(await page.locator('body').getAttribute('data-motion'),'reduced');
        await page.locator('#theme').click(); await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600)); await settle(page);
        await page.locator('#modelFilter-trigger').click(); await settle(page); const narrow = await page.locator('#selectPanel').boundingBox();
        assert(narrow.x>=8 && narrow.x+narrow.width<=await page.evaluate(()=>innerWidth)); assert(narrow.y>=8 && narrow.y+narrow.height<=await page.evaluate(()=>innerHeight));
        await page.screenshot({path:path.join(output,'dark-narrow-menu-'+scale+'.png')}); await page.locator('#selectPanel input').press('Escape');
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true); assert.deepEqual(errors,[]);
        results.push({scale,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),inlineRange:{lower,upper},frames,retarget:true,searchAndKeyboard:true,menuMaxHeight:bounds.height,detailInset:inset,scrollInterruption:true,reducedAndSystemPreference:true,darkNarrow:true,noErrors:true,realLogin:false});
      } finally {await app.close();}
    }
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2)); console.log(JSON.stringify(results.map(({frames,...row})=>({...row,numberFrames:frames.samples.length}))));
  } finally {await cleanup(root);}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
