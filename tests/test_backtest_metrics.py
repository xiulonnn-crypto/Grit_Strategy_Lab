from grit_backtest_platform.backtest_metrics import (
    build_drawdown_events,
    build_run_detail_analysis,
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


def test_rolling_metrics_emit_trailing_252_return_and_sharpe_for_default_window():
    chart_series = []
    returns = [0.01, 0.004, -0.002, 0.006] * 65
    equity = 100.0
    for index, daily_return in enumerate(returns, start=1):
        equity *= 1.0 + daily_return
        chart_series.append(
            {
                'trade_date': f'd{index}',
                'equity': round(equity, 6),
                'benchmark': 100.0,
                'drawdown': 0.0,
                'is_oos': index > 252,
                'strategy_return': daily_return,
            }
        )

    rolling = build_rolling_metrics(chart_series, 252)

    assert rolling
    assert rolling[0]['trade_date'] == 'd252'
    assert rolling[0]['window_days'] == 252
    assert rolling[0]['window_return_pct'] == rolling[0]['trailing_252_return']
    assert isinstance(rolling[0]['trailing_252_return'], float)
    assert isinstance(rolling[0]['trailing_252_sharpe'], float)
    assert rolling[0]['trailing_252_sharpe'] != 0.0


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
        {'trade_date': '2024-01-02', 'equity': 98.0, 'benchmark': 100.5, 'drawdown': -2.0, 'is_oos': False},
        {'trade_date': '2024-01-03', 'equity': 95.0, 'benchmark': 101.0, 'drawdown': -5.0, 'is_oos': False},
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


def test_drawdown_events_do_not_double_scale_chart_series_percent_values():
    chart_series = [
        {'trade_date': '2024-01-01', 'equity': 100.0, 'benchmark': 100.0, 'drawdown': 0.0, 'is_oos': False},
        {'trade_date': '2024-01-02', 'equity': 99.4, 'benchmark': 100.2, 'drawdown': -0.6, 'is_oos': False},
        {'trade_date': '2024-01-03', 'equity': 100.0, 'benchmark': 100.3, 'drawdown': 0.0, 'is_oos': False},
    ]

    events = build_drawdown_events(chart_series)

    assert events[0]['drawdown_pct'] == -0.6


def test_run_detail_analysis_prefers_real_trade_events_over_audit_episode_counts():
    detail = {
        'metrics': {'total_return': 0.12, 'sharpe': 0.9, 'max_drawdown': -0.08},
        'chart_series': [
            {
                'trade_date': '2024-01-31',
                'equity': 100.0,
                'benchmark': 100.0,
                'drawdown': 0.0,
                'is_oos': False,
                'strategy_return': 0.0,
                'benchmark_return': 0.0,
            },
            {
                'trade_date': '2024-02-29',
                'equity': 108.0,
                'benchmark': 104.0,
                'drawdown': -1.0,
                'is_oos': False,
                'strategy_return': 0.08,
                'benchmark_return': 0.04,
            },
            {
                'trade_date': '2024-03-29',
                'equity': 112.0,
                'benchmark': 106.0,
                'drawdown': -2.0,
                'is_oos': True,
                'strategy_return': 0.037,
                'benchmark_return': 0.019,
            },
        ],
        'oos_start_date': '2024-03-01',
        'trades_count': 121,
        'trades': [
            {'trade_date': '2024-02-01', 'segment': 'IS'},
            {'trade_date': '2024-03-05', 'segment': 'OOS'},
            {'trade_date': '2024-03-20', 'segment': 'OOS'},
        ],
        'trade_audit_items': [
            {'opened_at': '2024-02-01', 'closed_at': '2024-03-20', 'segment': 'OOS'},
        ],
    }

    analysis = build_run_detail_analysis(detail)
    trade_card = next(card for card in analysis['kpi_cards'] if card['key'] == 'trade_count')

    assert trade_card['primary_text'] == '121'
    assert trade_card['trend_text'] == '训练集 1 / 测试集 2'
    assert trade_card['compare_text'] == '训练集: 1 | 测试集: 2'


def test_run_detail_analysis_uses_equity_curve_for_dca_style_strategy_comparison():
    detail = {
        'metrics': {'total_return': 0.64, 'sharpe': 0.91, 'max_drawdown': -0.12},
        'chart_series': [
            {
                'trade_date': '2024-01-31',
                'equity': 1.0,
                'benchmark': 100.0,
                'drawdown': 0.0,
                'is_oos': False,
                'strategy_return': 0.0,
                'benchmark_return': 0.0,
            },
            {
                'trade_date': '2024-02-29',
                'equity': 1.1,
                'benchmark': 110.0,
                'drawdown': -1.0,
                'is_oos': False,
                'strategy_return': 0.1,
                'benchmark_return': 0.1,
            },
            {
                'trade_date': '2024-03-29',
                'equity': 1.3,
                'benchmark': 150.0,
                'drawdown': -2.0,
                'is_oos': True,
                'strategy_return': 0.3636363636,
                'benchmark_return': 0.3636363636,
            },
            {
                'trade_date': '2024-04-30',
                'equity': 1.64,
                'benchmark': 200.0,
                'drawdown': -1.5,
                'is_oos': True,
                'strategy_return': 0.3333333333,
                'benchmark_return': 0.3333333333,
            },
        ],
        'oos_start_date': '2024-03-01',
        'trades_count': 4,
        'trades': [
            {'trade_date': '2024-02-01', 'segment': 'IS'},
            {'trade_date': '2024-03-05', 'segment': 'OOS'},
            {'trade_date': '2024-03-20', 'segment': 'OOS'},
            {'trade_date': '2024-04-03', 'segment': 'OOS'},
        ],
    }

    analysis = build_run_detail_analysis(detail)
    total_return_card = next(card for card in analysis['kpi_cards'] if card['key'] == 'total_return')
    sharpe_card = next(card for card in analysis['kpi_cards'] if card['key'] == 'sharpe')

    assert total_return_card['primary_text'] == '+64.0%'
    assert total_return_card['compare_text'] == '基准: +100.0% | 差值: -36.0% | 测试集: -7.2%'
    assert sharpe_card['compare_text'] != '基准: 0.91 | 差值: +0.00 | 测试集: 0.91'
