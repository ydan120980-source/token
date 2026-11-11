'use strict';

/**
 * Internal owner protocol; independent of Electron and persistence. Reads may run
 * during an asynchronous collection. Mutations share one queue; close bypasses
 * it so cancellation never waits behind the work it cancels.
 * @typedef {{id: number, command: string, args: unknown[]}} StatisticsRequest
 * @typedef {{id: number, value?: unknown, error?: string, meta?: object}} StatisticsReply
 * @typedef {{settings: object, defaults: object, catalog: object, statuses: object,
 * customSources: object, checkedAt?: string, collecting?: boolean,
 * customBusy?: boolean, maintenance?: object, priceSync?: object}} StatisticsFacts
 */
const READS = Object.freeze(['get', 'getPacked', 'sessions', 'sessionsPacked', 'sessionSummary', 'workbench', 'attention', 'resume', 'directory', 'transcript', 'transcriptPart', 'transcriptFind', 'transcriptStamp', 'transcriptFacts', 'transcriptFileHistory', 'agentUse', 'transcriptMarkdown', 'searchTranscripts', 'pricing', 'priceTry', 'pricePlan', 'exportCost', 'exportProjects', 'serializeStatistics', 'customCheck', 'diagnostics']);
const STORE_COMMANDS = Object.freeze(['workbench', 'saveWorkbench', 'reprice', 'resume', 'directory', 'transcript', 'transcriptPart', 'transcriptFind', 'transcriptStamp', 'transcriptFacts', 'transcriptFileHistory', 'agentUse', 'transcriptMarkdown', 'searchTranscripts', 'pricing', 'priceTry', 'pricePlan', 'setBilling', 'setPrice', 'probe', 'changeSources', 'clear']);
const CUSTOM_COMMANDS = Object.freeze(['draft', 'choose', 'sample', 'preview', 'apply', 'change', 'import', 'export']);
const MUTATIONS = ['refresh', 'enabled', 'interval', 'subscription', 'discover', 'applyMaintenance', 'priceStart', 'priceSync', 'priceAuto', 'start'];
const COMMANDS = Object.freeze(Object.fromEntries([...READS, ...MUTATIONS, ...STORE_COMMANDS, ...CUSTOM_COMMANDS.map(name => 'custom:' + name), 'close'].map(name => [name, name === 'close' ? 'close' : READS.includes(name) ? 'read' : 'mutation'])));

function commandMode(name) {
  if (typeof name !== 'string' || !Object.hasOwn(COMMANDS, name)) throw Error('STATISTICS_COMMAND_REJECTED');
  return COMMANDS[name];
}
/** @param {StatisticsRequest} request */
function validRequest(request) {
  return Number.isSafeInteger(request?.id) && typeof request.command === 'string' && Object.hasOwn(COMMANDS, request.command) && Array.isArray(request.args);
}
module.exports = { COMMANDS, STORE_COMMANDS, CUSTOM_COMMANDS, commandMode, validRequest };
