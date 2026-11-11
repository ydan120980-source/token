'use strict';
// Run by the owner on their own machine: `node scripts/local/reader-coverage.js [agent ...]`. Reads this machine's real session
// records, so it is never part of routine verification. It prints counts and row type names only, no conversation text, and
// writes nothing. Each line answers: how many sessions read, how many failed and why, and which rows no reader knows.
const { roots } = require('../../src/m1/policy');
const { READERS, load, fileIndex } = require('../../src/m1/transcript');

const SAMPLE = 200;
(async () => {
  const wanted = process.argv.slice(2).filter(agent => READERS.has(agent)), selected = roots();
  for (const agent of wanted.length ? wanted : [...READERS]) {
    let ids = [];
    try { ids = [...fileIndex(agent, selected[agent] ?? []).keys()].slice(-SAMPLE); } catch { /* Listed below as nothing found. */ }
    const line = { sessions: ids.length, read: 0, empty: 0, items: 0, truncated: 0, failures: {}, unknown: {} };
    for (const id of ids) {
      try {
        const { value } = await load(agent, id, selected[agent] ?? [], { noImages: true });
        line.read++; line.items += value.items.length;
        if (!value.items.length) line.empty++;
        if (value.truncated) line.truncated++;
        for (const item of value.items) if (item.label?.startsWith('未识别的记录')) { const type = item.label.split(' · ')[1]; line.unknown[type] = (line.unknown[type] ?? 0) + 1; }
      } catch (error) { const code = String(error?.message).slice(0, 40); line.failures[code] = (line.failures[code] ?? 0) + 1; }
    }
    console.log(agent.padEnd(12), JSON.stringify(line));
  }
})();
