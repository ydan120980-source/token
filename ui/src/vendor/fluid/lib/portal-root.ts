// Agent Usage: every portalled popup (dialog, select, dropdown) renders inside one
// body-level element marked data-ui-portal, so the scoped base styles of the React
// layer reach it and the renderer's legacy element rules do not (ui/src/theme/index.css).
let currentRoot: HTMLElement | null = null;
export function portalRoot(): HTMLElement {
  if (currentRoot?.isConnected && currentRoot.ownerDocument === document && currentRoot.hasAttribute("data-ui-portal")) return currentRoot;
  let root = document.querySelector<HTMLElement>("[data-ui-portal]");
  if (!root) {
    root = document.createElement("div");
    root.setAttribute("data-ui-portal", "");
    document.body.appendChild(root);
  }
  currentRoot = root;
  return root;
}
