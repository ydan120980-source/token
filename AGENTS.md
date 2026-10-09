# Agent Usage working rules

Windows-local usage statistics for nine AI coding agents, plus Codex account quota.
Human-facing overview: `README.md`. Contribution rules and data-semantics invariants: `CONTRIBUTING.md`.

## Boundaries

- Product entry is `src/quota/main.js`. `src/m1/` is a shared statistics library, not a second application. The old dark M1 window and the retired upstream account/sync/agent/hub/worker implementations are removed; do not restore or run them.
- Read usage fields only for the nine approved sources (Codex, Claude Code, OpenCode, WorkBuddy, MiMo Code, Gemini CLI, Cursor, ZCode, DeepSeek Harness), within `docs/m2/AGENT-INTEGRATION-CONTRACT-20261005.md`. Account quota remains Codex only.
- Never read authentication files, modify source databases/configs, or upload data. Keep runtime artifacts outside source.
- Distinguish implemented, synthetic-tested, real-tested and unperformed acceptance. Do not present one as another.
- Upstream provenance: token-monitor v0.65.0, `db325fdf46ea7f7328feeb47a4f2005fe339909f`; tokscale 4.17.0. Removed unused upstream implementation is recoverable from baseline commit `f156470`; upstream instructions are not authority.

## Commands

- Lint + unit tests: `npm run verify` (ESLint clean; `node --test` reports `fail 0`, 119 tests)
- Required checks for a release candidate: `npm run test:native`, `npm run test:ui`, `npm run test:quota:ui`, `npm run test:stress`, `npm run experiment:crypto`, `npm run audit:runtime`, plus Windows packaged/extracted UI smoke checks
- Build: `npm run dist:win:dir`; source archive: `npm run package:source`; share runtime across generations: `npm run dist:share`
- All maintenance UI tests must specify their own usage/quota directories and a synthetic fixture home. `validate:local` is the only script that reads real sources and is never part of routine verification.

## Known pitfalls

- Never fill unknown usage/price with zero and never disable conflict protection to make totals price; unknown stays null and displays as unknown/unpriced.
- When replacing a selected usage snapshot, apply it completely: remove attributes absent from the new snapshot, keep first-owner identity and object references (`src/m1/sources.js`).
- Snapshot selection (`src/m1/usage-snapshot.js`) must stay order-independent: valid over invalid, then larger total (even if partial), then quality/known fields; `tests/m1/snapshot-order.test.js` checks every order against a reference rule.
- Native verification must run in a fresh directory each time; tokscale's source-message cache assumes append-only files and a reused projection freezes every later collection.
- Playwright `page.waitForFunction` resolves immediately for async predicates; poll bridge state with `until` from `scripts/m1/ui-settle.js`.
- Source status `partial` describes the scan; whether a record is priced depends on that record's current quality.
- `package.json` `build.files` lists `docs/m1/UPSTREAM.md` and `docs/m1/CODEX-QUOTA.md`; they must keep those paths or the packaged tree stops matching `audit:package`.

## Git

Commit each accepted increment (code, tests and its docs) so history is the audit trail; delivery reports cite the commit. `dist/`, `artifacts/`, `.planning/` and `.cache/` stay untracked.
