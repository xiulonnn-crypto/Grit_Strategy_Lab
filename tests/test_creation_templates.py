from grit_backtest_platform.creation_templates import (
    blank_confirmation_fields,
    build_confirmation,
    detect_universe,
)


def _messages(content: str) -> list[dict[str, str]]:
    return [{'role': 'user', 'content': content}]


def test_detect_universe_recognizes_target_prefix_without_separator():
    universe, source, conflicts = detect_universe(
        _messages('纳指网格策略 目标QQQ，本金100000，初始买入10%，后续每跌2%买入5%，每涨5%卖出5%')
    )

    assert universe == 'QQQ'
    assert source == 'user_input'
    assert conflicts == []


def test_build_confirmation_extracts_grid_fields_from_real_user_message():
    payload = build_confirmation(
        _messages('本金10000，初始买入QQQ20%仓位，每下跌5%买入10%，每上涨10%卖出10%')
    )

    pending_keys = {item['key'] for item in payload['pending_inputs']}
    parameter_values = {
        item['key']: item.get('value')
        for item in payload['confirmation_fields']['parameters']
    }
    parameter_sources = {
        item['key']: item.get('source')
        for item in payload['confirmation_fields']['parameters']
    }

    assert payload['top_level']['universe_name'] == 'QQQ'
    assert payload['top_level']['rebalance_frequency'] == 'never'
    assert 'universe_name' not in pending_keys
    assert 'initial_position' not in pending_keys
    assert 'benchmark_symbol' not in pending_keys
    assert 'strategy_name' not in pending_keys
    assert 'strategy_description' not in pending_keys
    assert 'max_stop_loss_pct' in pending_keys
    assert parameter_values['strategy_name'] == 'QQQ 网格交易策略'
    assert parameter_sources['strategy_name'] == 'system_inference'
    assert parameter_values['strategy_description'] == '本金10000，围绕QQQ执行网格交易，初始仓位20%，每下跌5%买入10%，每上涨10%卖出10%。'
    assert parameter_sources['strategy_description'] == 'system_inference'
    assert parameter_values['benchmark_symbol'] == 'SPY'
    assert parameter_values['initial_position'] == 20
    assert parameter_values['grid_interval'] == 5
    assert parameter_values['buy_size_pct'] == 10
    assert parameter_values['sell_step_pct'] == 10
    assert parameter_values['sell_size_pct'] == 10


def test_build_confirmation_extracts_sp500_momentum_rotation_fields():
    payload = build_confirmation(
        _messages(
            '标普动量策略\n'
            '每年1月第1个交易日和7月第一个交易日（每半年1次）\n'
            '取标普成分股，前12个月-前1个月的总收益率排行前100名，买入或保留持仓；若不在前120名，移除持仓\n'
            '持仓比例按数量均分仓位\n'
            '初始100000刀'
        )
    )

    top_level = payload['top_level']
    parameter_values = {
        item['key']: item.get('value')
        for item in payload['confirmation_fields']['parameters']
    }
    pending_keys = {item['key'] for item in payload['pending_inputs']}

    assert top_level['strategy_type'] == 'MOMENTUM'
    assert top_level['universe_name'] == '标普500成分股'
    assert top_level['rebalance_frequency'] == 'semiannual'
    assert parameter_values['strategy_name'] == '标普动量策略'
    assert parameter_values['strategy_description'] == '在标普500成分股内做横截面动量轮动，每半年按每年01月第1个交易日；07月第1个交易日调仓，按前12个月剔除最近1个月收益排序，买入或保留前100名，跌出前120名移除，持仓按数量等权分配，初始资金100000USD。'
    assert parameter_values['benchmark_symbol'] == 'SPY'
    assert parameter_values['lookback_months'] == 12
    assert parameter_values['skip_recent_months'] == 1
    assert parameter_values['top_n'] == 100
    assert parameter_values['hold_rank_threshold'] == 120
    assert parameter_values['weighting_method'] == 'equal_weight'
    assert parameter_values['rebalance_anchor_dates'] == '每年01月第1个交易日；07月第1个交易日'
    assert parameter_values['capital'] == 100000
    assert 'strategy_name' not in pending_keys
    assert 'strategy_description' not in pending_keys
    assert 'benchmark_symbol' not in pending_keys
    assert 'lookback_months' not in pending_keys
    assert 'skip_recent_months' not in pending_keys
    assert 'top_n' not in pending_keys
    assert 'hold_rank_threshold' not in pending_keys
    assert 'weighting_method' not in pending_keys
    assert 'rebalance_anchor_dates' not in pending_keys
    assert 'capital' not in pending_keys
    assert payload['manual_conflicts'] == []


