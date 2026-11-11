'use strict';
/* global document, requestAnimationFrame, ResizeObserver, KeyboardEvent, PointerEvent */
// Browser plugin not available. Actual isolated Electron renderer, synthetic data
// only: chart removal, empty-month navigation, live hover freshness, keyboard/IME
// and cancelled drags. Observer accounting detects retained targets, not RSS noise.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { keepVisible, isolatePointer, showView, cleanup } = require('./ui-settle');
const output = process.env.LIFECYCLE_EVIDENCE_DIR || path.join(os.tmpdir(), 'agent-usage-lifecycle-' + process.pid);
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-lifecycle-')), home = path.join(root, 'home'), usage = path.join(root, 'usage');
  fs.mkdirSync(home); fs.mkdirSync(output, { recursive: true }); new Store(usage, roots(home)).setEnabled(false);
  const before = fs.readFileSync(path.join(usage, 'statistics.json'));
  let app;
  try {
    app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home], timeout: 60000 });
    await keepVisible(app); await isolatePointer(app); const page = await app.firstWindow(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await showView(page, 'cost');
    await page.evaluate(()=>window.uiMotion.setPreference('off'));
    const hero=page.locator('[data-cost-hero]');await hero.getByRole('button',{name:'下一页',exact:true}).click();
    assert(await hero.locator('[data-carousel-slide=month]').evaluate(e=>!e.inert));
    await hero.getByRole('button',{name:'上一页',exact:true}).click();
    const checks = await page.evaluate(async () => {
      const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
      const NativeResize=ResizeObserver,observers=new Set();
      window.ResizeObserver=class extends NativeResize{
        constructor(fn){super(fn);this.targets=new Set();observers.add(this);}
        observe(target,options){this.targets.add(target);super.observe(target,options);}
        unobserve(target){this.targets.delete(target);super.unobserve(target);}
        disconnect(){this.targets.clear();observers.delete(this);super.disconnect();}
      };
      const failures=[],check=(name,ok)=>{if(!ok)failures.push(name);};
      try{
        for(let cycle=0;cycle<30;cycle++){
          const sandbox=document.createElement('div');sandbox.dataset.lifecycleSandbox='';document.body.append(sandbox);
          const mounted=window.agentUi.mount('kit-gallery',sandbox);await frame();await frame();
          const sample=sandbox.querySelector('[data-m8-gallery]');check('React gallery mounted',Boolean(sample));
          const segment=sample.querySelector('[data-m8-case=stack] [data-stack-key=a]');segment.focus();await frame();
          [...sample.querySelectorAll('button')].find(e=>e.textContent==='更新费用组件').click();await frame();await frame();
          check('active hover refresh uses latest amount',document.querySelector('#kit-window-chart-tooltip')?.textContent.includes('$6'));
          const carousel=sample.querySelector('[data-m8-case=rolling] [data-carousel]');
          carousel.querySelector('button').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',isComposing:true,bubbles:true}));await frame();
          check('IME does not switch slides',carousel.dataset.index==='0');
          const viewport=carousel.firstElementChild;viewport.setPointerCapture=()=>{};viewport.hasPointerCapture=()=>false;
          viewport.dispatchEvent(new PointerEvent('pointerdown',{button:0,pointerId:41,clientX:600,clientY:20,bubbles:true}));
          viewport.dispatchEvent(new PointerEvent('pointermove',{pointerId:41,clientX:50,clientY:20,bubbles:true}));
          viewport.dispatchEvent(new PointerEvent('pointercancel',{pointerId:41,bubbles:true}));await frame();
          check('cancelled swipe returns to current slide',carousel.dataset.index==='0');
          mounted.unmount();sandbox.remove();await frame();await frame();
          check('removed charts disconnect every observer',[...observers].every(o=>o.targets.size===0));
        }
      }finally{window.ResizeObserver=NativeResize;}
      return{cycles:30,failures:[...new Set(failures)],activeObserversAfterRemoval:[...observers].filter(o=>o.targets.size).length};
    });
    fs.writeFileSync(path.join(output, 'checks.json'), JSON.stringify({ ...checks, errors }, null, 2));
    assert.deepEqual(checks.failures, []);
    assert.deepEqual(errors, []); assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), before);
    assert.match(await page.title(), /Agent Usage/); assert.match(page.url(), /desktop-reference.*index\.html/);
    await page.screenshot({ path: path.join(output, 'empty-cost-after-lifecycle.png') });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), ...checks, emptyMonthNavigates: true, noErrors: true, ledgerUnchanged: true, realAccountRequests: 0 }, null, 2));
    console.log('PASS: renderer lifecycle, empty month, live hover, IME and cancelled swipe; ' + output);
  } finally { if (app) await app.close(); await cleanup(root); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
