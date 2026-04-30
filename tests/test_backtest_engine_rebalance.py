from grit_backtest_platform.backtest_engine import BacktestConfig, _rebalance_keys, run_backtest


def test_rebalance_keys_never_only_keeps_first_trade_date():
    dates = ["2024-01-02", "2024-01-03", "2024-01-10", "2024-02-01"]

    assert _rebalance_keys(dates, "never") == [0]


def test_grid_strategy_trades_from_start_instead_of_waiting_until_last_day():
    bars = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 95.0, "high": 96.0, "low": 94.0, "close": 95.0, "adj_close": 95.0},
        {"date": "2024-01-04", "open": 89.0, "high": 90.0, "low": 88.0, "close": 89.0, "adj_close": 89.0},
        {"date": "2024-01-05", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-08", "open": 110.0, "high": 111.0, "low": 109.0, "close": 110.0, "adj_close": 110.0},
        {"date": "2024-01-09", "open": 108.0, "high": 109.0, "low": 107.0, "close": 108.0, "adj_close": 108.0},
    ]

    result = run_backtest(
        {"QQQ": bars},
        config=BacktestConfig(start_date="2024-01-02", end_date="2024-01-09", benchmark_symbol="QQQ"),
        parameters={
            "strategy_type": "GRID",
            "template_key": "grid",
            "initial_position": 20,
            "grid_interval": 5,
            "buy_size_pct": 10,
            "sell_step_pct": 10,
            "sell_size_pct": 10,
            "max_stop_loss_pct": -50,
        },
        benchmark_bars=bars,
    )

    assert [trade.reason for trade in result.trades[:3]] == ["grid:init", "grid:buy", "grid:sell"]
    assert [trade.date for trade in result.trades[:3]] == ["2024-01-02", "2024-01-04", "2024-01-08"]
    assert result.coverage_days == len(result.daily_performance)
    assert result.coverage_ratio == 1.0


def test_grid_strategy_uses_tradeable_close_for_thresholds_instead_of_adjusted_close():
    bars = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 100.0, "high": 101.5, "low": 99.5, "close": 101.0, "adj_close": 90.0},
        {"date": "2024-01-04", "open": 101.0, "high": 102.0, "low": 100.0, "close": 102.0, "adj_close": 91.0},
    ]

    result = run_backtest(
        {"QQQ": bars},
        config=BacktestConfig(start_date="2024-01-02", end_date="2024-01-04", benchmark_symbol="QQQ"),
        parameters={
            "strategy_type": "GRID",
            "template_key": "grid",
            "initial_position": 20,
            "grid_interval": 5,
            "buy_size_pct": 10,
            "sell_step_pct": 10,
            "sell_size_pct": 10,
            "max_stop_loss_pct": -50,
        },
        benchmark_bars=bars,
    )

    assert [trade.reason for trade in result.trades] == ["grid:init"]


