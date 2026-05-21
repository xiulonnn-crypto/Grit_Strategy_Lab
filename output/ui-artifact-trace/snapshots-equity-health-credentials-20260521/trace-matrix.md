# Snapshots Equity Health And Credentials Trace Matrix

## Scope

- Design source: `designs/2026-05-20-snapshots-equity-redesign/spec.html`
- Live route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- Shared shell: out of scope for page-body parity; screenshots include it only as context.
- Viewports: desktop `1440x1100`, mobile `390x1100`.
- Owned source candidates: `web/src/page-sections/snapshots-operations-console.tsx`, `web/src/pages/snapshots-page.css`, `web/src/snapshots.page.test.tsx`.
- Evidence directory: `output/ui-artifact-trace/snapshots-equity-health-credentials-20260521/`.
- Log directory: `output/logs/grit-coder/snapshots-equity-health-credentials-20260521/`.

## Acceptance Rows

| Row | Requirement | Design Evidence | Live Selector / Component | Evidence | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | L1-L4 health module title, summary chip, four-card order, and action model match the design. | `spec.html` health section | `.snapshots-ops-health`, `.snapshots-ops-health-card` | `live-after-desktop.png`; `after-live-evidence.json` shows 4 cards ordered L1-L4 and summary `2 层部分可用`. | PASS |
| 2 | L1-L4 health card structure matches design density: title+status, prominent coverage metric, short explanatory line, two mini rows, bottom action. | `spec.html` card markup | `SnapshotOperationsConsole` health card map | `after-live-evidence.json` desktop heights are `288,288,288,288`; visual check of `live-after-desktop.png`. | PASS |
| 3 | Status tones match design semantics: partial uses warning, ready uses green, watch/blocked do not show as ready. | `status-partial`, `status-ready`, `status-watch` | `statusTone`, card/status classes | L1/L4 warning, L2/L3 ready in `after-live-evidence.json`; L4 is `partial_ready`, not ready. | PASS |
| 4 | Ready cards use evidence action; partial/dependency cards use drilldown action with layer-correct anchor. | `查看证据`, `下钻缺口`, `下钻依赖` | `.snapshots-ops-health-action`, `#snapshot-ledger`, `#snapshot-layer-l*` | `after-live-evidence.json`: L1/L4 drill cards highlighted; L2/L3 evidence ledger rows highlighted. | PASS |
| 5 | Credentials module action controls are visibly clickable and produce a real response: selection/detail state, copyable command, or explicit disabled feedback. | `credential-list`, restart command rail | credentials rows/actions in `SnapshotOperationsConsole` | `after-live-evidence.json` has 7/7 credential clicks with `activeId`, detail text, command; copy button text `已复制`. | PASS |
| 6 | Desktop and mobile screenshots have no incoherent overlap, broken wrapping, or dead control affordance in the scoped modules. | design desktop/mobile render | live desktop/mobile render | Visually inspected `live-after-desktop.png`, `live-after-credential-click.png`, and `live-after-mobile.png`. | PASS |

## Known Live Substitutions

- Runtime data values may differ from design fixture values if labels, structure, tone semantics, and action placement remain aligned.
- Provider counts and credential statuses are live registry/API values.
- Shell/sidebar inventory is not judged in this task.
