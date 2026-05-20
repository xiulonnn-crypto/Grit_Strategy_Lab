# 因子工厂组合方法配置 Trace Matrix

## Scope

- 设计源: `designs/2026-05-20-factor-factory-composition-methods/spec.html`
- 设计截图: `designs/2026-05-20-factor-factory-composition-methods/spec.png`
- 验收路由: `http://127.0.0.1:4173/?v=<ts>#/factors/factory`
- 验收时间: 2026-05-20
- 变更范围: 现有 `#/factors/factory` 工厂配置弹窗新增 `组合方法` tab；配置保存、snapshot 签名、Run Now/automation 执行链路消费 enabled methods；F3 输出仅进入 D2 quarantine/publishable queue。

## Live Evidence

- 桌面截图: `C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-factory-composition-methods\live-composition-config-desktop.png`
- 移动端首屏截图: `C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-factory-composition-methods\live-composition-config-mobile.png`
- 移动端行列表截图: `C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-factory-composition-methods\live-composition-config-mobile-rows.png`
- 几何数据: `C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-factory-composition-methods\live-composition-config-check.json`
- 移动端滚动数据: `C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\factor-factory-composition-methods\live-composition-config-mobile-rows-check.json`

## Design To Implementation Matrix

| ID | Requirement | Selector / Owner | Evidence | Status |
| --- | --- | --- | --- | --- |
| UI-01 | 工厂配置弹窗新增 `组合方法` tab，保持现有弹窗内完成，不新增路由。 | `web/src/pages/factor-factory-page.tsx`, `.factor-config-tabs` | live check: active tab text is `组合方法`; route remains `#/factors/factory`. | PASS |
| UI-02 | Tab 顺序与 UI 稿一致：`算子注册` 后接 `组合方法`，并保留后续配置 tab。 | `web/src/pages/factor-factory-page.tsx` | `factor.factory.test.tsx` covers tab order and visible tab label. | PASS |
| UI-03 | 方法列表必须有 7 行：线性加权、比例/风险调整、残差/正交、排名均值/交集、FFBlend、背离惩罚、时序降噪。 | `.composition-method-list`, `.composition-method-card` | live check desktop/mobile `rowCount=7`; factor factory Vitest asserts 7 methods. | PASS |
| UI-04 | 每行展示组合类型、公式、开启状态、参数摘要、D2 发布边界。 | `.composition-method-card` | desktop/mobile screenshots inspected; backend config defaults include `method_type`, `formula_template`, `enabled`, `params`, `publish_boundary`. | PASS |
| UI-05 | 右侧详情/参数面板展示当前方法的公式、源因子、参数和审计摘要。 | `.composition-method-detail`, `.composition-method-param-grid` | desktop screenshot inspected; first selected method panel is visible without overlap. | PASS |
| UI-06 | 保存草稿与创建快照按钮真实可用，并反映 dirty/save/snapshot 状态。 | factor config footer actions | live check `saveDisabled=false`, `snapshotDisabled=false`; `factor.factory.test.tsx` covers toggle, dirty save, snapshot action. | PASS |
| UI-07 | 桌面 1440x980 不横向溢出，弹窗、主区、方法列表、workbench 均不超出容器。 | `.factor-detail-modal`, `.factor-config-main`, `.composition-method-workbench`, `.composition-method-list` | live check `bodyOverflow=0`; checked containers all `overflow=0`. | PASS |
| UI-08 | 移动端 390x844 不横向溢出；方法卡可以纵向滚动且文本不撑破容器。 | same as UI-07 | live mobile check `bodyOverflow=0`; modal/main/workbench/list all `overflow=0`; mobile rows screenshot inspected. | PASS |
| CONTRACT-01 | `/factor-factory/operator-config` 与 snapshot 合约新增 `composition_methods`。 | `models.py`, `web/src/types.ts`, `_storage_restored.py` | backend owner slice passed; operator registry tests cover defaults and roundtrip. | PASS |
| CONTRACT-02 | 旧 snapshot 读取时补默认 7 方法，配置签名包含 composition methods。 | `operator_registry.py`, `_real_service_rebuilt.py` | `test_factor_factory_composition_snapshot_drives_enabled_f3_methods_and_signature` passed. | PASS |
| EXEC-01 | Run Now/automation 从 snapshot 读取 enabled methods，只生成启用方法的 F3 recipe specs。 | `_real_service_rebuilt.py`, `factor_mining.py` | snapshot test enables only `rank_pooling` and verifies exactly one F3 method candidate. | PASS |
| EXEC-02 | 候选 metadata 携带 method_id、method_type、recipe_family、source_factor_ids、formula_template、params、publish_boundary。 | `factor_mining.py`, `_real_service_rebuilt.py`, `factor_research.py` | factor factory tests assert F3 composition metadata and D2 boundary. | PASS |
| EXEC-03 | F3 组合候选不得直接写入正式因子库，只能进入 D2 quarantine / publishable queue。 | `_real_service_rebuilt.py`, factor quarantine intake | factor factory test asserts no F3 direct write into `factor_definitions` for generated expression. | PASS |
| QA-01 | 实施前 lineage preflight 为第一证据。 | `scripts/factor_factory_lineage_preflight.py` | preflight ran first: `WARN`, but raw/refined/quarantine counts all 1470; only existing manifest field warning remains. | PASS |
| QA-02 | 固定后端 owner slice 通过。 | pytest owner slice | `tests/test_factor_research_api.py tests/test_backend_api.py tests/test_factor_mining_api.py tests/test_factor_factory_api.py tests/test_factor_quarantine_api.py -q` passed. | PASS |
| QA-03 | 前端 factor factory 专项通过；完整前端 owner slice 如失败需记录阻塞项。 | `web/src/factor.factory.test.tsx` | `node scripts/run-vitest-fixed.cjs factor.factory.test.tsx` passed; full owner slice blocked by unrelated snapshots route assertions. | PASS_WITH_BLOCKER |

## Approved Deviations / Blockers

- 设计稿要求 `估值锚定` 不作为第 8 行，本次实现按计划将其收敛为 `RATIO_RISK_ADJUSTED` 的内置 recipe family/preset。
- PowerShell 直接打印 live JSON 时中文出现终端编码乱码；浏览器截图与 DOM 选择器验证正常，本问题不影响页面验收。
- 完整前端 owner slice 中 `app.routes.foundation.test.tsx` 的 snapshots 页面断言失败：找不到 `刷新债券快照` 按钮，且 `[data-snapshot-id="ds-price"]` 为空。该失败位于 snapshots 页面当前 dirty worktree 改动，不属于本次 factor factory 组合方法实现；本次 factor factory 专项 Vitest 已通过。

## Final Gate

- PASS: UI matrix rows `FAIL=0`, `BLOCKED=0`, `NOT_CHECKED=0` for factor factory composition scope.
- Residual blocker outside scope: snapshots route tests in the shared frontend owner slice.