def test_buy_and_hold_dca_executes_recurring_contributions_instead_of_single_never_trade():
    bars = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 101.0, "high": 102.0, "low": 100.0, "close": 101.0, "adj_close": 101.0},
        {"date": "2024-01-31", "open": 105.0, "high": 106.0, "low": 104.0, "close": 105.0, "adj_close": 105.0},
        {"date": "2024-02-01", "open": 106.0, "high": 107.0, "low": 105.0, "close": 106.0, "adj_close": 106.0},
        {"date": "2024-02-29", "open": 110.0, "high": 111.0, "low": 109.0, "close": 110.0, "adj_close": 110.0},
        {"date": "2024-03-01", "open": 111.0, "high": 112.0, "low": 110.0, "close": 111.0, "adj_close": 111.0},
        {"date": "2024-03-29", "open": 115.0, "high": 116.0, "low": 114.0, "close": 115.0, "adj_close": 115.0},
    ]

    result = run_backtest(
        {"QQQ": bars},
        config=BacktestConfig(start_date="2024-01-02", end_date="2024-03-29", benchmark_symbol="QQQ"),
        parameters={
            "strategy_type": "BUY_AND_HOLD",
            "template_key": "buy_and_hold",
            "benchmark_symbol": "QQQ",
            "contribution_amount": 1000,
            "investment_frequency": "monthly",
        },
        benchmark_bars=bars,
    )

    assert [trade.date for trade in result.trades] == ["2024-01-02", "2024-02-01", "2024-03-01"]
    assert all(trade.reason == "buy_and_hold:monthly" for trade in result.trades)
    assert [round(float(trade.quantity or 0.0), 6) for trade in result.trades] == [
        10.0,
        round(1000.0 / 106.0, 6),
        round(1000.0 / 111.0, 6),
    ]
    assert [round(float(trade.net_amount or 0.0), 4) for trade in result.trades] == [1000.0, 1000.0, 1000.0]
    assert result.coverage_days == len(result.daily_performance)
    assert result.coverage_ratio == 1.0


def test_asset_allocation_reconstructs_weights_and_rebalances_without_second_report_path():
    dates = ["2024-01-02", "2024-01-03", "2024-04-01", "2024-04-02", "2024-07-01"]
    spy_bars = [
        {"date": date, "open": price, "high": price, "low": price, "close": price, "adj_close": price}
        for date, price in zip(dates, [100.0, 101.0, 110.0, 111.0, 120.0], strict=True)
    ]
    tlt_bars = [
        {"date": date, "open": price, "high": price, "low": price, "close": price, "adj_close": price}
        for date, price in zip(dates, [100.0, 100.5, 99.0, 100.0, 102.0], strict=True)
    ]

    result = run_backtest(
        {"SPY": spy_bars, "TLT": tlt_bars},
        config=BacktestConfig(
            start_date="2024-01-02",
            end_date="2024-07-01",
            benchmark_symbol="SPY",
            transaction_cost_bps=2.0,
        ),
        parameters={
            "strategy_type": "ASSET_ALLOCATION",
            "template_key": "asset_allocation",
            "allocation_assets": [
                {"symbol": "SPY", "display_name": "S&P 500 ETF", "asset_class": "Equity"},
                {"symbol": "TLT", "display_name": "20Y Treasury ETF", "asset_class": "Treasury"},
            ],
            "allocation_weight__SPY_pct": 60,
            "allocation_weight__TLT_pct": 40,
            "rebalance_enabled": True,
            "rebalance_frequency": "quarterly",
            "rebalance_threshold_pct": 0,
            "cost_model_enabled": True,
            "expense_ratio_bps": 5,
        },
        benchmark_bars=spy_bars,
    )

    assert result.effective_date == "2024-01-03"
    assert {trade.symbol for trade in result.trades[:2]} == {"SPY", "TLT"}
    assert all(trade.reason == "asset_allocation:quarterly" for trade in result.trades)
    assert result.coverage_days == len(result.daily_performance)
    assert result.coverage_ratio == 1.0
    assert result.metrics.turnover > 0


