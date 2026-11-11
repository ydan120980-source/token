'use strict';
// Application ledgers contain JSON data, not executable serializers. Keep the
// exact JSON.stringify bytes/order while avoiding one whole-ledger string.
function writeStatistics(value,write){
 const plain=value&&typeof value==='object'&&!Array.isArray(value)&&typeof value.toJSON!=='function';
 if(!plain){write(JSON.stringify(value));return;}
 let parts=[],length=0;
 const append=text=>{parts.push(text);length+=text.length;if(length>=65536){write(parts.join(''));parts=[];length=0;}};
 const object=(source,root=false)=>{
  append('{');let first=true;
  for(const key of Object.keys(source)){
   const item=source[key];
   if(root&&key==='records'&&item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.toJSON!=='function'){
    if(!first)append(',');first=false;append(JSON.stringify(key)+':');object(item);
   }else{
    const text=JSON.stringify(item);if(text===undefined)continue;
    if(!first)append(',');first=false;append(JSON.stringify(key)+':'+text);
   }
  }
  append('}');
 };
 object(value,true);if(parts.length)write(parts.join(''));
}
module.exports={writeStatistics};
