'use strict';
// Electron preload supplies the reduced snapshot. HTTP review server replaces this file.
if(window.usageTransport){
  const transport=window.usageTransport;
  let previous=null,revision=null;
  const unpack=async value=>{
    if(!Object.hasOwn(value,'snapshotBytes'))return value;
    const {snapshotBytes,...state}=value,start=performance.now();let snapshot=null;
    if(snapshotBytes!==null){
      const encoded=JSON.parse(new TextDecoder().decode(snapshotBytes));
      if(encoded.codec==='LocalUsageDeltaV1'&&state.snapshotRevision===revision)snapshot=previous;
      else{
        if(encoded.codec==='LocalUsageDeltaV1'&&encoded.baseRevision!==revision)return unpack(await transport.get(null));
        snapshot=window.snapshotCodec.unpack(encoded,{consume:true,previous,revision});
      }
      if(revision===null||state.snapshotRevision>=revision){previous=snapshot;revision=state.snapshotRevision;}
    }
    performance.clearMeasures('usage:decode');performance.measure('usage:decode',{start,end:performance.now()});return {...state,snapshot};
  };
  // Parsing in the page avoids freezing/copying tens of thousands of row objects
  // through contextBridge. Consumers still receive the same reduced state shape.
  Object.defineProperty(window,'usageBridge',{enumerable:true,value:Object.freeze({...transport,sessions:selection=>transport.sessions(selection).then(value=>value?.schemaVersion==='SessionListV1'?value:window.sessionListCodec.unpackAsync(value)),get:revision=>transport.get(revision).then(unpack),refresh:revision=>transport.refresh(revision).then(unpack)})});
}
