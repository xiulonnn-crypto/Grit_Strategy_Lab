# 因子工厂检疫列表与模块副标题 Trace Matrix

- 设计来源: `DESIGN.md`、用户给定路由 `http://127.0.0.1:4173/?v=route-reload-1778572998224#/factors/factory`
- 实施文件: `web/src/pages/factor-factory-page.tsx`
- 回归文件: `web/src/factor.factory.test.tsx`
- 交付日期: 2026-05-12

| 用户可见契约 | 选择器/模块 | 实现映射 | 验证 |
| --- | --- | --- | --- |
| 检疫结果列表优先置顶可发布因子 | `[data-factory-section="quarantine"] .factor-phase2-list` | `sortedQuarantineCandidates` 使用 `quarantineCandidateSortRank()`，将 `PASSED + ELIGIBLE` 排在拒绝、待审、已发布之前 | `npm.cmd run test -- factor.factory.test.tsx` 覆盖可发布因子在列表首位 |
| 可发布计数与按钮资格使用同一判定 | 检疫发布模块顶部计数、发布按钮 | `isPublishableCandidate()` 统一判定 `status === PASSED` 且 `publish_status === ELIGIBLE` | 聚焦测试覆盖 `1 个可发布` 与发布按钮可见 |
| 页面模块副标题改为中文金融治理表达 | 头部说明、状态条、漏斗说明、D1/D2/PIT 模块 eyebrow | 文案收口为「闭环因子工厂」「自动化批次」「D1 挖掘沙盒」「D2 检疫门禁」「PIT 证据链」等中文金融治理口径 | 源码 `rg` 已确认旧工程口径不再出现在页面实现 |
| PIT 缺口保留为审计/风险提示，不作为本次发布排序硬阻断 | 顶部状态条、PIT 证据链模块 | 文案明确「PIT 全量就绪缺口仅进入审计与风险提示」 | 构建通过，未改动后端检疫 API 或发布 API 契约 |

## 验证记录

- `npm.cmd run test -- factor.factory.test.tsx`: 6 passed
- `npm.cmd run build`: passed
- `git diff --check -- web/src/pages/factor-factory-page.tsx web/src/factor.factory.test.tsx CHANGELOG.md`: passed with existing CRLF warnings only
- `rg` 页面源码旧文案: no matches
- `Invoke-WebRequest http://127.0.0.1:4173/?v=route-reload-1778572998224#/factors/factory`: status 200
- `Invoke-WebRequest http://127.0.0.1:4173/assets/factor-factory-page-BOwtBTkD.js`: status 200, 已包含「闭环因子工厂」「D2 检疫门禁」「PIT 证据链」「适应度」「风格相关」
