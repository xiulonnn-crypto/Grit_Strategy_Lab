# 多因子回测排查快照复盘

适用场景：

- 两条 `MULTI_FACTOR` 回测的 `effective_date` 一样，但首篮子或收益曲线明显不同。
- 用户怀疑“同一条 20Y 回测”在重跑后口径漂移。
- 需要先分清“历史存档事实”与“今天代码复现结果”是不是同一层问题。

## 推荐入口

先跑只读法证工具，不要一上来就回放代码：

```powershell
python .\scripts\recovery\compare_backtest_runs.py --run-a <run_id_a> --run-b <run_id_b>
```

这个工具直接读取 `.grit_backtest_platform.sqlite3` 中的 `backtest_runs` 存档，优先输出：

- `request.start_date` / `request.end_date`
- `effective_date`
- `first_chart_trade_date`
- `first_trade_date`
- `first_basket`
- `rebalance_dates`
- `parameter_snapshot`
- `multi_factor_precheck`
- 当前持久化证据缺口

## 推荐顺序

1. 先看两个 run 的存档事实，而不是先看当前代码。
2. 明确区分 `request.start_date`、`effective_date`、`first_chart_trade_date`、`first_trade_date`。
3. 先比较首篮子和调仓日期，再比较参数快照和 `multi_factor_precheck`。
4. 如果参数快照一致、`multi_factor_precheck` 一致、`effective_date` 也一致，但首篮子不同，优先怀疑历史执行快照或历史数据版本漂移，不要直接判定为“今天代码有 bug”。
5. 只有在存档事实确认后，才进入当前代码复现或历史提交回放。

## 本次案例提炼的高频误判点

- `effective_date` 一样，不代表两次 run 真的是同一道题。
- `source_run_id` 存在时，要额外检查提交页是否把原始请求窗口改写成了源 run 的首个成交日。
- `parameter_snapshot` 一样，不代表“实际生效因子输入”完全一样。
- 当前代码无法自然复现历史 run 时，不应自动把历史 run 当成今天逻辑的回归样本。

## 当前持久化证据缺口

`backtest_runs` 现在仍然缺少几类关键法证指纹：

- `engine_version` 或 `git_sha`
- `factor_definition_hash` 或 factor version id
- `universe_membership_hash`
- `multi_factor_attribution`

因此，如果工具已经显示“参数一致但首篮子分叉”，下一步应转向：

- 对照 run `created_at` 回看本地 git 时间线
- 检查当时是否存在未提交工作树改动
- 必要时回放历史提交或补充更细的执行指纹
