'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const m = require('../../design/desktop-reference/widget-layout-model');

const types = state => m.activeLayout(state).widgets.map(entry => entry.type);
const keys = state => m.activeLayout(state).widgets.map(entry => entry.key);

test('missing, broken or empty saved layouts give the owner-approved default', () => {
  for (const raw of [null, '', '{', '[]', '{"layouts":[]}', '{"layouts":[{"id":"Bad Id","name":"x"}]}']) {
    const state = m.parse(raw);
    assert.equal(state.active, 'daily');
    assert.deepEqual(types(state), ['quota.windows', 'usage.today', 'cost.daily', 'usage.week']);
  }
  assert.equal(m.parse(null).layouts[0].name, '日常');
});

test('parse drops unknown types, duplicate keys and invalid options, and keeps one readout', () => {
  const raw = JSON.stringify({ active: 'nope', layouts: [{ id: 'a', name: '  工作  ', widgets: [
    { key: 'w1', type: 'quota.windows', size: 'xl', color: 'pink', background: 'inv', readout: true },
    { key: 'w1', type: 'usage.today' },
    { key: 'w2', type: 'made.up' },
    { key: 'w3', type: 'quota.windows', readout: true },
    { key: 'w4', type: 'usage.today', readout: true, period: '7', agent: '../x' },
    { key: 'w5', type: 'cost.daily', period: '30', agent: 'codex', size: 'l' },
  ] }] });
  const state = m.parse(raw), [a, b, c, d] = m.activeLayout(state).widgets;
  assert.equal(state.active, 'a');
  assert.equal(m.activeLayout(state).name, '工作');
  assert.deepEqual(keys(state), ['w1', 'w3', 'w4', 'w5']);
  assert.deepEqual([a.size, a.color, a.background, a.readout], ['m', 'agent', 'inv', true]);
  assert.equal(b.readout, false);
  assert.deepEqual([c.readout, c.period, c.agent], [false, null, 'all']);
  assert.deepEqual([d.period, d.agent, d.size], ['30', 'codex', 'l']);
  assert.deepEqual(m.parse(m.serialize(state)), state);
});

test('add, remove, reorder and move change only the active layout and never mutate input', () => {
  const start = m.addLayout(m.defaults(), '第二套'), frozen = JSON.stringify(start);
  let state = m.add(start, 'agents.graph');
  assert.equal(JSON.stringify(start), frozen);
  assert.equal(types(state).at(-1), 'agents.graph');
  assert.equal(new Set(keys(state)).size, keys(state).length);
  assert.equal(m.add(state, 'made.up'), state);
  state = m.remove(state, 'w1');
  assert.equal(types(state)[0], 'usage.today');
  assert.deepEqual(types(m.activate(state, 'daily'))[0], 'quota.windows');
  state = m.reorder(state, ['w5', 'w2', 'unknown']);
  assert.deepEqual(keys(state), ['w5', 'w2', 'w3', 'w4']);
  assert.deepEqual(keys(m.move(state, 'w5', 1)), ['w2', 'w5', 'w3', 'w4']);
  assert.deepEqual(keys(m.move(state, 'w5', -1)), keys(state));
  let full = m.defaults();
  for (let i = 0; i < 20; i++) full = m.add(full, 'usage.live');
  assert.equal(m.activeLayout(full).widgets.length, m.MAX_WIDGETS);
});

test('update accepts only known options; turning one readout on turns the other off', () => {
  let state = m.add(m.defaults(), 'quota.windows');
  state = m.update(state, 'w1', { readout: true, size: 'l', color: 'ink', background: 'soft', agent: 'codex' });
  assert.equal(m.readout(state).key, 'w1');
  state = m.update(state, 'w5', { readout: true });
  assert.equal(m.readout(state).key, 'w5');
  assert.equal(m.activeLayout(state).widgets[0].readout, false);
  assert.deepEqual(['size', 'color', 'background', 'agent'].map(k => m.activeLayout(state).widgets[0][k]), ['l', 'ink', 'soft', 'codex']);
  const before = m.update(state, 'w2', { readout: true, size: 'huge', period: '7' });
  assert.deepEqual(m.activeLayout(before).widgets[1], m.activeLayout(state).widgets[1]);
  assert.equal(m.activeLayout(m.update(state, 'w3', { period: '7' })).widgets[2].period, '7');
  assert.equal(m.activeLayout(m.update(state, 'w3', { period: '90' })).widgets[2].period, '14');
});

test('layouts: copy on add, rename, keep the last one, cap the count, reset keeps the name', () => {
  let state = m.update(m.defaults(), 'w1', { size: 's' });
  state = m.addLayout(state, '专注');
  assert.equal(state.active, 'layout-2');
  assert.equal(m.activeLayout(state).widgets[0].size, 's');
  assert.equal(m.addLayout(state, '   '), state);
  state = m.renameLayout(state, 'layout-2', '这是一个非常非常长的布局名字啊');
  assert.equal(m.activeLayout(state).name.length, m.NAME_MAX);
  state = m.removeLayout(state, 'layout-2');
  assert.equal(state.active, 'daily');
  assert.equal(m.removeLayout(state, 'daily'), state);
  for (let i = 0; i < 10; i++) state = m.addLayout(state, '布局' + i);
  assert.equal(state.layouts.length, m.MAX_LAYOUTS);
  state = m.reset(m.renameLayout(m.remove(state, 'w1'), state.active, '改名'));
  assert.equal(m.activeLayout(state).name, '改名');
  assert.deepEqual(types(state), ['quota.windows', 'usage.today', 'cost.daily', 'usage.week']);
});
