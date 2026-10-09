# Upstream provenance

This project is a maintenance branch derived from
[token-monitor](https://github.com/Javis603/token-monitor) v0.65.0, commit
`db325fdf46ea7f7328feeb47a4f2005fe339909f` (MIT, copyright Javis).

**Upstream's publisher identity, code signing, update service and release
pipeline are not inherited.** This project does not represent itself as
token-monitor and does not publish under that name.

## What was kept from upstream

- The root MIT `LICENSE` (with the upstream copyright line preserved in addition
  to this project's own).
- The Windows application icon (`assets/icon-win.png`).
- The agent brand icons under `design/desktop-reference/assets/agents/`.
- Research material under `research/agent-usage/`.
- The general shape of the local-first statistics idea.

## What was removed

After the 2026-10-03 maintenance clean-up, the unused upstream account, sync,
update, hub, worker, macOS and site implementations and their tests were deleted.
Original source is not vendored in this repository; it remains recoverable from
the baseline commit `f156470` if ever needed. The upstream `instruction` files
and GitHub workflows were not imported as working rules here.

## Dependencies reused

| Dependency | Version | License | How it is used |
| --- | --- | --- | --- |
| tokscale | 4.17.0 (npm, official) | MIT (junhoyeo) | Independent native cross-verification of anonymous statistics projections |
| sql.js | 1.14.2 | MIT | In-memory, read-only querying of source SQLite bytes |

The Windows native binary comes from `@tokscale/cli-win32-x64-msvc` as installed
by the lock file; that package's own LICENSE ships beside it. A vendored fork of
Tokscale that upstream once pointed at was cleaned up; only the locked official
npm release is used. Tokscale 4.17.0 is pinned to tag commit
`dcf8d3656bbcecf05d112c6f35f9be328e4f66b7`.

## How Tokscale is used

By field whitelist, a reduced anonymous statistics projection is produced first;
the pinned native CLI then performs independent aggregation verification. It does
not touch the real home directory or the original databases, and it does **not**
prove every original source passes the native parser. Source extraction has its
own separate sample ledger.

Local session de-duplication and permanent history use a purpose-built atomic
JSON statistics layer rather than upstream's cache, which coerced values and
trimmed history. This is a deliberate divergence and must not be described as
reusing the complete upstream collection/archive implementation.

OpenCode/MiMo source `output` excludes reasoning, while this project's output
contract includes reasoning to avoid double-counting totals. Background:
[OpenCode getUsage](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/session.ts)
and the pinned [OpenCode schema](https://github.com/junhoyeo/tokscale/blob/v4.17.0/crates/tokscale-core/src/sessions/opencode_schema.rs).
Codex's own output already contains reasoning; cached input counts as raw input.

Tokscale offline pricing relies on its
[cache-only path](https://github.com/junhoyeo/tokscale/blob/v4.17.0/crates/tokscale-core/src/lib.rs#L5117).
Calls explicitly set `TOKSCALE_PRICING_CACHE_ONLY=1`, a separate config directory
and a projection home; login, config and update subcommands are never executed.
This evidence is used together with entry-point guards and synthetic tests and is
not presented as a system-level network capture.

## Pricing sources

Fixed public price inputs: the
[LiteLLM price file](https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json)
and the models.dev public API. Snapshot time, source SHA-256 and the exact
provider/model entries retained are recorded in `src/m1/prices.json`. Only
explicit USD token prices are extracted; missing cache prices are never inferred
and model aliases are never fuzzy-matched.

## Third-party attribution

Full attribution for fonts, icons, charts, agent marks and pricing data is in
[NOTICE](../NOTICE) and
[design/desktop-reference/LICENSES.md](../design/desktop-reference/LICENSES.md).
