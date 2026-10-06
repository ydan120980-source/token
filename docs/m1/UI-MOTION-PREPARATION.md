# Desktop interaction and motion preparation

Historical preparation record. The user approved activation on 2026-10-04; current implementation and acceptance are in [UI-MOTION-20261004.md](UI-MOTION-20261004.md). The disabled state below describes the earlier revision.

Status: **prepared, disabled**. The user requested preparation but explicitly deferred adding motion. This document does not authorize activation or a new animation library.

## State contract

| Surface / selector | Immediate states to preserve | Future opportunity |
|---|---|---|
| Navigation: [data-view], #main[data-current-view] | aria-current, hidden pages, scroll reset | Page entry/exit |
| Scope: [data-period], [data-metric], filters | aria-pressed, visible summary, data boundaries | Selected indicator / chart update |
| Common buttons | hover / active / focus-visible / disabled | Color/opacity without geometry shift |
| Refresh | disabled during fixture work; real action reloads | Accessible busy indicator |
| Heatmap / day detail | focus, aria-pressed, unknown-versus-zero, keyboard movement | Selected detail entry |
| Trend / tooltip | pointer-following, bounded position, scrollable list, hide on leave | Short opacity only, without pointer lag |
| Habits / model details | weekday selection, dated list, details open | Disclosure entry |
| Dialogs | native showModal / close / focus return | Dialog/backdrop opacity |
| Avatar input | chooser / validation / reading / ready / rejected / cancelled draft | Non-geometric loading feedback |
| Toast | role=status, visibility, timeout cleanup | Entry/exit without delaying reading |

Current hooks: body[data-motion='off'], #main[data-current-view], [data-motion-surface='page'|'statistics'|'dialog']. Existing IDs and ARIA remain the functional source of truth. All state changes remain immediate.

## Runtime stays disabled

- --motion-duration is 0ms; no nonzero duration styles are shipped.
- body[data-motion='off'] disables animation, transition and smooth scrolling on descendants and pseudo-elements.
- Chart.js animation stays false; day navigation scrolls instantly.
- No animation dependency, view-transition call, spring controller or activation media query is added.
- Hover/focus/pressed styling remains immediate; there is no time-based effect.

## Future implementation, only after explicit instruction

Use shared semantic durations: immediate data/focus, short control feedback, moderate page/dialog entry. Proposed review ranges are 80–140ms for feedback and 160–220ms for entry. These are documentation proposals, not active tokens.

Prefer opacity and small transforms while reserving final layout. Avoid token-number tweening, long-page height animation, cursor-following tooltip position animation and full graph replay on every filter.

Cancel pending effects on rapid navigation/filtering or dialog close. A pending avatar read must not overwrite a newer choice or a closed draft. Use the existing state owner, without a second navigation state machine. Focus and live summaries update immediately.

Respect prefers-reduced-motion by using immediate state changes. A future app toggle must not override reduced motion.

## Future observable acceptance

1. Navigation, periods, filters, refresh, export, sources, profile and dialogs work with motion off and reduced motion enabled.
2. Repeated fast actions cause no stale page/overlay/tooltip or permanently disabled Save.
3. Tooltip stays in the graph at wide/narrow sizes, scrolls without trapping the page, follows dates immediately and hides on leave.
4. Keyboard focus and screen-reader state never wait for animation.
5. Native 100%/150% DPI must be checked against the integrated Electron renderer; browser evidence alone does not verify it.

The current revision stops at preparation. Enabling motion requires a subsequent user instruction.