def test_asset_allocation_quarterly_schedule_rebalances_even_below_drift_threshold():
    dates = ["2024-01-02", "2024-01-03", "2024-04-01", "2024-04-02", "2024-07-01", "2024-07-02"]
    spy_bars = [
        {"date": date, "open": price, "high": price, "low": price, "close": price, "adj_close": price}
        for date, price in zip(dates, [100.0, 100.1, 101.0, 101.1, 102.0, 102.1], strict=True)
    ]
    tlt_bars = [
        {"date": date, "open": price, "high": price, "low": price, "close": price, "adj_close": price}
        for date, price in zip(dates, [100.0, 99.9, 99.0, 98.9, 98.0, 97.9], strict=True)
    ]

    result = run_backtest(
        {"SPY": spy_bars, "TLT": tlt_bars},
        config=BacktestConfig(
            start_date="2024-01-02",
            end_date="2024-07-02",
            benchmark_symbol="SPY",
        ),
        parameters={
            "strategy_type": "ASSET_ALLOCATION",
            "template_key": "asset_allocation",
            "allocation_assets": [
                {"symbol": "SPY", "display_name": "S&P 500 ETF", "asset_class": "Equity"},
                {"symbol": "TLT", "display_name": "20Y Treasury ETF", "asset_class": "Treasury"},
            ],
            "allocation_weight__SPY_pct": 50,
            "allocation_weight__TLT_pct": 50,
            "rebalance_enabled": True,
            "rebalance_frequency": "quarterly",
            "rebalance_threshold_pct": 5,
        },
        benchmark_bars=spy_bars,
    )

    trade_dates = [trade.date for trade in result.trades]

    assert trade_dates.count("2024-01-03") == 2
    assert trade_dates.count("2024-04-02") == 2
    assert trade_dates.count("2024-07-02") == 2
    assert all(trade.reason == "asset_allocation:quarterly" for trade in result.trades)


def test_asset_allocation_available_weights_normalize_without_operator_warning():
    dates = ["2024-01-02", "2024-01-03"]
    spy_bars = [
        {"date": date, "open": 100.0, "high": 100.0, "low": 100.0, "close": 100.0, "adj_close": 100.0}
        for date in dates
    ]

    result = run_backtest(
        {"SPY": spy_bars},
        config=BacktestConfig(start_date="2024-01-02", end_date="2024-01-03", benchmark_symbol="SPY"),
        parameters={
            "strategy_type": "ASSET_ALLOCATION",
            "template_key": "asset_allocation",
            "allocation_assets": [
                {"symbol": "SPY", "display_name": "S&P 500 ETF", "asset_class": "Equity"},
                {"symbol": "QQQ", "display_name": "Nasdaq 100 ETF", "asset_class": "Growth Equity"},
            ],
            "allocation_weight__SPY_pct": 35,
            "allocation_weight__QQQ_pct": 25,
            "rebalance_enabled": True,
            "rebalance_frequency": "quarterly",
        },
        benchmark_bars=spy_bars,
    )

    assert result.warnings == []
    assert result.trades[0].symbol == "SPY"
    assert result.trades[0].weight_after == 1.0


def test_buy_and_hold_dynamic_logic_uses_valuation_series_to_scale_contributions():
    bars = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 101.0, "high": 102.0, "low": 100.0, "close": 101.0, "adj_close": 101.0},
        {"date": "2024-02-01", "open": 106.0, "high": 107.0, "low": 105.0, "close": 106.0, "adj_close": 106.0},
        {"date": "2024-03-01", "open": 111.0, "high": 112.0, "low": 110.0, "close": 111.0, "adj_close": 111.0},
    ]

    result = run_backtest(
        {"QQQ": bars},
        config=BacktestConfig(start_date="2024-01-02", end_date="2024-03-01", benchmark_symbol="QQQ"),
        parameters={
            "strategy_type": "BUY_AND_HOLD",
            "template_key": "buy_and_hold",
            "benchmark_symbol": "QQQ",
            "contribution_amount": 1000,
            "investment_frequency": "monthly",
            "dynamic_investment_logic": "读取滚动10年PE(TTM)百分位倍率表",
            "dynamic_investment_proxy_key": "nasdaq100",
            "dynamic_investment_rules": [
                {"min_percentile": 90, "max_percentile": 100, "multiplier": 0.5},
                {"min_percentile": 70, "max_percentile": 90, "multiplier": 0.8},
                {"min_percentile": 30, "max_percentile": 70, "multiplier": 1.0},
                {"min_percentile": 10, "max_percentile": 30, "multiplier": 1.5},
                {"min_percentile": 0, "max_percentile": 10, "multiplier": 2.0},
            ],
        },
        benchmark_bars=bars,
        valuation_series={
            "nasdaq100": [
                {"date": "2024-01-02", "pe_ttm": 30.0, "pe_ttm_percentile_10y": 95.0},
                {"date": "2024-02-01", "pe_ttm": 27.0, "pe_ttm_percentile_10y": 75.0},
                {"date": "2024-03-01", "pe_ttm": 24.0, "pe_ttm_percentile_10y": 50.0},
            ]
        },
    )

    assert result.warnings == []
    assert [round(float(trade.net_amount or 0.0), 4) for trade in result.trades] == [500.0, 800.0, 1000.0]
    assert [round(float(trade.contribution_multiplier or 0.0), 2) for trade in result.trades] == [0.5, 0.8, 1.0]
    assert [round(float(trade.valuation_percentile_10y or 0.0), 1) for trade in result.trades] == [95.0, 75.0, 50.0]
    assert [trade.valuation_bucket for trade in result.trades] == ["90-100", "70-90", "30-70"]


