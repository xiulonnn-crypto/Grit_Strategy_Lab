# #/snapshots UI Trace Matrix

Date: 2026-05-20
Route:
- Desktop: `http://127.0.0.1:4173/?v=1779271441027#/snapshots`
- Mobile compatibility: `http://127.0.0.1:4173/?v=1779271444047#/snapshots?tab=bond`

Design source:
- `designs/2026-05-20-snapshots-equity-redesign/spec.html`
- `designs/2026-05-20-snapshots-equity-redesign/spec.md`

Implementation files checked:
- `web/src/page-sections/snapshots-operations-console.tsx`
- `web/src/pages/snapshots-page.css`
- `web/src/snapshots.page.test.tsx`

## Supersession

The latest implementation plan and design artifact supersede the older independent bond-tab rule in `DESIGN.md` / `AGENTS.md`. The backend bond fixed-income contract remains compatible, but the product IA now renders bond fixed-income evidence inside the L1 base market-data section of the single `#/snapshots` console. `#/snapshots?tab=bond` remains a compatibility URL and opens the same console with bond evidence available.

## Acceptance Matrix

| ID | Requirement | Evidence | Status |
| --- | --- | --- | --- |
| S1 | Title area removes the four legacy cards and keeps title, description, and refresh action only. | Desktop screenshot `final-desktop-1960.png`; no card row before health module. | PASS |
| S2 | L1-L4 health overview remains the first content module. | Desktop screenshot shows `L1-L4 数据层健康` immediately after the header. | PASS |
| S3 | Pending queue row appears above the drilldown row and remains in first viewport. | DOM: `queueTop=488.23`, `drillTop=793.31`, `queueTop < drillTop`, `queueTop < 1600`. | PASS |
| S4 | Drilldown is horizontal on desktop and degrades to stacked mobile layout. | Desktop screenshot shows L1-L4 cards in one row; mobile screenshot shows single-column flow with no body overflow. | PASS |
| S5 | Raw snapshot list is high-density and each row exposes evidence. Abnormal rows expose drilldown and meaningful repair actions. | DOM: `ledgerRows=11`, `evidenceButtons=11`, `drillButtons=2`; screenshot `final-desktop-1960.png`. | PASS |
| S6 | Bond data is merged into L1 base market data and bond compatibility URL does not show legacy tabs. | DOM: `tabs=0`; mobile bond route contains bond evidence and same console. | PASS |
| S7 | Evidence modal shows snapshot id, status, coverage, source, this-run ingestion, quality audit, and next action. | `final-bond-evidence-modal.png`; DOM confirmed curve, eligible instruments, audit/accrual, source, and instrument details. | PASS |
| S8 | Refresh log modal explains current coverage, this-run ingestion, ingestion source, failure or skip reason, and next action by L1-L4. | `final-refresh-log-modal.png`; modal has 4 rows and L1-L4 labels with coverage, ingestion, and source columns. | PASS |
| S9 | Credentials and local config render real registry/attempt-derived status with actionable entries for invalid key, missing path, cooldown, usable, disabled. | Desktop screenshot credential rail; tests assert `更换 key`, `配置路径`, `查看窗口`, `查看来源`, and forced restart hint. | PASS |
| S10 | Frontstage avoids raw engineering language and untranslated codes. | DOM: `rawCodesVisible=false`, `rawSourceVisible=false`, `rawCredentialNoiseVisible=false`. | PASS |
| S11 | Ledger table keeps native table semantics while allowing name/id stacking. | DOM: `firstTdDisplay=table-cell`, `.snapshots-ops-ledger-name display=grid`. | PASS |
| S12 | Responsive surface has no horizontal body overflow. | Desktop: `bodyOverflow=0`, `contentWidth=1660`; mobile: `bodyOverflow=0`. | PASS |
| S13 | Interactions open and close modal surfaces without page errors. | Browser run opened refresh log and bond evidence modal; `pageErrors=[]`, `failedRequests=[]`. | PASS |

## Screenshots

- Desktop 1960: `output/ui-artifact-trace/snapshots-review-20260520/final-desktop-1960.png`
- Mobile bond compatibility: `output/ui-artifact-trace/snapshots-review-20260520/final-mobile-bond-390.png`
- Refresh log modal: `output/ui-artifact-trace/snapshots-review-20260520/final-refresh-log-modal.png`
- Bond evidence modal: `output/ui-artifact-trace/snapshots-review-20260520/final-bond-evidence-modal.png`

## Verification Commands

- `cd web; node scripts/run-vitest-fixed.cjs snapshots.page.test.tsx`
  - Result: PASS, 8 tests.
- `cd web; cmd /c npm run build`
  - Result: PASS, latest served bundle matched `dist/index.html` asset `assets/index-ehrgFXa2.js`.

## Runtime Notes

- `127.0.0.1:4173` initially served a stale non-repo frontend process. The stale listener was stopped and the repo preview server was restarted so cache-busted routes serve the latest bundle.
- Live route reached functional parity, but first-content timing in this local run was about 2.0s after service restart. This is above the repository's default sub-1s route target and should be tracked as a performance follow-up, not a UI parity blocker.
- Browser console contained one non-blocking static-resource 404. There were no page errors or failed route/API requests.

## Final Gate

FAIL=0
BLOCKED=0
NOT_CHECKED=0
