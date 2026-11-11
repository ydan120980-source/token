'use strict';
const https = require('node:https'), fs = require('node:fs'), crypto = require('node:crypto');
const HOSTS = Object.freeze({
  registry: ['registry.npmjs.org'], node: ['nodejs.org'],
  antigravity: ['antigravity-cli-auto-updater-974169037036.us-central1.run.app', 'storage.googleapis.com'],
  workbuddy: ['www.workbuddy.cn', 'download.codebuddy.cn'], cursor: ['cursor.com', 'api2.cursor.sh', 'downloads.cursor.com', 'downloads.cursor.sh'],
  zcode: ['zcode.z.ai', 'cdn-zcode.z.ai']
});
function allowed(raw, scope) {
  try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && HOSTS[scope]?.includes(url.hostname); } catch { return false; }
}
async function receive(raw, { scope, signal, limit = 1024 * 1024, file = null, progress = () => {}, hash = 'sha256', resume = false, agent, proxy = null }, redirects = 0) {
  if(proxy!==null)throw new Error('INSTALL_TRANSPORT_REJECTED');
  if (!allowed(raw, scope) || redirects > 5) throw new Error('INSTALL_URL_REJECTED');
  if (signal?.aborted) throw new Error('INSTALL_CANCELED');
  let offset = 0, initial = crypto.createHash(hash);
  if (file && resume && fs.existsSync(file)) {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('INSTALL_PATH_REJECTED');
    offset = fs.statSync(file).size; if (offset > limit) throw new Error('INSTALL_DOWNLOAD_LIMIT');
    for await (const chunk of fs.createReadStream(file)) { if (signal?.aborted) throw new Error('INSTALL_CANCELED'); initial.update(chunk); }
  }
  return new Promise((resolve, reject) => {
    let stream, settled = false, total = offset, digest = initial; const chunks = [];
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(deadline); signal?.removeEventListener('abort', abort);
      if (error) { request.destroy(); if (stream && !stream.closed) { stream.once('close', () => reject(error)); stream.destroy(); } else reject(error); }
      else resolve(value);
    };
    const headers = { 'User-Agent': 'AgentUsage-Installer/1', Accept: '*/*' }; if (offset) headers.Range = 'bytes=' + offset + '-';
    const request = https.get(raw, { headers, ...(agent ? { agent } : {}) }, response => {
      response.on('error', () => finish(new Error('INSTALL_DOWNLOAD_FAILED')));
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume(); let target; try { target = new URL(response.headers.location, raw).href; if (!response.headers.location || !allowed(target, scope)) throw new Error(); } catch { finish(new Error('INSTALL_URL_REJECTED')); return; }
        clearTimeout(deadline); signal?.removeEventListener('abort', abort); settled = true;
        receive(target, { scope, signal, limit, file, progress, hash, resume, agent }, redirects + 1).then(resolve, reject); return;
      }
      if (response.statusCode === 416 && offset) { response.resume(); finish(null, { text: null, hash: digest.digest('hex'), bytes: total }); return; }
      if (![200, 206].includes(response.statusCode)) { response.resume(); finish(new Error('INSTALL_DOWNLOAD_FAILED')); return; }
      let length = Number(response.headers['content-length']), flags = resume && fs.existsSync(file || '') ? 'w' : 'wx';
      if (response.statusCode === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] || '');
        if (!file || !offset || !range || Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[2]) >= Number(range[3])) { response.resume(); finish(new Error('INSTALL_DOWNLOAD_FAILED')); return; }
        length = Number(range[3]); flags = 'a';
      } else if (offset) { total = 0; digest = crypto.createHash(hash); }
      if (Number.isFinite(length) && length > limit) { response.resume(); finish(new Error('INSTALL_DOWNLOAD_LIMIT')); return; }
      if (file) { stream = fs.createWriteStream(file, { flags, mode: 0o600 }); stream.on('error', () => finish(new Error('INSTALL_WRITE_FAILED'))); }
      response.on('data', chunk => {
        if (settled) return; total += chunk.length;
        if (total > limit) { finish(new Error('INSTALL_DOWNLOAD_LIMIT')); response.destroy(); return; }
        digest.update(chunk); if (stream) { if (!stream.write(chunk)) { response.pause(); stream.once('drain', () => response.resume()); } } else chunks.push(chunk);
        progress({ downloadedBytes: total, totalBytes: Number.isSafeInteger(length) && length > 0 ? length : null });
      });
      response.on('aborted', () => finish(new Error('INSTALL_DOWNLOAD_FAILED')));
      response.on('end', () => { if (settled) return; const done = () => { if (!settled) finish(null, { text: file ? null : Buffer.concat(chunks).toString('utf8'), hash: digest.digest('hex'), bytes: total }); }; if (stream) { stream.once('close', done); stream.end(); } else done(); });
    });
    const abort = () => finish(new Error('INSTALL_CANCELED'));
    signal?.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(() => finish(new Error('INSTALL_TIMEOUT')), file ? 300000 : 20000);
    request.on('error', () => finish(new Error(signal?.aborted ? 'INSTALL_CANCELED' : 'INSTALL_DOWNLOAD_FAILED')));
    request.setTimeout(file ? 60000 : 20000, () => finish(new Error('INSTALL_TIMEOUT')));
  });
}
module.exports = { allowed, receive };
