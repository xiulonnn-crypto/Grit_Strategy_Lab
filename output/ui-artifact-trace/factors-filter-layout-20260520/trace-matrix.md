# Factors Filter Layout Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<timestamp>#/factors?layer=F2` and `#/factors?layer=F3`
- Shared shell: out of scope for this narrow filter layout adjustment
- Design source: user request on 2026-05-20
- Viewports: desktop `1440x960`, mobile `390x844`
- Screenshots: `desktop-f2.png`, `desktop-f3.png`, `mobile-f2.png`

## Acceptance Rows

| Requirement | Selector / File | Gate | Status | Evidence |
| --- | --- | --- | --- | --- |
| Remove the ledger library filter from F2/F3 tabs | `web/src/pages/factors-page.tsx`, `aria-label="所属库筛选"` | The ledger no longer renders the inner F1/F2/F3 library tablist | PASS | `node scripts/run-vitest-fixed.cjs factors.phase0.f1.test.tsx factor.model-builder.test.tsx factor.factory.test.tsx app.routes.foundation.test.tsx` |
| Move lifecycle filter to the `因子资产台账` header line and keep it right aligned | `.factor-ledger-header .factor-lifecycle-tabs` | Header contains the lifecycle tablist; desktop aligns it to the right of the title | PASS | Focused DOM assertion plus CSS contract in `factor.model-builder.test.tsx` |
| Move factor-level filter to the factor-family row, before the family filter | `aria-label="因子级别与因子族筛选"` | First child is `因子级别筛选`; last child is `因子族多选` | PASS | Focused DOM assertion in `factor.model-builder.test.tsx` |
| Right-align the factor-family filter within the shared filter row | `.factor-family-filter` | Family filter uses right alignment and auto left margin on desktop | PASS | CSS contract in `factor.model-builder.test.tsx` |
| Keep F2/F3 switching available through the existing layer cards | `aria-label="F1/F2/F3 因子库分层"` | F2 and F3 cards remain clickable and update the ledger scope | PASS | Focused interaction assertions in `factor.model-builder.test.tsx` |
| Default a plain `#/factors` refresh to F2 | `initialFactorTierFilterFromHash()` | Missing or invalid `layer` query resolves to `F2`, while explicit `layer=F1/F3/all` still works | PASS | New `defaults a plain factor library refresh to the F2 ledger` test |
| Live screenshot acceptance | `http://127.0.0.1:4173/?v=<timestamp>#/factors` | Runtime preflight must be `decision=reuse` before claiming live route parity | BLOCKED | `output/logs/grit-coder/factors-filter-layout-20260520/runtime-preflight.json`: `decision=probe-degraded`, backend stopped |
