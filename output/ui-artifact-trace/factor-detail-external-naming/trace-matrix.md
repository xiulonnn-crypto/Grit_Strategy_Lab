# Factor Detail External Naming Trace Matrix

- Route: `http://127.0.0.1:4173/#/factors/s_f2_mom_raw_cur_external_fama_french_us_research_factors_daily`
- Scope: page body and factor detail title/content; shared shell navigation is observed but not modified.
- Expected name: `[外部] - Fama-French 美股研究日频因子 (Daily) [Raw]`
- Rejected name: `EXTERNALFAMAFRENCHUSRESEARCHFACTORSDAILY (当前) [Raw]`
- Runtime preflight: `output/logs/grit-coder/factor-detail-external-naming/runtime-preflight-final.json`
- API evidence: `output/logs/grit-coder/factor-detail-external-naming/live-api-summary.json`
- Browser evidence: `output/ui-artifact-trace/factor-detail-external-naming/browser-live-check-final.json`
- Screenshots: `detail-desktop-final.png`, `detail-mobile-final.png`

| Gate | Evidence | Status |
| --- | --- | --- |
| Read-only duplicate-name fact table exists before edit | `output/logs/grit-coder/factor-detail-external-naming/duplicate-name-fact-table.json` records stored name, old generic projection, and desired external projection. | PASS |
| Detail API uses external import projection | `live-api-summary.json` shows `detail_display_name_cn` and `detail_base_display_name_cn` equal the expected Chinese name. | PASS |
| Factor list API uses the same projection | `live-api-summary.json` shows `list_display_name_cn` equals the expected Chinese name. | PASS |
| Naming audit survives detail API | `live-api-summary.json` shows style family `[外部]`, core semantic `Fama-French 美股研究日频因子`, governance tag `Raw`, and expert recommendations. | PASS |
| Desktop route shows expected name | `browser-live-check-final.json` has `hasExpectedName=true`, `hasWrongName=false`; screenshot visually inspected. | PASS |
| Mobile route shows expected name | `browser-live-check-final.json` has `mobileHasExpectedName=true`, `mobileHasWrongName=false`; screenshot visually inspected. | PASS |
| Runtime uses fresh backend code | `runtime-preflight-final.json` has `quickstartOverall=ready`, `decision=reuse`, backend PID `12672`, `backendStaleBySourceMtime=false`. | PASS |
| Browser has no console or request failures | `browser-live-check-final.json` has empty `consoleErrors` and `failedRequests`. | PASS |

Result: PASS=8, FAIL=0, BLOCKED=0, NOT_CHECKED=0.
