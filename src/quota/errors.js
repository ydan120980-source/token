'use strict';
const MESSAGES = Object.freeze({
  CODEX_EXECUTABLE_REQUIRED: '请选择官方 Codex CLI。',
  CODEX_PROCESS_UNAVAILABLE: 'Codex CLI 无法启动，请检查所选程序。',
  SYSTEM_CREDENTIAL_STORE_REQUIRED: '系统凭据存储不可用；本应用不使用明文存储。',
  LOGIN_REQUIRED: '需要在本应用重新完成官方登录。',
  CODEX_REQUEST_TIMEOUT: '读取超时，上次结果作为历史保留。',
  CODEX_PROTOCOL_INVALID: '服务响应格式无效，上次结果作为历史保留。',
  CODEX_PROTOCOL_LIMIT: '服务响应超出限制，上次结果作为历史保留。',
  RATE_LIMITED: '服务明确返回限流，15 分钟后可重试。',
  CANCELED: '操作已取消。',
  LOGIN_CANCELED: '登录已取消。',
  RUNTIME_BUSY: '连接操作尚未结束，请稍后更换 CLI。',
  LOGIN_BUSY_OR_ACCOUNT_LIMIT: '已有登录正在进行，或已达到 20 个连接上限。',
  ACCOUNT_NOT_FOUND: '该连接已移除。',
  CODEX_REQUEST_FAILED: '服务读取失败，上次结果作为历史保留；60 秒后可重试。'
});
function safeCode(error) { return Object.hasOwn(MESSAGES, error?.message) ? error.message : 'CODEX_REQUEST_FAILED'; }
function rpcErrorCode(error) {
  // Only a structured, explicitly identified error qualifies as rate limiting.
  const info = error?.data?.codexErrorInfo;
  if (info === 'rateLimitExceeded') return 'RATE_LIMITED';
  if (info === 'unauthorized') return 'LOGIN_REQUIRED';
  return 'CODEX_REQUEST_FAILED';
}
module.exports = { MESSAGES, safeCode, rpcErrorCode };
