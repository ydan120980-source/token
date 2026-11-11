'use strict';
// The active account-card renderer owns this small keyed DOM reconciler. React
// owns its container; no other page or component is updated through HTML.
(() => {
  const keyOf = node => node.nodeType === 1 ? node.getAttribute('data-key') : null;
  function children(from, to, removed) {
    const previous = [...from.childNodes], keyed = new Map(previous.filter(node => keyOf(node) !== null).map(node => [keyOf(node), node]));
    const remaining = new Set(previous);
    let cursor = from.firstChild;
    for (const next of [...to.childNodes]) {
      const key = keyOf(next), match = key !== null ? keyed.get(key) : cursor && keyOf(cursor) === null && cursor.nodeType === next.nodeType && cursor.nodeName === next.nodeName ? cursor : null;
      if (!match || match.nodeType !== next.nodeType || match.nodeName !== next.nodeName) { from.insertBefore(next, cursor); continue; }
      remaining.delete(match);
      if (match === cursor) cursor = cursor.nextSibling; else from.insertBefore(match, cursor);
      if (match.nodeType !== 1) { if (match.data !== next.data) match.data = next.data; continue; }
      for (const { name } of [...match.attributes]) if (!next.hasAttribute(name)) match.removeAttribute(name);
      for (const { name, value } of [...next.attributes]) if (match.getAttribute(name) !== value) match.setAttribute(name, value);
      children(match, next, removed);
    }
    for (const node of remaining) { removed?.(node); node.remove(); }
  }
  function update(host, html, removed) {
    const template = document.createElement('template'); template.innerHTML = html;
    children(host, template.content, removed);
  }
  window.quotaCardDom = Object.freeze({ update });
})();
