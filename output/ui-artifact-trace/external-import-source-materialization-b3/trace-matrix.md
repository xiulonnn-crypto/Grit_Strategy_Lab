# External Import Source Materialization B3 Trace

Task: fix four Fama-French AUTO_DOWNLOAD imports that failed B3 because the source file was not materialized.

Route: `http://127.0.0.1:4173/?v=<timestamp>#/factors/factory`

Evidence:
- Desktop screenshot: `factory-desktop-final.png`
- Mobile screenshot: `factory-mobile-final.png`
- Browser/API check: `browser-live-check-final.json`
- Runtime preflight: `output/logs/grit-coder/external-import-source-materialization-b3/runtime-preflight-final.json`
- Live API summary: `output/logs/grit-coder/external-import-source-materialization-b3/overview-live-summary-final.json`

| Requirement | Verification | Status |
| --- | --- | --- |
| Runtime is safe for live acceptance | `quickstartOverall=ready`, `decision=reuse`, backend healthy on 8000, frontend served hash matches dist hash on 4173 | PASS |
| Review queue should not hold submitted Fama-French imports after direct B3 materialization | API `reviewQueueTotal=0`, `reviewQueueState=MATERIALIZED_TO_B3`, `reviewBoundary=DIRECT_B3_QUARANTINE` | PASS |
| Four Fama-French rows should appear in B3 quarantine, not as source-file failures | API `externalQuarantineTotal=4`, `externalPassedCount=4`, `externalRejectedCount=0`, `sourceNotMaterializedCount=0` | PASS |
| B3 must have computable source metrics | Each of first four rows has `manifest_row_count=94752`, `date_count=15792`, `factor_count=6`, `rank_ic=0.1391`, `information_ratio=0.4985` | PASS |
| Desktop UI should no longer show "source file not materialized" | Browser check `hasSourceNotMaterializedText=false`; visual inspection shows four Fama-French rows with `PASS` in B3 quarantine | PASS |
| Mobile UI should not leak the old failure reason | Browser check `mobileHasSourceNotMaterializedText=false`; screenshot inspected | PASS |
| Browser surface should be clean | Browser check `consoleErrors=[]` | PASS |

Final status: PASS=7, FAIL=0, BLOCKED=0, NOT_CHECKED=0.
