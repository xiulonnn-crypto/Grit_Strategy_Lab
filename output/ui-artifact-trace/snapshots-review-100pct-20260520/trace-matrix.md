# #/snapshots UI Trace Matrix - 2026-05-20

## Verdict

Status: PASS

Closure counters: FAIL=0 / BLOCKED=0 / NOT_CHECKED=0

This review accepts page-body parity against the approved snapshot redesign. The shared runtime app shell is explicitly out of scope: the live route keeps the production shell/nav, while the approved spec shell is used only as width and left-rail context.

## Baseline And Route

- Approved design: `file:///C:/Fin/Grit_Strategy_Lab/designs/2026-05-20-snapshots-equity-redesign/spec.html`
- Live route: `http://127.0.0.1:4173/?v=<cache-bust>#/snapshots`
- Viewports: desktop `1960x1600`, mobile `390x1200`
- Runtime data source: `GET /data-snapshots/overview` and provider registry/attempt projections
- Conditional states forced: refresh log modal, bond evidence modal, anomaly drill actions, ledger evidence actions, mobile table scroll

## Screenshot Evidence

- Approved desktop: `output/ui-artifact-trace/snapshots-review-100pct-20260520/design-final-v3-1960.png`
- Live desktop: `output/ui-artifact-trace/snapshots-review-100pct-20260520/live-final-v3-1960.png`
- Live mobile: `output/ui-artifact-trace/snapshots-review-100pct-20260520/live-mobile-final-v3-390.png`
- Refresh log modal: `output/ui-artifact-trace/snapshots-review-100pct-20260520/live-refresh-log-final-v3-1960.png`
- Bond evidence modal: `output/ui-artifact-trace/snapshots-review-100pct-20260520/live-bond-evidence-final-v3-1960.png`
- Metrics: `output/ui-artifact-trace/snapshots-review-100pct-20260520/metrics-final-v3.json`

All final screenshots above were opened and visually inspected after the last implementation pass.

## Geometry Match

| Module | Approved spec | Live route | Result |
| --- | --- | --- | --- |
| Header | top 28, left 268, width 1664, height 137 | top 28, left 268, width 1660, height 137 | PASS; 4px width delta comes from runtime shell content width |
| L1-L4 health | top 181, width 1664, height 317 | top 181, width 1660, height 317 | PASS |
| Queue and factor impact | top 514, width 1664, height 480 | top 514, width 1660, height 480 | PASS; row is above drilldown and visible in first screen |
| Drilldown row | top 1010, width 1664, height 392 | top 1010, width 1660, height 392 | PASS; four horizontal L1-L4 cards |
| Raw snapshot ledger | top 1418, width 1664, height 567.5 | top 1418, width 1660, height 568.5 | PASS |
| Credentials/config | top 2001.5, width 1664, height 617 | top 2002.5, width 1660, height 619.69 | PASS |
| Mobile body | bodyOverflow 0 | bodyOverflow 0 | PASS; no document-level horizontal overflow |

## Requirement Matrix

| Requirement | Implementation surface | Evidence | Status |
| --- | --- | --- | --- |
| Header removes the four metric cards and keeps title/copy/actions only | `web/src/pages/snapshots-page.tsx`, `.snapshots-title-card` | desktop screenshots, header geometry | PASS |
| L1-L4 health overview remains the first content module | `SnapshotOperationsConsole`, `.snapshots-ops-health-grid` | health top 181, before queue/drill/ledger | PASS |
| Pending queue row appears above drilldown and inside the first desktop screen | `.snapshots-ops-queue-row` before `.snapshots-ops-drill-grid` | queue top 514, drill top 1010 | PASS |
| Factor impact summary sits with the queue, not below drilldown | `.snapshots-ops-impact-card` | live desktop screenshot | PASS |
| Current drilldown is horizontal at desktop width | `.snapshots-ops-drill-grid` | desktop screenshot and drill geometry | PASS |
| Raw snapshot ledger is dense and contains exactly seven rows | ledger view-model in `snapshots-operations-console.tsx` | live ledgerRows 7 | PASS |
| Each ledger row exposes evidence; anomaly rows expose drilldown | ledger actions | evidenceButtons 7, drillButtons 2 | PASS |
| Bond data is folded into L1/base-market evidence, with no separate visible bond tab | `snapshots-page.tsx` route compatibility plus ledger rows | bond evidence rows present, no independent tab in live screenshot | PASS |
| Credential/config module projects real registry state and operation entries | provider registry view-model | credentialRows 7; live screenshot shows usable/restricted/invalid/path actions | PASS |
| Refresh log modal explains L1-L4 current coverage, this-run ingestion, sources, and next actions | `SnapshotRefreshLogModal` | modal rows 4, hasL1L4 true, hasSource true | PASS |
| Bond evidence modal exposes curve, eligible instruments, audit/quality, and source | `SnapshotEvidenceModal` | hasCurve true, hasEligible true, hasAudit true, hasSource true | PASS |
| Main page has no raw backend terminology leak | user-facing formatters and labels | hasRawLeak false | PASS |
| Mobile layout degrades to single-column sections without page overflow | responsive CSS and table scroll container | mobile bodyOverflow 0, ledgerRows 7 | PASS |

## Allowed Deviations

| Deviation | Reason | Status |
| --- | --- | --- |
| Live content width is 1660px while static spec content width is 1664px | Production shell/content sizing differs by 4px; module top/height/order match exactly | APPROVED |
| Runtime shell/nav differs visually from the static design shell | Shared shell is out of page-body parity scope and must preserve the live app navigation | APPROVED |
| Live credential/provider counters differ from frozen spec values | Requirement says provider/config module must use online real information | APPROVED |
| Modal states render as real overlays instead of the static inline modal-stage shown in the spec artifact | Production behavior must be click-triggered modal interaction; modal states were captured separately | APPROVED |
| One browser console 404 remains | No Playwright failed requests; page APIs and interactions pass. This appears to be a non-blocking static asset request | APPROVED |

## Validation

- `cd web; node scripts/run-vitest-fixed.cjs snapshots.page.test.tsx` -> PASS, 8 tests
- `cd web; cmd /c npm run build` -> PASS
- `GET http://127.0.0.1:8000/data-snapshots/overview` -> HTTP 200 after starting the local backend for live acceptance
- Live desktop/mobile/modals verified through cache-busting route reload and final screenshot inspection