def test_mean_reversion_strategy_uses_structured_signal_rules_instead_of_generic_single_rebalance_trade():
    bars = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-04", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-05", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-08", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-09", "open": 50.0, "high": 51.0, "low": 49.0, "close": 50.0, "adj_close": 50.0},
        {"date": "2024-01-10", "open": 50.0, "high": 71.0, "low": 50.0, "close": 70.0, "adj_close": 70.0},
        {"date": "2024-01-11", "open": 70.0, "high": 72.0, "low": 69.0, "close": 71.0, "adj_close": 71.0},
        {"date": "2024-01-12", "open": 71.0, "high": 72.0, "low": 70.0, "close": 71.0, "adj_close": 71.0},
    ]

    result = run_backtest(
        {"QQQ": bars},
        config=BacktestConfig(start_date="2024-01-02", end_date="2024-01-12", benchmark_symbol="QQQ"),
        parameters={
            "strategy_type": "MEAN_REVERSION",
            "template_key": "mean_reversion",
            "bollinger_period": 5,
            "rsi_period": 2,
            "rsi_buy_threshold": 30,
            "rsi_sell_threshold": 80,
            "atr_period": 2,
            "take_profit_atr": 0.5,
            "stop_loss_atr": 1.0,
            "long_entry_size_pct": 50,
            "short_entry_size_pct": 0,
            "rebalance_frequency": "never",
        },
        benchmark_bars=bars,
    )

    assert [trade.reason for trade in result.trades[:2]] == [
        "mean_reversion:long_entry",
        "mean_reversion:take_profit_long",
    ]
    assert [trade.date for trade in result.trades[:2]] == ["2024-01-10", "2024-01-11"]
    assert len(result.trades) >= 2
    assert result.coverage_days == len(result.daily_performance)
    assert result.coverage_ratio == 1.0


def test_rebalance_keys_support_custom_anchor_dates():
    dates = [
        "2024-01-02",
        "2024-02-01",
        "2024-06-28",
        "2024-07-01",
        "2024-07-02",
        "2025-01-02",
    ]

    assert _rebalance_keys(dates, "semiannual", [(1, 1), (7, 1)]) == [0, 3, 5]


