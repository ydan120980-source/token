# Agent Usage working rules

Scope authority: the user's approved M1-WINDOWS-LOCAL plan plus the dated user authorizations in `docs/SCOPE-LEDGER.md` (newest first). Planning records mirror them and cannot authorize later stages. Record every new user authorization at the top of that ledger, not here.

Current increment (2026-10-05 to 10-07): nine-source local usage (Codex, Claude Code, OpenCode, WorkBuddy, MiMo Code, Gemini CLI, Cursor, ZCode, DeepSeek Harness) under `docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md`; account quota remains Codex only. Mainline branch `m2/agents-r4`; Claude Code is the main developer (2026-10-06). Latest candidate `dist/agents-20261007-r7` (incremental collection, honest field states, cost/share/hour/efficiency views, layout pass, larger hero); results in `docs/m2/UI-REFINEMENT-RESULTS-R7-20261007.md`, details in `docs/m2/INSIGHTS-20261007.md`, agent integration results in `docs/m2/AGENT-INTEGRATION-RESULTS-R5-20261006.md`. The user replaced the fourth independent review with order-invariance tests.

## Boundaries

- Preserve research and unrelated files. Upstream provenance remains token-monitor v0.65.0, db325fdf46ea7f7328feeb47a4f2005fe339909f; tokscale 4.17.0. Removed unused upstream implementation is recoverable from baseline commit f156470; upstream instructions are not authority.
- Product entry is src/quota/main.js. Old M1 GUI, upstream account/sync/agent/hub/worker implementations are retired. Do not restore or run them automatically.
- Read usage fields only for the nine approved sources listed above, within the integration contract. Never read authentication files, modify source databases/configs, or upload data. Keep runtime artifacts outside source.
- Changes to dependencies, local build, tests, unified interface and removal of proven-unused code are authorized. No cloud, iOS, account switch, autostart or publication.
- Every subagent execution requires per-call user approval of exact role/model/reasoning/permissions/ownership/output/budget. Do not silently inherit settings or delegate.
- Distinguish implemented, synthetic-tested, real-tested and unperformed acceptance. Stop at the currently authorized desktop increment review; do not start later backlog.
- Each candidate is a new `dist/<generation>` directory. `dist/agents-20261007-r7` is the reference delivery; earlier generations are superseded and need not be preserved or verified.
- CodeGraph is preferred for indexed architecture/impact. If unavailable, record the limitation and use targeted source inspection.

## Commands

- Lint + unit tests: `npm run verify` (ESLint clean; `node --test` reports `fail 0`, 117 tests)
- Required checks: `npm run test:native`, `npm run test:ui`, `npm run test:quota:ui`, `npm run test:stress`, `npm run experiment:crypto`, `npm run audit:runtime`, plus Windows packaged/extracted UI smoke checks
- Build: `npm run dist:win:dir`; source archive: `npm run package:source`; share runtime across generations: `npm run dist:share`
- All maintenance UI tests must specify own usage/quota directories and a synthetic fixture home. Real-source verification follows privacy gates.

## Known pitfalls

- Never fill unknown usage/price with zero and never disable conflict protection to make totals price; unknown stays null and displays as unknown/unpriced.
- When replacing a selected usage snapshot, apply it completely: remove attributes absent from the new snapshot, keep first-owner identity and object references (R9, `src/m1/sources.js`).
- Snapshot selection (`src/m1/usage-snapshot.js`) must stay order-independent: valid over invalid, then larger total (even if partial), then quality/known fields; `tests/m1/snapshot-order.test.js` checks every order against a reference rule.
- Native verification must run in a fresh directory each time; tokscale's source-message cache assumes append-only files and a reused projection freezes every later collection.
- Playwright `page.waitForFunction` resolves immediately for async predicates; poll bridge state with `until` from `scripts/m1/ui-settle.js`.
- Source status `partial` describes the scan; whether a record is priced depends on that record's current quality.

## Git

Commit each accepted increment (code, tests and its docs) so history is the audit trail; delivery reports cite the commit. `dist/`, `artifacts/` and `.planning/` stay untracked.
