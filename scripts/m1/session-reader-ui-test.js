'use strict';
/* global document, getComputedStyle */
// The reading page (UI-READER-DOCUMENT-20261102.md) on a synthetic Codex session and fixture home only:
// document layout with question bubbles, the outer menu folding while reading, times and pauses, the three views,
// the kept question, the rail, sessions next to each other, the right column, copying, export by range, keys; and
// the second group: the change view, one file's turns, tokens per turn, code colours, following and sub-agents.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { roots } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { Store } = require('../../src/m1/store');
const { settle, until, showView, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const output = path.resolve(process.env.SESSION_READER_EVIDENCE_DIR || path.join('artifacts', 'session-reader')); fs.mkdirSync(output, { recursive: true });
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const usage = { input_tokens: 4000, output_tokens: 800, cached_input_tokens: 2000, total_tokens: 4800 };
const FILLER = '这是一段用来占满阅读页面的说明文字，内容是合成的，只为了让回复足够长。'.repeat(14);
const CODE = 'const answer = 42;\nconsole.log(answer);';
function codexSession(selected, id, name, cwd, turns, startMinutes) {
  const rows = [{ timestamp: ago(startMinutes), type: 'session_meta', payload: { id, cwd, originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol', cwd } }];
  turns.forEach((turn, index) => {
    const at = turn.at, call = 'c' + index;
    rows.push({ timestamp: ago(at), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.ask }] } });
    rows.push({ timestamp: ago(at - .1), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: call, arguments: JSON.stringify({ command: ['npm', 'run', 'step-' + index] }) } });
    rows.push({ timestamp: ago(at - .2), type: 'response_item', payload: { type: 'function_call_output', call_id: call, output: JSON.stringify({ output: 'done', metadata: { exit_code: turn.fail ? 1 : 0 } }) } });
    rows.push({ timestamp: ago(at - .3), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: call + 'b', arguments: JSON.stringify({ command: ['npm', 'run', 'check-' + index] }) } });
    rows.push({ timestamp: ago(at - .4), type: 'response_item', payload: { type: 'function_call_output', call_id: call + 'b', output: JSON.stringify({ output: 'ok', metadata: { exit_code: 0 } }) } });
    rows.push({ timestamp: ago(at - .5), type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: turn.reply }] } });
    rows.push({ timestamp: ago(at - .5), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage, last_token_usage: usage } } });
  });
  write(path.join(selected.codex[0], '2026', '11', '02', 'rollout-2026-11-02T09-00-00-' + id + '.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return JSON.stringify({ id, thread_name: name, updated_at: ago(1) });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-ui-')), home = path.join(root, 'home'), usageDir = path.join(root, 'usage'), quotaDir = path.join(root, 'quota'), saved = path.join(root, 'picked.md');
  try {
    const selected = roots(home); for (const dir of Object.values(selected).flat()) fs.mkdirSync(dir, { recursive: true });
    const index = [
      codexSession(selected, '019a7c2e-0000-4000-8000-0000000000a1', '第一个会话', 'C:/fixtures/work', [
        { at: 300, ask: '第一个问题', reply: '## 结论\n\n第一轮回复。\n\n```js\n' + CODE + '\n```\n\n' + FILLER },
        { at: 295, ask: '第二个问题', reply: '第二轮回复。\n\n' + FILLER, fail: true },
        { at: 120, ask: '隔了很久的问题', reply: '第三轮回复。' },
        { at: 119, ask: '第四个问题', reply: '第四轮回复。\n\n' + FILLER + FILLER + FILLER },
        { at: 118, ask: '第五个问题', reply: '第五轮回复。\n\n' + FILLER + FILLER + FILLER },
      ], 310),
      codexSession(selected, '019a7c2e-0000-4000-8000-0000000000a2', '第二个会话', 'C:/fixtures/work', [{ at: 90, ask: '另一个会话的问题', reply: '另一个会话的回复。' }], 95),
    ];
    // A session with a patch and a failed edit, still moving: the second group's parts on one record.
    const PATCH = ['*** Begin Patch', '*** Update File: src/chart.js', '@@ function draw()', ' keep', '-const old = 1;', '+const fresh = 2;', '+draw(fresh);', '*** Add File: src/new.js', '+export const made = true;', '*** End Patch'].join('\n');
    const changesId = '019a7c2e-0000-4000-8000-0000000000a3', changesFile = path.join(selected.codex[0], '2026', '11', '02', 'rollout-2026-11-02T10-00-00-' + changesId + '.jsonl');
    const rowsOf = (...rows) => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
    const say = (role, text, at) => ({ timestamp: ago(at), type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
    const tokens = (cumulative, last, at) => ({ timestamp: ago(at), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: cumulative }, last_token_usage: { input_tokens: last, output_tokens: 0, total_tokens: last } } } });
    write(changesFile, rowsOf(
      { timestamp: ago(20), type: 'session_meta', payload: { id: changesId, cwd: 'C:/fixtures/changes', originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol', cwd: 'C:/fixtures/changes' } },
      say('user', '改一下图表', 20),
      { timestamp: ago(19.9), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'p1', input: PATCH } },
      { timestamp: ago(19.8), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'p1', output: 'done' } },
      say('assistant', '改好了。\n\n```js\nconst value = 1; // note\n```', 19.7), tokens(1500, 1500, 19.6),
      say('user', '只是问一下', 15), say('assistant', '好的', 14.9)));
    index.push(JSON.stringify({ id: changesId, thread_name: '改动会话', updated_at: ago(1) }));
    // Another session changed the same file, in the same directory; a third has a file of that name elsewhere.
    const sameId = '019a7c2e-0000-4000-8000-0000000000a6', otherId = '019a7c2e-0000-4000-8000-0000000000a7', editedBy = (id, cwd, at) => rowsOf(
      { timestamp: ago(at), type: 'session_meta', payload: { id, cwd, originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
      say('user', '再改一下', at), { timestamp: ago(at - .1), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'p1', input: PATCH } },
      { timestamp: ago(at - .2), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'p1', output: 'done' } }, say('assistant', '好了', at - .3), tokens(700, 700, at - .4));
    write(path.join(selected.codex[0], '2026', '11', '01', 'rollout-2026-11-01T10-00-00-' + sameId + '.jsonl'), editedBy(sameId, 'C:/fixtures/changes', 2000));
    write(path.join(selected.codex[0], '2026', '11', '01', 'rollout-2026-11-01T11-00-00-' + otherId + '.jsonl'), editedBy(otherId, 'C:/fixtures/changes-worktree', 1900));
    index.push(JSON.stringify({ id: sameId, thread_name: '昨天改过图表', updated_at: ago(2000) }), JSON.stringify({ id: otherId, thread_name: '工作树里改过图表', updated_at: ago(1900) }));
    // Claude Code: a sub-agent in its own file between the question and the answer.
    const claudeId = '019a7c2e-0000-4000-8000-0000000000a4', claudeDir = path.join(selected.claude[0], 'C--fixtures-helper');
    const claudeRow = (type, content, at, extra = {}) => ({ type, timestamp: ago(at), sessionId: claudeId, cwd: 'C:/fixtures/helper', message: { role: type, content, ...(type === 'assistant' ? { id: 'm' + at, model: 'claude-opus-5-5', usage: { input_tokens: 10, output_tokens: 5 } } : {}) }, ...extra });
    write(path.join(claudeDir, claudeId + '.jsonl'), rowsOf(claudeRow('user', '找一下原因', 12), claudeRow('assistant', [{ type: 'text', text: '找到了' }], 10)));
    write(path.join(claudeDir, claudeId, 'subagents', 'agent-h1.jsonl'), rowsOf(claudeRow('user', '子任务提示', 11.5, { isSidechain: true }), claudeRow('assistant', [{ type: 'text', text: '子任务结果' }], 11, { isSidechain: true })));
    // Codex's own wrappers (UI-READER-RECOGNITION-20261102.md): what its app hides must not read as the person's words.
    const marksId = '019a7c2e-0000-4000-8000-0000000000a5', codeCall = (id, input, at) => ({ timestamp: ago(at), type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: id, input } });
    write(path.join(selected.codex[0], '2026', '11', '02', 'rollout-2026-11-02T11-00-00-' + marksId + '.jsonl'), rowsOf(
      { timestamp: ago(40), type: 'session_meta', payload: { id: marksId, cwd: 'C:/fixtures/marks', originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol' } },
      say('user', '# Files mentioned by the user:\n\n## a.png: C:\\pics\\a.png\n\n## My request for Codex:\n看一下这个图', 40),
      say('assistant', '看完了。\n\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:462-466|note=[earlier acceptance]\n</citation_entries>\n<rollout_ids>\n01a\n</rollout_ids>\n</oai-mem-citation>', 39.9),
      say('user', '<external_codex_apps_open_page>{"page_id":null}\n</external_codex_apps_open_page>', 39),
      say('user', '<send_user_message_question_reply>\n' + JSON.stringify([{ questionItemId: '["request_user_input_async","c",0]', question: '先做哪个？', answer: '先做 A' }]) + '\n</send_user_message_question_reply>', 38),
      codeCall('x1', '// @exec: {"yield_time_ms": 10000}\nconst r = await Promise.allSettled([tools.exec_command({cmd:"npm run verify"}), tools.exec_command({cmd:"git status"})]);\ntext(r);', 37.9),
      { timestamp: ago(37.8), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'x1', output: 'ok' } },
      say('assistant', '做好了。', 37.7),
      ...Array.from({ length: 7 }, (_, at) => ({ timestamp: ago(30), type: 'compacted', payload: { message: '压缩后的摘要 ' + at, replacement_history: [] } })),
      say('user', '继续', 29), say('assistant', '好的。', 28.9), tokens(900, 900, 28.8)));
    index.push(JSON.stringify({ id: marksId, thread_name: '识别会话', updated_at: ago(1) }));
    write(path.join(path.dirname(selected.codex[0]), 'session_index.jsonl'), index.join('\n') + '\n');
    const store = new Store(usageDir, selected); store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' }); store.setEnabled(false);

    const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usageDir, '--quota-data-dir', quotaDir, '--m1-fixture-root', home], timeout: 60000 });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    // The window opens at the size the page is laid out for, inside the screen.
    await page.waitForURL(/^file:/, { timeout: 30000 });
    await app.evaluate(({ipcMain})=>{
      const channel='usage:copyText',original=ipcMain._invokeHandlers.get(channel);
      globalThis.readerCopyDiagnostics=[];
      ipcMain._invokeHandlers.set(channel,async(event,text)=>{
        const record={at:Date.now(),type:typeof text,length:typeof text==='string'?text.length:null};
        try{const result=await original(event,text);record.ok=true;return result;}
        catch(error){record.error=/^[A-Z_]+$/.test(error.message)?error.message:'COPY_FAILED';throw error;}
        finally{globalThis.readerCopyDiagnostics.push(record);}
      });
    });
    const opened = await app.evaluate(({ BrowserWindow, screen }) => ({ size: BrowserWindow.getAllWindows()[0].getBounds(), area: screen.getPrimaryDisplay().workAreaSize }));
    assert(Math.abs(opened.size.width - Math.min(1480, opened.area.width)) <= 4, 'default width ' + opened.size.width); assert(Math.abs(opened.size.height - Math.min(960, opened.area.height)) <= 4, 'default height ' + opened.size.height);
    await keepVisible(app); await isolatePointer(app);
    const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
    const copied = async expected => { const deadline = Date.now() + 5000; let text = ''; while (Date.now() < deadline) { text = await clipboard(); if (expected(text)) return text; await page.waitForTimeout(50); } throw Error('CLIPBOARD: ' + text.slice(0, 80)); };
    try {
      await page.waitForFunction(() => document.readyState === 'complete' && Boolean(window.agentUi), null, { timeout: 30000 });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 960));
      await page.waitForTimeout(3000);
      await showView(page, 'sessions'); await until(page, () => window.sessionsUi?.loaded === true); await settle(page);
      await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click(); await settle(page);
      await page.locator('[data-sessions-page]').getByRole('button', { name: '全部展开', exact: true }).click(); await settle(page);

      // Opening folds the outer menu to its rail; leaving brings the person's choice back, unsaved.
      const collapsed = () => page.evaluate(() => document.body.classList.contains('sidebar-collapsed'));
      assert.equal(await collapsed(), false, 'menu open on the list');
      // The menu's width is the person's, between two limits.
      const menu = () => page.locator('.topbar').evaluate(e => Math.round(e.getBoundingClientRect().width));
      assert.equal(await menu(), 176, 'the default'); const grip = page.locator('.sidebar-resizer'), gripBox = await grip.boundingBox();
      await page.mouse.move(gripBox.x + 5, gripBox.y + 300); await page.mouse.down(); await page.mouse.move(gripBox.x + 45, gripBox.y + 300, { steps: 4 }); assert.equal(await menu(), 216, 'follows the pointer while dragging, with no lag'); await page.mouse.up();
      const gripWide = await grip.boundingBox(); await page.mouse.move(gripWide.x + 5, gripWide.y + 300); await page.mouse.down(); await page.mouse.move(gripWide.x + 500, gripWide.y + 300, { steps: 4 }); assert.equal(await menu(), 280, 'stops at its widest'); await page.mouse.up();
      await grip.focus(); await page.keyboard.press('Home'); await page.waitForTimeout(500); assert.equal(await menu(), 148, 'stops at its narrowest');
      assert.equal(await page.evaluate(() => localStorage.getItem('agentusage.sidebar.width.v1')), '148', 'remembered');
      await grip.dblclick(); await page.waitForTimeout(500); assert.equal(await menu(), 176, 'a double click returns to the default');
      // The summary card never goes back to reading when new data arrives.
      await until(page, () => { const text = document.querySelector('#summaryPanel')?.textContent ?? ''; return text.includes('会话') && !text.includes('正在读取会话'); });
      await page.evaluate(() => window.dispatchEvent(new Event('usage-data-change')));
      assert.equal((await page.locator('#summaryPanel').textContent()).includes('正在读取会话'), false, 'what is on screen stays while newer data is read');
      await page.getByRole('button', { name: /^第一个会话，/ }).click(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      assert.equal(await collapsed(), true, 'menu folds while reading');
      const avatar = await page.locator('#profileAvatar').boundingBox(), railWidth = (await page.locator('.topbar').boundingBox()).width;
      assert(avatar.x >= 0 && avatar.x + avatar.width <= railWidth, 'the avatar stays inside the rail ' + JSON.stringify(avatar));
      // A count on the rail is a small dot in the corner, never over the icon.
      const covers = await page.evaluate(() => [...document.querySelectorAll('.topbar nav button')].flatMap(button => {
        const badge = button.querySelector('.nav-badge:not([hidden])'), icon = button.querySelector('img'); if (!badge || !icon) return [];
        const a = badge.getBoundingClientRect(), b = icon.getBoundingClientRect();
        return [{ width: a.width, height: a.height, overlap: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) }];
      }));
      for (const badge of covers) { assert(badge.width <= 8 && badge.height <= 8, 'a dot on the rail ' + JSON.stringify(badge)); assert(badge.overlap <= 4, 'the dot does not cover the icon ' + JSON.stringify(badge)); }
      assert.equal(await page.evaluate(() => { try { return localStorage.getItem('agentusage.sidebar.v1'); } catch { return 'x'; } }), null, 'the fold is not saved as a choice');

      // The document: a 720px column and the question in a bubble that stands off the page.
      const look = await page.evaluate(() => {
        const luminance = text => { const [r, g, b] = text.match(/[\d.]+/g).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
        const ratio = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
        const bubble = document.querySelector('[data-turn="user"]'), paper = document.querySelector('[data-reader-paper]');
        return { column: document.querySelector('[data-reader-scroll] .ff-reader-column').getBoundingClientRect().width, bubbleGround: ratio(getComputedStyle(bubble).backgroundColor, getComputedStyle(paper).backgroundColor), bubbleText: ratio(getComputedStyle(bubble).color, getComputedStyle(bubble).backgroundColor), right: bubble.getBoundingClientRect().right, columnRight: document.querySelector('[data-reader-scroll] .ff-reader-column').getBoundingClientRect().right };
      });
      assert.equal(Math.round(look.column), 720, 'reading column'); assert(look.bubbleGround >= 1.3, 'bubble stands off the page ' + look.bubbleGround); assert(look.bubbleText >= 7, 'bubble text ' + look.bubbleText); assert(Math.abs(look.right - look.columnRight) < 2, 'bubble on the right');

      // Times and the long pause, in the page and the outline.
      assert.equal(await page.locator('[data-reader-time]').count(), 5);
      assert.equal(await page.locator('[data-reader-gap]').count(), 1, 'one long pause'); assert.match(await page.locator('[data-reader-gap]').innerText(), /隔了 3 小时/);
      assert.equal(await page.locator('[data-outline-gap]').count(), 1);
      assert.equal(await page.locator('[data-outline-flag]').count(), 1, 'the failed turn is marked in the outline');
      await page.screenshot({ path: path.join(output, 'reader.png') });

      // The rail: one bar per turn, pressing goes there, a failure is marked.
      assert.equal(await page.locator('[data-rail-mark]').count(), 5); assert.equal(await page.locator('[data-rail-flag]').count(), 1);
      const rail = await page.locator('[data-rail]').boundingBox(), thirdBar = await page.locator('[data-rail-mark="2"]').boundingBox();
      await page.mouse.click(rail.x + rail.width / 2, thirdBar.y + thirdBar.height / 2); await until(page, () => document.querySelector('[data-outline-item="2"]')?.getAttribute('aria-current') === 'true');
      await page.mouse.move(5, 5);

      // The question stays in view while its long reply scrolls.
      await page.locator('[data-outline-item="0"]').click(); await page.waitForTimeout(500);
      { const paper = await page.locator('[data-reader-paper]').boundingBox(); await page.mouse.move(paper.x + paper.width / 2, paper.y + paper.height / 2); await page.mouse.wheel(0, 320); await page.waitForTimeout(350); }
      assert.equal(await page.locator('[data-reader-strip]').getAttribute('data-show'), 'true', 'question kept above a long reply');
      assert.match(await page.locator('[data-reader-strip]').innerText(), /第一个问题/);
      await page.screenshot({ path: path.join(output, 'reader-strip.png') });

      // Views.
      const views = page.getByRole('tablist', { name: '显示内容', exact: true });
      await views.getByRole('tab', { name: '只看对话', exact: true }).click(); await settle(page);
      assert.equal(await page.locator('[data-reader-process]').count(), 0, 'no process in talk view'); assert.equal(await page.locator('[data-reader-turn]').count(), 5);
      await views.getByRole('tab', { name: '只看失败', exact: true }).click(); await settle(page);
      assert.equal(await page.locator('[data-reader-turn]').count(), 1, 'only the failed turn'); assert.equal(await page.locator('[data-tool-error]').count() > 0, true);
      await views.getByRole('tab', { name: '全部', exact: true }).click(); await settle(page);

      // Copying: the code, one message, a reply.
      await page.locator('[data-outline-item="0"]').click(); await page.waitForTimeout(500);
      const first = page.locator('[data-reader-turn="0"]'); await first.hover();
      await first.getByRole('button', { name: '复制代码', exact: true }).click(); await copied(text => text === CODE);
      await first.getByRole('button', { name: '复制这条消息', exact: true }).click(); await copied(text => text === '第一个问题');
      await first.getByRole('button', { name: '复制回复', exact: true }).click(); const reply = await copied(text => text.startsWith('## 结论')); assert(!reply.includes('### 回复'), 'a reply copies as its words');
      await first.getByRole('button', { name: '复制这一轮', exact: true }).click(); await copied(text => text.includes('### 你') && text.includes('第一个问题'));

      // The right column: facts from the saved list, commands and failures that go to their turn.
      await page.locator('[data-reader-side-toggle] button').click(); await page.locator('[data-reader-side]').waitFor();
      const side = page.locator('[data-reader-side]'); assert.match(await side.innerText(), /gpt-6\.1-sol/); assert.match(await side.innerText(), /3时/, 'duration from the record');
      const sideTab = async name => { await side.locator('[data-reader-side-tabs]').getByRole('tab', { name }).click(); await page.waitForTimeout(250); };
      assert.equal(await side.locator('[data-session-detail-parts] [data-breakdown-row]').count(), 4, 'the same usage breakdown as the detail card');
      assert.equal(await side.locator('[data-session-detail-stats] dd').count(), 6, 'the same tiles as the detail card');
      const sideFit = await side.evaluate(e => e.scrollWidth <= e.clientWidth + 1); assert.equal(sideFit, true, 'nothing is cut at the edge of the column');
      await settle(page); await page.screenshot({ path: path.join(output, 'reader-facts.png') });
      // Both columns are sized by the person, between limits, and keep it.
      const columnWidth = selector => page.locator(selector).evaluate(e => Math.round(e.closest('[data-resizable]').getBoundingClientRect().width));
      const outlineGrip = page.getByRole('separator', { name: '调整左栏宽度' }), outlineBox = await outlineGrip.boundingBox();
      await page.mouse.move(outlineBox.x + 5, outlineBox.y + 300); await page.mouse.down(); await page.mouse.move(outlineBox.x + 500, outlineBox.y + 300, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(500);
      assert.equal(await columnWidth('[data-reader-outline]'), 360, 'the left column stops at its widest');
      await outlineGrip.focus(); await page.keyboard.press('Home'); await page.waitForTimeout(500); assert.equal(await columnWidth('[data-reader-outline]'), 200, 'and at its narrowest');
      await outlineGrip.dblclick(); await page.waitForTimeout(500); assert.equal(await columnWidth('[data-reader-outline]'), 248);
      const sideGrip = page.getByRole('separator', { name: '调整右栏宽度' }), sideBox = await sideGrip.boundingBox();
      await page.mouse.move(sideBox.x + 5, sideBox.y + 300); await page.mouse.down(); await page.mouse.move(sideBox.x - 60, sideBox.y + 300, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(500);
      assert.equal(await columnWidth('[data-reader-side]'), 385, 'the right column grows leftwards'); await sideGrip.dblclick(); await page.waitForTimeout(500);
      await sideTab(/^命令/); assert.equal(await side.locator('[data-reader-side-list="commands"] [data-outline-item]').count(), 10);
      await sideTab(/^失败/); assert.equal(await side.locator('[data-reader-side-list="failures"] [data-outline-item]').count(), 1);
      assert.equal((await page.locator('[data-reader-paper]').boundingBox()).width >= 640, true, 'text column keeps its width beside the outline and right column');
      await page.screenshot({ path: path.join(output, 'reader-side.png') });
      await side.locator('[data-reader-side-list="failures"] [data-outline-item]').click(); await until(page, () => document.querySelector('[data-outline-item="1"]')?.getAttribute('aria-current') === 'true' || document.querySelector('[data-reader-turn="1"] [data-tool-error]') !== null);
      assert(await page.locator('[data-reader-turn="1"] [data-tool-error]').first().isVisible(), 'the failed step is in view');
      await page.locator('[data-reader-side-toggle] button').click();

      // Export a range: first and last turn in the outline, through the save dialog.
      await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saved);
      await page.getByRole('button', { name: '导出 Markdown', exact: true }).click(); await page.getByRole('menuitem', { name: '选择几轮导出' }).click(); await settle(page);
      assert.match(await page.locator('[data-reader-pick-status]').innerText(), /第一轮和最后一轮/);
      await page.locator('[data-outline-item="1"]').click(); await page.locator('[data-outline-item="2"]').click();
      assert.match(await page.locator('[data-reader-pick-status]').innerText(), /已选 2 轮/);
      await page.locator('[data-reader-pick]').getByRole('button', { name: '导出', exact: true }).click();
      await until(page, () => /已导出对话/.test(document.getElementById('toast')?.textContent ?? ''));
      const text = fs.readFileSync(saved, 'utf8'); assert(text.includes('第二个问题') && text.includes('隔了很久的问题') && !text.includes('第一个问题') && !text.includes('第四个问题'), 'only the picked turns');

      // Keys: J / K a turn, / finds, Escape closes the find and then leaves; [ / ] a session.
      await page.locator('[data-reader-scroll]').focus();
      await page.locator('[data-outline-item="0"]').click(); await page.waitForTimeout(400); await page.locator('[data-reader-scroll]').focus();
      await page.keyboard.press('j'); await until(page, () => document.querySelector('[data-outline-item="1"]')?.getAttribute('aria-current') === 'true');
      await page.keyboard.press('k'); await until(page, () => document.querySelector('[data-outline-item="0"]')?.getAttribute('aria-current') === 'true');
      await page.keyboard.press('/'); const field = page.getByRole('textbox', { name: '在对话中查找', exact: true }); await field.waitFor(); await page.waitForTimeout(100);
      await page.keyboard.type('隔了很久'); await until(page, () => /1 \/ 1/.test(document.querySelector('[data-reader-hits]')?.textContent ?? ''));
      assert.equal(await page.locator('[data-rail-hit]').count(), 1, 'the hit is on the rail');
      await page.keyboard.press('Escape'); await settle(page); assert.equal(await field.inputValue(), '', 'Escape clears first');
      await page.keyboard.press('Escape'); await field.waitFor({state:'detached',timeout:5000}); await settle(page); assert.equal(await field.count(), 0, 'then closes the find');
      await page.locator('[data-reader-scroll]').focus(); await page.keyboard.press('[');
      await until(page, () => document.querySelectorAll('[data-reader-turn]').length === 1); assert.equal(await page.locator('[data-reader-title]').innerText(), '第二个会话', 'moved to the session above in the list');
      assert(await page.locator('[data-reader-resume] button').isVisible(), 'continue is in the title bar');
      await page.locator('[data-reader-resume] button').click(); await copied(text => /codex resume/.test(text));

      await page.keyboard.press('Escape'); await page.locator('[data-sessions-page]').waitFor(); await settle(page);
      assert.equal(await collapsed(), false, 'menu back on the list');

      // The change view: a patch reads as its files with counts, opens to lines, and the right column lists its files.
      await page.getByRole('button', { name: /^改动会话，/ }).click(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      const toolRow = page.locator('[data-tool-change]').first();
      if (!await toolRow.isVisible()) await page.locator('[data-reader-turn="0"] [data-reader-process] button').first().click();
      assert.match(await toolRow.innerText(), /src\/chart\.js、src\/new\.js/); assert.match(await page.locator('[data-tool-change-count]').first().textContent(), /\+3 −1/);
      await toolRow.getByRole('button').first().click(); await page.locator('[data-diff]').first().waitFor();
      assert.equal(await page.locator('[data-diff-file]').count(), 2); assert.equal(await page.locator('[data-diff-line="add"]').count(), 3); assert.equal(await page.locator('[data-diff-line="del"]').count(), 1);
      await toolRow.getByRole('button').first().click(); await settle(page);
      // Colours in code, off while a find marks it.
      assert(await page.locator('[data-code-token="keyword"]').count() > 0, 'code keyword coloured'); assert(await page.locator('[data-code-token="comment"]').count() > 0, 'code comment coloured');
      // Tokens per turn: reported where the record has them, unknown otherwise, never 0.
      assert.equal(await page.locator('[data-reader-usage]').first().innerText(), 'Token 1.5K');
      assert.equal(await page.locator('[data-reader-usage]').nth(1).innerText(), 'Token 未知');
      // One file's turns, its change open.
      if (!await page.locator('[data-reader-side]').isVisible()) await page.locator('[data-reader-side-toggle] button').click();
      await page.locator('[data-reader-side-tabs]').getByRole('tab', { name: /^文件/ }).click();
      await page.locator('[data-reader-side-list="files"] [data-outline-item]').first().click(); await page.locator('[data-reader-file]').waitFor(); await page.locator('[data-diff]').first().waitFor();
      assert.equal(await page.locator('[data-reader-turn]').count(), 1, 'only the turn that touched the file');
      // Which other sessions changed this file: asked for, not scanned on its own; the exact one first.
      assert.equal(await page.locator('[data-file-history]').getAttribute('data-state'), 'idle');
      await page.locator('[data-reader-file-history] button').click(); await until(page, () => document.querySelector('[data-file-history]')?.dataset.state === 'ready');
      assert.deepEqual(await page.locator('[data-file-history] [data-outline-item] span.line-clamp-2').allInnerTexts(), ['昨天改过图表', '工作树里改过图表']);
      assert.match(await page.locator('[data-file-history] [data-outline-item]').nth(1).innerText(), /其他目录的同路径文件/, 'says when it is not the same directory');
      assert.match(await page.locator('[data-file-history-status]').innerText(), /2 个会话/);
      await page.waitForTimeout(300); await page.screenshot({ path: path.join(output, 'reader-file-history.png') });
      await page.locator('[data-file-history] [data-outline-item]').first().click(); await page.locator('[data-reader-panes="2"]').waitFor();
      await until(page, () => document.querySelectorAll('[data-reader-page]')[1]?.querySelector('[data-reader-file]') !== null);
      assert.match(await page.locator('[data-reader-page]').nth(1).locator('[data-reader-title]').innerText(), /昨天改过图表/);
      assert.equal(await page.locator('[data-reader-page]').nth(1).locator('[data-reader-turn]').count(), 1, 'it opens on that file');
      await page.locator('[data-reader-page]').nth(1).locator('[data-reader-close-pane] button').click(); await page.locator('[data-reader-panes="1"]').waitFor(); await settle(page);
      if (!await page.locator('[data-reader-side]').isVisible()) await page.locator('[data-reader-side-toggle] button').click();
      await page.getByRole('button', { name: '显示全部', exact: true }).click(); await settle(page); assert.equal(await page.locator('[data-reader-turn]').count(), 2);
      await page.screenshot({ path: path.join(output, 'reader-changes.png') });
      // Following a conversation that is still being written: a new turn arrives without leaving the page, at the end.
      await page.locator('[data-reader-follow] button').click();
      fs.appendFileSync(changesFile, rowsOf(say('user', '新来的问题', 1), say('assistant', '新来的回复', .9)));
      await until(page, () => document.querySelectorAll('[data-reader-turn]').length === 3);
      assert.match(await page.locator('[data-reader-turn="2"]').innerText(), /新来的问题/);
      assert.equal(await page.locator('[data-reader-follow]').getAttribute('data-on'), 'true', 'still following after the read');
      await page.locator('[data-reader-follow] button').click();
      await page.locator('[data-reader-side-toggle] button').click();
      await page.locator('[data-reader-back] button').click(); await settle(page);
      // A sub-agent reads as a folded step of its turn.
      await page.getByRole('button', { name: /Claude Code 会话/ }).first().click(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      assert.equal(await page.locator('[data-reader-turn]').count(), 1, 'the sub-agent prompt is no turn of the person');
      await page.locator('[data-reader-process] button').first().click(); await page.locator('[data-reader-agent]').waitFor();
      assert.match(await page.locator('[data-reader-agent]').innerText(), /子 Agent/);
      await page.locator('[data-reader-agent] button').first().click(); await settle(page); assert.match(await page.locator('[data-reader-agent]').innerText(), /子任务结果/);
      assert.match(await page.locator('[data-reader-turn]').first().innerText(), /找到了/);
      await page.screenshot({ path: path.join(output, 'reader-agent.png') });
      await page.locator('[data-reader-back] button').click(); await settle(page);

      // Reopening returns to the turn last read; only its number is saved, and a search result's place comes first.
      await page.getByRole('button', { name: /^第一个会话，/ }).click(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      await page.locator('[data-outline-item="3"]').click(); await until(page, () => document.querySelector('[data-outline-item="3"]')?.getAttribute('aria-current') === 'true');
      await page.waitForTimeout(2500);
      await page.locator('[data-reader-back] button').click(); await settle(page);
      const remembered = JSON.parse(fs.readFileSync(path.join(usageDir, 'session-labels.json'), 'utf8')).labels;
      assert.deepEqual(Object.values(remembered).map(label => Object.keys(label)), [['turn']], 'nothing else is saved'); assert.equal(Object.values(remembered)[0].turn, 3);
      await page.getByRole('button', { name: /^第一个会话，/ }).click(); await page.locator('[data-reader-turn]').first().waitFor();
      await until(page, () => document.querySelector('[data-outline-item="3"]')?.getAttribute('aria-current') === 'true');
      // The outline selection is restored before the enter animation reveals
      // the paper. Require the actual visible words, not selection alone.
      await until(page, () => document.querySelector('[data-reader-turn="3"]')?.innerText.includes('第四个问题'), 5000);
      assert.match(await page.locator('[data-reader-turn="3"]').innerText(), /第四个问题/);
      await page.waitForTimeout(1800);
      const top = await page.locator('[data-reader-turn="3"]').boundingBox(), frame = await page.locator('[data-reader-scroll]').boundingBox();
      assert(top.y >= frame.y - 2 && top.y < frame.y + 120, 'the turn is at the top of the page ' + JSON.stringify([top.y, frame.y]));
      // Back at the start, nothing is kept for this session.
      await page.locator('[data-outline-item="0"]').click(); await until(page, () => document.querySelector('[data-outline-item="0"]')?.getAttribute('aria-current') === 'true');
      await page.waitForTimeout(2500); await page.locator('[data-reader-back] button').click(); await settle(page);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(usageDir, 'session-labels.json'), 'utf8')).labels, {}, 'the start needs no position');

      // Ctrl+B opens the menu for this reading only; the choice is untouched.
      await page.getByRole('button', { name: /^第一个会话，/ }).click(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      await page.locator('#windowSidebar').click(); await settle(page); assert.equal(await collapsed(), false, 'opened for this reading');
      assert.equal(await page.evaluate(() => localStorage.getItem('agentusage.sidebar.v1')), null);
      await page.locator('[data-reader-back] button').click(); await settle(page); assert.equal(await collapsed(), false);
      await page.getByRole('button', { name: /^第一个会话，/ }).click(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      assert.equal(await collapsed(), true, 'folds again on the next reading');
      await page.locator('#theme').click().catch(() => {}); await settle(page); await page.screenshot({ path: path.join(output, 'reader-other-theme.png') });

      await page.locator('#theme').click().catch(() => {}); await settle(page);
      await page.locator('[data-reader-back] button').click(); await settle(page);

      // Recognition: wrappers fold or lift out, the turn count is the person's, the commands are what ran.
      await page.getByRole('button', { name: /^识别会话，/ }).click(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      assert.deepEqual(await page.locator('[data-reader-turn] [data-reader-question]').count(), 3, 'an app event opens no turn');
      const whole = await page.locator('[data-reader-scroll]').innerText();
      assert.match(whole, /看一下这个图/); assert.doesNotMatch(whole, /oai-mem-citation|Files mentioned by the user|send_user_message_question_reply|My request for Codex/);
      assert.match(whole, /先做哪个？/); assert.match(whole, /先做 A/);
      assert.equal(await page.locator('[data-reader-attached]').first().innerText(), 'a.png');
      assert.match(await page.locator('[data-reader-cited]').innerText(), /引用了 1 条记忆/);
      assert.match(await page.locator('[data-turn="compact"]').first().innerText(), /上下文在这里压缩了/);
      assert.match(await page.locator('[data-reader-turn="0"]').innerText(), /打开了一个应用页面/);
      assert.match(await page.locator('[data-reader-title]').locator('..').innerText(), /3 轮/);
      await page.locator('[data-reader-side-toggle] button').click(); await page.locator('[data-reader-side]').waitFor(); await settle(page);
      // Many compactions fold (owner 2026-11-05): the first few, the rest behind one click, and the whole list from its head.
      const compacts = page.locator('[data-reader-side-list="compacts"]'), compactRows = () => compacts.getByRole('navigation').getByRole('button').count();
      assert.match(await compacts.innerText(), /上下文压缩\s+7/); assert.equal(await compactRows(), 5, 'the first few');
      await compacts.locator('[data-side-more]').click(); await settle(page); assert.equal(await compactRows(), 7, 'the rest'); assert.match(await compacts.locator('[data-side-more]').innerText(), /收起/);
      await compacts.locator('[data-side-more]').click(); await settle(page); assert.equal(await compactRows(), 5, 'and back');
      await compacts.locator('[data-side-fold]').click(); await settle(page); assert.equal(await compacts.getByRole('navigation').count(), 0, 'folds from its head'); assert.equal(await compacts.locator('[data-side-more]').count(), 0);
      await compacts.locator('[data-side-fold]').click(); await settle(page);
      assert.match(await page.locator('[data-reader-side-list="attached"]').innerText(), /a\.png/);
      assert.match(await page.locator('[data-reader-side-list="cited"]').innerText(), /earlier acceptance/);
      await page.locator('[data-reader-side-tabs]').getByRole('tab', { name: /^命令/ }).click(); await page.waitForTimeout(250);
      assert.deepEqual(await page.locator('[data-reader-side-list="commands"] [data-command-text]').allInnerTexts(), ['npm run verify', 'git status'], 'the commands, not the script around them');
      await page.screenshot({ path: path.join(output, 'reader-recognition.png') });
      await page.locator('[data-reader-side-toggle] button').click(); await settle(page);
      await page.locator('[data-reader-back] button').click(); await settle(page);

      // Each turn's Token on the rail: as wide as it took, unknown stays the thinnest; the heaviest turns are listed.
      await page.getByRole('button', { name: /^改动会话，/ }).click(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      const railBars = await page.locator('[data-rail-mark]').evaluateAll(bars => bars.map(bar => ({ level: bar.getAttribute('data-rail-level'), width: Number(bar.getAttribute('width')) })));
      assert.equal(railBars[0].level, '1', 'the largest turn fills the scale'); assert.equal(railBars[1].level, 'unknown'); assert(railBars[0].width > railBars[1].width);
      assert.equal(railBars[1].width, 2, 'an unknown turn is no small amount');
      await page.locator('[data-reader-back] button').click(); await settle(page);

      // Ctrl+K from any page: a session, a project or a page by name, keys alone.
      await showView(page, 'cost'); await settle(page);
      await page.keyboard.press('Control+k'); await page.locator('[data-quick-switch]').waitFor(); await settle(page);
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'INPUT', 'the search box has focus');
      assert.equal(await page.locator('[data-quick-switch] [data-outline-item]').first().getAttribute('aria-current'), 'true', 'the first is chosen');
      await page.keyboard.type('昨天'); await until(page, () => /昨天改过图表/.test(document.querySelector('[data-quick-switch]')?.textContent ?? ''));
      await page.waitForTimeout(250); await page.screenshot({ path: path.join(output, 'quick-switch.png') });
      await page.keyboard.press('Enter'); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      assert.match(await page.locator('[data-reader-title]').innerText(), /昨天改过图表/, 'opens a session outside the page\'s range too');
      await page.keyboard.press('Control+k'); await page.locator('[data-quick-switch]').waitFor(); await page.keyboard.type('第二个'); await until(page, () => /第二个会话/.test(document.querySelector('[data-quick-switch]')?.textContent ?? ''));
      await page.keyboard.press('Control+Enter'); await page.locator('[data-reader-panes="2"]').waitFor(); await settle(page);
      await page.keyboard.press('Control+k'); await page.locator('[data-quick-switch]').waitFor();
      assert(await page.evaluate(() => document.activeElement?.matches('[data-quick-switch] input')), 'rapid reopen focuses the new search body before typing');
      await page.keyboard.type('费用'); await until(page, () => document.querySelector('[data-quick-switch] [data-outline-item]')?.textContent.includes('费用'));
      await page.keyboard.press('Enter'); await until(page, () => document.getElementById('main')?.dataset.currentView === 'cost');
      await showView(page, 'sessions'); await settle(page); await page.locator('[data-reader-back] button').click(); await settle(page);
      await page.locator('#windowQuick').click(); await page.locator('[data-quick-switch]').waitFor(); await page.keyboard.type('marks'); await until(page, () => /项目/.test(document.querySelector('[data-quick-switch]')?.textContent ?? ''));
      await page.locator('[data-quick-switch] [data-outline-item]').filter({ hasText: '个会话' }).first().click(); await settle(page);
      assert.equal(await page.locator('[data-session-search] input').inputValue(), 'marks', 'a project opens the list on it');
      await page.locator('[data-session-search] input').fill(''); await settle(page);
      await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click(); await settle(page);
      if (await page.locator('[data-sessions-page]').getByRole('button', { name: '全部展开', exact: true }).count()) await page.locator('[data-sessions-page]').getByRole('button', { name: '全部展开', exact: true }).click(); await settle(page);

      // Reading one conversation and wanting another: the left column's sessions, with the O key too; in its place, or beside it.
      await page.getByRole('button', { name: /^第一个会话，/ }).click(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      await page.keyboard.press('o'); await page.locator('[data-reader-sessions]').waitFor(); await settle(page);
      await page.screenshot({ path: path.join(output, 'reader-open-other.png') });
      await page.locator('[data-reader-sessions] input').fill('改动'); await settle(page);
      const besideRow = name => page.locator('[data-nav-session]', { hasText: name });
      await besideRow('改动会话').hover(); await besideRow('改动会话').locator('[data-nav-menu] button').click(); await page.getByRole('menuitem', { name: '并排打开' }).click(); await page.locator('[data-reader-panes="2"]').waitFor(); await settle(page);
      assert.match(await page.locator('[data-reader-page]').nth(0).locator('[data-reader-title]').innerText(), /第一个会话/, 'the first stays where it was');
      assert.match(await page.locator('[data-reader-page]').nth(1).locator('[data-reader-title]').innerText(), /改动会话/);
      await page.locator('[data-reader-page]').nth(1).locator('[data-reader-close-pane] button').click(); await page.locator('[data-reader-panes="1"]').waitFor(); await settle(page);
      await page.locator('[data-reader-sessions] input').fill(''); await settle(page);
      await besideRow('第二个会话').locator('[data-nav-open]').click(); await until(page, () => /第二个会话/.test(document.querySelector('[data-reader-title]')?.textContent ?? ''));
      assert.equal(await page.locator('[data-reader-page]').count(), 1, 'in its place, still one');
      await page.locator('[data-reader-nav-tabs]').getByRole('tab', { name: '目录' }).click(); await settle(page);
      await page.locator('[data-reader-back] button').click(); await settle(page);

      // The detail card has the cost detail's layout.
      await page.locator('[data-session] [data-session-detail-open] button').first().click(); await settle(page);
      assert.equal(await page.getByRole('dialog').getAttribute('data-sheet-placement'), 'left');
      assert.equal(await page.locator('[data-session-detail-stats] dd').count(), 6); assert(await page.locator('[data-session-detail-amount]').isVisible());
      await page.screenshot({ path: path.join(output, 'session-detail.png') }); await page.keyboard.press('Escape'); await settle(page);

      // Several sessions: pick, read side by side, compare, group, archive. Only the app's own label file changes.
      await page.locator('[data-session-pick] button').click(); await settle(page);
      assert.equal(await page.locator('[data-session-actions]').count(), 0, 'row actions step aside while picking');
      await page.getByRole('checkbox', { name: /^选择 第一个会话/ }).click();
      await page.getByRole('button', { name: /^第二个会话，/ }).click();
      await page.getByRole('checkbox', { name: /^选择 改动会话/ }).click(); await settle(page);
      assert.equal(await page.locator('[data-session-picked]').innerText(), '已选 3 个');
      await page.screenshot({ path: path.join(output, 'sessions-picking.png') });
      await page.locator('[data-session-side-by-side] button').click(); await page.locator('[data-reader-panes="3"]').waitFor(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      assert.equal(await page.locator('[data-reader-page]').count(), 3);
      for (const box of await page.locator('[data-reader-page]').evaluateAll(panes => panes.map(pane => { const rect = pane.getBoundingClientRect(); return [rect.width, pane.scrollWidth]; }))) assert(box[0] >= 320 && box[1] <= box[0] + 1, 'each pane fits ' + box);
      await until(page, () => document.querySelectorAll('[data-reader-page]').length === 3 && [...document.querySelectorAll('[data-reader-page]')].every(pane => pane.querySelector('[data-reader-turn]')));
      await page.screenshot({ path: path.join(output, 'reader-side-by-side.png') });
      // Every pane's paper starts and ends level, whatever its header holds.
      const papers = await page.locator('[data-reader-paper]').evaluateAll(all => all.map(paper => { const box = paper.getBoundingClientRect(); return [Math.round(box.top), Math.round(box.bottom)]; }));
      assert.equal(new Set(papers.map(String)).size, 1, 'same height in every pane ' + JSON.stringify(papers));
      for (const row of await page.locator('[data-reader-header-row]').evaluateAll(rows => rows.map(item => [item.scrollWidth, item.clientWidth]))) assert(row[0] <= row[1] + 1, 'a header row fits ' + row);
      // A find bar in one pane leaves the others level too.
      await page.locator('[data-reader-page]').nth(1).locator('[data-reader-tools] button').first().click(); await page.locator('[data-reader-page]').nth(1).locator('[data-reader-find]').waitFor(); await settle(page);
      const withFind = await page.locator('[data-reader-paper]').evaluateAll(all => all.map(paper => Math.round(paper.getBoundingClientRect().top)));
      assert.equal(new Set(withFind).size, 1, 'a find bar moves no paper ' + JSON.stringify(withFind));
      await page.locator('[data-reader-page]').nth(1).locator('[data-reader-tools] button').first().click(); await settle(page);
      // At three panes the column still opens another conversation, in this pane's place; beside it no longer fits.
      await page.locator('[data-reader-page]').nth(2).locator('[data-reader-scroll]').click({ position: { x: 4, y: 4 } }); const navOpen = async () => { if (!await page.locator('[data-reader-nav]').count()) await page.locator('[data-reader-nav-toggle] button').click(); await page.locator('[data-reader-nav]').waitFor(); }; await navOpen();
      await page.locator('[data-reader-nav-tabs]').getByRole('tab', { name: '会话' }).click(); await page.locator('[data-reader-sessions]').waitFor(); await settle(page);
      assert.equal(await page.locator('[data-nav-elsewhere]').count(), 2, 'the other panes are marked');
      const spare = page.locator('[data-nav-session]:not([data-selected])', { hasNot: page.locator('[data-nav-elsewhere]') }).first(); await spare.hover(); await page.waitForTimeout(200);
      await spare.locator('[data-nav-menu] button').click();
      assert.equal(await page.getByRole('menuitem', { name: '并排打开（窗口放不下）' }).getAttribute('aria-disabled'), 'true');
      await page.keyboard.press('Escape');
      await page.mouse.move(2, 500); await settle(page);
      // Keys go to the pane in use; closing one keeps the others where they are.
      await page.locator('[data-reader-page]').nth(1).locator('[data-reader-scroll]').click({ position: { x: 4, y: 4 } });
      assert.equal(await page.locator('[data-reader-page]').nth(1).getAttribute('data-focused'), 'true');
      await page.locator('[data-reader-page]').nth(2).locator('[data-reader-close-pane] button').click(); await page.locator('[data-reader-panes="2"]').waitFor();
      await navOpen();
      await page.locator('[data-reader-nav-tabs]').getByRole('tab', { name: '会话' }).click(); await page.locator('[data-reader-sessions]').waitFor(); await settle(page);
      await besideRow('改动会话').hover(); await besideRow('改动会话').locator('[data-nav-menu] button').click(); await page.getByRole('menuitem', { name: '并排打开' }).click(); await page.locator('[data-reader-panes="3"]').waitFor(); await settle(page);
      await page.locator('[data-reader-page]').nth(2).locator('[data-reader-close-pane] button').click(); await page.locator('[data-reader-panes="2"]').waitFor();

      // Side by side the right column is the window's: one, beside the panes rather than over them, following the pane in use.
      const paneBoxes = () => page.locator('[data-reader-page]').evaluateAll(all => all.map(pane => { const box = pane.getBoundingClientRect(); return { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) }; }));
      await page.locator('[data-reader-page]').nth(0).locator('[data-reader-scroll]').click({ position: { x: 4, y: 4 } });
      if (!await page.locator('[data-reader-side]').count()) await page.locator('[data-reader-side-toggle] button').click(); await page.locator('[data-reader-side]').waitFor(); await settle(page);
      assert.equal(await page.locator('[data-reader-side]').count(), 1, 'one panel');
      assert.deepEqual(await page.locator('[data-reader-side-tabs] [role="tab"]').evaluateAll(tabs => tabs.map(tab => tab.textContent.slice(0, 2))), ['概况', '命令', '文件', '失败', '对比']);
      assert.equal(await page.locator('[data-reader-side]').evaluate(e => e.scrollWidth <= e.clientWidth + 1), true, 'the tabs fit');
      const panelLeft = await page.locator('[data-reader-side]').evaluate(e => Math.round(e.getBoundingClientRect().left));
      for (const pane of await paneBoxes()) assert(pane.right <= panelLeft + 1 && pane.width >= 320, 'beside every pane, each stays readable ' + JSON.stringify(pane));
      await page.waitForTimeout(400); await page.screenshot({ path: path.join(output, 'reader-panel-fixed.png') });
      // Another pane in use takes the panel with it.
      await page.locator('[data-reader-page]').nth(1).locator('[data-reader-scroll]').click({ position: { x: 4, y: 4 } }); await settle(page);
      assert.equal(await page.locator('[data-reader-side]').count(), 1, 'it stays open');
      // The comparison is a tab: the other pane by default, figures in small columns.
      await page.locator('[data-reader-side-tabs]').getByRole('tab', { name: '对比' }).click(); await page.locator('[data-compare-head]').waitFor();
      assert.equal(await page.locator('[data-compare-column]').count(), 2);
      await until(page, () => [...document.querySelectorAll('[data-compare-row="turns"] [role="cell"]')].every(cell => /\d/.test(cell.textContent)));
      assert.deepEqual(await page.locator('[data-compare-row="turns"] [role="cell"]').allInnerTexts(), ['1', '5']);
      assert.equal(await page.locator('[data-reader-side]').evaluate(e => e.scrollWidth <= e.clientWidth + 1), true, 'the comparison fits');
      await page.waitForTimeout(300); await page.screenshot({ path: path.join(output, 'sessions-compare.png') });
      await page.locator('[data-reader-side-toggle] button').click(); await settle(page);
      await page.locator('[data-reader-back] button').click(); await page.locator('[data-sessions-page]').waitFor(); await settle(page);
      // From the list: a comparison opens on the first one's right column.
      await page.locator('[data-session-pick] button').click(); await settle(page);
      await page.getByRole('checkbox', { name: /^选择 第一个会话/ }).click(); await page.getByRole('checkbox', { name: /^选择 改动会话/ }).click(); await settle(page);
      await page.locator('[data-session-compare-open] button').click(); await page.locator('[data-compare-head]').waitFor(); await settle(page);
      assert.equal(await page.locator('[data-reader-page]').count(), 1, 'a small tab, no page of its own');
      assert.equal(await page.locator('[data-compare-column]').count(), 2);
      await page.locator('[data-reader-side-toggle] button').click(); await settle(page);
      await page.locator('[data-reader-back] button').click(); await page.locator('[data-sessions-page]').waitFor(); await settle(page);

      // Grouping and archiving stay in the app's own file; the Agent's files are untouched.
      await page.locator('[data-session-pick] button').click(); await settle(page);
      await page.getByRole('checkbox', { name: /^选择 第一个会话/ }).click(); await page.getByRole('checkbox', { name: /^选择 第二个会话/ }).click(); await settle(page);
      await page.locator('[data-session-move] button').click(); await page.getByRole('menuitem', { name: '新建分组…' }).click();
      await page.getByRole('dialog').getByRole('textbox').fill('修图表'); await page.locator('[data-session-group-sheet]').getByRole('button', { name: '保存', exact: true }).click(); await settle(page);
      await page.getByRole('tablist', { name: '会话分组', exact: true }).getByRole('tab', { name: '按分组', exact: true }).click(); await settle(page);
      assert.equal(await page.locator('[data-group-kind="collection"] [data-session-project]').first().innerText(), '修图表');
      await page.locator('[data-sessions-page]').getByRole('button', { name: '全部展开', exact: true }).click().catch(() => {}); await settle(page);
      await page.locator('[data-session-pick] button').click(); await settle(page);
      await page.getByRole('checkbox', { name: /^选择 第二个会话/ }).click(); await settle(page);
      assert.equal(await page.locator('[data-session-archive-picked]').count(), 0, 'no archiving (owner 2026-11-05)');
      assert.equal(await page.getByRole('button', { name: /^第二个会话，/ }).count(), 1);
      await page.locator('[data-session-pick] button').click(); await settle(page);
      const kept = Object.values(JSON.parse(fs.readFileSync(path.join(usageDir, 'session-labels.json'), 'utf8')).labels);
      assert.deepEqual(kept.map(label => label.group).sort(), ['修图表', '修图表']);
      for (const label of kept) assert.deepEqual(Object.keys(label).filter(name => !['alias', 'pinned', 'turn', 'group'].includes(name)), []);
      await page.screenshot({ path: path.join(output, 'sessions-groups.png') });

      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow');
      assert.deepEqual(errors, []);
    } catch (error) { fs.writeFileSync(path.join(output,'copy-diagnostics.json'),JSON.stringify(await app.evaluate(()=>globalThis.readerCopyDiagnostics)));await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; } finally { await app.close(); }
  } finally { await cleanup(root); }
  console.log('PASS: reading page: document layout, bubbles, folded menu, times, views, kept question, rail, sessions, right column, copy, range export and keys.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
