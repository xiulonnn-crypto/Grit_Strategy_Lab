# Factor Model S/A/B Source Trace Matrix

Task slug: `factor-model-sab-source`

Route: `http://127.0.0.1:4173/#/factor-models/new?strategy_type=COMPOSITE_FACTOR&source=factor_library&factor_id=s_alpha_ffblend_resid_mkt_rank&factorIds=s_alpha_ffblend_resid_mkt_rank&weights=100&directions=HIGH_IS_BETTER&modelName=%5B%E7%BB%BC%E5%90%88%5D%20-%20FF3%20%E9%A3%8E%E6%A0%BC%E5%A4%8D%E5%90%88%E5%9F%BA%E7%9F%B3%20(%E7%AD%89%E6%9D%83)%20%5BBeta-Free%5D%20%E7%BB%84%E5%90%88%E5%9B%A0%E5%AD%90%E7%AD%96%E7%95%A5`

Design sources:
- `DESIGN.md` `#/factor-models/new`: hero + factor basket + weight/direction + score preview + strategy gate.
- `DESIGN.md` 6.11: composite/multi-factor creation must use API `strategy_creation_risk`; offline factors must not enter selection, preview, or creation.

Scope:
- Relax composite factor source grade from S/A to S/A/B.
- Preserve existing gates: online factor, US market, L3/F3 tier, completed diagnostic, completed W/N/Z/T lights, one source factor, 100% weight.
- Do not change governance auto-suggestion policy, factor publishing, naming, batch lineage, or strategy execution semantics.

| ID | Requirement | Implementation Target | Acceptance Evidence | Status |
| --- | --- | --- | --- | --- |
| TM-01 | Composite source selector admits B-grade L3/F3 factors when all existing technical gates pass. | `web/src/pages/factor-model-builder-page.tsx`; `web/src/app-runtime-cn.tsx`; `web/src/factor.model-builder.test.tsx` | PASS: `node scripts/run-vitest-fixed.cjs factor.model-builder.test.tsx` passed 51 tests; live DOM snapshot shows one selected `s_alpha_ffblend_resid_mkt_rank` source card with `B合格`. | PASS |
| TM-02 | API preview/create eligibility admits B-grade composite source factors and returns no grade blocker. | `src/grit_backtest_platform/_real_service_rebuilt.py`; `tests/test_multi_factor_strategy_api.py` | PASS: focused pytest passed 3 tests; `output/logs/grit-coder/factor-model-sab-source/live-api-factor-model-preview.json` records `factor_level=B`, `preview_status=READY`, `blocked_count=0`, `can_create=true`. | PASS |
| TM-03 | User-facing copy states S/A/B for composite factor source eligibility. | `web/src/pages/factor-model-builder-page.tsx`; `web/src/pages/factor-phase2-pages.css` | PASS: Vitest plus desktop/mobile screenshots show S/A/B eligibility copy in hero/source modules without narrow-viewport text stacking. | PASS |
| TM-04 | C/D, offline, decayed, failed, non-US, non-L3/F3, incomplete diagnostic, or incomplete W/N/Z/T factors remain blocked by existing gates. | Existing selector and API tests plus unchanged gate conditions. | PASS: grade allow-list changed only to S/A/B; focused Vitest includes a C-grade exclusion guard and focused pytest keeps existing composite admission cases green. | PASS |
| TM-05 | Live route accepts the requested factor-library URL after rebuild/runtime preflight when local services are ready. | `#/factor-models/new?...factor_id=s_alpha_ffblend_resid_mkt_rank...` | PASS: `output/logs/grit-coder/factor-model-sab-source/runtime-preflight.json` reports `quickstartOverall=ready`; desktop/mobile browser probes call `/factor-models/preview` 200, both `创建回测` buttons enabled, and final screenshots were visually inspected. | PASS |
