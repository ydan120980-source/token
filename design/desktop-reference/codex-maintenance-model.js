'use strict';
/**
 * The Codex rebuild preview sentence, moved verbatim out of the retired codex-maintenance.js
 * (M3, 2026-10-25). Pure data only; the React settings page asks the bridge and shows this.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.codexMaintenanceModel = factory();
})(typeof window === 'undefined' ? this : window, function () {
  /** next = rebuilt + retained tokens of the same preview, not a sum across accounts or Agents. */
  function previewText(value) {
    const next = value.rebuiltTokens + value.retainedTokens;
    return value.files + ' 个文件 · ' + value.records + ' 条重建记录。原有 ' +
      value.previousTokens.toLocaleString('zh-CN') + ' → ' + next.toLocaleString('zh-CN') + ' token（差额 ' +
      (next - value.previousTokens).toLocaleString('zh-CN') + '）；其中保留不可重读历史 ' +
      value.retainedTokens.toLocaleString('zh-CN') + ' token。';
  }
  return { previewText };
});
