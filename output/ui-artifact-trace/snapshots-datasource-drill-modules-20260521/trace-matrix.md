# Snapshots Data Source Drill Modules Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- Shared shell scope: page body only; sidebar/topbar are out of this slice.
- Design source: `DESIGN.md` snapshots route guidance, `TECHNICAL.md` UI trace gate, and the user requirement on 2026-05-21.
- Owned implementation paths: `web/src/page-sections/snapshots-operations-console.tsx`, `web/src/snapshots.page.test.tsx`, `web/src/pages/snapshots-page.css`, this trace matrix, and runtime/screenshot evidence under this folder.
- Desktop viewport: 1960x1200. Mobile viewport: 390x844.

## Acceptance Rows

| ID | Requirement | Selector / component | Evidence | Status |
| --- | --- | --- | --- | --- |
| R1 | Drilldown modules are generated per data source, not per L1-L4 layer, and only data sources in partial/blocked states receive standalone modules. | `buildDataSourceDrillModules`, `.snapshots-ops-drill-card[data-source-id]` | PASS: focused Vitest asserts old layer ids are absent; live metrics show 4 source modules (`ds-price`, `ds-corporate-actions`, `ds-macro-rates`, `ds-option-skew`) and `oldLayerModules=0`. | PASS |
| R2 | Clicking any partial/blocked L card anchors to the first affected data-source module for that layer, while ready cards continue using evidence behavior. | `handleDrill`, `activeDrillSourceId`, `.snapshots-ops-health-card` | PASS: L4 click anchors `#snapshot-source-ds-macro-rates`; L1 click anchors `#snapshot-source-ds-price`; L2/L3 READY cards still open ledger evidence in focused Vitest. | PASS |
| R3 | Each data-source module clearly states existing data, completeness, missing data, blocker, and next action. | `.snapshots-ops-source-fact-grid`, `.snapshots-ops-drill-list` | PASS: live metrics and screenshots show every module has `已有数据`, `完整度`, `缺少数据`, `卡点`, and `下一步`, with counts such as price `6,486,913 行`, `1,266/1,482`, and missing `216` symbols. | PASS |
| R4 | L4 macro rates and option skew render as independent modules when the L4 card is partial because of upstream/sample-pool dependency. | `#snapshot-source-ds-macro-rates`, `#snapshot-source-ds-option-skew` | PASS: live L4 screenshot shows separate macro and option modules; both show 100% source completeness but L1 sample-pool gate as the blocker. | PASS |
| R5 | Mobile layout keeps the data-source modules readable without horizontal overflow or overlapping text. | 390x844 screenshot and overflow metrics | PASS: mobile screenshot was visually inspected; metrics show viewport width `390` and `scrollWidth=390`. | PASS |

## Evidence Plan

- Runtime preflight: `output/logs/grit-coder/snapshots-datasource-drill-modules-20260521/runtime-preflight.json`
- Desktop screenshot: `output/ui-artifact-trace/snapshots-datasource-drill-modules-20260521/live-desktop.png`
- L4 source modules screenshot: `output/ui-artifact-trace/snapshots-datasource-drill-modules-20260521/live-l4-source-modules.png`
- Mobile screenshot: `output/ui-artifact-trace/snapshots-datasource-drill-modules-20260521/live-mobile.png`
- Metrics JSON: `output/ui-artifact-trace/snapshots-datasource-drill-modules-20260521/metrics.json`

## Deviation Ledger

- `metrics.json` captured one console 404 from `favicon.ico`; no failed application/API requests were captured.
- Route first content ready time was `916ms` on the final cache-busted live run, under the default 1s target.
