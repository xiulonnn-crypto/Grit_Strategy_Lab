# #/factors F3 Lineage And Quality Trace Matrix

## Scope

- Route: `http://127.0.0.1:4173/?v=<cache-bust>#/factors?layer=F3`
- Shared shell: out of scope except route reachability and body viewport fit.
- Source contract: user request on 2026-05-21 plus `DESIGN.md` dense table guidance for factor-library surfaces.
- Viewports: desktop `1440x1000`, mobile `390x844`.
- Evidence directory: `output/ui-artifact-trace/factors-f3-lineage-quality/`
- Runtime preflight: `output/logs/grit-coder/factors-f3-lineage-quality/runtime-preflight-f3-action-operator-final.json`

## Acceptance Rows

| Row | Requirement | Selector or file owner | Evidence | Status |
| --- | --- | --- | --- | --- |
| F3-01 | F3 table removes the top-level `Blend Info` column. Blend method/count moves into the lineage modal. | `web/src/pages/factors-page.tsx` F3 table and `FactorLineagePreview` | Focused Vitest, live DOM `hasBlendInfoHeader=false`, `factors-f3-lineage-dialog-desktop.png` | PASS |
| F3-02 | F3 table removes the live identity column. Portfolio/tag details remain available only as lineage audit details. | `web/src/pages/factors-page.tsx` F3 table and lineage modal | Focused Vitest, live DOM `hasLiveIdentityHeader=false`, modal `hasLiveIdentityAudit=true` | PASS |
| F3-03 | A signal quality column is inserted before combination quality. It shows `RankIC`, `IC_IR`, and decay-window values from quality/diagnostic data. | `SignalQualityCell` and F3 table | Focused Vitest, live DOM `hasSignalBeforeCombo=true`, `hasRankIc=true`, `hasIcIr=true`, `hasDecay=true` | PASS |
| F3-04 | Online-visible F3 factors do not show `待补` in signal, combination quality, capacity/cost, or style cells when diagnostic evidence exists. | `CompositeQualityCell`, `CompositeCapacityCell`, `CompositeStyleExposureCell`, `SignalQualityCell`, `_factor_composite_view` | `pending-metrics-live-check.json` desktop/mobile `visiblePending=false`, screenshots `factors-f3-pending-metrics-desktop.png` and `factors-f3-pending-metrics-mobile.png` | PASS |
| F3-05 | Lineage modal is upgraded with F1/F2/F3 flow, Blend Info audit, live identity audit, and F2 component cards. | `FactorLineagePreview` and `factors-page.css` | `factors-f3-lineage-dialog-desktop.png`, `factors-f3-lineage-dialog-mobile.png`, modal `hasComponents=true` | PASS |
| F3-06 | F3 table width and column sizing fit without incoherent overlap on desktop and mobile. No page-level or table-wrapper horizontal scrollbar is allowed. | `web/src/pages/factors-page.css` | `factors-f3-overflow-before.json` captured wrapper overflow before the fix; `factors-f3-overflow-final.json` shows desktop/mobile `pageHasHorizontalOverflow=false`, `wrapHasHorizontalOverflow=false`, `tableHasHorizontalOverflow=false`. Screenshots visually inspected. | PASS |
| F3-07 | F3 online factors derive missing quality/cost/style values only from existing diagnostics, not fabricated constants. | `src/grit_backtest_platform/factor_research.py` | `pending-metrics-f3-after-final.json`: online rows have `missing=[]`, cost source `turnover_decay`, Sharpe source `return_spread_series` where supported, style source `residualized_identity` or summary | PASS |
| F3-08 | Composite quality prioritizes a populated Sharpe value and only falls back to `增量IR` when no Sharpe/proxy evidence exists. | `web/src/pages/factors-page.tsx` `CompositeQualityCell` | Focused Vitest checks `a_alpha_custom_cur_raw` renders `Sharpe 0.55` and no `增量IR 0.55` or `Sharpe 待补`. | PASS |
| F3-09 | F3 seed metric projections must be explicit and source-labelled. Unsupported seed rows remain pending, while `s_alpha_valvol_blend_resid_std_rk` uses `SYSTEM_SEED_AUDIT_PROJECTION`. | `_value_vol_wnzt_seed_metric_summary`, `_factor_composite_view` source metadata | Backend focused test plus `factors-f3-action-operator-live-api.json`: `metric_projection_source=system_seed_audit_projection`; no persisted formal diagnostic is created. | PASS |
| F3-10 | F3 table headers for signal quality, composite quality, and capacity/friction expose accessible tooltips; the removed style exposure column no longer exposes a header tooltip. | `HeaderWithTooltip`, `F3_*_TOOLTIP_LINES`, F3 table header | Focused Vitest checks tooltip labels and confirms `风格暴露` header/tooltip is absent. Live DOM evidence records the three remaining F3 metric tooltip headers. | PASS |
| F3-11 | `a_alpha_custom_cur_raw` outputs a Sharpe value without using the 6-period synthetic return-spread annualized Sharpe. | `_factor_quarantine_proxy_sharpe`, `_factor_composite_view` | Backend focused test and live API show `Sharpe 0.55`, `sharpe_source=quarantine_incremental_ir_proxy`, `sharpe_observation_count=6`; raw 6-period spread Sharpe remains excluded. | PASS |
| F3-12 | F3 row action copy changes from `生成组合策略` to `生成策略`, while preserving the same composite-factor route parameters. | `web/src/pages/factors-page.tsx` row actions | Focused Vitest plus `factors-f3-action-operator-final.json`: `hasOldAction=false`, `hasNewAction=true`, route remains `#/factor-models/new?strategy_type=COMPOSITE_FACTOR&factor_id=s_alpha_valvol_blend_resid_std_rk`. | PASS |
| F3-13 | `s_alpha_valvol_blend_resid_std_rk` no longer shows pending signal, composite quality, capacity/friction, or operator metrics; values must be sourced from a named seed audit projection or persisted diagnostics. | `src/grit_backtest_platform/factor_research.py`, `SignalQualityCell`, composite cells | Backend owner slice, focused Vitest, `factors-f3-action-operator-live-api.json`, and DOM evidence: RankIC `0.1`, IC_IR `0.11`, decay `252日`, Sharpe `0.55`, max drawdown `12.3%`, turnover `18.00%/周`, cost `9.0 bps`, W/N/Z/T complete, `hasPending=false`. | PASS |
| F3-14 | F3 table removes the `风格暴露` column and inserts `算子状态灯` immediately after `血缘溯源`, with desktop/mobile layouts kept free of horizontal overflow. | F3 table header/body and `web/src/pages/factors-page.css` | Focused Vitest, CSS contract, and `factors-f3-action-operator-final.json`: header indexes lineage `1`, op `2`, signal `3`, style `-1`; desktop/mobile page, wrapper, and table overflow are all `false`. | PASS |

