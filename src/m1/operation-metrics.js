'use strict';
const { performance } = require('node:perf_hooks');

// Fixed keys and scalar aggregates; no request arguments, identifiers, paths,
// exception text, credentials or unbounded sample arrays.
class OperationMetrics {
  constructor(stages, counters = []) {
    this.stages = Object.fromEntries(stages.map(name => [name, { count: 0, failed: 0, totalMs: 0, lastMs: 0, maxMs: 0 }]));
    this.counters = Object.fromEntries(counters.map(name => [name, 0]));
  }
  count(name) {
    if (!Object.hasOwn(this.counters, name)) throw Error('METRIC_KEY_REJECTED');
    this.counters[name]++;
  }
  measure(name, action) {
    if (!Object.hasOwn(this.stages, name)) throw Error('METRIC_KEY_REJECTED');
    const row = this.stages[name], start = performance.now();
    row.count++;
    try { return action(); }
    catch (error) { row.failed++; throw error; }
    finally { row.lastMs = performance.now() - start; row.totalMs += row.lastMs; row.maxMs = Math.max(row.maxMs, row.lastMs); }
  }
  async measureAsync(name, action) {
    if (!Object.hasOwn(this.stages, name)) throw Error('METRIC_KEY_REJECTED');
    const row = this.stages[name], start = performance.now();
    row.count++;
    try { return await action(); }
    catch (error) { row.failed++; throw error; }
    finally { row.lastMs = performance.now() - start; row.totalMs += row.lastMs; row.maxMs = Math.max(row.maxMs, row.lastMs); }
  }
  state() { return structuredClone({ stages: this.stages, counters: this.counters }); }
}
module.exports = { OperationMetrics };
