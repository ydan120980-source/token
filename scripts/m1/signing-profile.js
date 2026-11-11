'use strict';
// A reviewable v26 NSIS configuration for a *signed* release, not the ordinary build. No credential reads, certificate-store
// discovery, network, upload or signer invocation here. The unsigned preview line is separate and already wired: ordinary
// builds ship without a publisher identity, so electron-updater skips signature verification
// (docs/m2/AUTO-UPDATE-20261108.md); this profile is what a certificate would add on top.
function configuration({publisher,feedUrl}={},pkg=require('../../package.json')){
 if(typeof publisher!=='string'||!publisher.trim()||publisher.length>200||/[\0-\x1f\x7f]/.test(publisher))throw Error('SIGNING_PUBLISHER_REQUIRED');
 let publish=[{provider:'github',owner:'ydan120980-source',repo:'token',releaseType:'draft'}];
 if(feedUrl){let url;try{url=new URL(feedUrl);}catch{throw Error('UPDATE_HTTPS_FEED_REQUIRED');}if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw Error('UPDATE_HTTPS_FEED_REQUIRED');publish=[{provider:'generic',url:url.href}];}
 return {...structuredClone(pkg.build),forceCodeSigning:true,publish,win:{...structuredClone(pkg.build.win),target:[{target:'nsis',arch:['x64']}],signAndEditExecutable:true,signExecutable:true,verifyUpdateCodeSignature:true,signtoolOptions:{publisherName:[publisher.trim()],signingHashAlgorithms:['sha256']}},nsis:{oneClick:false,perMachine:false,allowElevation:true,differentialPackage:true,deleteAppDataOnUninstall:false}};
}
function readiness(){return {status:'NOT_CONFIGURED',ownerDecision:'Unsigned preview updates are wired (docs/m2/AUTO-UPDATE-20261108.md); a publisher identity and certificate are still missing, so this profile is the signed path, not the current one',builderMajor:26,target:'Windows x64 NSIS',signatureVerification:'required, never disabled',differentialUpdates:'NSIS blockmap/Range, enabled in build.nsis.differentialPackage',missing:['Windows publisher identity and owned certificate/signing service','approved release endpoint and versioned signed artifacts'],publish:'never in this workflow',credentialsRead:false,networkRequests:0,signedBuildProduced:false,autoUpdaterEnabled:true};}
if(require.main===module){if(process.argv.slice(2).some(arg=>arg!=='--plan')){console.error('SIGNING_PLAN_ONLY');process.exitCode=1;}else console.log(JSON.stringify(readiness(),null,2));}
module.exports={configuration,readiness};
