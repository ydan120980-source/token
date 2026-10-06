'use strict';
/**
 * Codex usage maintenance: preview a rebuild, then apply it behind a
 * confirmation. The renderer only ever asks; main performs the write and the
 * backup. Kept separate from the pricing panel because it repairs collection
 * data, not pricing rules.
 */
(() => {
  const bridge = window.usageBridge, host = document.getElementById('codexMount');
  if (!bridge || !host) return;
  const $ = id => document.getElementById(id);
  let candidate = null;
  host.innerHTML = '<div class="card pricing-card">' +
    '<details class="pricing-help"><summary>重建说明</summary>' +
    '<p>先预览差额，再备份并重建本应用中可重读的 Codex 会话。保留原始日志、其他来源、账号连接及无法重读的历史。缺失旧日志无法凭个人页总量恢复。</p></details>' +
    '<button id="codexPreview">扫描并预览重建</button> ' +
    '<button id="codexApply" class="primary" disabled>备份并应用重建</button>' +
    '<p id="codexPreviewResult" role="status"></p></div>';
  window.uiMotion.observeStatus($('codexPreviewResult'));
  $('codexPreview').addEventListener('click', async () => {
    candidate = null; $('codexApply').disabled = true; $('codexPreview').disabled = true;
    $('codexPreviewResult').textContent = '正在只读扫描…';
    try {
      candidate = await bridge.previewCodex();
      const value = candidate, next = value.rebuiltTokens + value.retainedTokens;
      $('codexPreviewResult').textContent = value.files + ' 个文件 · ' + value.records + ' 条重建记录。原有 ' +
        value.previousTokens.toLocaleString('zh-CN') + ' → ' + next.toLocaleString('zh-CN') + ' token（差额 ' +
        (next - value.previousTokens).toLocaleString('zh-CN') + '）；其中保留不可重读历史 ' +
        value.retainedTokens.toLocaleString('zh-CN') + ' token。';
      $('codexApply').disabled = false;
    } catch {
      candidate = null;
      $('codexPreviewResult').textContent = '扫描未完成、来源不完整或已有采集正在运行；统计未修改，请稍后重试。';
    } finally { $('codexPreview').disabled = false; }
  });
  $('codexApply').addEventListener('click', async () => {
    if (!candidate) return;
    $('codexApply').disabled = true;
    try {
      const result = await bridge.applyCodex(candidate.id);
      $('codexPreviewResult').textContent = result.applied ? '已备份并重建；原始日志和账号连接保留。' : '已取消，统计未修改。';
      candidate = null;
    } catch {
      $('codexPreviewResult').textContent = '预览已过期或应用失败，统计未替换；请重新扫描预览。';
      candidate = null;
    }
  });
})();
