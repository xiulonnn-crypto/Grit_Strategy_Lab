# UI Artifact Trace Matrix - `#/compositions/workbench`

验证目标: `http://127.0.0.1:4173/#/compositions/workbench?composition_id=composition_72f421cde7cc`

## Approved Source

- Approved screenshot: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-workbench-approved.png`
- Design spec: `C:\Users\TradeAdmin\.gstack\projects\grit-strategy-lab\designs\compose-first-2026-04-21\compose-first-design-spec.md`
- Relevant spec area: Page 3, composition workbench, three-column shell with `来源库`, `组合结构`, `摘要与诊断`, followed by bottom previews.

## Evidence Artifacts

- Before screenshot: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-workbench-20260424\gate1-live-before.png`
- Before DOM measurements: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-workbench-20260424\gate1-live-before.json`
- After screenshot: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-workbench-20260424\gate4-live-after.png`
- After DOM measurements: `C:\Fin\Grit_Strategy_Lab\.tmp\grit-review-workbench-20260424\gate4-live-after.json`

## Requirement Trace

| Requirement | Approved Source | Implementation | Before Evidence | After Evidence | Decision |
| --- | --- | --- | --- | --- | --- |
| Existing composition should show selected legs against all available source candidates. | Workbench hero chip in approved page presents source readiness as progress, not as an already-selected-only count. | `web/src/components/composition-workbench/composition-workbench-view.tsx` `heroSourceTarget`. | Live API had 2 persisted legs and the page rendered 4 source cards, but the hero chip said `来源 2 / 2 可用`. | Cache-busted live page now reports `来源 2 / 4 可用` with 4 source cards and 2 leg cards. | Fixed. |
| Right rail should stay focused on score, radar, rebalance, summary lines, warnings, and save actions. | Approved screenshot/spec Page 3 right column is `摘要与诊断`; editable composition metadata is not part of that rail. | `web/src/components/composition-workbench/composition-workbench-view.tsx` `.composition-workbench-summary-rail`. | Before DOM had 3 direct `.composition-workbench-config-field` children inside the summary rail. | After DOM has `summaryDirectConfigCount: 0`; config fields moved to `.composition-workbench-config-panel` in the middle `组合结构` column. | Fixed. |
| Basic composition metadata remains editable without disrupting the diagnosis rail. | Approved middle column owns portfolio structure and save preparation. | `web/src/components/composition-workbench/composition-workbench-view.tsx` `.composition-workbench-config-panel`; CSS grid in `composition-workbench.css`. | Metadata fields appeared as rail content and elongated the right rail before the save dock. | After DOM reports `configPanel: 1` with 3 inputs; edits still use the existing update contract. | Fixed and guarded. |
| Save dock should follow the approved sticky module-bottom rhythm. | Approved CSS contract for workbench save area uses sticky bottom spacing. | `web/src/components/composition-workbench/composition-workbench.css` `.composition-workbench-save-dock`. | Before CSS used `bottom: 0`; visual rail content made the dock cut through the summary stack. | After CSS uses `bottom: 18px`; browser evidence reports `position: sticky`, `bottom: 18px`, `order: 20`. | Fixed. |
| Regression tests should guard the content/UI contract, not only component existence. | AGENTS UI rule requires requirement-to-selector trace plus browser/CSS evidence. | `web/src/composition.workbench.test.tsx` existing composition and CSS contract tests. | Red focused test failed on `来源 2 / 3 可用` before the fix. | Focused and full `src/composition.workbench.test.tsx` pass after the fix. | Fixed and guarded. |

## Validation Commands

- Red before fix: `npm.cmd run test -- src/composition.workbench.test.tsx -t "loads an existing composition"`
- Green focused: `npm.cmd run test -- src/composition.workbench.test.tsx -t "loads an existing composition"`
- Green full file: `npm.cmd run test -- src/composition.workbench.test.tsx`
- Build: `npm.cmd run build`
- Real browser: Playwright Chromium against cache-busted `http://127.0.0.1:4173/?v=gate4-1777013628448#/compositions/workbench?composition_id=composition_72f421cde7cc`

## 2026-04-24 Live Feedback Follow-Up

