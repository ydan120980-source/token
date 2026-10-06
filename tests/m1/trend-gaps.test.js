'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { gapPlan, segmentKind } = require('../../design/desktop-reference/chart-ui');
test('visual connections cross unrecorded dates but never recorded unknown prices or pre-coverage dates', () => {
  const buckets = ['01','02','03','04','05'].map(day => ({ start:'2026-10-'+day, end:'2026-10-'+day }));
  const values = [100,null,null,null,200], observed = new Set(['2026-10-01','2026-10-05']);
  const missing = gapPlan(buckets, values, observed, '2026-10-01', 'daily');
  assert.equal(segmentKind(0,4,missing),'bridge'); assert.equal(segmentKind(4,0,missing),'bridge');
  assert.deepEqual(values,[100,null,null,null,200]);
  observed.add('2026-10-03');
  assert.equal(segmentKind(0,4,gapPlan(buckets,values,observed,'2026-10-01','daily')),'unknown');
  assert.equal(segmentKind(0,4,gapPlan(buckets,values,new Set(),'2026-10-04','daily')),'unknown');
  assert.equal(segmentKind(0,4,gapPlan(buckets,values,new Set(),'2026-10-01','average')),'unknown');
  assert.equal(segmentKind(0,1,missing),'recorded');
  assert.equal(segmentKind(0,1,missing,values),'bridge');
  assert.equal(segmentKind(1,2,gapPlan(buckets,values,observed,'2026-10-01','daily'),values),'unknown');
});
