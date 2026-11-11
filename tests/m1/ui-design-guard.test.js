'use strict';
// The React layer's design guard (docs/m2/UI-SPEC-20261025.md, "自动检查"). Every visual value comes
// from the spec: colours, sizes, radii and motion are tokens, never literals, and pages compose
// kit components instead of styling or animating anything themselves. Exceptions live in
// ui/design-guard-allow.json, each with a reason; only the spec owner (Claude) adds them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '../../ui/src');
const ALLOW = require('../../ui/design-guard-allow.json');

// vendor: upstream fluid-functionalism; theme and design: the spec itself.
const EXEMPT = ['vendor', 'theme', 'design'];
// Folders whose files may only compose kit components.
const COMPOSE_ONLY = ['pages', 'islands', 'data'];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : [full];
  });
}

const RULES = [
  { id: 'colour-literal', test: /#[0-9a-fA-F]{3,8}\b|\b(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/g, why: 'colours come from tokens (bg-surface-*, text-foreground, bg-agent-* …)' },
  { id: 'arbitrary-value', test: /\b[a-z][a-z0-9-]*-\[[^\]\s]+\]|(?<![\w-])\[[a-z-]+:[^\]\s]+\]/g, why: 'no Tailwind arbitrary values or properties; use a theme utility' },
  { id: 'default-type-size', test: /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/g, why: 'type sizes: text-display/title/subtitle/body/caption/micro and text-figure-xl/lg/md/sm' },
  { id: 'palette-colour', test: /\b(bg|text|border|ring|fill|stroke|outline|divide|from|via|to|shadow|accent|caret|decoration|placeholder)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)\b/g, why: 'no Tailwind palette colours; use semantic or identity tokens' },
  { id: 'font-weight', test: /\bfont-(thin|extralight|light|bold|extrabold|black)\b/g, why: 'weights: font-normal, font-medium, font-semibold' },
  { id: 'radius', test: /\brounded(-[trbl]{1,2}|-[se]{1,2})?(-(xs|sm|md|3xl|4xl))?(?![\w-])/g, filter: (match, text, at) => !/-(lg|xl|2xl|full|none)$/.test(match) && !(text[at - 1] === '"' && text[at + match.length] === '"'), why: 'radii: rounded-lg (controls 8), rounded-xl (popups 12), rounded-2xl (cards 16), rounded-full' },
  { id: 'important', test: /(?<=["'`\s])![a-z]+-[\w:-]*/g, why: 'no !important utilities' },
  { id: 'motion-literal', test: /transition=\{\{|\b(duration|delay|stiffness|damping|mass|bounce|visualDuration)\s*:\s*\d/g, why: 'motion values come from ui/src/design/motion.ts (spring.fast/moderate/slow, data.enter/update)' },
  { id: 'css-motion-utility', test: /\b(duration|ease|delay)-(?!80\b|160\b|240\b)[a-z0-9-]+|\banimate-[a-z-]+/g, why: 'CSS transitions only at the spring tiers: duration-80 / duration-160 / duration-240' },
  { id: 'inner-html', test: /dangerouslySetInnerHTML|\.innerHTML\s*=/g, why: 'no HTML injection' },
];

const COMPOSE_RULES = [
  { id: 'kit-only-import', test: /from\s+["'](@\/(components|lib|hooks)\/[^"']+|motion(\/react)?|@radix-ui\/[^"']+|@base-ui\/[^"']+)["']/g, why: 'pages import @ui/kit (and @ui/data), never fluid, Motion or Radix directly' },
  { id: 'page-hover', test: /\b(group-)?hover:/g, why: 'hover behaviour lives in kit components' },
  { id: 'page-style', test: /\bstyle=\{/g, why: 'pages do not style elements inline' },
  { id: 'page-transition', test: /\btransition(-[a-z]+)?\b(?=[^"'`]*["'`])/g, why: 'pages do not declare transitions' },
];

function violations() {
  const out = [];
  for (const file of files(SRC)) {
    const relative = path.relative(SRC, file).replace(/\\/g, '/'), top = relative.split('/')[0];
    if (EXEMPT.includes(top)) continue;
    if (file.endsWith('.css')) { out.push(relative + ': stylesheets live in ui/src/theme only'); continue; }
    if (!/\.(tsx?|mts)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    const rules = COMPOSE_ONLY.includes(top) ? [...RULES, ...COMPOSE_RULES] : RULES;
    for (const rule of rules) for (const match of text.matchAll(rule.test)) {
      const hit = match[0].trim();
      if (rule.filter && !rule.filter(hit, text, match.index + match[0].indexOf(hit))) continue;
      if (ALLOW.some(entry => entry.file === relative && entry.rule === rule.id && entry.match === hit)) continue;
      out.push(relative + ' [' + rule.id + '] ' + hit + ' — ' + rule.why);
    }
  }
  return out;
}

test('React layer code takes every visual value from the spec', () => {
  assert.deepEqual(violations(), []);
});

test('every guard exception names its file, rule, exact match and reason', () => {
  for (const entry of ALLOW) {
    assert.ok(fs.existsSync(path.join(SRC, entry.file)), 'allowlisted file exists: ' + entry.file);
    assert.ok(entry.rule && entry.match && entry.reason && entry.reason.length >= 12, 'complete entry: ' + JSON.stringify(entry));
  }
});

module.exports = { violations };
