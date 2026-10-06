'use strict';
// Explicit opt-in, local read-only usage validation. Output aggregate counts
// only; no source identifiers, raw rows, prompts, configs or authentication.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const {roots, filesUnder, readBytes, disableNetwork} = require('../../src/m1/policy');
const {scanSources} = require('../../src/m1/sources');
const {readDatabase, query} = require('../../src/m1/sqlite-memory');
const {canonicalFiles} = require('../../src/m1/extended-sources');
const {frameEnd} = require('../../src/m1/zstd-frame');
if (!process.argv.includes('--actual')) throw new Error('EXPLICIT_LOCAL_USAGE_VALIDATION_REQUIRED');
const audit = {reads:0,sourceWrites:0,authenticationReads:0,networkAttempts:0}; disableNetwork(audit);
function rawText(file) {
  const input = readBytes(file,audit); if (!file.endsWith('.zstd')) return input.toString('utf8');
  let offset = 0, text = '';
  while (offset < input.length) { const end = frameEnd(input,offset); if(end === null) throw new Error('REAL_LOG_INCOMPLETE'); const decoded = zlib.zstdDecompressSync(input.subarray(offset,end),{info:true,maxOutputLength:64*1024*1024}); if(decoded.engine.bytesWritten !== end-offset) throw new Error('REAL_COMPRESSION_INVALID'); offset = end; text += decoded.buffer.toString('utf8'); }
  return text;
}
async function independent(agent,file) {
  if (agent === 'zcode') return readDatabase(file,audit,db => ({...query(db,'SELECT SUM(computed_total_tokens) AS tokens, COUNT(*) AS rows, SUM(CASE WHEN reasoning_tokens > 0 THEN 1 ELSE 0 END) AS positiveReasoningRows FROM model_usage WHERE computed_total_tokens IS NOT NULL')[0],format:'machine-observed-model_usage'}));
  const lines = rawText(file).trim().split('\n').map(line => JSON.parse(line)), header = lines.shift();
  if (header.version !== 4) throw new Error('REAL_FORMAT_NOT_COMPARABLE');
  let cut = -1, tokens = 0, rows = 0;
  if (header.isSeeded) for (const e of lines) if (e.type === 'session/end-seed' && e.data?.inherited) cut = e.seq;
  if (header.isSeeded && cut < 0) throw new Error('REAL_FORK_NOT_COMPARABLE');
  for (const e of lines) {
    if (e.seq <= cut || !['assistant/message','assistant/attempt'].includes(e.type)) continue;
    let u = e.data?.usage;
    if (!u) u = (e.data?.stream || []).filter(p => p.type === 'chunk' && p.chunk?.type === 'usage').at(-1)?.chunk?.usage;
    if (!u || !Number.isSafeInteger(u.totalTokens)) continue; // Only authoritative aggregate counters are comparable.
    tokens += u.totalTokens; rows++;
  }
  return {tokens,rows,format:'v4'};
}
(async () => {
  const selected = roots(), salt = crypto.randomBytes(32).toString('hex'), report = {at:new Date().toISOString(),kind:'aggregate-only-read-only',audit,auditBasis:'declared read-path counters, before/after source and WAL hashes; not independent OS file-access monitoring',sources:{}};
  for (const agent of ['zcode','deepseek']) {
    const candidates = selected[agent].flatMap(root => filesUnder(agent,root,audit)), files = agent === 'deepseek' ? canonicalFiles([...new Set(candidates)]) : [...new Set(candidates)];
    let stableFiles = 0, matchedFiles = 0, skippedFiles = 0, expectedTokens = 0, actualTokens = 0;
    const skipReasons = {}, comparableFormats = {}; let positiveReasoningRows = 0;
    const skip = reason => { skippedFiles++; skipReasons[reason] = (skipReasons[reason] || 0) + 1; };
    const digest = file => crypto.createHash('sha256').update(readBytes(file,audit)).digest('hex');
    for (const file of files) {
      try {
        const before = digest(file), beforeWal = fs.existsSync(file+'-wal') ? digest(file+'-wal') : null;
        const raw = await independent(agent,file), scan = await scanSources({[agent]:[file]},salt,audit), parsed = scan[agent];
        const afterWal = fs.existsSync(file+'-wal') ? digest(file+'-wal') : null;
        if (before !== digest(file) || beforeWal !== afterWal) {skip('SOURCE_CHANGED_DURING_CHECK');continue;}
        if (parsed.errors.length || parsed.partial) {skip('PARSER_PARTIAL');continue;}
        if (!raw.rows) {skip('NO_COMPARABLE_USAGE');continue;}
        const tokens = parsed.records.reduce((sum,r) => sum+r.totalTokens,0); stableFiles++; expectedTokens += raw.tokens; actualTokens += tokens;
        comparableFormats[raw.format] = (comparableFormats[raw.format] || 0) + 1; positiveReasoningRows += raw.positiveReasoningRows || 0;
        if (tokens === raw.tokens) matchedFiles++;
      } catch (error) { skip(['REAL_FORMAT_NOT_COMPARABLE','REAL_FORK_NOT_COMPARABLE','REAL_LOG_INCOMPLETE','REAL_COMPRESSION_INVALID','SOURCE_BUSY','SOURCE_UNREADABLE','SOURCE_COMPRESSION_INVALID'].includes(error.message) ? error.message : 'INDEPENDENT_READ_NOT_COMPARABLE'); }
    }
    report.sources[agent] = {candidateFiles:files.length,stableFiles,matchedFiles,skippedFiles,skipReasons,comparableFormats,positiveReasoningRows,expectedTokens,actualTokens,unchangedDuringCheck:true,passed:stableFiles > 0 && matchedFiles === stableFiles};
  }
  const output = path.resolve(process.env.AGENT_REAL_EVIDENCE_DIR || 'artifacts/m2-agents-r2');
  if (!output.startsWith(path.resolve('artifacts') + path.sep)) throw new Error('EVIDENCE_OUTPUT_REJECTED');
  fs.mkdirSync(output,{recursive:true}); fs.writeFileSync(path.join(output,'real-aggregate-check.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
  if (Object.values(report.sources).some(s => s.stableFiles && !s.passed)) process.exitCode = 1;
})().catch(() => {console.error('REAL_USAGE_CHECK_FAILED');process.exitCode=1;});
