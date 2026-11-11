'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {configuration,readiness}=require('../../scripts/m1/signing-profile');
test('review profile cannot silently produce an unsigned or unverified NSIS update',()=>{
 assert.throws(()=>configuration(),/SIGNING_PUBLISHER_REQUIRED/);const profile=configuration({publisher:'Synthetic Test Publisher'});assert.equal(profile.forceCodeSigning,true);assert.equal(profile.win.signAndEditExecutable,true);assert.equal(profile.win.verifyUpdateCodeSignature,true);assert.equal(profile.nsis.differentialPackage,true);assert.deepEqual(profile.win.target,[{target:'nsis',arch:['x64']}]);assert.equal(profile.publish[0].releaseType,'draft');assert.equal(require('../../package.json').build.win.signAndEditExecutable,false,'ordinary local acceptance remains unchanged');
});
test('future generic feeds reject insecure and credential-bearing addresses, with no current signer/network action',()=>{
 for(const feedUrl of ['http://example.invalid/update','https://user:secret@example.invalid/update','https://example.invalid/update?token=secret'])assert.throws(()=>configuration({publisher:'Synthetic',feedUrl}),/UPDATE_HTTPS_FEED_REQUIRED/);assert.equal(configuration({publisher:'Synthetic',feedUrl:'https://example.invalid/update/'}).publish[0].provider,'generic');const state=readiness();assert.equal(state.credentialsRead,false);assert.equal(state.networkRequests,0);assert.equal(state.signedBuildProduced,false);assert.equal(state.autoUpdaterEnabled,true,'the unsigned preview line updates; the certificate is what is missing');
});

test('review profile matches the installed builder schema without invoking a signer',async()=>{
 const {validateConfiguration}=require('app-builder-lib/out/util/config/config');
 const profile=configuration({publisher:'Synthetic Review Publisher'});
 assert.deepEqual(profile.win.signtoolOptions.publisherName,['Synthetic Review Publisher']);
 await validateConfiguration(profile,{isEnabled:false});
});
