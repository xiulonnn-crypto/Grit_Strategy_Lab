# Snapshots Equity Health Button Regression Trace Matrix - 2026-05-21

## Scope

- Route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- Approved design: `designs/2026-05-20-snapshots-equity-redesign/spec.html`
- Module: `L1-L4 数据层健康`
- Files in scope:
  - `web/src/pages/snapshots-page.css`
  - `web/src/page-sections/snapshots-operations-console.tsx`
  - `web/src/snapshots.page.test.tsx`

## Regression Root Cause

Previous repair accepted the card row because desktop card heights matched one sampled viewport. The repair also introduced `.snapshots-ops-health-action` as a boxed affordance with border, white background, 32px min-height, left alignment, and 12px side padding. That override broke the approved `.btn-link` contract, whose visible state is a transparent text action with no border, no background, no padding, and auto min-height.

The height repair was also too brittle: it forced `.snapshots-ops-health-card` to `min-height: 271px` and changed internal row templates/gaps, while the design card is content-driven with `min-height: 188px`, `gap: 12px`, `border-radius: 14px`, and `margin-top: auto` on the mini list. A single height equality check hid the button box-model drift.

## Acceptance Matrix

| ID | Requirement | Selector / file | Evidence | Status |
| --- | --- | --- | --- | --- |
| H1 | Four L1-L4 cards share the same desktop height and follow design card layout: `gap=12px`, `border-radius=14px`, content-driven `min-height=188px`. | `.snapshots-ops-health-card` in `web/src/pages/snapshots-page.css` | `health-button-regression-metrics.json`: design heights `271,271,271,271`; live heights `271,271,271,271`; `liveCardSpecCss=true` | PASS |
| H2 | Card active state matches design: active border `#91ccc3`, outer 2px teal shadow, white active background. | `.snapshots-ops-health-card--active`, `.snapshots-ops-health-card--primary` | `live-health-after-click.png`; computed active state uses `#91ccc3` and outer shadow | PASS |
| B1 | Health card action buttons match approved `.btn-link`: no border, transparent background, zero padding, auto/zero min-height, full-width centered text action. | `.snapshots-ops-health-action` | `health-button-regression-metrics.json`: design/live button heights `21,21,21,21`; live border `0px`, background `transparent`, padding `0px/0px`, `liveButtonMatchesDesign=true` | PASS |
| B2 | Header and non-card action buttons keep normal button styling: 38px min-height, 9px radius, white/primary fill as designed. | `.primary-button`, `.secondary-button`, `.link-btn` outside health cards | CSS scope limits the transparent override to `.snapshots-ops-health-action`; screenshot inspection shows no boxed health-card action regression | PASS |
| I1 | `部分可用` and `阻塞` cards use drilldown actions that open the matching L1-L4 drilldown module; available cards use evidence/snapshot-list actions. | `snapshots-operations-console.tsx` | Vitest `40 passed`; `health-button-regression-metrics.json`: `l4ClickTargetsL4=true`; `live-health-after-click.png` | PASS |
| M1 | Mobile `390px` viewport has no horizontal overflow and card buttons remain unboxed text actions. | route screenshot at `390x900` | `live-health-after-mobile.png`; `scrollWidth=390`, `clientWidth=390`; mobile first button border `0px`, background `transparent` | PASS |

## Final Result

- PASS: 6
- FAIL: 0
- BLOCKED: 0
- NOT_CHECKED: 0

## Evidence Files

- Design screenshot: `design-health-desktop.png`
- Live desktop after fix: `live-health-after-desktop.png`
- Live mobile after fix: `live-health-after-mobile.png`
- Live L4 click after fix: `live-health-after-click.png`
- Metrics: `health-button-regression-metrics.json`
- Runtime preflight: `output/logs/grit-coder/snapshots-equity-health-button-regression-20260521/runtime-preflight.json`
