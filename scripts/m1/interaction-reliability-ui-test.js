'use strict';
/* global document, requestAnimationFrame, KeyboardEvent, CompositionEvent, WheelEvent, getComputedStyle, innerWidth */
// Source or packaged Electron, disposable stores and fixture homes only. These event traces
// exercise app policy, not the actual Windows IME candidate window.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { scanSources } = require('../../src/m1/sources');
const { fixtures } = require('../../tests/m1/fixtures');
const { settle, until, showView, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const { dialog, openSettings, openPricing, openNewPrice, waitClosed } = require('./settings-ui-helpers');
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const composition = (page, selector, phase) => page.locator(selector).evaluate((element, type) => element.dispatchEvent(new CompositionEvent(type, { bubbles: true, data: type === 'compositionend' ? '中文' : '' })), phase);
async function keyTrace(page, selector, key, extra = {}) {
  return page.locator(selector).evaluate((element, args) => {
    const event = new KeyboardEvent('keydown', { key: args.key, bubbles: true, cancelable: true, ...args.extra }); element.dispatchEvent(event); return event.defaultPrevented;
  }, { key, extra });
}
async function sourceFailure(app, mode) {
  await app.evaluate(({ app }, mode) => {
    // Source mode starts src/quota/main.js, whose app path is src/quota; a packaged build's app path is the tree root.
    const req = process.mainModule.require.bind(process.mainModule), base = app.isPackaged ? app.getAppPath() : req('node:path').resolve(app.getAppPath(), '..', '..');
    const { StatisticsService } = req(base + '/src/m1/statistics-service.js');
    global.reliabilityOriginalCall ||= StatisticsService.prototype.call;
    if (mode === 'normal') { StatisticsService.prototype.call = global.reliabilityOriginalCall; return; }
    // Inject at the active owner-command boundary. Main-process Store/Service
    // prototypes no longer own writes, discovery or collection after the move.
    StatisticsService.prototype.call = async function (command, ...args) {
      if (command === 'discover' && mode === 'discover') throw new Error('DISCOVERY_FAILED');
      if (command === 'changeSources' && mode === 'save') throw new Error('SYNTHETIC_WRITE_FAILURE');
      if (command === 'discover' && mode === 'slow') await new Promise(resolve => setTimeout(resolve, 300));
      if (command === 'refresh' && mode === 'collect') return null;
      const value = await global.reliabilityOriginalCall.call(this, command, ...args);
      return mode === 'collect' && ['get','getPacked'].includes(command) ? { ...value, error: 'COLLECTION_FAILED' } : value;
    };
  }, mode);
}
async function seed(root) {
  const home = path.join(root, 'home'), fixture = fixtures(home), usage = path.join(root, 'usage'), store = new Store(usage, fixture.roots);
  const sessionFile = path.join(fixture.roots.codex[0], 'session.jsonl');
  const session = fs.readFileSync(sessionFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  session[0].payload.cwd = path.join(home, '项目-' + 'long-project-path-'.repeat(20));
  session[1].payload.model = 'reliability-long-session-model-' + 'long-model-'.repeat(24);
  fs.writeFileSync(sessionFile, session.map(row => JSON.stringify(row)).join('\n') + '\n');
  fs.writeFileSync(path.join(fixture.roots.codex[1], 'copied.jsonl'), session.map(row => JSON.stringify(row)).join('\n') + '\n');
  store.ingest(await scanSources(fixture.roots, store.state.salt, { reads: 0 }), { status: 'not-run' });
  for (let i = 0; i < 48; i++) {
    const record = normalize(i % 2 ? 'claude' : 'codex', { input_tokens: 900000000, output_tokens: 100000000, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 1000000000 },
      { id: 'reliability-' + i, time: Date.now() - (i % 25) * 86400000, provider: 'synthetic', model: 'reliability-unknown-model-' + i + '-long-name-for-container-check', entry: 'desktop' }, 'synthetic-salt');
    store.state.records[record.id] = record;
  }
  store.state.sequence++; atomic(path.join(usage, 'statistics.json'), store.state); store.setEnabled(false);
  return { home, usage };
}
(async()=>{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-interaction-reliability-'));
  const output = path.resolve(process.env.INTERACTION_EVIDENCE_DIR || 'artifacts/interaction-reliability'), results = [];
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const scale of [1, 1.5]) {
      const { home, usage } = await seed(path.join(root, 'scale-' + scale));
      const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota-' + scale), '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout: 60000 });
      try {
        const page = await app.firstWindow(), errors = []; await keepVisible(app); await isolatePointer(app);
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await showView(page, 'usage');
        assert((await page.title()).includes('Agent Usage')); assert((await page.url()).includes('index.html'));
        await page.evaluate(() => window.uiMotion.setPreference('off'));
        // A real search Escape is dispatched while an event-based composition is
        // active. It may cancel a candidate, but must leave app text and layer alone.
        const searches = [['sessions', '[data-session-search] input'], ['settings', '[data-settings-page] input[placeholder="搜索设置项..."]'], ['cost', '[data-cost-table] input']];
        for (const [view, selector] of searches) {
          console.log('CHECK', scale, 'composition-search', view);
          await showView(page, view);
          if (view === 'cost') await require('./cost-ui-helpers').group(page,'model');
          await page.locator(selector).fill('reliability'); await composition(page, selector, 'compositionstart');
          if (view === 'sessions') {
            await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('window:command', 'settings')); await frames(page);
            assert.equal(await page.evaluate(() => document.getElementById('main').dataset.currentView), view, 'native menu accelerator obeys composition policy');
          }
          await page.locator(selector).press('Escape'); assert.equal(await page.locator(selector).inputValue(), 'reliability', selector + ' keeps composed text');
          assert.equal(await keyTrace(page, selector, 'Escape', { keyCode: 229 }), true);
          await composition(page, selector, 'compositionend'); await frames(page);
          assert.equal(await keyTrace(page, selector, 'Escape', { keyCode: 229 }), true, 'legacy 229 without an active composition is protected');
          assert.equal(await page.locator(selector).inputValue(), 'reliability');
          await page.locator(selector).press('Escape'); assert.equal(await page.locator(selector).inputValue(), '', selector + ' ordinary Escape clears');
        }
        // Modal + nested model list: candidate Enter/Escape/arrows do nothing;
        // Escape then dismisses only the innermost layer, then the native dialog.
        await openPricing(page); await openNewPrice(page);
        console.log('CHECK', scale, 'nested-model-dialog');
        const picker = dialog(page).getByRole('button', { name: '从目录模型复制价格（可选）', exact: true }), search = '[data-ui-portal] [role="menu"] input';
        await picker.click(); await page.locator(search).waitFor(); await until(page, () => document.activeElement?.matches('[data-ui-portal] [role="menu"] input'));
        const original = await picker.textContent();
        await composition(page, search, 'compositionstart');
        for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', 'Escape']) await keyTrace(page, search, key, { isComposing: true });
        assert.equal(await picker.textContent(), original);
        assert(await page.locator(search).evaluate(element => element === document.activeElement), 'candidate keys leave focus in the search');
        await page.locator(search).press('Escape'); assert.equal(await page.locator('[data-ui-portal] [role="menu"]').count(), 1, 'IME Escape keeps the list'); assert.equal(await dialog(page).count(), 1);
        assert.equal(await page.evaluate(() => document.querySelectorAll('[data-ui-portal] form').length), 1, 'the manual price form is open');
        assert(await page.evaluate(() => { const event = new Event('submit', { bubbles: true, cancelable: true }); document.querySelector('[data-ui-portal] form').dispatchEvent(event); return event.defaultPrevented; }), 'composition protects submit');
        assert.equal(await dialog(page).count(), 1, 'the sheet stays open');
        assert(await page.locator(search).evaluate(element => {
          element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
          const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); element.dispatchEvent(event); return event.defaultPrevented;
        }), 'compositionend-before-confirming-key is guarded in the same event turn'); await frames(page);
        await page.locator(search).fill('gpt');
        assert.equal(await keyTrace(page, search, 'Home'), false, 'Home remains an input editing key');
        await page.locator(search).press('ArrowDown'); assert(await page.evaluate(() => document.activeElement?.getAttribute('role') === 'menuitemradio'), 'ArrowDown moves to the list');
        await page.keyboard.press('Enter'); await until(page, () => !document.querySelector('[data-ui-portal] [role="menu"]'));
        assert.notEqual(await picker.textContent(), original, 'ordinary Enter commits the selected model');
        assert.equal(await dialog(page).count(), 1, 'choosing does not submit the parent form');
        await picker.click(); await page.locator(search).waitFor();
        await page.locator(search).press('Escape'); await until(page, () => !document.querySelector('[data-ui-portal] [role="menu"]')); assert.equal(await dialog(page).count(), 1, 'Escape closes only the list');
        // Shift+Tab / Tab stay inside the sheet.
        for (const key of ['Tab', 'Shift+Tab', ...Array(20).fill('Tab')]) { await page.keyboard.press(key); assert(await page.evaluate(() => document.querySelector('[data-ui-portal] [role="dialog"]').contains(document.activeElement))); }
        await page.keyboard.press('Escape'); await waitClosed(page);

        // Agent and segmented controls share wrapping, Home/End and selected focus.
        await showView(page, 'usage'); await page.locator('[data-usage-agents] [role=radio]').first().focus(); await page.keyboard.press('End');
        console.log('CHECK', scale, 'roving-and-scroll');
        assert.equal(await page.locator('[data-usage-agents] [role=radio]').last().getAttribute('aria-checked'), 'true'); await page.keyboard.press('Home');
        assert.equal(await page.evaluate(()=>window.usageHost.filters().agent), 'all');
        const segments = page.locator('[data-usage-periods] [role=tablist]').first(); await segments.locator('button').first().focus(); await page.keyboard.press('End');
        assert.equal(await segments.locator('button').last().getAttribute('aria-selected'), 'true');
        // A month filter has no pressed period, but its range choices must keep
        // one Tab entry so keyboard users can leave the month without a mouse.
        await showView(page, 'cost'); await page.locator('[data-cost-months] [data-chart-key]').first().click(); await settle(page);
        // The range now lives in the owner-requested edge overlay. Open it before
        // checking its Tab stop, and distinguish its preset from the chart reset.
        await page.getByRole('button',{name:'用日历选择范围',exact:true}).focus(); await page.getByRole('button',{name:'用日历选择范围',exact:true}).click(); await settle(page);
        assert.equal(await page.locator('[data-cost-range-sheet] [role=tab][tabindex="0"]').count(), 1, 'month selection retains a range-group Tab entry');
        await page.locator('[data-cost-range-sheet] [role=tab][tabindex="0"]').focus(); await page.keyboard.press('Home');
        assert.equal(await page.locator('[data-cost-range-sheet]').getByRole('tab',{name:'累计',exact:true}).getAttribute('aria-selected'), 'true');
        assert(await page.evaluate(()=>window.costHost.state().month===null), 'range keyboard selection clears the month');
        await page.keyboard.press('Escape'); await until(page, () => !document.querySelector('[data-cost-range-sheet]'));
        await openSettings(page); const categories = page.getByRole('tablist', { name: '设置分类' }).getByRole('tab');
        await categories.first().focus(); await page.keyboard.press('End');
        assert(await categories.last().evaluate(e => e === document.activeElement));

        // Scroll restoration is a cancellable task, even when the user's input
        // was consumed inside a child list. Superseded jobs cannot paint later.
        await showView(page, 'usage');
        for (const reason of ['resize', 'ui-scroll-cancel']) {
          const position = await page.evaluate(async name => {
            const section = document.querySelector('[data-usage-activity]'); window.scrollTo(0, 400); window.uiDetail.keepPlace(section, section.getBoundingClientRect().top);
            window.dispatchEvent(new Event(name)); section.style.marginTop = '100px'; window.scrollTo(0, 600);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const result = window.scrollY; section.style.marginTop = ''; return result;
          }, reason); assert(Math.abs(position - 600) < 2, reason + ' cancels pending corrections');
        }
        const interrupted = await page.evaluate(async () => {
          const section = document.querySelector('[data-usage-activity]'); window.scrollTo(0, 500);
          window.uiDetail.keepPlace(section, section.getBoundingClientRect().top);
          document.querySelector('[data-usage-agents]').dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
          window.scrollTo(0, 650); section.style.marginTop = '100px';
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const result = window.scrollY; section.style.marginTop = ''; return result;
        }); assert(Math.abs(interrupted - 650) < 2, 'user wheel cancels every pending correction');
        const superseded = await page.evaluate(async () => {
          const section = document.querySelector('[data-usage-activity]'); window.scrollTo(0, 400);
          window.uiDetail.keepPlace(section, section.getBoundingClientRect().top);
          window.uiDetail.scrollTo(750); section.style.marginTop = '100px';
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const result = window.scrollY; section.style.marginTop = ''; return result;
        }); assert(Math.abs(superseded - 750) < 2, 'explicit jump supersedes keepPlace');
        await page.evaluate(() => { const s = document.querySelector('[data-usage-activity]'); window.uiDetail.keepPlace(s, s.getBoundingClientRect().top); window.usageData.view('cost'); }); await frames(page);
        assert.equal(await page.evaluate(() => window.scrollY), 0, 'old route cannot steal new route position');
        await showView(page, 'usage');
        for (const id of ['codex', 'claude', 'all', 'codex', 'all']) await page.locator('[data-usage-agents] [data-agent="' + id + '"]').click(); await settle(page);
        await page.locator('[data-usage-refresh] button').click(); await until(page, async () => !(await window.usageBridge.get()).collecting); await settle(page);

        // Source preference failure is injected at the owner-command boundary: validate
        // both persisted bytes and the displayed saved-vs-discovered distinction.
        await showView(page, 'sources'); await page.waitForFunction(() => !document.querySelector('[data-source-rows]').getAttribute('aria-busy') || document.querySelector('[data-source-rows]').getAttribute('aria-busy') === 'false');
        console.log('CHECK', scale, 'source-recovery');
        await page.locator('[data-source-summary]').filter({ hasText: '个来源' }).waitFor();
        const before = await page.evaluate(async () => (await window.usageBridge.get()).snapshot.daily.reduce((n, r) => n + r.totalTokens, 0));
        await page.evaluate(() => { window.reliabilitySourceNode = document.querySelector('[data-source-agent="gemini"] [role=switch]'); });
        await sourceFailure(app, 'discover'); await page.locator('[data-source-agent="gemini"] [role=switch]').click();
        await page.locator('[data-source-notice]').filter({ hasText: '来源设置已保存，读取位置检查失败' }).waitFor();
        assert(JSON.parse(fs.readFileSync(path.join(usage, 'preferences.json'), 'utf8')).sources.disabled.includes('gemini'));
        assert.equal(await page.locator('[data-source-agent="gemini"] [role=switch]').getAttribute('aria-checked'), 'false');
        assert(await page.evaluate(() => window.reliabilitySourceNode === document.querySelector('[data-source-agent="gemini"] [role=switch]')), 'React preserves source switch node');
        assert((await page.locator('[data-source-notice]').innerText()).includes('历史统计保留'));
        await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(output, 'saved-discovery-failed-' + scale + '.png') });
        await sourceFailure(app, 'normal'); await page.locator('[data-source-notice]').getByRole('button',{name:/重试/}).click(); await page.locator('[data-source-summary]').filter({ hasText: '个来源' }).waitFor();
        await sourceFailure(app, 'save'); await page.locator('[data-source-agent="gemini"] [role=switch]').click();
        await page.locator('[data-source-notice]').filter({ hasText: '来源操作未完成' }).waitFor();
        assert.equal(await page.locator('[data-source-agent="gemini"] [role=switch]').getAttribute('aria-checked'), 'false', 'failed save restores displayed switch');
        assert(JSON.parse(fs.readFileSync(path.join(usage, 'preferences.json'), 'utf8')).sources.disabled.includes('gemini'));
        await sourceFailure(app, 'slow'); await page.locator('[data-source-notice]').getByRole('button',{name:/重试/}).click();
        await page.evaluate(() => { document.querySelector('[data-source-agent="claude"] [role=switch]').click(); document.querySelector('[data-source-bulk] button').click(); document.querySelector('[data-source-refresh] button').click(); });
        await page.locator('[data-source-summary]').filter({ hasText: '读取 17 / 17' }).waitFor();
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(usage, 'preferences.json'), 'utf8')).sources.disabled, [], 'busy blocks rapid switch/bulk/refresh reentry');
        assert.equal(await page.locator('[data-source-agent="claude"] [role=switch]').getAttribute('aria-checked'), 'true');
        await sourceFailure(app, 'normal');
        // A discovery started on the old selection cannot be returned as the
        // report for a subsequently saved preference.
        const concurrent = await page.evaluate(async () => {
          const first = window.usageBridge.sources(), changed = window.usageBridge.changeSource('enable', 'gemini', false);
          await first; return changed;
        }); assert.equal(concurrent.discovery.sources.find(source => source.agent === 'gemini').enabled, false);
        await page.evaluate(() => window.usageBridge.changeSource('enable', 'gemini', true)); await page.evaluate(() => window.sourcesUi.reload());
        // Native picker accepted, preference persisted, discovery failed: keep
        // the new path visible and explain the paused collection explicitly.
        const added = path.join(home, 'synthetic added source'); fs.mkdirSync(added);
        await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, added);
        await sourceFailure(app, 'discover'); await require('./sources-ui-helpers').openSource(page,'codex'); await page.locator('[data-source-add="codex"] button').click();
        await page.locator('[data-source-notice]').filter({ hasText: '读取路径已保存，采集已暂停；读取位置检查失败' }).waitFor();
        assert(JSON.parse(fs.readFileSync(path.join(usage, 'preferences.json'), 'utf8')).sources.added.codex.includes(added));
        await sourceFailure(app, 'normal'); await page.locator('[data-source-notice]').getByRole('button',{name:/重试/}).click(); await page.locator('[data-source-summary]').filter({ hasText: '个来源' }).waitFor();
        await sourceFailure(app, 'collect'); await page.locator('[data-source-refresh] button').click();
        await page.locator('[data-source-notice]').filter({ hasText: '最近采集没有完整完成' }).waitFor();
        await sourceFailure(app, 'normal'); await page.locator('[data-source-refresh] button').click(); await page.locator('[data-source-summary]').filter({ hasText: '个来源' }).waitFor();
        // Disappearing path action falls back to its own details summary.
        await require('./sources-ui-helpers').openSource(page,'codex');
        const remove = page.locator('[data-source-agent="codex"] [data-source-path-action="remove"] button').first(); await remove.focus(); await remove.click();
        await page.locator('[data-source-agent="codex"] [data-source-path-action="include"] button').first().waitFor();
        await page.locator('[data-source-reset="codex"] button').click();
        await page.locator('[data-source-reset="codex"] button').waitFor({ state: 'detached' });
        assert(await page.locator('[data-source-agent="codex"] [data-source-paths] button').evaluate(e => e === document.activeElement));
        assert.equal(await page.evaluate(async () => (await window.usageBridge.get()).snapshot.daily.reduce((n, r) => n + r.totalTokens, 0)), before, 'changing scope retains recorded history');

        // Single-axis fades react to overflow, boundaries, resize and content;
        // keyboard focus removes the mask so the ring and values remain legible.
        await openPricing(page); const filter = page.getByRole('textbox', { name: '筛选已用模型', exact: true }); await filter.fill('reliability'); await frames(page);
        console.log('CHECK', scale, 'fade-and-layout');
        const list = page.locator('[data-price-models] [data-slot="scroll-area-viewport"]');
        const edges = () => list.evaluate(e => { const style = getComputedStyle(e); return [Number(style.getPropertyValue('--sf-start')), Number(style.getPropertyValue('--sf-end'))]; });
        assert.deepEqual(await edges(), [1, 0], 'top: only the bottom fades');
        await list.evaluate(e => { e.scrollTop = 100; }); await frames(page); assert.deepEqual(await edges(), [0, 0], 'middle: both edges fade');
        await list.evaluate(e => { e.scrollTop = e.scrollHeight; }); await frames(page); assert.deepEqual(await edges(), [0, 1], 'bottom: only the top fades');
        await list.locator('button').last().focus(); assert.equal(await list.evaluate(e => getComputedStyle(e).maskImage), 'none');
        await filter.fill('reliability-unknown-model-47-'); await frames(page);
        assert.equal(await list.evaluate(e => getComputedStyle(e).maskImage), 'none', 'no overflow means no fade');
        await filter.fill('reliability'); await filter.focus(); await frames(page);
        await list.evaluate(e => { e.style.maxHeight = 'none'; }); await frames(page);
        assert.equal(await list.evaluate(e => getComputedStyle(e).maskImage), 'none', 'resize removes obsolete edges');
        await list.evaluate(e => { e.style.maxHeight = ''; e.scrollTop = 0; }); await frames(page);
        await list.scrollIntoViewIfNeeded(); await list.hover(); await page.mouse.wheel(0, 140);
        await page.waitForFunction(() => document.querySelector('[data-price-models] [data-slot="scroll-area-viewport"]').scrollTop > 0);
        await list.evaluate(e => { e.scrollTop = e.scrollHeight; }); await frames(page);
        const bottomY = await page.evaluate(() => window.scrollY); await page.mouse.wheel(0, 180);
        await page.waitForFunction(y => window.scrollY > y + 2, bottomY);
        await list.scrollIntoViewIfNeeded(); await list.evaluate(e => { e.scrollTop = 0; }); await list.hover();
        const topY = await page.evaluate(() => window.scrollY); await page.mouse.wheel(0, -180);
        await page.waitForFunction(y => window.scrollY < y - 2, topY);
        await list.evaluate(e => { e.scrollTop = 0; });
        for (const mode of ['reduced', 'off']) { await page.evaluate(value => window.uiMotion.setPreference(value), mode); await frames(page); assert.equal((await edges())[1], 0, mode + ' keeps the edge cue'); }

        // Smallest supported content area at each device scale; exercise native
        // queries in a narrow container even when the viewport itself is wide.
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(800, 600));
        for (const view of ['usage', 'cost', 'sessions', 'sources', 'settings']) {
          await showView(page, view); await frames(page);
          const geometry = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
          assert(geometry.width <= geometry.viewport + 2, view + ' page has no horizontal overflow: ' + JSON.stringify(geometry));
          await page.screenshot({ path: path.join(output, view + '-800-' + scale + '.png') });
        }
        await showView(page, 'sessions'); await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click();
        if (await page.locator('[data-session-group]').first().getAttribute('data-open') !== 'true') await page.locator('[data-session-group] [data-fold-head] button[aria-expanded]').first().click();
        await page.locator('[data-session] [data-session-detail-open] button').first().click(); await frames(page);
        // Presentation stress stays independent of parser identifier limits.
        await page.evaluate(() => {
          document.querySelector('[role=dialog]').style.width = '420px';
          document.querySelector('[data-session-detail-model]').textContent = 'synthetic/' + 'long-model-with-no-spaces-'.repeat(24);
          document.querySelector('[data-session-detail-stats] dd').textContent = '999,999,999,999,999,999,999';
        }); await frames(page);
        const dialogSize = await page.getByRole('dialog').evaluate(e => ({ width: e.clientWidth, content: e.scrollWidth, open: true }));
        assert(dialogSize.open && dialogSize.content <= dialogSize.width + 2, 'inspector remains usable in the minimum window');
        assert.equal(await page.locator('[data-session-detail-stats]').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length), 3, 'inspector keeps the cost detail tiles');
        assert((await page.getByRole('dialog').innerText()).includes('未定价') || (await page.getByRole('dialog').innerText()).includes('未计入'));
        await page.screenshot({ path: path.join(output, 'inspector-800-' + scale + '.png') }); await page.keyboard.press('Escape');
        await showView(page, 'cost');
        assert.equal(await page.locator('[data-cost-page]').evaluate(e => { const a=e.querySelector('[data-cost-coverage]').getBoundingClientRect(),b=e.querySelector('[data-cost-cache]').getBoundingClientRect();return b.top>=a.bottom-1?1:2; }), 1, 'cost pair responds to its own container width');
        assert((await page.locator('#cost').innerText()).includes('未计入') || (await page.locator('#cost').innerText()).includes('未定价'));
        assert.deepEqual(errors, []);
        results.push({ scale, sourceMode: !process.env.QUOTA_PACKAGED_EXE, syntheticOnly: true, identity: true, imeEventPolicy: true, nativeDialogAndNestedEscape: true, userScrollCancellation: true, preferenceFailureInjection: true, rapidOperations: true, historicalStatisticsRetained: true, fadeBoundariesContentResize: true, container800x600: true, consoleErrors: errors });
      } catch (error) {
        const page = await app.firstWindow();
        console.log('FAILURE STATE', await page.locator('[data-source-notice]').allTextContents(), await page.locator('[data-source-summary]').allTextContents());
        await page.screenshot({ path: path.join(output, 'failure-' + scale + '.png') }); throw error;
      } finally { try { await sourceFailure(app, 'normal'); } finally { await app.close(); } }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log('PASS: interaction reliability, synthetic IME, scroll interruption, source failure recovery, native-dialog focus, container layout and list edges at 100%/150%.');
  } finally { await cleanup(root); }
})().catch(error => { console.error(error); process.exitCode = 1; });
