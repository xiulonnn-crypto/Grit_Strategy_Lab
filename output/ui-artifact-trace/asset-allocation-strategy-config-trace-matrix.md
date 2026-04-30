# Asset Allocation Strategy Config Trace Matrix

Source artifact: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\asset-allocation-strategy-config-20260429`

| Requirement | Implementation target | Verification |
| --- | --- | --- |
| Add a dedicated Asset Allocation strategy entry in the New Strategy modal; keep General Strategy last. | `web/src/pages/creation-template-page.tsx` template catalog and create handler. | `web/src/creation.flow.test.tsx` asserts card order and navigation. |
| The Asset Allocation entry opens a single configuration page, not the existing chat-style creation session page. | `web/src/lib/appRouteContext.tsx`, `web/src/app-runtime-cn.tsx`, `web/src/pages/asset-allocation-config-page.tsx`. | Route parser and component smoke checks. |
| Configuration is completed on one page with no step strip. | `asset-allocation-config-page.tsx` and `asset-allocation-config-page.css`. | DOM checks for page sections and absence of step labels. |
| Page supports target assets, manual weights, risk parity recommendation, investment mode, rebalance switch/frequency, and cost simulation. | Page local state plus `DemoApi.recommendAssetAllocationWeights`. | Frontend test covers recommendation apply and materialize payload. |
| Persist allocation parameters as a normal strategy creation session and materialized strategy. | `src/grit_backtest_platform/models.py`, `_creation_templates_rebuilt.py`, `_service_rebuilt.py`, `api.py`. | Backend creation-session test covers `ASSET_ALLOCATION`. |
| Details, backtest, and optimization reuse existing strategy pages and reports. | Strategy materializes with `strategy_type=ASSET_ALLOCATION`; backtest engine and optimization seeds read the same parameter snapshot. | Backtest engine test and optimization seed test. |
| Optimization recognizes flat per-symbol weight parameters and rebalance frequency. | `web/src/lib/optimization-config-fields.ts`. | Focused frontend unit test for `collectOptimizationParameterSeeds`. |
| Backtest reconstructs allocation weights from `allocation_assets` and `allocation_weight__SYMBOL_pct`. | `src/grit_backtest_platform/_backtest_engine_restored.py`, `_real_service_rebuilt.py`. | Focused backend engine test. |
| First release algorithm is risk budget / risk parity oriented with deterministic fallback. | Recommendation service in `_real_service_rebuilt.py`, API endpoint under creation session. | API unit test or frontend mocked request test. |
| No second report system or composition allocation route is created. | New route remains under `#/creation/asset-allocation/new`; final navigation uses `#/strategies/:id`. | Route/test assertions and code review. |
