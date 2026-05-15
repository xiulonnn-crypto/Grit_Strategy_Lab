# 因子库一期三层治理 UI Trace Matrix

更新日期：2026-05-15

## 设计源

- `artifacts/grit-design/factors-phase1-f1-f2-f3-ui.png`
- `artifacts/grit-design/factors-phase1-f1-f2-f3-ui.html`
- `artifacts/grit-design/factors-phase1-f1-f2-f3-ui-spec.md`

## 验收路由

- `http://127.0.0.1:4173/?v=height-audit-1778842759064#/factors`
- 最终初始态截图：`output/ui-artifact-trace/factors-height-live-after-initial-20260515.png`
- 最终点击血缘截图：`output/ui-artifact-trace/factors-height-live-after-click-20260515.png`
- 最终列宽修复截图：`output/ui-artifact-trace/factors-table-columns-fit-20260515.png`
- 设计稿渲染截图：`output/ui-artifact-trace/factors-height-design-20260515.png`
- 修复前截图：`output/ui-artifact-trace/factors-phase1-review-before-20260515.png`

## 追踪矩阵

| 设计要求 | 实现位置 | 验收证据 |
| --- | --- | --- |
| 首屏标题区精简为“因子库”，副标题只说明 F1/F2/F3、血缘、质量与生命周期 | `web/src/pages/factors-page.tsx` `PageHero` | 最终截图首屏标题、三枚准入胶囊和右侧操作与设计稿一致；`REPAIR` 等内部枚举未泄露 |
| F1/F2/F3 三个分层卡位于摘要卡上方，默认聚焦 F2 改造库 | `FACTOR_LAYER_TABS`、`.factor-layer-tabs` | DOM：`layerCards=["F1 原始库","F2 改造库","F3 组合库"]`，`activeLayer="F2 改造库"` |
| 摘要卡保留 F1 原始指标、F2 已标准化、F3 在线 Alpha、待校准/归档 | `librarySummary`、`.factor-library-summary` | DOM：`hasMetricF1=true`；截图显示四张摘要卡，数值来自真实 API summary |
| 因子资产台账替代旧列表标题，生命周期 tab 保留在台账右上 | `.factor-ledger-header`、`FACTOR_LIFECYCLE_TABS` | DOM：`hasLedgerTitle=true`；截图显示“全部生命周期/沙箱/线上/待校准/已归档” |
| 移除旧导出按钮、旧状态筛选、处理算子筛选、相关性筛选、分层收益单调性 | `FactorLibraryPage` 删除旧控件和模块 | DOM：`oldExportVisible=false`、`oldMonotonicVisible=false`、`oldStatusFilterVisible=false` |
| 新增 S/A/B/C/D 平铺多选，默认 S/A/B active，C/D inactive | `levelFilters`、`.factor-level-filter` | DOM：`activeLevels=["S","A","B"]`，`inactiveLevels=["C","D"]` |
| 表头顺序固定：因子基本信息、所属库、血缘溯源、算子状态灯、质量指标、因子级别、生命周期、操作 | `.factor-table--phase1 thead` | DOM 表头顺序与设计稿一致；视觉截图中生命周期和操作列可见 |
| 因子名完整展示，因子标签跟随因子名；每行信息不超过两排 | `factor-name-row`、`.factor-table--phase1` | 宽表列宽收敛后，名称、标签、ID、质量指标、生命周期、操作均在两排内 |
| 列表右侧不留大面积空白，质量指标不与 Sparkline 重叠，操作列不折行 | `.factor-table`、`.factor-table--phase1`、`.factor-diagnostic-cell`、`.factor-row-actions` | Live geometry：`rightBlankAtDefault=0`、`metricsBeforeSpark=true`、`actionsSingleLine=true`；截图 `factors-table-columns-fit-20260515.png` |
| 血缘列只展示“查看血缘”按钮，不展示长文案 | `FactorLineageCell` | 初始 DOM：`lineageVisible=false`；点击行内按钮后 `lineageVisible=true` |
| 算子状态灯展示 W/N/Z/T | `OperatorStatusLights` | 截图每行展示 W/N/Z/T 状态灯 |
| 质量指标横向排列并保留 Sparkline；Sparkline 包含 0 点断点线和 0 标记 | `DiagnosticCell`、`Sparkline`、`.factor-sparkline__zero` | DOM：`sparklineCount=4`、`zeroLineCount=4`、`zeroLabelCount=4`；截图中指标完整显示“衰减 252日/覆盖 xx.x%” |
| 操作只保留“诊断”“详情” | `.factor-row-actions` | 截图操作列仅有“诊断”“详情” |
| 血缘树预览仅在列表点击“查看血缘”后以对应因子的弹层展示，不作为页面常驻模块 | `FactorLineageCell`、`FactorLineagePreview` | 初始态 `textFlags.lineagePreview=false`；点击行内按钮后出现 `role=dialog` 弹层并绑定当前因子，支持“收起” |
| 相关性热力图更名为正交性热力图，并撑满主内容宽度 | `FactorCorrelationMatrix`、`.factor-correlation-panel` | DOM：`hasHeatmapTitle=true`、`oldCorrelationTitleVisible=false`、`heatmapWidth=1380`、`mainWidth=1380` |

## 模块高度对齐

| 模块 | 设计稿高度 | Live 初始态 | Live 点击血缘后 | 结论 |
| --- | ---: | ---: | ---: | --- |
| 头部标题模块 | 156px | 156px | 156px | 对齐 |
| F1/F2/F3 分层卡组 | 78px | 78px | 78px | 对齐 |
| 四张摘要卡 | 143px | 143px | 143px | 对齐 |
| 表格容器 | 404px | 404px | 404px | 对齐 |
| 血缘树预览弹层 | 94px | 不展示 | 94px | 初始不占页面高度，点击“查看血缘”后以弹层高度对齐 |
| 正交性热力图 | 488px | 488px | 488px | 对齐 |

## 验证记录

- 后端因子 API 专项：`.\\.venv\\Scripts\\python.exe -m pytest tests/test_factor_research_api.py -q --basetemp .tmp\\pytest-factor-phase1-review`，结果通过。
- 前端专项：`npm.cmd run test -- src/factor.model-builder.test.tsx src/app.routes.foundation.test.tsx --reporter=default`，结果 `2 passed / 71 passed`。
- 前端固定切片：`powershell -ExecutionPolicy Bypass -File .\\scripts\\codex-test-frontend.ps1`，结果 `24 passed / 347 passed`。
- 生产构建：`npm.cmd run build`，结果通过。
- Live UI：Playwright cache-busting 打开 `#/factors`，保存设计稿渲染、初始态、点击血缘后的最终截图和列宽修复截图，并验证模块高度、旧模块移除、表头顺序、Sparkline 0 线、热力图全宽、血缘点击弹层、右侧空白、指标重叠和操作折行。

## 已确认未触碰

- 未改动二期因子工厂自动化路径。
- 未绕过 D2 quarantine / publish 机制。
- 未用 mock row 替代真实 API 空态。