def test_momentum_skip_recent_window_changes_selected_symbol():
    bars_a = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 130.0, "high": 131.0, "low": 129.0, "close": 130.0, "adj_close": 130.0},
        {"date": "2024-01-04", "open": 135.0, "high": 136.0, "low": 134.0, "close": 135.0, "adj_close": 135.0},
        {"date": "2024-01-05", "open": 140.0, "high": 141.0, "low": 139.0, "close": 140.0, "adj_close": 140.0},
        {"date": "2024-01-08", "open": 145.0, "high": 146.0, "low": 144.0, "close": 145.0, "adj_close": 145.0},
        {"date": "2024-01-09", "open": 150.0, "high": 151.0, "low": 149.0, "close": 150.0, "adj_close": 150.0},
        {"date": "2024-01-10", "open": 110.0, "high": 111.0, "low": 109.0, "close": 110.0, "adj_close": 110.0},
        {"date": "2024-01-11", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
    ]
    bars_b = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 90.0, "high": 91.0, "low": 89.0, "close": 90.0, "adj_close": 90.0},
        {"date": "2024-01-04", "open": 92.0, "high": 93.0, "low": 91.0, "close": 92.0, "adj_close": 92.0},
        {"date": "2024-01-05", "open": 94.0, "high": 95.0, "low": 93.0, "close": 94.0, "adj_close": 94.0},
        {"date": "2024-01-08", "open": 96.0, "high": 97.0, "low": 95.0, "close": 96.0, "adj_close": 96.0},
        {"date": "2024-01-09", "open": 98.0, "high": 99.0, "low": 97.0, "close": 98.0, "adj_close": 98.0},
        {"date": "2024-01-10", "open": 120.0, "high": 121.0, "low": 119.0, "close": 120.0, "adj_close": 120.0},
        {"date": "2024-01-11", "open": 130.0, "high": 131.0, "low": 129.0, "close": 130.0, "adj_close": 130.0},
    ]
    config = BacktestConfig(start_date="2024-01-02", end_date="2024-01-11", benchmark_symbol="AAA")
    base_parameters = {
        "strategy_type": "MOMENTUM",
        "template_key": "momentum",
        "top_n": 1,
        "holding_count": 1,
        "lookback_days": 5,
        "rebalance_frequency": "daily",
        "weighting_method": "equal_weight",
    }

    without_skip = run_backtest(
        {"AAA": bars_a, "BBB": bars_b},
        config=config,
        parameters={**base_parameters, "skip_recent_days": 0},
        benchmark_bars=bars_a,
    )
    with_skip = run_backtest(
        {"AAA": bars_a, "BBB": bars_b},
        config=config,
        parameters={**base_parameters, "skip_recent_days": 1},
        benchmark_bars=bars_a,
    )

    assert without_skip.trades[-1].symbol == "BBB"
    assert with_skip.trades[-1].symbol == "AAA"
    assert without_skip.metrics.total_return != with_skip.metrics.total_return


def test_momentum_warmup_uses_pre_start_bars_and_executes_on_requested_start():
    dates = [
        "2023-12-29",
        "2024-01-02",
        "2024-01-03",
        "2024-01-04",
        "2024-01-05",
        "2024-01-08",
        "2024-01-09",
        "2024-01-10",
        "2024-01-11",
    ]
    bars_a = [
        {
            "date": trade_date,
            "open": price,
            "high": price + 1.0,
            "low": price - 1.0,
            "close": price,
            "adj_close": price,
        }
        for trade_date, price in zip(dates, [100.0, 105.0, 110.0, 115.0, 120.0, 125.0, 130.0, 131.0, 132.0])
    ]
    bars_b = [
        {
            "date": trade_date,
            "open": price,
            "high": price + 1.0,
            "low": price - 1.0,
            "close": price,
            "adj_close": price,
        }
        for trade_date, price in zip(dates, [100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 120.0, 121.0, 122.0])
    ]

    result = run_backtest(
        {"AAA": bars_a, "BBB": bars_b},
        config=BacktestConfig(start_date="2024-01-10", end_date="2024-01-11", benchmark_symbol="AAA"),
        parameters={
            "strategy_type": "MOMENTUM",
            "template_key": "momentum",
            "top_n": 1,
            "holding_count": 1,
            "lookback_days": 5,
            "skip_recent_days": 1,
            "rebalance_frequency": "daily",
            "weighting_method": "equal_weight",
        },
        benchmark_bars=bars_a,
    )

    assert result.warnings == []
    assert result.effective_date == "2024-01-10"
    assert [point.date for point in result.daily_performance] == ["2024-01-10", "2024-01-11"]
    assert result.trades[0].date == "2024-01-10"
    assert result.trades[0].symbol == "AAA"


