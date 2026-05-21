# Snapshots Refresh Log And L4 Drilldown Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- Shared shell scope: page body plus visible route shell; shell inventory is not being redesigned.
- Design source: `DESIGN.md` snapshots route guidance, existing `output/ui-artifact-trace/snapshots-l1-l4-health-actions/trace-matrix.md`, and the user report on 2026-05-21.
- Owned implementation paths: `web/src/page-sections/snapshots-operations-console.tsx`, `web/src/snapshots.page.test.tsx`, this trace matrix, runtime/screenshot evidence under this folder.
- Desktop viewport: 1960x1200. Mobile viewport: 390x844.

## Acceptance Rows

| ID | Requirement | Selector / component | Evidence | Status |
| --- | --- | --- | --- | --- |
| R1 | Refresh log modal `本次入库` column must show added/new data wording and not repeat identical ingress fragments inside one layer row. | `RefreshLogModal`, `buildRefreshLogRows`, `summarizeRefreshEntry` | PASS: Vitest asserts `价格新增 1,482 行数据`, `公司行为新增 1,030 行数据`, and absence of duplicated `覆盖 1,030 标的`; live modal DOM shows `价格新增 9,330 行数据 · 公司行为新增 330 行数据`, L2/L3/L4 added rows, and `hasCoverageDuplication=false` in `metrics.json`. | PASS |
| R2 | L4 health card click must drill to a dedicated L4 module with macro and derivatives source evidence, upstream L1 dependency, and next actions. | `.snapshots-ops-health-card[data-layer-id="l4"]`, `#snapshot-layer-l4` | PASS: Vitest click assertion finds `L4 宏观与衍生品下钻`, `宏观利率`, `期权偏度`, and L1 sample-pool dependency; live L4 screenshot shows the highlighted L4 drill card with macro/option counts and action buttons. | PASS |
| R3 | Any partial or blocked L1-L4 card click must anchor the corresponding drill module, not a generic evidence table. Ready cards may still open ledger evidence. | `handleDrill`, `activeDrillLayer`, `#snapshot-layer-{layer}` | PASS: `handleDrill` now stores `activeDrillLayer`, highlights the matching module, and live metrics after L4 click show `highlighted=1` on the L4 module. | PASS |
| R4 | Drilldown header must match the currently selected layer card and expose that layer status. | `.snapshots-ops-drilldown` header | PASS: Vitest asserts the header switches to `L4 宏观与衍生品` after the L4 card and back to `L1 基础行情` after the L1 card; live screenshot shows `部分可用` in the active header. | PASS |
| R5 | Mobile layout must preserve readable cards and modal table without overlapping text. | 390x844 screenshot | PASS: `live-mobile.png` was visually inspected; `metrics.json` records mobile viewport width 390 and `scrollWidth=390`, so no horizontal overflow was introduced. | PASS |

## Evidence Plan

- Runtime preflight: `output/logs/grit-coder/snapshots-refresh-log-l4-drilldown-20260521/runtime-preflight.json`
- Final runtime preflight rerun: `output/logs/grit-coder/snapshots-refresh-log-l4-drilldown-20260521/runtime-preflight-final.json`
- Desktop screenshot: `output/ui-artifact-trace/snapshots-refresh-log-l4-drilldown-20260521/live-desktop.png`
- L4 click screenshot: `output/ui-artifact-trace/snapshots-refresh-log-l4-drilldown-20260521/live-l4-drilldown.png`
- Refresh log screenshot: `output/ui-artifact-trace/snapshots-refresh-log-l4-drilldown-20260521/live-refresh-log.png`
- Mobile screenshot: `output/ui-artifact-trace/snapshots-refresh-log-l4-drilldown-20260521/live-mobile.png`
- Metrics JSON: `output/ui-artifact-trace/snapshots-refresh-log-l4-drilldown-20260521/metrics.json`

## Deviation Ledger

- `metrics.json` captured one console 404 from `favicon.ico`; no failed application/API requests were captured.
- Runtime preflight remained `probe-degraded` because listener ownership probing was blocked in this shell, so live route proof used a controlled backend process plus the existing 4173 preview serving the rebuilt bundle.
