'use strict';
/* global document */
const assert=require('node:assert/strict'),path=require('node:path');
const {settle}=require('./ui-settle');
async function run(page,output,scale){
 await page.evaluate(()=>{const host=document.createElement('div');host.id='costReferenceCases';document.body.append(host);window.costReferences=window.agentUi.mount('kit-gallery',host);});
 const root=page.locator('#costReferenceCases');await root.locator('[data-m8-gallery]').waitFor();
 const reference=root.locator('[data-m8-case=reference]');await reference.scrollIntoViewIfNeeded();await settle(page);
 assert.equal(await reference.locator('svg').getAttribute('height'),'176','kit detail height, SPEC §7');
 assert.equal(await reference.locator('svg g.text-micro line').count(),5);
 assert.equal(await reference.locator('[data-detail-end-label]').textContent(),'$31.84');
 await reference.locator('[data-line-point="6"]').hover();assert.match(await reference.getByRole('tooltip').textContent(),/\$31\.84/);
 await reference.locator('[data-chart=line]').press('Home');await page.keyboard.press('ArrowRight');
 assert.match(await reference.getByRole('tooltip').textContent(),/2026-10-13/);await page.keyboard.press('Escape');
 assert.equal(await reference.getByRole('tooltip').count(),0);
 assert(await reference.locator('[data-chart=line]').evaluate(e=>e.contains(document.activeElement)),'Escape retains keyboard focus inside inline chart');
 await reference.screenshot({path:path.join(output,'reference-'+scale+'.png')});
 const sparse=root.locator('[data-m8-case=sparse]');await sparse.scrollIntoViewIfNeeded();
 assert.equal(await sparse.locator('[data-line-run]').count(),3,'unknown dates split the curve');
 await sparse.locator('[data-chart=line]').press('Home');assert.equal(await sparse.getByRole('tooltip').textContent(),'$0');
 await page.keyboard.press('ArrowRight');assert.equal(await sparse.getByRole('tooltip').textContent(),'未报告');
 assert((await sparse.locator('svg g.text-micro text').allTextContents()).some(s=>s.includes('e-')));
 assert.equal(await root.locator('[data-m8-case=empty] [data-detail-end]').count(),0);
 assert(await root.locator('[data-m8-case=empty]').getByText('当前范围没有已计入估算的用量。',{exact:true}).isVisible());
 assert.equal(await root.locator('[data-m8-case=per-agent-gap] [data-line-run]').count(),3);
 await page.evaluate(()=>{window.costReferences.unmount();document.getElementById('costReferenceCases').remove();});
}
module.exports={run};
