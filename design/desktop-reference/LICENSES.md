# Asset and dependency attribution

- Design reference: [Tokens](https://github.com/missuo/tokens), MIT, original contributors Junho Yeo and Vincent Yang. The preview was independently implemented from observed public UI; its cloud/CLI/source code is not imported.
- UI icons: [Tabler Icons](https://github.com/tabler/tabler-icons), npm `@tabler/icons` **3.48.0**, MIT. Copyright 2020–2026 Paweł Kuna. Original SVG assets and full license are in `assets/ui/`.
- Typefaces: [Geist](https://github.com/vercel/geist-font), npm `geist` **1.7.2**, SIL Open Font License. Unmodified Geist and Geist Mono variable WOFF2 files; full license in `assets/fonts/LICENSE.txt`.
- Charts: [Chart.js](https://github.com/chartjs/Chart.js), npm `chart.js` **4.5.1**, MIT. Unmodified UMD build; full license in `assets/vendor/LICENSE.md`.
- Agent icons: existing token-monitor assets, retained under the repository's MIT source baseline and attribution in `docs/m1/UPSTREAM.md`. Codex and Claude marks identify their respective sources; they do not indicate affiliation. Generic Tabler icons are used where a source-specific brand asset has not been verified.

Production package.json, package-lock.json and the Tokscale pin are unchanged. These are vendored preview-only dependencies. Any formal integration must preserve the applicable notices.
