'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),chart=require('../../design/desktop-reference/cost-chart');
test('reference chart uses exact canonical plot bounds and round, bounded curve segments',()=>{
  const values=[18,25,12,29,20,17,31.84],p=chart.plot(values);
  assert.equal(p.max,40);assert.equal(p.points[0].x,50);assert.equal(p.points.at(-1).x,418);assert.equal(p.points.at(-1).value,31.84);assert(p.segments[0].line.includes(' C'));
  const controls=p.segments[0].line.match(/C[^C]+/g);for(let i=0;i<controls.length;i++){const numbers=controls[i].slice(1).trim().split(/\s+/).map(Number),lo=Math.min(p.points[i].y,p.points[i+1].y)-.001,hi=Math.max(p.points[i].y,p.points[i+1].y)+.001;assert(numbers[1]>=lo&&numbers[1]<=hi);assert(numbers[3]>=lo&&numbers[3]<=hi);}
});
test('gaps stay disconnected, zero stays on baseline and empty/one-point series remain finite',()=>{
  const p=chart.plot([0,null,3,undefined,0]);assert.equal(p.segments.length,3);assert.equal(p.points[0].y,122);assert.equal(p.points[1],null);
  for(const values of [[],[null],[0],[3],[0,0,0]]){const p=chart.plot(values);assert(!JSON.stringify(p).includes('NaN'));assert(!JSON.stringify(p).includes('Infinity'));}assert.equal(chart.plot([null]).segments.length,0);
});
