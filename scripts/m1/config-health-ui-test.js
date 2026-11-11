'use strict';
/* global document */
// Browser plugin not available: use the existing native Electron/Playwright flow.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store } = require('../../src/m1/store'), { roots } = require('../../src/m1/policy');
const { showView, settle, until, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const {pickSelect}=require('./settings-ui-helpers');
const output = process.env.CONFIG_UI_EVIDENCE || path.join(os.tmpdir(), 'config-center-ui-evidence-' + process.pid);
(async () => {
  fs.mkdirSync(output, { recursive: true });
  for (const scale of [1, 1.5]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-center-ui-')), home = path.join(root, 'home'), usage = path.join(root, 'usage'), quota = path.join(root, 'quota');
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true }); fs.mkdirSync(path.join(home, '.claude'));
    const config = path.join(home, '.codex/config.toml'), contents = '[features]\nhooks=false\n[mcp_servers.PRIVATE_SENTINEL]\ncommand="PRIVATE_COMMAND"\nargs=[7]\n';
    fs.writeFileSync(config, contents); fs.writeFileSync(path.join(home, '.claude/settings.json'), '{"hooks":{"SessionStart":[{"hooks":[{"type":"http","url":"https://private.invalid"}]}]}}');
    new Store(usage, roots(home)).setEnabled(false); const ledger = fs.readFileSync(path.join(usage, 'statistics.json'));
    let app;
    try {
      app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout: 60000 });
      const page = await app.firstWindow(); await keepVisible(app); await isolatePointer(app); const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
      await showView(page, 'sources'); await page.setViewportSize({ width: scale === 1 ? 1320 : 1000, height: 900 });
      // The directory-by-directory check sits folded under the Agent configuration tab (owner 2026-11-03).
      await page.getByRole('tablist', { name: 'Agent 管理分类', exact: true }).getByRole('tab', { name: /MCP/ }).click();
      await page.locator('[data-agent-admin]').getByRole('button', { name: '按目录逐项检查和编辑' }).click(); await page.locator('[data-config-center]').waitFor();
      if (scale === 1.5) await page.evaluate(() => document.body.classList.add('dark'));
      assert.match(page.url(), /^file:/); assert.match(await page.title(), /Agent Usage/);
      assert.match(await page.locator('[data-config-center]').innerText(), /尚未选择/); assert(await page.locator('[data-source-config-action="configCheck"] button').isDisabled());
      await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, home);
      await page.locator('[data-source-config-action="configChoose"] button').click(); await until(page, () => !document.querySelector('[data-source-config-action="configChoose"] button').disabled);
      assert.match(await page.locator('[data-config-selection]').innerText(), /已选择/); assert.match(await page.locator('[data-config-summary]').innerText(), /尚无/);
      await page.locator('[data-source-config-action="configCheck"] button').click(); await until(page, () => !document.querySelector('[data-source-config-action="configCheck"] button').disabled);
      assert.match(await page.locator('[data-config-summary]').innerText(), /发现问题/); await page.locator('[data-config-results] button[aria-expanded]').first().click(); await settle(page);
      assert.match(await page.locator('[data-config-results]').innerText(), /配置项 1/); assert(!((await page.locator('[data-config-center]').innerText()).includes('PRIVATE')));
      await page.locator('[data-config-center]').getByRole('tab',{name:'Hooks',exact:true}).click(); assert.match(await page.locator('[data-config-results]').innerText(), /codex/);
      await pickSelect(page.locator('[data-config-center]'),page,'配置检查 Agent','Claude Code'); assert.match(await page.locator('[data-config-selection]').innerText(), /尚未选择/);
      await page.locator('[data-source-config-action="configChoose"] button').click(); await until(page, () => !document.querySelector('[data-source-config-action="configChoose"] button').disabled);
      await page.locator('[data-source-config-action="configCheck"] button').click(); await until(page, () => !document.querySelector('[data-source-config-action="configCheck"] button').disabled);
      assert.match(await page.locator('[data-config-summary]').innerText(), /发现问题/);
      await pickSelect(page.locator('[data-config-center]'),page,'配置检查 Agent','Cursor'); assert.match(await page.locator('[data-config-selection]').innerText(), /尚未适配/); assert(await page.locator('[data-source-config-action="configCheck"] button').isDisabled());
      await pickSelect(page.locator('[data-config-center]'),page,'配置检查 Agent','Codex'); await pickSelect(page.locator('[data-config-center]'),page,'配置范围','项目级'); assert.match(await page.locator('[data-config-selection]').innerText(), /尚未选择/);
      await page.locator('[data-source-config-action="configChoose"] button').click(); await until(page, () => !document.querySelector('[data-source-config-action="configChoose"] button').disabled);
      await page.locator('[data-source-config-action="configCheck"] button').click(); await until(page, () => !document.querySelector('[data-source-config-action="configCheck"] button').disabled); assert(!((await page.locator('[data-config-summary]').innerText()).includes('尚无')));
      await pickSelect(page.locator('[data-config-center]'),page,'配置范围','用户级'); assert.match(await page.locator('[data-config-selection]').innerText(), /已选择/);
      await page.locator('[data-config-center]').scrollIntoViewIfNeeded(); await settle(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
      await page.screenshot({ path: path.join(output, 'config-center-' + scale + '.png') });
      // Management is separately invoked and operates on synthetic selected roots.
      await page.locator('[data-source-config-action="configManage"] button').click(); await until(page, () => !window.sourcesHost.manager().busy);
      await page.locator('[data-source-config-global="true"] button').click(); await until(page, () => !document.querySelector('[data-source-manager-action="apply"] button').disabled);
      assert.equal(fs.readFileSync(config,'utf8'), contents, 'preview cannot write');
      await page.locator('[data-source-manager-action="apply"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已应用'));
      assert.equal(require('../../src/m1/config-health-syntax').toml(fs.readFileSync(config,'utf8')).features.hooks,true);
      await page.locator('[data-source-manager-action="undo"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已撤销')); assert.equal(fs.readFileSync(config,'utf8'),contents);
      // A completed write carries authoritative redacted state. A later list
      // failure must not turn it into a failed write or hide encrypted undo.
      await app.evaluate(({ipcMain}) => {
        const manage = ipcMain._invokeHandlers.get('usage:config:manage'), state = ipcMain._invokeHandlers.get('usage:config:state'); let failList = false;
        globalThis.configWorkflowFixture = {stateReads:0,restore(){ipcMain.removeHandler('usage:config:manage');ipcMain.handle('usage:config:manage',manage);ipcMain.removeHandler('usage:config:state');ipcMain.handle('usage:config:state',state);}};
        ipcMain.removeHandler('usage:config:manage'); ipcMain.handle('usage:config:manage',async(event,action,...args) => {
          if(action === 'list' && failList){failList=false;return {error:'CONFIG_CHANGED'};}
          const result = await manage(event,action,...args); if(result.applied || result.restored) failList = true; return result;
        });
        ipcMain.removeHandler('usage:config:state'); ipcMain.handle('usage:config:state',() => {globalThis.configWorkflowFixture.stateReads++;return {error:'CONFIG_CHECK_FAILED'};});
      });
      await page.locator('[data-source-config-global="true"] button').click(); await until(page, () => !document.querySelector('[data-source-manager-action="apply"] button').disabled);
      await page.locator('[data-source-manager-action="apply"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.includes('配置列表未能重新读取'));
      assert.match(await page.locator('[data-manager-message]').innerText(),/^已应用/); assert(!(await page.locator('[data-source-manager-action="undo"] button').isDisabled())); assert(await page.locator('[data-source-manager-action="import"] button').isDisabled()); assert(await page.locator('[data-config-preview]').isHidden());
      assert.match(await page.locator('[data-source-managed-rows]').innerText(),/列表尚未读取/); assert(!((await page.locator('[data-source-managed-rows]').innerText()).includes('无法管理')));
      assert.equal(require('../../src/m1/config-health-syntax').toml(fs.readFileSync(config,'utf8')).features.hooks,true);
      await page.locator('[data-manager-message]').scrollIntoViewIfNeeded(); await settle(page); await page.screenshot({path:path.join(output,'config-applied-refresh-warning-' + scale + '.png')});
      await page.locator('[data-source-manager-action="undo"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已撤销'));
      assert.match(await page.locator('[data-manager-message]').innerText(),/配置列表未能重新读取/); assert(await page.locator('[data-source-manager-action="undo"] button').isDisabled()); assert.equal(fs.readFileSync(config,'utf8'),contents);
      assert.equal(await app.evaluate(() => globalThis.configWorkflowFixture.stateReads),0);
      await app.evaluate(() => {globalThis.configWorkflowFixture.restore();delete globalThis.configWorkflowFixture;});
      await page.locator('[data-source-manager-action="reload"] button').click(); await until(page, () => !window.sourcesHost.manager().busy);
      await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click(); await settle(page);
      await pickSelect(page.locator('[data-config-center]'),page,'配置范围','项目级'); assert.match(await page.locator('[data-config-summary]').innerText(),/尚无/); await pickSelect(page.locator('[data-config-center]'),page,'配置范围','用户级');
      const skill = path.join(root,'fixture-skill'), imported = path.join(root,'mcp.json'); fs.mkdirSync(skill); fs.writeFileSync(path.join(skill,'SKILL.md'),'---\nname: fixture-skill\ndescription: fixture\n---\nBODY_MUST_STAY\n'); fs.writeFileSync(path.join(skill,'fixture.js'),'throw Error("MUST_NOT_RUN")'); fs.writeFileSync(imported,'{"mcpServers":{"fixture-import":{"type":"stdio","command":"node","env":{"TOKEN":"SECRET_VALUE"}}}}');
      await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async (_window, options) => ({ canceled:false,filePaths:[options.title.includes('Skill') ? paths.skill : options.title.includes('本地配置文件') ? paths.imported : paths.home] }); }, {skill,imported,home});
      await page.locator('[data-config-center]').getByRole('tab',{name:'Skills',exact:true}).click(); await page.locator('[data-source-config-action="configManage"] button').click(); await until(page, () => !document.querySelector('[data-source-manager-action="import"] button').disabled);
      await page.locator('[data-source-manager-action="import"] button').click(); await until(page, () => !document.querySelector('[data-source-manager-action="apply"] button').disabled); assert(!fs.existsSync(path.join(home,'.agents/skills/fixture-skill')));
      await page.locator('[data-source-manager-action="apply"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已应用'));
      assert(fs.existsSync(path.join(home,'.agents/skills/fixture-skill/fixture.js')));
      await page.locator('[data-source-config-toggle] button').first().click(); await until(page, () => !document.querySelector('[data-source-manager-action="apply"] button').disabled); await page.locator('[data-source-manager-action="apply"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已应用'));
      assert(!fs.existsSync(path.join(home,'.agents/skills/fixture-skill')));
      await page.locator('[data-source-manager-action="undo"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已撤销'));
      await page.locator('[data-source-config-edit] button').first().click(); await page.locator('[data-source-config-field="description"] input').fill('UI fixture description'); await page.locator('[data-source-manager-action="preview"] button').click(); await until(page, () => !document.querySelector('[data-source-manager-action="apply"] button').disabled);
      assert.match(await page.locator('[data-config-edit-help]').innerText(),/正文/); assert(!((await page.locator('[data-config-edit-help]').innerText()).includes('MCP')));
      await page.setViewportSize({width:scale === 1 ? 1320 : 1000,height:680}); await page.locator('[data-sheet-body]').evaluate(element => {element.scrollTop=0;}); await settle(page);
      const visibleActions = await page.evaluate(() => {
        const button=document.querySelector('[data-source-manager-action="apply"] button').getBoundingClientRect(), footer=document.querySelector('[data-sheet-footer]').getBoundingClientRect(), body=document.querySelector('[data-sheet-body]').getBoundingClientRect();
        return button.top >= footer.top && button.bottom <= window.innerHeight && button.right <= window.innerWidth && body.bottom <= footer.top && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      }); assert(visibleActions,'apply remains visible outside the scrolling body in a short desktop viewport');
      await page.screenshot({path:path.join(output,'config-short-preview-' + scale + '.png')}); await page.setViewportSize({width:scale === 1 ? 1320 : 1000,height:900}); await settle(page);
      await page.screenshot({ path:path.join(output,'config-management-' + scale + '.png') });
      await page.locator('[data-source-manager-action="apply"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已应用'));
      assert.match(fs.readFileSync(path.join(home,'.agents/skills/fixture-skill/SKILL.md'),'utf8'), /BODY_MUST_STAY\n$/);
      await page.locator('[data-source-manager-action="undo"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已撤销')); await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click(); await settle(page);
      await pickSelect(page.locator('[data-config-center]'),page,'配置检查 Agent','Claude Code'); await pickSelect(page.locator('[data-config-center]'),page,'配置范围','项目级'); await page.locator('[data-config-center]').getByRole('tab',{name:'MCP',exact:true}).click();
      await page.locator('[data-source-config-action="configChoose"] button').click(); await until(page, () => !document.querySelector('[data-source-config-action="configChoose"] button').disabled); await page.locator('[data-source-config-action="configManage"] button').click(); await until(page, () => !document.querySelector('[data-source-manager-action="import"] button').disabled);
      await page.locator('[data-source-manager-action="import"] button').click(); await until(page, () => !document.querySelector('[data-source-manager-action="apply"] button').disabled); await page.locator('[data-source-manager-action="apply"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已应用'));
      assert.equal(JSON.parse(fs.readFileSync(path.join(home,'.mcp.json'))).mcpServers['fixture-import'].env.TOKEN,'SECRET_VALUE'); assert(!(await page.locator('[data-ui-portal] [role="dialog"]').innerText()).includes('SECRET_VALUE'));
      await page.locator('[data-source-config-edit] button').first().click(); await page.locator('[data-source-config-field="command"] input').fill('fixture-new'); await page.locator('[data-source-config-field="args"] input').fill('invalid JSON'); await page.locator('[data-source-manager-action="preview"] button').click(); await until(page, () => !window.sourcesHost.manager().busy); assert.match(await page.locator('[data-manager-message]').innerText(),/JSON 字符串列表/);
      assert.match(await page.locator('[data-config-edit-help]').innerText(),/切换连接方式/);
      await page.locator('[data-source-config-field="args"] input').fill('["--fixture"]'); await page.locator('[data-source-manager-action="preview"] button').click(); await until(page, () => !document.querySelector('[data-source-manager-action="apply"] button').disabled); await page.locator('[data-source-manager-action="apply"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已应用'));
      assert.equal(JSON.parse(fs.readFileSync(path.join(home,'.mcp.json'))).mcpServers['fixture-import'].command,'fixture-new');
      await page.locator('[data-source-manager-action="undo"] button').click(); await until(page, () => document.querySelector('[data-manager-message]').textContent.startsWith('已撤销')); await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click(); await settle(page);
      await page.locator('[data-source-config-action="configForget"] button').click(); await until(page, () => document.querySelector('[data-source-config-action="configCheck"] button').disabled);
      assert.match(await page.locator('[data-config-summary]').innerText(), /尚无/);
      assert.equal(fs.readFileSync(config, 'utf8'), contents); assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger); assert.deepEqual(errors, []);
      await app.close(); app = null;
      app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout:60000 });
      const restarted = await app.firstWindow(); await keepVisible(app); await isolatePointer(app); await showView(restarted,'sources'); await restarted.getByRole('tablist', { name: 'Agent 管理分类', exact: true }).getByRole('tab', { name: /MCP/ }).click(); await restarted.locator('[data-agent-admin]').getByRole('button', { name: '按目录逐项检查和编辑' }).click(); assert.match(await restarted.locator('[data-config-selection]').innerText(),/尚未选择/); assert(await restarted.locator('[data-source-config-action="configCheck"] button').isDisabled());
      await app.close(); app = null;
    } finally { if (app) await app.close(); await cleanup(root); }
  }
  console.log(JSON.stringify({ status: 'passed', scales: [1, 1.5], readonlyChecks:true,localManagement:true, realConfigurations: false, output }));
})().catch(error => { console.error(error); process.exitCode = 1; });
