'use strict';
// Protocol/field compatibility adapted from XDTrees/dsh-xdpool 2def4d0 (MIT),
// including dingminhua/dsh-connect-workbuddy (Copyright 2026 LaoDing) at-rest
// framing and corrinehu/dsh-workbuddy-connect (Copyright 2026 Corrine Hu).
const fs = require('node:fs'), path = require('node:path');
const { createHash, createDecipheriv } = require('node:crypto');
const { readBounded } = require('./client-files');
const { fingerprint } = require('./executable-pin');
const { runWindowsJob } = require('./windows-job');
const safe = value => typeof value === 'string' && /^[\x21-\x7e]{1,16384}$/.test(value);
const domains = new Set(['', 'copilot.tencent.com', 'www.codebuddy.cn', 'codebuddy.cn', 'www.workbuddy.cn', 'workbuddy.cn']);
function desktopContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['uid', 'enterpriseId', 'domain'].includes(key)) || !safe(value.uid) || value.uid.length > 256 || typeof value.domain !== 'string' || !domains.has(value.domain) || value.enterpriseId !== undefined && (!safe(value.enterpriseId) || value.enterpriseId.length > 256)) return undefined;
  return { uid: value.uid, domain: value.domain, ...(value.enterpriseId ? { enterpriseId: value.enterpriseId } : {}) };
}
function decodeField(field, payload) {
  if (!field || field.$wbEncrypted !== 1 || typeof field.envelope !== 'string' || field.envelope.length > 65536 || typeof payload !== 'string' || payload.length > 65536) throw Error('PROVIDER_CLIENT_ENCRYPTED');
  try {
    const secret = JSON.parse(payload).atRestSecretKey, envelope = JSON.parse(Buffer.from(field.envelope, 'base64').toString('utf8'));
    if (!safe(secret) || !/^[a-f0-9]{16}$/.test(envelope.keyId) || !Number.isInteger(envelope.suite) || envelope.suite < 0 || envelope.suite > 255) throw Error();
    const key = createHash('sha256').update(secret, 'utf8').digest(); if (createHash('sha256').update(key).digest('hex').slice(0, 16) !== envelope.keyId) throw Error();
    const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; }, text = value => Buffer.concat([u32(Buffer.byteLength(value)), Buffer.from(value)]);
    const nonce = Buffer.from(envelope.nonce, 'base64'), tag = Buffer.from(envelope.authTag, 'base64'), ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    if (nonce.length !== 12 || tag.length !== 16 || !ciphertext.length || ciphertext.length > 16384) throw Error();
    const cipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
    cipher.setAAD(Buffer.concat([Buffer.from('WB-AAD\0'), Buffer.from([1]), text('WBEV1'), text('sym-v1'), u32(envelope.suite), text(envelope.keyId), Buffer.from([2, 0, 0])]));
    cipher.setAuthTag(tag); return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
  } catch { throw Error('PROVIDER_CLIENT_ENCRYPTED'); }
}
const VERIFIED_IMAGES = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$paths = @()
foreach($candidate in (ConvertFrom-Json -InputObject $env:AGENTUSAGE_IMAGES)) { if($candidate -is [string]) { $paths += $candidate } }
foreach($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
  if(Test-Path -LiteralPath $root) { Get-ChildItem -LiteralPath $root | Select-Object -First 512 | ForEach-Object {
    $row=Get-ItemProperty -LiteralPath $_.PSPath
    if($row.DisplayName -match '^WorkBuddy(?: AI)?(?:\s|$)') {
      if($row.InstallLocation){$paths += Join-Path $row.InstallLocation 'WorkBuddy.exe'}
      if($row.DisplayIcon){$paths += ($row.DisplayIcon -replace ',\d+$','').Trim('"')}
    }
  }}
}
$result=@()
foreach($image in @($paths | Select-Object -Unique | Select-Object -First 16)) {
  if(-not [IO.Path]::IsPathRooted($image) -or [IO.Path]::GetFileName($image) -ne 'WorkBuddy.exe' -or -not (Test-Path -LiteralPath $image -PathType Leaf)){continue}
  $file=Get-Item -LiteralPath $image
  if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){continue}
  $stream=$null
  try {
    $stream=[IO.File]::Open($image,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $sig=Get-AuthenticodeSignature -LiteralPath $image
    if($sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match 'Tencent' -and $file.VersionInfo.ProductName -match 'WorkBuddy|CodeBuddy'){$result += @{executable=$image;sha256=(Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant()}}
  } finally {if($stream){$stream.Dispose()}}
}
ConvertTo-Json -InputObject @($result) -Compress
`;
const KEY_SOURCE = "try{process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet())}catch{process.exitCode=3}";
function createWorkBuddyReader({ environment, job = runWindowsJob, discover = null, now = Date.now }) {
  const keyPayloads = new Map();
  const envFor = environment => Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]).concat(Object.entries({ USERPROFILE: environment.home, HOME: environment.home, APPDATA: environment.appData, LOCALAPPDATA: environment.localAppData })));
  async function payloads(signal) {
    const env = environment();
    if (!discover && env.platform !== 'win32') throw Error('PROVIDER_CLIENT_ENCRYPTED');
    let images;
    if (discover) images = await discover(signal);
    else {
      const candidates = [path.join(env.localAppData, 'Programs/WorkBuddy/WorkBuddy.exe'), path.join(env.localAppData, 'WorkBuddy/WorkBuddy.exe'), ...[env.programFiles, env.programFilesX86].filter(Boolean).map(root => path.join(root, 'WorkBuddy/WorkBuddy.exe'))];
      const result = await job(fingerprint(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', VERIFIED_IMAGES], { cwd: env.home, env: { ...envFor(env), AGENTUSAGE_IMAGES: JSON.stringify(candidates) }, timeoutMs: 30000, maxOutputBytes: 16384, signal });
      if (!result.reaped || result.errorCode || result.code !== 0 || result.timedOut || result.overflow || result.canceled) throw Error(signal.aborted ? 'PROVIDER_CANCELED' : 'PROVIDER_CLIENT_ENCRYPTED');
      try { images = JSON.parse(result.stdout); } catch { throw Error('PROVIDER_CLIENT_ENCRYPTED'); }
    }
    if (!Array.isArray(images) || images.length > 16) throw Error('PROVIDER_CLIENT_ENCRYPTED');
    for (const image of images) {
      if (signal.aborted) throw Error('PROVIDER_CANCELED');
      try {
        const pin = fingerprint(image.executable); if (pin.sha256 !== image.sha256) continue; if (keyPayloads.has(pin.sha256)) continue;
        const result = await job(pin, ['-e', KEY_SOURCE], { cwd: env.home, env: { ...envFor(env), ELECTRON_RUN_AS_NODE: '1' }, timeoutMs: 30000, maxOutputBytes: 65536, signal });
        if (result.reaped && !result.errorCode && result.code === 0 && !result.timedOut && !result.overflow && !result.canceled) { JSON.parse(result.stdout); keyPayloads.set(pin.sha256, result.stdout); }
      } catch { if (signal.aborted) throw Error('PROVIDER_CANCELED'); }
    }
  }
  async function read(signal) {
    if (signal.aborted) throw Error('PROVIDER_CANCELED'); const env = environment();
    const files = [...new Set([env.localAppData, env.appData].filter(Boolean).map(root => path.join(root, 'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info')))];
    const file = files.find(file => fs.existsSync(file)); if (!file) throw Error('PROVIDER_CLIENT_CREDENTIAL_MISSING');
    const document = readBounded(file); if (!document || typeof document.auth !== 'object' || !document.auth) throw Error('PROVIDER_CLIENT_CREDENTIAL_MISSING');
    const auth = document.auth, account = document.account || {};
    if (typeof auth.domain === 'string' && /workbuddy\.ai/.test(auth.domain)) throw Error('PROVIDER_CLIENT_REGION_UNSUPPORTED');
    const context = desktopContext({ uid: account.uid || account.uin, domain: auth.domain || '', ...(account.enterpriseId ? { enterpriseId: account.enterpriseId } : {}) });
    if (!context) throw Error('PROVIDER_CLIENT_CREDENTIAL_MISSING');
    let credential = auth.accessToken;
    if (credential && typeof credential === 'object') {
      // Only the needed access-token field is opened. Refresh tokens and names
      // stay in the official client, and no key/field is written or logged.
      let value;
      for (const payload of keyPayloads.values()) { try { value = decodeField(credential, payload); break; } catch { /* Try another installed signed build. */ } }
      if (!value) { await payloads(signal); for (const payload of keyPayloads.values()) { try { value = decodeField(credential, payload); break; } catch { /* Different build key. */ } } }
      if (!value) throw Error('PROVIDER_CLIENT_ENCRYPTED'); credential = value;
    }
    if (!safe(credential) || credential.length < 8) throw Error('PROVIDER_CLIENT_CREDENTIAL_MISSING');
    const expiry = typeof auth.expiresAt === 'number' && auth.expiresAt > 0 ? auth.expiresAt < 1e12 ? auth.expiresAt * 1000 : auth.expiresAt : null;
    if (expiry !== null && (!Number.isSafeInteger(expiry) || expiry > 8640000000000000 || expiry <= now() + 30000)) throw Error('PROVIDER_AUTH_REQUIRED');
    if (signal.aborted) throw Error('PROVIDER_CANCELED');
    return { credential, expiresAt: expiry === null ? null : new Date(expiry).toISOString(), context: { desktop: context } };
  }
  return { read };
}
module.exports = { createWorkBuddyReader, desktopContext, decodeField, verifiedImagesCommand: VERIFIED_IMAGES };
