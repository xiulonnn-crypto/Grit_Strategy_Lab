# Snapshots Remove IEX Trace Matrix

## Scope

- Skill: `$grit-review`
- Route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- User request: remove `IEX_TOKEN / IEX_CLOUD_TOKEN` from the `凭据与本机配置` module.
- Shared shell: out of scope, except route reachability.
- Source files: `web/src/page-sections/snapshots-operations-console.tsx`, `web/src/snapshots.page.test.tsx`.

## Runtime Evidence

- Preflight JSON: `output/logs/grit-coder/snapshots-remove-iex/runtime-preflight.json`
- Desktop screenshot: `output/ui-artifact-trace/snapshots-remove-iex/snapshots-desktop.png`
- Mobile screenshot: `output/ui-artifact-trace/snapshots-remove-iex/snapshots-mobile.png`
- DOM evidence: `output/ui-artifact-trace/snapshots-remove-iex/dom-evidence.json`

## Acceptance Rows

| Row | Requirement | Source | Verification | Status |
| --- | --- | --- | --- | --- |
| 1 | `凭据与本机配置` list must not render `IEX_TOKEN / IEX_CLOUD_TOKEN`. | User request | `dom-evidence.json` absent token checks and screenshot inspection | PASS |
| 2 | Existing key/path rows such as `CRSP_DATA_PATH`, `NORGATE_DATA_PATH`, `TIINGO_API_TOKEN`, and `ALPHAVANTAGE_API_KEY` remain visible when registry data is present. | Existing module behavior | Focused Vitest plus `dom-evidence.json` visible token checks | PASS |
| 3 | Clicking visible credential rows still updates the detail panel and copy command state. | Existing interaction contract | `node scripts/run-vitest-fixed.cjs snapshots.page.test.tsx` | PASS |
| 4 | Desktop and mobile route remain reachable with no visible overflow or raw IEX credential leak. | UI review gate | Browser screenshots and DOM metrics: `scrollWidth == width`, no console errors, no failed requests | PASS |

## Deviations

- Persistent runtime preflight remained `decision=probe-degraded` after the supervisor reported `backend-api` stopped, so final browser evidence used a temporary real FastAPI backend in the verification script. The screenshots and DOM evidence are from the real `4173` preview plus real API responses during that controlled run.
