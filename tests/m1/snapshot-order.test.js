'use strict';
// Order invariance of whole-snapshot selection. Every merge point (scan files,
// cross-Agent copies, persistent ledger across scans) folds observations of one
// call with selectUsageSnapshot, so the visible result must not depend on the
// order in which equivalent evidence is read. Reference rule:
//   valid evidence (measured/partial) over invalid; then the largest total
//   (a later snapshot; partial totals are lower bounds); equal-total valid
//   observations whose known buckets disagree stay an unpriced conflict;
//   otherwise the most informative observation (quality, known fields, model).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {selectUsageSnapshot} = require('../../src/m1/usage-snapshot');
const {normalize} = require('../../src/m1/normalize');
const {scanSources} = require('../../src/m1/sources');
const {Store} = require('../../src/m1/store');
const {roots} = require('../../src/m1/policy');
const FIELDS = ['inputUncached','output','cacheRead','cacheWrite','reasoning'];
const time = '2026-10-05T12:00:00Z';
// OpenCode/MiMo token objects. Missing reasoning makes a partial snapshot;
// a contradicting reported total makes an invalid (total-mismatch) one.
const OBS = {
  A120: {input:100,output:20,reasoning:0},
  B120: {input:90,output:30,reasoning:0},
  C120: {input:100,output:20},
  D140: {input:100,output:40,reasoning:0},
  F160: {input:100,output:60},
  G140: {input:90,output:50,reasoning:0},
  X140: {input:100,output:40,reasoning:0,total:150},
  Y100: {input:80,output:20,reasoning:0,total:90}
};
const rank = r => ({measured:2,partial:1})[r.measurementQuality || r.quality] || 0;
const known = r => FIELDS.filter(f => Number.isFinite(r[f])).length;
const disagree = (a,b) => rank(a) > 0 && rank(b) > 0 && FIELDS.some(f => Number.isFinite(a[f]) && Number.isFinite(b[f]) && a[f] !== b[f]);
function view(r) { return r.usageConflict ? {total:r.totalTokens,conflict:true} : {total:r.totalTokens,quality:r.quality,model:r.model,...Object.fromEntries(FIELDS.map(f=>[f,r[f]]))}; }
function expected(records) {
  const valid = records.filter(r => rank(r) > 0), pool = valid.length ? valid : records;
  const total = Math.max(...pool.map(r => r.totalTokens)), top = pool.filter(r => r.totalTokens === total);
  if (top.some(r => r.usageConflict) || top.some(a => top.some(b => disagree(a,b)))) return {total,conflict:true};
  const score = r => [rank(r),known(r),r.model === 'unknown' ? 0 : 1];
  return view(top.reduce((best,r) => { const [x,y] = [score(r),score(best)]; return (x[0]-y[0] || x[1]-y[1] || x[2]-y[2]) > 0 ? r : best; }));
}
function permutations(items) { return items.length < 2 ? [items] : items.flatMap((x,i) => permutations([...items.slice(0,i),...items.slice(i+1)]).map(p => [x,...p])); }
function subsets(items, min, max) { return items.reduce((all,x) => all.concat(all.map(s => [...s,x])),[[]]).filter(s => s.length >= min && s.length <= max); }
function record(name, agent = 'opencode', model = 'gpt-4.1') { return normalize(agent,{...OBS[name],cache:{read:0,write:0}},{id:'same',session:'s',model,time},'salt','exclusive'); }
function fold(records) {
  let saved = null; const issues = new Set();
  for (const r of records) { const choice = selectUsageSnapshot(saved,{...r}); saved = choice.record; if (choice.issue) issues.add(choice.issue); }
  return {saved,issues};
}

test('snapshot selection is order-independent and matches the reference rule for every observation set',()=>{
  const pool = [...Object.keys(OBS).map(name => record(name)),{...record('A120'),model:'unknown',provider:'unknown'}];
  for (const set of subsets(pool,1,4)) {
    const want = expected(set);
    for (const order of permutations(set)) {
      const {saved,issues} = fold(order);
      assert.deepEqual(view(saved),want,'order '+order.map(r=>r.totalTokens+'/'+r.quality+'/'+r.model).join(' > '));
      // A conflict that survives selection is always diagnosed.
      if (saved.usageConflict) assert(issues.has('SOURCE_USAGE_CONFLICT'));
    }
  }
});

