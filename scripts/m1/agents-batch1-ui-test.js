'use strict';
/* global document, getComputedStyle */
// The seven usage-only sources Codex added (docs/m2/AGENT-BATCH1-CONTRACT-20261102.md), collected from a
// synthetic home through the real worker and shown on every page they reach. Nothing here is a real record.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { launch, setTheme } = require('./ui-smoke');
const { showView, settle, until } = require('./ui-settle');
const { batch1Fixtures, write, time } = require('../../tests/m1/batch1-fixtures');

const { roots } = require('../../src/m1/policy');
const output = process.env.AGENTS_BATCH1_EVIDENCE_DIR || 'artifacts/ui-agents-batch1';
const NEW = ['copilot', 'cline', 'pi', 'continue', 'kilo', 'qwen', 'kimi'];
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';

function otherFour(home) {
  const selected = roots(home), when = time.replace('T', ' ').slice(0, 19);
  fs.mkdirSync(path.dirname(selected.continue[0]), { recursive: true });
  const estimated = new DatabaseSync(selected.continue[0]);
  estimated.exec('CREATE TABLE tokens_generated(id INTEGER PRIMARY KEY,model TEXT,provider TEXT,tokens_prompt INTEGER,tokens_generated INTEGER,timestamp TEXT)');
  estimated.prepare('INSERT INTO tokens_generated VALUES(1,?,?,?,?,?)').run('gpt-4.1', 'openai', 100, 20, when); estimated.close();
  write(path.join(selected.kilo[0], 'demo-task', 'ui_messages.json'), [{ type: 'say', say: 'api_req_started', ts: Date.parse(time), modelInfo: { modelId: 'gpt-4.1', providerId: 'openai' }, text: JSON.stringify({ tokensIn: 100, tokensOut: 20, cacheReads: 40, cacheWrites: 10 }) }], true);
  write(path.join(selected.qwen[0], 'demo', 'chats', 'one.jsonl'), [{ type: 'assistant', sessionId: 'demo-qwen', timestamp: time, model: 'qwen3-coder-plus', usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, cachedContentTokenCount: 40, thoughtsTokenCount: 5, totalTokenCount: 120 } }]);
  write(path.join(selected.kimi[1], 'demo', 'demo-kimi', 'agents', 'main', 'wire.jsonl'), [{ type: 'usage.record', usageScope: 'turn', time: Date.parse(time), model: 'kimi-code/kimi-for-coding', usage: { inputOther: 60, output: 20, inputCacheRead: 40, inputCacheCreation: 10 } }]);
}

