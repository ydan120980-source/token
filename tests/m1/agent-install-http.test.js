'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), https = require('node:https'), { EventEmitter } = require('node:events'), { PassThrough } = require('node:stream');
const { receive } = require('../../src/quota/agent-install-http');
test('obsolete proxy policy is rejected before a product HTTP request',async t=>{
  let calls=0;t.mock.method(https,'get',()=>{calls++;throw new Error('UNEXPECTED_NETWORK');});
  await assert.rejects(receive('https://registry.npmjs.org/fixture',{scope:'registry',proxy:'claude-residential'}),/INSTALL_TRANSPORT_REJECTED/);assert.equal(calls,0);
});
test('caller-owned transport stays attached across official redirects without constructing a product proxy',async t=>{
  const agent={synthetic:true},seen=[];
  t.mock.method(https,'get',(url,options,callback)=>{
    seen.push(options.agent);const request=new EventEmitter();request.destroy=()=>{};request.setTimeout=()=>request;
    process.nextTick(()=>{const response=new PassThrough();response.statusCode=seen.length===1?302:200;response.headers=seen.length===1?{location:'https://registry.npmjs.org/final.tgz'}:{};callback(response);response.end('OK');});return request;
  });
  assert.equal((await receive('https://registry.npmjs.org/start',{scope:'registry',agent})).text,'OK');assert.deepEqual(seen,[agent,agent]);
});
test('download transport rejects foreign redirects, bounds bytes and aborts without executing or returning partial files', async t => {
  let route = 'redirect', requests = 0, destroyed = 0;
  t.mock.method(https, 'get', (url, options, callback) => {
    requests++; const request = new EventEmitter(); request.destroy = () => { destroyed++; }; request.setTimeout = () => request;
    process.nextTick(() => {
      const response = new PassThrough(); response.statusCode = route === 'redirect' ? 302 : 200; response.headers = route === 'redirect' ? { location: 'https://foreign.invalid/installer.exe' } : {};
      callback(response); if (route === 'bytes') response.end('OVER_LIMIT'); else if (route === 'valid') response.end('OK');
    }); return request;
  });
  await assert.rejects(receive('https://nodejs.org/test', { scope: 'node' }), /INSTALL_URL_REJECTED/); assert.equal(requests, 1);
  route = 'bytes'; await assert.rejects(receive('https://nodejs.org/test', { scope: 'node', limit: 2 }), /INSTALL_DOWNLOAD_LIMIT/);
  route = 'idle'; const abort = new AbortController(), pending = receive('https://nodejs.org/test', { scope: 'node', signal: abort.signal }); abort.abort(); await assert.rejects(pending, /INSTALL_CANCELED/);
  route = 'valid'; const result = await receive('https://nodejs.org/test', { scope: 'node' }); assert.equal(result.text, 'OK'); assert.equal(result.bytes, 2); assert(destroyed >= 3);
});
test('resumed download verifies range position and hashes full prefix; ignored range safely restarts the owned partial file', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { remove } = require('./temp');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-install-')); t.after(() => remove(root)); const file = path.join(root, 'partial'); fs.writeFileSync(file, 'HELLO'); let mode = 'range', range;
  t.mock.method(https, 'get', (url, options, callback) => { range = options.headers.Range; const request = new EventEmitter(); request.destroy = () => {}; request.setTimeout = () => request; process.nextTick(() => { const response = new PassThrough(); response.statusCode = mode === 'reset' ? 200 : 206; response.headers = mode === 'reset' ? { 'content-length': '3' } : { 'content-range': mode === 'bad' ? 'bytes 1-10/11' : 'bytes 5-10/11', 'content-length': '6' }; callback(response); response.end(mode === 'reset' ? 'NEW' : ' WORLD'); }); return request; });
  const first = await receive('https://registry.npmjs.org/tool.tgz', { scope: 'registry', file, resume: true }); assert.equal(range, 'bytes=5-'); assert.equal(fs.readFileSync(file, 'utf8'), 'HELLO WORLD'); assert.equal(first.hash, crypto.createHash('sha256').update('HELLO WORLD').digest('hex')); assert.equal(first.bytes, 11);
  mode = 'bad'; await assert.rejects(receive('https://registry.npmjs.org/tool.tgz', { scope: 'registry', file, resume: true }), /INSTALL_DOWNLOAD_FAILED/); assert.equal(fs.readFileSync(file, 'utf8'), 'HELLO WORLD');
  mode = 'reset'; const second = await receive('https://registry.npmjs.org/tool.tgz', { scope: 'registry', file, resume: true }); assert.equal(second.bytes, 3); assert.equal(fs.readFileSync(file, 'utf8'), 'NEW'); assert.equal(second.hash, crypto.createHash('sha256').update('NEW').digest('hex'));
});
test('Claude proxy uses only pinned loopback CONNECT with TLS verification; proxy failure never falls back to direct', async t => {
  const http = require('node:http'), tls = require('node:tls'), { makeProxyAgent } = require('../../scripts/local/claude-governed/proxy'); let received, fail = true, verified = false;
  t.mock.method(http, 'request', options => { received = options; const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = () => {}; request.end = () => process.nextTick(() => request.emit('connect', { statusCode: fail ? 503 : 200 }, new PassThrough(), Buffer.alloc(0))); return request; });
  t.mock.method(tls, 'connect', (options, callback) => { verified = options.rejectUnauthorized === true && options.servername === 'registry.npmjs.org'; const socket = new PassThrough(); socket.setTimeout = () => {}; process.nextTick(callback); return socket; });
  const agent = makeProxyAgent('claude-residential');
  await assert.rejects(new Promise((resolve, reject) => agent.createConnection({ host: 'registry.npmjs.org' }, (error, socket) => error ? reject(error) : resolve(socket))), /INSTALL_GOVERNANCE_REQUIRED/); assert.equal(received.host, '127.0.0.1'); assert.equal(received.port, 17898); assert.equal(received.method, 'CONNECT'); assert.equal(verified, false);
  fail = false; const socket = await new Promise((resolve, reject) => agent.createConnection({ host: 'registry.npmjs.org' }, (error, socket) => error ? reject(error) : resolve(socket))); assert.equal(verified, true); socket.destroy(); agent.destroy(); assert.throws(() => makeProxyAgent('arbitrary-proxy'), /INSTALL_GOVERNANCE_REQUIRED/);
});
