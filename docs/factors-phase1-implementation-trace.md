# 因子库一期三层治理 UI Trace Matrix

更新日期：2026-05-18

## 设计源

- `artifacts/grit-design/factors-phase1-f1-f2-f3-ui.png`
- `artifacts/grit-design/factors-phase1-f1-f2-f3-ui.html`
- `artifacts/grit-design/factors-phase1-f1-f2-f3-ui-spec.md`

## 验收路由

- `http://127.0.0.1:4173/?v=height-audit-1778842759064#/factors`
- `http://127.0.0.1:4173/?v=factor-ledger-filters-1779082426365#/factors`
- `http://127.0.0.1:4173/?v=factor-ledger-counts-1779083072425#/factors`
- 最终初始态截图：`output/ui-artifact-trace/factors-height-live-after-initial-20260515.png`
- 最终点击血缘截图：`output/ui-artifact-trace/factors-height-live-after-click-20260515.png`
- 最终列宽修复截图：`output/ui-artifact-trace/factors-table-columns-fit-20260515.png`
- 最终台账筛选截图：`output/ui-artifact-trace/factors-ledger-filters-20260518.png`
- 最终计数一致截图：`output/ui-artifact-trace/factors-ledger-counts-default-20260518.png`
- 最终因子族联动截图：`output/ui-artifact-trace/factors-ledger-counts-fixed-20260518.png`
- 最终因子族/级别/创建时间截图：`output/ui-artifact-trace/factors-family-level-created-time-20260518.png`
- 最终动量因子族联动截图：`output/ui-artifact-trace/factors-family-level-momentum-20260518.png`
- 最终创建时间/操作列滚动截图：`output/ui-artifact-trace/factors-created-time-actions-scroll-20260518.png`
- 设计稿渲染截图：`output/ui-artifact-trace/factors-height-design-20260515.png`
- 修复前截图：`output/ui-artifact-trace/factors-phase1-review-before-20260515.png`

## 追踪矩阵

| 设计要求 | 实现位置 | 验收证据 |
| --- | --- | --- |
| 首屏标题区精简为“因子库”，副标题只说明 F1/F2/F3、血缘、质量与生命周期 | `web/src/pages/factors-page.tsx` `PageHero` | 最终截图首屏标题、三枚准入胶囊和右侧操作与设计稿一致；`REPAIR` 等内部枚举未泄露 |
| 移除顶部 F1/F2/F3 分层 tab；所属库改为因子资产台账右上第一行筛选，默认“全部库” | `FACTOR_TIER_FILTERS`、`.factor-ledger-filter-stack`、`.factor-tier-tabs` | Live DOM：`hasLayerTabs=false`、`selectedTier="全部库 9"`、`tierBeforeLifecycle=true` |
| 摘要卡保留 F1 原始指标、F2 已标准化、F3 在线 Alpha、待校准/归档 | `librarySummary`、`.factor-library-summary` | DOM：`hasMetricF1=true`；截图显示四张摘要卡，数值来自真实 API summary |
| 因子资产台账替代旧列表标题，右上两行筛选依次为“全部库”和“全部生命周期” | `.factor-ledger-header`、`FACTOR_TIER_FILTERS`、`FACTOR_LIFECYCLE_TABS` | DOM：`hasLedgerTitle=true`、`selectedLifecycle="全部生命周期 9"`；截图显示两行筛选 |
| 库筛选项、生命周期筛选项的计数取左侧因子族和因子级别过滤后的数据 | `categoryScopedFactors`、`levelScopedFactors`、`tierFilterCounts`、`lifecycleFilterCounts` | Live DOM：全部因子族时库/生命周期为 `9/9`；切到动量后同步变为 `全部库 2`、`全部生命周期 2` |
| 因子族多选器保持在左侧并与生命周期筛选器同排；移除因子族下拉框 | `.factor-ledger-secondary-row`、`.factor-family-filter`、`.factor-lifecycle-tabs` | Live DOM：`hasFamilySelect=false`、`familyLifecycleSameRow=true`；截图显示“全部因子族”在左、“全部生命周期”在右 |
| 移除旧导出按钮、旧状态筛选、处理算子筛选、相关性筛选、分层收益单调性 | `FactorLibraryPage` 删除旧控件和模块 | DOM：`oldExportVisible=false`、`oldMonotonicVisible=false`、`oldStatusFilterVisible=false` |
| 新增“全部因子级别”与 S/A/B/C/D 平铺多选，默认全部因子级别 active | `levelFilters`、`.factor-level-filter`、`.factor-level-filter__all` | DOM：`allLevelActive=true`，`S/A/B/C/D` 默认 inactive；点击具体级别后进入多选限定 |
| 表头顺序固定：因子基本信息、所属库、血缘溯源、算子状态灯、质量指标、因子级别、生命周期、创建时间、操作 | `.factor-table--phase1 thead` | DOM：`createdBeforeAction=true`、`createdAriaSort="descending"`；滚动截图中创建时间在操作列左侧 |
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
| F1/F2/F3 顶部分层 tab | 78px | 已移除 | 已移除 | 按 2026-05-18 需求改为台账右上筛选 |
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
- Live UI 复验：Playwright cache-busting 打开 `#/factors`，确认顶部 `.factor-layer-tabs` 不存在，台账右上两行筛选顺序正确，默认选中“全部库/全部生命周期”，移除“当前视图 X 个因子”文案；切换因子族为动量后，库计数和生命周期计数随可见列表同步收敛。
- Live UI 计数修复复验：默认 `rowCount=5`，右侧 active 筛选显示 `全部库 5 / 全部生命周期 5`；因子族切为动量后 `rowCount=1`，右侧 active 筛选显示 `全部库 1 / 全部生命周期 1`，因子族 select 与生命周期 tab 同排。
- Live UI 级别与创建时间复验：默认 `rowCount=9`，active 筛选显示 `全部库 9 / 全部生命周期 9`，`全部因子级别` active 且 `S/A/B/C/D` inactive；切到动量后 `rowCount=2`、右侧 active 筛选显示 `全部库 2 / 全部生命周期 2`；创建时间列 `aria-sort=descending`，时间戳按倒序排列，创建时间列位于操作列左侧。

## 已确认未触碰

- 未改动二期因子工厂自动化路径。
- 未绕过 D2 quarantine / publish 机制。
- 未用 mock row 替代真实 API 空态。
