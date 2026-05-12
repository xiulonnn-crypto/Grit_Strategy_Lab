# 因子治理优化 UI Trace Matrix

## 范围

- 路由: `#/factors`
- 对象: `s_vol_downside_252d_rank` / `m_vol_downsiderev_252d_rank`
- 设计源: `DESIGN.md` 因子库 4 卡摘要、治理队列浮层、严肃操作台风格；`AGENTS.md` 因子治理任务入口与二次确认规则。

## 映射

| 要求 | 实现位置 | 验证点 |
| --- | --- | --- |
| 原“查看 PIT 门禁”按钮替换为“治理任务”入口 | `web/src/pages/factors-page.tsx` PageHero actions | 主操作区按钮文本为“治理任务”，不再渲染“查看 PIT 门禁”按钮 |
| 原治理任务指标卡更新为策略使用中因子 | `web/src/pages/factors-page.tsx` `librarySummary.strategyUsageCount` 与指标卡 | 摘要卡标题为“策略使用中因子”，数值来自 `strategy_usage_factor_count` |
| 因子优化任务可确认入库 | `web/src/pages/factors-page.tsx` 治理弹层 action branch | `FACTOR_OPTIMIZATION` / `PUBLISH_OPTIMIZED_FACTOR` 显示“确认入库” |
| 入库确认必须展示候选因子和诊断摘要 | `web/src/pages/factors-page.tsx` `factor-governance-optimized` | 确认弹层展示候选名称、ID、表达式、Grade、Rank IC、IR、覆盖率 |
| 后端策略使用中因子计数 | `src/grit_backtest_platform/factor_research.py` `_strategy_usage_factor_ids` | `/factors` summary 返回 `strategy_usage_factor_count` 和 id 列表 |
| 倒挂因子治理链路 | `src/grit_backtest_platform/factor_research.py` `_factor_reverse_optimization_action` | 治理队列同时包含封存复盘和反向因子优化任务 |

## 受控偏差

- 没有把 PIT 门禁入口挪到其它页面按钮；本次按需求只替换原主操作按钮。
- 反向因子入库仍通过治理任务二次确认，不自动写入生产策略版本。
