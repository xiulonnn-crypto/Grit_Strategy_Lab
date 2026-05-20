# 因子详情 UI Trace Matrix - 2026-05-20

## Scope

- Design source: `DESIGN.md` factor detail route guidance plus user-reported live route defects.
- Route: `http://127.0.0.1:4173/?v=<cache-bust>#/factors/s_alpha_ffblend_blend_resid_mkt_std_rk`
- Shared shell: in scope for overflow verification; sidebar remains fixed and selected state remains on 因子库.
- Viewports: desktop `1366x900`, mobile `390x844`.

## Matrix

| Requirement | Implementation | Evidence | Status |
| --- | --- | --- | --- |
| Page must not exceed viewport or show horizontal scroll. | `.factor-page`, `.factor-panel`, rail stress cards, and audit summary all use `min-width: 0`; rail stress cards collapse to one column. | `scrollWidth=clientWidth` on desktop `1366/1366`, mobile `390/390`; `overs=[]`. Screenshots: `artifacts/factor-detail-ui/after-factor-detail-desktop-1366-real.png`, `artifacts/factor-detail-ui/after-factor-detail-mobile-390.png`. | PASS |
| Header description must not show the concrete formula. | Factor description redacts exact expression and fallback text uses "已登记公式" / "公式标签中的可回放 DSL". | DOM scan: `heroTextContainsFormula=false`; visible description count is 1. | PASS |
| Header tags remove "诊断运行" and add formula tag. | `诊断运行 ...` chip removed; new `.factor-pill--formula` chip displays `公式` with formula in `title`. | DOM chips: `已完成`, `公式`, `ds-price`, `un-sp500`. | PASS |
| Audit trail summary must not render a long sentence with raw formula, raw ISO time, and raw operator id. | Replaced paragraph with structured key-value summary: formula, data, cleaning rule, formatted diagnostic time, localized operator. | DOM trail: `公式标签已绑定`, `ds-price / un-sp500`, `quarantine-rule-v2`, `5月20日 下午05:08`, `系统规则`; formula absent. | PASS |
| Audit trail must show governance logs for pruned factors while hiding factor-model suggestion messages. | `buildFactorAuditEntries` filters strategy-draft suggestion audit rows, then appends a `PRUNE/PRUNED` governance row with retained factor id/name, reason, and correlation. | Live DOM audit text includes `冗余裁剪`, `风险调整现金流回报 (精炼)（a_alpha_custom_cur_raw）`, `相关性 0.94`; excludes `治理任务消息生成` and `生成多因子策略草稿建议，只进入待审查创建流。`. Screenshot: `artifacts/factor-detail-ui/after-governance-audit-desktop.png`. | PASS |
| Audit trail cards must reduce right-side blank space and keep timestamps right-aligned. | `.factor-detail-audit-list div` now uses `grid-template-columns: minmax(0, 1fr) max-content`; timestamp spans use `text-align: right` and `white-space: nowrap`. | Live geometry on 288px audit module: columns `150.297px 103.703px`, all `timestampRightGap=13`, all titles single-line. Screenshot: `artifacts/factor-detail-ui/after-audit-spacing-desktop.png`. | PASS |
| Mobile layout must remain readable. | Existing single-column responsive rules plus audit summary one-column mobile rule. | Mobile screenshot visually inspected; no text overlap or horizontal overflow. | PASS |

## Validation

- `node scripts/run-vitest-fixed.cjs factor.model-builder.test.tsx` passed: 48 tests.
- `node scripts/run-vitest-fixed.cjs app.routes.foundation.test.tsx -t "renders the factor detail and editor routes"` passed: 1 selected test.
- `npm.cmd run build` passed and rebuilt `web/dist`.
- Playwright live route verification on `http://127.0.0.1:4173/?v=<cache-bust>#/factors/s_alpha_ffblend_blend_resid_mkt_std_rk`: `hasPruneLog=true`, `hasKeepFactor=true`, `hasSuggestionTitle=false`, `hasSuggestionDetail=false`, `hasHorizontalOverflow=false`, `scrollWidth=1366`, `viewportWidth=1366`.
- Playwright audit-card spacing verification on the same route: `auditWidth=288`, `allTimestampsRightAligned=true`, `allTitlesSingleLine=true`, `hasHorizontalOverflow=false`.
- Full `app.routes.foundation.test.tsx` currently fails in unrelated snapshots cases: missing `刷新债券快照` button expectation, `data-snapshot-id="ds-price"` null, and `scrollIntoView is not a function` from `snapshots-operations-console.tsx`.