def test_build_confirmation_keeps_buy_and_hold_type_and_extracts_dca_fields():
    payload = build_confirmation(
        _messages('QQQ月度定投策略 每月第一个交易日买入QQQ1000USD'),
        forced_type='BUY_AND_HOLD',
    )

    top_level = payload['top_level']
    parameter_values = {
        item['key']: item.get('value')
        for item in payload['confirmation_fields']['parameters']
    }
    pending_keys = {item['key'] for item in payload['pending_inputs']}

    assert top_level['strategy_type'] == 'BUY_AND_HOLD'
    assert top_level['universe_name'] == 'QQQ'
    assert top_level['rebalance_frequency'] == 'never'
    assert parameter_values['strategy_name'] == 'QQQ 月度定投策略'
    assert parameter_values['strategy_description'] == '围绕QQQ执行月度定投，每期买入1000USD，按每期首个交易日执行。'
    assert parameter_values['benchmark_symbol'] == 'QQQ'
    assert parameter_values['contribution_amount'] == 1000
    assert parameter_values['investment_frequency'] == 'monthly'
    assert pending_keys == set()


def test_build_confirmation_keeps_mean_reversion_type_and_extracts_core_fields():
    payload = build_confirmation(
        _messages('QQQ均值回归策略 交易逻辑：价格偏离均值过大时反向建仓。标准差阈值2，窗口大小50，回归目标MA50'),
        forced_type='MEAN_REVERSION',
    )

    top_level = payload['top_level']
    parameter_values = {
        item['key']: item.get('value')
        for item in payload['confirmation_fields']['parameters']
    }
    pending_keys = {item['key'] for item in payload['pending_inputs']}

    assert top_level['strategy_type'] == 'MEAN_REVERSION'
    assert top_level['universe_name'] == 'QQQ'
    assert top_level['rebalance_frequency'] == 'weekly'
    assert parameter_values['strategy_name'] == 'QQQ 均值回归策略'
    assert parameter_values['benchmark_symbol'] == 'QQQ'
    assert parameter_values['trading_logic'].startswith('QQQ均值回归策略')
    assert parameter_values['deviation_threshold'] == 2
    assert parameter_values['window_size'] == 50
    assert parameter_values['mean_target'] == 'MA50'
    assert 'strategy_name' not in pending_keys
    assert 'strategy_description' not in pending_keys
    assert 'trading_logic' not in pending_keys
    assert 'deviation_threshold' not in pending_keys
    assert 'window_size' not in pending_keys


def test_build_confirmation_preserves_manual_override_and_emits_manual_conflict():
    existing = blank_confirmation_fields('MOMENTUM')
    for entry in existing['parameters']:
        if entry['key'] == 'top_n':
            entry['value'] = 20
            entry['source'] = 'manual_override'
            break
    else:
        raise AssertionError('top_n field missing from momentum template')

    payload = build_confirmation(
        _messages('我想选前5名'),
        existing=existing,
        forced_type='MOMENTUM',
    )

    top_n_entry = next(item for item in payload['confirmation_fields']['parameters'] if item['key'] == 'top_n')

    assert top_n_entry['value'] == 20
    assert top_n_entry['source'] == 'manual_override'
    assert any(item['key'] == 'top_n' for item in payload['manual_conflicts'])
    conflict = next(item for item in payload['manual_conflicts'] if item['key'] == 'top_n')
    assert conflict['manual_value'] == 20
    assert conflict['ai_value'] == 5
