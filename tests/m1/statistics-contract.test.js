'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { commandMode, validRequest } = require('../../src/m1/statistics-contract');
const { OperationMetrics } = require('../../src/m1/operation-metrics');
const { StatisticsService } = require('../../src/m1/statistics-service');

test('owner protocol preserves read/mutation/close lanes and rejects prototype or malformed commands', () => {
  for (const name of ['get', 'getPacked', 'workbench', 'attention', 'diagnostics']) assert.equal(commandMode(name), 'read');
  for (const name of ['refresh', 'changeSources', 'saveWorkbench', 'custom:apply', 'setPrice']) assert.equal(commandMode(name), 'mutation');
  assert.equal(commandMode('close'), 'close');
  for (const name of ['constructor', '__proto__', 'toString', 'SECRET']) {
    assert.throws(() => commandMode(name), /COMMAND_REJECTED/);
    assert.equal(validRequest({ id: 1, command: name, args: [] }), false);
  }
  assert.equal(validRequest({ id: 1, command: 'get', args: [] }), true);
  assert.equal(validRequest({ id: 1, command: 'get', args: {} }), false);
  assert.equal(validRequest({ id: NaN, command: 'get', args: [] }), false);
});

test('application read model is detached and never masquerades as a live Store', () => {
  const service = Object.create(StatisticsService.prototype);
  service._facts = { settings: { enabled: true, sources: { disabled: [] } }, catalog: { synthetic: {} }, statuses: {}, maintenance: { summary: { id: 'preview' } } };
  service.facts().settings.sources.disabled.push('synthetic');
  service.catalog().synthetic.changed = true;
  service.maintenancePreview().summary.id = 'changed';
  assert.deepEqual(service._facts.settings.sources.disabled, []);
  assert.deepEqual(service.catalog().synthetic, {});
  assert.equal(service.maintenancePreview().summary.id, 'preview');
  assert.equal(service.store, undefined);
});

test('bounded metrics count success and failure without retaining values or exception text', async () => {
  const metrics = new OperationMetrics(['operation'], ['hit']);
  assert.equal(metrics.measure('operation', () => 7), 7);
  await assert.rejects(metrics.measureAsync('operation', async () => { throw Error('PRIVATE_SENTINEL'); }), /PRIVATE_SENTINEL/);
  metrics.count('hit');
  const state = metrics.state();
  assert.equal(state.stages.operation.count, 2);
  assert.equal(state.stages.operation.failed, 1);
  assert(state.stages.operation.totalMs >= state.stages.operation.lastMs);
  assert.equal(state.counters.hit, 1);
  state.counters.hit = 0;
  assert.equal(metrics.state().counters.hit, 1);
  assert(!JSON.stringify(metrics.state()).includes('PRIVATE_SENTINEL'));
  assert.throws(() => metrics.count('PRIVATE_SENTINEL'), /KEY_REJECTED/);
});
