from grit_backtest_platform.backtest_metrics import (
    build_drawdown_events,
    build_monthly_returns,
    build_relative_metrics,
    build_rolling_metrics,
)


def test_monthly_returns_keep_missing_first_month_null():
    chart_series = [
        {'trade_date': '2024-01-31', 'equity': 100.0, 'benchmark': 100.0, 'drawdown': 0.0, 'is_oos': False},
        {'trade_date': '2024-02-29', 'equity': 110.0, 'benchmark': 101.0, 'drawdown': 0.0, 'is_oos': False},
        {'trade_date': '2024-03-29', 'equity': 121.0, 'benchmark': 102.0, 'drawdown': 0.0, 'is_oos': True},
    ]
    monthly = build_monthly_returns(chart_series, '2024-03-01')
    assert monthly[0]['return_pct'] is None
    assert monthly[1]['return_pct'] == 10.0
    assert monthly[2]['segment'] == 'OOS'


def test_drawdown_events_mark_unrecovered():
    chart_series = [
        {'trade_date': '2024-01-01', 'equity': 100.0, 'benchmark': 100.0, 'drawdown': 0.0, 'is_oos': False},
        {'trade_date': '2024-01-02', 'equity': 96.0, 'benchmark': 101.0, 'drawdown': -4.0, 'is_oos': False},
        {'trade_date': '2024-01-03', 'equity': 94.0, 'benchmark': 102.0, 'drawdown': -6.0, 'is_oos': False},
        {'trade_date': '2024-01-04', 'equity': 95.0, 'benchmark': 103.0, 'drawdown': -5.0, 'is_oos': True},
    ]
    events = build_drawdown_events(chart_series, '2024-01-04')
    assert events[0]['status'] == 'unrecovered'
    assert events[0]['recovery_date'] is None


def test_rolling_metrics_short_windows_return_empty_list():
    chart_series = [
        {'trade_date': '2024-01-01', 'equity': 100.0, 'benchmark': 100.0, 'drawdown': 0.0, 'is_oos': False},
        {'trade_date': '2024-01-02', 'equity': 101.0, 'benchmark': 100.5, 'drawdown': 0.0, 'is_oos': False},
    ]
    assert build_rolling_metrics(chart_series, None) == []


def test_relative_metrics_handles_zero_benchmark_sum_without_division_error():
    chart_series = [
        {'trade_date': '2024-01-01', 'strategy_return': 0.02, 'benchmark_return': 0.0},
        {'trade_date': '2024-01-02', 'strategy_return': -0.01, 'benchmark_return': 0.0},
    ]
    metrics = build_relative_metrics(chart_series)
    assert metrics['alpha_proxy'] == 0.01
    assert metrics['average_excess_return'] == 0.005
    assert metrics['capture_ratio'] == 0.0


def test_relative_metrics_preserve_nonzero_capture_ratio():
    chart_series = [
        {'trade_date': '2024-01-01', 'strategy_return': 0.03, 'benchmark_return': 0.02},
        {'trade_date': '2024-01-02', 'strategy_return': -0.01, 'benchmark_return': -0.01},
    ]
    metrics = build_relative_metrics(chart_series)
    assert round(metrics['alpha_proxy'], 10) == 0.01
    assert round(metrics['average_excess_return'], 10) == 0.005
    assert round(metrics['capture_ratio'], 10) == 2.0


def test_drawdown_events_mark_recovered_oos_segment_on_recovery_date():
    chart_series = [
        {'trade_date': '2024-01-01', 'equity': 100.0, 'benchmark': 100.0, 'drawdown': 0.0, 'is_oos': False},
        {'trade_date': '2024-01-02', 'equity': 98.0, 'benchmark': 100.5, 'drawdown': -0.02, 'is_oos': False},
        {'trade_date': '2024-01-03', 'equity': 95.0, 'benchmark': 101.0, 'drawdown': -0.05, 'is_oos': False},
        {'trade_date': '2024-01-04', 'equity': 100.0, 'benchmark': 101.5, 'drawdown': 0.0, 'is_oos': True},
    ]
    events = build_drawdown_events(chart_series, '2024-01-04')
    assert events[0] == {
        'start_date': '2024-01-02',
        'trough_date': '2024-01-03',
        'drawdown_pct': -5.0,
        'recovery_date': '2024-01-04',
        'status': 'recovered',
        'segment': 'OOS',
    }
