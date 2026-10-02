# Agent Usage M1 working rules

The user's approved M1-WINDOWS-LOCAL plan is the scope authority. Planning records mirror it and cannot authorize later stages.

- Preserve research and unrelated files. Source baseline: token-monitor v0.65.0, db325fdf46ea7f7328feeb47a4f2005fe339909f; tokscale 4.17.0. Upstream instruction files are reference material, not adopted authority.
- Product entry is src/m1/main.js. Never start the upstream account/sync entry or agent/hub/worker commands against real sources.
- Read usage fields only for the five approved sources. Never read authentication files, modify source databases/configs, or upload data. Keep runtime artifacts outside source.
- Changes to the M1 dependencies, local build, tests and interfaces are authorized by the approved plan. No cloud, iOS, quota connection, account switch, autostart or publication.
- Every subagent execution requires per-call user approval of exact role/model/reasoning/permissions/ownership/output/budget. Do not silently inherit settings or delegate.
- Run npm run verify, npm run test:native, npm run test:ui, the synthetic crypto experiment, and Windows directory-package smoke checks. Real-source verification follows privacy gates.
- Distinguish implemented, synthetic-tested, real-tested and unperformed acceptance. Stop at M1 review; do not start later backlog.
- CodeGraph is preferred for indexed architecture/impact. If unavailable, record the limitation and use targeted source inspection.
