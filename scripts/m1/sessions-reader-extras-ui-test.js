'use strict';
/* global document, requestAnimationFrame */
// Native reader IPC on disposable records. Only outbound desktop actions are replaced.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { seed, hashes, COMMON, TEXT_TAIL, OUTPUT_TAIL, LONG_OUTPUT, CHANGE_PATH, CHANGE_TAIL } = require('../../tests/m1/sessions-reader-fixture');
const { showView, settle, until, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const READERS = ['codex', 'claude', 'opencode', 'mimo', 'gemini', 'deepseek', 'antigravity'];
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-reader-ui-'));
  const output = path.resolve(process.env.READER_EVIDENCE_DIR || 'artifacts/handoff-20261102/reader-extras'); fs.mkdirSync(output, { recursive: true });
  const reports = [];
  try {
    for (const scale of [1, 1.5]) {
      const data = await seed(path.join(root, String(scale))), exported = path.join(root, 'export-' + scale + '.md');
      const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', data.usage, '--quota-data-dir', path.join(root, 'quota-' + scale), '--m1-fixture-root', data.home, '--force-device-scale-factor=' + scale], timeout: 60000 });
      let page; const errors = [];
      try {
        page = await app.firstWindow(); await keepVisible(app); await isolatePointer(app);
        page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await app.evaluate(({ clipboard, dialog, shell }, file) => {
          globalThis.readerFixture = { copies: [], links: [], saves: [], exportResults: [], canceled: false, paginate: false, searchOffsets: [], partFields: [] };
          clipboard.writeText = text => { globalThis.readerFixture.copies.push(text); };
          clipboard.readText = () => globalThis.readerFixture.copies.at(-1) ?? ''; // The outbound desktop double must also support write confirmation.
          dialog.showSaveDialog = async (_window, options) => { globalThis.readerFixture.saves.push(options); return globalThis.readerFixture.canceled ? { canceled: true } : { canceled: false, filePath: file }; };
          shell.openExternal = async url => { globalThis.readerFixture.links.push(url); };
        }, exported);
        await showView(page, 'sessions');
        await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click();
        await until(page, () => window.sessionsHost.get().list?.sessions.length === 7 && !window.sessionsHost.get().loading);
        const sessions = await page.evaluate(() => window.sessionsHost.get().list.sessions);
        assert.deepEqual(sessions.map(row => row.agent).sort(), READERS.toSorted());
        const ordered = sessions.toSorted((a, b) => String(b.end).localeCompare(String(a.end))).map(row => row.key);
        await app.evaluate(({ ipcMain }, orderedKeys) => {
          const handlers = ipcMain._invokeHandlers, search = handlers.get('usage:searchTranscripts'), part = handlers.get('usage:transcriptPart'), save = handlers.get('usage:transcriptExport');
          handlers.set('usage:transcriptExport', async (...args) => { const result = await save(...args); globalThis.readerFixture.exportResults.push(result); return result; });
          handlers.set('usage:transcriptPart', async (...args) => {
            globalThis.readerFixture.partFields.push(args[2]?.field); const result = await part(...args);
            if (globalThis.readerFixture.holdField === args[2]?.field) {
              globalThis.readerFixture.holdField = null;
              await new Promise(resolve => { globalThis.readerFixture.releasePart = resolve; });
            }
            return result;
          });
          // Deterministic UI pagination fixture: still call the real reader/search
          // on every offset, then expose one actual matching session per reply.
          // This exercises continuation, not the backend's wall-clock deadline.
          handlers.set('usage:searchTranscripts', async (...args) => {
            const result = await search(...args); if (!globalThis.readerFixture.paginate) return result;
            const offset = args[1].offset || 0, searched = Math.min(offset + 1, result.total);
            globalThis.readerFixture.searchOffsets.push(offset);
            return { ...result, results: result.results.filter(row => row.key === orderedKeys[offset]), searched, next: searched < result.total ? searched : null };
          });
        }, ordered);
        const waitMain = async predicate => {
          const deadline = Date.now() + 30000;
          while (!(await app.evaluate(predicate))) { if (Date.now() > deadline) throw Error('MAIN_ACTION_TIMEOUT'); await page.waitForTimeout(50); }
        };
        const reader = () => page.locator('[data-reader-page]');
        const theme = scale === 1 ? 'light' : 'dark';
        await page.evaluate(value => window.settingsHost.theme.set(value), theme); await settle(page);
        const open = async agent => {
          await page.getByRole('radiogroup', { name: '会话 Agent 筛选', exact: true }).locator('[data-agent="all"]').click(); await settle(page);
          const expand = page.getByRole('button', { name: '全部展开', exact: true }); if (await expand.count()) { await expand.click(); await settle(page); }
          const row = page.locator('[data-session="' + sessions.find(item => item.agent === agent).key + '"]');
          await row.locator('[data-fold-cell="tokens"]').click(); await page.locator('[data-reader-page]').waitFor(); await settle(page);
          await page.getByRole('button', { name: '查找', exact: true }).click();
        };
        const close = async () => { await page.getByRole('button', { name: '返回会话列表', exact: true }).click(); await until(page, () => window.sessionsHost.get().reading === null); await reader().waitFor({ state: 'detached' }); };
        for (const agent of READERS) {
          await open(agent);
          assert(await page.locator('[data-reader-turn]').count() > 0, agent + ' renders real parsed conversation');
          const processToggle = page.locator('[data-reader-turn]').first().locator('[data-reader-process]').getByRole('button', { name: /^执行过程/ });
          if (await processToggle.count() && await processToggle.getAttribute('aria-expanded') === 'false') { await processToggle.click(); await settle(page); }
          assert.match(await page.locator('[data-reader]').innerText(), new RegExp(agent === 'codex' ? '问题 01' : agent.toUpperCase() + '_READER_REPLY'));
          if (['opencode', 'mimo', 'gemini', 'deepseek', 'antigravity'].includes(agent)) {
            await reader().getByRole('textbox', { name: '在对话中查找', exact: true }).fill(CHANGE_TAIL);
            await page.locator('[data-reader-hits]').filter({ hasText: '1 / 1' }).waitFor();
            await reader().getByRole('button', { name: '下一处', exact: true }).click();
            await page.locator('[data-tool-change] [data-diff] [data-find-current]').filter({ hasText: CHANGE_TAIL }).waitFor();
            assert.match(await page.locator('[data-tool-change]').first().textContent(), /NOV2_CHANGED_LINE/);
            assert.match(await page.locator('[data-reader-usage]').first().textContent(), /120/, agent + ' own reported turn tokens');
            const sideToggle = page.getByRole('button', { name: '这次会话', exact: true }); if (await sideToggle.count()) await sideToggle.click();
            await page.locator('[data-reader-side-tabs]').getByRole('tab', { name: /^文件/ }).click();
            const files = page.locator('[data-reader-side-list="files"]'); await files.waitFor(); assert((await files.textContent()).includes('fixture-edit.js'));
            await files.locator('[data-outline-item]').first().click(); await page.locator('[data-reader-file]').waitFor();
            assert.match(await page.locator('[data-reader-file]').textContent(), /fixture-edit.js/);
            await page.getByRole('button', { name: '显示全部', exact: true }).click();
            if (agent === 'antigravity') { await page.locator('[data-reader-side-tabs]').getByRole('tab', { name: /^失败/ }).click(); await page.locator('[data-reader-side-list="failures"]').waitFor(); assert.equal(await page.locator('[data-reader-side-list="failures"] [data-outline-item]').count(), 1); }
            assert(CHANGE_PATH.endsWith('fixture-edit.js'));
          }
          console.log('PASS native reader flow ' + agent + ' scale=' + scale);
          await close();
        }
        await open('codex');
        const first = page.locator('[data-reader-turn="0"]');
        const image = first.getByRole('img', { name: '会话里的图片', exact: true }); await image.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => { const img = document.querySelector('[data-reader] img[alt="会话里的图片"]'); return img?.complete && img.naturalWidth > 0; });
        assert.match(await image.getAttribute('src'), /^data:image\/png;base64,/);
        const second = page.locator('[data-reader-turn="1"]'); await second.getByRole('button', { name: /shell/ }).first().click();
        await second.getByRole('button', { name: /^显示全部输出/ }).click();
        await second.getByRole('button', { name: /^继续显示/ }).waitFor();
        assert((await second.locator('pre').innerText()).length >= 512 * 1024);
        await second.getByRole('button', { name: /^继续显示/ }).click();
        await page.waitForFunction(needle => document.querySelector('[data-reader-turn="1"] pre')?.textContent.endsWith(needle), OUTPUT_TAIL);
        assert.equal(await second.locator('pre').innerText(), LONG_OUTPUT);
        const find = () => reader().getByRole('textbox', { name: '在对话中查找', exact: true });
        const visibleHit = needle => page.waitForFunction(value => [...document.querySelectorAll('[data-find-current]')].some(element => {
          if (element.textContent !== value) return false;
          const box = element.getBoundingClientRect(), pane = element.closest('[data-reader-scroll]')?.getBoundingClientRect(), pre = element.closest('pre')?.getBoundingClientRect();
          return pane && box.top >= pane.top && box.bottom <= pane.bottom && (!pre || box.top >= pre.top && box.bottom <= pre.bottom);
        }), needle);
        await find().fill(TEXT_TAIL); await page.locator('[data-reader-hits]').filter({ hasText: '1 / 1' }).waitFor();
        await reader().getByRole('button', { name: '下一处', exact: true }).click();
        await visibleHit(TEXT_TAIL);
        await close(); await open('codex');
        // Fresh state: this match is past both the preview and the first 512KiB
        // full-output page. Finding it must load through to the visible match.
        await find().fill(OUTPUT_TAIL); await page.locator('[data-reader-hits]').filter({ hasText: '1 / 1' }).waitFor();
        await reader().getByRole('button', { name: '下一处', exact: true }).click();
        await visibleHit(OUTPUT_TAIL);
        await find().fill('');
        await page.locator('[data-reader-turn="1"]').getByRole('button', { name: '复制这一轮', exact: true }).click();
        await waitMain(() => globalThis.readerFixture.copies.length === 1);
        const copied = await app.evaluate(() => globalThis.readerFixture.copies.at(-1));
        assert(copied.includes(OUTPUT_TAIL) && copied.length > 512 * 1024); assert(!copied.includes('M13_CONTEXT_NOT_FOR_EXPORT'));
        await reader().getByRole('button', { name: '导出 Markdown', exact: true }).click();
        await settle(page);
        await page.getByRole('menuitem', { name: '导出全部', exact: true }).click();
        await page.locator('[role=menu]').waitFor({ state: 'detached' }); await settle(page);
        await page.waitForFunction(() => document.getElementById('toast').textContent.includes('已导出对话'));
        const markdown = fs.readFileSync(exported, 'utf8'); assert(markdown.includes(OUTPUT_TAIL) && markdown.includes(TEXT_TAIL)); assert(!markdown.includes('M13_CONTEXT_NOT_FOR_EXPORT')); assert(markdown.includes('[图片]'));
        await app.evaluate(() => { globalThis.readerFixture.canceled = true; });
        await reader().getByRole('button', { name: '导出 Markdown', exact: true }).click();
        await settle(page);
        await page.getByRole('menuitem', { name: '导出全部', exact: true }).click();
        await page.locator('[role=menu]').waitFor({ state: 'detached' }); await settle(page);
        await waitMain(() => globalThis.readerFixture.exportResults.length === 2);
        assert.equal(await app.evaluate(() => globalThis.readerFixture.exportResults[1].canceled), true);
        assert.equal(fs.readFileSync(exported, 'utf8'), markdown, 'canceling does not rewrite the exported file');
        await page.locator('[data-reader-turn="0"] [data-md-link]').first().click();
        await waitMain(() => globalThis.readerFixture.links.length === 1);
        const links = await app.evaluate(() => globalThis.readerFixture.links); assert(links.includes('https://example.invalid/m13-reader'));
        const rejected = await page.evaluate(async () => { const results = []; for (const url of ['file:///C:/synthetic/a', 'javascript:alert(1)', 'https://user:password@example.invalid']) { try { await window.usageBridge.openLink(url); results.push(false); } catch { results.push(true); } } return results; }); assert(rejected.every(Boolean));
        assert.deepEqual(hashes(data.home), data.sourceHashes); assert.deepEqual(fs.readFileSync(path.join(data.usage, 'statistics.json')), data.ledgerBytes);
        // Deliberate fixture-only append, then the real changed-record/reload UI.
        fs.appendFileSync(data.codexFile, JSON.stringify({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'M13_CHANGED_RECORD' }] } }) + '\n');
        await find().fill('M13_CHANGED_RECORD'); await page.locator('[data-reader-changed]').waitFor();
        await reader().getByRole('button', { name: '重新读取', exact: true }).click();
        await page.locator('[data-reader-changed]').waitFor({ state: 'detached' });
        await page.locator('[data-reader-hits]').filter({ hasText: '1 / 1' }).waitFor();
        await reader().getByRole('button', { name: '下一处', exact: true }).click();
        await page.locator('[data-find-current]').filter({ hasText: 'M13_CHANGED_RECORD' }).waitFor();
        await page.screenshot({ path: path.join(output, 'reader-reloaded-' + scale + '.png') }); await close();
        await page.getByRole('radiogroup', { name: '会话 Agent 筛选', exact: true }).locator('[data-agent="all"]').click(); await settle(page);
        const baseline = await page.evaluate(query => window.usageBridge.searchTranscripts({ query, range: 'all', agent: 'all', offset: 0 }), COMMON);
        assert.equal(baseline.results.length, 7); assert.equal(baseline.next, null);
        assert(!JSON.stringify(baseline).includes(data.home));
        await app.evaluate(() => { globalThis.readerFixture.paginate = true; });
        const search = page.getByRole('textbox', { name: '搜索会话', exact: true }); await search.fill(COMMON);
        await page.getByRole('tablist', { name: '搜索范围', exact: true }).getByRole('tab', { name: '对话内容', exact: true }).click();
        for (let count = 1; count <= 7; count++) {
          await page.waitForFunction(n => document.querySelectorAll('[data-content-result]').length === n, count);
          if (count < 7) await page.getByRole('button', { name: '继续搜索更早的会话', exact: true }).click();
        }
        assert.equal(await page.getByRole('button', { name: '继续搜索更早的会话', exact: true }).count(), 0);
        assert.deepEqual(await app.evaluate(() => globalThis.readerFixture.searchOffsets), [0, 1, 2, 3, 4, 5, 6]);
        await page.screenshot({ path: path.join(output, 'search-results-' + scale + '.png') });
        await page.locator('[data-content-result] button').first().click(); await page.locator('[data-reader]').waitFor();
        assert.equal(await find().inputValue(), COMMON); await page.locator('[data-find-current]').first().waitFor(); await close();
        await page.getByRole('button', { name: '返回会话列表', exact: true }).click(); await search.fill('');
        await open('codex'); assert.equal(await find().inputValue(), '', 'closing discards the prior search state');
        await page.screenshot({ path: path.join(output, 'reader-initial-' + scale + '.png') }); await close();
        // Deliver an actual old text response after another session has opened.
        // Both assistants use item index 1, so a stale write would visibly replace
        // the OpenCode reply with the previous Claude conversation's full text.
        await open('claude'); await app.evaluate(() => { globalThis.readerFixture.holdField = 'text'; });
        await reader().getByRole('button', { name: /^显示全部（/ }).click();
        await waitMain(() => typeof globalThis.readerFixture.releasePart === 'function');
        await reader().getByRole('button', { name: '上一个会话', exact: true }).click();
        await until(page, () => window.sessionsHost.get().reading?.agent !== 'claude');
        const nextAgent = await page.evaluate(() => window.sessionsHost.get().reading.agent); assert.notEqual(nextAgent, 'codex', 'the neighbor has a text reply at item1');
        await reader().locator('[data-reader-turn]').first().waitFor(); // The request-local parser is asynchronous; the new record must be mounted before opening its process.
        const nextProcess = reader().locator('[data-reader-process]').getByRole('button', { name: /^执行过程/ });
        if (await nextProcess.count() && await nextProcess.getAttribute('aria-expanded') === 'false') { await nextProcess.click(); await settle(page); }
        await app.evaluate(() => { globalThis.readerFixture.releasePart(); globalThis.readerFixture.releasePart = null; });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await settle(page);
        assert.match(await page.locator('[data-reader]').innerText(), new RegExp(nextAgent.toUpperCase() + '_READER_REPLY'));
        assert(!(await page.locator('[data-reader]').innerText()).includes('CLAUDE_READER_REPLY'), 'a late part cannot cross conversation ownership');
        await close();
        assert.deepEqual(fs.readFileSync(path.join(data.usage, 'statistics.json')), data.ledgerBytes, 'reader/search never persist conversation content or change usage');
        const audit = await page.evaluate(() => window.usageBridge.get().then(value => value.audit));
        assert.equal(audit, null, 'a reader-only run does not perform a collection or invent a collection audit');
        assert.deepEqual(errors, []); assert.match(await page.title(), /Agent Usage/); assert.match(page.url(), /desktop-reference.*index\.html/);
        const fields = await app.evaluate(() => globalThis.readerFixture.partFields); assert(fields.includes('image') && fields.includes('output') && fields.includes('text'));
        reports.push({ scale, theme, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), readers: READERS, secondGroupReaders: ['opencode', 'mimo', 'gemini', 'deepseek', 'antigravity'], changesAndOwnTurnTokens: true, images: true, fullPages: true, findPastPreviewAndPage: true, changedReload: true, fullCopyAndExport: true, canceledExport: true, guardedLinks: true, latePartOwnership: true, realSearchResults: 7, continuationOffsets: [0, 1, 2, 3, 4, 5, 6], continuationFixture: 'one actual result per real search reply; not a deadline benchmark', sourceHashesUnchangedBeforeIntentionalAppend: true, ledgerUnchanged: true, collectorRun: false, errors });
        fs.writeFileSync(path.join(output, 'results.partial.json'), JSON.stringify(reports, null, 2));
      } catch (error) {
        if (page) { await page.screenshot({ path: path.join(output, 'failure-' + scale + '.png') }).catch(() => {}); fs.writeFileSync(path.join(output, 'failure-' + scale + '.json'), JSON.stringify({ error: error.message, errors }, null, 2)); }
        throw error;
      } finally { await app.close(); }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(reports, null, 2)); console.log(JSON.stringify(reports));
  } finally { await cleanup(root); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
