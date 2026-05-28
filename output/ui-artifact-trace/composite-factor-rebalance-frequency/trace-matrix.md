# Composite Factor Rebalance Frequency Trace Matrix

Task: composite-factor-rebalance-frequency

Route: `#/factor-models/new?strategy_type=COMPOSITE_FACTOR&source=factor_library&factor_id=s_alpha_ffblend_resid_mkt_rank`

Design and product sources:
- `DESIGN.md`: `#/factor-models/new` is the factor model creation workbench.
- User request: add `每季度`, `每半年`, and `每年` to the rebalance frequency control.
- Existing baseline: non-composite factor model builder already exposes monthly, quarterly, semiannual, and yearly choices.

Acceptance rows:

| Requirement | Implementation target | Verification gate | Status |
| --- | --- | --- | --- |
| Composite mode frequency control offers daily, weekly, monthly, quarterly, semiannual, and yearly. | `web/src/pages/factor-model-builder-page.tsx` composite rebalance select. | DOM/test options include `daily`, `weekly`, `monthly`, `quarterly`, `semiannual`, `yearly`; labels include `每季度`, `每半年`, `每年`. | PASS |
| Selecting an added frequency updates preview payload. | `FactorModelPreviewPayload.rebalanceLogic.frequency` and `rebalanceFrequency`. | Focused Vitest changes the select to `semiannual` and observes latest preview payload. | PASS |
| Creating a composite factor model preserves the selected frequency. | Frontend create payload and backend `CompositeRebalanceLogicRequest`. | Frontend create payload carries `semiannual`; backend create response persists `parameters.rebalance_logic.frequency`. | PASS |
| Extended values are accepted by API validation. | `src/grit_backtest_platform/models.py`. | Focused backend regression accepts at least one new extended value through preview/create. | PASS |

Evidence targets:
- Focused frontend regression: `web` command `node scripts/run-vitest-fixed.cjs factor.model-builder.test.tsx`.
- Focused backend regression: `.venv\Scripts\python.exe -m pytest tests/test_multi_factor_strategy_api.py::<new composite frequency test> -q`.
- Optional live route screenshot: `output/ui-artifact-trace/composite-factor-rebalance-frequency/live-composite-rebalance-frequency.png`.

Final evidence:
- `node scripts/run-vitest-fixed.cjs factor.model-builder.test.tsx`: PASS, 51 tests.
- `node scripts/run-vitest-fixed.cjs factors.phase0.f1.test.tsx factor.model-builder.test.tsx factor.factory.test.tsx app.routes.foundation.test.tsx`: PASS, 106 tests.
- `.venv\Scripts\python.exe -m pytest tests/test_multi_factor_strategy_api.py::test_composite_factor_create_preserves_extended_rebalance_frequency -q`: PASS.
- `.venv\Scripts\python.exe -m pytest tests/test_factor_research_api.py tests/test_backend_api.py tests/test_factor_mining_api.py tests/test_factor_factory_api.py tests/test_factor_quarantine_api.py -q`: PASS.
- `powershell -ExecutionPolicy Bypass -File .\scripts\codex-grit-runtime-preflight.ps1 -Json`: PASS, `quickstartOverall=ready`, `decision=reuse`.
- Live Playwright route check: PASS, selected `semiannual` / `每半年`; screenshot saved at `live-composite-rebalance-frequency.png`.
