'use strict';
/* global document */
// The local Agent admin (owner 2026-11-03, docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md): nothing read until asked, each
// item says if it is healthy and what to do, a change is a preview first and can be restored, no secret reaches the page.
// Synthetic fixture home and isolated stores only; the directory picker is answered by the test.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { keepVisible, showView, settle, until, cleanup } = require('./ui-settle');
const output = process.env.AGENT_ADMIN_EVIDENCE_DIR || 'artifacts/ui-agent-admin';
const SECRET = 'sentinel-secret-value-123';
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
function seed(home, project) {
  write(path.join(home, 'bin/node.exe'), '');
  write(path.join(home, '.codex/config.toml'), '[mcp_servers.fine]\ncommand = "node"\n\n[mcp_servers.missing-tool]\ncommand = "not-installed-tool"\n\n[mcp_servers.leaky]\ncommand = "node"\nenv = { API_TOKEN = "' + SECRET + '" }\n');
  write(path.join(home, '.codex/auth.json'), JSON.stringify({ token: SECRET }));
  write(path.join(home, '.agents/skills/good/SKILL.md'), '---\nname: good\ndescription: 能用的 Skill\n---\n');
  write(path.join(home, '.agents/skills/broken/SKILL.md'), '没有前言');
  write(path.join(home, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node stop.js' }] }] } }));
  write(path.join(home, '.claude/CLAUDE.md'), '# 原来的指令');
  write(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { hidden: { command: SECRET } } }));
  write(path.join(home, '.claude/plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'kept@market': [{ scope: 'user', installPath: path.join(home, '.claude/plugins/cache/market/kept/1.0.0'), version: '1.0.0' }], 'gone@market': [{ scope: 'user', installPath: path.join(home, '.claude/plugins/cache/market/gone/1.0.0') }] } }));
  write(path.join(home, '.claude/plugins/cache/market/kept/1.0.0/.claude-plugin/plugin.json'), JSON.stringify({ name: 'kept', version: '1.0.0', description: '好插件' }));
  write(path.join(home, '.gemini/settings.json'), JSON.stringify({ mcpServers: { fine: { command: 'node' } } }));
  write(path.join(project, '.mcp.json'), JSON.stringify({ mcpServers: { 'project-server': { command: 'node' } } }));
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ui-agent-admin-'))), home = path.join(root, 'home'), project = path.join(root, 'work', 'my-app'); seed(home, project);
  const launch = () => electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', path.join(root, 'usage'), '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home, '--force-device-scale-factor=1'], timeout: 60000 }), errors = [];
  let app = await launch();
  try {
    await keepVisible(app); let page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 960));
    const openTab = async current => { await showView(current, 'sources'); await current.getByRole('tablist', { name: 'Agent 管理分类', exact: true }).getByRole('tab', { name: /MCP/ }).click(); await current.locator('[data-agent-admin]').waitFor(); };
    await openTab(page); await settle(page);

    // Nothing is read until the person asks.
    assert.match(await page.locator('[data-agent-start]').innerText(), /只读取配置，不运行任何东西/);
    assert.equal(await page.locator('[data-agent-row]').count(), 0);
    await page.screenshot({ path: path.join(output, 'empty.png') });

    // A project chosen once is remembered.
    await app.evaluate(({ dialog }, value) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] }); }, project);
    await page.getByRole('button', { name: '添加项目', exact: true }).click(); await page.locator('[data-agent-projects]').filter({ hasText: 'my-app' }).waitFor();

    await page.getByRole('button', { name: '检查本机配置', exact: true }).click(); await page.locator('[data-agent-row]').first().waitFor(); await settle(page);
    const row = name => page.locator('[data-agent-row="' + name + '"]');

    // The same server across Agents, with what is wrong first.
    const agentTabs = page.getByRole('tablist', { name: '按 Agent 看', exact: true });
    assert.deepEqual((await agentTabs.getByRole('tab').allInnerTexts()).map(text => text.trim().split('\n')[0]), ['全部 Agent', 'Codex', 'Claude Code', 'Gemini CLI'], 'only the Agents found');
    assert.equal(await row('fine').locator('[data-agent-marks]').getAttribute('data-agent-marks'), 'codex gemini');
    assert.deepEqual((await page.locator('[data-agent-row]').evaluateAll(rows => rows.slice(0, 2).map(entry => entry.dataset.agentRow))).sort(), ['leaky', 'missing-tool'], 'what needs a look comes first');
    assert.match(await page.locator('[data-agent-summary]').innerText(), /2[\s\S]*项要看/);
    assert.match(await row('missing-tool').innerText(), /需要注意[\s\S]*找不到命令[\s\S]*先安装它/, 'the problem and what to do, on the row');
    assert.equal(await page.locator('[data-agent-note]').filter({ hasText: '没有读取' }).count(), 1, 'it says what it did not read');

    // A row opens in place, with where it lives: names and counts, what is wrong and what to do; never a value.
    await row('leaky').locator('[data-agent-item]').click(); const detail = page.locator('[data-agent-row="leaky"] [data-agent-detail]'); await detail.waitFor(); await settle(page);
    assert.match(await detail.innerText(), /API_TOKEN 写了明文值[\s\S]*改成引用系统环境变量/);
    assert.equal(await page.getByRole('dialog').count(), 0, 'no sheet to read it in');
    assert.match(await detail.locator('[data-agent-file]').innerText(), /^~\/\.codex\/config\.toml$/);
    await page.screenshot({ path: path.join(output, 'detail.png') });
    // Finding the file: the app is told an id, and only a text file opens.
    await app.evaluate(({ shell }) => { global.located = []; shell.showItemInFolder = file => global.located.push(['reveal', file]); shell.openPath = async file => { global.located.push(['open', file]); return ''; }; });
    await detail.locator('[data-agent-reveal] button').click(); await detail.locator('[data-agent-open] button').click();
    await until(page, () => true);
    assert.deepEqual(await app.evaluate(() => global.located), [['reveal', path.join(home, '.codex/config.toml')], ['open', path.join(home, '.codex/config.toml')]]);
    assert.deepEqual(await page.evaluate(async () => (await window.usageBridge.agents('locate', { id: 'C:/Windows/system32/calc.exe', action: 'open' })).error), 'INVENTORY_ITEM_UNKNOWN', 'a path is not an id');
    await row('leaky').locator('[data-agent-item]').click(); await settle(page);
    assert.equal(await page.locator('[data-agent-row="leaky"] [data-agent-detail]').count(), 0, 'and it folds back');

    // Off is a preview first; nothing is written until 应用; 恢复记录 puts it back.
    const config = path.join(home, '.codex/config.toml'), before = fs.readFileSync(config);
    await row('fine').locator('[data-agent-item]').click(); const fineDetail = page.locator('[data-agent-row="fine"] [data-agent-detail]'); await fineDetail.waitFor(); await settle(page);
    await fineDetail.locator('[data-agent-occurrence="codex"]').getByRole('switch').click();
    const preview = page.locator('[data-agent-preview]'); await preview.waitFor();
    assert.match(await preview.innerText(), /停用[\s\S]*可以从“恢复记录”恢复/);
    assert.deepEqual(fs.readFileSync(config), before, 'a preview writes nothing');
    await page.waitForTimeout(300); await page.screenshot({ path: path.join(output, 'preview.png') });
    await preview.getByRole('button', { name: '应用', exact: true }).click();
    await until(page, () => document.querySelector('[data-agent-row="fine"] [data-agent-occurrence="codex"]')?.textContent.includes('已停用'));
    assert.notDeepEqual(fs.readFileSync(config), before);
    const kinds = page.getByRole('tablist', { name: 'Agent 管理分类', exact: true });
    await kinds.getByRole('tab', { name: /恢复记录/ }).click(); await page.locator('[data-agent-history]').waitFor();
    assert.match(await page.locator('[data-agent-history]').innerText(), /停用此 MCP/);

    // Survives a restart: the project and the record are still there, and nothing is read until asked again.
    await app.close(); app = await launch(); await keepVisible(app); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 960));
    await page.waitForFunction(() => document.readyState === 'complete' && Boolean(window.agentUi)); await openTab(page); await settle(page);
    await page.locator('[data-agent-projects]').filter({ hasText: 'my-app' }).waitFor();
    assert.equal(await page.locator('[data-agent-row]').count(), 0, 'no scan on its own after a restart');
    await page.getByRole('button', { name: '检查本机配置', exact: true }).click(); await page.locator('[data-agent-row]').first().waitFor();
    await page.getByRole('tablist', { name: 'Agent 管理分类', exact: true }).getByRole('tab', { name: /恢复记录/ }).click(); await page.locator('[data-agent-history]').waitFor();
    await page.locator('[data-agent-history]').getByRole('button', { name: '恢复到改之前' }).click();
    await until(page, () => /文件之后又改过/.test(document.querySelector('[data-agent-history]')?.textContent ?? ''));
    assert.deepEqual(fs.readFileSync(config), before, 'restored after a restart');

    // Skills, plugins, the other lists.
    const tabs = page.getByRole('tablist', { name: 'Agent 管理分类', exact: true }), rowOf = name => page.locator('[data-agent-row="' + name + '"]');
    await tabs.getByRole('tab', { name: /Skills/ }).click(); await settle(page);
    assert.equal(await rowOf('broken').locator('[data-agent-health]').innerText(), '有问题');
    assert.equal(await page.locator('[data-agent-row]').first().getAttribute('data-agent-row'), 'broken', 'what is wrong comes first');
    // One click: what it will do first, a preview that moves nothing, then the change, then one step back.
    const skillDir = path.join(home, '.agents/skills/broken');
    await page.locator('[data-agent-repair-entry]').getByRole('button', { name: '一键处理', exact: true }).click(); const repair = page.locator('[data-agent-repair]'); await repair.waitFor(); await page.locator('[data-repair-row="broken"]').waitFor(); await settle(page);
    assert.equal(await page.locator('[data-repair-row="broken"]').getByRole('checkbox').getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('[data-repair-row="missing-tool"]').getByRole('checkbox').getAttribute('aria-checked'), 'false', 'the Agent may see another PATH: offered, not chosen');
    assert.match(await page.locator('[data-repair-manual]').innerText(), /leaky[\s\S]*明文值[\s\S]*改成引用系统环境变量/, 'what it cannot do says what to do');
    assert(fs.existsSync(skillDir), 'the list moves nothing');
    await page.screenshot({ path: path.join(output, 'repair.png') });
    await page.getByRole('dialog').getByRole('button', { name: '应用', exact: true }).click(); await page.locator('[data-agent-repair-undo]').waitFor(); await settle(page);
    assert(!fs.existsSync(skillDir)); assert(fs.existsSync(path.join(home, '.agent-usage/disabled-skills/codex/broken/SKILL.md')), 'moved, not deleted');
    assert.equal(await rowOf('broken').getAttribute('data-off'), 'true', 'listed as stopped');
    await page.locator('[data-agent-repair-undo]').getByRole('button', { name: '撤销', exact: true }).click(); await until(page, () => !document.querySelector('[data-agent-repair-undo]')); await settle(page);
    assert(fs.existsSync(path.join(skillDir, 'SKILL.md')), 'and back');
    await tabs.getByRole('tab', { name: /插件/ }).click(); await settle(page);
    assert.equal(await rowOf('gone@market').locator('[data-agent-health]').innerText(), '有问题');
    await rowOf('gone@market').locator('[data-agent-item]').click(); await page.locator('[data-agent-detail]').waitFor(); assert.match(await page.locator('[data-agent-detail]').innerText(), /插件文件不见了[\s\S]*重新安装/);

    // An instruction file: read when opened, edited through a preview.
    await tabs.getByRole('tab', { name: /指令文件/ }).click(); await settle(page);
    await rowOf('CLAUDE.md').locator('[data-agent-item]').click(); const open = page.locator('[data-agent-row="CLAUDE.md"] [data-agent-detail]'); await open.waitFor();
    await open.getByRole('button', { name: '查看和编辑' }).click(); const area = page.locator('[data-agent-instruction] textarea'); await area.waitFor();
    assert.equal(await area.inputValue(), '# 原来的指令');
    await area.fill('# 改过的指令'); await page.getByRole('button', { name: '预览修改' }).click(); await page.locator('[data-agent-preview]').waitFor();
    assert.equal(fs.readFileSync(path.join(home, '.claude/CLAUDE.md'), 'utf8'), '# 原来的指令');
    await page.locator('[data-agent-preview]').getByRole('button', { name: '应用', exact: true }).click();
    await until(page, () => !document.querySelector('[data-agent-preview]'));
    assert.equal(fs.readFileSync(path.join(home, '.claude/CLAUDE.md'), 'utf8'), '# 改过的指令');
    await settle(page);

    // One Agent at a time, and a search.
    await tabs.getByRole('tab', { name: /MCP/ }).click(); await settle(page);
    const byAgent = page.getByRole('tablist', { name: '按 Agent 看', exact: true });
    await byAgent.getByRole('tab', { name: 'Claude Code', exact: true }).click(); await settle(page);
    assert.equal(await rowOf('project-server').count(), 1); assert.equal(await rowOf('leaky').count(), 0);
    await byAgent.getByRole('tab', { name: '全部 Agent', exact: true }).click(); await settle(page);
    await page.getByRole('textbox', { name: '搜索配置项', exact: true }).fill('leak'); await settle(page);
    assert.equal(await page.locator('[data-agent-row]').count(), 1);
    await page.getByRole('textbox', { name: '搜索配置项', exact: true }).fill('config.toml'); await settle(page);
    assert((await page.locator('[data-agent-row]').count()) >= 2, 'a path finds it too');
    await page.getByRole('textbox', { name: '搜索配置项', exact: true }).fill('明文'); await settle(page);
    assert.equal(await page.locator('[data-agent-row]').first().getAttribute('data-agent-row'), 'leaky', 'and the words of a problem');
    await page.getByRole('textbox', { name: '搜索配置项', exact: true }).fill(''); await settle(page);

    // No secret, no authentication file, anywhere in what the page got.
    const page_text = await page.evaluate(async () => JSON.stringify(await window.usageBridge.agents('state')));
    assert(!page_text.includes(SECRET)); assert(!page_text.includes('auth.json')); assert(!page_text.includes('hidden'));
    assert(!(await page.locator('body').innerText()).includes(SECRET));
    await rowOf('leaky').locator('[data-agent-item]').click(); await settle(page);
    await page.evaluate(() => window.settingsHost.theme.set('dark')); await settle(page); await page.screenshot({ path: path.join(output, 'admin-dark.png') });
    await page.evaluate(() => window.settingsHost.theme.set('light')); await settle(page); await page.screenshot({ path: path.join(output, 'admin-light.png') });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no sideways scroll');
    assert.deepEqual(errors, []);
    console.log('PASS agent admin');
  } finally { await app.close(); await cleanup(root); }
})().catch(error => { console.error(error); process.exitCode = 1; });
