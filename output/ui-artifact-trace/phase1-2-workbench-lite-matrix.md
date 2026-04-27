# Phase 1.2 Workbench Lite UI Artifact Trace Matrix

更新时间：2026-04-27

范围：`#/compositions/workbench`

设计结论：驳回此前大幅改版方向，改为基于当前线上页面结构的轻量增强。页面仍保留 `来源库 / 组合结构 / 摘要与诊断` 三栏阅读路径，不新增独立 Phase 1.2 大卡片，不调整 shell、hero、主网格和保存区结构。

| Phase 1.2 要求 | 当前页面承载方式 | 实现选择器 / 文件 | 状态与文案 | 验收证据 |
| --- | --- | --- | --- | --- |
| 收益流质量提示 | 嵌入既有 `成立性评分` chip，并在既有 `摘要区字段` 中新增一行 | `web/src/components/composition-workbench/composition-workbench-view.tsx`，`[data-ui="return-quality-summary"]` | `收益质量 已对齐/代理估算 · n%`，不新建收益质量大卡 | `composition.workbench.test.tsx` 验证锚点存在，`.composition-workbench-trust-panel` 不存在 |
| 调仓事件真实模拟 | 嵌入既有 `再平衡频次` 卡片底部窄条 | `[data-ui="rebalance-events-preview"]`，`.composition-workbench-inline-trust-strip` | `n 次事件 · 换手 x% · 成本 y bps`，补充首个事件日期和现金缓冲 | live DOM 返回 `rebalanceEventsCard=false`，截图 `phase1-2-workbench-lite-rail.png` |
| 成本/现金缓冲净收益拆解 | 嵌入既有 `摘要区字段` 卡片底部小网格 | `[data-ui="net-return-breakdown"]`，`.composition-workbench-trust-breakdown--compact` | 毛收益、维护成本、滑点、调仓损耗、现金缓冲 | focused test 验证锚点存在 |
| 来源签名/漂移状态 | 嵌入既有 `摘要区字段` 的 `来源签名` 行 | `[data-ui="source-integrity"]` | `2/2 来源一致`；漂移时使用 warning 行色，不自动改写组合 | live DOM 返回 `sourceIntegrityCard=false`，test 验证旧独立卡不存在 |
| 不大动页面结构 | 删除此前独立 `收益流质量 / 调仓事件 / 来源可信度` 三张新卡 | `.composition-workbench-trust-panel`、`.composition-workbench-rebalance-events`、`.composition-workbench-source-integrity` | 这些旧大卡类必须不存在 | focused test + live DOM 双重验证 |

截图证据：

- `C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\phase1-2-workbench-lite-approved.png`
- `C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\phase1-2-workbench-lite-rail.png`

测试证据：

- `npm.cmd run test -- src/composition.workbench.test.tsx`：13 passed
