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
    assert result.coverage_days == len(result.daily_performance)
    assert result.coverage_ratio == 1.0


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
