# Public Factor Imports Review Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<cache-bust>#/factors/imports`
- Shared shell: in scope for route reachability and selected sidebar presence only.
- Design/source contract: user-reported live route plus `DESIGN.md` factor governance rules that public/imported factors must remain review-gated before D2 quarantine/publish.
- Runtime evidence: `output/logs/grit-coder/factor-imports-review/runtime-preflight-final.json`
- Screenshot: `output/logs/grit-coder/factor-imports-review/factors-imports-submit-fixed-disabled.png`

## Acceptance Rows

| Requirement | Source | Implementation | Evidence | Status |
| --- | --- | --- | --- | --- |
| The page must not submit a static fallback import job before a real precheck exists. | User repro: clicking `送入复核` produced 404 against `imp_20260521_ff5_001`. | `PublicFactorImportCenterPage` gates the manifest rail primary button with `manifest.submitReady`. | Live Playwright: initial `.pfic-manifest-rail .pfic-button-primary` disabled; rail says `请先新建预检或导入本地文件`. | PASS |
| Public source precheck must produce semantic mapping evidence instead of `NEEDS_MAPPING`. | Review-gated import contract. | `FactorResearchService.create_external_factor_import_job` now builds `SOURCE_MANIFEST_READY` manifest and required mapping rows from the public factor template for `AUTO_DOWNLOAD`. | API response: `review_status=READY_FOR_REVIEW`, columns include `date/factor_id/value`, next actions are `inspect_manifest / submit_review`. | PASS |
| `送入复核` must call the live submit endpoint only when the job is ready. | User repro: button should finish review submission, not throw mapping failure. | `mapExternalFactorJob` derives `submitReady` from `READY_FOR_REVIEW` and `submit_review`. | Live Playwright: after precheck button enabled; submit request returned HTTP 200. | PASS |
| Submitted jobs must remain review-gated and not publish directly. | Factor governance boundary: D2 quarantine before publish. | Backend leaves `governance_gate=REVIEW_BEFORE_QUARANTINE`, changes status only to `REVIEW_SUBMITTED/SUBMITTED`, and next actions to D2 review/intake. | Live rail after submit: `SUBMITTED · REVIEW_BEFORE_QUARANTINE · await_d2_review / quarantine_intake_after_approval`. | PASS |
| User-facing status must show success, not the previous failure text. | User repro message. | Existing action message now fires after successful submit. | Live Playwright `.pfic-inline-status`: `已送入复核队列，后续仍需 D2 检疫与人工确认，不能直接发布。` | PASS |

## Closure

- FAIL: 0
- BLOCKED: 0
- NOT_CHECKED: 0
- Approved deviations: none.
