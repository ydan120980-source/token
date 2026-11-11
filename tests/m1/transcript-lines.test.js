'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readObjects}=require('../../src/m1/transcript-lines');
test('request-local JSONL iteration preserves chunk-spanning UTF8, long lines, null, invalid lines and a final line without LF',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-lines-'));try{const file=path.join(root,'own.jsonl'),rows=[{text:'中🙂文'.repeat(40000)},null,42,{text:'final'}],text='\n'+JSON.stringify(rows[0])+'\r\nnull\nINVALID\n42\n'+JSON.stringify(rows[3]);fs.writeFileSync(file,text);assert.deepEqual([...readObjects(file,1024*1024)],rows);assert.equal(fs.readFileSync(file,'utf8'),text);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('reader iteration rejects a changed record even if the consumer ends early, and checks the byte ceiling',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-lines-change-'));try{const file=path.join(root,'own.jsonl');fs.writeFileSync(file,'{"one":1}\n{"two":2}\n');assert.throws(()=>[...readObjects(file,2)],/SOURCE_SIZE_OR_LINK/);const rows=readObjects(file,1024);assert.deepEqual(rows.next().value,{one:1});fs.appendFileSync(file,'{"three":3}\n');assert.throws(()=>rows.return(),/SOURCE_BUSY/);fs.renameSync(file,path.join(root,'closed.jsonl'));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('reader iteration rejects directories before opening them',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-lines-directory-'));try{assert.throws(()=>[...readObjects(root,1024)],/SOURCE_SIZE_OR_LINK/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
