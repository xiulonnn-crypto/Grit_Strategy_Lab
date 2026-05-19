# Factor Factory Phase 1 WNZT UI Trace Matrix

Date: 2026-05-19

Design Source:
- `designs/2026-05-19-factor-factory-phase1-wnztod/spec.html`
- `designs/2026-05-19-factor-factory-phase1-wnztod/spec.md`
- `designs/2026-05-19-factor-factory-phase1-wnztod/spec.png`

Route Scope:
- `#/factors/factory`
- `#/factors/sandbox`
- `#/factors/quarantine`

Acceptance Matrix:

| Requirement | Implementation Anchor | Verification Gate |
| --- | --- | --- |
| Keep existing page skeleton: hero, status strip, monitors, three-column workbench, admission rules, config modal | `web/src/pages/factor-factory-page.tsx`, `web/src/pages/factor-phase2-pages.css` | Cache-busting route screenshot and DOM text scan |
| B1 mining task shows `F1 -> 算子展开 -> Raw_F2` | `task_rows[].flow`, `.factor-factory-task-flow` | DOM contains `F1`, `算子展开`, `Raw_F2` in task card |
| B1 governance task shows `Raw_F2 -> WNZT -> Refined F2`; O/T optional off | `task_rows[].flow`, `optional_chain`, config modal governance tab | DOM contains `WNZT`, `Refined F2`, and optional O/T chips as off/skipped |
| B2 is narrower and candidate cards only show factor name, `WNZT 4/4`, and max two chips | `.factor-factory-workbench--b1b4`, `.factor-factory-score-card` | Geometry: B2 column narrower than B1/B3; card chip count <= 2 |
| B3 is wider and table columns are 日期 / 因子名 / 裁决 / 原因 / 操作 | `.factor-factory-result-row` | DOM column header assertion and geometry no horizontal clipping |
| Factory config modal follows Phase 0 layout `196px / content / 330px` | `.factor-config-modal__body` | CSS grid template equals `196px minmax(0, 1fr) 330px` |
| Config modal tabs: 算子注册, 治理协议, 准入闸门, WNZT 证据与检疫裁决, 配置快照 | `FACTORY_CONFIG_TABS` | DOM tab text assertion |
| WNZT evidence and quarantine decision live in config modal tabs | `evidenceTab`, `gateTab`, `snapshotTab` | Open modal screenshot covers tabs and side summary |
| Page copy uses concise Chinese finance wording | visible labels in factory page and modal | DOM scan confirms no `WNZTOD` main flow and no O/T enabled default wording |

Responsive Gates:
- Desktop 1440x900: three-column workbench visible, B3 table fully readable.
- Mobile 390x844: workbench stacks without text overlap; config modal tabs collapse per existing responsive CSS.

Live Evidence:
- Route: `http://127.0.0.1:4173/?v=phase1-css-1779188016194#/factors/factory`
- Screenshot: `output/ui-artifact-trace/factor-factory-phase1-live-20260519.png`
- Config modal screenshot: `output/ui-artifact-trace/factor-factory-phase1-config-modal-live-20260519.png`
- Desktop geometry 1440x1000: B1 `326x760`, B2 `218x760`, B3 `564x760`; B2 is narrower and B3 is wider.
- DOM proof: title `因子任务生产台`; visible text includes `Raw_F2`, `WNZT`, `Refined F2`, `裁决`; main flow does not expose `WNZTOD 标准流`.
- Config modal proof: dialog `1344x928`; tabs are `算子注册`, `治理协议`, `准入闸门`, `WNZT 证据与检疫裁决`, `配置快照`; modal text includes `10,000` and `pandas_bottleneck`.
- Route reachability proof: `#/factors/sandbox` and `#/factors/quarantine` both rendered the factor task page body through cache-busting navigation.
