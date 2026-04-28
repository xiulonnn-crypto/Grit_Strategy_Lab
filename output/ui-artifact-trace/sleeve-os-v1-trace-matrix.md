# Sleeve OS 组合中心 v1 UI Artifact Trace Matrix

> 状态：实现收口中。设计真源为 `sleeve-os-v1-2026-04-28` canonical Split 交付稿；Stepper 文件只保留为历史草稿，不作为实现目标。

## Canonical Sources

| Page key | Approved file | Implementation target | Status |
| --- | --- | --- | --- |
| composition-detail-command-center | `sleeve-os-composition-detail-approved-preview.html` | `#/compositions/:id` | Implemented |
| composition-backtest-split | `sleeve-os-composition-backtest-split-approved-preview.html` | `#/compositions/:id/backtest-runs/new` and `#/compositions/:id/backtest-runs/:runId` | Implemented |
| allocation-lab-split | `sleeve-os-allocation-lab-split-approved-preview.html` | `#/compositions/:id/allocation-lab` and `#/compositions/:id/allocation-jobs/:jobId` | Implemented |

## Module Mapping

| Approved module | Required implementation | Data source | Verification |
| --- | --- | --- | --- |
| 组合详情 heading / version / ruling | `CompositionDetailView` hero | `ApiCompositionDetail.hero_summary`, status, audit trail | `composition.detail.test.tsx`, `composition.detail.approved-layout.test.tsx` |
| 7 KPI row | `CompositionDetailView` KPI grid | `ApiCompositionDetail.kpis` with calculated fallbacks | `composition.detail.test.tsx` |
| 高对比收益流图 | `CompositionDetailView` return chart | `returns_preview`, `benchmark_series`, `spread_series`, `rebalance_markers` | `composition.detail.approved-layout.test.tsx` |
| 组合回测 / 执行历史 | Detail right rail execution history | Composition backtest run summaries | `composition.detail.test.tsx`, route deep link scan |
| Backtest config | `CompositionBacktestConfigPage` | Composition detail + backtest create contract | `app.routes.foundation.test.tsx` |
| Diagnosis tab | `CompositionBacktestResultPage` diagnosis tab | `diagnosis`, metrics matrix, exposure timeline | `composition.backtest.result.test.tsx` |
| Orders tab | `CompositionBacktestResultPage` orders tab | order events, full ledger, netting detail | `composition.backtest.result.test.tsx` |
| Evidence tab | `CompositionBacktestResultPage` evidence tab | frozen config, proxy logs, algorithm spec, audit trail | `composition.backtest.result.test.tsx` |
| Allocation intent config | `CompositionAllocationConfigPage` | Allocation request/default policy | `composition.allocation.test.tsx` |
| Allocation result frontier | `CompositionAllocationResultPage` | Allocation job candidates and frontier points | `composition.allocation.test.tsx` |

## Evidence Checklist

| Gate | Evidence path | Status |
| --- | --- | --- |
| Focused frontend tests | `scripts/codex-test-frontend.ps1 -StrictGlobalTypes` | Passed after adding Sleeve OS tests to fixed slice |
| Backend contract tests | `scripts/codex-test-backend.ps1` | Passed: 184 tests |
| Strict global types | `scripts/codex-test-frontend.ps1 -StrictGlobalTypes` | Passed: 16 files / 173 tests plus tsc |
| Desktop screenshot | `artifacts/sleeve-os-v1-2026-04-28/*-desktop.png` | Captured for detail, backtest config/result, allocation config/result |
| Narrow screenshot | `artifacts/sleeve-os-v1-2026-04-28/*-narrow.png` | Captured for detail, backtest config/result, allocation config/result |
| DOM copy/state scan | `artifacts/sleeve-os-v1-2026-04-28/dom-scan.json` | Passed; no design-artifact terms or console errors in captured pages |
| Interaction proof | tabs, order switch, filter, netting, frontier click | Covered by focused Vitest and live DOM capture on orders/allocation routes |

## Allowed Deviations

- Stepper pages are intentionally not implemented because the approved flow decision is Split only.
- If long-horizon or real order data is unavailable, the UI must show explicit proxy/data-quality evidence instead of presenting synthetic data as broker truth.
