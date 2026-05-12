# 自动挖掘因子诊断投影 Trace Matrix

- 设计来源: 用户反馈 `#/factors/a_mom_ret_126d_z` 诊断页无数据，`#/factors` 列表显示“暂无 IC”。
- 目标路由: `http://127.0.0.1:4173/?v=route-reload-1778574795802#/factors/a_mom_ret_126d_z` 与 `#/factors`。
- 实施文件: `src/grit_backtest_platform/factor_research.py`
- 回归文件: `tests/test_factor_quarantine_api.py`
- 交付日期: 2026-05-12

| 用户可见契约 | 后端链路 | 实现映射 | 验证 |
| --- | --- | --- | --- |
| 挖掘发布后的因子诊断页必须有排序 IC、IR、覆盖率、IC 曲线、证据热力图、分层收益和换手衰减 | `POST /factor-quarantine/candidates/{id}/publish` -> `GET /factors/{id}` | 发布摘要写入检疫 `is_oos`、`orthogonal`、`stability`，并通过 `_hydrate_auto_mined_diagnostic_summary()` 生成诊断页需要的展示投影 | 回归断言 `latest_diagnostic_summary.ic_series/evidence_heatmap/group_returns/turnover_decay` 非空 |
| 历史仅有 `rank_ic/ir/coverage` 的 `AUTO_MINED` 摘要也不能显示为空 | `GET /factors/{id}` | 读取时识别 `source=AUTO_MINED` 且存在 `rank_ic` 的旧摘要，补齐 `QUARANTINE_PUBLISH_SUMMARY` 数据血缘与图表字段 | 回归先降级 `summary_json`，再验证详情页 payload 自动补齐 |
| 因子列表不再显示“暂无 IC” | `GET /factors` | `_decode_factor_row()` 在生成 `ic_sparkline` 前先归一化诊断摘要，使列表 sparkline 能消费补齐后的 `ic_series` | 回归断言 `ic_sparkline` 非空 |

## 验证记录

- `python -m pytest tests/test_factor_quarantine_api.py::test_factor_quarantine_publish_uses_chinese_auto_mined_name_from_id_and_formula -q`: passed
- `python -m py_compile src\grit_backtest_platform\factor_research.py tests\test_factor_quarantine_api.py`: passed
- `python -m pytest tests/test_factor_quarantine_api.py -q`: 10 passed
- `git diff --check -- src/grit_backtest_platform/factor_research.py tests/test_factor_quarantine_api.py CHANGELOG.md output/ui-artifact-trace/factor-auto-mined-diagnostic-projection-20260512-trace-matrix.md output/ui-artifact-trace/factor-factory-auto-mined-name-20260512-trace-matrix.md`: passed
- 临时 live API 验证: `GET /factors/a_mom_ret_126d_z` 返回 `ic_series=12`、`evidence_heatmap=10`、`group_returns=5`、`turnover_decay=true`、`data_lineage.kind=QUARANTINE_PUBLISH_SUMMARY`；`GET /factors` 中该因子 `ic_sparkline=12`。
- Runtime 限制: `QuickStart-Grit.ps1 -NoBrowser -ForceRestart` 可替换 backend，但被 `4173` 非仓库 frontend 进程阻断，supervisor 最终显示 `quickstart=partial`、`backend-api=stopped`、`frontend-preview=healthy`；本轮 live API 验证使用同命令内临时 backend 完成并关闭。
