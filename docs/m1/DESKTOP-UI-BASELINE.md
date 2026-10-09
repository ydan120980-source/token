# Current desktop visual baseline — Nowdex Mac

2026-10-04 update: the user approved shared application motion while retaining this visual baseline. See [UI-MOTION-20261004.md](UI-MOTION-20261004.md). The following 2026-10-03 notes preserve the historical disabled state and acceptance boundaries.

2026-10-03 current user instruction supersedes the earlier visual review: use the supplied Nowdex Mac screenshot for the overall desktop UI, font and colors; repair the cropped/stationary trend tooltip and the profile avatar/file input. Prepare interaction/page motion, **keep it disabled**.

Current implementation: gray left sidebar and selected navigation row, pale gray workspace, white 22px-radius cards, system sans-serif for interface/overview figures, monospace for model identifiers, muted blue activity palette and subdued category colors. Retain the existing statistics hierarchy and M1 meanings. The screenshot's monthly bill/projection, subscriber quota and Pro menu are not manufactured.

On Windows, system UI fonts approximate the native Mac appearance; the exact Apple system font is not bundled. The approved reference does not authorize fake macOS window decorations or a stack change. Mobile-width browser checks remain responsive preview checks, not iPhone delivery.

Trend tooltip uses a DOM panel bounded to the plot. It follows pointer/date, flips when needed, keeps all nonzero model rows in a scrolling list, summarizes recorded zero rows, shows the correct total and hides on leave/page scroll/filter changes. The original canvas tooltip is disabled. The list remains stable only while the pointer is inside it so users can scroll.

Avatar preview and header use a shared grid-centered container. Native file selection is wrapped in the review's styled accessible file-input surface. Filename, reading state, validation errors, reset and cancellation are implemented. Asynchronous reads cannot overwrite newer choices or closed drafts. Invalid/oversized input retains the prior avatar. Existing local name/description/color are preserved.

Motion preparation is in [UI-MOTION-PREPARATION.md](UI-MOTION-PREPARATION.md). Runtime motion is off, Chart.js animation is false, and day jumps are instant.

Checks: ESLint / 22 behavior tests, syntax / loopback guards, in-app browser at 1168×778 / 900×760 / 480×800, light/dark, tooltip movement/scroll/hide/bounds, avatar centering and valid/invalid/oversized files. Existing M1 native, Electron and crypto checks passed separately; these do not establish integration of the new renderer. Existing packaged application smoke passed without rebuilding the Windows app.

Current reference is the provided screenshot; no request to fetch a native Codex profile screenshot is needed for this revision. New production renderer integration, native scaling/lifecycle of that renderer and OS export save dialog remain pending. No new credentials, cloud services, live quota or later phase is authorized.

## Historical reference and statistical contract record

The record below describes the earlier tokens.ci iteration. Its data boundaries remain applicable; its horizontal navigation/native-reference request is superseded by the current visual instruction.

# Desktop UI reference revision — 2026-10-03

## Authority and status

The user selected a public token-statistics profile page on tokens.ci as the desktop layout/analysis reference. The specific profile is not reproduced here. Nowdex remains the mobile reference. Eight subsequent browser comments requested model, period, activity-size, total-trend, habit and profile changes. The user clarified the activity/profile target is **the Codex application's own profile page**. Its exact screenshot is still required.

The browser preview in design/desktop-reference now supports read-only projection of the existing M1 saved statistics. It does not replace the M1 runtime, Windows executable, package lock or fixed Tokscale version. The new preparation helper reuses Store.snapshot through the Store prototype and avoids the constructor, which writes state. No new agent scan, authentication read or source configuration change occurs. M1 remains at user review; these records authorize no later phase.

## Reference evidence

The public tokens.ci profile was inspected in the in-app browser on 2026-10-03. Captures remain ignored local evidence under artifacts/tokens-reference. Public account statistics are not copied into fixtures or distributable source.

Observed structure: horizontal navigation, approximately 1200 CSS px outer column, warm pale background, white cards, subtle borders, restrained blue controls, Geist / monospace typography, profile header, overview, Today card, contribution graph, stacked area trends, inline token distribution, weekday patterns and expandable models. Clicking a reference heatmap day was verified; public submission, sharing, 3D and every reference computation were not audited.

