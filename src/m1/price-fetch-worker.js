'use strict';
// Dedicated, fixed GET capability. No application paths, user data or credentials
// are sent to this child. Main/renderer/collector network lockdown stays intact.
const https = require('node:https');
const { URL, parse } = require('./runtime-catalog');
let done = false;
function finish(value) { if (done) return; done = true; process.send?.(value, () => process.exit(value.error ? 1 : 0)); }
const req = https.get(URL, { headers:{ Accept:'application/json', 'User-Agent':'AgentUsage-prices/1' }, timeout:15000 }, response => {
  if (response.statusCode !== 200) { response.resume(); finish({error:'PRICE_DOWNLOAD_HTTP'}); return; }
  const chunks = []; let bytes = 0;
  response.on('data', chunk => { bytes += chunk.length; if (bytes > 16 * 1024 * 1024) { req.destroy(); finish({error:'PRICE_DOWNLOAD_SIZE'}); } else chunks.push(chunk); });
  response.on('end', () => { try { finish({catalog:parse(Buffer.concat(chunks).toString('utf8'))}); } catch { finish({error:'PRICE_DOWNLOAD_SCHEMA'}); } });
  response.on('error', () => finish({error:'PRICE_DOWNLOAD_NETWORK'}));
});
req.on('timeout', () => { req.destroy(); finish({error:'PRICE_DOWNLOAD_TIMEOUT'}); });
req.on('error', () => finish({error:'PRICE_DOWNLOAD_NETWORK'}));
process.on('disconnect', () => { req.destroy(); process.exit(0); });
