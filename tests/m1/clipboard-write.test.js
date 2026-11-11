'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{writeClipboard}=require('../../src/quota/clipboard-write');
test('a transient silent clipboard write retries, confirms exact Unicode text and exposes no clipboard content',async()=>{
 let text='',calls=0,waits=0;const expected='synthetic 中文\ncode';await writeClipboard({writeText:async value=>{if(++calls>1)text=value;},readText:async()=>text},expected,async()=>{waits++;});assert.equal(text,expected);assert.equal(calls,2);assert.equal(waits,1);
});
test('a rejected or silently denied clipboard never reports success and stops at its retry bound',async()=>{
 for(const throws of [true,false]){let calls=0;await assert.rejects(writeClipboard({writeText:()=>{calls++;if(throws)throw Error('native private details');},readText:()=>''},'synthetic',async()=>{}),error=>error.message==='CLIPBOARD_WRITE_FAILED');assert.equal(calls,3);}
});
