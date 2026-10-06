'use strict';
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { childEnvironment, label } = require('./contract');
const { rpcErrorCode } = require('./errors');
const METHODS = new Set(['initialize', 'config/read', 'account/read', 'account/login/start', 'account/login/cancel', 'account/logout', 'account/rateLimits/read']);
const CONFIG = ['cli_auth_credentials_store="keyring"', 'analytics.enabled=false', 'feedback.enabled=false', 'check_for_update_on_startup=false', 'otel.exporter="none"'];
class AccountRpc extends EventEmitter {
  constructor(executable, home, spawnProcess = spawn) {
    super(); this.pending = new Map(); this.next = 0; this.buffer = ''; this.closed = false;
    const args = ['app-server', '--listen', 'stdio://', ...CONFIG.flatMap(value => ['-c', value])];
    this.child = spawnProcess(executable, args, { env: childEnvironment(home), cwd: home, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stdin.on('error', () => this.fail('CODEX_PROCESS_UNAVAILABLE'));
    this.child.stdout.on('data', chunk => this.receive(chunk.toString()));
    this.child.stderr.on('data', () => {}); // Never log raw protocol, auth URLs or stderr.
    this.child.on('error', () => this.fail('CODEX_PROCESS_UNAVAILABLE'));
    this.child.on('exit', () => this.fail('CODEX_PROCESS_EXITED'));
  }
  async initialize() {
    await this.request('initialize', { clientInfo: { name: 'agent_usage_quota', title: 'Agent Usage Quota', version: '0.1.0' }, capabilities: { experimentalApi: false } }); this.child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    const effective = await this.request('config/read', { includeLayers: false });
    if (effective?.config?.cli_auth_credentials_store !== 'keyring') { await this.close(); throw new Error('SYSTEM_CREDENTIAL_STORE_REQUIRED'); }
  }
  request(method, params) {
    if (!METHODS.has(method)) return Promise.reject(new Error('RPC_NOT_ALLOWED'));
    if (method === 'account/login/start' && (params?.type !== 'chatgpt' || Object.keys(params).some(k => k !== 'type'))) return Promise.reject(new Error('LOGIN_TYPE_REJECTED'));
    if (this.closed) return Promise.reject(new Error('CODEX_PROCESS_EXITED'));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CODEX_REQUEST_TIMEOUT')); }, 60000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }) + '\n');
    });
  }
  receive(chunk) {
    if (this.closed) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, 'utf8') > 2 * 1024 * 1024) return this.fail('CODEX_PROTOCOL_LIMIT');
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
      let message; try { message = JSON.parse(line); } catch { this.fail('CODEX_PROTOCOL_INVALID'); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return this.fail('CODEX_PROTOCOL_INVALID');
      if (message.method) {
        if (message.id !== undefined) {
          // Server requests have independent IDs; never consume a matching read.
          this.child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Method not supported' } }) + '\n');
        } else if (message.method === 'account/login/completed') this.emit('login', { loginId: message.params?.loginId, success: message.params?.success === true });
        else if (message.method === 'account/updated') this.emit('accountUpdated', { authMode: message.params?.authMode === 'chatgpt' ? 'chatgpt' : null, plan: label(message.params?.planType) });
      } else if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(rpcErrorCode(message.error)));
        else if (Object.hasOwn(message, 'result')) pending.resolve(message.result);
        else pending.reject(new Error('CODEX_PROTOCOL_INVALID'));
      }
    }
  }
  fail(code) { if (this.closed) return; this.closed = true; this.buffer = ''; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(code)); } this.pending.clear(); this.child.kill(); }
  close() {
    if (this.child.exitCode !== undefined && this.child.exitCode !== null || this.child.signalCode || !this.child.pid) { this.fail('CODEX_PROCESS_EXITED'); return Promise.resolve(); }
    if (!this.reaped) this.reaped = new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); this.child.removeListener('exit', done); resolve(); };
      const timer = setTimeout(() => { this.child.removeListener('exit', done); reject(new Error('CODEX_REQUEST_TIMEOUT')); }, 3000);
      this.child.once('exit', done);
    });
    this.fail('CODEX_PROCESS_EXITED'); return this.reaped;
  }
}
module.exports = { AccountRpc, CONFIG };
