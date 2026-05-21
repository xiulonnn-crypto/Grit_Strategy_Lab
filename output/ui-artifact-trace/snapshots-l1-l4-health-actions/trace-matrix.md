# Snapshots L1-L4 Health Actions Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- Shared shell: out of scope; page body verified.
- Design source: `DESIGN.md` snapshots route guidance plus the 2026-05-21 user request.
- Source files: `web/src/page-sections/snapshots-operations-console.tsx`, `web/src/pages/snapshots-page.css`, `web/src/snapshots.page.test.tsx`.
- Evidence output: `output/ui-artifact-trace/snapshots-l1-l4-health-actions/` and `output/logs/grit-coder/snapshots-l1-l4-health-actions/`.

## Acceptance Rows

| Row | Requirement | Target selector/component | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | L1-L4 health cards render as exactly four aligned cards. | `.snapshots-ops-health-grid`, `.snapshots-ops-health-card` | `live-route-metrics.json`: desktop and mobile card heights `[288,288,288,288]` | PASS |
| 2 | Each card uses its real layer status tone; READY is green, partial/incomplete is warning, blocked/failed is danger. | Health card status chip and card class | Vitest status checks; live L4 class/chip include `--ready` | PASS |
| 3 | READY layer action is `查看证据` and anchors to the raw snapshot ledger. | Health card action button, `#snapshot-ledger` | Live L4 click highlights L4 ledger rows `ds-macro-rates` and `ds-option-skew` | PASS |
| 4 | Partial, incomplete, stale, or blocked layer action is `下钻` and anchors to the matching L1-L4 drilldown card. | `#snapshot-layer-l1` ... `#snapshot-layer-l4` | Live L1 click adds `snapshots-ops-drill-card--highlight` to `#snapshot-layer-l1` | PASS |
| 5 | Card action buttons share the same visual height and align at the bottom of the cards. | `.snapshots-ops-health-action` | `live-route-metrics.json`: desktop and mobile button heights `[32,32,32,32]` | PASS |
| 6 | Raw engineering statuses do not leak into the L1-L4 health card main stage. | Health card text content | Vitest route text checks and screenshot inspection | PASS |

## Screenshots

- Desktop: `snapshots-l1-l4-desktop.png`
- Mobile: `snapshots-l1-l4-mobile.png`

## Runtime Evidence

- Runtime preflight: `runtime-preflight.json` reports `quickstartOverall=ready`, `decision=reuse`.
- Frontend entry: `web/dist/index.html` and `http://127.0.0.1:4173/` both serve `assets/index-pkt8tM4G.js`.
- Browser: system Chrome via Playwright because the bundled Playwright Chromium executable was missing.
