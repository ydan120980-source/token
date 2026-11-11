'use strict';
// A SKILL.md header as the Agent admin reads it: the common forms give their fields, a form a strict YAML reader refuses is
// named rather than called broken (owner 2026-11-05, docs/m2/UI-AGENT-ADMIN-TABLE-20261105.md).
const test = require('node:test'), assert = require('node:assert/strict');
const { readFront } = require('../../src/m1/skill-front');
const front = body => readFront('---\n' + body + '\n---\n正文');

test('the forms real Skills use give their fields, with nothing to warn about', () => {
  const cases = {
    plain: ['name: demo\ndescription: A plain line', 'A plain line'],
    quoted: ['name: demo\ndescription: "Use when: asked"', 'Use when: asked'],
    single: ["name: demo\ndescription: 'it''s fine: yes'", "it's fine: yes"],
    folded: ['name: demo\ndescription: >-\n  First line\n  second line', 'First line second line'],
    literal: ['name: demo\ndescription: |\n  First line\n  second line', 'First line\nsecond line'],
    multiline: ['name: demo\ndescription: First line\n  continues here', 'First line continues here'],
    blankLine: ['name: demo\n\ndescription: x', 'x'],
    chinese: ['name: 演示\ndescription: 当用户说做个计划', '当用户说做个计划'],
    nestedAfter: ['name: demo\ndescription: x\nmetadata:\n  version: "1.0"\n  author: someone', 'x'],
    deepAfter: ['name: demo\ndescription: x\nhooks:\n  PreToolUse:\n    - matcher: "Write"\n      hooks:\n        - type: command', 'x'],
    comment: ['# a comment\nname: demo # trailing\ndescription: x', 'x'],
    hash: ['name: demo\ndescription: Fix #123 and more', 'Fix'],
    template: ['name: demo\ndescription: x\nargument-hint: [issue-number]', 'x'],
  };
  for (const [label, [body, description]] of Object.entries(cases)) {
    const read = front(body);
    assert.equal(read.fields.description, description, label);
    assert.match(String(read.fields.name), /demo|演示/, label);
    assert.equal(read.hazard, null, label); assert.equal(read.odd, false, label);
  }
});
test('lists read as lists, however they are written', () => {
  assert.deepEqual([...front('name: d\nallowed-tools:\n  - Read\n  - Bash(git:*)').fields['allowed-tools']], ['Read', 'Bash(git:*)']);
  assert.deepEqual([...front('name: d\nallowed-tools:\n- Read\n- Grep').fields['allowed-tools']], ['Read', 'Grep']);
  assert.deepEqual([...front('name: d\nallowed-tools: [Read, "Grep"]').fields['allowed-tools']], ['Read', 'Grep']);
  assert.equal(front('name: d\nallowed-tools: Bash(git add:*), Read').fields['allowed-tools'], 'Bash(git add:*), Read');
});
test('line endings and a byte-order mark make no difference', () => {
  for (const text of ['---\r\nname: demo\r\ndescription: x\r\n---\r\n', '\uFEFF---\nname: demo\ndescription: x\n---\n']) {
    const read = readFront(text); assert.equal(read.present, true); assert.equal(read.closed, true); assert.equal(read.fields.name, 'demo'); assert.equal(read.fields.description, 'x');
  }
});
test('a form strict YAML refuses still gives its value and is named', () => {
  const colon = front('name: demo\ndescription: Use when: the person asks');
  assert.equal(colon.fields.description, 'Use when: the person asks'); assert.equal(colon.hazard, 'colon');
  const mark = front('name: demo\ndescription: "x"\nglobs: *.js');
  assert.equal(mark.fields.globs, '*.js'); assert.equal(mark.hazard, 'mark');
});
test('no header, an unclosed one, and a line it cannot place are told apart', () => {
  assert.deepEqual([readFront('正文').present, readFront('正文').closed], [false, false]);
  assert.deepEqual([readFront('---\nname: demo\n正文').present, readFront('---\nname: demo\n正文').closed], [true, false]);
  assert.equal(front('name: demo\nnot a field at all').odd, true);
  assert.equal(front('').closed, true, 'an empty header is closed and has no fields');
});
test('field names cannot reach the prototype, and nothing is evaluated', () => {
  const read = front('__proto__: x\nconstructor: y\nname: !!js/function "function(){}"');
  assert.equal(Object.getPrototypeOf(read.fields), null);
  assert.equal(read.fields.name, '!!js/function "function(){}"'); assert.equal(read.hazard, 'mark');
  assert.equal(({}).x, undefined);
});
