'use strict';
// Agents without a collection adapter, recognised only by a directory existing.
// Nothing inside these directories is listed or read. Each marker is a guess at
// where the Agent keeps its data; a wrong one only shows or hides a "detected"
// row. A new adapter moves its Agent from here into agent-catalog.js.
// Prefixes: ~ = home, %APPDATA% / %LOCALAPPDATA% = the Windows profile folders.
const TRACES = Object.freeze([
  ['augment', 'Augment', ['~/.augment']],
  ['codebuddy', 'CodeBuddy', ['~/.codebuddy']],
  ['factory', 'Factory Droid', ['~/.factory']],
  ['grok', 'Grok CLI', ['~/.grok']],
  ['iflow', 'iFlow CLI', ['~/.iflow']],
  ['kiro', 'Kiro', ['~/.kiro', '%APPDATA%/Kiro']],
  ['qoder', 'Qoder', ['~/.qoder']],
  ['roo', 'Roo Code', ['%APPDATA%/Code/User/globalStorage/rooveterinaryinc.roo-cline']],
  ['trae', 'Trae', ['~/.trae', '%APPDATA%/Trae']],
  ['windsurf', 'Windsurf', ['~/.codeium/windsurf']]
].map(([id, name, markers]) => Object.freeze({ id, name, markers: Object.freeze(markers) })));
// Where each supported Agent keeps its data. Present but without readable usage
// files means installed without anything to count, not a read failure.
const HOMES = Object.freeze({
  codex: ['~/.codex'], claude: ['~/.claude'], opencode: ['~/.local/share/opencode'], workbuddy: ['~/.workbuddy', '~/.workbuddy-ai'],
  mimo: ['~/.local/share/mimocode'], gemini: ['~/.gemini/tmp'], cursor: ['~/.cursor'], zcode: ['~/.zcode'], deepseek: ['~/.dsh'],
  antigravity: ['~/.gemini/antigravity', '~/.gemini/antigravity-cli', '~/.gemini/antigravity-ide'],
  copilot: ['~/.copilot'], cline: ['%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev', '~/.cline'], pi: ['~/.pi/agent'],
  continue: ['~/.continue'], kilo: ['~/.local/share/kilo','%APPDATA%/Code/User/globalStorage/kilocode.kilo-code'], qwen: ['~/.qwen'], kimi: ['~/.kimi','~/.kimi-code']
});
module.exports = { TRACES, HOMES };
