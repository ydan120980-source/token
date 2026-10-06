# Current QA — Nowdex Mac visual and display repair

2026-10-03. Reference: user-supplied Nowdex Mac screenshot (image 2). Scope: browser review at http://127.0.0.1:4178/ with the existing M1 saved-statistics projection. The screenshot is evidence for styling only; its account values and Pro/subscription features are not copied.

## Result and changes

Passed the inspected browser flows. Production Electron integration is still pending.

| Reported problem / reference | Repair and current evidence |
|---|---|
| Long tooltip clipped and stuck in place | Disabled canvas tooltip; bounded plot-local DOM panel, dynamic left/right positioning, scrolling model list and hide-on-leave/scroll. Moving from 2026-05-26 to 2026-09-22 changed the date and left position from about 195px to 441px. At 27 nonzero models, list scrollTop reached 300px while header/total/footer stayed visible. |
| Nowdex Mac visual direction | Gray sidebar, dark selected navigation, pale gray workspace, white rounded cards, system sans-serif hierarchy, quieter blue heatmap/category colors. Keep existing M1 four overview metrics and local data semantics. |
| Off-center profile initials | Shared grid centering: observed horizontal center offset below 0.001px, vertical offset zero. |
| File selection not designed | Custom native input surface with file action, format/size hint, filename/reading/ready/error feedback and reset. Valid synthetic PNG works; corrupt PNG and >512KiB image are rejected without replacing the prior avatar or leaving Save disabled. |
| Prepare motion but don't add it | Documented states/selectors/ownership/cancellation and future acceptance. body data-motion off; observed 0 elements with animation names and 0 nonzero transition durations; Chart.js animation false; instant day navigation. |

## Checks

| Check | Result |
|---|---|
| Page identity | Agent Usage desktop preview, localhost4178 |
| Meaningful content / error overlay | Statistics, navigation and profile render; no framework overlay |
| Console | No relevant warnings/errors in inspected final flows |
| Interaction | Tooltip, periods, filters, navigation, profile/file control and date selection verified |
| Wide/narrow | 1168×778, 900×760, 480×800; no document-level horizontal overflow |
| Tooltip narrow bounds | 280×284px panel remains inside the 428.8×300px plot |
| Profile narrow bounds | 444×610px dialog fits the 480×800 viewport |
| Appearance | Light/dark inspected; glyphs and quality notes readable |
| Activity width | Desktop graph scrollWidth equals clientWidth (799px); narrow scrolled graph keeps weekday labels visible |
| Automatic | npm run verify: ESLint and 22/22 tests; preview/chart/server syntax and loopback guard checks passed |
| Existing M1 baseline | test:native / test:ui / experiment:crypto / existing Windows directory-package smoke passed with synthetic inputs |

The Browser plugin's browser skill is not available. The session's supported CUA in-app browser APIs were used for preview validation; scoped CDP mouse input was used for pointer hover/wheel because the locator surface has no hover method. The pre-existing Playwright Electron tests were explicitly required by the approved M1 plan and use isolated synthetic directories; they test the unchanged M1 renderer.

A read-only browser-check expression initially used an unavailable parseFloat helper; it was replaced by direct CSS duration comparisons. This was a check-tool limitation, not an application failure.

## Current evidence

Ignored local evidence under artifacts/tokens-reference:

- nowdex-mac-home.jpg — new sidebar/card/font/color layout, preserved YC profile and actual saved model.
- nowdex-mac-profile.jpg — centered initials, avatar controls and file selection.
- nowdex-mac-trend.jpg — bounded long-list tooltip with date/total.
- nowdex-mac-activity.jpg — activity palette and date details.
- nowdex-mac-narrow.jpg — responsive narrow layout.
- nowdex-mac-dark.jpg — dark surface and contrast.

Compare against supplied image 2: sidebar/content surfaces, card radius and blue heatmap follow the Mac reference. Intentional differences: Windows font fallback, existing four statistical metrics and section hierarchy, own product name, and no subscription/Pro or simulated Mac window controls. The screenshot is a partial view; no exact full-app clone claim is made.

## Limits

Only the preview UI and new synthetic geometry/summary tests changed. Production collectors, contracts, pricing, restricted IPC and the Windows executable remain unchanged. No active animation or animation dependency was added. Browser file-input handling was inspected; native Windows file-dialog appearance and browser JSON download destination were not verified. Source quality/real-sample verification limits remain as before.

The new renderer still needs separate Electron integration and native Windows 100%/150% scaling/lifecycle acceptance. Existing Electron baseline results cannot substitute for that acceptance. No iPhone, cloud, live billing or provider-route verification occurred.

## Historical eight-comment revision evidence

The record below is historical. Its native Codex screenshot request and previous visual baseline do not define the current Nowdex Mac visual review.

# Desktop UI revision QA — 2026-10-03

## Result

The eight-comment revision passes the inspected data and browser interactions. **Exact visual alignment with the Codex native application profile remains pending a reference screenshot.** This is a browser review build, not a new Windows executable or completed Electron renderer integration.

Desktop layout/analysis reference: https://tokens.ci/u/ydan120980-source. The user separately clarified that the activity/profile target is the Codex app's own page. Native app observation is unavailable in this session; no screenshot of that page was supplied.

## Comment resolution

