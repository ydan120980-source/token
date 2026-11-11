# Vendored fluid-functionalism

- Upstream: https://github.com/mickadesign/fluid-functionalism, commit `7387f361c07edee7b6447cc2d52301fef13ab180` (2026-10-22), MIT (`LICENSE` in this folder).
- Copied: Radix-flavour components from `registry/radix/`, shared components from `registry/default/`, `registry/default/lib/` and `registry/default/hooks/`. Imports keep upstream's `@/components/ui`, `@/lib` and `@/hooks` paths; `ui/vite.config.ts` and `ui/tsconfig.json` map them here.
- Helper CSS from upstream `app/globals.css` lives in `ui/src/theme/fluid-helpers.css`. Theme values are not copied here; they live in `design/desktop-reference/tokens.css` (`--ff-*`).

## Local changes

Keep this list complete; reapply it when updating from upstream.

| File | Change | Why |
|---|---|---|
| `lib/portal-root.ts` | New. | Every popup renders inside one `[data-ui-portal]` element, which the React layer's scoped base styles cover. |
| `components/dialog.tsx`, `components/select.tsx`, `components/dropdown.tsx` | Portals pass `container={portalRoot()}` (the dialog keeps its own `container` prop first). | Same reason. |
| `components/select.tsx`, `components/dropdown.tsx`, `lib/popup.ts` | `scroll-fade` → `ff-scroll-fade`. | The legacy renderer owns `.scroll-fade` (containers.css, scroll-fade.js). |
| `components/table.tsx` | Row class `is-active` → `ff-row-active`. | The legacy renderer styles `.is-active`. |
| `components/carousel-dots.tsx`, `components/slider.tsx`, `components/switch.tsx` | Class `block` → `[display:block]`. | The legacy renderer styles `.block` (sections). |
| `components/select.tsx`, `components/dropdown.tsx` | Popup enter/exit and exit fallback use `spring.moderate` instead of `fast`. | UI-SPEC section 5; owner explicitly authorized the M1 adaptation on 2026-10-25 (UI-MIG-M1 Q3). Hover and focus transitions remain upstream. |
| `components/accordion.tsx` | Content enter/exit use `spring.moderate` / `.exit`, without separate opacity timings. | Same M1 authorization and disclosure tier. Preserve initial-state and reduced-motion settling. |
| `components/accordion.tsx` | Import and call `useReducedMotionConfig` instead of `useReducedMotion` (two lines). | Owner approval 2026-10-26: use the app MotionConfig when mode changes after mount; reduced/off disclosures reach their existing height target directly. See `docs/m2/UI-DISCLOSURE-MOTION-20261026.md`. |
| `components/tabs.tsx` | The compact selected indicator uses `rounded-[10px]` in the default shape. | Concentric with the 12px track, 2px inside it (`docs/m2/UI-AUDIT-20261104.md`). |
| `components/dialog.tsx` | `DialogContent` takes `closeLabel` for the close button (default "Close"). | The kit Sheet names it in Chinese (M3, 2026-10-25). |
| `components/checkbox-group.tsx` | The row's click handler ignores the click Radix re-dispatches on its hidden form input. | Inside a kit `Form` the re-dispatched click bubbled to the row and toggled again, looping until React stopped it (`UI-MIG-CHECKBOX-FORM-GAP-20261026.md`, approved by Claude 2026-10-27). |