| Requirement | Implementation | Evidence | Decision |
| --- | --- | --- | --- |
| Header status should show the editable draft state, not `编辑组合 composition_72f421cde7cc`. | `web/src/pages/composition-workbench-page.tsx` now passes `statusLabel={formatCompositionStatusLabel('DRAFT')}`; `composition-workbench-view.tsx` renders the draft chip. | Headless Chrome CDP on cache-busted live URL returned `statusChip: 待保存` and `hasEditIdChip: false`. | Fixed. |
| Source library should remove active recommendations/common tags and recover strategy legs from completed runs. | Workbench page merges latest eligible `listBacktestRuns` rows with `listStrategies` into transient `strategy_leg::{strategy_id}::{parameter_version_id}` source rows. | API showed `/leg-inventory` strategy count `0`, `/strategies` count `5`, eligible completed runs `8`; live DOM showed `sourceCards: 8`, `strategyCards: 4`, `hasRecommendation: false`, `hasCommonTags: false`. | Fixed. |
| Structure subtitle, selected/reference colors, residual priority, no-leg score, cash drawdown, and rebalance cost should match the feedback semantics. | View/CSS update subtitle copy, selected/locked/danger chip classes, residual danger state, no-leg score empty state, true-only drawdown area, and rebalance-derived maintenance cost. | `src/composition.workbench.test.tsx` covers no-leg score, cash-only monotonic no-drawdown, monthly cost danger, and residual danger; live DOM showed `drawdownAreas: 0`, `noDrawdownCopy: true`, `monthlyCostValues: [32.4]`, `monthlyDanger: 1`. | Fixed and guarded. |

## 2026-04-24 Composition Workbench Follow-Up B

| Requirement | Implementation | Evidence | Decision |
| --- | --- | --- | --- |
| Source library cards that are already in the structure should stop using the `当前选中` label/button state and instead show a muted `已加入` state with a full-card gray background. | `web/src/components/composition-workbench/composition-workbench-view.tsx` removes the selected chip and renames the disabled add button to `已加入`; `web/src/components/composition-workbench/composition-workbench.css` changes `.composition-workbench-source-card.is-added` to `#F8F9FA` and mutes `.composition-workbench-add-button.is-added`. | Local browser verification on `http://127.0.0.1:4173/?v=20260424-workbench#/compositions/workbench` reported `addedButtons: 2`, `currentSelected: 0`, `addedCards: 2`; live screenshot shows gray `已加入` buttons/cards. CSS contract test now asserts `background: #f8f9fa`. | Fixed and guarded. |
| Workbench source rows should come from the saved strategy-leg list semantics, not from ad-hoc workbench-only projections. | `web/src/pages/composition-workbench-page.tsx` now rehydrates only `grit.legInventory.savedStrategyLegIds.v1` entries via `web/src/lib/saved-strategy-leg-inventory.ts`, then merges those saved rows into the source inventory. | `web/src/composition.workbench.test.tsx` now stores one saved strategy leg in localStorage, verifies `已保存策略腿` appears, and verifies `未保存策略来源` does not. | Fixed and guarded. |
| Current structure overview should not repeat the type allocation summary that is already present in the legend, and should drop the correlation-count chip. | `composition-workbench-view.tsx` removes `.composition-workbench-structure-summary` and both `相关性提醒 x 条` chips while keeping the allocation legend and maintenance chip. | Live DOM verification returned `structureSummaryCount: 0`, `activeChipText: 总权重…维护成本…`, `scoreChipText: 可保存正式组合维护成本…`; frontend regression asserts the summary block is absent and chip text no longer contains `相关性提醒`. | Fixed and guarded. |
| Summary/diagnostics should remove the lower `来源可信度` row and simplify maintenance wording. | `composition-workbench-view.tsx` removes the `sourceCredibilityText` warning item and shortens `maintenanceJudgementText` to `现金腿 xx.x% 可覆盖季度维护成本，预计 yy.yy bps。`. | Live DOM verification returned `warningListText: 相关性提醒…维护判断现金腿 40.0% 可覆盖季度维护成本，预计 23.65 bps。`; frontend regression asserts the warning list excludes both `来源可信度` and `当前预计维护成本`. | Fixed and guarded. |
| The return preview should prefer real return/drawdown history for the current composition instead of the old `P1..P6` placeholder series. | `src/grit_backtest_platform/_service_rebuilt.py` now aggregates strategy run `chart_series_json`, dataset/market price bars, and cash yield proxies into monthly portfolio/benchmark/spread series before falling back. `tests/test_composition_api.py` seeds real bars for `IEF`, `SPY`, and `phase1_cash_proxy` and asserts month-keyed real preview values. | Backend regression now asserts `returns_preview` labels `2026-01..2026-03`, `portfolio_return_pct ~= 1.98 / 1.2298`, `cumulative_return_pct ~= 3.2342`, and note `Composition preview is aggregated from the latest real leg return series.` | Fixed and guarded. |
