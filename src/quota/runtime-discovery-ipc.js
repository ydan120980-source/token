'use strict';
function installRuntimeDiscovery(ipcMain, valid, discover) {
  let pending = null;
  ipcMain.handle('quota:discoverAntigravity', (event, ...args) => {
    if (!valid(event)) throw new Error('IPC_SENDER_REJECTED');
    if (args.length) return { ok: false, errorCode: 'RUNTIME_DISCOVERY_ARGUMENTS_REJECTED', discovery: null };
    if (!pending) pending = Promise.resolve().then(discover).then(discovery => ({ ok: true, discovery }), () => ({ ok: false, errorCode: 'RUNTIME_DISCOVERY_UNAVAILABLE', discovery: null })).finally(() => { pending = null; });
    return pending;
  });
}
module.exports = { installRuntimeDiscovery };
