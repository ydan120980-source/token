'use strict';

const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
app.setPath('userData', root);
app.whenReady().then(() => {
  const id = '11111111-2222-4333-8444-555555555555';
  const folder = path.join(root, 'provider-quotas', 'website-secrets');
  fs.mkdirSync(folder, { recursive: true });
  if (!safeStorage.isEncryptionAvailable()) throw Error('SYNTHETIC_ENCRYPTION_UNAVAILABLE');
  const plaintext = JSON.stringify({ schemaVersion: 'ProviderSecretV2', id,
    adapter: 'deepseek-api', credential: 'synthetic-fixture-key', expiresAt: null, context: null });
  fs.writeFileSync(path.join(folder, id + '.bin'), safeStorage.encryptString(plaintext));
  const website = '22222222-2222-4333-8444-555555555555';
  fs.writeFileSync(path.join(folder, website + '.bin'), safeStorage.encryptString(JSON.stringify({
    schemaVersion: 'ProviderWebsiteSecretV1', id: website, adapter: 'claude-web',
    credential: 'sessionKey=synthetic-fixture-key', expiresAt: null,
  })));
  fs.writeFileSync(path.join(root, 'provider-quotas', 'connections.json'), JSON.stringify({
    schemaVersion: 'ProviderQuotaCacheV1', connections: [
      { id, adapter: 'deepseek-api', alias: 'Synthetic', quota: null },
      { id: website, adapter: 'claude-web', alias: 'Legacy website', quota: null },
    ],
  }));
  app.quit();
}).catch(() => app.exit(1));
