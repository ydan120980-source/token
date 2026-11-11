'use strict';
// Approximate retained JS payload, not an RSS claim. A large file is simply uncached.
function weight(value) {
  if(typeof value==='string')return 24+value.length*2;
  if(value===null||typeof value!=='object')return 8;
  if(Array.isArray(value))return 24+value.reduce((n,v)=>n+8+weight(v),0);
  return 32+Object.entries(value).reduce((n,[k,v])=>n+16+k.length*2+weight(v),0);
}
class ParseCache extends Map {
  constructor(maxBytes=64*1024*1024,maxEntries=2048){super();this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.bytes=0;this.weights=new Map();}
  get(key){const value=super.get(key);if(value!==undefined){super.delete(key);super.set(key,value);}return value;}
  set(key,value){this.delete(key);const bytes=weight(value);if(bytes>this.maxBytes)return this;super.set(key,value);this.weights.set(key,bytes);this.bytes+=bytes;while(this.bytes>this.maxBytes||this.size>this.maxEntries)this.delete(this.keys().next().value);return this;}
  delete(key){if(!super.has(key))return false;this.bytes-=this.weights.get(key)||0;this.weights.delete(key);return super.delete(key);}
  clear(){super.clear();this.weights?.clear();this.bytes=0;}
}
module.exports={ParseCache,weight};
