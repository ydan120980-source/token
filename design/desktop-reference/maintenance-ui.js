'use strict';
/**
 * Settings shell for the two maintenance blocks. The pricing panel renders
 * itself into #usageMaintenance (pricing-controller.js) and the Codex rebuild
 * mounts into #codexMount (codex-maintenance.js). This file only guarantees
 * both containers exist and keeps them inside #usageMaintenance, which is what
 * the `#usageMaintenance summary` / `.pricing-help` styles are scoped to.
 * It must run after the pricing controller, which builds the panel with one
 * innerHTML assignment and would otherwise discard an already appended block.
 */
(() => {
  const bridge = window.usageBridge, host = document.getElementById('usageMaintenance');
  if (!bridge || !host || document.getElementById('codexMaintenance')) return;
  host.insertAdjacentHTML('beforeend', '<details class="block" id="codexMaintenance"><summary>Codex 用量维护 </summary><div id="codexMount"></div></details>');
})();
