# Trace Matrix: Public Source Manifest Audit Selection

## Scope

- User-reported route: `http://127.0.0.1:4173/#/snapshots`
- Actual module route: `http://127.0.0.1:4173/#/factors/imports`
- Source evidence: `DESIGN.md` data/factor navigation rules, live route probe, `/factor-factory/overview`, `/factor-sources/import-jobs/{id}`
- Shared shell: in scope for route reachability and nav selection only
- Viewports: desktop `1440x1100`, mobile `390x900`

## Acceptance Rows

| ID | Requirement | Selector / File | Evidence | Status |
| --- | --- | --- | --- | --- |
| TM-01 | `#/snapshots` must not be treated as the public import page; the reported modules live on `#/factors/imports`. | `web/src/lib/appRouteContext.tsx`, live DOM probe | Probe shows `#/snapshots` has no public source catalog / candidate dataset / Manifest audit modules; `#/factors/imports` has all three. | PASS |
| TM-02 | Right `Manifest 审计` must follow the selected dataset, not a global latest manifest. | `web/src/pages/public-factor-import-center-page.tsx` | Vitest `binds manifest audit and submitted status...`; live JSON `after-factor-imports-manifest-selection.json` shows AQR switch removes `extimp_` and changes rail to `aqr_us_qmj_daily`, then French restores submitted job. | PASS |
| TM-03 | Datasets with completed B3 quarantine must be visibly distinguishable in the catalog and dataset table. | `web/src/pages/public-factor-import-center-page.tsx` | Vitest checks source/table `已送检`; live JSON shows catalog and selected Fama dataset have submitted state and `data-manifest-job-id`. | PASS |
| TM-04 | Completed status must come from API/read-model evidence, not preview/static fallback. | `web/src/app-runtime-cn.tsx`, `/factor-factory/overview`, `/factor-sources/import-jobs/{id}` | Live requests include `/factor-factory/overview` and `/factor-sources/import-jobs/extimp_9b82171fac93`; first requested job is displayed in the rail with `SUBMITTED` and `b3_quarantine_completed`. | PASS |
| TM-05 | Desktop and mobile screenshots must show no body-level horizontal overflow and the audit rail/card text must change after source/dataset switch. | live browser screenshot/json | Screenshots: `after-factor-imports-manifest-selection-desktop-initial.png`, `after-factor-imports-manifest-selection-desktop-aqr.png`, `after-factor-imports-manifest-selection-mobile.png`; JSON overflow checks pass for `1440x1100` and `390x900`. | PASS |
| TM-06 | Candidate dataset filter chips must match the status displayed in the status column, including exact field names `已送检` / `可导入` / `待复核` / `参考`. | `web/src/pages/public-factor-import-center-page.tsx`, `.dataset-panel .pfic-segmented`, `.pfic-dataset-table` | Vitest `keeps candidate dataset filters aligned with displayed status labels`; live JSON `after-factor-imports-filter-status.json` shows `已送检` contains FF5, `可导入` excludes FF5 and uses status `可导入`, and `待复核` contains AQR with status `待复核`; screenshot `after-factor-imports-filter-status-column.png` visually confirms the status column. | PASS |
| TM-07 | Initial live load must not show fallback `Fama-French 5 Factors Daily = 可导入` before submitted manifest truth arrives. | `web/src/pages/public-factor-import-center-page.tsx`, `.pfic-loading-state`, `.pfic-dataset-table` | Red probe `before-factor-imports-loading-flicker.json` reproduced early `可导入` before API truth; Vitest `waits for the live view model...` gates fallback rows; live JSON `after-factor-imports-no-loading-flicker.json` shows loading state first, no candidate table at 500ms, and FF5 `已送检` after API settles. | PASS |

## Approved Deviations

- The user URL names `#/snapshots`, but the public import workbench is routed by the app to `#/factors/imports`; this fix keeps the existing route contract and reports the mismatch instead of moving modules between route groups.
