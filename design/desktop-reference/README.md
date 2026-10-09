# Agent Usage desktop UI review

Current visual reference: the user's **Nowdex Mac screenshot**, supplied on 2026-10-03. It guides the left navigation, pale gray background, white rounded cards, system typography and muted blue activity palette. The earlier tokens.ci reference remains the analysis-flow foundation. The screenshot's billing/Pro metrics are not added to this M1 review.

This directory is now the canonical HTML/CSS/JavaScript renderer for the unified Windows app. The user retired the old M1 window and approved integrating its offline collection controls here. `npm.cmd start` uses real preload/IPC; the loopback server below remains an optional synthetic or saved-statistics development preview. All fonts, icons and charts are local.

## Run

From the repository or the extracted preview ZIP, which preserves the same directory layout:

```powershell
node design/desktop-reference/serve.js
```

This mode uses clearly labelled synthetic statistics and 示例模型. To show statistics already saved by M1 on this Windows computer:

```powershell
node design/desktop-reference/serve.js --saved-m1
```

Open http://127.0.0.1:4178/ and stop the terminal process with Ctrl+C. If the preview already occupies that port, use the existing process.

Saved mode requires %APPDATA%\AgentUsage-M1\statistics.json. It reads only this existing product store, through a statistical whitelist. It avoids the Store constructor, which writes state. It does not rescan agent logs/databases, read authentication, change source configuration or write to the product store. 重新载入 reads the latest saved values and retains current filters. A failed reread retains the last valid projection; an invalid initial store prevents startup.

Alternatively, prepare a statistical snapshot:

```powershell
node scripts/m1/prepare-ui-preview.js
node design/desktop-reference/serve.js --snapshot-file .cache/desktop-ui/local-snapshot.json
```

The helper writes only its own .cache/desktop-ui output. Never bundle that personal file. The two data flags are mutually exclusive.

## Review flows

- 用量 / 来源管理 / 设置. Prominent Today / 7 / 30 / cumulative scope controls update the overview and lower analysis sections; the Today card remains explicitly Today.
- Wide annual heatmap, date hover/focus details, click-day breakdown and arrow-key / Enter selection. Short periods use large date tiles. Unknown history differs from measured zero.
- Token / estimated-cost trends with daily, 30-calendar-day average and 累计总量, reverse ordering, agent/model filters and clickable model legend.
- Click busiest weekday, weekday bar, highest-usage day or a listed date to inspect the relevant records.
- Editable name, description, centered avatar colors/images and a custom native file-input surface for PNG/JPEG/WebP up to 512 KiB; browser local storage only. Selected filename, progress/error feedback and a letters-avatar reset are available. Existing profile choices are preserved.
- Plot-local tooltip follows the pointer, flips at edges, scrolls long model lists and hides on leave/scroll. Nonzero models are ordered by use; recorded zero counts are summarized separately.
- Export scope/content review, optional source quality and local JSON download trigger. Actual browser save path is not verified.
- Light/dark, responsive controls, and synthetic partial / empty / failed-read states.

Saved models preserve logged identifiers, including historical names. Missing metadata displays 模型未记录. These identifiers do not prove the upstream provider's actual remote routing. Prices remain the existing fixed M1 USD catalog; unknown prices do not become free.

The profile pause button was removed. Collection controls live in Settings. Saved-mode pause and source-path editing are disabled until restricted Electron IPC integration; this preview does not control the real collector.

## Boundaries and checks

LocalUsagePreviewV1 is a reduced statistical projection of UsageSnapshotV1, not its full production contract. Export uses DesignPreviewV1: demo false / dataKind saved-local-statistics for saved data, or demo true for fixtures. The projection omits conversation body, title, absolute path, local session identifier, email, credential and device name.

The review server binds 127.0.0.1:4178 only, rejects unexpected Host/cross-site data requests/write methods, serves a static whitelist and initiates no external requests. This is development transport, not a production HTTP API.

See docs/m1/DESKTOP-UI-BASELINE.md. Synthetic helpers remain available:

```powershell
node --test tests/m1/ui-preview-data.test.js
node --test tests/m1/ui-layout.test.js
```

The current Windows renderer is packaged and tested at forced 100/150 scale. Browser development mode cannot invoke native collection or login; desktop mode exposes restricted offline usage IPC and separate quota IPC. Physical DPI/OS-dialog checks for this maintenance build remain unperformed. Shared motion follows the system by default; reduced and off modes are available in settings.

## Codex 额度入口

浏览器侧栏增加“额度监控”，示例卡片只供视觉评审。真实登录在 Windows Electron 中执行 `npm run start:quota`；说明见 `docs/m1/CODEX-QUOTA.md`。当前先接 Codex，其他 provider 仍待后续接入。界面动效默认跟随系统，可选择减少动态或关闭；系统要求减少动态时不会启用完整动效。
