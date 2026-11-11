// One production App root. The mount API is retained for isolated gallery/clean-room
// acceptance windows, never used to mount production pages.
import { StrictMode, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import "./theme/index.css";
import "./kit/app-presentation";
import { UiProviders } from "./providers";
import { islands } from "./dev/fixtures";
import { App } from "./app";
import { appShell } from "./app-store";

export type IslandProps = Record<string, unknown>;
export interface MountedIsland {
  update(props: IslandProps): void;
  unmount(): void;
}

const mounted = new WeakMap<Element, { root: Root; name: string }>();

function render(root: Root, Island: ComponentType<IslandProps>, props: IslandProps) {
  root.render(
    <StrictMode>
      <UiProviders>
        <Island {...props} />
      </UiProviders>
    </StrictMode>
  );
}

// Mounts a registered island into an element the legacy page owns. The element becomes a React
// root (data-ui-root), which is what scopes the React layer's base styles and token names.
function mount(name: string, element: Element, props: IslandProps = {}): MountedIsland {
  const Island = islands[name];
  if (!Island) throw new Error("UI_ISLAND_UNKNOWN: " + name);
  if (mounted.has(element)) throw new Error("UI_ISLAND_ALREADY_MOUNTED: " + name);
  element.setAttribute("data-ui-root", "");
  element.setAttribute("data-ui-island", name);
  const root = createRoot(element);
  mounted.set(element, { root, name });
  render(root, Island, props);
  return {
    update(next) { render(root, Island, next); },
    unmount() {
      root.unmount();
      mounted.delete(element);
      element.removeAttribute("data-ui-root");
      element.removeAttribute("data-ui-island");
    },
  };
}

declare global {
  interface Window {
    agentUi: Readonly<{ version: string; islands: readonly string[]; mount: typeof mount }>;
  }
}

window.agentUi = Object.freeze({ version: __AGENT_UI_VERSION__, islands: Object.freeze(Object.keys(islands)), mount });

const appElement = document.getElementById("app");
if (appElement) {
  const root = createRoot(appElement);
  // Data hosts loaded next can read the shell elements synchronously. Pages
  // activate only after those hosts finish loading, within this same root.
  flushSync(() => root.render(<UiProviders><App /></UiProviders>));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", appShell.start, { once: true });
  else appShell.start();
}
