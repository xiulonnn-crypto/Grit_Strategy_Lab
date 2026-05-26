# Snapshots Financial Queue Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- Shared shell: in scope for screenshot framing only.
- Design/source contract: `AGENTS.md` snapshots rules plus user request on 2026-05-26.
- Owned UI files: `web/src/page-sections/snapshots-operations-console.tsx`, `web/src/snapshots.page.test.tsx`
- Evidence directory: `web/.tmp/snapshots-financial-queue/`

## Acceptance Matrix

| Requirement | Selector / owner | Evidence | Status |
| --- | --- | --- | --- |
| Pending queue only shows actionable blockers, missing credentials, permission, rate limit, and refresh failures. | `[data-testid="snapshots-pending-queue"]`, `buildQueueItems()` | Desktop queue titles: `L1 公司行为补链未完成`, `CRSP 与 Norgate 本机数据路径缺失`; status text `2 项需处理`. | PASS |
| Financial balance partial availability is retained as observation, not a pending-queue action. | `buildQueueItems()` and factor impact summary | DOM checks: `财务平衡校验部分可用` and `publish_date 与 available_at 已完整` absent from queue; quality/value summary still states balance check as observation. | PASS |
| The queue has no unnecessary "view ledger" action for a non-actionable observation. | `.snapshots-ops-queue-item button` | Desktop and mobile queue items expose only `修复 L1` and `配置路径`. | PASS |
| Desktop visual state has no overlap or raw engineering text leak in the affected first-screen section. | desktop screenshot | `web/.tmp/snapshots-financial-queue/live-snapshots-desktop.png` visually inspected. | PASS |
| Mobile visual state keeps queue cards readable and does not reintroduce the financial observation. | mobile screenshot | `web/.tmp/snapshots-financial-queue/live-snapshots-mobile.png` visually inspected; queue box rendered within viewport width. | PASS |

## Runtime And Tests

- Runtime preflight after direct start: `output/logs/grit-coder/snapshots-financial-queue/runtime-preflight-direct-start.json`, `quickstartOverall=ready`, `decision=reuse`.
- Focused unit proof: `node scripts/run-vitest-fixed.cjs snapshots.page.test.tsx`, 11 tests passed.
- Build proof: `npm.cmd run build`, Vite build passed.
- Browser proof: cache-busted desktop reload ready in 919 ms on warm run, no console errors, no failed requests.
