# External Import Publishable Eligibility Trace

Task: four Fama-French imports were `PASS` in B3 but absent from `可上线发布`.

Route: `http://127.0.0.1:4173/?v=<timestamp>#/factors/factory`

Evidence:
- Runtime preflight: `output/logs/grit-coder/external-import-publishable-eligibility/runtime-preflight-final.json`
- Live API summary: `output/logs/grit-coder/external-import-publishable-eligibility/overview-live-summary-final.json`
- Browser check: `browser-live-check-final.json`
- Desktop screenshot: `factory-desktop-final.png`
- Mobile screenshot: `factory-mobile-final.png`

| Requirement | Verification | Status |
| --- | --- | --- |
| Runtime is ready for live acceptance | `quickstartOverall=ready`, `decision=reuse`, backend healthy on 8000, frontend served hash matches dist hash on 4173 | PASS |
| Four external imports remain B3 PASS | API `external_quarantine_total=4`, `external_passed_count=4` | PASS |
| B3 PASS external imports become publish eligible | API `external_eligible_count=4`, `external_blocked_count=0` | PASS |
| Publish queue includes the external import candidate | API `external_publishable_count=1`; browser `publishSectionHasFamaFrench=true` and `publishSectionHasPass=true` | PASS |
| Duplicate imports are not shown as four publishable rows | The four rows share the same Fama-French dataset/target factor; publish queue dedupes to one canonical candidate | PASS |
| Desktop UI shows the candidate in `可上线发布` | Desktop screenshot inspected: Fama-French card appears in the B4 publish panel | PASS |
| Mobile UI shows the candidate in `可上线发布` | Mobile screenshot inspected: Fama-French card appears in the B4 publish panel | PASS |
| Old source materialization failure is gone | Browser `hasSourceNotMaterializedText=false` | PASS |
| Browser surface is clean | Browser `consoleErrors=[]` | PASS |

Final status: PASS=9, FAIL=0, BLOCKED=0, NOT_CHECKED=0.
