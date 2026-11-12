'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
// The exact tokscale.exe published in @tokscale/cli-win32-x64-msvc 4.17.0 (the lockfile
// pins that tarball's integrity). The build is unsigned and app.asar.unpacked sits
// outside the asar archive, so the bytes are checked before every spawn. Upgrading
// tokscale means updating both fields; tests/m1/native-binary.test.js fails until then.
const TOKSCALE = { version: '4.17.0', sha256: 'bea88fa095e89aea988067729c4c05c8c72fa6760c975ad7a1dd4fbeac60d085' };
function binary() { return path.join(path.dirname(require.resolve('@tokscale/cli-win32-x64-msvc/package.json')), 'bin', 'tokscale.exe').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'); }
function trustedBinary(file = binary(), expected = TOKSCALE.sha256) {
  let actual;
  try {
    const fd=fs.openSync(file,'r');
    try {
      const before=fs.fstatSync(fd),hash=crypto.createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let offset=0;
      if(!before.isFile())throw Error('NATIVE_UNAVAILABLE');
      while(offset<before.size){const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,before.size-offset),offset);if(!count)throw Error('NATIVE_BINARY_MISMATCH');hash.update(buffer.subarray(0,count));offset+=count;}
      const after=fs.fstatSync(fd);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('NATIVE_BINARY_MISMATCH');
      actual=hash.digest('hex');
    }finally{fs.closeSync(fd);}
  }catch(error){throw new Error(error.message==='NATIVE_BINARY_MISMATCH'?'NATIVE_BINARY_MISMATCH':'NATIVE_UNAVAILABLE',{cause:error});}
  if (actual !== expected) throw new Error('NATIVE_BINARY_MISMATCH');
  return file;
}
async function verifyProjection(records, directory, onSpawn = () => {}) {
  // tokscale keeps a per-path source-message cache that assumes append-only
  // transcripts; a record leaving the rewritten projection stays cached and every
  // later check mismatches. Each check therefore runs in its own fresh directory.
  fs.mkdirSync(directory, { recursive: true });
  const run = fs.mkdtempSync(path.join(directory, 'native-'));
  try { return await verifyIn(records, run, onSpawn); } finally { fs.rmSync(run, { recursive: true, force: true }); }
}
async function verifyIn(records, directory, onSpawn) {
  const executable = trustedBinary();
  const home = path.join(directory, 'projection');
  const project = path.join(home, '.claude', 'projects', 'statistics-only'); fs.mkdirSync(project, { recursive: true });
  const file = path.join(project, 'usage.jsonl');
  // Canonical statistics-only transcript. No original paths, titles, bodies,
  // accounts or tokens. Native process cannot inherit provider environments.
  // Preserve the exact projection bytes while bounding temporary serialization
  // to a chunk, instead of retaining every row string plus the joined file.
  const fd=fs.openSync(file,'w',0o600);let lines=[],length=0,eligible=0,expected=0;
  const flush=()=>{if(lines.length){fs.writeFileSync(fd,lines.join(''));lines=[];length=0;}};
  try{
    for(const r of records){
      if (!(r.totalTokens >= 0)) continue;
      eligible++; expected += r.totalTokens;
      const line=JSON.stringify({type:'assistant',uuid:r.id,sessionId:'m1-projection',timestamp:r.timestamp,message:{id:r.id,role:'assistant',model:'m1-statistical-projection',usage:{input_tokens:r.totalTokens,output_tokens:0,cache_read_input_tokens:0,cache_creation_input_tokens:0}}})+'\n';
      lines.push(line);length+=line.length;if(length>=65536)flush();
    }
    if(!eligible)lines.push('\n');flush();
  }finally{fs.closeSync(fd);}
  const env = {
    SystemRoot: process.env.SystemRoot || 'C:\\Windows', WINDIR: process.env.WINDIR || 'C:\\Windows',
    TEMP: path.join(directory, 'tmp'), TMP: path.join(directory, 'tmp'),
    TOKSCALE_CONFIG_DIR: path.join(directory, 'tokscale'), TOKSCALE_PRICING_CACHE_ONLY: '1', NO_COLOR: '1'
  };
  fs.mkdirSync(env.TEMP, { recursive: true }); fs.mkdirSync(env.TOKSCALE_CONFIG_DIR, { recursive: true });
  const text = await new Promise((resolve, reject) => {
    const child = spawn(executable, ['--json', '--client', 'claude', '--home', home, '--no-spinner'], { env, windowsHide: true, cwd: home, stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) onSpawn(child.pid);
    let stdout = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('NATIVE_TIMEOUT')); }, 60000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 10 * 1024 * 1024) { child.kill(); reject(new Error('NATIVE_OUTPUT_LIMIT')); } });
    child.stderr.on('data', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('NATIVE_UNAVAILABLE')); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error('NATIVE_FAILED')); });
  });
  const parsed = JSON.parse(text);
  if (!['totalInput', 'totalOutput', 'totalCacheRead', 'totalCacheWrite'].every(key => Number.isSafeInteger(parsed[key]) && parsed[key] >= 0)) throw new Error('NATIVE_SCHEMA_MISMATCH');
  const actual = ['totalInput', 'totalOutput', 'totalCacheRead', 'totalCacheWrite'].reduce((sum, key) => sum + (parsed[key] ?? 0), 0);
  if (actual !== expected) throw new Error('NATIVE_TOTAL_MISMATCH');
  return { status: 'passed', records: eligible, tokens: actual, engine: 'tokscale/' + TOKSCALE.version };
}
module.exports = { TOKSCALE, binary, trustedBinary, verifyProjection };
