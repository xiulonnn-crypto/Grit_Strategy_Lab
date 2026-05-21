# Factor Governance Modal Performance Trace Matrix

## Scope

- Task: optimize `#/factors` Governance Tasks modal loading and task processing performance.
- Live route: `http://127.0.0.1:4173/?v=<timestamp>#/factors`.
- API route: `GET http://127.0.0.1:8000/factor-governance/overview`.
- Write route: `POST http://127.0.0.1:8000/factor-governance/actions/{action_id}/execute`.
- Shared shell scope: page body and modal only; sidebar/top shell are not acceptance targets except route reachability.
- Design source: `DESIGN.md` `#/factors` layout plus existing modal contract in `web/src/pages/factors-page.tsx` and `web/src/pages/factors-page.css`.

## Gates

| Row | Contract | Evidence Target | Status | Evidence |
| --- | --- | --- | --- | --- |
| API-1 | Governance overview returns bounded modal data without forcing unrelated hot-path calls. | API timing JSON and targeted test. | PASS | Cold live API improved from 4.7s-7.1s baseline to 4.1s, then 32ms-45ms warm cache; focused regression proves one `list_factors` read model call. |
| API-2 | Governance action execution does not block on an immediate full overview rebuild unless the client requests it. | Response payload and targeted regression. | PASS | `include_governance_overview=false` returns the execution result without embedding a full overview rebuild; backend and frontend focused tests cover the payload. |
| UI-1 | `#/factors` first paint remains unblocked while a non-blocking governance overview prefetch warms the modal and backend cache. | Network capture and route timing. | PASS | Cache-busting route first paint measured 422ms desktop and 360ms mobile; overview requests completed in 9ms-306ms without blocking page paint. |
| UI-2 | Opening Governance Tasks shows the modal immediately with a loading state, then renders task rows after overview resolves. | Desktop screenshot and DOM/network timing. | PASS | Warm modal ready measured 65ms desktop and 30ms mobile with 24 visible governance actions. |
| UI-3 | Confirming a governance action keeps the confirmation dialog responsive, closes after success, and refreshes the task list lazily. | Interaction evidence and focused test. | PASS | Frontend sends `include_governance_overview=false`, applies an optimistic row removal, then schedules lazy refresh; focused Vitest slice passed. |
| UI-4 | Modal body remains scroll-contained with no horizontal overflow on desktop and mobile. | Desktop/mobile screenshot geometry. | PASS | Desktop and mobile screenshots were visually inspected; DOM overflowX measured 0 on both viewports. |
| COPY-1 | User-facing modal copy remains Chinese and does not expose raw enum or debug language. | DOM text scan. | PASS | Modal DOM scan found no raw enum/debug leakage in the verified governance task surface. |

## Evidence Files

- Runtime preflight: `output/logs/grit-coder/factor-governance-modal-performance/runtime-preflight-after-preview-restart.json`
- API timing baseline: `output/logs/grit-coder/factor-governance-modal-performance/api-timing.json`
- API timing after fix: `output/logs/grit-coder/factor-governance-modal-performance/api-timing-after.json`
- Service timing after cache: `output/logs/grit-coder/factor-governance-modal-performance/service-timing-after-cache.json`
- Route metrics: `output/logs/grit-coder/factor-governance-modal-performance/route-metrics.json`
- Desktop screenshot: `output/logs/grit-coder/factor-governance-modal-performance/factors-governance-desktop.png`
- Mobile screenshot: `output/logs/grit-coder/factor-governance-modal-performance/factors-governance-mobile.png`

## Allowed Live Substitutions

- Task counts, factor IDs, Rank IC/IR, and coverage values are live runtime data.
- Empty task queue is acceptable only if API and DOM both agree.
- Existing mojibake in legacy source comments or unrelated page copy is outside this slice unless it appears in the Governance Tasks modal during verification.