## Screenshots

- `factors-f3-desktop.png`
- `factors-f3-lineage-dialog-desktop.png`
- `factors-f3-mobile.png`
- `factors-f3-lineage-dialog-mobile.png`
- `factors-f3-pending-metrics-desktop.png`
- `factors-f3-pending-metrics-mobile.png`
- `factors-f3-tooltip-sharpe-desktop.png`
- `factors-f3-tooltip-open-desktop.png`
- `factors-f3-tooltip-sharpe-mobile.png`
- `factors-f3-overflow-before-desktop.png`
- `factors-f3-overflow-before-mobile.png`
- `factors-f3-overflow-final-desktop.png`
- `factors-f3-overflow-final-mobile.png`
- `factors-f3-action-operator-final-desktop.png`
- `factors-f3-action-operator-final-mobile.png`

## Verification Summary

- Live route loaded from cache-busted preview URL after frontend rebuild and runtime restart.
- Verification script elapsed time, including an intentional `2500ms` settle wait: desktop `3845ms`, mobile `3745ms`.
- Earlier lineage/pending checks reported console errors `0` and failed requests `0`.
- Visual inspection completed for desktop table, desktop lineage modal, mobile table/card stack, and mobile lineage modal.
- Pending-metrics live check loaded `#/factors?layer=F3` after final rebuild; desktop/mobile visible table rows `2`, `visiblePending=false`, `hasCost=true`, `hasIncrementalIr=true`, `hasSharpe063=true`, and signal column remains before combination quality.
- API evidence now distinguishes unsupported pending rows from the named `s_alpha_valvol_blend_resid_std_rk` seed projection, which carries `SYSTEM_SEED_AUDIT_PROJECTION` lineage.
- Tooltip/Sharpe live check loaded `#/factors?layer=F3` after rebuild and restart; desktop/mobile visible table rows `2`, the remaining F3 metric header tooltip labels exist, `Sharpe 0.55` is visible for `a_alpha_custom_cur_raw`, and `增量IR 0.55` is not visible in the online table.
- API evidence `a-alpha-custom-sharpe-live-api.json` records `sharpe=0.553`, `sharpe_source=quarantine_incremental_ir_proxy`, `groupReturnSeriesCount=6`, and the excluded naive 6-period annualized spread Sharpe `71.2898`.

- Overflow regression check loaded `#/factors?layer=F3` after final rebuild and ready runtime preflight. Before fix, desktop wrapper was `1100/1500` and mobile wrapper was `274/1500`. After fix, desktop wrapper/table are `1100/1100`, mobile wrapper/table are `276/276`, and both viewports report no page-level horizontal overflow.
- Mobile F3 table uses the responsive row-card layout at `390x844`: header is hidden, first row is a grid, and pseudo labels include `信号质量` and `操作`; visual inspection confirms all F3 fields remain visible without a horizontal scrollbar.
- Final action/operator check loaded `http://127.0.0.1:4173/?v=20260521-f3-action-operator-final#/factors?layer=F3` after ready runtime preflight. Because the target factor is `D噪声`, the script cleared the level filter before asserting the row. Desktop and mobile evidence show `算子状态灯` immediately after `血缘溯源`, no `风格暴露` column, no `生成组合策略` copy, `生成策略` enabled, W/N/Z/T all active, and no pending text in the target row.
- Final API evidence for `s_alpha_valvol_blend_resid_std_rk`: `rank_ic=0.1`, `ir=0.11`, `decay_days=252`, `sharpe=0.553`, `max_drawdown_pct=12.34`, `turnover_rate_weekly=18`, `cost_bps=9`, `style_corr=0.26`, `metric_projection_source=system_seed_audit_projection`, `can_create=true`, `hard_blockers=[]`.
- Final overflow evidence: desktop wrapper/table `1100/1100`, mobile wrapper/table `276/276`, page-level overflow `false`, table-wrapper overflow `false`, table overflow `false`. Desktop screenshot inspection saw one non-blocking browser console 404 for a missing static resource; API/page requests otherwise reported no failures.

## Deviations

- None.
