'use strict';

// Built-in modules only; no paths, code or endpoints supplied by the renderer.
const adapters = Object.freeze({
  'gemini-web': Object.freeze({ ...require('./provider-adapters/gemini-web'), rawArray: true, emptyAllowed: false }),
  'opencode-zen': Object.freeze({ ...require('./provider-adapters/opencode-zen'), rawArray: false, emptyAllowed: false }),
  'opencode-web': Object.freeze({ ...require('./provider-adapters/opencode-web'), rawArray: false, emptyAllowed: false }),
  'deepseek-web': Object.freeze({ ...require('./provider-adapters/deepseek-web'), rawArray: false, emptyAllowed: false }),
  'claude-web': Object.freeze({ ...require('./provider-adapters/claude-web'), rawArray: false, emptyAllowed: false }),
  'claude-oauth': Object.freeze({ parse: require('./provider-adapters/claude-web').parse, rawArray: false, emptyAllowed: false }),
  'zcode-device': Object.freeze({ ...require('./provider-adapters/zcode-device'), rawArray: false, emptyAllowed: true }),
  'workbuddy-desktop': Object.freeze({ ...require('./provider-adapters/workbuddy-desktop'), rawArray: false, emptyAllowed: false }),
  'workbuddy-web': Object.freeze({ ...require('./provider-adapters/workbuddy-web'), rawArray: false, emptyAllowed: false }),
  'mimo-web': Object.freeze({ ...require('./provider-adapters/mimo-web'), rawArray: false, emptyAllowed: false }),
  'cursor-web': Object.freeze({ ...require('./provider-adapters/cursor-web'), rawArray: false, emptyAllowed: false }),
  'gemini-code-assist': Object.freeze({ ...require('./provider-adapters/gemini-code-assist'), rawArray: false, emptyAllowed: false }),
  'deepseek-api': Object.freeze({ ...require('./provider-adapters/deepseek-api'), rawArray: false, emptyAllowed: false }),
  'workbuddy-credit': Object.freeze({ ...require('./provider-adapters/workbuddy-credit'), rawArray: false, emptyAllowed: false }),
  'opencode-go': Object.freeze({ ...require('./provider-adapters/opencode-go'), rawArray: false, emptyAllowed: false }),
  'zai-cn': Object.freeze({ ...require('./provider-adapters/zai-cn'), rawArray: false, emptyAllowed: false }),
  'zai-global': Object.freeze({ ...require('./provider-adapters/zai-cn'), rawArray: false, emptyAllowed: false }),
});
module.exports = { adapters };
