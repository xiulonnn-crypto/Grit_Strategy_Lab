# Allocation Results Delta Trace Matrix

Source design: `file:///C:/Users/TradeAdmin/.gstack/projects/grit-strategy-lab/designs/allocation-results-delta-20260429/allocation-results-delta-preview.html`

Live route: `http://127.0.0.1:4173/#/compositions/composition_630718a64821/allocation-jobs/alloc_job_36ea571e148f`

## Scope

| Requirement | Implementation selector / file | Evidence |
| --- | --- | --- |
| Move the candidate selector to the top of the result evidence flow. | `[data-ui="allocation-candidate-selector"]` in `web/src/pages/composition-allocation-page.tsx`; layout rules in `web/src/pages/composition-allocation-page.css`. | `green-live-evidence.json`: selector top `238`, grid top `993`; `green-live-mobile-evidence.json`: selector top `298`, decision top `2470`. |
| Remove the target alignment strip and four metric cards. | Removed result render of `.composition-allocation-verdict` and `[data-ui="allocation-delta-summary"]`. | `green-live-evidence.json`: `target=false`, `delta=false`; `green-live-mobile-evidence.json`: `target=false`, `delta=false`. |
| Keep the execution decision card in the right rail without covering the stress test. | `.composition-allocation-results-grid` now wraps only `.composition-allocation-evidence-stack` and `[data-ui="allocation-decision-card"]`; stress panel is a later page-level section. | `green-live-evidence.json`: stress scroll overlap `false`; decision rect is above stress at the stress scroll checkpoint. |
| Complete the stress test module with three scenarios, current/candidate drawdown bars, repair-cycle KPIs, and defensive-premium KPIs. | `[data-ui="allocation-stress-test"]`, `.composition-allocation-stress-bars`, `.composition-allocation-stress-kpis`. | `green-live-evidence.json`: three stress card texts captured; `green-live-desktop.png` and `green-live-mobile.png`. |
| Make the audit log control clickable and stateful. | `[data-ui="allocation-audit"] button` controls `#allocation-audit-log` with `aria-expanded`. | `green-live-evidence.json`: before hidden `true`, after hidden `false`, expanded `true`; `green-live-audit-open.png`. |

## Validation

- `npm.cmd test -- --run src/composition.allocation.test.tsx src/app.routes.foundation.test.tsx`: 24 passed.
- `powershell -ExecutionPolicy Bypass -File .\scripts\codex-test-frontend.ps1`: 184 passed.
- `npx.cmd tsc --noEmit`: no output.
- `npm.cmd run build`: Vite build succeeded; bundle size warning remained informational.