// A conversation each Agent can show, beside the usage rows above. All invented.
const reply = agent => '示例回答 ' + agent;
function conversations(home, fixture) {
  const selected = roots(home);
  fs.appendFileSync(fixture.cpFile, jsonl([{ type: 'user.message', timestamp: time, data: { content: '示例问题 copilot' } }, { type: 'assistant.message', timestamp: time, data: { messageId: 'm', content: reply('copilot') } }]));
  fs.appendFileSync(fixture.piFile, jsonl([{ type: 'message', id: 'pi-reply', parentId: 'pi-call', timestamp: time, message: { role: 'assistant', content: [{ type: 'text', text: reply('pi') }], timestamp: Date.parse(time) } }]));
  const anthropic = agent => JSON.stringify([{ role: 'user', ts: Date.parse(time), content: [{ type: 'text', text: '<task>\n示例问题 ' + agent + '\n</task>' }] }, { role: 'assistant', ts: Date.parse(time), content: [{ type: 'text', text: reply(agent) }] }]);
  fs.writeFileSync(path.join(path.dirname(fixture.clineFile), 'api_conversation_history.json'), anthropic('cline'));
  fs.writeFileSync(path.join(selected.kilo[0], 'demo-task', 'api_conversation_history.json'), anthropic('kilo'));
  fs.appendFileSync(path.join(selected.qwen[0], 'demo', 'chats', 'one.jsonl'), jsonl([{ type: 'assistant', sessionId: 'demo-qwen', timestamp: time, message: { role: 'model', parts: [{ text: reply('qwen') }] } }]));
  write(path.join(selected.kimi[0], 'demo', 'demo-kimi-cli', 'wire.jsonl'), [{ timestamp: Date.parse(time) / 1000, message: { type: 'TurnBegin', payload: { user_input: '示例问题 kimi' } } }, { timestamp: Date.parse(time) / 1000, message: { type: 'ContentPart', payload: { type: 'text', text: reply('kimi') } } }, { timestamp: Date.parse(time) / 1000, message: { type: 'StatusUpdate', payload: { message_id: 'k1', token_usage: { input_other: 5, output: 1, input_cache_read: 0, input_cache_creation: 0 } } } }]);
  const sessions = path.join(path.dirname(path.dirname(selected.continue[0])), 'sessions'); fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, 'sessions.json'), JSON.stringify([{ sessionId: 'demo-continue', title: '示例 Continue 会话', dateCreated: String(Date.parse(time)), workspaceDirectory: 'file:///C:/demo/gamma' }]));
  fs.writeFileSync(path.join(sessions, 'demo-continue.json'), JSON.stringify({ sessionId: 'demo-continue', title: '示例 Continue 会话', history: [{ message: { role: 'user', content: '示例问题 continue' }, contextItems: [] }, { message: { role: 'assistant', content: reply('continue') }, contextItems: [] }] }));
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const session = await launch({ size: [1480, 960], prepare: home => { const fixture = batch1Fixtures(home); otherFour(home); conversations(home, fixture); } }), { page, errors } = session;
  try {
    await showView(page, 'sources'); await until(page, () => document.querySelector('[data-sources-page]')?.dataset.ready === 'true');
    await until(page, () => ['copilot', 'cline', 'pi', 'continue', 'kilo', 'qwen', 'kimi'].every(agent => window.sourcesHost.get().statuses?.find(status => status.agent === agent)?.observedRecords > 0), 90000);
    await settle(page);

    for (const agent of NEW) {
      const card = page.locator('[data-source-agent="' + agent + '"]');
      assert.equal(await card.getByRole('switch').count(), 1, agent + ' can be turned off');
      assert.equal(await card.locator('img[src$="assets/agents/' + agent + '.svg"]').evaluate(image => image.naturalWidth > 0), true, agent + ' shows its own logo');
      assert.equal(await card.getByRole('button', { name: /^管理 / }).count(), 0, agent + ' has no setup, installer or login to manage');
      assert.doesNotMatch(await card.innerText(), /程序 |可升级|额度/, agent + ' shows no program or quota state');
    }
    // Continue only has client estimates: the card says so and does not read as a broken source.
    const estimated = await page.locator('[data-source-agent="continue"]').innerText();
    assert.match(estimated, /客户端估算/);
    assert.doesNotMatch(estimated, /读取失败|无法修复/);
    await page.screenshot({ path: path.join(output, 'sources-light.png') });

    // Every new Agent has its own identity colour in both themes, and no two are the same.
    const colours = () => page.evaluate(agents => {
      const probe = document.createElement('i'); document.querySelector('[data-ui-root]').append(probe);
      const read = name => { probe.className = name; return getComputedStyle(probe).backgroundColor; };
      const result = agents.map(agent => [read('bg-agent-' + agent), read('bg-series-' + agent)]); probe.remove(); return result;
    }, NEW);
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      const read = await colours();
      assert.equal(new Set(read.map(pair => pair[0])).size, NEW.length, theme + ' seven different colours');
      assert(read.every(pair => pair[0] === pair[1] && pair[0] !== 'rgba(0, 0, 0, 0)'), theme + ' agent and series agree: ' + JSON.stringify(read));
    }
    await page.screenshot({ path: path.join(output, 'sources-dark.png') });
    await setTheme(page, 'light');

    // No quota route yet: no card and no way to connect; the five with a card waiting say so. Nothing in the installer pretends otherwise.
    await showView(page, 'quota'); await settle(page);
    for (const agent of NEW) assert.equal(await page.locator('#quotaCards [data-provider-row="' + agent + '"]').count(), 0, agent + ' has no quota card');
    for (const agent of ['pi', 'continue']) assert.equal(await page.locator('[data-quota-idle-agent="' + agent + '"]').count(), 0, agent + ' has no account of its own');
    for (const agent of ['kimi', 'copilot', 'qwen', 'kilo', 'cline']) { const row = page.locator('[data-quota-idle-agent="' + agent + '"]'); assert.match(await row.innerText(), /读取待接入/); assert.equal(await row.locator('[data-provider-connect]').count(), 0); }
    await page.screenshot({ path: path.join(output, 'overview.png') });
    const installers = await page.evaluate(() => window.usageBridge?.installers?.());
    if (installers?.rows) for (const agent of NEW) assert(!installers.rows.some(row => row.agent === agent), agent + ' has no install plan');

    await showView(page, 'usage'); await settle(page);
    // The fixture's records are a few days old, so read the widest period.
    await page.locator('[data-usage-periods] button, [data-usage-periods] [role=radio]').first().click(); await settle(page);
    // Rows per Agent only exist for one day; over the whole period every new Agent is in the filter.
    for (const agent of NEW) await page.locator('[data-usage-page] [role=radio][data-agent="' + agent + '"]').first().waitFor({ timeout: 15000 });
    await page.locator('[data-usage-page] [role=radio][data-agent="kimi"]').first().click(); await settle(page);
    await page.screenshot({ path: path.join(output, 'usage.png') });

    await showView(page, 'cost'); await settle(page);
    await page.screenshot({ path: path.join(output, 'cost.png') });

    // Each can be read since the owner's 2026-11-04 decision; resuming stays out.
    await showView(page, 'sessions'); await settle(page);
    for (const agent of NEW) assert.equal(await page.evaluate(id => window.sessionsHost.readable(id), agent), true, agent + ' has a reader');
    // Everyone reads: the conversation on the reading page, not only a parser's result.
    await page.locator('[data-sessions-page]').getByRole('tablist', { name: '会话时间范围', exact: true }).getByRole('tab', { name: '全部', exact: true }).click(); await settle(page);
    for (const agent of NEW) {
      const opened = await page.evaluate(id => { const host = window.sessionsHost, list = host.list(), found = (list?.sessions ?? []).filter(row => row.agent === id).sort((a, b) => Number(b.id === 'demo-kimi-cli') - Number(a.id === 'demo-kimi-cli'))[0]; if (found) host.read(found); return found ? { key: found.key, id: found.id } : null; }, agent);
      assert(opened, agent + ' is in the session list');
      await page.getByText(reply(agent), { exact: false }).first().waitFor({ timeout: 15000 });
      if (agent === 'continue') await page.screenshot({ path: path.join(output, 'reader-continue.png') });
      await page.evaluate(() => window.sessionsHost.read(null)); await settle(page);
    }

    // Continue's row says its usage is unknown, never zero.
    const expand = page.locator('[data-sessions-page]').getByRole('button', { name: '全部展开', exact: true }); if (await expand.count()) { await expand.click(); await settle(page); }
    const row = page.locator('[data-session]').filter({ hasText: '示例 Continue 会话' }).first(); await row.waitFor({ timeout: 10000 });
    assert.match(await row.locator('[data-session-tokens]').first().innerText(), /未知/);
    assert.doesNotMatch(await row.locator('[data-session-tokens]').first().innerText(), /^0/);
    assert.doesNotMatch(await page.locator('[data-session-group]').filter({ hasText: 'gamma' }).locator('[data-fold-head]').innerText(), /0/, 'nor does its group read as zero');
    await page.screenshot({ path: path.join(output, 'sessions.png') });

    // The picker: with many Agents, those without records wait behind 更多, and the row scrolls by wheel and follows the choice.
    const picker = page.locator('[data-sessions-page] [data-agent-filter-tray]'), radios = picker.locator('[role=radio]'), more = picker.locator('[data-agent-more]');
    assert.equal(await radios.count(), 8, 'all plus the seven with records');
    assert.equal(await picker.evaluate(element => element.offsetHeight < 60), true, 'one row');
    assert.match(await more.getAttribute('aria-label'), /显示另外 10 个/);
    await more.click(); await settle(page);
    assert.equal(await radios.count(), 18, 'everyone on request');
    const scrolled = async () => picker.locator('.ff-agent-row').evaluate(element => ({ left: element.scrollLeft, over: element.scrollWidth > element.clientWidth }));
    const narrow = await page.evaluate(() => document.querySelector('[data-sessions-page]').clientWidth);
    await page.screenshot({ path: path.join(output, 'picker-open.png') });
    if ((await scrolled()).over) {
      const box = await picker.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 200); await settle(page);
      assert((await scrolled()).left > 0, 'the wheel moves the row, width ' + narrow);
    }
    await radios.last().click(); await settle(page);
    const lastBox = await radios.last().boundingBox(), trayBox = await picker.boundingBox();
    assert(lastBox.x + lastBox.width <= trayBox.x + trayBox.width + 1, 'the choice is in view');
    await picker.locator('[data-agent="codex"]').click(); await settle(page);
    await more.click(); await settle(page);
    assert.equal(await radios.count(), 9, 'the chosen one stays when the rest step aside');
    await picker.locator('[data-agent="all"]').click(); await settle(page);

    assert.deepEqual(errors, [], 'no console or page errors');
    console.log('AGENTS_BATCH1_UI_PASS');
  } finally { await session.close(); }
})().catch(error => { console.error(error); process.exit(1); });
