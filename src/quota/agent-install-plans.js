'use strict';
// Provider IDs, packages and download services are owned by the backend.
const plans = Object.freeze({
  codex: { kind: 'npm-native', package: '@openai/codex', binary: 'codex.exe' },
  claude: { kind: 'npm-native', package: '@anthropic-ai/claude-code', platform: arch => '@anthropic-ai/claude-code-win32-' + arch, binary: 'claude.exe' },
  opencode: { kind: 'npm-native', package: 'opencode-ai', platform: arch => 'opencode-windows-' + arch, binary: 'opencode.exe' },
  mimo: { kind: 'npm-native', package: '@mimo-ai/cli', platform: arch => '@mimo-ai/mimocode-windows-' + arch, binary: 'mimo.exe', alternate: 'mimocode.exe' },
  gemini: { kind: 'npm', package: '@google/gemini-cli', entry: 'bundle/gemini.js', js: true },
  deepseek: { kind: 'npm', package: '@deepseek-ai/dsh', entry: 'lib/bin.js', js: true },
  antigravity: { kind: 'binary', binary: 'agy.exe' },
  workbuddy: { kind: 'desktop', publisher: 'Tencent|腾讯', executable: 'WorkBuddy.exe' },
  cursor: { kind: 'desktop', publisher: 'Anysphere', executable: 'Cursor.exe' },
  zcode: { kind: 'desktop', publisher: 'Zhipu|智谱', executable: 'ZCode.exe' }
});
const VERSION = /^(?:v)?(\d{1,4}(?:\.\d{1,9}){2,3}(?:-[a-zA-Z0-9.-]{1,80})?)$/;
function version(value) { const match = typeof value === 'string' && value.length <= 120 && VERSION.exec(value.trim()); return match ? match[1] : null; }
function newer(next, previous) {
  if (!version(next) || !version(previous)) return null;
  const split = text => { const [main, pre = ''] = text.split(/-(.*)/s); return [main.split('.').map(BigInt), pre]; };
  const [a, ap] = split(next), [b, bp] = split(previous);
  for (let n = 0; n < Math.max(a.length, b.length); n++) { if ((a[n] || 0n) !== (b[n] || 0n)) return (a[n] || 0n) > (b[n] || 0n); }
  if (ap === bp) return false;
  if (!ap || !bp) return !ap;
  const aa = ap.split('.'), bb = bp.split('.');
  for (let n = 0; n < Math.max(aa.length, bb.length); n++) { if (aa[n] === bb[n]) continue; if (aa[n] === undefined || bb[n] === undefined) return aa[n] !== undefined; const an = /^\d+$/.test(aa[n]), bn = /^\d+$/.test(bb[n]); return an && bn ? BigInt(aa[n]) > BigInt(bb[n]) : an !== bn ? !an : aa[n] > bb[n]; }
  return false;
}
module.exports = { plans, version, newer };
