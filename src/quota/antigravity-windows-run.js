'use strict';
const { commandPlan } = require('./antigravity-command');
const { checkPin } = require('./executable-pin');
const { runWindowsJob } = require('./windows-job');
// The same bytes report the same version, so an unchanged program is asked once per run of the app.
const versions = new Map();
function pinnedAntigravityRun(pin, options) {
  const selected = checkPin(pin), plan = commandPlan(selected.executable);
  return async (executable, stage, { signal } = {}) => {
    const expected = [plan.version, plan.usage].find(value => JSON.stringify(value.args) === JSON.stringify(stage?.args));
    if (executable !== plan.executable || !expected || stage.timeoutMs !== expected.timeoutMs || stage.maxOutputBytes !== expected.maxOutputBytes) return { code: null, signal: null, stdout: '', stderr: '', reaped: true, errorCode: 'JOB_REQUEST_INVALID' };
    const version = expected === plan.version;
    if (version && versions.has(selected.sha256)) return versions.get(selected.sha256);
    const result = await runWindowsJob(selected, expected.args, { ...options, timeoutMs: expected.timeoutMs, maxOutputBytes: expected.maxOutputBytes, signal });
    if (version && result.code === 0 && result.reaped === true && !result.errorCode && !result.timedOut && !result.canceled && !result.overflow) versions.set(selected.sha256, result);
    return result;
  };
}
module.exports = { pinnedAntigravityRun };
