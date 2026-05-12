# Factor Factory Quarantine Fix Trace Matrix - 2026-05-12

## Scope

- Route: `http://127.0.0.1:4173/?v=route-reload-codex-factory-fix#/factors/factory`
- Design source: `design.md` factor factory rules.
- User report: left mining candidate remained after sending to quarantine; rejected reason used English and treated PIT Full Ready gap as a blocker.

## Requirements To Implementation

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Already quarantined candidates must leave the D1 candidate summary | `web/src/pages/factor-factory-page.tsx` filters mined candidates using `source_mining_job_id + mining_candidate_id/expression` from the current D2 queue | `factor.factory.test.tsx` asserts quarantined candidate is absent from `[data-factory-section="sandbox"]` and present in `[data-factory-section="quarantine"]` |
| Manual intake must remain a closed D2 flow | `sendToQuarantine` still calls intake, then `runFactorQuarantineCandidate`, then reloads overview and selects the D2 result | `factor.factory.test.tsx` asserts both `/factor-quarantine/intake` and `/factor-quarantine/candidates/:id/run` are called |
| Rejected reason must be Chinese | Frontend localizes legacy English reasons before display; backend now emits Chinese blocker text for new quarantine runs | `factor.factory.test.tsx` asserts `最大回撤相对基准超过 1.5x` and no legacy English reason |
| PIT Full Ready gap is diagnostic, not a blocking reason | Backend keeps PIT gap in `diagnostic_warnings` / `pit_evidence.warnings`, but `rejected_reason` is built from hard blockers only | `tests/test_factor_quarantine_api.py` asserts drawdown rejection does not include `PIT Full Ready` |

## Live Evidence

- QuickStart supervisor state after final code: `quickstart=running`, backend PID `13784`, frontend PID `5156`, both healthy.
- `/healthz`: `{"status":"ok"}`.
- Route reachability: `4173/?v=route-reload-codex-factory-fix#/factors/factory` returned HTTP `200`.
- Live current run: `ffr_20260512_7faaa4246f`, mining job `fm_e291e6343d92`, top candidates `10`, current D2 queue `8`, computed left-panel pending candidates `2`.

## Validation

- `npm.cmd run test -- factor.factory.test.tsx`: 6 passed.
- `python -m pytest tests/test_factor_quarantine_api.py -q`: 9 passed.
- `npm.cmd run build`: passed.
