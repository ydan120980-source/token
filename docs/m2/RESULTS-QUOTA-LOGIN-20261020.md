# Quota website login acceptance (2026-10-20)

## Scope and evidence

Owner asked for Codex-like login and then explicitly authorized lasting login and AGENTS.md changes. The delivered code adds isolated Cursor/MiMo website sign-in and Windows-encrypted session retention; it does not turn every provider into a publicly supported quota OAuth service. See [contract](QUOTA-WEBSITE-LOGIN-20261020.md).

No existing browser/profile, external authentication file or real account was read. Website login fixtures intercept HTTPS in disposable sessions. No real website login, provider quota query, model inference, proxy/firewall change, GitHub operation or UI style change occurred. CodeGraph and Browser plugin were unavailable; targeted source inspection and existing native Electron/Playwright workflow supplied the evidence.

## Source acceptance

- `npm run verify`: ESLint clean, node tests fail 0.
- `npm run audit:runtime`: passed, one product entry, no retired imports.
- `npm run test:native`: passed; sourceReadOnly true, nodeNetworkAttempts 0.
- `npm run test:stress`: passed independent native totals and 160k SQLite records, growing WorkBuddy detail, collector overlap/shutdown, quota queue storm, RPC framing/overflow and large projection checks.
- `npm run experiment:crypto`: passed.
- Affected source UI: provider-login, provider-quota, source-quota, interaction-reliability, usage and workbench passed. Existing suites retain their configured scales; the new login suite verifies 100% and 150%.
- New native Electron flow: consent required -> isolated synthetic HTTPS page -> same-session whitelisted Cookie -> actual Windows safeStorage file -> restart without network -> explicit refresh -> cancellation preserves connection -> auth failure clears encrypted secret -> removal deletes saved secret. Remote login windows expose neither `quotaBridge` nor Node, and sender-guarded IPC rejects them. Foreign Cookie fields and secrets are absent from returned state/connection JSON; statistics bytes stay unchanged.
- Unit coverage separately verifies identity binding, expiry, corruption/encryption failures, strict adapter/request shape, manual-mode memory-only replacement, storage publication failure, cancellation, close/removal and late results.

Logs and screenshots: `artifacts/quota-login-20261020/source/`. Initial login-UI fixture failures are retained: the test used a BrowserWindow subclass excluded by Electron getAllWindows; the wrapper now constructs an ordinary BrowserWindow. No product guard or assertion was weakened. Screenshot capture now waits for the existing finite dialog transition to finish.

## Formal package acceptance

Implementation: e2b95f0fe4a60becdf86ae9b41142c50c975c344. Local main build/merge: 0bbdc33338b1f096efd7d8f4a7376e6f2fb27a6c. The later acceptance increment changes tests/docs only; runtime stays byte-identical.

- Formal Windows build from shared main physical node_modules passed. Package audit: 209 product source/assets/docs match ASAR byte-for-byte, native executable and unpacked helper pins pass.
- All 31 scripts/m1/*-ui-test.js passed against the actual packaged executable. Provider website login also passed with the final test input isolation at both scales.
- Windows ZIP CRC passed; all 88 files extracted under a Chinese path containing spaces match the original build by bytes/SHA-256.
- Extracted agent-recovery suite passed actual synthetic collection/native comparison. Extracted provider-login passed at both scales with real Windows encryption, restart, explicit refresh, cancellation, expiry and removal. Extracted static configuration CLI passed its explicit-scope/no-secret-output checks.
- Initial extracted login had one consent-visibility timeout after refresh/relogin. A diagnostic retry passed unchanged. A later packaged retry captured no click event at the expected opener and no dialog opening; the precise external input/timing cause was not established. The test now uses the existing isolatePointer helper, waits for refreshed UI state and asserts the dialog is open before the next step, retaining sanitized event diagnostics. Final packaged and extracted runs passed without runtime edits or forced clicks. Initial failure logs remain in extracted-ui and packaged-login-final.log, and final proofs in packaged-login-isolated and extracted-login-isolated. No failed first pass is reported as a pass.
- Final source archive must contain only tracked files and match committed main/disk bytes; final manifest/checksums are generated in dist/quota-login-20261020 after this acceptance record is committed. Delivery generation and older releases remain independent.

Evidence: artifacts/quota-login-20261020/build.log, package-audit.log, packaged-ui/suite-results.json, extracted-ui/final-suite-results.json, extraction.json, config-cli-packaged.json and delivery-validation.json. No real account requests were made.

## Remaining real acceptance

Actual Cursor/MiMo website CAPTCHA, SSO redirects, provider session lifetime/revocation and current personal quota schemas were not tested. Embedded sign-in may be rejected by an identity provider; retain manual credential fallback and experimental/partial labels. Known Cookie expiry or server 401 requires re-login; no permanent-token or automatic-renewal promise. Claude/Antigravity remain official passive observations; WorkBuddy still needs platform/server prerequisites for public OAuth, and Gemini receives no copied CLI OAuth flow. Ten implemented quota routes still do not mean ten real accounts validated. The historical Codex real-account check is unchanged.

Windows packages remain unsigned under the existing release policy. Real IME candidate windows and screen readers were not manually accepted.
