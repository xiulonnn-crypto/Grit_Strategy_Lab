# F3 Composite Factor Table Trace Matrix

Date: 2026-05-20

Design source:
- User plan: F3 composite library tab should use a F3-specific table contract and dynamic metric columns.
- User correction: F3 must keep the factor-family filter, and F3 factors must auto-classify into factor families.

Route under test:
- `http://127.0.0.1:4173/?v=f3-composite-1779271020537#/factors?layer=F3`

Runtime evidence:
- Backend: temporary live `uvicorn` on `127.0.0.1:8000`, using `.grit_backtest_platform.sqlite3`.
- Frontend: temporary repo preview `web/preview-server.mjs --watch --rebuild-on-start` on `127.0.0.1:4173`.
- Contract snapshot: `api-f3-contract.json`
- DOM/interaction snapshot: `live-check.json`
- Screenshots:
  - `desktop-f3-composite.png`
  - `desktop-f3-composite-right.png`
  - `mobile-f3-composite.png`
  - `mobile-f3-composite-right.png`

## Acceptance Matrix

| Requirement | Selector / contract | Evidence | Status |
| --- | --- | --- | --- |
| Shared shell remains in scope and factor library route is active | Sidebar plus `[data-page-root="factor-library"]` | Desktop/mobile screenshots show shell and page body together | PASS |
| Top F1/F2/F3 entry remains, F3 selected | Layer summary cards | Screenshots show `F3 组合库` selected with count `1` | PASS |
| F3 keeps factor-family filter | `.factor-family-filter` | `live-check.json`: `familyFilterPresent=1`; screenshots show `全部因子族 / 动量 / 价格 / 规模 / 估值 / 质量 / 风险 / 情绪 / 综合` | PASS |
| F3 removes local library filter only | `.factor-tier-tabs` | `live-check.json`: `localTierTabsPresent=0` | PASS |
| F3 keeps factor-level filter | `.factor-level-filter` | `live-check.json`: `levelFilterPresent=1`; screenshots show `全部因子级别 / S顶级 / A优秀 / B合格 / C微弱 / D噪声 / 其他` | PASS |
| F3 keeps lifecycle filter | `.factor-lifecycle-tabs` | `live-check.json`: `lifecycleFilterPresent=1`; screenshots show `全部生命周期 / 沙箱 / 线上 / 待校准 / 已归档` | PASS |
| F3 auto-classifies into factor family | `factorLibraryCategory()` and row category chip | Row `a_alpha_custom_cur_raw` displays `估值`; selecting `估值` keeps row; selecting `风险` shows empty state | PASS |
| F3 uses composite metric headers | Table headers | `live-check.json`: `Blend Info`, `组合质量`, `容量/摩擦`, `风格暴露`, `实盘身份` all present | PASS |
| F3 does not show F2 W/N/Z/T or RankIC/IR table slots | Table headers and first F3 row | `live-check.json`: `hasOldOperatorHeader=false`, `hasOldQualityHeader=false`, `firstRowHasRankIC=false`, `firstRowHasWNZT=false` | PASS |
| F3 contract is present and not fabricated | `GET /factors` item `composite_view` | `api-f3-contract.json`: `has_composite_view=true`; `sharpe=null`; `portfolio_id=null`; UI shows `Sharpe 待补`, `Portfolio 未绑定`, `Tag 未绑定` | PASS |
| Derived risk/turnover fields render | `latest_diagnostic_summary.scoring_detail` -> `composite_view` | Row shows `最大回撤 45.5%`, `Turnover 18.00%/周`, `Style Corr 0.260` | PASS |
| Blend Info renders lineage-derived component count | `lineage_summary.parent_ids` -> `composite_view.blend_info` | Row shows `4 个 F2 成分` and method labels | PASS |
| F3 primary action is `生成组合策略` and remains visible when top-level diagnostic status is not the hiding gate | Action column | `live-check.json`: `actionVisible=true`, `actionDisabled=false` | PASS |
| F3 action routes into composite strategy creation | Action click | `afterClickHash` is `#/factor-models/new?strategy_type=COMPOSITE_FACTOR...factor_id=a_alpha_custom_cur_raw...` | PASS |
| Desktop responsive state is usable | 1440 x 950 screenshots | Main and right-scroll screenshots inspected; dense table uses horizontal scroll with no text collision | PASS |
| Mobile responsive state is usable | 390 x 844 screenshots | Main and right-scroll screenshots inspected; filters wrap, table scrolls horizontally, action column reachable | PASS |

## Approved Deviations

- The F3 table has 11 columns and intentionally uses horizontal scroll inside `.factor-table-wrap` on desktop and mobile. The main screenshot proves the first metric columns; right-scroll screenshots prove `实盘身份`, `因子级别`, `生命周期`, `创建时间`, and `操作`.
- The live data set currently exposes one online F3 row. Empty-state behavior for a non-matching family filter was verified by selecting `风险`.

## Result

PASS: 15
FAIL: 0
BLOCKED: 0
NOT_CHECKED: 0
