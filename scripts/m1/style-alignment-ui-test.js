'use strict';
/* global document, getComputedStyle */
// Browser plugin not available; native Electron + synthetic homes and isolated stores.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright'),{seed}=require('../../tests/m1/ui-style-fixture');
const {showView,settle,until,keepVisible,isolatePointer,cleanup}=require('./ui-settle');
const {dialog,openPricing,waitClosed}=require('./settings-ui-helpers');
const c=require('./cost-ui-helpers');
const s=require('./sources-ui-helpers');
const output=process.env.STYLE_EVIDENCE_DIR||'artifacts/ui-style-alignment-20261018/final',baseline=process.env.STYLE_BASELINE==='1';fs.mkdirSync(output,{recursive:true});
(async()=>{
  const results=[];
  for(const scale of [1,1.5]){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'style-alignment-')),home=path.join(root,'home'),usage=path.join(root,'usage'),quota=path.join(root,'quota');seed(home,usage);
    const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',quota,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});const errors=[],facts=fs.readFileSync(path.join(usage,'statistics.json'));
    try{
      await keepVisible(app);await isolatePointer(app);const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,900));
      const capture=async name=>{await settle(page);await page.screenshot({path:path.join(output,name+'-'+scale+'.png'),fullPage:true});};
      // Kit Select renders its popup in the shared portal, outside the page root.
      const pickPeriod=async key=>{await settle(page);await c.pickPeriod(page,key);assert.equal(await page.evaluate(()=>window.insightsHost.get().period),key);};
      for(const theme of ['light','dark']){
        await page.evaluate(theme=>{window.settingsHost.theme.set(theme);},theme);
        await showView(page,'usage');await page.evaluate(()=>window.scrollTo(0,0));await capture('usage-'+theme);
        const usageStyles=await page.evaluate(()=>{const style=e=>{const s=getComputedStyle(e);return {font:s.fontFamily,size:s.fontSize,color:s.color};},type=e=>{const s=getComputedStyle(e);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight,s.color];},edge=e=>{const s=getComputedStyle(e);return [s.borderRadius,s.boxShadow,s.backgroundColor];};
          return {control:style(document.querySelector('[data-usage-periods] button')),heading:type(document.querySelector('[data-usage-trend] h2')),card:edge(document.querySelector('[data-usage-today] > div')),
            token:{body:getComputedStyle(document.documentElement).getPropertyValue('--font-body').trim()}};});
        if(!baseline){assert.equal(usageStyles.control.size,'14px','current kit control role');assert.equal(usageStyles.heading[1],'16px','current kit title role');assert.equal(usageStyles.card[0],'16px','current shared Card radius');}

        // M8 moved the approved cost page to its existing React host and hooks.
        // Keep the same appearance/interaction assertions on the current elements.
        await showView(page,'cost');await c.section(page,'analysis');await page.evaluate(()=>window.scrollTo(0,0));await capture('cost-'+theme);await page.locator('[data-cost-composition]').screenshot({path:path.join(output,'composition-'+theme+'-'+scale+'.png')});
        if(!baseline){
          // Usage (M7) and cost (M8) both compose the shared kit: same control font/foreground and card surface.
          const common=await page.evaluate(()=>{const control=document.querySelector('[data-cost-page] [role="tablist"] [role="tab"]'),card=document.querySelector('[data-cost-page] .shadow-card');const s=getComputedStyle(control),e=getComputedStyle(card);return {font:s.fontFamily,color:s.color,cardBackground:e.backgroundColor};});
          assert.deepEqual({font:common.font,color:common.color},{font:usageStyles.control.font,color:usageStyles.control.color},'controls keep the shared font and foreground');
          assert.equal(common.cardBackground,usageStyles.card[2],'shared card surface');
          await page.evaluate(()=>window.scrollTo(0,0));await settle(page);await page.screenshot({path:path.join(output,'cost-viewport-'+theme+'-'+scale+'.png')});await page.locator('[data-cost-hero]').screenshot({path:path.join(output,'cost-overview-'+theme+'-'+scale+'.png')});
        }
        await c.section(page,'projects');await pickPeriod('monthly');await until(page,()=>/^\d{4}-\d{2}-01 至/.test(document.querySelector('[data-cost-project-range]').textContent));await page.locator('[data-cost-budget-state]').filter({hasText:'预算'}).waitFor();await page.evaluate(()=>window.scrollTo(0,0));await capture('projects-'+theme);
        if(!baseline){assert(await c.root(page).getByRole('button',{name:'保存预算',exact:true}).evaluate(e=>{const s=getComputedStyle(e.querySelector('[aria-hidden]')),probe=document.createElement('span');probe.style.color='var(--text)';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return s.backgroundColor===color;}),'budget primary uses the common foreground token');await pickPeriod('weekly');await until(page,()=>window.insightsHost.get().period==='weekly');const trigger=c.root(page).getByRole('combobox',{name:'项目预算自然周期',exact:true});await trigger.focus();await trigger.press('ArrowDown');await page.keyboard.press('Escape');assert(await trigger.evaluate(e=>e===document.activeElement));}
        const source=await s.openSource(page,'claude'),capability=source.locator('[data-source-capability] button');if(await capability.getAttribute('aria-expanded')!=='true')await capability.click();await capture('sources-'+theme);await source.screenshot({path:path.join(output,'source-detail-'+theme+'-'+scale+'.png')});
        await showView(page,'sessions');await until(page,()=>window.sessionsUi?.loaded===true);if(await page.locator('[data-session-group]').first().getAttribute('data-open')!=='true')await page.locator('[data-session-group] [data-fold-head] button[aria-expanded]').first().click();await settle(page);await page.locator('[data-session-group]').first().locator('[data-session-detail-open] button').first().click();await page.getByRole('dialog').waitFor();await page.getByRole('dialog').screenshot({path:path.join(output,'session-sheet-'+theme+'-'+scale+'.png')});await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
        await openPricing(page,{gap:true});await page.locator('[data-price-models] tr[data-row-key]').filter({hasText:'未计入'}).first().locator('button').first().click();await dialog(page).locator('[data-gap-help]').waitFor();await page.waitForTimeout(350);await dialog(page).screenshot({path:path.join(output,'pricing-help-'+theme+'-'+scale+'.png')});await dialog(page).getByRole('button',{name:'关闭',exact:true}).click();await waitClosed(page);
      }
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));for(const view of ['usage','cost','sources','sessions']){await showView(page,view);await settle(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),view+' has no horizontal overflow');await capture(view+'-narrow');if(view==='cost'){await c.section(page,'analysis');await settle(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),'cost analysis has no horizontal overflow');await capture('cost-analysis-narrow');}}
      if(!baseline){await showView(page,'cost');await c.section(page,'projects');await c.budgetField(page).fill('123');await c.root(page).getByRole('button',{name:'保存预算',exact:true}).click();await until(page,async()=>{const v=await window.usageBridge.workbench({period:window.insightsHost.get().period});return v.budget.limitUsd===123;});assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts);}
      assert.deepEqual(errors,[]);results.push({scale,baseline,pages:['usage','cost','projects','sources','session-sheet','pricing-help'],themes:['light','dark'],narrow800:true,errors,factsUnchanged:!baseline});
    }finally{await app.close();await cleanup(root);}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS: '+(baseline?'baseline screenshots':'style alignment and original controls')+' at100/150, light/dark and800x600.');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
