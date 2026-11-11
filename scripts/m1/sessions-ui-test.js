'use strict';
/* global document, requestAnimationFrame */
// Session page and today card session counts in the real Electron window, on an
// isolated synthetic ledger. The clipboard is saved first and restored at the end.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { roots } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { Store } = require('../../src/m1/store');
const { settle, until, showView, keepVisible, cleanup } = require('./ui-settle');
const { pickSelect } = require('./settings-ui-helpers');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const ALPHA = 'C:\\fixtures\\work-alpha', HOSTILE = "C:\\fixtures\\it's $(calc) `x`; dir";
const CODEX_ID = '019a7c2e-0000-4000-8000-0000000000aa';
function claudeSession(file, id, timeMs, tokens) {
  const time = new Date(timeMs).toISOString(), end = new Date(timeMs + 12 * 60000).toISOString();
  write(file, jsonl([{ type: 'user', sessionId: id, cwd: ALPHA, timestamp: time, message: { role: 'user', content: 'not read' } },
    { type: 'assistant', uuid: id + '-a', sessionId: id, cwd: ALPHA, timestamp: time, message: { id: id + '-m1', model: 'claude-sonnet-4-5', usage: { input_tokens: tokens, output_tokens: 200, cache_read_input_tokens: tokens * 4, cache_creation_input_tokens: 0 } } },
    { type: 'assistant', uuid: id + '-b', sessionId: id, cwd: ALPHA, timestamp: end, message: { id: id + '-m2', model: 'claude-sonnet-4-5', usage: { input_tokens: 50, output_tokens: 40, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } }]));
}
async function ledger(root) {
  const home = path.join(root, 'home'), selected = roots(home), usage = path.join(root, 'usage');
  // Anchor "today" to midday of the current local calendar day so tests run shortly
  // after midnight never push "today" synthetic records into yesterday.
  const d = new Date(), todayNoon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).getTime();
  const now = Date.now(), recentMs = (d.getHours() >= 13) ? (now - 15 * 60000) : (todayNoon + 30 * 60000);
  // Seven Claude sessions today in one project: five show, two wait in the drawer.
  for (let i = 0; i < 7; i++) claudeSession(path.join(selected.claude[0], 'alpha', 's' + i + '.jsonl'), 'claude-alpha-' + i, todayNoon - (180 - i * 20) * 60000, 1000 * (i + 1));
  claudeSession(path.join(selected.claude[0], 'alpha', 'old.jsonl'), 'claude-alpha-old', todayNoon - 3 * 86400000, 900);
  const time = new Date(recentMs).toISOString(), usage1 = { input_tokens: 4000, output_tokens: 300, cached_input_tokens: 3000, cache_creation_input_tokens: 0, reasoning_output_tokens: 20, total_tokens: 4300 };
  write(path.join(selected.codex[0], 'c.jsonl'), jsonl([{ type: 'session_meta', payload: { id: CODEX_ID, originator: 'codex_cli_rs', cwd: HOSTILE } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } },
    { timestamp: time, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage1, last_token_usage: usage1 } } }]));
  write(path.join(selected.workbuddy[0], 'w.jsonl'), jsonl([{ id: 'w-1', sessionId: 'work-1', timestamp: todayNoon + 60 * 60000, providerData: { requestModelId: 'gpt-4.1', rawUsage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } } }]));
  const store = new Store(usage, selected);
  store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' }); store.setEnabled(false);
  return { home, usage };
}
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-sessions-')), output = process.env.SESSIONS_EVIDENCE_DIR || 'artifacts/m2-sessions/source', results = [];
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const scale of [1, 1.5]) {
      const { home, usage } = await ledger(path.join(root, 'scale-' + scale)), quota = path.join(root, 'quota-' + scale);
      const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout: 60000 });
      const clipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
      try {
        const page = await app.firstWindow(), errors = []; await keepVisible(app);
        page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        // The sessions page (and its summary card) loads the saved list once (owner 2026-10-29: the home
        // page no longer has activity lanes). Usage must reuse that list, without another full-list IPC read.
        await showView(page, 'sessions'); await until(page,()=>window.sessionsUi.loaded===true);
        const savedList = await page.evaluateHandle(()=>window.sessionsUi.list());
        await app.evaluate(({ipcMain})=>{const handler=ipcMain._invokeHandlers.get('usage:sessions');if(!handler)throw Error('SESSION_HANDLER_MISSING');globalThis.sessionsTestReads=0;ipcMain._invokeHandlers.set('usage:sessions',(...args)=>{globalThis.sessionsTestReads++;return handler(...args);});});
        await showView(page, 'usage');
        assert.equal(await app.evaluate(()=>globalThis.sessionsTestReads),0,'the usage page must not reread the full session list');
        assert.equal(await savedList.evaluate(list=>window.sessionsUi.list()===list),true,'usage reuses the loaded session list');
        await savedList.dispose();
        // Today card (React usage page, M7): per-Agent session counts and the header total.
        await until(page, () => document.querySelector('[data-usage-today-sessions]')?.textContent.includes('9'));
        assert.equal(await page.locator('[data-usage-session-agent="claude"]').filter({ hasText: '7 个会话' }).count(), 1, 'Claude Code: seven sessions today');
        assert.equal(await page.locator('[data-usage-today] [data-usage-today-tokens], [data-usage-today] [data-usage-today-cost], [data-usage-today] [data-usage-today-records], [data-usage-today] [data-usage-today-sessions]').count(), 4, 'Today totals has 4 readings');
        await page.screenshot({ path: path.join(output, 'today-card-light-' + scale + '.png') });
        // Drill-down from today card to the session view, on that Agent.
        await page.locator('[data-usage-session-agent="claude"] button').click(); await settle(page);
        await until(page, () => window.sessionsUi.loaded === true && Boolean(document.querySelector('[data-sessions-page][data-ready="true"]')));
        assert.equal(await page.locator('#sessions').getAttribute('hidden'), null, 'view switched to sessions');
        const agents = page.getByRole('radiogroup', { name: '会话 Agent 筛选', exact: true });
        assert.equal(await agents.locator('[data-agent="claude"]').getAttribute('aria-checked'), 'true', 'claude agent selected');
        await agents.locator('[data-agent="all"]').click(); await settle(page);
        const groups = async () => page.locator('[data-session-group] [data-session-project]').allTextContents();
        const group = index => page.locator('[data-session-group]').nth(index);
        const dialog = () => page.getByRole('dialog');
        const search = () => page.getByRole('textbox', { name: '搜索会话', exact: true });
        const tab = (label, name) => page.locator('[data-sessions-page]').getByRole('tablist', { name: label, exact: true }).getByRole('tab', { name, exact: true });
        assert.equal(await page.locator('[data-session-sort]').innerText(), '按最近', 'the page starts on the most recent');
        await pickSelect(page.locator('[data-sessions-page]'), page, '会话排序', '按成本'); await settle(page);
        assert.deepEqual(await groups(), ['work-alpha', "it's $(calc) `x`; dir", '未知项目'], 'projects by cost, unknown last; the old session is outside today');
        assert.match(await page.locator('[data-session-summary]').textContent(), /9 个会话 · 3 个项目/);
        assert(await page.locator('[data-session-tokens] svg').count() > 0, 'session token proportion bar rendered');
        // Folded projects keep no rows in the page; the recent Codex session sits in the second project.
        await group(1).locator('[data-fold-head] button[aria-expanded]').click(); await settle(page);
        assert(await group(1).locator('[data-session-agent] [data-status-dot]').count() > 0, 'active dot rendered for recent session');
        await group(1).locator('[data-fold-head] button[aria-expanded]').click(); await settle(page);
        assert(await page.locator('[data-session-ended]').count() + await page.locator('[data-session-name]').count() > 0, 'each row says when it moved or reads as its time');
        assert.equal(await page.locator('[data-session-id], [data-session-model], [data-session] [data-session-folder]').count(), 0, 'ID, model and folder live in the detail card');
        assert(await page.locator('[data-session-active-count]').count() > 0, 'active project badge rendered');
        // A collection refresh updates the list in place: the same elements, no replayed entrance.
        const kept = await page.evaluate(async () => {
          const rows = () => [...document.querySelectorAll('[data-session-group], [data-session]')], before = rows();
          await window.sessionsUi.reload(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const after = rows();
          return { same: before.length > 0 && before.length === after.length && before.every((el, i) => el === after[i]), replay: after.some(el => el.getAnimations().some(a => a.playState === 'running')) };
        });
        assert.deepEqual(kept, { same: true, replay: false }, 'a refresh rebuilt the session list');
        // The top project opens by default; five rows, two behind "展开其余".
        const top = group(0);
        assert.equal(await top.locator('[data-fold-head] button[aria-expanded]').getAttribute('aria-expanded'), 'true');
        assert.equal(await top.locator('[data-session]').count(), 5);
        assert.equal(await top.locator('[data-session-more] button').innerText(), '展开其余 2 个会话');
        // The fold animates its height under full motion.
        await top.locator('[data-fold-head] button[aria-expanded]').click(); await settle(page);
        const heights = await page.evaluate(async () => {
          const head = document.querySelector('[data-session-group] [data-fold-head] button[aria-expanded]'), samples = [], start = performance.now(); head.click();
          await new Promise(resolve => { const tick = () => { const body = document.querySelector('[data-session-group] [role=group]'); samples.push(body ? body.getBoundingClientRect().height : 0); if (performance.now() - start < 500) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
          return samples;
        });
        assert(heights.some(h => h > 1 && h < heights.at(-1) - 1), 'intermediate fold heights: ' + heights.slice(0, 8).join(','));
        await settle(page);
        await top.locator('[data-session-more] button').click(); await settle(page);
        assert.equal(await top.locator('[data-session]').count(), 7, 'the drawer shows the other two');
        assert.equal(await top.locator('[data-session-more] button').innerText(), '收起');
        await page.screenshot({ path: path.join(output, 'sessions-light-' + scale + '.png') });
        // Copy the hostile project's command: it comes from the main process, unchanged.
        if (await group(1).getAttribute('data-open') !== 'true') { await group(1).locator('[data-fold-head] button[aria-expanded]').click(); await settle(page); }
        await group(1).locator('[data-session] [data-session-resume] button').first().click();
        await page.waitForFunction(() => document.getElementById('toast').textContent.includes('已复制恢复命令'));
        // The toast follows the clipboard write, so the clipboard is already set here.
        assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), "Set-Location -LiteralPath 'C:\\fixtures\\it''s $(calc) `x`; dir'; codex resume " + CODEX_ID);
        const unknown = page.locator('[data-session-group][data-unknown]');
        if (await unknown.getAttribute('data-open') !== 'true') { await unknown.locator('[data-fold-head] button[aria-expanded]').click(); await settle(page); }
        assert.equal(await unknown.locator('[data-session] [data-session-resume] button:disabled').count(), 1, 'WorkBuddy cannot resume');
        // Copy project directory path from project header quick actions
        await group(0).locator('[data-session-project-copy] button').first().click();
        await page.waitForFunction(() => document.getElementById('toast').textContent.includes('已复制项目工作目录路径'));
        assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), ALPHA);
        await group(1).locator('[data-session] [data-session-detail-open] button').first().click(); await settle(page);
        await dialog().locator('[data-session-folder="inspector"] button').click();
        await page.waitForFunction(() => document.getElementById('toast').textContent.includes('工作目录在磁盘上不存在'));
        await page.keyboard.press('Escape'); await settle(page);
        // Range: all time includes the older session.
        await tab('会话时间范围', '全部').click(); await settle(page);
        assert.match(await page.locator('[data-session-summary]').textContent(), /10 个会话/);
        // Session detail: the row's detail button opens the floating card.
        assert.equal(await dialog().count(), 0, 'inspector starts closed');
        if (await group(0).getAttribute('data-open') !== 'true') { await group(0).locator('[data-fold-head] button[aria-expanded]').click(); await settle(page); }
        await group(0).locator('[data-session] [data-session-detail-open] button').first().click(); await settle(page);
        assert.equal(await dialog().count(), 1, 'inspector opened from its button');
        assert(await page.locator('[data-session-detail-stats]').isVisible(), 'stats rendered');
        assert.equal(await page.locator('[data-session-detail-parts] [data-session-part]').count(), 4, 'four usage parts');
        await page.keyboard.press('Escape'); await settle(page);
        assert.equal(await dialog().count(), 0, 'inspector closed');
        // A session without a working directory (the 未知项目 group) opens from its detail button, and
        // the cache read WorkBuddy never reported reads 未报告, not 0.
        if (await unknown.getAttribute('data-open') !== 'true') { await unknown.locator('[data-fold-head] button[aria-expanded]').click(); await settle(page); }
        await unknown.locator('[data-session] [data-session-detail-open] button').first().click(); await settle(page);
        assert.equal(await dialog().count(), 1, 'unknown-project session opens');
        assert.equal(await dialog().getByRole('heading').first().textContent(), '未知项目');
        assert.match(await page.locator('[data-session-detail-parts] [data-breakdown-row="cacheRead"]').textContent(), /缓存读取.*未报告/, 'an unreported field is unknown, not zero');
        await page.keyboard.press('Escape'); await settle(page);
        await dialog().waitFor({ state: 'detached', timeout: 3000 }); // Escape closes the inspector, once its exit has run.
        // Column alignment: the name and its last activity never overlap.
        const noOverlap = await page.evaluate(() => [...document.querySelectorAll('[data-session]')].every(row => {
          const t = row.querySelector('[data-session-time]')?.getBoundingClientRect(), m = row.querySelector('[data-session-ended]')?.getBoundingClientRect();
          return !t || !m || t.right <= m.left + 1;
        }));
        assert.equal(noOverlap, true, 'session name and last activity must not overlap');
        // Toggle all groups open and closed.
        const toggleAll = page.locator('[data-sessions-page]').getByRole('button', { name: /^全部(展开|折叠)$/ });
        if (await toggleAll.innerText() === '全部折叠') { await toggleAll.click(); await settle(page); }
        await toggleAll.click(); await settle(page);
        assert.equal(await page.locator('[data-session-group][data-open="true"]').count(), 3, 'all 3 groups expanded');
        await toggleAll.click(); await settle(page);
        assert.equal(await page.locator('[data-session-group][data-open="true"]').count(), 0, 'all groups collapsed');
        // Sort by tokens, then search.
        await pickSelect(page.locator('[data-sessions-page]'), page, '会话排序', '按 Token'); await settle(page);
        assert.deepEqual(await groups(), ['work-alpha', "it's $(calc) `x`; dir", '未知项目']);
        await pickSelect(page.locator('[data-sessions-page]'), page, '会话排序', '按成本'); await settle(page);
        await search().fill('gpt-4.1'); await settle(page);
        assert.deepEqual(await groups(), ["it's $(calc) `x`; dir", '未知项目']);
        const clear = page.locator('[data-sessions-page]').getByRole('button', { name: '清空搜索', exact: true });
        assert.equal(await clear.isVisible(), true, 'clear button visible when query present');
        await clear.click(); await settle(page);
        assert.equal(await search().inputValue(), '');
        assert.equal(await clear.count(), 0, 'clear button absent when query empty');
        await search().fill('gpt-4.1'); await settle(page);
        await search().press('Escape'); await settle(page);
        assert.equal(await search().inputValue(), '');
        await search().fill('不存在的项目'); await settle(page);
        assert.match(await page.locator('[data-session-groups]').textContent(), /没有匹配/);
        await page.getByRole('button', { name: '清空搜索条件', exact: true }).click(); await settle(page);
        assert.equal(await search().inputValue(), '');
        await agents.locator('[data-agent="codex"]').click(); await settle(page);
        assert.deepEqual(await groups(), ["it's $(calc) `x`; dir"]);
        // A row opens its conversation and the list returns with focus on that row; the summary card is one step aside.
        await agents.locator('[data-agent="claude"]').click(); await settle(page);
        if (await group(0).getAttribute('data-open') !== 'true') { await group(0).locator('[data-fold-head] button[aria-expanded]').click(); await settle(page); }
        const row = group(0).locator('[data-session]').first(), rowKey = await row.getAttribute('data-session');
        await row.locator('[data-fold-cell="tokens"]').click(); await page.locator('[data-reader-page]').waitFor();
        assert.equal(await dialog().count(), 0, 'a row reads rather than opening the card');
        await page.locator('[data-reader-back] button').click(); await page.locator('[data-sessions-page]').waitFor(); await settle(page);
        assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-session]')?.getAttribute('data-session')), rowKey, 'focus returns to the row');
        // One search box: conversation text is scanned only when the person asks, and leaving returns to the list.
        await agents.locator('[data-agent="all"]').click(); await settle(page);
        await search().fill('gpt-4.1'); await settle(page);
        await tab('搜索范围', '对话内容').click(); await page.locator('[data-content-search]').waitFor();
        const contentField = page.getByRole('textbox', { name: '搜索对话内容', exact: true });
        await contentField.fill('另一个短语'); await settle(page);
        assert.match(await page.locator('[data-content-search-status]').textContent(), /gpt-4\.1/, 'typing alone does not start another scan');
        await contentField.press('Enter'); await until(page, () => /另一个短语/.test(document.querySelector('[data-content-search-status]')?.textContent ?? ''));
        await page.getByRole('button', { name: '返回会话列表', exact: true }).click(); await settle(page);
        assert.equal(await search().inputValue(), '', 'leaving the results clears the box');
        assert.equal(await page.locator('[data-content-search]').count(), 0);
        // Reduced motion: the fold opens at its full height at once (a cross-fade, no growth).
        await agents.locator('[data-agent="all"]').click(); await page.emulateMedia({ reducedMotion: 'reduce' }); await settle(page);
        if (await group(1).getAttribute('data-open') === 'true') { await group(1).locator('[data-fold-head] button[aria-expanded]').click(); await settle(page); }
        await group(1).locator('[data-fold-head] button[aria-expanded]').click();
        const instant = await page.evaluate(async () => { await new Promise(requestAnimationFrame); const body = document.querySelectorAll('[data-session-group]')[1].querySelector('[role=group]'); return { height: body.getBoundingClientRect().height, full: body.scrollHeight }; });
        assert(Math.abs(instant.height - instant.full) < 1, 'reduced motion: no fold growth ' + JSON.stringify(instant));
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.locator('#theme').click(); await settle(page); await page.screenshot({ path: path.join(output, 'sessions-dark-' + scale + '.png') });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow');
        assert.deepEqual(errors, []);
        results.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), todayCounts: true, groupsByProject: true, drawerAnimated: true, copiedLiteralCommand: true, unknownNotResumable: true, rangeAndSearch: true, reducedMotionInstant: true });
      } finally { await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboard).catch(() => {}); await app.close(); }
    }
  } finally { await cleanup(root); }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  console.log('PASS: session page groups, drawer motion, literal resume command, range/search and today counts at 100%/150%.');
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
