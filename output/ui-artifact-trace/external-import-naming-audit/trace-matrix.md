# External Import Naming Audit Trace

Task: 【可线上发布】Fama-French external import should use the approved Chinese display name and expose naming/expert audit evidence.

Route: `http://127.0.0.1:4173/?v=<timestamp>#/factors/factory`

Evidence:
- Lineage preflight: `output/logs/grit-coder/external-import-naming-audit/lineage-preflight.json`
- Duplicate-name fact table: `output/logs/grit-coder/external-import-naming-audit/duplicate-name-fact-table.json`
- Runtime preflight: `output/logs/grit-coder/external-import-naming-audit/runtime-preflight-final.json`
- Live API summary: `output/logs/grit-coder/external-import-naming-audit/overview-live-summary-utf8-final.json`
- Browser check: `browser-live-check-final.json`
- Desktop screenshot: `factory-desktop-naming-modal-final.png`
- Mobile screenshot: `factory-mobile-naming-final.png`

| Requirement | Verification | Status |
| --- | --- | --- |
| Batch lineage is stable before naming changes | Preflight reports status OK, current batch and source job resolved, no warnings | PASS |
| Naming fact table exists before edits | `duplicate-name-fact-table.json` records online-visible F2/F3 plus 4 external import candidates and their collision group | PASS |
| Publish card uses approved Chinese name | Browser `publishSectionHasExpectedName=true`, API `apiDisplayName` equals `[外部] - Fama-French 美股研究日频因子 (Daily) [Raw]` | PASS |
| Old English display name is removed from publish card | Browser `publishSectionHasOldEnglishName=false` | PASS |
| Naming audit exposes style family, semantic, frequency, and governance state | Browser modal has naming audit; API has `[外部]`, `Fama-French 美股研究日频因子`, `Daily`, and `Raw` | PASS |
| Expert review exposes architecture recommendation | Browser modal has `专家复核建议` and `TS_Mean(..., 5)` recommendation | PASS |
| Duplicate external imports remain filtered to one canonical publish row | API `apiExternalPublishableCount=1`; 4 external quarantine candidates share the same collision group | PASS |
| Mobile publish module uses the same name | Browser `mobilePublishSectionHasExpectedName=true` and mobile screenshot inspected | PASS |
| Runtime is ready for live acceptance | Runtime preflight reports `quickstartOverall=ready`, `decision=reuse`, backend and frontend healthy | PASS |
| Browser surface is clean | Browser `consoleErrors=[]` | PASS |

Final status: PASS=10, FAIL=0, BLOCKED=0, NOT_CHECKED=0.
