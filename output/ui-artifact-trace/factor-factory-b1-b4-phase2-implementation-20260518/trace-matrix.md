# 因子工厂 B1-B4 实施 Trace Matrix

- 设计来源：`output/ui-artifact-trace/factor-factory-b1-b4-phase2-20260518/factor-factory-b1-b4-phase2-spec.md`
- 验收路由：`http://127.0.0.1:4173/?v=<timestamp>#/factors/factory`
- 截图：`output/ui-artifact-trace/factor-factory-b1-b4-phase2-implementation-20260518/factor-factory-b1-b4-1960-live.png`
- 视口：`1960 x 1200`

| 验收项 | 实现选择器/文件 | 实测结果 |
| --- | --- | --- |
| 页面只改造因子工厂，保留 `#/factors/factory` 生产台 | `web/src/pages/factor-factory-page.tsx`, `[data-page-root="factor-factory"]` | 页面标题为“因子工厂”，旧 `data-initial-section` 兼容属性保留 |
| 无横向滚动 | `.factor-factory-b1b4-page` | `scrollWidth=1960`, `clientWidth=1960`, `noHorizontalScroll=true` |
| 三个主模块固定高度并内部纵向滚动 | `[data-factory-section="tasks|scoring|quarantine"]`, `.factor-factory-fixed-panel` | 三个模块高度均为 `760px`，body `overflow-y=auto` |
| B1 因子任务展示任务日期、状态、最终交付数 | `[data-factory-section="tasks"]` | 任务卡显示 `2026-05-18`，状态只使用“待开始/进行中/已完成”口径 |
| B2 因子打分默认收起，一键送检统一在底部 | `[data-factory-section="scoring"]`, `.factor-factory-score-card.is-collapsed` | 当前 API 无候选时显示真实空态“暂无可送检候选”；未渲染 mock 卡片 |
| B3 因子检疫历史筛选项 | `.factor-factory-filter-row` | 实测筛选项为“日期 / 因子名 / 结果”，结果下拉包含 `全部结果/PASS/WARN/FAIL` |
| 发布因子名单仅有可发布项时展示 | `.factor-factory-publish-queue` | 当前 `publishable_count=0`，发布名单未展示，符合条件渲染 |
| F1 原始库准入口径 | `.factor-factory-admission-rules` | 页面展示“F1 因子挖掘类任务只看 PIT 准入审计，RankIC、ICIR、OOS 衰减等收益阈值不阻断 L1 发布。” |
