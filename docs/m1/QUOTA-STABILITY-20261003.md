# Windows Codex quota stability — 2026-10-03

> Historical delivery. The later user-approved maintenance unified the UI and retired superseded builds. Current paths and tests are in [MAINTENANCE-20261003.md](MAINTENANCE-20261003.md); historical manifest and verification remain in `history/quota-stability-delivery.json` and `history/quota-stability-verification.json`.

## Scope and outcome

User approved Windows local statistics + Codex quota only, stability before acceptance, one real account. Existing offline M1 entry, five-source statistics contract, upstream baseline and dependency versions remain unchanged. Later backlog, cloud/iOS, inference, credit resets, provider routing, automatic startup and publication are out of scope.

Main-process queue serializes quota reads and selected logout. Same-account duplicate refresh is skipped. Each refresh records last attempt independently of last successful quota. Failure preserves historical data and returns a safe error enum; only a structured `error.data.codexErrorInfo = rateLimitExceeded` qualifies for 15-minute rate-limit cooldown. Generic failures use 60 seconds. Manual and batch reads respect cooldown. Automatic refresh is off on each launch and supports only five minutes; a due wake executes one batch without replaying missed intervals.

Generation checks discard late responses after cancellation, account notification, removal and shutdown. Login timeout is five minutes, RPC timeout is 60 seconds. Shutdown closes owned CLI children and waits up to three seconds for each tracked process exit; timeout is surfaced. Server requests are rejected before response-ID matching, including collisions with pending client requests. Runtime selection is blocked during active or queued connection operations.

Credential storage must pass effective config/read with keyring. Existing clients' credentials are not imported or read. Account IDs from the rate-limit response stay in main-process memory only; only a duplicate-known boolean reaches the UI. Unknown identity remains unknown. Null email is accepted. Original AccountQuotaV1 percentages and bucket precedence remain unchanged: unknown is not zero, used values above 100 remain visible, remaining is clamped to zero, and elapsed reset time does not refill quota.

UI keeps the existing visual baseline and motion off. It exposes safe failure, cooldown, batch totals, last attempt/success and local cache age. Thirty-second age rendering does not make account requests. Restored or older-than-ten-minute data is historical. Open account details remain open during updates.

## Verification evidence

Browser plugin not available; the approved Windows Electron Playwright workflow is used. Tests replace only an adapter inside a disposable synthetic process, never in the product.

| Check | Current result |
| --- | --- |
| `npm run verify` | Final 41 tests and lint passed, including unchanged-auth notification compatibility, account-change invalidation, actual owned-child exit and logout's own notification |
| `npm run test:native` | Six synthetic records, 694 tokens, tokscale 4.17.0, zero Node network attempts, read-only inputs |
| `npm run test:ui` | Source and existing offline Windows package: 100/150 scale; periods, filters, five sources, pause/resume, export, clear and window lifecycle passed |
| `npm run test:quota:ui` | Source and NEW package: 100/150 scale; cache/unknown, route/modal, synthetic login/refresh/logout, batch errors/cooldown/cancel and restart-off/historical state passed; no page/console errors |
| `npm run experiment:crypto` | Separate sender/receiver, wrong key, tampering, replay and duplicate rejection passed |
| `npm run test:upstream` | 34 affected shared tests passed |
| Installed official CLI 0.160.0 | Independent empty home initialization, effective keyring, null account, no auth.json and owned process shutdown passed; no login/inference |
| Single real account | User official login completed; official page comparison confirmed by user; actual restart/manual refresh and one five-minute automatic batch passed. Selected logout status is recorded in the final delivery manifest |
| Multiple real accounts | Not performed; multi-account queue/isolation/known-identity checks are synthetic |

CodeGraph was unavailable. Current-source inspection and affected behavior tests are the fallback. Forced Electron scale factors alone do not prove physical-monitor DPI/dialog/tray behavior; user separately confirmed actual Windows 100/150 DPI, OS dialogs and original M1 tray recovery had no obvious defects. Physical Windows sleep/wake was not performed; fake-clock due wake and an actual powerMonitor resume event before due were tested. Child network packet payloads and existing credential stores were not inspected.

## Delivery and remaining user acceptance

Final build directory: `dist/quota-stability-20261003-final/win-unpacked`. New ZIP/source/manifest directory: `dist/delivery-quota-stability-20261003`. Previous binaries and ZIPs are preserved. Source packaging uses a whitelist and includes current research and docs, excluding runtime data, credentials, caches, logs, dependencies and build payloads. ZIP CRC and extraction into a Chinese/space path are checked before delivery.

Real acceptance uses a dedicated `%APPDATA%/AgentUsage-M1-Quota-Acceptance-20261003`, never another client's CODEX_HOME. User completed official login personally and confirmed plan, remaining windows and reset times match the official page. Full exit/restart restored historical state with automatic refresh off; manual refresh succeeded without another login through effective keyring enforcement. Own auth.json count was zero. Automatic refresh enabled at 17:30:04 CST, began at 17:35:04 and succeeded at 17:35:09 with success 1/failure 0/skipped 0. It was disabled again; restart kept it off. Real quota observations remain in ignored local acceptance artifacts and are excluded from the source ZIP. No credit reset was consumed.

Real acceptance exposed unchanged account/read auth notifications canceling refresh; fixed and validated with a fresh real read. A separate synthetic regression exposed logout's own auth notification canceling removal; the final revision ignores that expected notification only while the selected logout is active. Latest executable quota source and renderer are compared to workspace files. Selected logout and other-client isolation must be evidenced independently, not inferred from isolated home paths. See the final delivery manifest for those results. The old default quota directory's two connections are preserved.

User closeout decision: keep the independent acceptance connection and mark real logout as deferred. Its credential store and quota cache remain preserved, automatic refresh is off. Consequently, other-client login isolation after logout is also unverified. Synthetic selected logout, its auth notification, multi-account isolation and race tests passed. Do not treat those tests as a completed real logout or multi-real-account acceptance.
