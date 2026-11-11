'use strict';
/* global document, getComputedStyle */
// The reading page's left and right columns (UI-READER-NAV-20261104.md) on a synthetic home only, at the default window: the
// switch above the outline, the sessions as folders of projects, opening here and beside; the files as a tree, commands and
// failures turn by turn, the comparison; side by side, the columns push the panes and holding a head or a row places a pane
// (UI-READER-PANES-20261104.md). Screenshots go to artifacts/reader-nav.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { roots } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { Store } = require('../../src/m1/store');
const { settle, until, showView, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const output = path.resolve(process.env.READER_NAV_EVIDENCE_DIR || path.join('artifacts', 'reader-nav')); fs.mkdirSync(output, { recursive: true });
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const lines = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const FILLER = '这是一段合成的回复，只为了让页面有足够的内容可以阅读，不来自任何真实会话。'.repeat(10);
const say = (role, text, at) => ({ timestamp: ago(at), type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
const usage = (total, at) => ({ timestamp: ago(at), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total, output_tokens: 120, cached_input_tokens: Math.round(total / 2), total_tokens: total + 120 }, last_token_usage: { input_tokens: total, output_tokens: 120, total_tokens: total + 120 } } } });
const shell = (id, command, output_, code, at) => [
  { timestamp: ago(at), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: id, arguments: JSON.stringify({ command }) } },
  { timestamp: ago(at - .05), type: 'response_item', payload: { type: 'function_call_output', call_id: id, output: JSON.stringify({ output: output_, metadata: { exit_code: code } }) } },
];
const PATCH = ['*** Begin Patch',
  '*** Add File: design/desktop-reference/assets/agents/sample.svg', '+<svg/>',
  '*** Delete File: design/desktop-reference/assets/fonts/Old.woff2',
  '*** Update File: design/desktop-reference/ui/agent-ui.js', '@@ one', ' keep', '-const old = 1;', '+const fresh = 2;', '+draw(fresh);',
  '*** Add File: docs/m2/UI-SAMPLE.md', '+# 合成文档', '+第二行',
  '*** Update File: src/m1/transcript.js', '@@ two', '-a', '-b', '+c',
  '*** Add File: ui/src/pages/sessions/reader-sample.tsx', '+export const made = true;', '+export const more = 1;',
  '*** Update File: ui/src/theme/sample.css', '@@ three', '+.sample {}',
  '*** End Patch'].join('\n');