def test_momentum_hold_rank_threshold_retains_existing_holdings_before_replacement():
    bars_a = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 120.0, "high": 121.0, "low": 119.0, "close": 120.0, "adj_close": 120.0},
        {"date": "2024-01-04", "open": 125.0, "high": 126.0, "low": 124.0, "close": 125.0, "adj_close": 125.0},
        {"date": "2024-01-05", "open": 130.0, "high": 131.0, "low": 129.0, "close": 130.0, "adj_close": 130.0},
        {"date": "2024-01-08", "open": 135.0, "high": 136.0, "low": 134.0, "close": 135.0, "adj_close": 135.0},
        {"date": "2024-01-09", "open": 140.0, "high": 141.0, "low": 139.0, "close": 140.0, "adj_close": 140.0},
        {"date": "2024-01-10", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-11", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
    ]
    bars_b = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 105.0, "high": 106.0, "low": 104.0, "close": 105.0, "adj_close": 105.0},
        {"date": "2024-01-04", "open": 110.0, "high": 111.0, "low": 109.0, "close": 110.0, "adj_close": 110.0},
        {"date": "2024-01-05", "open": 115.0, "high": 116.0, "low": 114.0, "close": 115.0, "adj_close": 115.0},
        {"date": "2024-01-08", "open": 120.0, "high": 121.0, "low": 119.0, "close": 120.0, "adj_close": 120.0},
        {"date": "2024-01-09", "open": 125.0, "high": 126.0, "low": 124.0, "close": 125.0, "adj_close": 125.0},
        {"date": "2024-01-10", "open": 130.0, "high": 131.0, "low": 129.0, "close": 130.0, "adj_close": 130.0},
        {"date": "2024-01-11", "open": 135.0, "high": 136.0, "low": 134.0, "close": 135.0, "adj_close": 135.0},
    ]
    bars_c = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 90.0, "high": 91.0, "low": 89.0, "close": 90.0, "adj_close": 90.0},
        {"date": "2024-01-04", "open": 92.0, "high": 93.0, "low": 91.0, "close": 92.0, "adj_close": 92.0},
        {"date": "2024-01-05", "open": 94.0, "high": 95.0, "low": 93.0, "close": 94.0, "adj_close": 94.0},
        {"date": "2024-01-08", "open": 96.0, "high": 97.0, "low": 95.0, "close": 96.0, "adj_close": 96.0},
        {"date": "2024-01-09", "open": 98.0, "high": 99.0, "low": 97.0, "close": 98.0, "adj_close": 98.0},
        {"date": "2024-01-10", "open": 140.0, "high": 141.0, "low": 139.0, "close": 140.0, "adj_close": 140.0},
        {"date": "2024-01-11", "open": 150.0, "high": 151.0, "low": 149.0, "close": 150.0, "adj_close": 150.0},
    ]
    config = BacktestConfig(start_date="2024-01-02", end_date="2024-01-11", benchmark_symbol="AAA")
    base_parameters = {
        "strategy_type": "MOMENTUM",
        "template_key": "momentum",
        "top_n": 2,
        "holding_count": 2,
        "lookback_days": 5,
        "rebalance_frequency": "daily",
        "weighting_method": "equal_weight",
    }

    strict_hold = run_backtest(
        {"AAA": bars_a, "BBB": bars_b, "CCC": bars_c},
        config=config,
        parameters={**base_parameters, "hold_rank_threshold": 2},
        benchmark_bars=bars_a,
    )
    loose_hold = run_backtest(
        {"AAA": bars_a, "BBB": bars_b, "CCC": bars_c},
        config=config,
        parameters={**base_parameters, "hold_rank_threshold": 3},
        benchmark_bars=bars_a,
    )

    strict_rebalance_symbols = [trade.symbol for trade in strict_hold.trades if trade.date == "2024-01-11"]
    loose_rebalance_symbols = [trade.symbol for trade in loose_hold.trades if trade.date == "2024-01-11"]

    assert strict_rebalance_symbols == ["AAA", "CCC"]
    assert loose_rebalance_symbols == []
    assert strict_hold.metrics.turnover > loose_hold.metrics.turnover


