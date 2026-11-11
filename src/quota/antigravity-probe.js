'use strict';
const { commandPlan, version, supportedVersion } = require('./antigravity-command');
const { fromAntigravity, envelopes, modelTurn } = require('./antigravity-resources');
const ERRORS = new Set(['AGY_EXECUTABLE_REQUIRED', 'AGY_VERSION_UNSUPPORTED', 'AGY_OUTPUT_LIMIT', 'AGY_PROTOCOL_INVALID', 'AGY_REQUEST_FAILED', 'AGY_MODEL_TURN_DETECTED', 'AGY_NO_TURN_UNVERIFIED', 'AGY_TIMEOUT', 'AGY_CANCELED', 'AGY_CLEANUP_FAILED', 'AGY_BINARY_CHANGED', 'AGY_HOST_UNAVAILABLE']);
function resultCode(result) {
  if (!result || result.reaped !== true) return 'AGY_CLEANUP_FAILED';
  if (result.errorCode === 'JOB_BINARY_CHANGED') return 'AGY_BINARY_CHANGED';
  if (result.errorCode) return 'AGY_HOST_UNAVAILABLE';
  if (result.canceled) return 'AGY_CANCELED';
  if (result.timedOut) return 'AGY_TIMEOUT';
  if (result.overflow) return 'AGY_OUTPUT_LIMIT';
  if (result.code !== 0 || result.signal !== null) return 'AGY_REQUEST_FAILED';
  return null;
}
async function inspectAntigravity({ executable, run, signal, now = Date.now }) {
  let cliVersion = null;
  try {
    const plan = commandPlan(executable);
    if (signal?.aborted) throw new Error('AGY_CANCELED');
    if (typeof run !== 'function') throw new Error('AGY_REQUEST_FAILED');
    const execute = async stage => {
      const result = await run(plan.executable, stage, { signal, shell: false, windowsHide: true });
      if (stage === plan.usage && typeof result?.stdout === 'string' && Buffer.byteLength(result.stdout, 'utf8') <= stage.maxOutputBytes) {
        // Even a nonzero exit may report that inference happened. That evidence
        // must survive the generic process-error classification.
        let observed = [];
        try { observed = envelopes(result.stdout); } catch { /* Classify the transport first. */ }
        if (observed.some(modelTurn)) throw new Error('AGY_MODEL_TURN_DETECTED');
      }
      const code = resultCode(result);
      if (code) throw new Error(code);
      if (typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new Error('AGY_PROTOCOL_INVALID');
      if (Buffer.byteLength(result.stdout, 'utf8') + Buffer.byteLength(result.stderr, 'utf8') > stage.maxOutputBytes) throw new Error('AGY_OUTPUT_LIMIT');
      if (signal?.aborted) throw new Error('AGY_CANCELED');
      return result.stdout;
    };
    cliVersion = version(await execute(plan.version));
    if (!supportedVersion(cliVersion)) throw new Error('AGY_VERSION_UNSUPPORTED');
    const stdout = await execute(plan.usage);
    // Check the full output before selecting an envelope; never publish a
    // previously valid line if a later record reports an inference turn.
    if (envelopes(stdout).some(modelTurn)) throw new Error('AGY_MODEL_TURN_DETECTED');
    const quota = fromAntigravity(stdout, new Date(now()).toISOString(), cliVersion);
    return { ok: true, quota, evidence: { cliVersion, identityScope: plan.identityScope, noModelTurn: 'reported-zero', liveEnabled: false } };
  } catch (error) {
    return { ok: false, quota: null, errorCode: ERRORS.has(error?.message) ? error.message : 'AGY_REQUEST_FAILED', cliVersion };
  }
}
module.exports = { inspectAntigravity };
