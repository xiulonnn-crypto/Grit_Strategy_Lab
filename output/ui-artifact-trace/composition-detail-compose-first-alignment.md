# Composition Detail Compose First Alignment Trace

Approved source:

- HTML: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-first-approved-preview.html?page=detail`
- Spec: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-first-design-spec.md`
- Approved screenshot: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-composition-detail\compose-first-approved-detail.png`
- Live screenshot: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-composition-detail\compose-first-live-detail-after-v4.png`

| Approved requirement | Runtime selector / file | Verification |
| --- | --- | --- |
| Hero uses the Compose First heading card with copy, status chips, and actions. | `web/src/components/composition-detail/composition-detail-view.tsx` hero block; `web/src/components/composition-detail/composition-detail.css` `.composition-detail-approved .composition-detail-hero` | Live screenshot top module matches approved card rhythm; status chip text localized through `formatCompositionStatusLabel`. |
| Seven KPI cards appear as a separate panel above the main detail grid. | `buildDetailKpiCards`; `.composition-detail-kpi-panel`; `.composition-detail-approved .composition-detail-kpi-grid` | `web/src/composition.detail.approved-layout.test.tsx` asserts seven KPI cards and `repeat(7, minmax(0, 1fr))`. |
| Detail body uses `1.78fr / 330px` with left analysis stack and right evidence rail. | `.composition-detail-approved-layout`; `.composition-detail-main-stack`; `.composition-detail-rail` | CSS contract test asserts `grid-template-columns: minmax(0, 1.78fr) 330px`. |
| Left stack order is cumulative return, risk/attribution, correlation matrix, scenario analysis. | `.composition-detail-approved-performance`; `.composition-detail-approved-analysis-grid`; `.composition-detail-approved-scenario-panel` | Focused render test asserts the key module headings and screenshot confirms first-screen order. |
| Right rail sections are `来源快照`, `再平衡与成本`, and `深入分析入口`. | Runtime rail sections in `composition-detail-view.tsx` | Both focused tests assert the three headings; source cards use localized shield-hash copy. |
| User-facing runtime text stays in Chinese except accepted financial terms such as Sharpe, Sortino, Alpha, and bps. | KPI detail fallbacks, source status labels, cost cadence text, drawer summary | Screenshot check confirms visible English implementation terms were removed from the first viewport. |

Validation:

- Red command: `npm.cmd test -- --run src/composition.detail.test.tsx src/composition.detail.approved-layout.test.tsx`
- Green focused command: `npm.cmd test -- --run src/composition.detail.test.tsx src/composition.detail.approved-layout.test.tsx`
- Fixed frontend slice: `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1`
