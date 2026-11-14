'use strict';
/* global document */
// The settings page's GitHub account and sync, the application-update flow and the experimental route switch
// (owner 2026-11-04, docs/m2/GITHUB-AND-UPDATE-20261104.md and docs/m2/AUTO-UPDATE-20261108.md). The real connection is
// not here: a fake transport and a fake updater run in the main process, so nothing reaches GitHub, downloads a file or
// installs anything. Synthetic home and isolated stores only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch, setTheme } = require('./ui-smoke');
const { showView, settle, until } = require('./ui-settle');
const output = process.env.ACCOUNT_EVIDENCE_DIR || 'artifacts/ui-account';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  process.env.AGENT_USAGE_GITHUB_APP_SLUG = 'quotadock-fixture';
  const session = await launch({ size: [1480, 960] }), { app, page, errors } = session;
  const section = async name => { await showView(page, 'settings'); await page.evaluate(value => window.settingsUi.openSection(value), name); await settle(page); };
  try {
    // Without the real connection the page says so and offers nothing it cannot do.
    await section('account');
    const connection = page.locator('[data-github-connection]');
    await until(page, () => Boolean(document.querySelector('[data-github-connection="none"]')));
    assert.match(await connection.innerText(), /还没有配置 GitHub 连接/);
    assert.equal(await connection.getByRole('button', { name: '连接 GitHub' }).isDisabled(), true);
    assert.equal(await page.locator('[data-github-sync]').getByRole('switch').isDisabled(), true);
    // What would leave this machine is stated before anything is connected, inside a disclosure the person opens.
    await page.getByRole('button', { name: '会同步什么' }).click();
    await until(page, () => Boolean(document.querySelector('[data-github-sync-scope]')));
    assert.match(await page.locator('[data-github-sync-scope]').evaluate(element => element.textContent), /不会同步：对话内容、路径、会话 ID、项目名/);
    await page.screenshot({ path: path.join(output, 'not-configured.png') });

    // A source run has no update feed of its own: the page says so rather than offering a check that cannot work.
    await section('about');
    assert.match(await page.locator('[data-about-version]').innerText(), /预览版，未签名/);
    await until(page, () => document.querySelector('[data-about-update]')?.dataset.aboutUpdate === 'unconfigured');
    assert.equal(await page.locator('[data-about-update]').getByRole('button', { name: '检查更新' }).isDisabled(), true);
    assert.match(await page.locator('[data-about-update]').innerText(), /不含自动更新/);

    // The fake GitHub: authorized when the suite says so, records what it was sent.
    await app.evaluate(({ shell, BrowserWindow }) => {
      const fake = { authorize: false, puts: [], opened: [], repositories: [] };
      shell.openExternal = async url => { fake.opened.push(url); };
      globalThis.githubFixtureTransport = {
        startDevice: async () => ({ deviceCode: 'dc', userCode: 'DEMO-CODE', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 1 }),
        pollDevice: async () => fake.authorize ? { status: 'authorized', token: 'demo-secret-token' } : { status: 'pending' },
        user: async () => ({ login: 'demo-user', name: '示例用户', avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==' }),
        privateRepositories: async () => fake.repositories.map(fullName => ({ fullName })),
        put: async (token, repository, file, text) => { fake.puts.push({ token, repository, file, text }); return { committedAt: 'x' }; },
      };
      globalThis.githubFake = fake;
      BrowserWindow.getAllWindows()[0].webContents.send('github:update');
    });
    await section('account');
    await until(page, () => document.querySelector('[data-github-connection]')?.hasAttribute('data-configured'));

    await connection.getByRole('button', { name: '连接 GitHub' }).click();
    await page.locator('[data-github-code]').waitFor();
    assert.equal(await page.locator('[data-github-code]').innerText(), 'DEMO-CODE');
    await page.screenshot({ path: path.join(output, 'waiting-for-code.png') });
    await connection.getByRole('button', { name: '打开 GitHub' }).click();
    await until(page, () => true);
    assert.deepEqual(await app.evaluate(() => globalThis.githubFake.opened), ['https://github.com/login/device']);
    assert.equal(await page.evaluate(() => window.githubBridge.open('https://evil.example/login/device')), false, 'nothing else opens');

    await app.evaluate(() => { globalThis.githubFake.authorize = true; });
    await until(page, () => Boolean(document.querySelector('[data-github-connection="connected"]')), 15000);
    assert.match(await connection.innerText(), /示例用户[\s\S]*@demo-user/);
    assert.equal(await page.locator('#profileName').innerText(), '示例用户', 'the sidebar is the connected person');
    assert.equal(await page.locator('#profileAvatar img').count(), 1);
    assert(!JSON.stringify(await page.evaluate(() => window.githubBridge.get())).includes('demo-secret-token'), 'the window never sees the token');

    // Open authorization for an empty list, then configure the single granted repository on return.
    const syncPanel = page.locator('[data-github-sync]');
    await syncPanel.getByRole('button', { name: '一键配置同步' }).click();
    await syncPanel.getByText('等待仓库授权', { exact: true }).waitFor();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll('[data-github-sync] button')].find(button => button.textContent === '检查授权');
      return button && !button.disabled;
    });
    assert.deepEqual(await app.evaluate(() => globalThis.githubFake.opened), ['https://github.com/login/device', 'https://github.com/apps/quotadock-fixture/installations/new']);
    await page.screenshot({ path: path.join(output, 'waiting-for-repository.png') });
    await app.evaluate(() => { globalThis.githubFake.repositories = ['demo-user/usage-data']; });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await until(page, () => document.querySelector('[data-github-sync] [role=switch]')?.getAttribute('aria-checked') === 'true');
    assert.match(await syncPanel.getByRole('combobox').innerText(), /demo-user\/usage-data/);
    assert.equal(await app.evaluate(() => globalThis.githubFake.puts.length), 0);
    // Only the explicit Sync button writes the selected daily totals.
    await page.locator('[data-github-sync]').getByRole('button', { name: '同步', exact: true }).click();
    await until(page, () => /最近同步/.test(document.querySelector('[data-github-sync]')?.textContent ?? ''), 20000);
    const sent = await app.evaluate(() => globalThis.githubFake.puts[0]);
    assert.equal(sent.repository, 'demo-user/usage-data'); assert.match(sent.file, /^agent-usage\/[a-f0-9-]{36}\.json$/);
    const body = JSON.parse(sent.text);
    assert(body.days.length > 0, 'the seeded days went');
    assert.deepEqual(Object.keys(body.days[0]).sort(), ['agent', 'cacheRead', 'cacheWrite', 'date', 'estimatedCostUpperUsd', 'estimatedCostUsd', 'inputUncached', 'model', 'output', 'reasoning', 'records', 'totalTokens'].sort());
    for (const secret of ['synthetic-workspace', '实验项目', 'style-session', 'sessionKey', 'cwd']) assert(!sent.text.includes(secret), secret + ' stays home');
    await page.screenshot({ path: path.join(output, 'connected-light.png') });
    await setTheme(page, 'dark'); await settle(page); await page.screenshot({ path: path.join(output, 'connected-dark.png') }); await setTheme(page, 'light');
    await syncPanel.getByRole('switch').click();
    await app.evaluate(() => { globalThis.githubFake.repositories.push('demo-user/other'); });
    await syncPanel.getByRole('button', { name: '一键配置同步' }).click();
    await syncPanel.getByText('选择同步仓库', { exact: true }).waitFor();
    assert.equal(await syncPanel.getByRole('switch').getAttribute('aria-checked'), 'false');
    await syncPanel.getByRole('combobox').click();
    await page.getByRole('option', { name: 'demo-user/other', exact: true }).click();
    await until(page, () => document.querySelector('[data-github-sync] [role=switch]')?.getAttribute('aria-checked') === 'true');
    assert.match(await syncPanel.getByRole('combobox').innerText(), /demo-user\/other/);
    assert.equal(await app.evaluate(() => globalThis.githubFake.puts.length), 1);

    // Leaving: back to the local person, sync off, token forgotten.
    await section('account');
    await connection.getByRole('button', { name: '断开' }).click();
    await until(page, () => Boolean(document.querySelector('[data-github-connection="none"]')));
    assert.notEqual(await page.locator('#profileName').innerText(), '示例用户');
    assert.equal(await page.locator('[data-github-sync]').getByRole('switch').getAttribute('aria-checked'), 'false');

    // Experimental routes: when off, a provider with only those says so and points to the switch; turning it on offers them.
    await section('quota');
    const experimental = page.locator('[data-quota-experimental]').getByRole('switch');
    if (await experimental.getAttribute('aria-checked') === 'true') await experimental.click();
    await until(page, () => document.querySelector('[data-quota-experimental]')?.dataset.quotaExperimental === 'off'); await settle(page);
    await page.screenshot({ path: path.join(output, 'experimental-off.png') });
    const refused = await page.evaluate(() => window.quotaBridge.providerConnect({ adapter: 'mimo-web', alias: 'demo', credential: 'demo', consent: true, remember: false }));
    assert.equal(refused.ok, false); assert.equal(refused.errorCode ?? refused.code ?? 'PROVIDER_EXPERIMENTAL_OFF', 'PROVIDER_EXPERIMENTAL_OFF');
    await showView(page, 'quota'); await settle(page);
    const capabilities = (await page.evaluate(() => window.quotaBridge.providers())).state;
    assert.equal(capabilities.experimentalEnabled, false);
    assert(capabilities.capabilities.find(row => row.provider === 'mimo').adapters.every(route => route.experimental && /试验/.test(route.name)));
    assert(capabilities.capabilities.find(row => row.provider === 'deepseek').adapters.some(route => route.id === 'deepseek-api' && !route.experimental), 'an official API stays offered');

    // A packaged build would find a new version here. The fake updater stands in for electron-updater so the whole flow —
    // checking, a background download, then a restart the person asks for — runs without a publisher or a real installer.
    // This comes last on purpose: a restart really does stop the app's own work before the installer starts, and the fake
    // updater never quits, so no step after it may expect the services to still answer.
    await app.evaluate(({ BrowserWindow }) => {
      const listeners = new Map();
      const updater = {
        autoDownload: true, autoInstallOnAppQuit: true, allowPrerelease: false, calls: [], installed: null,
        on(name, listener) { listeners.set(name, [...(listeners.get(name) ?? []), listener]); },
        off(name, listener) { listeners.set(name, (listeners.get(name) ?? []).filter(item => item !== listener)); },
        emit(name, value) { for (const listener of listeners.get(name) ?? []) listener(value); },
        async checkForUpdates() {
          this.calls.push('check');
          const info = { version: '9.0.0-preview.1', releaseDate: '2026-11-08T00:00:00.000Z' };
          this.emit('update-available', info);
          return { isUpdateAvailable: true, updateInfo: info };
        },
        downloadUpdate() { this.calls.push('download'); return new Promise(resolve => { this.finish = resolve; }); },
        quitAndInstall(isSilent, isForceRunAfter) {
          this.calls.push('install');
          if (!this.failedOnce) { this.failedOnce = true; this.emit('error', new Error('synthetic installer failure')); return; }
          this.installed = { isSilent, isForceRunAfter };
        },
      };
      globalThis.updateFixtureUpdater = updater;
      BrowserWindow.getAllWindows()[0].webContents.send('update:state');
    });

    await section('about');
    await until(page, () => document.querySelector('[data-about-update]')?.dataset.aboutUpdate === 'idle');
    await page.locator('[data-about-update]').getByRole('button', { name: '检查更新' }).click();
    await until(page, () => document.querySelector('[data-about-update]')?.dataset.aboutUpdate === 'downloading');
    assert.match(await page.locator('[data-about-update]').innerText(), /正在下载/);
    assert.equal(await page.locator('[data-about-update]').getByRole('button', { name: '取消下载' }).isDisabled(), false);

    // Progress while the person keeps reading, then the restart offer; nothing restarts by itself.
    await app.evaluate(() => { globalThis.updateFixtureUpdater.emit('download-progress', { percent: 100, transferred: 2400000, total: 2400000, bytesPerSecond: 800000 }); globalThis.updateFixtureUpdater.emit('update-downloaded', { version: '9.0.0-preview.1', releaseDate: '2026-11-08T00:00:00.000Z' }); });
    await until(page, () => document.querySelector('[data-about-update]')?.dataset.aboutUpdate === 'downloaded');
    assert.match(await page.locator('[data-about-update]').innerText(), /重启后安装/);
    await page.screenshot({ path: path.join(output, 'update-ready.png') });
    assert.equal((await app.evaluate(() => globalThis.updateFixtureUpdater.calls)).join(','), 'check,download', 'the download started on its own, and nothing installed yet');
    await page.locator('[data-about-update]').getByRole('button', { name: '重启并更新' }).click();
    await until(page, () => document.querySelector('[data-about-update]')?.textContent.includes('无法启动安装程序'));
    assert.equal(await app.evaluate(() => Boolean(globalThis.updateFixtureUpdater.installed)), false, 'the failed launch did not install anything');
    assert.equal(await page.locator('[data-about-update]').getAttribute('data-about-update'), 'downloaded');
    assert.equal(await page.locator('[data-about-update]').getByRole('button', { name: '重启并更新' }).isEnabled(), true);
    // A fresh state notification clears the action reply. The underlying failure
    // must remain visible, and the update service must still accept a retry.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('update:state'));
    await settle(page);
    assert.match(await page.locator('[data-about-update]').innerText(), /无法启动安装程序/);
    await page.screenshot({ path: path.join(output, 'update-install-failed.png') });
    await page.locator('[data-about-update]').getByRole('button', { name: '重启并更新' }).click();
    // The restart is deliberately two steps: this app stops its own work first and the installer starts only after that
    // finishes, so the installer's call arrives one turn later than the click. The fake updater lives in the main process,
    // so it is polled from there rather than from the page.
    const installed = async () => app.evaluate(() => globalThis.updateFixtureUpdater.installed);
    for (let attempt = 0; attempt < 300 && !(await installed()); attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(await installed(), { isSilent: true, isForceRunAfter: true }, 'a silent install that starts the new version again');
    await app.evaluate(() => { globalThis.updateFixtureUpdater.finish([]); });

    assert.deepEqual(errors, [], 'no console or page errors');
    console.log('PASS account and update');
  } finally { await session.close(); }
})().catch(error => { console.error(error); process.exit(1); });
