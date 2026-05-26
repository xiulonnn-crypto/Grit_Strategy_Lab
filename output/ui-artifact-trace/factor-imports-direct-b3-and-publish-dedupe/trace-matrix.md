# Factor Imports Direct B3 and Publish Dedupe Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<timestamp>#/factors/factory`
- User screenshot/report:
  - External factor imports currently stop in `待 D2 接入队列`.
  - Expected path: review submission should enter B3 quarantine and produce PASS/FAIL/WARN results directly.
  - `可线上发布` must not show factors that were already historically published.
- Shared shell: in scope for route reachability and selected `因子工厂` state only.
- Design/source contracts: `DESIGN.md` factor factory row, `TECHNICAL.md` factor factory lineage gate, `AGENTS.md` staged factor rules, and current runtime DB.

## Acceptance Matrix

| Requirement | Selector / Surface | Evidence Target | Status |
| --- | --- | --- | --- |
| External import review no longer displays a manual-confirmation queue. | `[data-factory-section="external-imports"]` | Section absent after submitted imports are sent into B3; Playwright check `hasExternalReviewQueue=false`, `hasPendingD2Copy=false`. | PASS |
| Review submission creates or reuses B3 quarantine candidates. | `/factor-factory/overview`, DB `factor_quarantine_candidates` | API evidence `external_import_quarantine.summary.total=4`, `external_import_review_queue.summary.total=0`, `queue_state=MATERIALIZED_TO_B3`. | PASS |
| B3 list shows direct results for external imports. | `[data-factory-section="quarantine"]` | External Fama-French rows appear first with `FAIL` and source-file-not-materialized B3 reason; Playwright `b3ReasonCount=4`. | PASS |
| Publishable list filters factors already published historically. | `[aria-label="可上线发布"]` | `平滑收益率 (当前) [Raw]` absent from publishable section on desktop and mobile. | PASS |
| Duplicate filter is DB-backed, not page-only. | API `/factor-factory/overview` | `overview-live-summary-final.json` has `has_smooth_raw_publishable=false`; backend blocker now checks active/verified `factor_definitions` plus publish history. | PASS |
| Desktop screenshot inspected. | Screenshot | `factory-desktop-final3.png` inspected: no manual queue, B3 first rows are external FAIL results, publishable card is `F1FINANCIALRELEASETIMING (当前) [Raw]`. | PASS |
| Mobile screenshot inspected. | Screenshot | `factory-mobile-final3.png` inspected: no manual queue or horizontal overflow, B3 external result appears in mobile flow, publishable duplicate remains absent. | PASS |

## Initial Evidence

- Lineage preflight: current batch `ffr_20260526_7d79fd8b77`, source job `mine_op_e55ad4a055d2e02c`, quarantine rows `1469`, status `WARN`.
- Runtime preflight: `quickstartOverall=ready`, `decision=reuse`, backend `8000` and frontend `4173` repo-owned.

## Final Evidence

- Runtime preflight saved to `output/logs/grit-coder/factor-imports-direct-b3-and-publish-dedupe/runtime-preflight.json`: `quickstartOverall=ready`, `decision=reuse`.
- API summary saved to `output/logs/grit-coder/factor-imports-direct-b3-and-publish-dedupe/overview-live-summary-final.json`: `queue_total=0`, `queue_state=MATERIALIZED_TO_B3`, `external_total=4`, `has_smooth_raw_publishable=false`.
- Browser evidence saved to `output/ui-artifact-trace/factor-imports-direct-b3-and-publish-dedupe/browser-live-check-final3.json`: desktop/mobile both returned HTTP 200, `b3ReasonCount=4`, no external review queue, no D2/manual copy, no smooth raw candidate in publishable section.
- Screenshots inspected:
  - `output/ui-artifact-trace/factor-imports-direct-b3-and-publish-dedupe/factory-desktop-final3.png`
  - `output/ui-artifact-trace/factor-imports-direct-b3-and-publish-dedupe/factory-mobile-final3.png`

## Approved Deviations

- None yet.