| Comment | Change and observed evidence |
|---|---|
| 1 / 4 / 6 — wrong models | Removed hardcoded model-version fixtures. Saved mode displays M1's stored daily model identifiers; Today showed gpt-6.1-sol. Historical GPT/Claude/custom names remain as logged. Fixture mode uses clearly labelled 示例模型 names. Unknown metadata displays 模型未记录. |
| 2 — period buttons appear ineffective | Controls moved above overview. Scope summary, overview, activity, trend, mix, habits and model table now respond together. Today card remains explicitly Today. 7/30 periods include today. |
| 3 — heatmap too small | Annual graph expands across the content width; cells approximately double in size. All seven weekday labels, hover/focus date values, click-day detail and arrow-key/Enter operation are available. Short periods use large date tiles. Native Codex exact style comparison pending. |
| 5 — add total | Added 累计总量 alongside daily and 30-calendar-day average, plus aggregated tooltip total. Calculation remains chronological under newest-first display. |
| 7 — habits lack interactions | Weekday bars and busiest-weekday metric open dated records; date buttons and highest-usage-day metric navigate to the actual day detail. |
| 8 — profile and pause | Editable name/bio, avatar color or local image; default review profile Ydan / 我的 AI 协作记录. Removed header pause. Settings control is disabled in saved mode until desktop IPC integration. |

## Automatic checks

- npm run verify: ESLint and **20/20** behavior tests pass. Existing M1 code and dependencies are unchanged.
- Five new synthetic tests independently cover whitelist/model/null/zero preservation; calendar range and cumulative/reversed series; unknown coverage and incomplete averages; reading a changed saved store twice without source writes/new files; and disjoint bucket/total-mismatch semantics.
- Independent token ledger: 100 uncached input + 6 non-reasoning output + 10 cache read + 0 cache write + 4 reasoning = 120 total. A mismatched 125 total is excluded from the complete distribution.
- Node syntax checks pass for preview.js and serve.js.
- Loopback server checks pass: wrong Host / cross-site statistics / POST rejected; unlisted source/statistics/cache paths return 404; HEAD has no body. The bootstrap contains only the projected contract. The guard check uses a fresh saved snapshot because the existing collector may advance the source sequence.
- Read-only preparation reports unchanged source hash at the recorded invocation. The helper avoids Store construction and imports no collector.
- Extracted preview archive import/test validation is recorded in the adjacent delivery manifest.

## Browser checks

All were performed through the Codex in-app browser:

- Saved-data mode reads the existing product cache, with 223 daily aggregation rows and 33 model identifiers at the recorded check. Newer saved values appeared after 重新载入; current range/agent/model/display choices persisted. Values in screenshots are time-of-capture values.
- All four periods visibly change scope and totals. Agent/model selection, model legend filter/reset, daily/average/total trend, token/cost and newest-first controls operate.
- Enlarged graph day selection, selected-day breakdown and date inspection work. Weekday/highest-day controls open matching dates; example checks included 2026-08-12 and 2026-09-30.
- Profile name/bio/avatar color persist after reload. Oversized image (1,061,695 bytes) is rejected; synthetic small PNG saves and survives reload. Restored teal YD initials for delivery; no personal avatar is packaged.
- Real source page preserves partial-support/verification states. Saved-mode pause/path editing are disabled rather than pretending to control the collector.
- Visible export review: DesignPreviewV1, demo false, dataKind saved-local-statistics; 223 rows for cumulative scope at the check. Optional source metadata can be excluded. Body/title/path/session/email/credential fields are absent. The local download control was triggered; actual saved file location remains unverified.
- Synthetic partial case retains cache read 990.0K and cache write 0; input/output-minus-reasoning/reasoning show unknown. Empty case does not fabricate zero. Failed-read fixture retains historical totals and identifies the failure.
- Light/dark checked with real data. Black Codex glyph was corrected for dark contrast and inspected after reload.
- CSS viewport checks: 1168 × 778, 900 × 760 and 480 × 800. No document-level horizontal overflow; annual graph scrolls within its own container on narrow windows. Temporary overrides reset after checking.
- No warning/error console messages in inspected real and synthetic flows.

## Evidence

Current ignored local captures under artifacts/tokens-reference:

- revision-home.jpg — saved statistics, editable Ydan profile, prominent scope controls and actual logged Today model.
- revision-activity.jpg — enlarged annual graph, all weekday labels and selected-day detail.
- revision-habits.jpg — opened weekday/date interaction.
- revision-dark.jpg — saved-data dark surface and corrected Codex glyph.
- revision-mobile.jpg — narrow-window layout.

Prior reference evidence remains historical: top.jpg / preview-top.jpg, contributions.jpg / preview-contributions.jpg, comparison-top.png, comparison-contributions.png, comparison-mix-before.png / comparison-mix-after.png, and comparison-habits-after.png. Those comparisons used the previous synthetic preview and tokens.ci; they do not establish equivalence to the native Codex page.

Screenshots remain local evidence and are excluded from distributable source, together with real statistics, profile preferences, credentials, logs, caches and test artifacts.

## Remaining acceptance and boundaries

- Exact native Codex profile reference/comparison requires the user's screenshot.
- This saved-statistics projection reads only M1's own product store; it is not a new scan or proof of upstream provider routing. Existing Codex 2 total-mismatch and WorkBuddy 4 invalid-reasoning counters at the check remain partial support, with unchanged source verification flags.
- Fixed prices yield API-equivalent estimates; unknown or unpriced values remain unknown. No billing/quota/account integration occurred.
- Browser exports use a review envelope, not the complete production UsageSnapshotV1. Actual browser destination and Electron save-dialog acceptance remain pending.
- No new Electron executable, native 100%/150% Windows DPI, OS directory picker, tray/lifecycle, production offline verification, iPhone or cloud/E2EE acceptance was performed in this revision. Prior M1 acceptance stays in docs/m1/ACCEPTANCE.md.
- Fonts use Windows Chinese fallbacks. Native Codex styling may require further changes after the screenshot. Canvas trends still rely on pointer tooltips and visible summaries; full keyboard exploration is deferred.

final result: partial — requested data/interaction fixes verified; native Codex reference comparison and production renderer integration pending.
