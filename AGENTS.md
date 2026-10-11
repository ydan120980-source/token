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

- Lint + unit tests: `npm run verify` (ESLint clean; `node --test` reports `fail 0`; do not record the test count in living docs, parallel branches all change it)
- What to run when (dev loop / PR / release candidate) is in `CONTRIBUTING.md` "测试分层". A release candidate runs the headless checks (`test:native`, `test:stress`, `experiment:crypto`, `audit:runtime`), `dist:win:dir` + `audit:package`, every `scripts/m1/*-ui-test.js` against the packaged build, and one collecting suite on a byte-checked extracted copy under a path with spaces and non-ASCII characters. Source-mode full UI runs are not repeated at release time.
- Build: `npm run dist:win:dir`; source archive: `npm run package:source`; share runtime across generations: `npm run dist:share`
- All maintenance UI tests must specify their own usage/quota directories and a synthetic fixture home. `validate:local` is the only script that reads real sources and is never part of routine verification.

## Known pitfalls

- Never fill unknown usage/price with zero and never disable conflict protection to make totals price; unknown stays null and displays as unknown/unpriced.
- When replacing a selected usage snapshot, apply it completely: remove attributes absent from the new snapshot, keep first-owner identity and object references (`src/m1/sources.js`).
- Snapshot selection (`src/m1/usage-snapshot.js`) must stay order-independent: valid over invalid, then larger total (even if partial), then quality/known fields; `tests/m1/snapshot-order.test.js` checks every order against a reference rule.
- `tokscale.exe` is SHA-256-checked before every spawn against `TOKSCALE` in `src/m1/native.js`; upgrading tokscale means updating that version and hash with the lockfile, never skipping the check.
- Native verification must run in a fresh directory each time; tokscale's source-message cache assumes append-only files and a reused projection freezes every later collection.
- Playwright `page.waitForFunction` resolves immediately for async predicates; poll bridge state with `until` from `scripts/m1/ui-settle.js`.
- Source status `partial` describes the scan; whether a record is priced depends on that record's current quality.
- `package.json` `build.files` lists `docs/m1/UPSTREAM.md` and `docs/m1/CODEX-QUOTA.md`; they must keep those paths or the packaged tree stops matching `audit:package`.

## Git

Commit each accepted increment (code, tests and its docs) so history is the audit trail; delivery reports cite the commit. `dist/`, `artifacts/`, `.planning/` and `.cache/` stay untracked.

Several maintainers (people and their agent sessions) share this repository; the workflow is in `CONTRIBUTING.md` ("协作流程"). In short:

- Work on a topic branch and merge through a pull request; do not push to `main` directly. `git pull --rebase origin main` before starting and before pushing.
- Never force-push `main`, never rewrite published history, and never run `git reset --hard` / `git clean` on a tree that may hold unpushed commits.
- Release-candidate acceptance (UI suites, packaged and extracted checks, `dist/<generation>`, the `docs/m2/RESULTS-*` record) belongs to the release owner on a Windows machine with a desktop. Other maintainers state in the PR which checks they ran and which they could not; a renderer change is not accepted until the release owner has run the matching UI suites.
- Scope beyond the nine sources or Codex-only quota needs the project owner's decision recorded in an issue before work starts.