References: [reference site repository](https://github.com/missuo/tokens), [MIT license](https://github.com/missuo/tokens/blob/main/LICENSE). The submission pipeline is not adopted.

The enlarged activity graph is provisional from the user's size/interaction comments. It has not been compared against the native Codex profile.

## Hierarchy and scope

1. 用量 / 来源管理 / 设置 navigation, appearance and preview identity.
2. Editable local profile, history coverage / last saved collection, reload and export.
3. Prominent 累计 / 最近 30 天 / 最近 7 天 / 今日 controls and live range/filter summary.
4. Range overview: token, priced USD subtotal / coverage, active days / records, sources; classification strip.
5. Separate Today card with agent/model attribution.
6. Activity and day detail, trend, token distribution, interactive habits, model details and source shortcuts.

Range and agent/model filters apply to the overview and lower analyses. Today remains explicitly Today. Both rolling periods include today. Cumulative activity offers annual/calendar-year controls; shorter scopes use larger date tiles.

## Statistical semantics

| Meaning | Implementation |
|---|---|
| Models | Preserve and escape saved identifiers; do not assign default model versions. Historical names remain. Unknown metadata displays 模型未记录. Logged identifiers do not prove remote routing. |
| Entry | Codex / MiMo Desktop or CLI comes from metadata; unknown/mixed entries are explicit. |
| Counts | 用量记录, without asserting equivalence to messages/sessions. |
| Cost | Existing fixed M1 USD catalog, API 等价估算, priced subtotal and coverage; unknown stays unknown. |
| Token buckets | Input excludes cache. M1 output includes reasoning, so chart output is output minus reasoning, with separate reasoning. |
| Partial / invalid | Null remains unknown and zero remains known. Complete buckets must sum to total; invalid reasoning/total mismatch reduces classification coverage. |
| Trend | Daily, 30-calendar-day average, or selected-range cumulative total. Missing observed coverage/incomplete average stays blank. Reverse order preserves chronological calculations. |
| Habits | Click weekday/highest-use date to inspect records; volume is not proof of productivity. |

Synthetic fixtures use 示例模型 names and independently defined coverage. Saved-data mode does not treat an absent daily row as a measured zero.

## Data and operations

LocalUsagePreviewV1 is a reduced whitelist from UsageSnapshotV1, omitting private local IDs, paths, bodies, titles, accounts, credentials and machine names. Source state, verification flag, last success and numeric quality counters are preserved. It is not the full production contract.

| Operation | Review behavior | Electron integration remaining |
|---|---|---|
| Reload | Latest saved M1 statistics, retaining filters; last valid result survives reread failure. Fixture refresh is explicitly simulated. | Refresh IPC / collector |
| Pause | Removed from header; Settings is enabled only in fixtures, disabled for real data. | Collection switch IPC |
| Sources | Actual saved status/quality; real path editing disabled. Fixture picker is clearly simulated. | System picker / allowed-path validation |
| Profile | Local name, description, avatar color/image in browser local storage. | Own product preferences |
| Export | All/current scope, optional quality; DesignPreviewV1 distinguishes fixtures/saved statistics. Actual download destination unverified. | Main-process save dialog / contract |
| Appearance | Local fonts, light/dark, responsive wrapping and contained scrolling. | Renderer preference |

The loopback Node server uses Host/method/Fetch Metadata checks, fixed assets and a statistical bootstrap. It initiates no external requests. This review transport is not a product HTTP API; formal integration must use restricted preload/IPC.

## Verification and limits

- npm run verify passes ESLint and 20 behavior tests, including five new projection/calculation tests.
- Browser/server Node syntax checks pass. Server guards reject wrong Host, cross-site data, write methods and unlisted paths; HEAD returns no body.
- At the recorded check, saved statistics contained 223 daily rows / 33 model identifiers. Today showed gpt-6.1-sol. Values may advance while the existing collector runs.
- Existing Codex total-mismatch / WorkBuddy invalid-reasoning counters and source acceptance flags remain unchanged.
- Browser checks cover 1168 × 778, 900 × 760 and 480 × 800, without document horizontal overflow.
- Exact Codex native profile comparison, new Windows executable, Electron IPC, native 100%/150% DPI, OS picker/save dialog and production lifecycle/offline acceptance were not performed here. Prior M1 acceptance remains in docs/m1/ACCEPTANCE.md.

3D, public ranking/sharing/embeds/login/uploads, subscription quota and multi-device history stay outside this iteration.
