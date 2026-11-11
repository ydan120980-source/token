'use strict';
// A successful IPC result must mean the requested text was actually accepted.
// Windows clipboard contention can make a native write silently do nothing.
// Only read back the just-requested text; never return clipboard content.
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function writeClipboard(clipboard,text,wait=pause){
 for(let attempt=0;attempt<3;attempt++){
  try{await clipboard.writeText(text);if(await clipboard.readText()===text)return;}catch{/* Transient native clipboard failure; bounded retry. */}
  if(attempt<2)await wait(50);
 }
 throw Error('CLIPBOARD_WRITE_FAILED');
}
module.exports={writeClipboard};
