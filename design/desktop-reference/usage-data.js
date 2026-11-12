'use strict';
// Electron preload supplies the reduced snapshot. HTTP review server replaces this file.
if(window.usageTransport){
  const transport=window.usageTransport;
  let previous=null,revision=null,fullRequest=null;
  const fullSnapshot=()=>{
    if(!fullRequest)fullRequest=transport.get(null).then(unpack).finally(()=>{fullRequest=null;});
    return fullRequest;
  };
  const unpack=async value=>{
    if(!Object.hasOwn(value,'snapshotBytes'))return value;
    const {snapshotBytes,...state}=value,start=performance.now();let snapshot=null;
    if(snapshotBytes!==null){
      if(state.snapshotRevision===revision)snapshot=previous;
      else if(revision===null||state.snapshotRevision>revision){
        const encoded=JSON.parse(new TextDecoder().decode(snapshotBytes));
        if(encoded.codec==='LocalUsageDeltaV1'&&encoded.baseRevision!==revision)return fullSnapshot();
        snapshot=window.snapshotCodec.unpack(encoded,{consume:true,previous,revision});
        previous=snapshot;revision=state.snapshotRevision;
      }
    }
    performance.clearMeasures('usage:decode');performance.measure('usage:decode',{start,end:performance.now()});return {...state,snapshot};
  };
  // Parsing in the page avoids freezing/copying tens of thousands of row objects
  // through contextBridge. Consumers still receive the same reduced state shape.
  Object.defineProperty(window,'usageBridge',{enumerable:true,value:Object.freeze({...transport,sessions:selection=>transport.sessions(selection).then(value=>value?.schemaVersion==='SessionListV1'?value:window.sessionListCodec.unpackAsync(value)),get:revision=>transport.get(revision).then(unpack),refresh:revision=>transport.refresh(revision).then(unpack)})});
}
