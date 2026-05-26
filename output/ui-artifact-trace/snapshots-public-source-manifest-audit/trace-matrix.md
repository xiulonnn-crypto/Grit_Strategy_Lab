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
| TM-01 | `#/snapshots` must not be treated as the public import page; the reported modules live on `#/factors/imports`. | `web/src/lib/appRouteContext.tsx`, live DOM probe | Probe shows `#/snapshots` has no `公开源目录` / `候选数据集` / `Manifest 审计`; `#/factors/imports` has all three. | PASS |
| TM-02 | Right `Manifest 审计` must follow the selected dataset, not a global latest manifest. | `web/src/pages/public-factor-import-center-page.tsx` | Pending post-fix DOM and Vitest selection test. | NOT_CHECKED |
| TM-03 | Datasets with completed B3 quarantine must be visibly distinguishable in the catalog and dataset table. | `web/src/pages/public-factor-import-center-page.tsx` | Pending post-fix DOM and Vitest selection test. | NOT_CHECKED |
| TM-04 | Completed status must come from API/read-model evidence, not preview/static fallback. | `web/src/app-runtime-cn.tsx`, `/factor-factory/overview`, `/factor-sources/import-jobs/{id}` | Pending post-fix probe must show `extimp_9b82171fac93`, `SUBMITTED`, `b3_quarantine_completed`. | NOT_CHECKED |
| TM-05 | Desktop and mobile screenshots must show no body-level horizontal overflow and the audit rail/card text must change after source/dataset switch. | live browser screenshot/json | Pending post-fix live evidence. | NOT_CHECKED |

## Approved Deviations

- The user URL names `#/snapshots`, but the public import workbench is routed by the app to `#/factors/imports`; this fix keeps the existing route contract and reports the mismatch instead of moving modules between route groups.
