'use strict';
const { projectResourceConnections } = require('./resource-connections');
const { safeCode, MESSAGES } = require('./errors');
function installResourceReads(ipcMain, valid, service, connectionInput) {
  ipcMain.handle('quota:getV2', event => {
    if (!valid(event)) throw new Error('IPC_SENDER_REJECTED');
    try { return { ok: true, state: service.stateV2() }; }
    catch (error) { const errorCode = safeCode(error); return { ok: false, errorCode, error: MESSAGES[errorCode], state: null }; }
  });
  ipcMain.handle('usage:connectionsV2', event => {
    if (!valid(event)) throw new Error('IPC_SENDER_REJECTED');
    try { return projectResourceConnections({ ...connectionInput(), quota: service.stateV2() }); }
    catch { throw new Error('CONNECTIONS_UNAVAILABLE'); }
  });
}
module.exports = { installResourceReads };
