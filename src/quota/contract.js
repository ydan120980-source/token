'use strict';
function label(value, fallback = null) { return typeof value === 'string' && value.length <= 160 ? value : fallback; }
function positive(value) { return Number.isFinite(value) && value >= 0 ? value : null; }
function projectQuota(response, now = new Date().toISOString()) {
  const buckets = response?.rateLimitsByLimitId && Object.keys(response.rateLimitsByLimitId).length ? Object.entries(response.rateLimitsByLimitId) : [['codex', response?.rateLimits]];
  const windows = [];
  for (const [id, bucket] of buckets) {
    for (const kind of ['primary', 'secondary']) {
      const window = bucket?.[kind];
      if (!window) continue;
      const used = positive(window.usedPercent);
      const seconds = positive(window.resetsAt);
      const resetDate = seconds === null ? null : new Date(seconds * 1000);
      windows.push({ bucket: label(id, 'codex'), name: label(bucket.limitName, label(id, 'Codex')), kind,
        usedPercent: used, remainingPercent: used === null ? null : Math.max(0, 100 - used),
        durationMins: positive(window.windowDurationMins), resetsAt: resetDate && Number.isFinite(resetDate.getTime()) ? resetDate.toISOString() : null });
    }
  }
  return { schemaVersion: 'AccountQuotaV1', fetchedAt: now, windows, resetCredits: Number.isSafeInteger(response?.rateLimitResetCredits?.availableCount) && response.rateLimitResetCredits.availableCount >= 0 ? response.rateLimitResetCredits.availableCount : null };
}
function loginUrlAllowed(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.port && (url.hostname === 'auth.openai.com' && url.pathname === '/oauth/authorize' || url.hostname === 'chatgpt.com' && url.pathname.startsWith('/')); } catch { return false; }
}
function childEnvironment(home, parent = process.env) {
  const result = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH']) if (parent[key]) result[key] = parent[key];
  result.CODEX_HOME = home;
  result.RUST_LOG = 'off';
  return result;
}
function projectCachedQuota(quota) {
  if (quota?.schemaVersion !== 'AccountQuotaV1' || !Array.isArray(quota.windows) || quota.windows.length > 200) return null;
  return { schemaVersion: 'AccountQuotaV1', fetchedAt: label(quota.fetchedAt), windows: quota.windows.map(w => {
    const projected = projectQuota({ rateLimits: { limitName: label(w.name), primary: { usedPercent: w.usedPercent, windowDurationMins: w.durationMins, resetsAt: w.resetsAt ? Date.parse(w.resetsAt) / 1000 : null } } }).windows[0];
    return { ...projected, bucket: label(w.bucket, 'codex'), kind: w.kind === 'secondary' ? 'secondary' : 'primary' };
  }), resetCredits: Number.isSafeInteger(quota.resetCredits) && quota.resetCredits >= 0 ? quota.resetCredits : null };
}
module.exports = { projectQuota, projectCachedQuota, loginUrlAllowed, childEnvironment, label };
