# #/factors F3 生成策略操作 Trace Matrix

## Scope

- Task: `#/factors` page, F3 tab list should show `生成策略` only for S/A/B factor levels.
- Lane: UI lane.
- Design source: `DESIGN.md` `#/factors` route entry, current code contract in `web/src/pages/factors-page.tsx`.
- Route: `http://127.0.0.1:4173/?v=<timestamp>#/factors?layer=F3`.
- Shared shell scope: page body and factor table only; sidebar/top shell is out of scope.
- Desktop viewport: 1440 x 1000.
- Mobile viewport: 390 x 844.
- Screenshots: `output/logs/grit-coder/factors-f3-generate-strategy-level-gate/factors-f3-desktop.png`, `output/logs/grit-coder/factors-f3-generate-strategy-level-gate/factors-f3-mobile.png`.

## Acceptance Rows

| Row | Requirement | Selector / File | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | F3 S/A/B rows render the `生成策略` action when strategy creation is otherwise allowed. | `web/src/pages/factors-page.tsx` F3 action cell | `node scripts/run-vitest-fixed.cjs factor.model-builder.test.tsx`; Playwright DOM on `http://127.0.0.1:4184/?v=<timestamp>#/factors?layer=F3`: S row action count 2 and first action enabled | PASS |
| 2 | F3 C/D/OTHER rows do not render the `生成策略` action at all. | `web/src/pages/factors-page.tsx` F3 action cell | Focused Vitest; Playwright DOM: C/D rows each had only 1 row action (`详情`) | PASS |
| 3 | F3 S/A/B rows with hard strategy blockers may keep the visible action disabled with the blocker title. | `isCompositeFactorStrategyCandidate` / action rendering | Focused Vitest; Playwright DOM: B row action count 2 and first action disabled | PASS |
| 4 | F2/F1 rows keep the existing behavior: no composite strategy action. | F2/F1 action cell | Focused Vitest covers F2 row with no composite action | PASS |
| 5 | The action still navigates to `#/factor-models/new` with `strategy_type=COMPOSITE_FACTOR` for eligible F3 rows. | `buildCompositeFactorStrategyRoute` | Focused Vitest clicked eligible F3 action and asserted route query | PASS |

## Deviations

- 4173 live acceptance was blocked: `QuickStart-Grit.ps1 -ForceRestart` stopped/replaced backend but refused to replace frontend PID 27700 as a non-repo listener. Backend was restored on PID 6140 and `npm.cmd run build` refreshed `web/dist`, but final preflight still reported 4173 serving the old dist hash. Browser route evidence therefore used a temporary latest-source Vite server on 4184 with API fixtures.
