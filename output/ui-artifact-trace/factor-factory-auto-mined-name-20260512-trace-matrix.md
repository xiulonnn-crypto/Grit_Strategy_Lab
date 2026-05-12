# 因子工厂自动挖掘因子身份生成 Trace Matrix

- 设计来源: 用户反馈「新因子的 id 和中文名都应该基于公式合理地生成」
- 目标路由: `#/factors/factory` 发布动作，发布后进入 `#/factors` / `#/factor-models/new` 等因子消费面
- 实施文件: `src/grit_backtest_platform/factor_research.py`
- 回归文件: `tests/test_factor_quarantine_api.py`
- 交付日期: 2026-05-12

| 用户可见契约 | 后端链路 | 实现映射 | 验证 |
| --- | --- | --- | --- |
| 点击“发布因子”生成的 `AUTO_MINED` 因子不再使用 `a_*_auto_<hash>_*` 这类不可读 ID | `POST /factor-quarantine/candidates/{id}/publish` | `_infer_auto_factor_id()` 调用 `_auto_mined_factor_id_from_expression()`，用公式语义生成描述符式 ID | 新增后端回归覆盖发布返回值 |
| 中文名与 ID 同源于公式语义，且不带来源标签“自动挖掘” | factor expression | `ZScore(Return(Close, 126))` 生成 `a_mom_ret_126d_z` 与「动量标准化因子（126日收益）」 | 回归断言固定该线上问题样本 |
| 历史 `[Auto-Mined] ...` / `auto_<hash>` 记录读取时自动迁移 | `GET /factors/{id}`、`GET /factors` | `ensure_default_factors()` 将 `a_mom_auto_015d73d5_rank` 迁移为 `a_mom_ret_126d_z`，并同步版本、诊断、发布事件、血缘和检疫引用 | 回归先写回旧 ID/旧名，再验证 detail/list 均返回新 ID/中文名 |

## 验证记录

- `python -m pytest tests/test_factor_quarantine_api.py::test_factor_quarantine_publish_uses_chinese_auto_mined_name_from_id_and_formula -q`: red -> green
- `python -m pytest tests/test_factor_quarantine_api.py -q`: 10 passed
- `python -m py_compile src\grit_backtest_platform\factor_research.py tests\test_factor_quarantine_api.py`: passed
- `git diff --check -- src/grit_backtest_platform/factor_research.py tests/test_factor_quarantine_api.py CHANGELOG.md output/ui-artifact-trace/factor-factory-auto-mined-name-20260512-trace-matrix.md`: passed
- 临时 live API 验证: `GET /factors` 中 `a_mom_auto_015d73d5_rank` 不存在、`a_mom_ret_126d_z` 存在；`GET /factors/a_mom_ret_126d_z` 的 UTF-8 响应名匹配「动量标准化因子（126日收益）」，且 `detail_name_has_auto_prefix=false`。
