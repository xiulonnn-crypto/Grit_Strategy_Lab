# Snapshots L1 Card Line Break Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- Module: `L1-L4 数据层健康` first card, `L1 基础行情`
- Design source: live approved snapshots operations console layout plus user request on 2026-05-26.
- Acceptance: the L1 primary metric must render as two deliberate lines:
  - Line 1: `股票 PIT 1154 / 1224`
  - Line 2: `ETF 3 / 3 · 债券 4 / 7`

## Gates

| Gate | Selector / Evidence | Status |
| --- | --- | --- |
| L1 metric line 1 contains only stock PIT coverage | `.snapshots-ops-health-card[data-layer-id="l1"] .snapshots-ops-metric-value-line` | PASS |
| L1 metric line 2 keeps ETF and bond coverage together | `.snapshots-ops-health-card[data-layer-id="l1"] .snapshots-ops-metric-value-line` | PASS |
| Old single-line `股票 PIT ... + ETF ... · 债券 ...` is absent from visible card text | live screenshot plus focused test rejection | PASS |
| No orphan final digit or obvious overflow in 1440px screenshot | `snapshots-l1-card-line-break-after.png` | PASS |
| Focused snapshots Vitest still passes | `node scripts/run-vitest-fixed.cjs snapshots.page.test.tsx` | PASS |

## Evidence

- Runtime preflight: `output/ui-artifact-trace/snapshots-l1-card-line-break/runtime-preflight-final.json`
- Live screenshot: `output/ui-artifact-trace/snapshots-l1-card-line-break/snapshots-l1-card-line-break-after.png`
- Build: `npm.cmd run build`
