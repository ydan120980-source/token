'use strict';
// What the React layer's stylesheet could do to legacy markup (docs/m2/UI-REACT-FOUNDATION-20261025.md).
// Tailwind utilities apply to any element that carries their class name, so a utility class that the
// legacy renderer also uses would restyle legacy elements; the same goes for shared @keyframes names
// and for theme variables Tailwind declares on :root. tests/m1/ui-bundle.test.js asserts the report.
const fs = require('node:fs');
const path = require('node:path');

const DESIGN = path.resolve(__dirname, '../../design/desktop-reference');

// The body of one top-level @layer block in minified CSS.
function layerBody(css, name) {
  const at = css.indexOf('@layer ' + name + '{');
  if (at < 0) return '';
  let depth = 0, i = css.indexOf('{', at);
  const start = i + 1;
  for (; i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) break; }
  return css.slice(start, i);
}

function utilityClasses(css) {
  const out = new Set();
  for (const match of layerBody(css, 'utilities').matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) out.add(match[1].replace(/\\(.)/g, '$1'));
  return out;
}

// Class-like words the legacy renderer can put on an element: class selectors in its stylesheets,
// and every word inside a string literal of its scripts and markup (over-approximate on purpose).
function legacyWords() {
  const words = new Set();
  for (const file of fs.readdirSync(DESIGN)) {
    if (!/\.(css|js|html)$/.test(file) || file === 'serve.js') continue;
    const text = fs.readFileSync(path.join(DESIGN, file), 'utf8');
    if (file.endsWith('.css')) { for (const match of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) words.add(match[1]); continue; }
    for (const match of text.matchAll(/['"`]([^'"`\n]{1,600})['"`]/g)) for (const word of match[1].split(/[\s'"<>=]+/)) if (/^[A-Za-z_][A-Za-z0-9_:-]*$/.test(word)) words.add(word);
  }
  return words;
}

function legacyCss() {
  return fs.readdirSync(DESIGN).filter(file => file.endsWith('.css') && file !== 'legacy.css').map(file => fs.readFileSync(path.join(DESIGN, file), 'utf8')).join('\n');
}

function report(css = fs.readFileSync(path.join(DESIGN, 'ui/agent-ui.css'), 'utf8')) {
  const words = legacyWords(), legacy = legacyCss();
  const legacyKeyframes = new Set([...legacy.matchAll(/@keyframes\s+([\w-]+)/g)].map(match => match[1]));
  const legacyVars = new Set([...legacy.matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));
  const theme = layerBody(css, 'theme');
  const themeVars = new Set([...theme.matchAll(/(--[\w-]+):/g)].map(match => match[1]));
  return {
    classes: [...utilityClasses(css)].filter(name => words.has(name)).sort(),
    keyframes: [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(match => match[1]).filter(name => legacyKeyframes.has(name)).sort(),
    variables: [...themeVars].filter(name => legacyVars.has(name)).sort(),
  };
}

module.exports = { report, utilityClasses, layerBody };
if (require.main === module) console.log(JSON.stringify(report(), null, 2));
