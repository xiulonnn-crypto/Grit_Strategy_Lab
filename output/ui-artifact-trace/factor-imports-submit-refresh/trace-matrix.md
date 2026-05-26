# 公开因子入库送检状态刷新 Trace Matrix

## Scope

- route: `http://127.0.0.1:4173/?v=<timestamp>#/factors/imports`
- lane: Functional then UI
- shared shell scope: route reachability only; page body is in scope
- design source: `designs/2026-05-21-public-factor-import-center/spec.md`, `DESIGN.md` factor imports/factory route rules
- runtime preflight: `output/logs/grit-coder/factor-imports-review-refresh/runtime-preflight.json`
- final preflight: `output/logs/grit-coder/factor-imports-review-refresh/runtime-preflight-final.json`
- before screenshot: `output/logs/grit-coder/factor-imports-review-refresh/before-factor-imports-live.png`
- before metrics: `output/logs/grit-coder/factor-imports-review-refresh/before-factor-imports-live.json`
- after desktop screenshot: `output/logs/grit-coder/factor-imports-review-refresh/after-factor-imports-live.png`
- after desktop metrics: `output/logs/grit-coder/factor-imports-review-refresh/after-factor-imports-live.json`
- after mobile screenshot: `output/logs/grit-coder/factor-imports-review-refresh/after-factor-imports-live-mobile.png`
- after mobile metrics: `output/logs/grit-coder/factor-imports-review-refresh/after-factor-imports-live-mobile.json`

## Acceptance Gates

| Requirement | Selector / source | Evidence | Status |
| --- | --- | --- | --- |
| Submitted import job is not lost on document reload. | `PublicFactorImportRoutePage.loadViewModel`, `/factor-factory/overview`, `/factor-sources/import-jobs/{id}` | after metrics show requests to registry, factory overview, and `extimp_9b82171fac93` detail | PASS |
| Manifest rail shows the latest submitted job id, source, dataset, row count, and B3 completion action. | `.pfic-manifest-rail` | desktop metrics show job id `extimp_9b82171fac93`, source, dataset, `94,752`, and `b3_quarantine_completed` | PASS |
| Flow and rail status copy reflects submitted/B3 state instead of static semantic-mapping copy. | `.pfic-flow-panel .pfic-panel-heading span`, `.manifest-rail .pfic-panel-heading span` | desktop metrics show `已进入 B3 检疫` and `B3 检疫完成` | PASS |
| Submit button cannot resubmit a completed submission and uses user-readable submitted copy. | `.pfic-manifest-rail .pfic-button-primary` | desktop and mobile metrics show disabled `已送检` | PASS |
| Existing precheck-ready path still allows `送入复核`. | Vitest focused component test | `public-factor-import-center.test.tsx` focused path passed | PASS |
| Live route reload proves the page reads backend truth, not fallback preview. | cache-busting Playwright evidence | desktop screenshot inspected; mobile screenshot inspected; no page-level horizontal overflow on mobile | PASS |

## Approved Deviations

- none
