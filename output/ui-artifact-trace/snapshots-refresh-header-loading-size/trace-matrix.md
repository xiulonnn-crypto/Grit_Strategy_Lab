# Snapshots Refresh Header Loading Size Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- Lane: UI lane
- Shared shell scope: sidebar/topbar may be present; page-body geometry is in scope.
- Symptom: on document refresh, the loading state below the snapshots page header changes the perceived header module size compared with the loaded state.
- Wide viewport: `1905x912`
- Desktop viewport: `1440x1000`
- Mobile viewport: `390x844`

## Evidence Files

- Runtime preflight: `output/logs/grit-coder/snapshots-refresh-header-loading-size/runtime-preflight.json`
- Loading/loaded metrics: `output/logs/grit-coder/snapshots-refresh-header-loading-size/snapshots-header-refresh-metrics.json`
- Wide screenshots: `output/logs/grit-coder/snapshots-refresh-header-loading-size/snapshots-refresh-wide-loading.png`, `output/logs/grit-coder/snapshots-refresh-header-loading-size/snapshots-refresh-wide.png`
- Desktop screenshot: `output/logs/grit-coder/snapshots-refresh-header-loading-size/snapshots-refresh-desktop.png`
- Mobile screenshot: `output/logs/grit-coder/snapshots-refresh-header-loading-size/snapshots-refresh-mobile.png`

## Acceptance Matrix

| Row | Requirement | Selector / Owner | Gate | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Refresh loading state keeps the same header card size as loaded state. | `.snapshots-header-card` in `web/src/pages/snapshots-page.tsx` / `web/src/pages/snapshots-page.css` | Loading-vs-loaded header height delta <= 2px on wide, desktop, and mobile. | PASS | Metrics show `headerHeight: 0` for `1905x912`, `1440x1000`, and `390x844`. |
| 2 | Every loading module keeps the same outer width and X coordinate as the loaded module grid. | `.snapshots-loading-console`, `.snapshots-loading-state`, `.snapshots-ops-console`, `.snapshots-ops-panel` | Loading-vs-loaded console width/X and first module width/X deltas are 0px on wide, desktop, and mobile. | PASS | Metrics show `consoleWidth: 0`, `consoleX: 0`, `moduleWidth: 0`, `moduleX: 0` for all three viewports. |
| 3 | Loading feedback below the header does not compress, expand, or visually replace the header module. | `.snapshots-loading-console`, `.snapshots-ops-panel` | Loading panel top is below the header bottom with a 16px gap and no overlap. | PASS | Metrics show `feedbackGap: 16` and `loadedFirstPanelGap: 16` for all three viewports. |
| 4 | Header action controls stay in their final positions and disabled/loading state does not change header width/height. | `.snapshots-header__actions`, `.snapshots-header__primary`, `.snapshots-header__secondary` | Header action container height delta <= 2px and buttons do not wrap unexpectedly. | PASS | Metrics show `actionsHeight: 0`; screenshots show the two header buttons remain in the same row on wide/desktop and stack correctly on mobile. |
| 5 | Loaded snapshots content preserves approved module order after loading clears. | `.snapshots-ops-*` | Header and first operations sections render in order with no raw loading text left behind. | PASS | Wide/desktop/mobile screenshots inspected; loading skeleton clears into L1-L4, queue, impact summary, drilldown, ledger, credential, and restart sections. |
| 6 | Mobile refresh state remains stacked without text overlap or horizontal overflow. | page body at `390x844` | `documentElement.scrollWidth <= clientWidth + 1`; no header/feedback overlap. | PASS | Metrics show mobile `overflow.loading: 0` and `overflow.loaded: 0`; mobile screenshots inspected. |

## Approved Deviations

- The final geometry probe used the served `4173` bundle with route-fulfilled snapshot API responses so the loading window could be captured deterministically. Final runtime preflight remained `blocked` / `probe-degraded` because backend listener ownership could not be proven safely and supervisor reported `backend-api` stopped, so real API acceptance is recorded as a runtime blocker rather than visual parity evidence.
