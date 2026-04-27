# UI Artifact Trace Matrix - Phase 1.2 Trust

Target package: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\phase1-2-trust-2026-04-27`

## Approved Source

- Base preview: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-first-approved-preview.html`
- Preview: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\phase1-2-trust-2026-04-27\phase1-2-approved-preview.html`
- Workbench: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\phase1-2-trust-2026-04-27\phase1-2-workbench-approved.png`
- Detail: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\phase1-2-trust-2026-04-27\phase1-2-detail-approved.png`
- Bond snapshots: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\phase1-2-trust-2026-04-27\phase1-2-bond-snapshots-approved.png`
- Leg inventory: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\phase1-2-trust-2026-04-27\phase1-2-leg-inventory-approved.png`
- Spec: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\phase1-2-trust-2026-04-27\phase1-2-design-spec.md`
- Manifest: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\phase1-2-trust-2026-04-27\phase1-2-implementation-manifest.json`

## Requirement Trace

| Page | Requirement | Data contract | Implementation target | UI selector/copy hook | Focused test |
| --- | --- | --- | --- | --- | --- |
| `#/compositions/workbench` | Show aligned return quality, net return breakdown, real rebalance events, and source integrity while preserving the approved Compose First workbench shell. | `ApiCompositionPreview.return_quality_summary`, `rebalance_events`, `source_integrity`, extended `risk_contribution_preview`. | `web/src/components/composition-workbench/composition-workbench-view.tsx`, `web/src/components/composition-workbench/composition-workbench.css`. | `[data-ui="return-quality-summary"]`, `[data-ui="net-return-breakdown"]`, `[data-ui="rebalance-events-preview"]`, `[data-ui="source-integrity"]`; Chinese hooks: `收益流质量`, `净收益拆解`, `调仓事件`, `来源签名`. | `web/src/composition.workbench.test.tsx` |
| `#/compositions/:id` | Explain saved composition trust without rewriting frozen evidence: source signature rail, drift warning, audit trail, expanded risk contribution. | `ApiCompositionDetail.audit_trail`, extended `source_evidence`, `return_quality_summary`, `rebalance_events`, extended risk fields. | `web/src/components/composition-detail/composition-detail-view.tsx`, `web/src/components/composition-detail/composition-detail.css`. | `[data-ui="source-signature-rail"]`, `[data-ui="source-drift-alert"]`, `[data-ui="composition-audit-trail"]`, `[data-ui="risk-contribution-explanation"]`; Chinese hooks: `来源签名`, `冻结哈希`, `版本漂移`, `审计轨迹`, `预算占用`. | `web/src/composition.detail.test.tsx` |
| `#/snapshots?tab=bond` | Keep bond under `GET /data-snapshots/overview`, adding quality audit, daily accrual, repair rules, and duration/convexity risk budget precheck. | `ApiBondFixedIncomeOverview.quality_audit`, `repair_rules`, `daily_accrual_status`, `risk_budget_inputs`. | `web/src/page-sections/snapshots-bond-fixed-income.tsx`, `web/src/pages/snapshots-page.css`. | `[data-ui="asset-leg-eligibility-rail"]`, `[data-ui="daily-accrual-status"]`, `[data-ui="risk-budget-precheck"]`, `[data-ui="bond-quality-audit-matrix"]`, `[data-ui="bond-repair-rules"]`; Chinese hooks: `资产腿创建`, `日频应计`, `风险预算预检`, `质量审计`, `修复目标 bond`. | `web/src/snapshots.page.test.tsx` |
| `#/legs` | Surface source invalidation, version drift, freeze hash summary, and compose/repair readiness in the leg list and create drawer. | Leg config/source summary fields: `freeze_hash`, `signature_status`, `drift_status`, `current_ref_id`, `alerts`. | `web/src/components/legs/leg-inventory-view.tsx`, `web/src/components/legs/leg-create-drawer.tsx`, `web/src/components/legs/leg-inventory.css`. | `[data-ui="leg-source-trust-table"]`, `[data-ui="leg-source-evidence-drawer"]`, `[data-ui="leg-freeze-hash"]`, `[data-ui="leg-drift-status"]`; Chinese hooks: `冻结哈希`, `版本漂移`, `需修复`, `可进入组合`. | `web/src/leg.inventory.test.tsx` |

## Acceptance Notes

- Drift is advisory only; frozen composition detail reads frozen evidence.
- Bond asset-leg creation eligibility and read-only risk-budget readiness must remain separate UI states.
- Live DOM proof on 2026-04-27 used cache-busting `http://127.0.0.1:4173/?v=<stamp>#/...` and confirmed the Phase 1.2 anchors on workbench, detail, bond snapshots, and leg inventory against the active `8000` backend and `4173` preview server.
- Live fixture-backed acceptance remains blocked until `harness/fixtures/seed_workspace/` is restored.

## Validation Commands

- Backend fixed slice: `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1`
- Frontend fixed slice: `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1`
- Strict global types: `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes`

## Latest Validation

- Focused UI tests: `npm.cmd run test -- src/composition.workbench.test.tsx src/composition.detail.test.tsx src/leg.inventory.test.tsx src/snapshots.page.test.tsx` -> 41 passed.
- Frontend fixed slice: `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1` -> 141 passed.
- Strict global types: `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1 -StrictGlobalTypes` -> 141 passed plus strict type report succeeded.
- Backend fixed slice: `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-backend.ps1` initially exceeded the tool timeout, then completed and wrote `harness/reports/smoke/latest-backend.txt` -> 167 passed.