test('a larger partial snapshot supersedes a smaller measured one and an invalid copy never displaces valid evidence',()=>{
  for (const order of permutations([record('A120'),record('F160')])) assert.deepEqual(view(fold(order).saved),view(record('F160')));
  for (const order of permutations([record('A120'),record('X140')])) assert.deepEqual(view(fold(order).saved),view(record('A120')));
  // Equal-total conflict is lifted by a larger valid snapshot, partial or measured.
  for (const later of ['D140','F160']) for (const order of permutations([record('A120'),record('B120'),record(later)])) assert.deepEqual(view(fold(order).saved),view(record(later)));
  // Reading an older valid snapshot after a newer one still reports a regression.
  assert(fold([record('D140'),record('A120')]).issues.has('SOURCE_USAGE_REGRESSION'));
});

function workspace(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'snapshot-order-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir; }
function message(name) { return {role:'assistant',id:'same',modelID:'gpt-4.1',providerID:'openai',time:{created:Date.parse(time)},tokens:{...OBS[name],cache:{read:0,write:0}}}; }
function write(selected, opencode, mimo) {
  const folder = path.join(selected.opencode[0],'storage/message');
  fs.rmSync(folder,{recursive:true,force:true});
  opencode.forEach((name,i) => { fs.mkdirSync(folder,{recursive:true}); fs.writeFileSync(path.join(folder,'f'+i+'.json'),JSON.stringify(message(name))); });
  const file = path.join(selected.mimo[0],'mimocode.db'); fs.rmSync(file,{force:true});
  if (mimo.length) {
    fs.mkdirSync(path.dirname(file),{recursive:true}); const db = new DatabaseSync(file);
    db.exec('CREATE TABLE message(id TEXT,session_id TEXT,data TEXT)'); for (const name of mimo) db.prepare('INSERT INTO message VALUES(?,?,?)').run('same','s',JSON.stringify(message(name))); db.close();
  }
}
const price = {provider:'openai',model:'gpt-4.1',inputUncached:1,output:2,cacheRead:0,cacheWrite:0};
function cost(view) { return view.conflict || view.quality !== 'measured' ? null : (view.inputUncached + 2*view.output)/1e6; }
function day(store) { const rows = store.snapshot().daily; assert.equal(rows.length,1); return rows[0]; }

test('scans and the persistent ledger reach the reference result in every file, Agent and scan order',async t=>{
  // Every pair, plus triples where a conflict, an invalid copy or a partial copy
  // meets a larger snapshot (the exhaustive search runs on the pure function above).
  const names = ['A120','B120','C120','D140','F160','G140','X140'];
  const triples = [['A120','B120','D140'],['A120','B120','F160'],['B120','C120','A120'],['D140','G140','F160'],['A120','F160','G140'],['X140','A120','F160'],['C120','X140','D140']];
  for (const set of [...subsets(names,2,2),...triples]) {
    const want = expected(set.map(name => record(name))), dir = workspace(t), selected = roots(path.join(dir,'home'));
    let store = new Store(path.join(dir,'app'),selected); store.setPrice(price);
    for (const [n,order] of permutations(set).entries()) {
      // One scan: same-Agent files in this order, and the same files split across
      // OpenCode and MiMo so the later Agent folds into the first owner.
      for (const [opencode,mimo] of [[order,[]],[order.slice(0,1),order.slice(1)],[order.slice(1),order.slice(0,1)]]) {
        write(selected,opencode,mimo);
        const scan = await scanSources(selected,'salt',{reads:0}), records = [...scan.opencode.records,...scan.mimo.records];
        assert.equal(records.length,1); assert.deepEqual(view(records[0]),want,'scan '+opencode.join(',')+' | '+mimo.join(','));
        if (records[0].usageConflict) assert(scan.opencode.errors.includes('SOURCE_USAGE_CONFLICT') || scan.mimo.errors.includes('SOURCE_USAGE_CONFLICT'));
      }
      // Separate scans over time: each observation replaces the source file and
      // the ledger alone carries history; first attribution stays with the first save.
      // The first order of each set is also checked after a restart.
      store.clear();
      for (const [i,name] of order.entries()) { const agent = i % 2 ? 'mimo' : 'opencode'; write(selected,agent === 'opencode' ? [name] : [],agent === 'mimo' ? [name] : []); store.ingest(await scanSources(selected,store.state.salt,{reads:0}),{status:'passed'}); }
      if (n === 0) store = new Store(store.dir,selected);
      const row = day(store), label = 'ledger '+order.join(' > ');
      assert.equal(store.records().length,1); assert.equal(store.records()[0].agent,'opencode',label);
      assert.equal(row.totalTokens,want.total,label); assert.equal(Boolean(store.records()[0].usageConflict),Boolean(want.conflict),label);
      const value = cost(want); if (value === null) assert.equal(row.estimatedCostUsd,null,label); else assert(Math.abs(row.estimatedCostUsd-value)<1e-12,label);
    }
  }
});
