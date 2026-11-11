// Limits every rule of Tailwind's utilities layer to the React layer: each selector gets the prefix
// `:where([data-ui-root], [data-ui-portal]) ` (zero specificity, so utility order is unchanged).
// Without it a utility such as .block or .visible would restyle legacy elements that use the same
// class name (docs/m2/UI-REACT-FOUNDATION-20261025.md). Used by ui/vite.config.ts on the built CSS.
export const SCOPE = ":where([data-ui-root],[data-ui-portal])";

function close(text, open) {
  let depth = 0, quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error("UI_SCOPE_UNBALANCED");
}

export function splitSelectors(text) {
  const out = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}

// Rewrites the rules of a block body; at-rules (@media, @supports, @container) are entered,
// @keyframes / @property / @font-face are copied as they are.
function scopeBody(body) {
  let out = "", i = 0;
  while (i < body.length) {
    const open = body.indexOf("{", i);
    if (open < 0) { out += body.slice(i); break; }
    const head = body.slice(i, open).trim(), end = close(body, open), inner = body.slice(open + 1, end);
    if (head.startsWith("@")) out += head + "{" + (/^@(media|supports|container|layer|scope)\b/.test(head) ? scopeBody(inner) : inner) + "}";
    else out += splitSelectors(head).map(s => SCOPE + " " + s).join(",") + "{" + inner + "}";
    i = end + 1;
  }
  return out;
}

export function scopeUtilities(css) {
  const marker = "@layer utilities{", at = css.indexOf(marker);
  if (at < 0) throw new Error("UI_SCOPE_NO_UTILITIES");
  const open = at + marker.length - 1, end = close(css, open);
  return css.slice(0, open + 1) + scopeBody(css.slice(open + 1, end)) + css.slice(end);
}
