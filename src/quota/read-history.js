'use strict';
// What became of each connection's recent quota reads (owner 2026-11-05): when, whether it worked, why not. A failed automatic
// read stays quiet on its card until the third tick, so this is where a person finds it. Times and codes only: no reading,
// no credential, no text a service returned. Reads that worked in a row share one line, so failures are not pushed out by the minute.
const fs = require('node:fs');
const path = require('node:path');
const KEEP = 40, SAVE_MS = 5000;
class ReadHistory {
  constructor(root, { now = Date.now } = {}) {
    this.file = path.join(root, 'read-history.json'); this.now = now; this.timer = null;
    let saved = {}; try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* First run, or a damaged file: start empty. */ }
    this.lines = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }
  record(id, { ok, code = null, automatic = false, quiet = false }) {
    const at = new Date(this.now()).toISOString(), list = this.lines[id] ??= [], last = list.at(-1);
    if (last && (ok ? last.ok : !last.ok && last.code === code)) { last.at = at; last.count = (last.count ?? 1) + 1; }
    else list.push({ at, ok: Boolean(ok), ...(ok ? {} : { code }), automatic: Boolean(automatic), ...(quiet ? { quiet: true } : {}) });
    if (list.length > KEEP) list.splice(0, list.length - KEEP);
    this.later();
  }
  list(id) { return [...(this.lines[id] ?? [])].reverse(); }
  forget(id) { if (this.lines[id]) { delete this.lines[id]; this.later(); } }
  later() { if (this.timer) return; this.timer = setTimeout(() => { this.timer = null; this.save(); }, SAVE_MS); this.timer.unref?.(); }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.lines)); } catch { /* It is a record for reading; losing it harms nothing. */ } }
  close() { if (this.timer) { clearTimeout(this.timer); this.timer = null; this.save(); } }
}
module.exports = { ReadHistory, KEEP };
