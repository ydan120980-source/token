// Builds the React layer into design/desktop-reference/ui as one classic script and one stylesheet:
// the renderer loads them with <script src> / <link> under CSP script-src 'self' (no modules, no
// eval, no network). Output is committed and checked byte for byte by tests/m1/ui-bundle.test.js.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { createRequire } from "node:module";
import type { Plugin } from "vite";
import { scopeUtilities } from "./scripts/scope-utilities.mjs";
import { licenseNotices } from "./scripts/license-notices.mjs";

const require = createRequire(import.meta.url);
const vendor = path.resolve(__dirname, "src/vendor/fluid");

// Utilities apply only inside React roots (ui/scripts/scope-utilities.mjs); license notices ship beside the bundle.
const scopeLayer = (): Plugin => ({
  name: "agent-ui-scope-utilities",
  enforce: "post",
  generateBundle(_, bundle) {
    for (const file of Object.values(bundle)) if (file.type === "asset" && file.fileName.endsWith(".css")) file.source = scopeUtilities(String(file.source));
    // Third-party notices for what the bundle contains (ui/scripts/license-notices.mjs).
    const ids = Object.values(bundle).flatMap(file => (file.type === "chunk" ? Object.keys(file.modules) : []));
    this.emitFile({ type: "asset", fileName: "agent-ui.LICENSES.txt", source: licenseNotices(ids, vendor, path.resolve(__dirname, "../node_modules")) });
  },
});

export default defineConfig(({ mode }) => ({
  root: __dirname,
  plugins: [react(), tailwindcss(), scopeLayer()],
  // Vendored fluid-functionalism files keep their upstream "@/..." imports.
  resolve: {
    alias: [
      { find: /^@\/components\/ui\//, replacement: vendor + "/components/" },
      { find: /^@\/lib\//, replacement: vendor + "/lib/" },
      { find: /^@\/hooks\//, replacement: vendor + "/hooks/" },
      { find: /^@ui\//, replacement: path.resolve(__dirname, "src") + "/" },
    ],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode === "development" ? "development" : "production"),
    __AGENT_UI_VERSION__: JSON.stringify(require("../package.json").version),
  },
  build: {
    outDir: process.env.AGENT_UI_OUT || path.resolve(__dirname, "../design/desktop-reference/ui"),
    emptyOutDir: true,
    target: "chrome130",
    cssCodeSplit: false,
    sourcemap: false,
    reportCompressedSize: false,
    lib: {
      entry: path.resolve(__dirname, "src/main.tsx"),
      formats: ["iife"],
      name: "AgentUiBundle",
      fileName: () => "agent-ui.js",
      cssFileName: "agent-ui",
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
}));
