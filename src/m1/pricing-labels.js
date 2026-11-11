'use strict';
// Why usage is left out of the estimate, in the words the window and the cost export
// share. Loaded by the renderer (window.pricingLabels) and required by the main process.
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.pricingLabels = factory();
})(typeof window === 'undefined' ? this : window, function() {
  const REASONS = Object.freeze({
    'model-unpriced': '价格目录中没有此模型',
    'price-unverified': '只有待核实的参考价，不计入估算',
    'time-tariff-unreported': '高峰 / 空闲费率 · 显示当前价范围',
    'usage-incomplete': '用量字段不完整或冲突',
    'rate-missing': '目录缺少该模型的部分费率',
    'cache-write-unreported': '缓存写入未报告 · 显示范围',
    'context-unreported': '请求上下文长度未报告 · 显示范围',
    'reasoning-unreported': '推理输出数量未报告 · 显示范围',
    'long-context': '已应用长上下文费率',
    'usage-lower-bound': '记录不完整 · 按已报告字段算的下限',
    exact: '桶字段已匹配'
  });
  // Why incomplete usage cannot be priced, as the source left it. No price decision fixes these.
  const CAUSES = Object.freeze({
    'missing-inputUncached': '来源没有报告输入 Token',
    'missing-output': '来源没有报告输出 Token',
    'missing-cacheRead': '来源没有报告缓存读取',
    'missing-cacheWrite': '来源没有报告缓存写入',
    'missing-reasoning': '来源没有单独报告推理 Token',
    conflict: '两个来源记下的用量不一致',
    'invalid-cache': '缓存数量大于输入，记录自相矛盾',
    'invalid-reasoning': '推理数量大于输出，记录自相矛盾',
    'total-mismatch': '分项之和与总量对不上',
    partial: '用量字段不完整'
  });
  // Reasons a price decision (a manual price or a mapping) can close.
  const FIXABLE = Object.freeze(['model-unpriced', 'price-unverified', 'rate-missing']);
  function remediation(reason, cause) {
    if (FIXABLE.includes(reason)) return {summary:'可通过设置计费处理',steps:['核对实际计费服务商和模型，再选择已有模型映射或填写已确认的每百万 Token 价格。','保存后按新规则重新估算历史；若仍提示缺少用量字段，还需按对应来源说明处理。']};
    if (cause === 'missing-cacheWrite') return {summary:'先核对写入计费与来源字段',steps:['先确认实际服务商是否单独收取缓存写入费；只有确认不收费时，才在手动价格中将缓存写入费率设为 0，其余费率也应按实际服务商核对。订阅套餐或免费额度不等于该项单价为 0。','若收取写入费，检查原始记录是否包含缓存写入数量。个人来源可在“编辑规则”映射该字段，预览后应用；内置来源可更新 Agent 后重新检查。','原始文件从未记录的历史写入数量无法通过同步价格或重复扫描补齐；继续保留为未知。']};
    if (cause?.startsWith('missing-')) return {summary:'需检查用量字段；补价格无法补齐',steps:['在下方对应来源检查读取状态与“解析能力与字段覆盖”。个人来源检查“编辑规则”中的字段路径和计数语义，先预览再应用。','内置来源可更新 Agent，并在有完整用量记录后重新检查。原始记录含有字段而应用仍缺失时，应核对解析适配；不要手动把未知数量改成 0。','原始文件没有记录的历史字段无法恢复；同步价格不会补出这些用量。完整记录仍正常参与估算。']};
    return {summary:'需核对用量记录；改价格不能消除冲突',steps:['在对应来源查看读取状态和冲突诊断，核对是否存在重复导出、不同规则或分项与总量不一致。','个人来源检查缓存、推理的包含关系，修改映射后先预览；内置来源保留原始文件以便定位解析问题。','重新检查后仍有矛盾的历史保持未知，不合并冲突桶，也不补零。']};
  }
  return Object.freeze({ REASONS, CAUSES, FIXABLE, remediation });
});
