'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript');
const file=path.join(__dirname,'../../ui/src/kit/charts/geometry.ts'),code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exportsObject={};vm.runInNewContext(code,{exports:exportsObject});const g=exportsObject,legacy=require('../../design/desktop-reference/cost-chart'),tooltip=require('../../design/desktop-reference/chart-ui');
test('monotone geometry is identical to the original exported curve for flat, extrema, single and irregular coordinates',()=>{for(const points of [[],[{x:0,y:3}],[{x:1,y:2},{x:4,y:2},{x:8,y:2}],[{x:0,y:4},{x:1,y:0},{x:4,y:9},{x:7,y:2}],[{x:.123456,y:1.23456},{x:4.56789,y:3.45678},{x:8.99112,y:-5.6789}]])assert.equal(g.curve(points),legacy.curve(points));});
test('nice steps and ticks retain old cost-stack/cost-bars expectations (cost-bars.js:13,57)',()=>{for(const [raw,expected] of [[NaN,1],[Infinity,1],[-1,1],[0,1],[.0011,.002],[.021,.025],[2.1,2.5],[4,5],[5.1,10],[12,20],[26,50]])assert.equal(g.niceStep(raw),expected);assert.deepEqual(Array.from(g.ticksFor(8.4)),[0,2.5,5,7.5,10]);});
test('rounded bars and donut arcs match sampled old private functions (cost-bars.js:12, cost-donut.js:9-15)',()=>{assert.equal(g.barPath(10,20,8,30,6),'M10 50V24Q10 20 14 20H14Q18 20 18 24V50Z');assert.equal(g.barPath(1.234,2.345,6,0,6),'M1.23 2.35V2.35Q1.23 2.35 1.23 2.35H7.23Q7.23 2.35 7.23 2.35V2.35Z');assert.equal(g.arcPath(120,120,0,Math.PI/2),'M120.00 12.00A108 108 0 0 1 228.00 120.00');assert.equal(g.arcPath(120,120,0,Math.PI*1.5),'M120.00 12.00A108 108 0 1 1 12.00 120.00');assert.equal(g.lowestArc(120,0,Math.PI),228);});
test('quota dial radii and tooltip avoidance match the old renderer exactly',()=>{assert.deepEqual(Array.from(g.ringRadii(1)),[56]);assert.deepEqual(Array.from(g.ringRadii(2)),[58,42]);assert.deepEqual(Array.from(g.ringRadii(3)),[60,47,34]);for(const bounds of [{width:500,height:260},{width:180,height:120}])for(const panel of [{width:120,height:80},{width:50,height:32}])for(const point of [{x:0,y:0},{x:100,y:50},{x:490,y:255}])assert.deepEqual({...g.positionTooltip(bounds,panel,point)},tooltip.positionTooltip(bounds,panel,point));});
test('null creates a hard gap and explicit zero remains an observed point',()=>{assert.deepEqual(JSON.parse(JSON.stringify(g.runs([1,null,0,2,null],Number.isFinite))),[[0],[2,3]]);});
test('daily columns retain cost.css:791 top 4 / bottom 2 corners and clamp them for tiny or empty bars',()=>{assert.equal(g.dailyBarPath(10,20,30,40),'M12 60H38A2 2 0 0 0 40 58V24A4 4 0 0 0 36 20H14A4 4 0 0 0 10 24V58A2 2 0 0 0 12 60Z');assert(!/NaN|Infinity/.test(g.dailyBarPath(0,0,0,0)));assert.match(g.dailyBarPath(0,0,1,1),/A0.5 0.5/);});

test('cost stacked runs follow whole-bucket observations while preserving absent Agent values and explicit zero',()=>{
  const values=Object.freeze([Object.freeze([2,null,null,0,4]),Object.freeze([null,3,null,null,null])]);
  const result=JSON.parse(JSON.stringify(g.costStackGeometry(values,[false,false,true,false,false],true)));
  assert.deepEqual(result,{bases:[[0,0,0,0,0],[2,0,0,0,4]],tops:[[2,0,null,0,4],[2,3,null,0,4]],parts:[[[0,1],[3,4]],[[0,1],[3,4]]]});
  assert.equal(values[0][1],null);assert.equal(values[1][3],null);assert.equal(values[0][3],0);
  const empty=JSON.parse(JSON.stringify(g.costStackGeometry([[null,null],[null,null]],[false,false],true)));
  assert.deepEqual(empty.tops,[[null,null],[null,null]]);assert.deepEqual(empty.parts,[[],[]]);
});

test('cost non-stacked lines keep each Agent gap independently, including gaps where another Agent has a value',()=>{
  const result=JSON.parse(JSON.stringify(g.costStackGeometry([[2,null,null,0,4],[null,3,null,null,null]],[false,false,true,false,false],false)));
  assert.deepEqual(result.tops,[[2,null,null,0,4],[null,3,null,null,null]]);
  assert.deepEqual(result.parts,[[[0],[3,4]],[[1]]]);
  assert.deepEqual(result.bases,[[0,0,0,0,0],[0,0,0,0,0]]);
});