function codex(selected, id, name, cwd, at, turns, extra = []) {
  const rows = [{ timestamp: ago(at), type: 'session_meta', payload: { id, cwd, originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-6.1-sol', cwd } }];
  turns.forEach((turn, position) => rows.push(say('user', turn, at - position), say('assistant', '第 ' + (position + 1) + ' 轮的回复。\n\n' + FILLER, at - position - .2), usage(4000 + position * 900, at - position - .3)));
  rows.push(...extra);
  write(path.join(selected.codex[0], '2026', '11', '03', 'rollout-2026-11-03T09-00-00-' + id + '.jsonl'), lines(rows));
  return JSON.stringify({ id, thread_name: name, updated_at: ago(at - turns.length) });
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-nav-')), home = path.join(root, 'home'), usageDir = path.join(root, 'usage'), quotaDir = path.join(root, 'quota');
  try {
    const selected = roots(home); for (const dir of Object.values(selected).flat()) fs.mkdirSync(dir, { recursive: true });
    const id = n => '019a7c2e-0000-4000-8000-' + String(n).padStart(12, '0'), index = [];
    const work = [...shell('c1', ['git', 'status', '--short'], 'M a.js', 0, 58), ...shell('c2', ['npm', 'run', 'verify'], 'error: 2 tests failed\nsecond line', 1, 57.5),
      { timestamp: ago(57), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'p1', input: PATCH } }, { timestamp: ago(56.9), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'p1', output: 'done' } },
      say('user', '第三个问题：再跑一遍检查', 40), ...shell('c3', ['rg', '-n', 'ReaderPane', 'ui/src/pages/sessions/reader.tsx'], '276:function ReaderPane', 0, 39), ...shell('c4', ['node', 'scripts/m1/some-long-script-name-for-a-very-long-command-line.js', '--with', 'several', '--long', 'arguments', '--so', 'that', 'the', 'line', 'wraps'], 'Cannot find module', 1, 38.5), say('assistant', '第三轮的回复。\n\n' + FILLER, 38), usage(9000, 37.9)];
    index.push(codex(selected, id(1), '整理发布说明与验收清单', 'C:/fixtures/alpha', 60, ['第一个问题：看一下现在的状态', '第二个问题：把这几个文件改掉'], work));
    index.push(codex(selected, id(2), '核对依赖版本并记录一个比较长的名字', 'C:/fixtures/alpha', 130, ['核对一下'], shell('s2', ['git', 'log'], 'ok', 0, 129)));
    index.push(codex(selected, id(3), '补充单元测试', 'C:/fixtures/alpha', 300, ['补测试']));
    index.push(codex(selected, id(4), '调整图表配色', 'C:/fixtures/alpha', 1500, ['配色']));
    index.push(codex(selected, id(5), '修复窗口缩放', 'C:/fixtures/alpha', 3000, ['缩放']));
    index.push(codex(selected, id(6), '第六个 alpha 项目的会话', 'C:/fixtures/alpha', 4500, ['六']));
    index.push(codex(selected, id(7), '第七个 alpha 项目的会话', 'C:/fixtures/alpha', 6000, ['七']));
    index.push(codex(selected, id(8), '制作示例落地页', 'C:/fixtures/beta', 200, ['示例']));
    index.push(codex(selected, id(9), '翻译帮助文档', 'C:/fixtures/gamma', 900, ['翻译']));
    index.push(codex(selected, id(10), '合并两个配置文件', 'C:/fixtures/delta', 1000, ['缩放']));
    index.push(codex(selected, id(11), '给设置页加搜索', 'C:/fixtures/delta', 1100, ['搜索']));
    const claudeId = id(12), claudeDir = path.join(selected.claude[0], 'C--fixtures-token');
    const claudeRow = (type, content, at) => ({ type, timestamp: ago(at), sessionId: claudeId, cwd: 'C:/fixtures/alpha', message: { role: type, content, ...(type === 'assistant' ? { id: 'm' + at, model: 'claude-opus-5-5', usage: { input_tokens: 800, output_tokens: 300 } } : {}) } });
    write(path.join(claudeDir, claudeId + '.jsonl'), lines([claudeRow('user', '另一个 Agent 的问题', 80), claudeRow('assistant', [{ type: 'text', text: 'Claude 的回复。' }], 79)]));
    write(path.join(path.dirname(selected.codex[0]), 'session_index.jsonl'), index.join('\n') + '\n');
    const store = new Store(usageDir, selected); store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' }); store.setEnabled(false);

    const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usageDir, '--quota-data-dir', quotaDir, '--m1-fixture-root', home], timeout: 60000 });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForURL(/^file:/, { timeout: 30000 }); await keepVisible(app); await isolatePointer(app);
    const contrast = async (selector, label) => {
      const found = await page.locator(selector).evaluateAll(all => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const paint = canvas.getContext('2d', { willReadFrequently: true });
        const parse = color => { paint.clearRect(0, 0, 1, 1); paint.fillStyle = color; paint.fillRect(0, 0, 1, 1); const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
        const over = (top, under) => top.slice(0, 3).map((value, at) => value * top[3] + under[at] * (1 - top[3])).concat(1);
        const ground = element => { const chain = []; for (let node = element; node; node = node.parentElement) { const color = parse(getComputedStyle(node).backgroundColor); if (color[3] > 0) { chain.push(color); if (color[3] === 1) break; } } return chain.reduceRight((under, top) => over(top, under), [255, 255, 255, 1]); };
        const light = color => { const [r, g, b] = color.slice(0, 3).map(value => { const part = value / 255; return part <= .03928 ? part / 12.92 : ((part + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; };
        return all.filter(element => element.getClientRects().length).map(element => { const back = ground(element), text = over(parse(getComputedStyle(element).color), back), [a, b] = [light(text), light(back)].sort((x, y) => y - x); return (a + .05) / (b + .05); });
      });
      assert(found.length, 'nothing measured for ' + label);
      const low = Math.min(...found); measured.push(label + ' ' + low.toFixed(2)); assert(low >= 4.5, label + ' contrast ' + low.toFixed(2));
    };
    const measured = [];
    const shot = async name => { await page.mouse.move(2, 500); await page.waitForTimeout(350); await page.screenshot({ path: path.join(output, name + '.png') }); };
    try {
      await page.waitForFunction(() => document.readyState === 'complete' && Boolean(window.agentUi), null, { timeout: 30000 });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 960)); await page.waitForTimeout(2500);
      await showView(page, 'sessions'); await until(page, () => window.sessionsUi?.loaded === true); await settle(page);
      await page.getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click(); await settle(page);
      await page.locator('[data-sessions-page]').getByRole('button', { name: '全部展开', exact: true }).click(); await settle(page);
      // Several records can open before the sidebar finishes folding. A retiring
      // column must leave a live portal target even when the latest mount exits.
      await page.evaluate(ids => { const host = window.sessionsHost, rows = host.get().list.sessions; ids.forEach((key, at) => { const row = rows.find(item => item.id === key); if (!row) throw Error('RAPID_READER_FIXTURE_MISSING'); if (!at) host.read(row); else host.readAlso(row); }); }, [id(1), id(2), id(3)]);
      await page.locator('[data-reader-panes="3"]').waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('[data-reader-page]')].filter(pane => pane.querySelector('[data-reader-turn]')).length === 3); await settle(page);
      await page.locator('[data-reader-outline] [data-outline-item]').first().waitFor({ timeout: 5000 });
      await page.evaluate(() => window.sessionsHost.read(null)); await until(page, () => !document.querySelector('[data-reader-page]')); await settle(page);
      await page.getByRole('button', { name: /^整理发布说明与验收清单，/ }).click(); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);

      // The way to another conversation is the left column, not a button over the page.
      assert.equal(await page.getByRole('button', { name: '打开其他会话' }).count(), 0, 'no button of its own');
      const tabs = page.locator('[data-reader-nav-tabs]');
      assert.deepEqual(await tabs.getByRole('tab').allInnerTexts(), ['目录', '会话']);
      assert.equal(await page.locator('[data-reader-nav]').getAttribute('data-tab'), 'outline');
      assert(await page.locator('[data-reader-outline] [data-outline-item]').count() >= 2, 'the outline is the first tab');

      // Sessions as folders of projects, the current one lit.
      await tabs.getByRole('tab', { name: '会话' }).click(); await page.locator('[data-reader-sessions]').waitFor(); await settle(page);
      const heads = await page.locator('[data-nav-group-head]').allInnerTexts();
      assert.match(heads[0], /alpha/); assert.match(heads[0], /8/, 'a project says how many it holds');
      assert.equal(await page.locator('[data-nav-session][data-selected]').count(), 1, 'one current');
      assert.match(await page.locator('[data-nav-session][data-selected]').innerText(), /整理发布说明与验收清单/);
      const first = page.locator('[data-nav-group]').first();
      assert.equal(await first.locator('[data-nav-session]').count(), 5, 'the first few');
      assert.match(await first.locator('[data-nav-more]').innerText(), /展开显示 3 个/);
      assert.equal(await page.locator('[data-nav-session] img').count() >= 5, true, 'each with its Agent\'s logo');
      assert.match(await page.locator('[data-nav-session][data-selected] [data-nav-meta]').innerText(), /18\.\dK/, 'what it used');
      assert.equal(await page.locator('[data-nav-session][data-selected] img').getAttribute('alt'), 'Codex');
      await contrast('[data-nav-session] [data-nav-time]', 'light session time'); await contrast('[data-nav-session] [data-nav-meta]', 'light session figures'); await contrast('[data-nav-group-head]', 'light project');
      await shot('nav-sessions');
      // The keyboard reaches a row's one menu: tabbing from the row shows it.
      await first.locator('[data-nav-open]').nth(1).focus(); await page.keyboard.press('Tab');
      assert.match(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), /的操作$/, 'the menu takes the focus');
      assert(await first.locator('[data-nav-session]').nth(1).locator('[data-nav-menu] button').isVisible(), 'and it shows');
      await page.evaluate(() => document.activeElement?.blur()); await settle(page);
      await first.locator('[data-nav-more]').click(); await settle(page);
      assert.equal(await first.locator('[data-nav-session]').count(), 8, 'the rest');
      await first.locator('[data-nav-more]').click(); await settle(page);
      // A folder folds; the search finds through all of them.
      const last = page.locator('[data-nav-group]').last(); const before = await last.locator('[data-nav-session]').count();
      await last.locator('[data-nav-group-head]').click(); await settle(page); assert.equal(await last.locator('[data-nav-session]').count(), before ? 0 : 1, 'folds');
      await last.locator('[data-nav-group-head]').click(); await settle(page);
      await page.locator('[data-reader-sessions] input').fill('示例落地页'); await settle(page);
      assert.equal(await page.locator('[data-nav-session]').count(), 1); await page.locator('[data-reader-sessions] input').fill(''); await settle(page);
      // Pointing at a row shows its actions and a card with what the row leaves out.
      const row = first.locator('[data-nav-session]').nth(1); await row.hover(); await page.waitForTimeout(250);
      assert.equal(await row.locator('[data-nav-menu] button').count(), 1, 'one button, not a row of them');
      const nameWidth = await row.locator('[data-nav-open] .font-medium').evaluate(element => element.getBoundingClientRect().width), rowWidth = await row.evaluate(element => element.getBoundingClientRect().width);
      assert(nameWidth > rowWidth - 88, 'the name keeps its room: ' + nameWidth + ' of ' + rowWidth);
      assert.match(await page.locator('[role="tooltip"]').first().innerText(), /Token/);
      await page.screenshot({ path: path.join(output, 'nav-hover.png') });
      await row.locator('[data-nav-menu] button').click();
      assert.deepEqual(await page.getByRole('menuitem').allInnerTexts(), ['置顶', '并排打开'], 'pin and side by side, and nothing else');
      await page.keyboard.press('Escape'); await page.mouse.move(2, 500); await settle(page);
      assert.equal(await page.locator('[data-reader-panes="2"]').count(), 0, 'the menu starts nothing by itself');
      // The filter folds out: by time, or one Agent.
      await page.locator('[data-nav-filter-toggle] button').click(); await page.locator('[data-nav-filters]').waitFor(); await settle(page);
      await page.locator('[data-nav-filters]').getByRole('tab', { name: '按时间' }).click(); await settle(page);
      assert.equal(await page.locator('[data-nav-group]').first().getAttribute('data-group-kind'), 'time');
      await shot('nav-filters');
      await page.locator('[data-nav-filters]').getByRole('tab', { name: '按项目' }).click(); await settle(page);
      await page.locator('[data-nav-filters] [data-agent="claude"]').click(); await settle(page);
      assert.equal(await page.locator('[data-nav-session]').count(), 1, 'only Claude'); await page.locator('[data-nav-filters] [data-agent="all"]').click(); await page.locator('[data-nav-filter-toggle] button').click(); await settle(page);
      // A click reads it here and the column stays on the sessions.
      await page.locator('[data-nav-session]', { hasText: '补充单元测试' }).locator('[data-nav-open]').click();
      await until(page, () => /补充单元测试/.test(document.querySelector('[data-reader-title]')?.textContent ?? ''));
      assert.equal(await page.locator('[data-reader-page]').count(), 1); assert(await page.locator('[data-reader-sessions]').isVisible(), 'the column stays');
      // Back with the keyboard: O opens the sessions and the search takes the keys.
      await page.locator('[data-nav-session]', { hasText: '整理发布说明与验收清单' }).locator('[data-nav-open]').click();
      await until(page, () => /整理发布说明/.test(document.querySelector('[data-reader-title]')?.textContent ?? '')); await page.locator('[data-reader-turn]').first().waitFor(); await settle(page);
      await tabs.getByRole('tab', { name: '目录' }).click(); await settle(page); await page.locator('[data-reader-scroll]').click({ position: { x: 4, y: 4 } });
      await page.keyboard.press('o'); await page.locator('[data-reader-sessions]').waitFor(); await settle(page);
      assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-reader-sessions]') !== null && document.activeElement?.tagName === 'INPUT'), true, 'the search has the keys');
      await page.keyboard.press('Escape'); await settle(page);
      assert.equal(await page.locator('[data-reader-page]').count(), 1, 'Escape leaves the search, not the page');

      // The right column.
      await page.locator('[data-reader-side-toggle] button').click(); await page.locator('[data-reader-side]').waitFor(); await settle(page);
      const sideTab = async name => { await page.locator('[data-reader-side-tabs]').getByRole('tab', { name }).click(); await page.waitForTimeout(250); };
      const fits = () => page.locator('[data-reader-side]').evaluate(e => e.scrollWidth <= e.clientWidth + 1);
      await sideTab(/^文件/);
      assert.match(await page.locator('[data-files-workspace]').innerText(), /alpha/);
      assert.match(await page.locator('[data-files-all]').innerText(), /所有更改/);
      assert.equal(await page.locator('[data-reader-side-list="files"] [data-outline-item]').count(), 7, 'every changed file');
      assert.equal(await page.locator('[data-file-dir="/design/desktop-reference"]').count(), 1, 'a folder holding only one folder reads as one line');
      assert.equal(await page.locator('[data-file-kind="add"]').count(), 3); assert.equal(await page.locator('[data-file-kind="delete"]').count(), 1); assert.equal(await page.locator('[data-file-kind="edit"]').count(), 3);
      assert.equal(await page.locator('[data-file-status]').count(), 0, 'the name\'s colour says it; the room goes to the name'); assert.equal(await page.locator('[data-reader-side-list="files"] [data-file-mark]').count(), 7, 'each with what kind of file it is');
      assert.deepEqual(await page.locator('[data-file-name]').evaluateAll(names => names.filter(name => name.scrollWidth > name.clientWidth + 1).map(name => name.textContent)), [], 'every name in full');
      await contrast('[data-file-kind="add"] .ff-count-add', 'light new file'); await contrast('[data-file-kind="delete"] .ff-count-del', 'light deleted file');
      assert.equal(await fits(), true, 'the tree fits'); await shot('side-files');
      await page.locator('[data-files-layout] button').click(); await settle(page);
      assert.equal(await page.locator('[data-file-dir]').count(), 0, 'flat: no folders'); assert.equal(await page.locator('[data-file-folder]').count() > 0, true, 'each says where it is'); await shot('side-files-flat');
      await page.locator('[data-files-layout] button').click(); await settle(page);
      await page.locator('[data-reader-side-list="files"] input').fill('sample.css'); await settle(page);
      assert.equal(await page.locator('[data-reader-side-list="files"] [data-outline-item]').count(), 1, 'the filter'); await page.locator('[data-reader-side-list="files"] input').fill(''); await settle(page);
      await page.locator('[data-reader-side-list="files"] [data-outline-item]', { hasText: 'transcript.js' }).click(); await page.locator('[data-reader-file]').waitFor(); await page.locator('[data-file-chosen]').waitFor(); await settle(page);
      assert.match(await page.locator('[data-reader-file]').innerText(), /transcript\.js/); await shot('side-files-chosen');
      await contrast('.ff-side-row[data-selected] .ff-side-tail, .ff-side-row[data-selected] .ff-count-add, .ff-side-row[data-selected] .ff-count-del', 'light figures on a selected file');
      await page.locator('[data-files-all]').click(); await until(page, () => !document.querySelector('[data-reader-file]')); await settle(page);
      await sideTab(/^命令/);
      assert.equal(await page.locator('[data-reader-side-list="commands"] [data-outline-item]').count(), 4); assert.equal(await page.locator('[data-command-failed]').count(), 2);
      assert.match(await page.locator('[data-commands-failed]').innerText(), /2 失败/); assert.equal(await page.locator('[data-reader-side-list="commands"] [data-side-turn]').count(), 2, 'turn by turn');
      assert.equal(await fits(), true, 'the commands fit'); await shot('side-commands');
      await page.locator('[data-reader-side-list="commands"] [data-side-turn]').first().click(); await settle(page);
      assert.equal(await page.locator('[data-reader-side-list="commands"] [data-outline-item]').count(), 2, 'a turn folds');
      await sideTab(/^失败/);
      assert.equal(await page.locator('[data-reader-side-list="failures"] [data-outline-item]').count(), 2);
      assert.match(await page.locator('[data-failure-said]').first().innerText(), /2 tests failed/, 'what the failure said');
      await contrast('[data-failure-said]', 'light failure text');
      assert.equal(await fits(), true, 'the failures fit'); await shot('side-failures');
      await sideTab(/^对比/); await page.locator('[data-compare-suggested]').waitFor(); await settle(page); await shot('side-compare-empty');
      await page.locator('[data-compare-suggested] button').first().click(); await page.locator('[data-compare-head]').waitFor();
      await until(page, () => [...document.querySelectorAll('[data-compare-row="turns"] [role="cell"]')].every(cell => /\d/.test(cell.textContent)));
      assert.equal(await page.locator('[data-compare-column]').count(), 2); assert.equal(await page.locator('[data-compare-row="tokens"] [data-compare-amount]').count(), 2);
      assert.match(await page.locator('[data-compare-row="tokens"] [data-compare-amount]').first().locator('[data-compare-who]').innerText(), /1/, 'two sessions of one Agent stay apart');
      assert.equal(await fits(), true, 'the comparison fits'); await settle(page); await shot('side-compare');

      // Side by side from the row's action. The columns are the window's: they push the panes and never lie over them.
      await page.locator('[data-reader-nav-tabs]').getByRole('tab', { name: '会话' }).click(); await settle(page);
      const beside = page.locator('[data-nav-session]', { hasText: '制作示例' }); await beside.hover(); await beside.locator('[data-nav-menu] button').click(); await page.getByRole('menuitem', { name: '并排打开' }).click(); await page.locator('[data-reader-panes="2"]').waitFor(); await page.locator('[data-reader-page]').nth(1).locator('[data-reader-turn]').first().waitFor(); await settle(page);
      assert.equal(await page.locator('[data-reader-nav]').count(), 1, 'one left column'); assert.equal(await page.locator('[data-reader-side]').count(), 1, 'one right column');
      assert.equal(await page.locator('[data-nav-elsewhere]').count(), 1, 'the other pane is marked');
      const boxes = selector => page.locator(selector).evaluateAll(all => all.map(item => { const box = item.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height }; }));
      const clear = async () => { const panes = await boxes('[data-reader-page]'), [nav] = await boxes('[data-reader-nav]'), [side] = await boxes('[data-reader-side]'); for (const pane of panes) { assert(pane.width >= 320, 'a pane stays readable ' + pane.width); if (nav) assert(nav.right <= pane.left + 1, 'the left column covers no pane'); if (side) assert(side.left >= pane.right - 1, 'the right column covers no pane'); } return panes; };
      await clear(); await page.waitForTimeout(400); await shot('split-both');
      // The head is one line, the same height in both, and it fits.
      for (const head of await boxes('[data-reader-header]')) assert(head.height <= 45, 'one line ' + head.height);
      for (const row of await page.locator('[data-reader-header-row]').evaluateAll(rows => rows.map(item => [item.scrollWidth, item.clientWidth]))) assert(row[0] <= row[1] + 1, 'a head fits ' + row);
      await page.locator('[data-reader-side-toggle] button').click(); await until(page, () => !document.querySelector('[data-reader-side]')); await settle(page); await clear(); await shot('split-nav');
      await page.locator('[data-reader-nav-toggle] button').click(); await until(page, () => !document.querySelector('[data-reader-nav]')); await settle(page); await shot('split');
      await page.locator('[data-reader-nav-toggle] button').click(); await page.locator('[data-reader-nav]').waitFor(); await settle(page);

      // Holding a head lifts the pane; a short press does nothing, and the region shows where it would land.
      const title = n => page.locator('[data-reader-page]').nth(n).locator('[data-reader-title]');
      const centre = async locator => { const box = await locator.boundingBox(); return { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 }; };
      const lift = async locator => { const at = await centre(locator); await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.waitForTimeout(340); return at; };
      const panesLeft = async () => (await boxes('[data-reader-page]')).map(pane => Math.round(pane.left));
      const start = await centre(title(0)); await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up(); await page.waitForTimeout(250);
      assert.equal(await page.locator('[data-lifted]').count(), 0, 'a short press lifts nothing');
      const order = await panesLeft(); assert(order[0] < order[1], 'in the order they opened');
      await lift(title(0)); assert.equal(await page.locator('[data-lifted]').count(), 1, 'holding lifts it');
      assert.notEqual(await page.locator('[data-lifted] [data-pane-inner]').evaluate(e => getComputedStyle(e).filter), 'none', 'frosted while held');
      const other = (await boxes('[data-pane-cell]'))[1];
      await page.mouse.move(other.left + other.width - 30, other.top + other.height / 2, { steps: 6 }); await page.locator('[data-pane-zone="right"]').waitFor();
      assert.match(await page.locator('[data-pane-zone-label]').innerText(), /放到右边/);
      assert.equal(await page.locator('[data-pane-hole]').count(), 1, 'where it came from stays a hole'); await page.waitForTimeout(350); await page.screenshot({ path: path.join(output, 'drag-pane.png') });
      // Escape puts it back and leaves every pane open.
      await page.keyboard.press('Escape'); await until(page, () => !document.querySelector('[data-lifted]')); await page.mouse.up(); await page.waitForTimeout(800);
      assert.equal(await page.locator('[data-reader-panes="2"]').count(), 1, 'Escape closes nothing'); assert.deepEqual(await panesLeft(), order, 'and moves nothing');
      // A pane keeps its place in the conversation through a move.
      await page.locator('[data-reader-page]').nth(0).locator('[data-reader-scroll]').evaluate(e => { e.scrollTop = 400; }); await page.waitForTimeout(120);
      const scrolled = await page.locator('[data-reader-page]').nth(0).locator('[data-reader-scroll]').evaluate(e => e.scrollTop);
      await lift(title(0)); await page.mouse.move(other.left + other.width - 30, other.top + other.height / 2, { steps: 6 }); await page.locator('[data-pane-zone="right"]').waitFor(); await page.mouse.up(); await settle(page); await page.waitForTimeout(700);
      assert.equal(await page.locator('[data-lifted]').count(), 0); assert.equal(await page.locator('[data-pane-hole]').count(), 0, 'landed');
      const moved = await panesLeft(); assert(moved[0] > moved[1], 'the first pane now sits on the right ' + moved);
      assert.equal(await page.locator('[data-reader-page]').nth(0).locator('[data-reader-scroll]').evaluate(e => e.scrollTop), scrolled, 'its scroll position survives');
      assert.equal(await page.locator('[data-reader-page]').nth(0).locator('[data-pane-inner]').count(), 0); await clear();
      // A row can be held too: its pane's shape, frosted, and nothing is read until it lands.
      const reads = () => page.evaluate(() => document.querySelectorAll('[data-reader-page]').length);
      const heldRow = page.locator('[data-nav-session]', { hasText: '补充单元测试' }); await lift(heldRow); await page.locator('[data-pane-ghost]').waitFor();
      assert.equal(await reads(), 2, 'no pane until it lands');
      const left = (await boxes('[data-pane-cell]')).sort((x, y) => x.left - y.left)[0];
      await page.mouse.move(left.left + left.width / 2, left.top + left.height - 30, { steps: 6 }); await page.locator('[data-pane-zone="bottom"]').waitFor(); await page.waitForTimeout(350); await page.screenshot({ path: path.join(output, 'drag-session.png') });
      await page.mouse.up(); await page.locator('[data-reader-panes="3"]').waitFor(); await page.locator('[data-reader-page]').nth(2).locator('[data-reader-turn]').first().waitFor(); await settle(page); await page.waitForTimeout(500);
      assert.equal(await page.locator('[data-pane-ghost]').count(), 0, 'the ghost has gone');
      assert.equal(await page.locator('[data-pane-rows="2"]').count(), 1, 'one column now holds two'); assert.equal(await page.locator('[data-reader-columns="2"]').count(), 1);
      assert.equal(await page.locator('[data-reader-page]').nth(2).getAttribute('data-focused'), 'true', 'the new one is in use');
      assert.match(await title(2).innerText(), /补充单元测试/); await shot('split-stacked');
      // At three, a row only opens in a pane's place.
      const spare = page.locator('[data-nav-session]', { hasText: '调整图表配色' }); await lift(spare); const cells = await boxes('[data-pane-cell]');
      await page.mouse.move(cells[0].left + cells[0].width - 20, cells[0].top + cells[0].height / 2, { steps: 6 }); await page.locator('[data-pane-zone="center"]').waitFor();
      assert.match(await page.locator('[data-pane-zone-label]').innerText(), /在这一栏打开/); await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page); await page.waitForTimeout(400);
      assert.equal(await page.locator('[data-pane-ghost]').count(), 0); assert.equal(await page.locator('[data-reader-panes="3"]').count(), 1);
      // The same moves from the keyboard, behind the menu.
      await page.locator('[data-reader-page]').nth(2).locator('[data-reader-more] button').click(); await page.getByRole('menuitem', { name: '单独成一栏' }).click(); await settle(page); await page.waitForTimeout(600);
      assert.equal(await page.locator('[data-reader-columns="3"]').count(), 1, 'out on its own'); await clear();
      // Exiting overlay and incoming dock briefly coexist. The retiring mount
      // must not clear the live portal target after its replacement attaches.
      await page.locator('[data-reader-nav-tabs]').getByRole('tab', { name: '目录' }).click(); await settle(page);
      const beforeResize = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 900)); await page.waitForTimeout(700); await settle(page);
      await page.locator('[data-reader-outline] [data-outline-item]').first().waitFor();
      await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), beforeResize); await page.waitForTimeout(700); await settle(page);
      await page.locator('[data-reader-outline] [data-outline-item]').first().waitFor({ timeout: 5000 });
      assert.equal(await page.locator('[data-reader-outline]').count(), 1, 'one live outline after overlay-to-dock handover');
      await page.locator('[data-reader-nav-tabs]').getByRole('tab', { name: '会话' }).click(); await settle(page);
      await page.locator('[data-reader-side-toggle] button').click(); await page.locator('[data-reader-side]').waitFor(); await settle(page);
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 900)); await page.waitForTimeout(700); await settle(page);
      await page.locator('[data-reader-side]').waitFor({ timeout: 5000 });
      await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), beforeResize); await page.waitForTimeout(700); await settle(page);
      await page.locator('[data-reader-side]').waitFor({ timeout: 5000 });
      assert.equal(await page.locator('[data-reader-side]').count(), 1, 'one live right column after overlay-to-dock handover');
      await page.locator('[data-reader-side-toggle] button').click(); await until(page, () => !document.querySelector('[data-reader-side]')); await settle(page);
      await page.locator('[data-reader-page]').nth(2).locator('[data-reader-close-pane] button').click(); await page.locator('[data-reader-panes="2"]').waitFor(); await settle(page);
      await page.locator('[data-reader-page]').nth(1).locator('[data-reader-close-pane] button').click(); await page.locator('[data-reader-panes="1"]').waitFor(); await settle(page);
      await page.locator('[data-reader-side-toggle] button').click(); await page.locator('[data-reader-side]').waitFor(); await settle(page);

      // Dark.
      await page.evaluate(() => { document.body.classList.add('dark'); }); await settle(page);
      await page.locator('[data-reader-side-tabs]').getByRole('tab', { name: /^文件/ }).click(); await page.waitForTimeout(300); await shot('dark-files');
      await contrast('[data-file-kind="add"] .ff-count-add', 'dark new file'); await contrast('[data-file-kind="delete"] .ff-count-del', 'dark deleted file'); await contrast('[data-reader-side-list="files"] [data-diff-count] span', 'dark line counts');
      await contrast('[data-nav-session] [data-nav-time]', 'dark session time'); await contrast('[data-nav-session] [data-nav-meta]', 'dark session figures');
      await page.locator('[data-reader-side-tabs]').getByRole('tab', { name: /^失败/ }).click(); await page.waitForTimeout(300); await contrast('[data-failure-said]', 'dark failure text');
      // Dark, side by side and mid-drag: the quieter names and controls still read, and the region still shows.
      await page.locator('[data-reader-nav-tabs]').getByRole('tab', { name: '会话' }).click(); await settle(page);
      const darkBeside = page.locator('[data-nav-session]', { hasText: '制作示例' }); await darkBeside.hover(); await darkBeside.locator('[data-nav-menu] button').click(); await page.getByRole('menuitem', { name: '并排打开' }).click(); await page.locator('[data-reader-panes="2"]').waitFor(); await page.locator('[data-reader-page]').nth(1).locator('[data-reader-turn]').first().waitFor(); await settle(page);
      await contrast('[data-reader-page][data-focused="false"] [data-reader-title]', 'dark name of the pane not in use'); await contrast('[data-reader-views] button', 'dark view menu'); await shot('dark-split');
      const darkCell = (await boxes('[data-pane-cell]'))[1]; await lift(title(0)); await page.mouse.move(darkCell.left + darkCell.width - 30, darkCell.top + darkCell.height / 2, { steps: 6 }); await page.locator('[data-pane-zone="right"]').waitFor(); await page.waitForTimeout(350);
      await contrast('[data-pane-zone-label]', 'dark region label'); await page.screenshot({ path: path.join(output, 'dark-drag-pane.png') });
      await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(800);
      await page.locator('[data-reader-page]').nth(1).locator('[data-reader-close-pane] button').click(); await page.locator('[data-reader-panes="1"]').waitFor(); await settle(page);
      console.log(measured.join(' | '));
      await page.evaluate(() => { document.body.classList.remove('dark'); localStorage.clear(); });
      assert.deepEqual(errors, [], 'no page errors');
      console.log('PASS: reading page columns: outline and sessions, folders of projects, open here and beside, file tree, commands, failures, comparison; panes placed by holding.');
    } finally { await app.close(); }
  } finally { await cleanup(root); }
})().catch(error => { console.error(error); process.exitCode = 1; });
