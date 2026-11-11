'use strict';
/* global document, MutationObserver, requestAnimationFrame */
// What one interaction in the reading page actually costs on the main thread.
// Long tasks are attributed by name: opening the conversation, jumping with the
// outline, switching what is shown, following a running one, closing. Frame gaps
// alone hide the blocking work, because a 200 ms task still looks like a steady
// 60 fps staircase between frames. Synthetic home only.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { _electron: electron } = require('playwright');
const { seed, CODEX_ID } = require('../../tests/m1/sessions-reader-fixture');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { showView, settle, until, isolatePointer, cleanup } = require('./ui-settle');

const summary = values => { if (!values.length) return { count: 0, totalMs: 0, maxMs: 0, p95Ms: 0 };
  const sorted = values.toSorted((a, b) => a - b);
  return { count: values.length, totalMs: Math.round(values.reduce((n, v) => n + v, 0)), maxMs: Math.round(sorted.at(-1)),
    p95Ms: Math.round(sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)]), over50: values.filter(v => v > 50).length }; };

async function run() {
  const turns = Number(process.env.READER_TURNS || 300), replyRepeat = Number(process.env.READER_REPLY_REPEAT || 3000);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-longtask-'));
  const out = path.resolve(process.env.LONGTASK_OUTPUT || 'artifacts/explore-20261102/longtask');
  fs.mkdirSync(out, { recursive: true });
  const seeded = await seed(root), { home, usage } = seeded;
  const producer = new Store(usage, roots(home)), now = Date.now();
  producer.state.sequence++; atomic(path.join(usage, 'statistics.json'), producer.state); producer.setEnabled(false);
  const longReply = '```js\n' + Array.from({ length: 40 }, (_, i) => 'const item' + i + ' = ' + i + ';').join('\n') + '\n```\n\n' + '合成内存测量段落。'.repeat(replyRepeat);
  const rows = [{ timestamp: new Date(now - 600000).toISOString(), type: 'session_meta', payload: { id: CODEX_ID, cwd: 'C:/synthetic/reader-longtask', originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } }];
  for (let i = 0; i < turns; i++) {
    const timestamp = new Date(now - 600000 + i * 1000).toISOString();
    rows.push(
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '合成长会话问题 ' + i }] } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: longReply }] } },
      { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: (i + 1) * 100, output_tokens: (i + 1) * 20, total_tokens: (i + 1) * 120 } } } });
  }
  fs.writeFileSync(seeded.codexFile, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const report = { schemaVersion: 'ReaderLongTaskV1', turns, replyRepeat, syntheticOnly: true,
    measurement: 'PerformanceObserver longtask entries (browser-attributed duration) plus CDP style/layout/script deltas, per named interaction; synthetic data only',
    noForcedGC: true, steps: {}, errors: [] };
  const sourceRoot = path.resolve(process.env.LONGTASK_SOURCE_ROOT || '.');
  const artifact = process.env.QUOTA_PACKAGED_EXE ? path.join(path.dirname(process.env.QUOTA_PACKAGED_EXE), 'resources/app.asar') : path.join(sourceRoot, 'design/desktop-reference/ui/agent-ui.js');
  report.productByteProof = { sourceRoot, kind: process.env.QUOTA_PACKAGED_EXE ? 'ASAR' : 'compiled renderer', sha256: crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex') };
  if (!process.env.QUOTA_PACKAGED_EXE) report.productByteProof.previewSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot, 'design/desktop-reference/preview.js'))).digest('hex');
  if (!process.env.QUOTA_PACKAGED_EXE) report.productByteProof.sourceFiles = Object.fromEntries(['src/quota/main.js','src/m1/store.js','src/m1/session-list-codec.js','src/m1/saved-string-sharing.js','design/desktop-reference/usage-data.js','design/desktop-reference/ui/agent-ui.css'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot,file))).digest('hex')]));
  let app;
  const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  try {
    app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [
      ...(process.env.QUOTA_PACKAGED_EXE ? [] : [path.join(sourceRoot, 'src/quota/main.js')]), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home], timeout: 60000 });
    await isolatePointer(app);
    const page = await app.firstWindow(); await page.waitForURL(/^file:/); await page.waitForLoadState('load');
    await until(page, () => window.usageData.ready());
    report.environment = await app.evaluate(({ app, screen, BrowserWindow }) => ({ runtime: { ...process.versions }, rendererJsFlags: app.commandLine.getSwitchValue('js-flags'), bounds: BrowserWindow.getAllWindows()[0].getBounds(), displays: screen.getAllDisplays().map(d => ({ id: d.id, scale: d.scaleFactor, refreshRate: d.displayFrequency, size: d.size })) }));
    page.on('pageerror', error => report.errors.push(error.message));
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const counters = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics
      .filter(m => /^(LayoutCount|RecalcStyleCount|LayoutDuration|RecalcStyleDuration|ScriptDuration|TaskDuration|Nodes)$/.test(m.name)).map(m => [m.name, m.value]));
    await page.evaluate(() => { window.readerLong = []; new PerformanceObserver(list => { for (const entry of list.getEntries()) window.readerLong.push(Math.round(entry.duration)); }).observe({ entryTypes: ['longtask'] }); });
    const step = async (label, work, passive=false) => {
      const profile=process.env.LONGTASK_CPU_PROFILE==='1'&&label.startsWith('leave-page');
      if(profile){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
      await page.evaluate(() => { window.readerLong.length = 0; });
      const before = await counters(), began = Date.now();
      await work(); if(passive)await page.waitForTimeout(1000);else await settle(page);
      const after = await counters(), durations = await page.evaluate(() => window.readerLong.slice()), wallMs = Date.now() - began;
      const delta = key => after[key] - before[key];
      const row = { label, wallMs, longTasks: summary(durations), longTaskMs: durations,
        layoutCount: Math.round(delta('LayoutCount')), recalcStyleCount: Math.round(delta('RecalcStyleCount')),
        layoutMs: Math.round(delta('LayoutDuration') * 1000), recalcStyleMs: Math.round(delta('RecalcStyleDuration') * 1000),
        scriptMs: Math.round(delta('ScriptDuration') * 1000), taskMs: Math.round(delta('TaskDuration') * 1000),
        nodes: Math.round(after.Nodes), mountedTurns: await page.locator('[data-reader-turn]').count() };
      if(profile){const {profile:cpu}=await cdp.send('Profiler.stop');await cdp.send('Profiler.disable');fs.writeFileSync(path.join(out,'leave-page.cpuprofile'),JSON.stringify(cpu));row.cpuProfiled=true;}
      report.steps[label] = row; save(); console.log(JSON.stringify(row)); return row;
    };
    await showView(page, 'sessions');
    await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click();
    await until(page, () => !!window.sessionsHost.get().list && !window.sessionsHost.get().loading);
    await page.getByRole('textbox', { name: '搜索会话', exact: true }).fill(CODEX_ID); await settle(page);
    let closed = page.locator('[data-session-group] [data-fold-head] button[aria-expanded=false]');
    while (await closed.count()) { await closed.first().click(); await settle(page); }
    const key = await page.evaluate(id => window.sessionsHost.get().list.sessions.find(row => row.id === id)?.key, CODEX_ID);
    await page.waitForTimeout(2000);
    await step('open-reader', async () => { await page.locator('[data-session="' + key + '"] [data-fold-cell="tokens"]').click(); await page.locator('[data-reader-turn]').first().waitFor(); });
    await page.waitForTimeout(1500);
    const jump = async stop => { await page.locator('[data-outline-item="' + stop + '"]').click(); await page.locator('[data-reader-turn="' + stop + '"]').waitFor(); };
    await step('jump-150', () => jump(150));
    await step('jump-299', () => jump(299));
    await step('jump-back-150', () => jump(150));
    await step('jump-back-0', () => jump(0));
    await step('view-talk', async () => { await page.getByRole('tablist', { name: '显示内容', exact: true }).getByRole('tab', { name: '只看对话', exact: true }).click(); });
    await step('view-all', async () => { await page.getByRole('tablist', { name: '显示内容', exact: true }).getByRole('tab', { name: '全部', exact: true }).click(); });
    // Scrolling with every turn mounted, in both directions.
    await jump(299); await page.waitForTimeout(1200);
    const scrollStep = async (label, delta, times) => step(label, async () => {
      await page.locator('[data-reader-scroll]').hover();
      for (let i = 0; i < times; i++) { await page.mouse.wheel(0, delta); await page.waitForTimeout(16); }
    });
    await scrollStep('scroll-up', -400, 40);
    await scrollStep('scroll-down', 400, 40);
    // Following a conversation that is still being written.
    await page.locator('[data-reader-back] button').click(); await showView(page, 'sessions'); await settle(page);
    await page.getByRole('textbox', { name: '搜索会话', exact: true }).fill(CODEX_ID); await settle(page);
    closed = page.locator('[data-session-group] [data-fold-head] button[aria-expanded=false]');
    while (await closed.count()) { await closed.first().click(); await settle(page); }
    await page.locator('[data-session="' + key + '"] [data-fold-cell="tokens"]').click();
    await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
    await jump(299); await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '跟随', exact: true }).click();
    await step('follow-update', async () => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(seeded.codexFile, [{ timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '合成跟随问题' }] } }, { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '合成跟随回复' }] } }].map(row => JSON.stringify(row)).join('\n') + '\n');
      await page.waitForFunction(count => document.querySelector('[data-reader-page] header')?.textContent.includes(count + ' 轮'), turns + 1, { timeout: 90000 });
    });
    // Closing the reader and leaving the page are two separate costs: the first tears down the mounted turns,
    // the second re-renders whatever the shell shows next. Bundled together they cannot be attributed.
    await step('close-reader', async () => { await page.getByRole('button', { name: '跟随中', exact: true }).click(); await page.locator('[data-reader-back] button').click(); await page.waitForFunction(() => !document.querySelector('[data-reader-page]'), null, { timeout: 30000 }); await settle(page); });
    if(process.env.LONGTASK_NATIVE_LEAVE==='1'){
      const button=await page.locator('[data-view="usage"]').boundingBox();if(!button)throw Error('NATIVE_NAVIGATION_TARGET_MISSING');
      await page.evaluate(()=>{const main=document.getElementById('main');window.nativeLeave={};const observer=new MutationObserver(()=>{if(main.dataset.currentView!=='usage')return;window.nativeLeave.routeAt??=performance.now();if(main.querySelector('[data-usage-page]')){window.nativeLeave.contentAt=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{window.nativeLeave.contentNextFrameAt=performance.now();}));observer.disconnect();}});observer.observe(main,{attributes:true,attributeFilter:['data-current-view'],childList:true,subtree:true});});
      await step('leave-page-native',async()=>{await page.evaluate(()=>{window.nativeLeave.clickedAt=performance.now();});await page.mouse.click(button.x+button.width/2,button.y+button.height/2);},true);
      if(!await page.evaluate(()=>document.getElementById('main').dataset.currentView==='usage'))throw Error('NATIVE_NAVIGATION_UNANSWERED');
      await page.mouse.move(button.x+button.width+300,250);
      await page.evaluate(()=>{window.nativeLeave.wheelAt=performance.now();const before=window.scrollY;const changed=()=>{if(window.scrollY!==before){window.nativeLeave.wheelResponseMs=performance.now()-window.nativeLeave.wheelAt;window.removeEventListener('scroll',changed);}};window.addEventListener('scroll',changed,{passive:true});});
      await page.mouse.wheel(0,400);await page.waitForFunction(()=>Number.isFinite(window.nativeLeave.wheelResponseMs),null,{timeout:3000});
      if(!await page.evaluate(()=>Number.isFinite(window.nativeLeave.contentNextFrameAt)))throw Error('NATIVE_CONTENT_UNANSWERED');
      report.nativeLeave=await page.evaluate(()=>({...window.nativeLeave,routeChangedMs:window.nativeLeave.routeAt-window.nativeLeave.clickedAt,contentRootMs:window.nativeLeave.contentAt-window.nativeLeave.clickedAt,contentNextFrameMs:window.nativeLeave.contentNextFrameAt-window.nativeLeave.clickedAt}));
      report.nativeLeaveMeasurement='real pointer click, passive 1000 ms capture without animation/layout queries; a subsequent real wheel must actually move the page';
    }else await step('leave-page', async () => { await showView(page, 'usage'); });
    if (report.errors.length) throw Error('RENDERER_ERRORS');
    report.worst = Object.entries(report.steps).map(([label, row]) => ({ label, ...row.longTasks, scriptMs: row.scriptMs })).sort((a, b) => b.maxMs - a.maxMs).slice(0, 5);
    report.gpuAfterMeasurement = await app.evaluate(async ({ app }) => app.getGPUInfo('complete'));
    report.ok = true; save();
  } catch (error) {
    report.failed = { message: error.message }; save();
    if (app) await app.firstWindow().then(page => page.screenshot({ path: path.join(out, 'failure.png') })).catch(() => {});
    throw error;
  } finally { if (app) await app.close(); await cleanup(root); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