def test_momentum_score_weighted_allocates_more_weight_to_stronger_signal():
    bars_a = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 110.0, "high": 111.0, "low": 109.0, "close": 110.0, "adj_close": 110.0},
        {"date": "2024-01-04", "open": 120.0, "high": 121.0, "low": 119.0, "close": 120.0, "adj_close": 120.0},
        {"date": "2024-01-05", "open": 130.0, "high": 131.0, "low": 129.0, "close": 130.0, "adj_close": 130.0},
        {"date": "2024-01-08", "open": 140.0, "high": 141.0, "low": 139.0, "close": 140.0, "adj_close": 140.0},
        {"date": "2024-01-09", "open": 150.0, "high": 151.0, "low": 149.0, "close": 150.0, "adj_close": 150.0},
        {"date": "2024-01-10", "open": 151.0, "high": 152.0, "low": 150.0, "close": 151.0, "adj_close": 151.0},
    ]
    bars_b = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 105.0, "high": 106.0, "low": 104.0, "close": 105.0, "adj_close": 105.0},
        {"date": "2024-01-04", "open": 110.0, "high": 111.0, "low": 109.0, "close": 110.0, "adj_close": 110.0},
        {"date": "2024-01-05", "open": 115.0, "high": 116.0, "low": 114.0, "close": 115.0, "adj_close": 115.0},
        {"date": "2024-01-08", "open": 118.0, "high": 119.0, "low": 117.0, "close": 118.0, "adj_close": 118.0},
        {"date": "2024-01-09", "open": 120.0, "high": 121.0, "low": 119.0, "close": 120.0, "adj_close": 120.0},
        {"date": "2024-01-10", "open": 121.0, "high": 122.0, "low": 120.0, "close": 121.0, "adj_close": 121.0},
    ]
    bars_c = [
        {"date": "2024-01-02", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-03", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-04", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-05", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-08", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-09", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
        {"date": "2024-01-10", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0, "adj_close": 100.0},
    ]
    config = BacktestConfig(start_date="2024-01-02", end_date="2024-01-10", benchmark_symbol="AAA")
    base_parameters = {
        "strategy_type": "MOMENTUM",
        "template_key": "momentum",
        "top_n": 2,
        "holding_count": 2,
        "lookback_days": 5,
        "rebalance_frequency": "daily",
        "hold_rank_threshold": 2,
    }

    equal_weight = run_backtest(
        {"AAA": bars_a, "BBB": bars_b, "CCC": bars_c},
        config=config,
        parameters={**base_parameters, "weighting_method": "equal_weight"},
        benchmark_bars=bars_a,
    )
    score_weighted = run_backtest(
        {"AAA": bars_a, "BBB": bars_b, "CCC": bars_c},
        config=config,
        parameters={**base_parameters, "weighting_method": "score_weighted"},
        benchmark_bars=bars_a,
    )

    equal_weight_allocations = {
        trade.symbol: trade.weight_after
        for trade in equal_weight.trades
        if trade.date == "2024-01-10"
    }
    score_weighted_allocations = {
        trade.symbol: trade.weight_after
        for trade in score_weighted.trades
        if trade.date == "2024-01-10"
    }

    assert abs(equal_weight_allocations["AAA"] - 0.5) < 1e-9
    assert abs(equal_weight_allocations["BBB"] - 0.5) < 1e-9
    assert score_weighted_allocations["AAA"] > score_weighted_allocations["BBB"]
